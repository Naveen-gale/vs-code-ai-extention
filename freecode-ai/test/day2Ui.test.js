/**
 * FreeCode AI — Day 2 UI & Header & Provider Action Tests
 *
 * Verifies:
 * 1. Initial / unconfigured state header pill: no default model displayed when unconfigured.
 * 2. Save Only action: saves credentials & model without setting active provider.
 * 3. Save & Select Model action: saves credentials & model, sets active provider.
 * 4. Usage dashboard elements & typography checks.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Global Mock for 'vscode'
const mockVscode = {
  window: {
    showInformationMessage: () => Promise.resolve(),
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

const { SecretManager } = require('../src/security/secretManager');
const { ProviderManager } = require('../src/providers/providerManager');
const { ChatController } = require('../src/chat/chatController');
const { UsageTracker } = require('../src/usage/usageTracker');
const { ChatProvider } = require('../src/ui/chatProvider');
const { PROVIDERS } = require('../src/config/providers');

console.log('================================================================');
console.log('       RUNNING DAY 2 UI & PROVIDER ACTION TEST SUITE            ');
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
    console.error(`       Error: ${err.message}`);
    failed++;
  }
}

// Mock SecretStorage
class MockSecretStorage {
  constructor() { this.map = new Map(); }
  async store(k, v) { this.map.set(k, v); }
  async get(k) { return this.map.get(k) || null; }
  async delete(k) { this.map.delete(k); }
}

// Mock Memento
class MockMemento {
  constructor() { this.map = new Map(); }
  get(k, defaultVal) { return this.map.has(k) ? this.map.get(k) : defaultVal; }
  async update(k, v) {
    if (v === undefined) this.map.delete(k);
    else this.map.set(k, v);
  }
}

(async () => {
  const htmlPath = path.resolve(__dirname, '../src/ui/webview/index.html');
  const cssPath = path.resolve(__dirname, '../src/ui/webview/style.css');
  const appJsPath = path.resolve(__dirname, '../src/ui/webview/app.js');

  const htmlContent = fs.readFileSync(htmlPath, 'utf8');
  const cssContent = fs.readFileSync(cssPath, 'utf8');
  const appJsContent = fs.readFileSync(appJsPath, 'utf8');

  // TEST 1: Header markup has no hardcoded default provider/model
  await test('TEST 1: index.html header pill does not hardcode Gemini / 1.5 Flash', () => {
    assert.ok(!htmlContent.includes('<span id="pill-provider">Gemini</span>'), 'Should not hardcode Gemini in initial markup');
    assert.ok(!htmlContent.includes('<span id="pill-model">1.5 Flash</span>'), 'Should not hardcode 1.5 Flash in initial markup');
    assert.ok(htmlContent.includes('id="active-model-pill"'), 'Must have #active-model-pill');
    assert.ok(htmlContent.includes('No Provider Configured'), 'Must default to No Provider Configured');
  });

  // TEST 2: Provider modal contains Save and Test Connection and Select this Model buttons
  await test('TEST 2: Provider modal contains Save and Test Connection and Select this Model buttons', () => {
    assert.ok(htmlContent.includes('id="modal-btn-save-test-conn"'), 'Must have #modal-btn-save-test-conn');
    assert.ok(htmlContent.includes('id="modal-btn-select-model"'), 'Must have #modal-btn-select-model');
    assert.ok(htmlContent.includes('Save and Test Connection'), 'Button text must include Save and Test Connection');
    assert.ok(htmlContent.includes('Select this Model'), 'Button text must include Select this Model');
    assert.ok(appJsContent.includes('modalBtnSaveTestConn'), 'app.js must bind modalBtnSaveTestConn');
    assert.ok(appJsContent.includes('modalBtnSelectModel'), 'app.js must bind modalBtnSelectModel');
  });

  // TEST 3: Usage UI improvements and big font styling exist
  await test('TEST 3: Usage Dashboard has big fonts and upgraded metrics cards', () => {
    assert.ok(htmlContent.includes('Usage & Performance'), 'Must have Usage & Performance title');
    assert.ok(htmlContent.includes('id="dash-total-tokens"'), 'Must have #dash-total-tokens');
    assert.ok(htmlContent.includes('token-chip prompt'), 'Must have prompt token chip');
    assert.ok(htmlContent.includes('token-chip completion'), 'Must have completion token chip');
    assert.ok(cssContent.includes('.stat-value'), 'Must style .stat-value');
    assert.ok(cssContent.includes('font-size: 26px') || cssContent.includes('font-size: 28px'), 'Must have big font for stat-value');
  });

  // TEST 4: Backend logic for "Save Only" (activate = false)
  await test('TEST 4: handleSaveApiKey with activate = false saves key without setting as active provider', async () => {
    const secrets = new MockSecretStorage();
    const globalState = new MockMemento();
    const secretManager = new SecretManager(secrets);
    const usageTracker = new UsageTracker(globalState);
    const providerManager = new ProviderManager(globalState, secretManager);
    const chatController = new ChatController({ secretManager, usageTracker, providerManager, initialProvider: null });

    const chatProvider = new ChatProvider({
      extensionUri: { fsPath: path.resolve(__dirname, '..') },
      chatController,
      secretManager,
      usageTracker,
      providerManager
    });

    const sentMessages = [];
    chatProvider.attachWebview({
      webview: {
        options: {},
        set html(v) {},
        postMessage: (m) => sentMessages.push(m),
        onDidReceiveMessage: () => {}
      }
    });

    // Save Groq key with activate: false
    await chatProvider.handleMessage({
      command: 'saveApiKey',
      provider: PROVIDERS.GROQ,
      apiKey: 'gsk-secret-key-1',
      model: 'llama-3.3-70b-versatile',
      activate: false
    });

    // Verify Groq key is stored
    assert.strictEqual(await secretManager.getApiKey(PROVIDERS.GROQ), 'gsk-secret-key-1');

    // Verify Groq model is stored
    const groqCfg = await providerManager.getProviderConfiguration(PROVIDERS.GROQ);
    assert.strictEqual(groqCfg.model, 'llama-3.3-70b-versatile');

    // Verify active provider is NOT set
    assert.strictEqual(providerManager.getActiveProvider(), null, 'Active provider should remain null when activate=false');
    assert.strictEqual(chatController.activeProvider, null, 'ChatController active provider should remain null');
  });

  // TEST 5: Backend logic for "Save & Select Model" (activate = true)
  await test('TEST 5: handleSaveApiKey with activate = true saves key and makes provider active', async () => {
    const secrets = new MockSecretStorage();
    const globalState = new MockMemento();
    const secretManager = new SecretManager(secrets);
    const usageTracker = new UsageTracker(globalState);
    const providerManager = new ProviderManager(globalState, secretManager);
    const chatController = new ChatController({ secretManager, usageTracker, providerManager, initialProvider: null });

    const chatProvider = new ChatProvider({
      extensionUri: { fsPath: path.resolve(__dirname, '..') },
      chatController,
      secretManager,
      usageTracker,
      providerManager
    });

    const sentMessages = [];
    chatProvider.attachWebview({
      webview: {
        options: {},
        set html(v) {},
        postMessage: (m) => sentMessages.push(m),
        onDidReceiveMessage: () => {}
      }
    });

    // Save Gemini key with activate: true and selected model
    await chatProvider.handleMessage({
      command: 'saveApiKey',
      provider: PROVIDERS.GEMINI,
      apiKey: 'AIzaSyTest1234567890',
      model: 'gemini-1.5-pro',
      activate: true
    });

    // Verify Gemini key is stored
    assert.strictEqual(await secretManager.getApiKey(PROVIDERS.GEMINI), 'AIzaSyTest1234567890');

    // Verify Gemini model is stored
    const geminiCfg = await providerManager.getProviderConfiguration(PROVIDERS.GEMINI);
    assert.strictEqual(geminiCfg.model, 'gemini-1.5-pro');

    // Verify active provider is set to Gemini and model to gemini-1.5-pro
    assert.strictEqual(providerManager.getActiveProvider(), PROVIDERS.GEMINI);
    assert.strictEqual(chatController.activeProvider, PROVIDERS.GEMINI);
    assert.strictEqual(chatController.activeModel, 'gemini-1.5-pro');
  });

  // TEST 6: When all providers are removed, state.provider is null and state.model is None
  await test('TEST 6: Removing all providers leaves state.provider as null and model as None', async () => {
    const secrets = new MockSecretStorage();
    const globalState = new MockMemento();
    const secretManager = new SecretManager(secrets);
    const usageTracker = new UsageTracker(globalState);
    const providerManager = new ProviderManager(globalState, secretManager);

    await secretManager.storeApiKey(PROVIDERS.GROQ, 'gsk-test');
    await providerManager.setProviderConfiguration(PROVIDERS.GROQ, { connectionState: 'configured' });
    await providerManager.setActiveProvider(PROVIDERS.GROQ);

    const chatController = new ChatController({ secretManager, usageTracker, providerManager, initialProvider: PROVIDERS.GROQ });
    const chatProvider = new ChatProvider({
      extensionUri: { fsPath: path.resolve(__dirname, '..') },
      chatController,
      secretManager,
      usageTracker,
      providerManager
    });

    const sentMessages = [];
    chatProvider.attachWebview({
      webview: {
        options: {},
        set html(v) {},
        postMessage: (m) => sentMessages.push(m),
        onDidReceiveMessage: () => {}
      }
    });

    // Remove Groq
    await chatProvider.handleMessage({ command: 'removeProvider', provider: PROVIDERS.GROQ });

    assert.strictEqual(providerManager.getActiveProvider(), null);
    assert.strictEqual(chatController.activeProvider, null);

    const state = await chatController.getState();
    assert.strictEqual(state.provider, null);
    assert.strictEqual(state.model, 'None');
    assert.strictEqual(state.providerName, 'No Provider Configured');
  });

  // TEST 7: When user has not added any provider, but globalState has stale activeProvider = 'gemini'
  await test('TEST 7: Stale unconfigured activeProvider in globalState is purged and never shown as active', async () => {
    const secrets = new MockSecretStorage(); // No keys stored!
    const globalState = new MockMemento();
    // Simulate stale active provider in globalState
    await globalState.update('freecodeAI.activeProvider', 'gemini');

    const secretManager = new SecretManager(secrets);
    const usageTracker = new UsageTracker(globalState);
    const providerManager = new ProviderManager(globalState, secretManager);

    // Initial check: raw is gemini, but validated is null because no key was added
    const validated = await providerManager.getValidatedActiveProvider();
    assert.strictEqual(validated, null, 'Validated active provider must be null when key does not exist');
    assert.strictEqual(providerManager.getActiveProvider(), null, 'Should have purged stale active provider');

    // ChatController initialized with stale initialProvider = 'gemini'
    const chatController = new ChatController({
      secretManager,
      usageTracker,
      providerManager,
      initialProvider: 'gemini'
    });

    // getState() must detect that gemini is unconfigured and return null
    const state = await chatController.getState();
    assert.strictEqual(state.provider, null, 'state.provider must be null');
    assert.strictEqual(state.model, 'None', 'state.model must be None');
    assert.strictEqual(state.providerName, 'No Provider Configured', 'state.providerName must be No Provider Configured');
    assert.strictEqual(chatController.activeProvider, null, 'controller.activeProvider must be null');
  });

  // TEST 8: saveAndTestConnection saves key and tests connection without activating provider for chat
  await test('TEST 8: saveAndTestConnection saves key without activating provider for chat', async () => {
    const secrets = new MockSecretStorage();
    const globalState = new MockMemento();
    const secretManager = new SecretManager(secrets);
    const usageTracker = new UsageTracker(globalState);
    const providerManager = new ProviderManager(globalState, secretManager);
    const chatController = new ChatController({ secretManager, usageTracker, providerManager, initialProvider: null });

    const chatProvider = new ChatProvider({
      extensionUri: { fsPath: path.resolve(__dirname, '..') },
      chatController,
      secretManager,
      usageTracker,
      providerManager
    });

    const sentMessages = [];
    chatProvider.attachWebview({
      webview: {
        options: {},
        set html(v) {},
        postMessage: (m) => sentMessages.push(m),
        onDidReceiveMessage: () => {}
      }
    });

    await chatProvider.handleMessage({
      command: 'saveAndTestConnection',
      provider: PROVIDERS.OPENROUTER,
      apiKey: 'sk-or-v1-testkey123'
    });

    // Key must be saved
    assert.strictEqual(await secretManager.getApiKey(PROVIDERS.OPENROUTER), 'sk-or-v1-testkey123');

    // Connection test message must have been sent
    const connResult = sentMessages.find(m => m.type === 'connectionResult');
    assert.ok(connResult, 'Should send connectionResult message');

    // Provider must NOT be active
    assert.strictEqual(providerManager.getActiveProvider(), null, 'Active provider must remain null');
    assert.strictEqual(chatController.activeProvider, null, 'ChatController must not be activated');
  });

  console.log('\n================================================================');
  console.log(`TOTAL DAY 2 UI TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
})();
