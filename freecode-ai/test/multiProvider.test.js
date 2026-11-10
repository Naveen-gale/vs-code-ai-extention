/**
 * FreeCode AI — Multi-LLM Provider Management Tests (Task 9)
 *
 * Verifies:
 * TEST 1: Save Gemini key. Save Groq key. Confirm both remain stored.
 * TEST 2: Save OpenRouter key. Confirm all three keys remain stored.
 * TEST 3: Switch Gemini → Groq → OpenRouter → Gemini. Confirm no key disappears.
 * TEST 4: Confirm each provider retrieves its own correct key.
 * TEST 5: Confirm each provider remembers its own model.
 * TEST 6: Restart the extension and verify all provider configurations remain available.
 * TEST 7: Remove Groq key and verify Gemini and OpenRouter remain configured.
 * TEST 8: Switch active providers and send a chat message through each provider using mocked responses.
 * TEST 9: Verify no real API key appears in Webview messages or logs.
 * TEST 10: Verify provider cards update correctly after save, switch, remove and restart.
 */

const assert = require('assert');
const path = require('path');

console.log('================================================================');
console.log('    RUNNING MULTI-PROVIDER LLM MANAGEMENT TEST SUITE (DAY 2)   ');
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
  constructor(initialData = new Map()) {
    this.map = new Map(initialData);
  }
  async store(k, v) { this.map.set(k, v); }
  async get(k) { return this.map.get(k) || null; }
  async delete(k) { this.map.delete(k); }
}

// Mock Memento (globalState)
class MockMemento {
  constructor(initialData = new Map()) {
    this.map = new Map(initialData);
  }
  get(k, defaultVal) {
    return this.map.has(k) ? this.map.get(k) : defaultVal;
  }
  async update(k, v) {
    if (v === undefined) this.map.delete(k);
    else this.map.set(k, v);
  }
}

// Mock vscode module
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

(async () => {
  const { SecretManager } = require('../src/security/secretManager');
  const { ProviderManager } = require('../src/providers/providerManager');
  const { ChatController } = require('../src/chat/chatController');
  const { ChatProvider } = require('../src/ui/chatProvider');
  const { UsageTracker } = require('../src/usage/usageTracker');
  const { ProviderFactory } = require('../src/providers/providerFactory');
  const { PROVIDERS } = require('../src/config/providers');

  // Shared persistent stores to simulate VS Code session & restart
  const sharedSecrets = new MockSecretStorage();
  const sharedGlobalState = new MockMemento();

  const secretManager = new SecretManager(sharedSecrets);
  const providerManager = new ProviderManager(sharedGlobalState, secretManager);
  const usageTracker = new UsageTracker(sharedGlobalState);

  // TEST 1: Save Gemini key. Save Groq key. Confirm both remain stored.
  await test('TEST 1: Save Gemini key and Groq key independently; both remain stored', async () => {
    await secretManager.saveApiKey('gemini', 'gemini-secret-key-1111');
    await secretManager.saveApiKey('groq', 'groq-secret-key-2222');

    assert.strictEqual(await secretManager.hasApiKey('gemini'), true);
    assert.strictEqual(await secretManager.hasApiKey('groq'), true);
    assert.strictEqual(await secretManager.getApiKey('gemini'), 'gemini-secret-key-1111');
    assert.strictEqual(await secretManager.getApiKey('groq'), 'groq-secret-key-2222');
  });

  // TEST 2: Save OpenRouter key. Confirm all three keys remain stored.
  await test('TEST 2: Save OpenRouter key; confirm Gemini, Groq, and OpenRouter remain stored', async () => {
    await secretManager.saveApiKey('openrouter', 'openrouter-secret-key-3333');

    assert.strictEqual(await secretManager.getApiKey('gemini'), 'gemini-secret-key-1111');
    assert.strictEqual(await secretManager.getApiKey('groq'), 'groq-secret-key-2222');
    assert.strictEqual(await secretManager.getApiKey('openrouter'), 'openrouter-secret-key-3333');
  });

  // TEST 3: Switch Gemini → Groq → OpenRouter → Gemini. Confirm no key disappears.
  await test('TEST 3: Switch Gemini -> Groq -> OpenRouter -> Gemini; confirm no key disappears', async () => {
    const controller = new ChatController({
      secretManager,
      usageTracker,
      providerManager,
      initialProvider: 'gemini'
    });

    await controller.setProvider('gemini');
    assert.strictEqual(controller.activeProvider, 'gemini');

    await controller.setProvider('groq');
    assert.strictEqual(controller.activeProvider, 'groq');

    await controller.setProvider('openrouter');
    assert.strictEqual(controller.activeProvider, 'openrouter');

    await controller.setProvider('gemini');
    assert.strictEqual(controller.activeProvider, 'gemini');

    // Confirm all 3 keys are still intact
    assert.strictEqual(await secretManager.getApiKey('gemini'), 'gemini-secret-key-1111');
    assert.strictEqual(await secretManager.getApiKey('groq'), 'groq-secret-key-2222');
    assert.strictEqual(await secretManager.getApiKey('openrouter'), 'openrouter-secret-key-3333');
  });

  // TEST 4: Confirm each provider retrieves its own correct key.
  await test('TEST 4: Confirm each provider retrieves its own correct key and does not cross-contaminate', async () => {
    const geminiKey = await secretManager.getApiKey('gemini');
    const groqKey = await secretManager.getApiKey('groq');
    const openrouterKey = await secretManager.getApiKey('openrouter');

    assert.strictEqual(geminiKey, 'gemini-secret-key-1111');
    assert.strictEqual(groqKey, 'groq-secret-key-2222');
    assert.strictEqual(openrouterKey, 'openrouter-secret-key-3333');
    assert.notStrictEqual(geminiKey, groqKey);
    assert.notStrictEqual(groqKey, openrouterKey);
  });

  // TEST 5: Confirm each provider remembers its own model.
  await test('TEST 5: Confirm each provider remembers its own selected model independently', async () => {
    const controller = new ChatController({
      secretManager,
      usageTracker,
      providerManager,
      initialProvider: 'gemini'
    });

    // Set Gemini model
    await controller.setProvider('gemini');
    await controller.setModel('gemini-1.5-pro');
    assert.strictEqual(controller.activeModel, 'gemini-1.5-pro');

    // Switch to Groq and set Groq model
    await controller.setProvider('groq');
    await controller.setModel('llama-3.1-8b-instant');
    assert.strictEqual(controller.activeModel, 'llama-3.1-8b-instant');

    // Switch to OpenRouter and set OpenRouter model
    await controller.setProvider('openrouter');
    await controller.setModel('deepseek/deepseek-chat');
    assert.strictEqual(controller.activeModel, 'deepseek/deepseek-chat');

    // Switch back to Gemini: must restore gemini-1.5-pro!
    await controller.setProvider('gemini');
    assert.strictEqual(controller.activeModel, 'gemini-1.5-pro');

    // Switch back to Groq: must restore llama-3.1-8b-instant!
    await controller.setProvider('groq');
    assert.strictEqual(controller.activeModel, 'llama-3.1-8b-instant');

    // Switch back to OpenRouter: must restore deepseek/deepseek-chat!
    await controller.setProvider('openrouter');
    assert.strictEqual(controller.activeModel, 'deepseek/deepseek-chat');
  });

  // TEST 6: Restart the extension and verify all provider configurations remain available.
  await test('TEST 6: Restart the extension (simulate fresh context); all configurations and keys persist', async () => {
    // New instances reading from the same SecretStorage and GlobalState
    const newSecretManager = new SecretManager(sharedSecrets);
    const newProviderManager = new ProviderManager(sharedGlobalState, newSecretManager);
    const newController = new ChatController({
      secretManager: newSecretManager,
      usageTracker: new UsageTracker(sharedGlobalState),
      providerManager: newProviderManager
    });

    assert.strictEqual(await newSecretManager.getApiKey('gemini'), 'gemini-secret-key-1111');
    assert.strictEqual(await newSecretManager.getApiKey('groq'), 'groq-secret-key-2222');
    assert.strictEqual(await newSecretManager.getApiKey('openrouter'), 'openrouter-secret-key-3333');

    const geminiCfg = await newProviderManager.getProviderConfiguration('gemini');
    const groqCfg = await newProviderManager.getProviderConfiguration('groq');
    const openrouterCfg = await newProviderManager.getProviderConfiguration('openrouter');

    assert.strictEqual(geminiCfg.model, 'gemini-1.5-pro');
    assert.strictEqual(groqCfg.model, 'llama-3.1-8b-instant');
    assert.strictEqual(openrouterCfg.model, 'deepseek/deepseek-chat');
  });

  // TEST 7: Remove Groq key and verify Gemini and OpenRouter remain configured.
  await test('TEST 7: Remove Groq key; Gemini and OpenRouter remain fully configured', async () => {
    await providerManager.removeProvider('groq');

    assert.strictEqual(await secretManager.hasApiKey('groq'), false);
    assert.strictEqual(await secretManager.getApiKey('groq'), null);

    // Gemini and OpenRouter MUST remain completely intact
    assert.strictEqual(await secretManager.hasApiKey('gemini'), true);
    assert.strictEqual(await secretManager.getApiKey('gemini'), 'gemini-secret-key-1111');
    assert.strictEqual(await secretManager.hasApiKey('openrouter'), true);
    assert.strictEqual(await secretManager.getApiKey('openrouter'), 'openrouter-secret-key-3333');
  });

  // TEST 8: Switch active providers and send a chat message through each provider using mocked responses.
  await test('TEST 8: Switch active providers and send chat messages through each provider', async () => {
    // Re-add Groq key for complete test
    await secretManager.saveApiKey('groq', 'groq-secret-key-2222');

    const controller = new ChatController({
      secretManager,
      usageTracker,
      providerManager,
      initialProvider: 'gemini'
    });

    const calls = [];
    const origCreate = ProviderFactory.create;

    ProviderFactory.create = (providerId, options) => {
      calls.push({ providerId, options });
      return {
        complete: async () => ({
          text: `Response from ${providerId} using model ${options.model}`,
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20, isEstimated: false }
        })
      };
    };

    // 1. Send via Gemini
    await controller.setProvider('gemini');
    const resGemini = await controller.sendMessage('Test Gemini message');
    assert.ok(resGemini.assistantMessage.content.includes('from gemini'));
    assert.strictEqual(calls[calls.length - 1].providerId, 'gemini');
    assert.strictEqual(calls[calls.length - 1].options.apiKey, 'gemini-secret-key-1111');

    // 2. Send via Groq
    await controller.setProvider('groq');
    const resGroq = await controller.sendMessage('Test Groq message');
    assert.ok(resGroq.assistantMessage.content.includes('from groq'));
    assert.strictEqual(calls[calls.length - 1].providerId, 'groq');
    assert.strictEqual(calls[calls.length - 1].options.apiKey, 'groq-secret-key-2222');

    // 3. Send via OpenRouter
    await controller.setProvider('openrouter');
    const resOR = await controller.sendMessage('Test OpenRouter message');
    assert.ok(resOR.assistantMessage.content.includes('from openrouter'));
    assert.strictEqual(calls[calls.length - 1].providerId, 'openrouter');
    assert.strictEqual(calls[calls.length - 1].options.apiKey, 'openrouter-secret-key-3333');

    // Restore factory
    ProviderFactory.create = origCreate;
  });

  // TEST 9: Verify no real API key appears in Webview messages or logs.
  await test('TEST 9: Verify no real API key appears in Webview messages or provider statuses', async () => {
    const rawKeys = ['gemini-secret-key-1111', 'groq-secret-key-2222', 'openrouter-secret-key-3333'];
    const statuses = await providerManager.getAllProviderStatuses();

    statuses.forEach(s => {
      rawKeys.forEach(raw => {
        assert.ok(
          !JSON.stringify(s).includes(raw),
          `Security violation: Raw API key leaked in provider status: ${raw}`
        );
      });
      // Masked key must be present for configured key-based providers
      if (s.isConfigured && s.requiresApiKey) {
        assert.ok(s.maskedKey.includes('...'), `Expected masked key format, got: ${s.maskedKey}`);
      }
    });

    // Test Webview message bridge output
    const sentWebviewMessages = [];
    const mockWebview = {
      webview: {
        options: {},
        set html(v) {},
        asWebviewUri: (u) => u.toString(),
        postMessage: (m) => sentWebviewMessages.push(m),
        onDidReceiveMessage: () => {}
      }
    };

    const chatProvider = new ChatProvider({
      extensionUri: { fsPath: path.resolve(__dirname, '..') },
      chatController: new ChatController({ secretManager, usageTracker, providerManager }),
      secretManager,
      usageTracker,
      providerManager
    });

    chatProvider.attachWebview(mockWebview);
    await chatProvider.sendProvidersList();

    const dump = JSON.stringify(sentWebviewMessages);
    rawKeys.forEach(raw => {
      assert.ok(
        !dump.includes(raw),
        `Security violation: Raw API key found in webview postMessage dump: ${raw}`
      );
    });
  });

  // TEST 10: Verify provider cards update correctly after save, switch, remove and restart.
  await test('TEST 10: Verify provider cards update correctly after save, switch, remove and restart', async () => {
    // 1. Initial statuses
    let cards = await providerManager.getAllProviderStatuses();
    const geminiCard = cards.find(c => c.id === 'gemini');
    assert.strictEqual(geminiCard.isConfigured, true);
    assert.strictEqual(geminiCard.status, 'Configured');
    assert.strictEqual(geminiCard.selectedModel, 'gemini-1.5-pro');

    // 2. Switch to OpenRouter
    await providerManager.setActiveProvider('openrouter');
    cards = await providerManager.getAllProviderStatuses();
    const orCard = cards.find(c => c.id === 'openrouter');
    assert.strictEqual(orCard.isActive, true);
    assert.strictEqual(cards.find(c => c.id === 'gemini').isActive, false);

    // 3. Remove OpenRouter
    await providerManager.removeProvider('openrouter');
    cards = await providerManager.getAllProviderStatuses();
    const removedOR = cards.find(c => c.id === 'openrouter');
    assert.strictEqual(removedOR.isConfigured, false);
    assert.strictEqual(removedOR.status, 'Not configured');

    // 4. Simulate Restart
    const restartedManager = new ProviderManager(sharedGlobalState, secretManager);
    const restartedCards = await restartedManager.getAllProviderStatuses();
    const restartedGemini = restartedCards.find(c => c.id === 'gemini');
    assert.strictEqual(restartedGemini.isConfigured, true);
    assert.strictEqual(restartedGemini.selectedModel, 'gemini-1.5-pro');
  });

  // TEST 11: When all providers are removed, no provider shows in use and active is null
  await test('TEST 11: When all providers are deleted, no provider shows "in use", active becomes null, and empty state is triggered', async () => {
    // Delete remaining gemini & groq
    await providerManager.removeProvider('gemini');
    await providerManager.removeProvider('groq');

    const configured = await providerManager.getConfiguredProviders();
    assert.strictEqual(configured.length, 0, 'No providers should be configured after deleting all');

    assert.strictEqual(providerManager.getActiveProvider(), null, 'Active provider must be null when all providers are deleted');

    const statuses = await providerManager.getAllProviderStatuses();
    statuses.forEach(s => {
      assert.strictEqual(s.isActive, false, `Provider ${s.id} should NOT be active when not configured`);
      assert.strictEqual(s.isConfigured, false, `Provider ${s.id} should not be configured`);
    });

    // ChatController state reflects no provider
    const controller = new ChatController({ secretManager, usageTracker, providerManager });
    const state = await controller.getState();
    assert.strictEqual(state.provider, null);
    assert.strictEqual(state.providerName, 'No Provider Configured');
  });

  console.log('\n================================================================');
  console.log(`TOTAL MULTI-PROVIDER TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
})();
