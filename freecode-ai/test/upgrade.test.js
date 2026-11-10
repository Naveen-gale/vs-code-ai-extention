/**
 * Comprehensive Test Suite for FreeCode AI Upgrade:
 * - Extension activation & command registration
 * - SecretManager (Secure API Key Storage)
 * - ModelDiscovery (Live & Fallback registry)
 * - ProviderFactory & Providers (Gemini, Groq, OpenRouter, Ollama)
 * - LimitTracker & Error Classification (Rate limit, Quota, Auth, Cooldown)
 * - UsageTracker & UsageStorage (Tokens reported vs estimated, requests)
 * - ChatController (History, Prompt building, Cooldown enforcement)
 * - ChatProvider & Webview message communication
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('====================================================');
console.log('     RUNNING FREECODE AI FEATURE UPGRADE TESTS     ');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

function it(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}`);
    failed++;
  }
}

async function itAsync(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}`);
    failed++;
  }
}

// Mock SecretStorage
class MockSecretStorage {
  constructor() {
    this.map = new Map();
  }
  async store(k, v) { this.map.set(k, v); }
  async get(k) { return this.map.get(k) || null; }
  async delete(k) { this.map.delete(k); }
}

// Mock Memento
class MockMemento {
  constructor() {
    this.map = new Map();
  }
  get(k) { return this.map.get(k); }
  async update(k, v) { this.map.set(k, v); }
}

// Global Mock for 'vscode'
const registeredCommands = new Map();
const registeredViews = new Map();

const mockVscode = {
  window: {
    showInformationMessage: () => Promise.resolve(),
    showErrorMessage: () => Promise.resolve(),
    showQuickPick: (items) => Promise.resolve(items[0]),
    showInputBox: () => Promise.resolve('mock-input'),
    registerWebviewViewProvider: (id, p) => registeredViews.set(id, p)
  },
  commands: {
    registerCommand: (id, fn) => registeredCommands.set(id, fn),
    executeCommand: (id) => Promise.resolve()
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

(async () => {
  const { SecretManager } = require('../src/security/secretManager');
  const { ModelDiscovery } = require('../src/providers/modelDiscovery');
  const { ProviderFactory } = require('../src/providers/providerFactory');
  const { LimitTracker, ErrorCategory } = require('../src/usage/limitTracker');
  const { UsageTracker } = require('../src/usage/usageTracker');
  const { ChatController } = require('../src/chat/chatController');
  const { ChatProvider } = require('../src/ui/chatProvider');
  const { PROVIDERS } = require('../src/config/providers');
  const { getDefaultModels } = require('../src/config/modelRegistry');

  // TEST 1: SecretManager
  await itAsync('SecretManager securely stores, retrieves, masks, and deletes API keys', async () => {
    const mockStorage = new MockSecretStorage();
    const sm = new SecretManager(mockStorage);

    assert.strictEqual(await sm.hasApiKey('gemini'), false);
    await sm.storeApiKey('gemini', 'AIzaSyTestGeminiKey123456');

    assert.strictEqual(await sm.hasApiKey('gemini'), true);
    assert.strictEqual(await sm.getApiKey('gemini'), 'AIzaSyTestGeminiKey123456');

    const masked = await sm.getMaskedKey('gemini');
    assert.ok(masked.startsWith('AIz...'), `Masked key unexpected: ${masked}`);
    assert.ok(!masked.includes('TestGeminiKey'), 'Masked key must not expose raw key');

    await sm.deleteApiKey('gemini');
    assert.strictEqual(await sm.hasApiKey('gemini'), false);
    assert.strictEqual(await sm.getApiKey('gemini'), null);
  });

  // TEST 2: ModelRegistry Fallback
  it('ModelRegistry provides verified fallback models for all 4 providers', () => {
    const providers = [PROVIDERS.GEMINI, PROVIDERS.GROQ, PROVIDERS.OPENROUTER, PROVIDERS.OLLAMA];
    providers.forEach(p => {
      const models = getDefaultModels(p);
      assert.ok(Array.isArray(models), `Expected array for ${p}`);
      assert.ok(models.length > 0, `Expected at least 1 default model for ${p}`);
      assert.ok(models[0].id, `Model missing ID for ${p}`);
    });
  });

  // TEST 3: ProviderFactory
  it('ProviderFactory instantiates the correct provider classes', () => {
    const gemini = ProviderFactory.create('gemini', { apiKey: 'key1' });
    const groq = ProviderFactory.create('groq', { apiKey: 'key2' });
    const openrouter = ProviderFactory.create('openrouter', { apiKey: 'key3' });
    const ollama = ProviderFactory.create('ollama', { endpoint: 'http://localhost:11434' });

    assert.strictEqual(gemini.providerId, 'gemini');
    assert.strictEqual(groq.providerId, 'groq');
    assert.strictEqual(openrouter.providerId, 'openrouter');
    assert.strictEqual(ollama.providerId, 'ollama');

    assert.throws(() => ProviderFactory.create('unknown-provider'), /Unsupported AI provider/);
  });

  // TEST 4: LimitTracker Error Classification
  it('LimitTracker accurately classifies rate limits, quotas, auth errors, and timeouts', () => {
    const lt = new LimitTracker();

    // Rate limit 429
    const err429 = { status: 429, message: 'Too Many Requests' };
    const class429 = lt.classifyError(err429, { 'retry-after': '45' });
    assert.strictEqual(class429.category, ErrorCategory.RATE_LIMIT);
    assert.strictEqual(class429.retryAfterSeconds, 45);

    // Quota exhausted
    const errQuota = { status: 429, message: 'Resource has been exhausted (quota exceeded)' };
    const classQuota = lt.classifyError(errQuota);
    assert.strictEqual(classQuota.category, ErrorCategory.QUOTA_EXHAUSTED);

    // Auth 401
    const errAuth = { status: 401, message: 'API key not valid' };
    const classAuth = lt.classifyError(errAuth);
    assert.strictEqual(classAuth.category, ErrorCategory.INVALID_API_KEY);

    // Timeout
    const errTimeout = { name: 'AbortError', message: 'The user aborted a request.' };
    const classTimeout = lt.classifyError(errTimeout);
    assert.strictEqual(classTimeout.category, ErrorCategory.TIMEOUT);

    // Network error
    const errNet = { message: 'fetch failed: ECONNREFUSED 127.0.0.1:11434' };
    const classNet = lt.classifyError(errNet);
    assert.strictEqual(classNet.category, ErrorCategory.NETWORK_ERROR);
  });

  // TEST 5: LimitTracker Cooldown Management
  it('LimitTracker handles cooldown expiration and status checks', () => {
    const lt = new LimitTracker();
    assert.strictEqual(lt.isCoolingDown('gemini'), false);

    lt.setCooldown('gemini', 10, 'Rate limit triggered');
    assert.strictEqual(lt.isCoolingDown('gemini'), true);

    const info = lt.getCooldownInfo('gemini');
    assert.strictEqual(info.active, true);
    assert.ok(info.remainingSeconds <= 10 && info.remainingSeconds > 0);

    lt.clearCooldown('gemini');
    assert.strictEqual(lt.isCoolingDown('gemini'), false);
  });

  // TEST 6: UsageTracker & UsageStorage Metrics
  await itAsync('UsageTracker records requests, reported/estimated tokens, and failures', async () => {
    const mockMemento = new MockMemento();
    const tracker = new UsageTracker(mockMemento);

    // Record request start
    await tracker.recordRequestStart('groq', 'llama-3.3-70b-versatile');

    // Record success with reported tokens
    await tracker.recordSuccess('groq', 'llama-3.3-70b-versatile', {
      promptTokens: 25,
      completionTokens: 40,
      totalTokens: 65,
      isEstimated: false
    });

    // Record request start + estimated tokens
    await tracker.recordRequestStart('groq', 'llama-3.3-70b-versatile');
    await tracker.recordSuccess('groq', 'llama-3.3-70b-versatile', {
      promptTokens: 10,
      completionTokens: 15,
      totalTokens: 25,
      isEstimated: true
    });

    const data = tracker.getDashboardData('groq', 'llama-3.3-70b-versatile');
    assert.strictEqual(data.providerStats.totalRequests, 2);
    assert.strictEqual(data.providerStats.successfulRequests, 2);
    assert.strictEqual(data.providerStats.tokens.total, 90);
    assert.strictEqual(data.providerStats.tokens.reported, 65);
    assert.strictEqual(data.providerStats.tokens.estimated, 25);

    // Record failure (429)
    await tracker.recordRequestStart('groq', 'llama-3.3-70b-versatile');
    await tracker.recordFailure('groq', 'llama-3.3-70b-versatile', { status: 429, message: 'Rate limit' });

    const failedData = tracker.getDashboardData('groq', 'llama-3.3-70b-versatile');
    assert.strictEqual(failedData.providerStats.failedRequests, 1);
    assert.strictEqual(failedData.providerStats.rateLimitErrors, 1);
    assert.strictEqual(failedData.cooldown.active, true);
  });

  // TEST 7: ChatController Integration (with Mock Provider)
  await itAsync('ChatController enforces keys, sends chat messages, and updates history', async () => {
    const sm = new SecretManager(new MockSecretStorage());
    const ut = new UsageTracker(new MockMemento());
    const controller = new ChatController({
      secretManager: sm,
      usageTracker: ut,
      initialProvider: 'gemini'
    });

    // Attempting to send message without API key throws clear instruction
    let keyError = null;
    try {
      await controller.sendMessage('Hello AI');
    } catch (err) {
      keyError = err;
    }
    assert.ok(keyError, 'Should throw when API key is missing');
    assert.ok(keyError.message.includes('API key'), 'Error should mention API key');

    // Mock Gemini Provider response
    const origCreate = ProviderFactory.create;
    ProviderFactory.create = (providerId, options) => {
      return {
        complete: async () => ({
          text: 'Hello! I am FreeCode AI ready to help you code.',
          usage: { promptTokens: 12, completionTokens: 15, totalTokens: 27, isEstimated: false }
        })
      };
    };

    await sm.storeApiKey('gemini', 'valid-mock-key');
    const result = await controller.sendMessage('Hello AI');

    assert.ok(result.userMessage);
    assert.strictEqual(result.userMessage.content, 'Hello AI');
    assert.ok(result.assistantMessage);
    assert.ok(result.assistantMessage.content.includes('FreeCode AI'));

    const messages = controller.getMessages();
    assert.strictEqual(messages.length, 2);

    // Test newChat
    controller.newChat();
    assert.strictEqual(controller.getMessages().length, 0);

    // Restore factory
    ProviderFactory.create = origCreate;
  });

  // TEST 8: ChatProvider Webview Message Communication
  await itAsync('ChatProvider handles webview incoming messages and sends corresponding replies', async () => {
    const sm = new SecretManager(new MockSecretStorage());
    const ut = new UsageTracker(new MockMemento());
    const controller = new ChatController({
      secretManager: sm,
      usageTracker: ut,
      initialProvider: 'gemini'
    });

    const extensionUri = { fsPath: path.resolve(__dirname, '..') };
    const chatProvider = new ChatProvider({
      extensionUri,
      chatController: controller,
      secretManager: sm,
      usageTracker: ut
    });

    const sentMessages = [];
    let receivedListener = null;

    const mockWebviewView = {
      webview: {
        options: {},
        set html(val) {},
        asWebviewUri: (uri) => uri.toString(),
        postMessage: (m) => sentMessages.push(m),
        onDidReceiveMessage: (fn) => { receivedListener = fn; }
      }
    };

    chatProvider.attachWebview(mockWebviewView);

    // 1. webviewReady
    await receivedListener({ command: 'webviewReady' });
    const initMsg = sentMessages.find(m => m.type === 'init');
    assert.ok(initMsg, 'Should send init message');
    assert.strictEqual(initMsg.state.provider, 'gemini');

    // 2. saveApiKey
    await receivedListener({ command: 'saveApiKey', provider: 'groq', apiKey: 'gsk_test123' });
    assert.strictEqual(await sm.getApiKey('groq'), 'gsk_test123');

    // 3. selectModel
    await receivedListener({ command: 'selectModel', model: 'gemini-1.5-pro' });
    assert.strictEqual(controller.activeModel, 'gemini-1.5-pro');

    // 4. getDashboardData
    sentMessages.length = 0;
    await receivedListener({ command: 'getDashboardData', provider: 'current' });
    const dashMsg = sentMessages.find(m => m.type === 'dashboardData');
    assert.ok(dashMsg, 'Should send dashboard data');
  });

  // TEST 9: Full Extension Activation & Commands Registration
  await itAsync('Extension activates and registers all Day 1 and Upgrade commands', async () => {
    const extension = require('../src/extension.js');
    const mockContext = {
      subscriptions: [],
      extensionUri: { fsPath: path.resolve(__dirname, '..') },
      secrets: new MockSecretStorage(),
      globalState: new MockMemento()
    };

    extension.activate(mockContext);

    const requiredCommands = [
      'freecodeAI.openSidebar',
      'freecodeAI.selectProvider',
      'freecodeAI.showStatus',
      'freecodeAI.setApiKey',
      'freecodeAI.newChat',
      'freecodeAI.openDashboard'
    ];

    requiredCommands.forEach(cmd => {
      assert.ok(registeredCommands.has(cmd), `Command ${cmd} was not registered`);
    });

    assert.ok(registeredViews.has('freecodeAI.sidebar'), 'Sidebar view provider was not registered');
  });

  console.log('\n====================================================');
  console.log(`TOTAL UPGRADE TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
})();
