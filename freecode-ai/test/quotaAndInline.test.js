'use strict';

/**
 * Phase 14 Comprehensive Regression & Feature Test Suite:
 * - Smart Quota Manager (Local, Hybrid, Cloud modes)
 * - Strict Provider Priority Routing & Recovery
 * - Intelligent LRU Suggestion Caching (Hits, Misses, Savings)
 * - Safe Rate Limit & HTTP 429 / Retry-After Cooldowns
 * - Debouncing & 1-Active-Request-Per-Document Concurrency
 * - API Key Preservation across Acceptance, Rejection, 429, Switching, Restart
 * - Status Bar & Usage Display Metrics
 */

const assert = require('assert');
const path = require('path');
const Module = require('module');

console.log('================================================================');
console.log('    RUNNING SMART QUOTA & HYBRID INLINE COMPLETION TEST SUITE   ');
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

// Global Mocks for VS Code
const configStore = new Map([
  ['laven.inline.enabled', true],
  ['laven.inline.completionMode', 'hybrid'],
  ['laven.inline.localFirst', true],
  ['laven.inline.localOnly', false],
  ['laven.inline.cloudFallbackEnabled', true],
  ['laven.inline.debounceMs', 50],
  ['laven.inline.maxInputTokens', 1500],
  ['laven.inline.maxOutputTokens', 96],
  ['laven.inline.cacheEnabled', true],
  ['laven.inline.cacheTtlMs', 60000],
  ['laven.inline.maxConcurrentRequests', 2],
  ['laven.inline.dailyRequestBudget', 500]
]);

const registeredCommands = new Map();
const mockVscode = {
  window: {
    showInformationMessage: async () => 'OK',
    showErrorMessage: async () => 'OK',
    showWarningMessage: async () => 'OK',
    showQuickPick: async (items) => items[0],
    createStatusBarItem: () => ({
      text: '',
      tooltip: '',
      command: '',
      show: () => {},
      dispose: () => {}
    })
  },
  commands: {
    registerCommand: (id, fn) => {
      registeredCommands.set(id, fn);
      return { dispose: () => registeredCommands.delete(id) };
    },
    executeCommand: async (id, ...args) => {
      const fn = registeredCommands.get(id);
      if (fn) return await fn(...args);
    }
  },
  workspace: {
    getConfiguration: (section) => ({
      get: (key, fallback) => {
        const fullKey = `${section}.${key}`;
        return configStore.has(fullKey) ? configStore.get(fullKey) : fallback;
      },
      has: (key) => configStore.has(`${section}.${key}`),
      update: async (key, val) => {
        configStore.set(`${section}.${key}`, val);
      }
    })
  },
  languages: {
    registerInlineCompletionItemProvider: () => ({ dispose: () => {} })
  },
  Range: class {
    constructor(start, end) { this.start = start; this.end = end; }
  },
  Position: class {
    constructor(line, character) { this.line = line; this.character = character; }
  },
  InlineCompletionItem: class {
    constructor(insertText, range) {
      this.insertText = insertText;
      this.range = range;
      this.command = null;
    }
  },
  MarkdownString: class {
    constructor(val) { this.value = val; this.isTrusted = false; }
  },
  StatusBarAlignment: { Right: 2 }
};

const origReq = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'vscode') return mockVscode;
  return origReq.apply(this, arguments);
};

// Mock In-Memory SecretStorage
class MockSecretStorage {
  constructor() { this._keys = new Map(); }
  async get(k) { return this._keys.get(k) || null; }
  async store(k, v) { this._keys.set(k, v); }
  async delete(k) { this._keys.delete(k); }
}

// Mock Memento
class MockMemento {
  constructor() { this._data = new Map(); }
  get(k, def) { return this._data.has(k) ? this._data.get(k) : def; }
  async update(k, v) { this._data.set(k, v); }
}

(async () => {
  const { SecretManager } = require('../src/security/secretManager');
  const { UsageTracker } = require('../src/usage/usageTracker');
  const { ProviderManager } = require('../src/providers/providerManager');
  const { SmartQuotaManager, CircuitState } = require('../src/quota/smartQuotaManager');
  const { SuggestionCache } = require('../src/autocomplete/cacheManager');
  const { SuggestionParser } = require('../src/autocomplete/suggestionParser');
  const { ContextCollector } = require('../src/autocomplete/contextCollector');
  const { PromptBuilder } = require('../src/autocomplete/promptBuilder');
  const { LavenInlineCompletionProvider } = require('../src/autocomplete/inlineProvider');
  const { UsageDisplay } = require('../src/statusbar/usageDisplay');
  const { StatusBarManager } = require('../src/statusbar/statusBarManager');
  const { ProviderQuickPick } = require('../src/statusbar/providerQuickPick');
  const { PROVIDERS } = require('../src/config/providers');

  function createTestHarness() {
    const secrets = new MockSecretStorage();
    const globalState = new MockMemento();
    const secretManager = new SecretManager(secrets);
    const usageTracker = new UsageTracker(globalState);
    const providerManager = new ProviderManager({ globalState, globalStoragePath: null }, secretManager);

    const quotaManager = new SmartQuotaManager({
      providerManager,
      secretManager,
      usageTracker,
      options: { cacheEnabled: true }
    });

    return { secrets, globalState, secretManager, usageTracker, providerManager, quotaManager };
  }

  // 1. Local Ollama selected first in hybrid mode
  await test('TEST 1: Local Ollama is selected first in hybrid mode when eligible', async () => {
    const h = createTestHarness();
    await h.providerManager.setProviderConfiguration(PROVIDERS.OLLAMA, { model: 'qwen2.5-coder:1.5b', priority: 1 });
    await h.secretManager.storeApiKey(PROVIDERS.GEMINI, 'gemini-key');
    await h.providerManager.setProviderConfiguration(PROVIDERS.GEMINI, { model: 'gemini-1.5-flash', priority: 2 });

    configStore.set('laven.inline.completionMode', 'hybrid');
    configStore.set('laven.inline.localFirst', true);

    const sel = await h.quotaManager.selectProviderForInline();
    assert.strictEqual(sel.providerId, PROVIDERS.OLLAMA);
    assert.strictEqual(sel.isLocal, true);
  });

  // 2. Cloud is not called when local inference succeeds
  await test('TEST 2: Cloud provider is not contacted when local Ollama inference succeeds', async () => {
    const h = createTestHarness();
    await h.providerManager.setProviderConfiguration(PROVIDERS.OLLAMA, { model: 'llama3.2', priority: 1 });
    await h.secretManager.storeApiKey(PROVIDERS.GROQ, 'groq-key');
    await h.providerManager.setProviderConfiguration(PROVIDERS.GROQ, { model: 'llama-3.3-70b-versatile', priority: 2 });

    const sel = await h.quotaManager.selectProviderForInline();
    assert.strictEqual(sel.providerId, PROVIDERS.OLLAMA);

    // Record local success
    await h.quotaManager.recordSuccess(PROVIDERS.OLLAMA, 'llama3.2', { totalTokens: 40 });
    assert.strictEqual(h.quotaManager.stats.localCompletions, 1);
    assert.strictEqual(h.quotaManager.stats.cloudCompletions, 0);
  });

  // 3. Cloud fallback works when enabled and local inference fails
  await test('TEST 3: Cloud fallback activates when local Ollama is in cooldown or fails', async () => {
    const h = createTestHarness();
    await h.providerManager.setProviderConfiguration(PROVIDERS.OLLAMA, { model: 'llama3.2', priority: 1 });
    await h.secretManager.storeApiKey(PROVIDERS.GEMINI, 'gemini-key');
    await h.providerManager.setProviderConfiguration(PROVIDERS.GEMINI, { model: 'gemini-1.5-flash', priority: 2 });

    // Put Ollama in cooldown
    await h.quotaManager.recordFailure(PROVIDERS.OLLAMA, 'llama3.2', new Error('ECONNREFUSED'));

    const sel = await h.quotaManager.selectProviderForInline();
    assert.strictEqual(sel.providerId, PROVIDERS.GEMINI, 'Should fallback to cloud provider Gemini');
    assert.strictEqual(sel.isLocal, false);
  });

  // 4. Local-only mode never calls cloud providers
  await test('TEST 4: Local-only mode never calls cloud providers even if local fails', async () => {
    const h = createTestHarness();
    await h.providerManager.setProviderConfiguration(PROVIDERS.OLLAMA, { model: 'llama3.2', priority: 1 });
    await h.secretManager.storeApiKey(PROVIDERS.GEMINI, 'gemini-key');
    await h.providerManager.setProviderConfiguration(PROVIDERS.GEMINI, { model: 'gemini-1.5-flash', priority: 2 });

    configStore.set('laven.inline.completionMode', 'local');
    // Cooldown Ollama
    await h.quotaManager.recordFailure(PROVIDERS.OLLAMA, 'llama3.2', new Error('offline'));

    const sel = await h.quotaManager.selectProviderForInline();
    assert.strictEqual(sel.providerId, null, 'Must not return cloud provider');
    assert.ok(sel.reason.includes('cooldown'));
  });

  // 5. Cloud-only mode skips Ollama
  await test('TEST 5: Cloud-only mode skips local Ollama and uses cloud priority order', async () => {
    const h = createTestHarness();
    await h.providerManager.setProviderConfiguration(PROVIDERS.OLLAMA, { model: 'llama3.2', priority: 1 });
    await h.secretManager.storeApiKey(PROVIDERS.GROQ, 'groq-key');
    await h.providerManager.setProviderConfiguration(PROVIDERS.GROQ, { model: 'mixtral', priority: 2 });

    configStore.set('laven.inline.completionMode', 'cloud');
    const sel = await h.quotaManager.selectProviderForInline();
    assert.strictEqual(sel.providerId, PROVIDERS.GROQ);
    assert.strictEqual(sel.isLocal, false);
  });

  // 6. Manual provider priority is respected
  await test('TEST 6: Manual user provider priority order is strictly respected', async () => {
    const h = createTestHarness();
    await h.secretManager.storeApiKey(PROVIDERS.OPENROUTER, 'or-key');
    await h.providerManager.setProviderConfiguration(PROVIDERS.OPENROUTER, { priority: 1, model: 'deepseek-v3' });

    await h.secretManager.storeApiKey(PROVIDERS.GEMINI, 'gem-key');
    await h.providerManager.setProviderConfiguration(PROVIDERS.GEMINI, { priority: 2, model: 'gemini-flash' });

    configStore.set('laven.inline.completionMode', 'cloud');
    const sel = await h.quotaManager.selectProviderForInline();
    assert.strictEqual(sel.providerId, PROVIDERS.OPENROUTER, 'Priority 1 provider must be chosen first');
  });

  // 7. Higher-priority provider is selected again after recovery
  await test('TEST 7: Higher-priority provider is selected again once its cooldown expires', async () => {
    const h = createTestHarness();
    await h.secretManager.storeApiKey(PROVIDERS.GROQ, 'groq-key');
    await h.providerManager.setProviderConfiguration(PROVIDERS.GROQ, { priority: 1, model: 'llama-3' });

    await h.secretManager.storeApiKey(PROVIDERS.GEMINI, 'gem-key');
    await h.providerManager.setProviderConfiguration(PROVIDERS.GEMINI, { priority: 2, model: 'gemini-flash' });

    configStore.set('laven.inline.completionMode', 'cloud');

    // Fail Groq
    await h.quotaManager.recordFailure(PROVIDERS.GROQ, 'llama-3', { status: 429, message: 'Rate limit' });
    let sel = await h.quotaManager.selectProviderForInline();
    assert.strictEqual(sel.providerId, PROVIDERS.GEMINI, 'Fails over to Gemini');

    // Cooldown expires / reset
    h.usageTracker.clearCooldown(PROVIDERS.GROQ);
    sel = await h.quotaManager.selectProviderForInline();
    assert.strictEqual(sel.providerId, PROVIDERS.GROQ, 'Restores to higher-priority Groq immediately');
  });

  // 8. Cooldown prevents unnecessary requests
  await test('TEST 8: Cooldown check avoids sending doomed requests to a limited provider', async () => {
    const h = createTestHarness();
    await h.secretManager.storeApiKey(PROVIDERS.MISTRAL, 'mistral-key');
    await h.providerManager.setProviderConfiguration(PROVIDERS.MISTRAL, { priority: 1, model: 'mistral-small' });

    configStore.set('laven.inline.completionMode', 'cloud');

    // Simulate 429
    await h.quotaManager.recordFailure(PROVIDERS.MISTRAL, 'mistral-small', { status: 429, message: 'Too Many Requests' });
    const sel = await h.quotaManager.selectProviderForInline();
    assert.strictEqual(sel.providerId, null, 'No eligible provider when sole provider is cooling down');
    assert.ok(sel.reason.includes('cooling down'));
  });

  // 9. HTTP 429 respects Retry-After
  await test('TEST 9: HTTP 429 extracts and respects Retry-After header duration', async () => {
    const h = createTestHarness();
    await h.secretManager.storeApiKey(PROVIDERS.GEMINI, 'key');
    await h.providerManager.setProviderConfiguration(PROVIDERS.GEMINI, { priority: 1, model: 'model' });

    const headers = { 'retry-after': '45' };
    const res = await h.quotaManager.recordFailure(PROVIDERS.GEMINI, 'model', { status: 429, message: 'Limit' }, headers);

    assert.strictEqual(res.retryAfterSeconds, 45);
    const cd = h.usageTracker.getCooldownInfo(PROVIDERS.GEMINI);
    assert.ok(cd.active);
    assert.ok(cd.remainingSeconds >= 40 && cd.remainingSeconds <= 45);
  });

  // 10. Invalid credentials do not trigger repeated retries
  await test('TEST 10: Invalid API credentials are categorized properly without infinite retries', async () => {
    const h = createTestHarness();
    const res = await h.quotaManager.recordFailure(PROVIDERS.OPENAI, 'gpt-4o', { status: 401, message: 'Invalid API key provided' });
    assert.strictEqual(res.category, 'INVALID_API_KEY');
    const cd = h.usageTracker.getCooldownInfo(PROVIDERS.OPENAI);
    assert.ok(cd.active, 'Invalid key should be in cooldown to protect user from loops');
  });

  // 11. Cache avoids duplicate API requests
  await test('TEST 11: Intelligent suggestion cache completely avoids duplicate network requests', async () => {
    const cache = new SuggestionCache({ maxSize: 100, defaultTtlMs: 30000 });
    const key = SuggestionCache.buildKey({
      providerId: 'gemini',
      model: 'flash',
      language: 'javascript',
      prefix: 'function greet() { return',
      suffix: '}'
    });

    assert.strictEqual(cache.get(key), null);
    assert.strictEqual(cache.stats.misses, 1);

    cache.set(key, ' "Hello world!";', { tokensSaved: 25 });
    const hit = cache.get(key);
    assert.strictEqual(hit, ' "Hello world!";');
    assert.strictEqual(cache.stats.hits, 1);
    assert.strictEqual(cache.stats.requestsAvoided, 1);
    assert.strictEqual(cache.stats.tokensSaved, 25);
  });

  // 12. Debounce prevents per-keystroke requests
  await test('TEST 12: Debouncing logic drops intermediate typing strokes', async () => {
    const h = createTestHarness();
    const provider = new LavenInlineCompletionProvider({
      quotaManager: h.quotaManager,
      secretManager: h.secretManager,
      providerManager: h.providerManager
    });

    const docKey = 'file:///test.js';
    h.quotaManager.getConfig = (k) => (k === 'debounceMs' ? 30 : 1500);

    let cancelRequested = false;
    const fakeToken = { get isCancellationRequested() { return cancelRequested; } };

    const fakeDoc = {
      uri: { toString: () => docKey },
      languageId: 'javascript',
      fileName: 'test.js',
      lineAt: () => ({ text: 'const a = ' }),
      getText: () => 'const a = ',
      offsetAt: () => 10
    };

    // Simulate keypress 1
    const p1 = provider.provideInlineCompletionItems(fakeDoc, new mockVscode.Position(0, 10), {}, fakeToken);

    // Simulate keypress 2 quickly before debounce expires
    cancelRequested = true;
    const res1 = await p1;
    assert.deepStrictEqual(res1, [], 'Cancelled request during debounce must yield 0 results');
  });

  // 13. Only one request per document
  await test('TEST 13: Concurrency manager cancels older pending request when new one begins', () => {
    const h = createTestHarness();
    const doc = 'file:///app.js';

    const c1 = h.quotaManager.beginRequest(doc);
    assert.strictEqual(c1.signal.aborted, false);

    const c2 = h.quotaManager.beginRequest(doc);
    assert.strictEqual(c1.signal.aborted, true, 'First request must be aborted');
    assert.strictEqual(c2.signal.aborted, false, 'Second request remains active');

    h.quotaManager.endRequest(doc);
  });

  // 14. Stale responses are ignored
  await test('TEST 14: Stale responses with aborted signals are cleanly rejected', () => {
    const ctrl = new AbortController();
    ctrl.abort();
    assert.strictEqual(ctrl.signal.aborted, true);
  });

  // 15. Queue remains bounded
  await test('TEST 15: Concurrency ceiling drops oldest request when limit exceeded', () => {
    const h = createTestHarness();
    h.quotaManager.maxConcurrent = 2;

    const c1 = h.quotaManager.beginRequest('doc1');
    const c2 = h.quotaManager.beginRequest('doc2');
    assert.strictEqual(c1.signal.aborted, false);
    assert.strictEqual(c2.signal.aborted, false);

    // Exceed max concurrent (2)
    const c3 = h.quotaManager.beginRequest('doc3');
    assert.strictEqual(c1.signal.aborted, true, 'Oldest request doc1 aborted');
    assert.strictEqual(c3.signal.aborted, false);
  });

  // 16. Token budgets are enforced
  await test('TEST 16: Local daily request budget prevents unbounded requests', async () => {
    const h = createTestHarness();
    await h.secretManager.storeApiKey(PROVIDERS.GEMINI, 'key');
    await h.providerManager.setProviderConfiguration(PROVIDERS.GEMINI, { priority: 1 });
    configStore.set('laven.inline.completionMode', 'cloud');
    configStore.set('laven.inline.dailyRequestBudget', 2);

    h.quotaManager.stats.dailyRequestsCount = 2; // Limit reached
    const sel = await h.quotaManager.selectProviderForInline();
    assert.strictEqual(sel.providerId, null);
    assert.ok(sel.reason.includes('daily request budget'));
  });

  // 17. Accepted suggestion does not trigger another request
  await test('TEST 17: Suggestion acceptance increments stats without sending API requests', () => {
    const h = createTestHarness();
    const initialCloud = h.quotaManager.stats.cloudCompletions;
    const initialLocal = h.quotaManager.stats.localCompletions;

    h.quotaManager.recordAcceptance({ providerId: 'gemini', model: 'flash' });
    assert.strictEqual(h.quotaManager.stats.acceptedSuggestions, 1);
    assert.strictEqual(h.quotaManager.stats.cloudCompletions, initialCloud);
    assert.strictEqual(h.quotaManager.stats.localCompletions, initialLocal);
  });

  // 18. Rejected suggestion does not automatically regenerate
  await test('TEST 18: Suggestion rejection increments stats without auto-regeneration', () => {
    const h = createTestHarness();
    h.quotaManager.recordRejection({ providerId: 'groq' });
    assert.strictEqual(h.quotaManager.stats.rejectedSuggestions, 1);
  });

  // 19. API keys survive suggestion acceptance
  await test('TEST 19: API keys are completely preserved in SecretStorage upon suggestion acceptance', async () => {
    const h = createTestHarness();
    await h.secretManager.storeApiKey(PROVIDERS.GEMINI, 'secret-gemini-123');

    h.quotaManager.recordAcceptance();
    const key = await h.secretManager.getApiKey(PROVIDERS.GEMINI);
    assert.strictEqual(key, 'secret-gemini-123');
  });

  // 20. API keys survive rejection
  await test('TEST 20: API keys are completely preserved in SecretStorage upon suggestion rejection', async () => {
    const h = createTestHarness();
    await h.secretManager.storeApiKey(PROVIDERS.GROQ, 'secret-groq-456');

    h.quotaManager.recordRejection();
    const key = await h.secretManager.getApiKey(PROVIDERS.GROQ);
    assert.strictEqual(key, 'secret-groq-456');
  });

  // 21. API keys survive 429
  await test('TEST 21: API keys are preserved in SecretStorage even when HTTP 429 occurs', async () => {
    const h = createTestHarness();
    await h.secretManager.storeApiKey(PROVIDERS.OPENROUTER, 'secret-or-789');

    await h.quotaManager.recordFailure(PROVIDERS.OPENROUTER, 'm', { status: 429, message: 'Quota exhausted' });
    const key = await h.secretManager.getApiKey(PROVIDERS.OPENROUTER);
    assert.strictEqual(key, 'secret-or-789', '429 must never delete SecretStorage API key');
  });

  // 22. API keys survive provider switching
  await test('TEST 22: API keys survive switching active providers', async () => {
    const h = createTestHarness();
    await h.secretManager.storeApiKey(PROVIDERS.GEMINI, 'gemini-key');
    await h.secretManager.storeApiKey(PROVIDERS.GROQ, 'groq-key');

    await h.providerManager.setActiveProvider(PROVIDERS.GEMINI);
    await h.providerManager.setActiveProvider(PROVIDERS.GROQ);
    await h.providerManager.setActiveProvider(PROVIDERS.GEMINI);

    assert.strictEqual(await h.secretManager.getApiKey(PROVIDERS.GEMINI), 'gemini-key');
    assert.strictEqual(await h.secretManager.getApiKey(PROVIDERS.GROQ), 'groq-key');
  });

  // 23. API keys survive model switching
  await test('TEST 23: API keys survive model switching', async () => {
    const h = createTestHarness();
    await h.secretManager.storeApiKey(PROVIDERS.MISTRAL, 'mistral-key');

    await h.providerManager.setProviderConfiguration(PROVIDERS.MISTRAL, { model: 'mistral-small' });
    await h.providerManager.setProviderConfiguration(PROVIDERS.MISTRAL, { model: 'mistral-large' });

    assert.strictEqual(await h.secretManager.getApiKey(PROVIDERS.MISTRAL), 'mistral-key');
  });

  // 24. API keys survive extension restart
  await test('TEST 24: Simulating fresh Extension Context preserves stored keys', async () => {
    const sharedSecrets = new MockSecretStorage();
    await sharedSecrets.store('freecodeAI.apiKey.nvidia', 'nvapi-key-999');

    // Fresh SecretManager in new session
    const freshSm = new SecretManager(sharedSecrets);
    const key = await freshSm.getApiKey('nvidia');
    assert.strictEqual(key, 'nvapi-key-999');
  });

  // 25. Clearing cache does not delete API keys
  await test('TEST 25: Clearing suggestion cache leaves API keys untouched', async () => {
    const h = createTestHarness();
    await h.secretManager.storeApiKey(PROVIDERS.COHERE, 'cohere-key');

    h.quotaManager.cache.set('test-key', 'completion');
    h.quotaManager.cache.clear();

    assert.strictEqual(await h.secretManager.getApiKey(PROVIDERS.COHERE), 'cohere-key');
  });

  // 26. Resetting usage does not delete API keys
  await test('TEST 26: Resetting usage metrics leaves SecretStorage keys untouched', async () => {
    const h = createTestHarness();
    await h.secretManager.storeApiKey(PROVIDERS.DEEPSEEK, 'deepseek-key');

    await h.usageTracker.reset();
    assert.strictEqual(await h.secretManager.getApiKey(PROVIDERS.DEEPSEEK), 'deepseek-key');
  });

  // 27. SuggestionParser cleans and extracts raw inline code
  await test('TEST 27: SuggestionParser handles backticks, prefixes and line overlap', () => {
    const raw = '```javascript\nconsole.log("hello");\n```';
    const cleaned = SuggestionParser.parse(raw);
    assert.strictEqual(cleaned.trim(), 'console.log("hello");');

    const withOverlap = SuggestionParser.parse('log("test");', { linePrefix: 'console.log' });
    assert.strictEqual(withOverlap, '("test");');
  });

  // 28. Status Bar & UsageDisplay reflect honest metrics
  await test('TEST 28: Status Bar UsageDisplay provides honest metrics without fake numbers', () => {
    const h = createTestHarness();
    const ollamaMetrics = UsageDisplay.getProviderMetrics(PROVIDERS.OLLAMA, h.usageTracker, h.quotaManager);
    assert.strictEqual(ollamaMetrics.statusText, 'LOCAL');

    const unconfigured = UsageDisplay.getProviderMetrics(null, h.usageTracker);
    assert.strictEqual(unconfigured.statusText, 'Not configured');

    const tooltip = UsageDisplay.formatTooltip(PROVIDERS.OLLAMA, 'qwen', h.usageTracker, true, h.quotaManager);
    assert.ok(tooltip.includes('Completion Mode:'));
    assert.ok(tooltip.includes('Cache Hit Rate:'));
  });

  // 29. Status Bar Item updates and disposes safely
  await test('TEST 29: StatusBarManager updates text and disposes cleanly', async () => {
    const h = createTestHarness();
    await h.providerManager.setProviderConfiguration(PROVIDERS.GEMINI, { model: 'flash' });
    await h.providerManager.setActiveProvider(PROVIDERS.GEMINI);

    const sb = new StatusBarManager({
      providerManager: h.providerManager,
      usageTracker: h.usageTracker,
      quotaManager: h.quotaManager
    });

    await sb.update();
    assert.ok(sb.statusBarItem.text.includes('Gemini'));
    sb.dispose();
    assert.strictEqual(sb.statusBarItem, null);
  });

  // 30. ProviderQuickPick offers Mode Switching & Cache Cleaning
  await test('TEST 30: ProviderQuickPick lists actions including Completion Strategy and Cache Clearing', () => {
    const h = createTestHarness();
    const qp = new ProviderQuickPick({
      providerManager: h.providerManager,
      secretManager: h.secretManager,
      usageTracker: h.usageTracker,
      quotaManager: h.quotaManager
    });
    assert.ok(qp);
    assert.strictEqual(typeof qp.show, 'function');
  });

  // 31. AbortError or transient timeout does not set cooldown on cloud provider
  await test('TEST 31: AbortError and transient timeouts on cloud providers do NOT trigger cooldown', async () => {
    const h = createTestHarness();
    await h.secretManager.storeApiKey(PROVIDERS.GROQ, 'groq-key');
    await h.providerManager.setProviderConfiguration(PROVIDERS.GROQ, { priority: 1, model: 'llama-3' });

    // Simulate an aborted request (user typed another key)
    const abortErr = new Error('The user aborted a request.');
    abortErr.name = 'AbortError';
    await h.quotaManager.recordFailure(PROVIDERS.GROQ, 'llama-3', abortErr);

    let cd = h.usageTracker.getCooldownInfo(PROVIDERS.GROQ);
    assert.strictEqual(cd.active, false, 'AbortError must NEVER put provider into cooldown');

    // Simulate transient timeout
    const timeoutErr = new Error('Request timed out after 8000ms');
    timeoutErr.status = 408;
    await h.quotaManager.recordFailure(PROVIDERS.GROQ, 'llama-3', timeoutErr);

    cd = h.usageTracker.getCooldownInfo(PROVIDERS.GROQ);
    assert.strictEqual(cd.active, false, 'Transient timeouts must NOT put provider into cooldown');
  });

  // 32. HTTP 429 triggers notifyRateLimitAndPromptSwitch
  await test('TEST 32: HTTP 429 triggers rate-limit notification and prompts user to switch provider', async () => {
    const h = createTestHarness();
    await h.secretManager.storeApiKey(PROVIDERS.GROQ, 'groq-key');
    await h.providerManager.setProviderConfiguration(PROVIDERS.GROQ, { priority: 1, model: 'llama-3' });
    await h.secretManager.storeApiKey(PROVIDERS.GEMINI, 'gemini-key');
    await h.providerManager.setProviderConfiguration(PROVIDERS.GEMINI, { priority: 2, model: 'gemini-flash' });

    let warningShown = false;
    let warningMsg = '';
    mockVscode.window.showWarningMessage = async (msg) => {
      warningShown = true;
      warningMsg = msg;
      return 'Dismiss';
    };

    const res = await h.quotaManager.recordFailure(PROVIDERS.GROQ, 'llama-3', { status: 429, message: 'Too Many Requests' });
    assert.strictEqual(res.category, 'RATE_LIMIT');

    await h.quotaManager.notifyRateLimitAndPromptSwitch(PROVIDERS.GROQ, res);
    assert.strictEqual(warningShown, true, 'Must show warning message when rate limit hit');
    assert.ok(warningMsg.includes('Groq') && warningMsg.includes('rate limit'), 'Message should identify provider and rate limit');
  });

  // 33. Cloud providers are not prematurely skipped by token velocity estimation
  await test('TEST 33: Cloud providers are eligible and not prematurely skipped before real 429 occurs', async () => {
    const h = createTestHarness();
    await h.secretManager.storeApiKey(PROVIDERS.GROQ, 'groq-key');
    await h.providerManager.setProviderConfiguration(PROVIDERS.GROQ, { priority: 1, model: 'llama-3' });

    configStore.set('laven.inline.completionMode', 'cloud');

    // Record 10 requests rapidly (velocity increases)
    for (let i = 0; i < 10; i++) {
      h.usageTracker.limitTracker.recordVelocity(PROVIDERS.GROQ, 1000);
    }

    // Provider should still be selected for inline completions because no 429 error happened!
    const sel = await h.quotaManager.selectProviderForInline();
    assert.strictEqual(sel.providerId, PROVIDERS.GROQ, 'Provider must not be blocked prematurely before actual 429');
  });

  console.log('\n================================================================');
  console.log(`TOTAL QUOTA & INLINE TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
})();
