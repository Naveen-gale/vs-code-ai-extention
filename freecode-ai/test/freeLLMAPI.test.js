const assert = require('assert');

const { PROVIDERS, PROVIDER_METADATA } = require('../src/config/providers');
const { ProviderFactory } = require('../src/providers/providerFactory');
const { ModelDiscovery } = require('../src/providers/modelDiscovery');
const { ProviderManager } = require('../src/providers/providerManager');
const { SecretManager } = require('../src/security/secretManager');
const httpClient = require('../src/utils/httpClient');
const { ModelRouter } = require('../src/router/modelRouter');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err.message}`);
    failed++;
  }
}

class MockSecrets {
  constructor() { this.values = new Map(); }
  async store(k, v) { this.values.set(k, v); }
  async get(k) { return this.values.get(k) || null; }
  async delete(k) { this.values.delete(k); }
}

class MockState {
  constructor() { this.values = new Map(); }
  get(k, fallback) { return this.values.has(k) ? this.values.get(k) : fallback; }
  async update(k, v) { this.values.set(k, v); }
}

(async () => {
  await test('FreeLLMAPI metadata and factory registration', () => {
    assert.strictEqual(PROVIDERS.FREELLMAPI, 'freellmapi');
    assert.strictEqual(PROVIDER_METADATA.freellmapi.baseUrl, 'http://127.0.0.1:31415/v1');
    const provider = ProviderFactory.create('freellmapi', {
      apiKey: 'freellmapi-test',
      model: 'test-model',
      endpoint: 'http://127.0.0.1:31415/v1'
    });
    assert.strictEqual(provider.providerId, 'freellmapi');
  });

  await test('FreeLLMAPI validates base URL', async () => {
    const provider = ProviderFactory.create('freellmapi', {
      apiKey: 'freellmapi-test',
      endpoint: 'not-a-url'
    });
    const result = await provider.testConnection();
    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes('base URL'));
  });

  await test('FreeLLMAPI discovers only live model IDs', async () => {
    const original = httpClient.request;
    httpClient.request = async (url, options) => {
      assert.strictEqual(url, 'http://127.0.0.1:31415/v1/models');
      assert.strictEqual(options.headers.Authorization, 'Bearer freellmapi-test');
      return { data: [{ id: 'live-model-a' }, { id: 'live-model-b' }] };
    };
    try {
      const models = await ModelDiscovery.fetchModels('freellmapi', {
        apiKey: 'freellmapi-test',
        endpoint: 'http://127.0.0.1:31415/v1'
      });
      assert.deepStrictEqual(models.map(m => m.id), ['live-model-a', 'live-model-b']);
    } finally {
      httpClient.request = original;
    }
  });

  await test('FreeLLMAPI chat completion uses OpenAI-compatible schema', async () => {
    const original = httpClient.request;
    httpClient.request = async (url, options) => {
      assert.strictEqual(url, 'http://127.0.0.1:31415/v1/chat/completions');
      assert.strictEqual(JSON.parse(options.body).model, 'live-model-a');
      return {
        choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 }
      };
    };
    try {
      const provider = ProviderFactory.create('freellmapi', {
        apiKey: 'freellmapi-test',
        model: 'live-model-a',
        endpoint: 'http://127.0.0.1:31415/v1'
      });
      const response = await provider.complete([{ role: 'user', content: 'Hi' }]);
      assert.strictEqual(response.text, 'Hello');
      assert.strictEqual(response.usage.totalTokens, 6);
      assert.strictEqual(response.usage.isEstimated, false);
    } finally {
      httpClient.request = original;
    }
  });

  await test('FreeLLMAPI credentials and Gemini credential remain independent', async () => {
    const secrets = new MockSecrets();
    const state = new MockState();
    const secretManager = new SecretManager(secrets);
    await secretManager.storeApiKey('gemini', 'gemini-secret');
    await secretManager.storeApiKey('freellmapi', 'freellmapi-secret');

    const manager = new ProviderManager(state, secretManager);
    await manager.setProviderConfiguration('freellmapi', {
      endpoint: 'http://127.0.0.1:31415/v1',
      model: 'live-model-a'
    });
    await manager.removeProvider('freellmapi');

    assert.strictEqual(await secretManager.getApiKey('freellmapi'), null);
    assert.strictEqual(await secretManager.getApiKey('gemini'), 'gemini-secret');
  });

  await test('FreeLLMAPI fallback priority selects next configured provider', async () => {
    const secrets = new MockSecrets();
    const state = new MockState();
    const secretManager = new SecretManager(secrets);
    await secretManager.storeApiKey('freellmapi', 'freellmapi-secret');
    await secretManager.storeApiKey('gemini', 'gemini-secret');
    const manager = new ProviderManager(state, secretManager);
    await manager.setProviderConfiguration('freellmapi', { priority: 1 });
    await manager.setProviderConfiguration('gemini', { priority: 2, model: 'gemini-1.5-pro' });
    const next = await manager.getNextFallbackProvider('freellmapi');
    assert.strictEqual(next.id, 'gemini');
  });

  await test('FreeLLMAPI inline routing uses legacy completions with a compact prompt', async () => {
    const original = httpClient.request;
    httpClient.request = async (url, options) => {
      assert.strictEqual(url, 'http://127.0.0.1:31415/v1/completions');
      const body = JSON.parse(options.body);
      assert.strictEqual(body.model, 'live-model-a');
      assert.ok(body.prompt.includes('<CURSOR>'));
      assert.ok(body.max_tokens <= 64);
      return { choices: [{ text: '  return value;' }], usage: { total_tokens: 12 } };
    };
    try {
      const provider = ProviderFactory.create('freellmapi', {
        apiKey: 'freellmapi-test',
        model: 'live-model-a',
        endpoint: 'http://127.0.0.1:31415/v1'
      });
      const response = await provider.completeInline('function test() {', '}', { model: 'live-model-a' });
      assert.strictEqual(response.text, '  return value;');
    } finally {
      httpClient.request = original;
    }
  });

  await test('ModelRouter supports FreeLLMAPI auto routing modes', async () => {
    const secrets = new MockSecrets();
    const state = new MockState();
    const secretManager = new SecretManager(secrets);
    await secretManager.storeApiKey('freellmapi', 'freellmapi-secret');
    const manager = new ProviderManager(state, secretManager);
    await manager.setProviderConfiguration('freellmapi', {
      endpoint: 'http://127.0.0.1:31415/v1',
      selectionMode: 'auto'
    });
    const router = new ModelRouter({ providerManager: manager, secretManager });
    const inline = await router.route({ providerId: 'freellmapi', taskType: 'inline' });
    assert.strictEqual(inline.model, 'auto:fast');
    const agent = await router.route({ providerId: 'freellmapi', taskType: 'agent' });
    assert.strictEqual(agent.model, 'auto:smart');
  });

  console.log(`\nFREE LLM API TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  if (failed) process.exit(1);
})();
