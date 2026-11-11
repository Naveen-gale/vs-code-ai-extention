/**
 * FreeCode AI — New Providers & Rate Limit Reset Test Suite
 *
 * Verifies:
 * 1. Provider metadata for Cohere, Cloudflare Workers AI, and Mistral AI (with exact requested fields).
 * 2. Model registry definitions for Cohere, Cloudflare, and Mistral.
 * 3. ProviderFactory instantiation and completion handling for new providers.
 * 4. Response header parsing for rate limits (retry-after, ratelimit-reset, x-ratelimit-reset).
 * 5. Cooldown reset when API key is updated or saved.
 * 6. Webview messages and extension command for resetting rate limit cooldowns.
 * 7. Webview HTML template checks for new providers and priority levels.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Global Mock for 'vscode'
const mockVscode = {
  window: {
    showInformationMessage: () => Promise.resolve(),
    showWarningMessage: (msg, ...items) => Promise.resolve(items[0]),
    showErrorMessage: () => Promise.resolve(),
    showQuickPick: (items) => Promise.resolve(items[0]),
    showInputBox: () => Promise.resolve('mock-input'),
    registerWebviewViewProvider: () => {}
  },
  commands: {
    registerCommand: () => {},
    executeCommand: () => Promise.resolve()
  },
  Uri: {
    file: (p) => ({ fsPath: p, scheme: 'file' }),
    joinPath: (base, ...segs) => ({ fsPath: path.join(base.fsPath || base, ...segs) })
  }
};

const Module = require('module');
const origReq = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'vscode') return mockVscode;
  return origReq.apply(this, arguments);
};

const { PROVIDERS, PROVIDER_METADATA } = require('../src/config/providers');
const { MODEL_REGISTRY, getDefaultModelId } = require('../src/config/modelRegistry');
const { ProviderFactory } = require('../src/providers/providerFactory');
const { LimitTracker } = require('../src/usage/limitTracker');
const { UsageTracker } = require('../src/usage/usageTracker');
const { SecretManager } = require('../src/security/secretManager');
const { ProviderManager } = require('../src/providers/providerManager');
const { ChatController } = require('../src/chat/chatController');
const { ChatProvider } = require('../src/ui/chatProvider');
const httpClient = require('../src/utils/httpClient');

console.log('================================================================');
console.log('    RUNNING NEW PROVIDERS & RATE LIMIT RESET TEST SUITE         ');
console.log('================================================================\n');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error('  Error:', err.message);
    if (err.stack) console.error(err.stack);
    failed++;
  }
}

// Mock context for SecretManager & ProviderManager
function createMockContext() {
  const secrets = new Map();
  const state = new Map();
  return {
    secrets: {
      get: async (k) => secrets.get(k),
      store: async (k, v) => secrets.set(k, v),
      delete: async (k) => secrets.delete(k)
    },
    globalState: {
      get: (k, d) => state.has(k) ? state.get(k) : d,
      update: async (k, v) => state.set(k, v)
    },
    extensionUri: { fsPath: path.resolve(__dirname, '..') }
  };
}

function createTestChatProvider() {
  const context = createMockContext();
  const secretManager = new SecretManager(context.secrets);
  const usageTracker = new UsageTracker(context.globalState);
  const providerManager = new ProviderManager(context.globalState, secretManager);
  const chatController = new ChatController({ secretManager, usageTracker, providerManager, initialProvider: null });
  return new ChatProvider({
    extensionUri: context.extensionUri,
    chatController,
    secretManager,
    usageTracker,
    providerManager
  });
}

async function run() {
  // TEST 1: Provider Metadata & Exact Mistral Spec
  await test('TEST 1: Provider metadata definitions for Cohere, Cloudflare, and exact Mistral spec', () => {
    assert.strictEqual(PROVIDERS.COHERE, 'cohere');
    assert.strictEqual(PROVIDERS.CLOUDFLARE, 'cloudflare');
    assert.strictEqual(PROVIDERS.MISTRAL, 'mistral');

    // Exact Mistral spec requested by user:
    const mistral = PROVIDER_METADATA.mistral;
    assert.ok(mistral, 'Mistral metadata must exist');
    assert.strictEqual(mistral.id, 'mistral');
    assert.strictEqual(mistral.name, 'Mistral AI');
    assert.strictEqual(mistral.apiSupported, true);
    assert.strictEqual(mistral.freeApi, false);
    assert.strictEqual(mistral.billingRequired, true);
    assert.strictEqual(mistral.quotaType, 'organization_managed');
    assert.strictEqual(mistral.useResponseHeaders, true);

    // Cohere and Cloudflare metadata
    const cohere = PROVIDER_METADATA.cohere;
    assert.ok(cohere);
    assert.strictEqual(cohere.id, 'cohere');
    assert.strictEqual(cohere.name, 'Cohere');
    assert.strictEqual(cohere.freeApi, true);

    const cloudflare = PROVIDER_METADATA.cloudflare;
    assert.ok(cloudflare);
    assert.strictEqual(cloudflare.id, 'cloudflare');
    assert.strictEqual(cloudflare.name, 'Cloudflare Workers AI');
    assert.strictEqual(cloudflare.freeApi, true);
  });

  // TEST 2: Model Registry includes models for all 3 new providers
  await test('TEST 2: ModelRegistry provides default and verified models for new providers', () => {
    const cohereModels = MODEL_REGISTRY[PROVIDERS.COHERE];
    assert.ok(Array.isArray(cohereModels) && cohereModels.length >= 3);
    assert.strictEqual(getDefaultModelId(PROVIDERS.COHERE), 'command-r-plus');
    assert.ok(cohereModels.some(m => m.id === 'c4ai-aya-expanse-32b'));

    const cfModels = MODEL_REGISTRY[PROVIDERS.CLOUDFLARE];
    assert.ok(Array.isArray(cfModels) && cfModels.length >= 4);
    assert.strictEqual(getDefaultModelId(PROVIDERS.CLOUDFLARE), '@cf/meta/llama-3.3-70b-instruct');
    assert.ok(cfModels.some(m => m.id === '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b'));

    const mistralModels = MODEL_REGISTRY[PROVIDERS.MISTRAL];
    assert.ok(Array.isArray(mistralModels) && mistralModels.length >= 4);
    assert.strictEqual(getDefaultModelId(PROVIDERS.MISTRAL), 'codestral-latest');
    assert.ok(mistralModels.some(m => m.id === 'mistral-large-latest'));
  });

  // TEST 3: ProviderFactory creates instances of Cohere, Cloudflare, Mistral
  await test('TEST 3: ProviderFactory creates correct provider instances', () => {
    const cohere = ProviderFactory.create(PROVIDERS.COHERE, { apiKey: 'test-cohere-key' });
    assert.strictEqual(cohere.providerId, 'cohere');
    assert.strictEqual(cohere.apiKey, 'test-cohere-key');

    const cf = ProviderFactory.create(PROVIDERS.CLOUDFLARE, { apiKey: 'test-cf-token', endpoint: 'my-acc-123' });
    assert.strictEqual(cf.providerId, 'cloudflare');
    assert.strictEqual(cf.apiKey, 'test-cf-token');
    assert.strictEqual(cf.endpoint, 'my-acc-123');

    const mistral = ProviderFactory.create(PROVIDERS.MISTRAL, { apiKey: 'test-mistral-key' });
    assert.strictEqual(mistral.providerId, 'mistral');
    assert.strictEqual(mistral.apiKey, 'test-mistral-key');
  });

  // TEST 4: Cloudflare endpoint / URL formatting logic
  await test('TEST 4: Cloudflare Workers AI routes URLs for account ID, custom worker, and default gateway', () => {
    const cf1 = ProviderFactory.create(PROVIDERS.CLOUDFLARE, { apiKey: 'token', endpoint: '0123456789abcdef0123456789abcdef' });
    assert.strictEqual(
      cf1._getChatUrl(),
      'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/v1/chat/completions'
    );

    const cf2 = ProviderFactory.create(PROVIDERS.CLOUDFLARE, { apiKey: 'token', endpoint: 'https://gateway.ai.cloudflare.com/v1/my-acc/my-gw/workers-ai' });
    assert.strictEqual(
      cf2._getChatUrl(),
      'https://gateway.ai.cloudflare.com/v1/my-acc/my-gw/workers-ai/chat/completions'
    );

    const cf3 = ProviderFactory.create(PROVIDERS.CLOUDFLARE, { apiKey: 'token' });
    assert.strictEqual(
      cf3._getChatUrl(),
      'https://api.cloudflare.com/client/v4/ai/v1/chat/completions'
    );
  });

  // TEST 5: Complete executions for new providers with mocked httpClient
  await test('TEST 5: Complete executions for Cohere, Cloudflare, and Mistral return standardized response', async () => {
    const origRequest = httpClient.request;

    // Test Cohere
    httpClient.request = async (url, opts) => {
      assert.ok(url.includes('api.cohere.com'));
      assert.strictEqual(opts.headers.Authorization, 'Bearer test-cohere');
      return {
        message: {
          content: [{ text: 'Hello from Cohere' }]
        },
        usage: {
          billed_units: { input_tokens: 12, output_tokens: 8 }
        }
      };
    };
    const cohere = ProviderFactory.create(PROVIDERS.COHERE, { apiKey: 'test-cohere' });
    const cohereRes = await cohere.complete([{ role: 'user', content: 'Hi' }]);
    assert.strictEqual(cohereRes.text, 'Hello from Cohere');
    assert.strictEqual(cohereRes.usage.promptTokens, 12);
    assert.strictEqual(cohereRes.usage.completionTokens, 8);

    // Test Mistral
    httpClient.request = async (url, opts) => {
      assert.ok(url.includes('api.mistral.ai'));
      assert.strictEqual(opts.headers.Authorization, 'Bearer test-mistral');
      return {
        choices: [{ message: { content: 'Hello from Mistral Codestral' } }],
        usage: { prompt_tokens: 15, completion_tokens: 10, total_tokens: 25 }
      };
    };
    const mistral = ProviderFactory.create(PROVIDERS.MISTRAL, { apiKey: 'test-mistral' });
    const mistralRes = await mistral.complete([{ role: 'user', content: 'Code this' }]);
    assert.strictEqual(mistralRes.text, 'Hello from Mistral Codestral');
    assert.strictEqual(mistralRes.usage.totalTokens, 25);

    // Test Cloudflare
    httpClient.request = async (url, opts) => {
      assert.strictEqual(opts.headers.Authorization, 'Bearer test-cf');
      return {
        result: { response: 'Hello from Cloudflare Llama 3.3' },
        usage: { prompt_tokens: 10, completion_tokens: 14, total_tokens: 24 }
      };
    };
    const cf = ProviderFactory.create(PROVIDERS.CLOUDFLARE, { apiKey: 'test-cf' });
    const cfRes = await cf.complete([{ role: 'user', content: 'Cloudflare' }]);
    assert.strictEqual(cfRes.text, 'Hello from Cloudflare Llama 3.3');
    assert.strictEqual(cfRes.usage.totalTokens, 24);

    httpClient.request = origRequest;
  });

  // TEST 6: Response header extraction for rate limits (retry-after, ratelimit-reset, x-ratelimit-reset)
  await test('TEST 6: Response header extraction for rate limits accurately parses cooldown seconds', () => {
    const tracker = new LimitTracker();

    // 1. Standard retry-after in seconds
    const sec = tracker._extractRetryAfter({ 'retry-after': '25' });
    assert.strictEqual(sec, 25);

    // 2. Future unix timestamp in ratelimit-reset
    const futureEpoch = Math.floor(Date.now() / 1000) + 40;
    const secEpoch = tracker._extractRetryAfter({ 'ratelimit-reset': String(futureEpoch) });
    assert.ok(secEpoch >= 38 && secEpoch <= 42, `Expected ~40s, got ${secEpoch}`);

    // 3. x-ratelimit-reset-requests in seconds
    const secReq = tracker._extractRetryAfter({ 'x-ratelimit-reset-requests': '18s' });
    assert.strictEqual(secReq, 18);

    // 4. x-ratelimit-reset-tokens
    const secTok = tracker._extractRetryAfter({ 'x-ratelimit-reset-tokens': '55' });
    assert.strictEqual(secTok, 55);

    // 5. Classify HTTP 429 error using response headers
    const err429 = new Error('Too many requests');
    err429.status = 429;
    err429.headers = { 'retry-after': '35' };
    const classification = tracker.classifyError(err429);
    assert.strictEqual(classification.category, 'RATE_LIMIT');
    assert.strictEqual(classification.retryAfterSeconds, 35);
  });

  // TEST 7: Cooldown clearing on UsageTracker & LimitTracker
  await test('TEST 7: LimitTracker and UsageTracker support clearing specific and all cooldowns', () => {
    const tracker = new UsageTracker();
    tracker.limitTracker.setCooldown('cohere', 60, 'Rate limit exceeded');
    tracker.limitTracker.setCooldown('mistral', 60, 'Rate limit exceeded');

    assert.strictEqual(tracker.getCooldownInfo('cohere').active, true);
    assert.strictEqual(tracker.getCooldownInfo('mistral').active, true);

    // Clear single provider
    tracker.clearCooldown('cohere');
    assert.strictEqual(tracker.getCooldownInfo('cohere').active, false);
    assert.strictEqual(tracker.getCooldownInfo('mistral').active, true);

    // Clear all
    tracker.clearCooldown();
    assert.strictEqual(tracker.getCooldownInfo('mistral').active, false);
  });

  // TEST 8: Saving/Updating API key automatically resets rate limit cooldown
  await test('TEST 8: Saving or updating API key clears cooldown for that provider', async () => {
    const ctx = createMockContext();
    const secretManager = new SecretManager(ctx);
    const providerManager = new ProviderManager(ctx, secretManager);
    const usageTracker = new UsageTracker();
    const chatController = new ChatController({
      secretManager,
      providerManager,
      usageTracker
    });

    const messagesSent = [];
    const chatProvider = new ChatProvider({
      extensionUri: ctx.extensionUri,
      chatController,
      providerManager,
      secretManager,
      usageTracker
    });
    chatProvider.postMessage = (msg) => messagesSent.push(msg);

    // Put mistral in cooldown
    usageTracker.limitTracker.setCooldown(PROVIDERS.MISTRAL, 120, 'Rate limit reached');
    assert.strictEqual(usageTracker.getCooldownInfo(PROVIDERS.MISTRAL).active, true);

    // User updates/saves new API key
    await chatProvider.handleSaveApiKey(PROVIDERS.MISTRAL, 'new-mistral-api-key', { activate: true });

    // Cooldown must be cleared immediately!
    const cooldownAfter = usageTracker.getCooldownInfo(PROVIDERS.MISTRAL);
    assert.strictEqual(cooldownAfter.active, false, 'Mistral cooldown should be cleared after API key update');
  });

  // TEST 9: resetRateLimits command / webview message clears cooldowns
  await test('TEST 9: resetRateLimits message resets cooldowns and responds to webview', async () => {
    const ctx = createMockContext();
    const secretManager = new SecretManager(ctx);
    const providerManager = new ProviderManager(ctx, secretManager);
    const usageTracker = new UsageTracker();
    const chatController = new ChatController({
      secretManager,
      providerManager,
      usageTracker
    });

    const messagesSent = [];
    const chatProvider = new ChatProvider({
      extensionUri: ctx.extensionUri,
      chatController,
      providerManager,
      secretManager,
      usageTracker
    });
    chatProvider.postMessage = (msg) => messagesSent.push(msg);

    // Set cooldown on Groq and OpenRouter
    usageTracker.limitTracker.setCooldown(PROVIDERS.GROQ, 90, 'Rate limit');
    usageTracker.limitTracker.setCooldown(PROVIDERS.OPENROUTER, 90, 'Rate limit');

    assert.strictEqual(usageTracker.getCooldownInfo(PROVIDERS.GROQ).active, true);
    assert.strictEqual(usageTracker.getCooldownInfo(PROVIDERS.OPENROUTER).active, true);

    // Trigger resetRateLimits
    await chatProvider.handleMessage({ command: 'resetRateLimits' });

    assert.strictEqual(usageTracker.getCooldownInfo(PROVIDERS.GROQ).active, false);
    assert.strictEqual(usageTracker.getCooldownInfo(PROVIDERS.OPENROUTER).active, false);

    const hasSuccessResult = messagesSent.some(m => m.type === 'connectionResult' && m.success === true && m.message.includes('Rate limit cooldowns'));
    assert.ok(hasSuccessResult, 'Webview should receive connectionResult confirmation of reset');
  });

  // TEST 10: Webview HTML and package.json contains all new providers & reset command
  await test('TEST 10: Webview index.html and package.json reflect all 11 providers and resetRateLimits', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
    assert.ok(pkg.activationEvents.includes('onCommand:freecodeAI.resetRateLimits'));
    assert.ok(pkg.contributes.commands.some(c => c.command === 'freecodeAI.resetRateLimits'));

    const html = fs.readFileSync(path.resolve(__dirname, '../src/ui/webview/index.html'), 'utf8');
    assert.ok(html.includes('value="cohere"'), 'index.html must include cohere option');
    assert.ok(html.includes('value="cloudflare"'), 'index.html must include cloudflare option');
    assert.ok(html.includes('value="mistral"'), 'index.html must include mistral option');
    assert.ok(html.includes('value="nvidia"'), 'index.html must include nvidia option');
    assert.ok(html.includes('value="deepseek"'), 'index.html must include deepseek option');
    assert.ok(html.includes('value="huggingface"'), 'index.html must include huggingface option');
    assert.ok(html.includes('value="openai"'), 'index.html must include openai option');
    assert.ok(html.includes('id="btn-reset-rate-limits"'), 'index.html must include reset rate limits button');
    assert.ok(html.includes('Priority 11 (Lowest)'), 'index.html priority select must support 11 providers');
  });

  // TEST 11: Free and Paid tags are explicitly configured in ModelRegistry
  await test('TEST 11: ModelRegistry explicitly marks free models (Gemini, Groq, Ollama, Cohere, Cloudflare, NVIDIA, HuggingFace) and paid models (Mistral, DeepSeek, OpenAI)', () => {
    const geminiModels = MODEL_REGISTRY[PROVIDERS.GEMINI];
    assert.ok(geminiModels.every(m => m.isFree === true), 'Gemini models should be free tier');

    const groqModels = MODEL_REGISTRY[PROVIDERS.GROQ];
    assert.ok(groqModels.every(m => m.isFree === true), 'Groq models should be free tier');

    const ollamaModels = MODEL_REGISTRY[PROVIDERS.OLLAMA];
    assert.ok(ollamaModels.every(m => m.isFree === true), 'Ollama local models should be free');

    const mistralModels = MODEL_REGISTRY[PROVIDERS.MISTRAL];
    assert.ok(mistralModels.every(m => m.isFree === false), 'Mistral models should be marked as paid');

    const nvidiaModels = MODEL_REGISTRY[PROVIDERS.NVIDIA];
    assert.ok(nvidiaModels.every(m => m.isFree === true), 'NVIDIA NIM models should be marked free starter tier');

    const deepseekModels = MODEL_REGISTRY[PROVIDERS.DEEPSEEK];
    assert.ok(deepseekModels.every(m => m.isFree === false), 'DeepSeek models should be marked as paid pay-as-you-go');

    const hfModels = MODEL_REGISTRY[PROVIDERS.HUGGINGFACE];
    assert.ok(hfModels.every(m => m.isFree === true), 'Hugging Face serverless models should be marked free tier');

    const openaiModels = MODEL_REGISTRY[PROVIDERS.OPENAI];
    assert.ok(openaiModels.every(m => m.isFree === false), 'OpenAI models should be marked as paid');

    const openrouterModels = MODEL_REGISTRY[PROVIDERS.OPENROUTER];
    const freeOr = openrouterModels.find(m => m.id.endsWith(':free'));
    const paidOr = openrouterModels.find(m => m.id.includes('claude'));
    assert.strictEqual(freeOr.isFree, true);
    assert.strictEqual(paidOr.isFree, false);
  });

  // TEST 12: Webview app.js includes pricing tag logic with (Free) and (Paid)
  await test('TEST 12: Webview app.js formats models with (Free) or (Paid) tags in dropdown options', () => {
    const appJs = fs.readFileSync(path.resolve(__dirname, '../src/ui/webview/app.js'), 'utf8');
    assert.ok(appJs.includes('getModelPricingTag'), 'app.js should define getModelPricingTag');
    assert.ok(appJs.includes('`\${cleanName} (\${tag})`'), 'app.js should append (Free) or (Paid) to model display name');
    assert.ok(appJs.includes('🟢 Free Model'), 'app.js should render Free Model badge in description');
    assert.ok(appJs.includes('💳 Paid Model'), 'app.js should render Paid Model badge in description');
  });

  // TEST 13: ProviderFactory creates instances of NVIDIA NIM, DeepSeek, Hugging Face, OpenAI
  await test('TEST 13: ProviderFactory and completion handling for NVIDIA NIM, DeepSeek, Hugging Face, and OpenAI', async () => {
    const nvidia = ProviderFactory.create(PROVIDERS.NVIDIA, { apiKey: 'nv-key' });
    assert.strictEqual(nvidia.providerId, 'nvidia');

    const deepseek = ProviderFactory.create(PROVIDERS.DEEPSEEK, { apiKey: 'ds-key' });
    assert.strictEqual(deepseek.providerId, 'deepseek');

    const hf = ProviderFactory.create(PROVIDERS.HUGGINGFACE, { apiKey: 'hf-key' });
    assert.strictEqual(hf.providerId, 'huggingface');

    const openai = ProviderFactory.create(PROVIDERS.OPENAI, { apiKey: 'oa-key' });
    assert.strictEqual(openai.providerId, 'openai');

    const origRequest = httpClient.request;

    // Test NVIDIA completion
    httpClient.request = async (url, opts) => {
      assert.ok(url.includes('integrate.api.nvidia.com'));
      assert.strictEqual(opts.headers.Authorization, 'Bearer nv-key');
      return {
        choices: [{ message: { content: 'Hello from NVIDIA NIM' } }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
      };
    };
    const nvRes = await nvidia.complete([{ role: 'user', content: 'test' }]);
    assert.strictEqual(nvRes.text, 'Hello from NVIDIA NIM');
    assert.strictEqual(nvRes.usage.totalTokens, 20);

    // Test DeepSeek completion
    httpClient.request = async (url, opts) => {
      assert.ok(url.includes('api.deepseek.com'));
      assert.strictEqual(opts.headers.Authorization, 'Bearer ds-key');
      return {
        choices: [{ message: { content: 'Hello from DeepSeek' } }],
        usage: { prompt_tokens: 8, completion_tokens: 12, total_tokens: 20 }
      };
    };
    const dsRes = await deepseek.complete([{ role: 'user', content: 'test' }]);
    assert.strictEqual(dsRes.text, 'Hello from DeepSeek');

    // Test Hugging Face completion
    httpClient.request = async (url, opts) => {
      assert.ok(url.includes('api-inference.huggingface.co'));
      assert.strictEqual(opts.headers.Authorization, 'Bearer hf-key');
      return {
        choices: [{ message: { content: 'Hello from Hugging Face' } }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 }
      };
    };
    const hfRes = await hf.complete([{ role: 'user', content: 'test' }]);
    assert.strictEqual(hfRes.text, 'Hello from Hugging Face');

    // Test OpenAI completion
    httpClient.request = async (url, opts) => {
      assert.ok(url.includes('api.openai.com'));
      assert.strictEqual(opts.headers.Authorization, 'Bearer oa-key');
      return {
        choices: [{ message: { content: 'Hello from OpenAI GPT-4o' } }],
        usage: { prompt_tokens: 14, completion_tokens: 16, total_tokens: 30 }
      };
    };
    const oaRes = await openai.complete([{ role: 'user', content: 'test' }]);
    assert.strictEqual(oaRes.text, 'Hello from OpenAI GPT-4o');

    httpClient.request = origRequest;
  });

  // TEST 14: NVIDIA NIM entitlement 404 error detection and probe verification
  await test('TEST 14: NVIDIA NIM entitlement 404 error detection and live probe verification', async () => {
    const nvidia = ProviderFactory.create(PROVIDERS.NVIDIA, { apiKey: 'nv-key-unentitled' });
    const origRequest = httpClient.request;

    // Simulate NVIDIA 404 Function not found for account error
    httpClient.request = async (url) => {
      const { HttpError } = require('../src/utils/httpClient');
      const err = new HttpError(
        "Function '316490c6-f1ed-41f9-9da8-3fa9e885653b': Not found for account 'TnA16ZG8cLGpFExwcmnu5k1_qF_BArHfU_OAG4s7904'",
        404,
        {
          status: 404,
          title: "Not Found",
          detail: "Function '316490c6-f1ed-41f9-9da8-3fa9e885653b': Not found for account 'TnA16ZG8cLGpFExwcmnu5k1_qF_BArHfU_OAG4s7904'"
        }
      );
      throw err;
    };

    // 1. complete() throws clear Entitlement Error
    let threw = false;
    try {
      await nvidia.complete([{ role: 'user', content: 'hi' }]);
    } catch (err) {
      threw = true;
      assert.ok(err.message.includes('NVIDIA NIM Account Entitlement Error'), 'Should explain entitlement error');
      assert.ok(err.message.includes('build.nvidia.com'), 'Should give actionable fix steps');
    }
    assert.ok(threw, 'complete() must throw on 404 function not found');

    // 2. testConnection() catches failure during probe and returns failure message
    httpClient.request = async (url) => {
      if (url.includes('/models')) {
        // GET /models succeeds
        return { data: [{ id: 'meta/llama-3.3-70b-instruct' }] };
      }
      // POST /chat/completions probe fails with 404
      const { HttpError } = require('../src/utils/httpClient');
      throw new HttpError(
        "Function '316490c6-f1ed-41f9-9da8-3fa9e885653b': Not found for account 'TnA16ZG8cLGpFExwcmnu5k1_qF_BArHfU_OAG4s7904'",
        404,
        {
          status: 404,
          title: "Not Found",
          detail: "Function '316490c6-f1ed-41f9-9da8-3fa9e885653b': Not found for account 'TnA16ZG8cLGpFExwcmnu5k1_qF_BArHfU_OAG4s7904'"
        }
      );
    };

    const testRes = await nvidia.testConnection();
    assert.strictEqual(testRes.success, false);
    assert.ok(testRes.message.includes('missing "Public API Endpoints" permission'));

    httpClient.request = origRequest;
  });

  // TEST 15: saveAndTestConnection and ModelDiscovery real-time model fetching
  await test('TEST 15: saveAndTestConnection and ModelDiscovery real-time model fetching with API key', async () => {
    const { ModelDiscovery } = require('../src/providers/modelDiscovery');
    const origRequest = httpClient.request;

    // 1. Verify ModelDiscovery._fetchNvidiaModels uses live endpoint with apiKey
    httpClient.request = async (url, opts) => {
      assert.ok(url.includes('integrate.api.nvidia.com/v1/models'));
      assert.strictEqual(opts.headers.Authorization, 'Bearer test-nv-key');
      return {
        data: [
          { id: 'meta/llama-3.3-70b-instruct' },
          { id: 'deepseek-ai/deepseek-r1' },
          { id: 'nvidia/llama-3.1-nemotron-70b-instruct' }
        ]
      };
    };

    const nvModels = await ModelDiscovery.fetchModels(PROVIDERS.NVIDIA, { apiKey: 'test-nv-key' });
    assert.strictEqual(nvModels.length, 3);
    assert.strictEqual(nvModels[0].id, 'meta/llama-3.3-70b-instruct');
    assert.strictEqual(nvModels[0].isFree, true);

    // 2. Verify ModelDiscovery._fetchOpenAIModels uses live endpoint with apiKey
    httpClient.request = async (url, opts) => {
      assert.ok(url.includes('api.openai.com/v1/models'));
      assert.strictEqual(opts.headers.Authorization, 'Bearer test-oa-key');
      return {
        data: [
          { id: 'gpt-4o' },
          { id: 'gpt-4o-mini' },
          { id: 'o1' }
        ]
      };
    };

    const oaModels = await ModelDiscovery.fetchModels(PROVIDERS.OPENAI, { apiKey: 'test-oa-key' });
    assert.strictEqual(oaModels.length, 3);
    assert.strictEqual(oaModels[0].id, 'gpt-4o-mini');
    assert.strictEqual(oaModels[0].isFree, false);

    // 3. Verify chatProvider handles saveAndTestConnection by dispatching modelsUpdated
    const chatProvider = createTestChatProvider();
    let postedModelsMsg = null;
    chatProvider._view = {
      webview: {
        postMessage: (msg) => {
          if (msg.type === 'modelsUpdated') postedModelsMsg = msg;
        }
      }
    };

    // Mock probe and models
    httpClient.request = async (url) => {
      if (url.includes('/models')) {
        return { data: [{ id: 'meta/llama-3.3-70b-instruct' }] };
      }
      return { choices: [{ message: { content: 'ok' } }] };
    };

    await chatProvider.handleMessage({
      command: 'saveAndTestConnection',
      provider: PROVIDERS.NVIDIA,
      apiKey: 'test-nv-key'
    });

    assert.ok(postedModelsMsg !== null, 'saveAndTestConnection must trigger modelsUpdated');
    assert.strictEqual(postedModelsMsg.provider, 'nvidia');
    assert.strictEqual(postedModelsMsg.models[0].id, 'meta/llama-3.3-70b-instruct');

    httpClient.request = origRequest;
  });

  // TEST 16: Selecting model for NVIDIA or any provider correctly activates provider, sets model, and preserves API key
  await test('TEST 16: Selecting model for NVIDIA correctly activates provider, sets model, and preserves API key', async () => {
    const chatProvider = createTestChatProvider();
    let lastPostedState = null;
    chatProvider._view = {
      webview: {
        postMessage: (msg) => {
          if (msg.type === 'stateUpdated') lastPostedState = msg.state;
        }
      }
    };

    // 1. Add and configure NVIDIA with API key and model in one click (Select this Model)
    await chatProvider.handleMessage({
      command: 'saveApiKey',
      provider: PROVIDERS.NVIDIA,
      apiKey: 'nvapi-valid-key-12345',
      model: 'nvidia/llama-3.1-nemotron-70b-instruct',
      activate: true
    });

    const activeProv = chatProvider.providerManager.getActiveProvider();
    assert.strictEqual(activeProv, 'nvidia', 'Active provider should be nvidia');
    assert.strictEqual(chatProvider.chatController.activeModel, 'nvidia/llama-3.1-nemotron-70b-instruct', 'Active model should be nemotron');
    const hasKey = await chatProvider.secretManager.hasApiKey('nvidia');
    assert.strictEqual(hasKey, true, 'API key must be saved and preserved');

    const state = await chatProvider.chatController.getState();
    assert.strictEqual(state.provider, 'nvidia');
    assert.strictEqual(state.model, 'nvidia/llama-3.1-nemotron-70b-instruct');
    assert.strictEqual(state.hasKey, true);

    // 2. Select a different model (deepseek-ai/deepseek-r1) using selectModel (without re-sending apiKey)
    await chatProvider.handleMessage({
      command: 'selectModel',
      provider: PROVIDERS.NVIDIA,
      model: 'deepseek-ai/deepseek-r1',
      activate: true
    });

    assert.strictEqual(chatProvider.chatController.activeModel, 'deepseek-ai/deepseek-r1', 'Active model should update to DeepSeek R1');
    const keyStillThere = await chatProvider.secretManager.hasApiKey('nvidia');
    assert.strictEqual(keyStillThere, true, 'API key must NOT be erased when changing models');

    const state2 = await chatProvider.chatController.getState();
    assert.strictEqual(state2.provider, 'nvidia');
    assert.strictEqual(state2.model, 'deepseek-ai/deepseek-r1');
    assert.strictEqual(state2.hasKey, true);
  });

  // TEST 17: NVIDIA NIM completion extracts output text from JSON, SSE stream, and array parts
  await test('TEST 17: NVIDIA NIM completion extracts output text from JSON, SSE stream, and array parts', async () => {
    const nvidia = ProviderFactory.create(PROVIDERS.NVIDIA, { apiKey: 'nv-test-key' });
    const origRequest = httpClient.request;

    // 1. Verify stream: false and Accept: application/json are sent
    let sentBody = null;
    let sentHeaders = null;
    httpClient.request = async (url, opts) => {
      sentHeaders = opts.headers;
      sentBody = JSON.parse(opts.body);
      return {
        choices: [{ message: { content: 'Hello! I am Llama 3.3 running on NVIDIA NIM.' } }],
        usage: { prompt_tokens: 15, completion_tokens: 12, total_tokens: 27 }
      };
    };

    const res1 = await nvidia.complete([{ role: 'user', content: 'hi' }]);
    assert.strictEqual(res1.text, 'Hello! I am Llama 3.3 running on NVIDIA NIM.');
    assert.strictEqual(sentBody.stream, false, 'Must request non-streaming mode stream: false');
    assert.strictEqual(sentHeaders.Accept, 'application/json', 'Must request Accept: application/json');

    // 2. Test SSE string payload handling (if provider returns SSE event stream)
    httpClient.request = async () => {
      return (
        'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}\n\n' +
        'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"Hello "}}]}\n\n' +
        'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"world!"}}]}\n\n' +
        'data: [DONE]\n\n'
      );
    };

    const res2 = await nvidia.complete([{ role: 'user', content: 'hi' }]);
    assert.strictEqual(res2.text, 'Hello world!', 'Must parse SSE event stream and concatenate content');

    // 3. Test array content parts
    httpClient.request = async () => {
      return {
        choices: [{
          message: {
            content: [
              { type: 'text', text: 'Output part 1, ' },
              { type: 'text', text: 'part 2.' }
            ]
          }
        }]
      };
    };

    const res3 = await nvidia.complete([{ role: 'user', content: 'hi' }]);
    assert.strictEqual(res3.text, 'Output part 1, part 2.');

    // 4. Test that empty choices / empty text throws descriptive error (never returns empty string)
    httpClient.request = async () => {
      return {
        choices: [{
          message: { content: '' },
          finish_reason: 'stop'
        }]
      };
    };

    let caughtErr = null;
    try {
      await nvidia.complete([{ role: 'user', content: 'hi' }]);
    } catch (err) {
      caughtErr = err;
    }
    assert.ok(caughtErr, 'Must throw error when NVIDIA NIM returns empty completion text');
    assert.ok(caughtErr.message.includes('returned an empty completion'), 'Error message must inform user of empty completion');

    httpClient.request = origRequest;
  });

  // TEST 18: ChatController rejects empty provider response and triggers failover
  await test('TEST 18: ChatController rejects empty provider response and records failure', async () => {
    const context = createMockContext();
    const secretManager = new SecretManager(context.secrets);
    await secretManager.storeApiKey('gemini', 'test-gemini-key');
    const usageTracker = new UsageTracker(context.globalState);
    const providerManager = new ProviderManager(context.globalState, secretManager);
    await providerManager.setActiveProvider('gemini');

    const controller = new ChatController({
      secretManager,
      usageTracker,
      providerManager,
      initialProvider: 'gemini'
    });

    const origCreate = ProviderFactory.create;
    ProviderFactory.create = () => ({
      complete: async () => ({ text: '', usage: { totalTokens: 0, isEstimated: true } })
    });

    let controllerErr = null;
    try {
      await controller.sendMessage('hi');
    } catch (err) {
      controllerErr = err;
    }
    assert.ok(controllerErr, 'ChatController must throw when provider returns empty text');
    assert.ok(controllerErr.message.includes('returned an empty response'));

    ProviderFactory.create = origCreate;
  });

  console.log('\n================================================================');
  console.log(`TOTAL NEW PROVIDER TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
