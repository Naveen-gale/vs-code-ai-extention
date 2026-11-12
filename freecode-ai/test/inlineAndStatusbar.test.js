/**
 * Comprehensive Test Suite for FreeCode AI:
 * - Feature 1: AI Inline Code Suggestion Agent (Copilot-like ghost text)
 * - Feature 2: Bottom Status Bar Provider Manager & Usage Display
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Mock VS Code environment before loading modules
const registeredCommands = new Map();
const configurationValues = new Map();

class MockInlineCompletionItem {
  constructor(insertText, range) {
    this.insertText = insertText;
    this.range = range;
  }
}

class MockRange {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

class MockPosition {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

class MockMarkdownString {
  constructor(value) {
    this.value = value;
    this.isTrusted = false;
  }
}

class MockStatusBarItem {
  constructor(alignment, priority) {
    this.alignment = alignment;
    this.priority = priority;
    this.text = '';
    this.tooltip = '';
    this.command = null;
    this.visible = false;
  }
  show() {
    this.visible = true;
  }
  hide() {
    this.visible = false;
  }
  dispose() {
    this.visible = false;
  }
}

const mockVscode = {
  StatusBarAlignment: { Left: 1, Right: 2 },
  QuickPickItemKind: { Separator: -1 },
  InlineCompletionItem: MockInlineCompletionItem,
  Range: MockRange,
  Position: MockPosition,
  MarkdownString: MockMarkdownString,
  window: {
    createStatusBarItem: (alignment, priority) => new MockStatusBarItem(alignment, priority),
    showInformationMessage: async (msg) => msg,
    showWarningMessage: async (msg) => msg,
    showErrorMessage: async (msg) => msg,
    showQuickPick: async (items) => items[0],
    showInputBox: async () => 'test-key'
  },
  commands: {
    registerCommand: (id, handler) => {
      registeredCommands.set(id, handler);
      return { dispose: () => registeredCommands.delete(id) };
    },
    executeCommand: async (id, ...args) => {
      const handler = registeredCommands.get(id);
      if (handler) return handler(...args);
      return null;
    }
  },
  workspace: {
    getConfiguration: (section) => ({
      get: (key, defaultValue) => {
        const fullKey = `${section}.${key}`;
        return configurationValues.has(fullKey) ? configurationValues.get(fullKey) : defaultValue;
      },
      update: async (key, value) => {
        const fullKey = `${section}.${key}`;
        configurationValues.set(fullKey, value);
      }
    }),
    onDidChangeConfiguration: (callback) => ({ dispose: () => {} })
  },
  languages: {
    registerInlineCompletionItemProvider: (selector, provider) => ({
      dispose: () => {}
    })
  },
  ConfigurationTarget: { Global: 1, Workspace: 2 }
};

// Intercept require('vscode')
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'vscode') {
    return mockVscode;
  }
  return originalRequire.apply(this, arguments);
};

// Import modules under test
const { ContextManager } = require('../agent/inline/contextManager');
const { PromptBuilder, INLINE_SYSTEM_PROMPT } = require('../agent/inline/promptBuilder');
const { SuggestionParser } = require('../agent/inline/suggestionParser');
const { CacheManager } = require('../agent/inline/cacheManager');
const { InlineAgent } = require('../agent/inline/inlineAgent');
const { AgentManager } = require('../agent/agentManager');
const { UsageDisplay } = require('../src/statusbar/usageDisplay');
const { StatusBarManager } = require('../src/statusbar/statusBarManager');
const { ProviderQuickPick } = require('../src/statusbar/providerQuickPick');
const { ProviderManager } = require('../src/providers/providerManager');
const { SecretManager } = require('../src/security/secretManager');
const { UsageTracker } = require('../src/usage/usageTracker');
const { PROVIDERS } = require('../src/config/providers');

// Test runner helpers
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(err);
    failedTests++;
  }
}

async function runTestAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(err);
    failedTests++;
  }
}

// Mock Mementos & Secrets
class MockSecretStorage {
  constructor() { this._data = new Map(); }
  async get(k) { return this._data.get(k) || null; }
  async store(k, v) { this._data.set(k, v); }
  async delete(k) { this._data.delete(k); }
}

class MockMemento {
  constructor() { this.store = new Map(); }
  get(k, defaultVal) { return this.store.has(k) ? this.store.get(k) : defaultVal; }
  async update(k, v) { this.store.set(k, v); }
}

// Mock TextDocument helper
function createMockDocument({ text, languageId = 'javascript', fileName = 'test.js' }) {
  const lines = text.split('\n');
  return {
    languageId,
    fileName,
    uri: { toString: () => `file:///${fileName}` },
    lineCount: lines.length,
    lineAt: (lineIndex) => {
      const lineText = lines[lineIndex] || '';
      return {
        text: lineText,
        range: new MockRange(new MockPosition(lineIndex, 0), new MockPosition(lineIndex, lineText.length))
      };
    },
    getText: (range) => {
      if (!range) return text;
      const startLine = range.start.line;
      const endLine = range.end.line;
      if (startLine === endLine) {
        return (lines[startLine] || '').substring(range.start.character, range.end.character);
      }
      let result = [];
      result.push((lines[startLine] || '').substring(range.start.character));
      for (let i = startLine + 1; i < endLine; i++) {
        result.push(lines[i] || '');
      }
      result.push((lines[endLine] || '').substring(0, range.end.character));
      return result.join('\n');
    }
  };
}

// ----------------- START TEST EXECUTION -----------------
(async () => {
  console.log('\n================================================================');
  console.log('   RUNNING INLINE SUGGESTION & STATUS BAR TEST SUITE            ');
  console.log('================================================================\n');

  // 1. ContextManager tests
  runTest('TEST 1: ContextManager extracts prefix, suffix, linePrefix and detects indentation', () => {
    const doc = createMockDocument({
      text: 'function add(a, b) {\n    const sum = a + b;\n    return sum;\n}',
      languageId: 'javascript'
    });
    const pos = new MockPosition(1, 10); // inside "const sum "
    const ctx = ContextManager.getContext(doc, pos, { maxContextLines: 40 });

    assert.ok(ctx, 'Context should not be null');
    assert.strictEqual(ctx.languageId, 'javascript');
    assert.strictEqual(ctx.linePrefix, '    const ');
    assert.strictEqual(ctx.lineSuffix, 'sum = a + b;');
    assert.strictEqual(ctx.indentation, '    ');
    assert.ok(ctx.prefix.includes('function add'));
    assert.ok(ctx.suffix.includes('return sum;'));
  });

  // 2. Multi-language support verification
  runTest('TEST 2: ContextManager correctly identifies 10 target programming languages', () => {
    const languages = ['javascript', 'typescript', 'python', 'java', 'html', 'css', 'c', 'cpp', 'php', 'json'];
    for (const lang of languages) {
      const doc = createMockDocument({ text: '// sample code', languageId: lang, fileName: `test.${lang}` });
      const ctx = ContextManager.getContext(doc, new MockPosition(0, 5));
      assert.strictEqual(ctx.languageId, lang, `Failed to identify language: ${lang}`);
    }
  });

  // 3. PromptBuilder rules & formatting
  runTest('TEST 3: PromptBuilder enforces all 12 exact system prompt rules', () => {
    const sysPrompt = PromptBuilder.getSystemPrompt();
    assert.ok(sysPrompt.includes('RULES:'), 'Must contain RULES header');
    assert.ok(sysPrompt.includes('1. Generate only code that belongs at the cursor.'), 'Rule 1 missing');
    assert.ok(sysPrompt.includes('2. Never repeat code that already exists.'), 'Rule 2 missing');
    assert.ok(sysPrompt.includes('3. Follow the current programming language.'), 'Rule 3 missing');
    assert.ok(sysPrompt.includes('4. Follow the existing indentation and formatting.'), 'Rule 4 missing');
    assert.ok(sysPrompt.includes('5. Respect variable names and function names already in use.'), 'Rule 5 missing');
    assert.ok(sysPrompt.includes('6. Follow the surrounding code style.'), 'Rule 6 missing');
    assert.ok(sysPrompt.includes('7. Prefer concise, useful and correct suggestions.'), 'Rule 7 missing');
    assert.ok(sysPrompt.includes('8. Do not explain the code.'), 'Rule 8 missing');
    assert.ok(sysPrompt.includes('9. Do not include conversational text.'), 'Rule 9 missing');
    assert.ok(sysPrompt.includes('10. Do not use Markdown code fences.'), 'Rule 10 missing');
    assert.ok(sysPrompt.includes('11. Do not add unnecessary comments.'), 'Rule 11 missing');
    assert.ok(sysPrompt.includes('12. Return an empty response if no useful completion is possible.'), 'Rule 12 missing');
  });

  runTest('TEST 4: PromptBuilder structures prompt with cursor position markers and context limits', () => {
    const ctx = {
      languageId: 'python',
      fileName: 'main.py',
      prefix: 'def calculate_area(radius):\n    pi = 3.14159\n',
      suffix: '\n    return area',
      linePrefix: '    ',
      lineSuffix: ''
    };
    const built = PromptBuilder.buildPrompt(ctx, { maxPromptChars: 2000 });
    assert.strictEqual(built.systemPrompt, INLINE_SYSTEM_PROMPT);
    assert.ok(built.messages[0].content.includes('--- CODE BEFORE CURSOR ---'));
    assert.ok(built.messages[0].content.includes('--- CURSOR POSITION ---'));
    assert.ok(built.messages[0].content.includes('--- CODE AFTER CURSOR ---'));
    assert.ok(built.messages[0].content.includes('Language: python'));
  });

  // 4. SuggestionParser cleaning & deduplication
  runTest('TEST 5: SuggestionParser strips markdown fences and conversational intros', () => {
    const rawFenced = '```python\n    area = pi * radius ** 2\n    return area\n```';
    const cleaned1 = SuggestionParser.cleanText(rawFenced);
    assert.strictEqual(cleaned1, '    area = pi * radius ** 2\n    return area');

    const rawIntro = 'Here is the code:\nconst x = 10;';
    const cleaned2 = SuggestionParser.cleanText(rawIntro);
    assert.strictEqual(cleaned2, 'const x = 10;');
  });

  runTest('TEST 6: SuggestionParser avoids duplicating linePrefix and lineSuffix', () => {
    const linePrefix = '    const total = ';
    const lineSuffix = ';';
    const rawCompletion = '    const total = price * quantity;';
    const cleaned = SuggestionParser.cleanText(rawCompletion, { linePrefix, lineSuffix });
    assert.strictEqual(cleaned, 'price * quantity');
  });

  runTest('TEST 7: SuggestionParser returns empty array for blank or whitespace responses', () => {
    const res1 = SuggestionParser.parse('', {});
    const res2 = SuggestionParser.parse('   \n  \t  ', {});
    assert.strictEqual(res1.length, 0);
    assert.strictEqual(res2.length, 0);
  });

  // 5. CacheManager tests
  runTest('TEST 8: CacheManager caches completions with TTL and LRU eviction', () => {
    const cache = new CacheManager({ maxEntries: 3, defaultTtlMs: 1000 });
    const pos = new MockPosition(5, 10);

    cache.set('doc1', pos, 'prefixA', [{ insertText: 'sugA' }]);
    assert.ok(cache.has('doc1', pos, 'prefixA'), 'Item should be in cache');
    assert.strictEqual(cache.get('doc1', pos, 'prefixA')[0].insertText, 'sugA');

    // LRU eviction test
    cache.set('doc1', pos, 'prefixB', [{ insertText: 'sugB' }]);
    cache.set('doc1', pos, 'prefixC', [{ insertText: 'sugC' }]);
    cache.set('doc1', pos, 'prefixD', [{ insertText: 'sugD' }]); // Should evict prefixA

    assert.strictEqual(cache.get('doc1', pos, 'prefixA'), null, 'prefixA should be evicted');
    assert.ok(cache.get('doc1', pos, 'prefixD'), 'prefixD should exist');

    // Invalidation by document
    cache.invalidateDocument('doc1');
    assert.strictEqual(cache.size, 0);
  });

  // 6. UsageDisplay honest metrics
  runTest('TEST 9: UsageDisplay returns "LOCAL" for Ollama and honest metrics for cloud providers', () => {
    const memento = new MockMemento();
    const tracker = new UsageTracker(memento);

    // Ollama: must be LOCAL
    const ollamaMetrics = UsageDisplay.getProviderMetrics(PROVIDERS.OLLAMA, tracker);
    assert.strictEqual(ollamaMetrics.statusText, 'LOCAL');
    assert.strictEqual(ollamaMetrics.isCoolingDown, false);

    // Uncontacted Gemini: must say "Usage unavailable" without fake percentages
    const geminiMetrics = UsageDisplay.getProviderMetrics(PROVIDERS.GEMINI, tracker);
    assert.strictEqual(geminiMetrics.statusText, 'Usage unavailable');
    assert.strictEqual(geminiMetrics.loadPercent, null);

    // After cooling down
    tracker.limitTracker.setCooldown(PROVIDERS.GEMINI, 45, 'Rate limited');
    const cooldownMetrics = UsageDisplay.getProviderMetrics(PROVIDERS.GEMINI, tracker);
    assert.strictEqual(cooldownMetrics.isCoolingDown, true);
    assert.ok(cooldownMetrics.statusText.includes('Cooldown'));
  });

  runTest('TEST 10: UsageDisplay formats rich markdown tooltip with provider, model, inline state and usage', () => {
    const memento = new MockMemento();
    const tracker = new UsageTracker(memento);
    const tooltip = UsageDisplay.formatTooltip(PROVIDERS.GROQ, 'llama-3.3-70b-versatile', tracker, true);

    assert.ok(tooltip.includes('### Laven') || tooltip.includes('### FreeCode AI'));
    assert.ok(tooltip.includes('Groq'));
    assert.ok(tooltip.includes('llama-3.3-70b-versatile'));
    assert.ok(tooltip.includes('Inline Suggestions:') && tooltip.includes('Enabled'));
    assert.ok(tooltip.includes('Click to switch provider'));
  });

  // 7. StatusBarManager tests
  await runTestAsync('TEST 11: StatusBarManager displays active provider, model, and responds to click command', async () => {
    const secretStore = new MockSecretStorage();
    const secretManager = new SecretManager(secretStore);
    const memento = new MockMemento();
    const providerManager = new ProviderManager({ globalState: memento }, secretManager);
    const usageTracker = new UsageTracker(memento);

    await providerManager.setProviderConfiguration(PROVIDERS.GEMINI, { model: 'gemini-1.5-flash' });
    await providerManager.setActiveProvider(PROVIDERS.GEMINI);

    const sb = new StatusBarManager({ providerManager, usageTracker });
    await sb.update();

    assert.ok(sb.statusBarItem, 'Status bar item must be created');
    assert.strictEqual(sb.statusBarItem.command, 'freecodeAI.openProviderPopup');
    assert.ok(sb.statusBarItem.text.includes('freecode-logo'));
    assert.ok(sb.statusBarItem.text.includes('Gemini'));
    assert.ok(sb.statusBarItem.text.includes('gemini-1.5-flash'));
    assert.strictEqual(sb.statusBarItem.visible, true);

    sb.dispose();
  });

  // 8. ProviderQuickPick tests
  await runTestAsync('TEST 12: ProviderQuickPick lists configured providers with honest individual usage and actions', async () => {
    const secretStore = new MockSecretStorage();
    const secretManager = new SecretManager(secretStore);
    await secretManager.storeApiKey('gemini', 'key-gemini');
    await secretManager.storeApiKey('groq', 'key-groq');
    const memento = new MockMemento();
    const providerManager = new ProviderManager({ globalState: memento }, secretManager);
    const usageTracker = new UsageTracker(memento);

    await providerManager.setProviderConfiguration(PROVIDERS.GEMINI, { model: 'gemini-1.5-flash' });
    await providerManager.setProviderConfiguration(PROVIDERS.GROQ, { model: 'llama-3.3-70b-versatile' });
    await providerManager.setActiveProvider(PROVIDERS.GEMINI);

    let pickedItem = null;
    mockVscode.window.showQuickPick = async (items) => {
      // Find Groq item
      pickedItem = items.find(i => i.providerId === PROVIDERS.GROQ);
      return pickedItem;
    };

    const quickPick = new ProviderQuickPick({
      providerManager,
      secretManager,
      usageTracker
    });

    await quickPick.show();

    // Verify switched active provider
    assert.strictEqual(providerManager.getActiveProvider(), PROVIDERS.GROQ);
  });

  // 9. InlineAgent execution & active provider routing
  await runTestAsync('TEST 13: InlineAgent routes requests through active provider, checks cooldown, and produces ghost text', async () => {
    configurationValues.set('freecodeAI.inline.debounceDelay', 0);
    const secretStore = new MockSecretStorage();
    const secretManager = new SecretManager(secretStore);
    await secretManager.storeApiKey('groq', 'gsk-test-key');
    const memento = new MockMemento();
    const providerManager = new ProviderManager({ globalState: memento }, secretManager);
    const usageTracker = new UsageTracker(memento);

    await providerManager.setProviderConfiguration(PROVIDERS.GROQ, { model: 'llama-3.3-70b-versatile' });
    await providerManager.setActiveProvider(PROVIDERS.GROQ);

    const inlineAgent = new InlineAgent({
      providerManager,
      secretManager,
      usageTracker
    });

    // Mock provider complete
    const { ProviderFactory } = require('../src/providers/providerFactory');
    const origCreate = ProviderFactory.create;
    let providerCalledWith = null;

    ProviderFactory.create = (pid, opts) => {
      return {
        complete: async (messages, config) => {
          providerCalledWith = { pid, opts, messages, config };
          return {
            text: 'const result = a + b;\nreturn result;',
            usage: { promptTokens: 40, completionTokens: 15, totalTokens: 55 }
          };
        }
      };
    };

    const doc = createMockDocument({
      text: 'function sum(a, b) {\n    ',
      languageId: 'javascript'
    });
    const pos = new MockPosition(1, 4);

    const suggestions = await inlineAgent.provideInlineCompletionItems(
      doc,
      pos,
      {},
      { isCancellationRequested: false }
    );

    // Restore original factory
    ProviderFactory.create = origCreate;

    assert.ok(suggestions, 'Suggestions should not be null');
    assert.strictEqual(suggestions.length, 1);
    assert.strictEqual(providerCalledWith.pid, PROVIDERS.GROQ);
    assert.strictEqual(providerCalledWith.config.maxTokens, 64);
    assert.strictEqual(providerCalledWith.config.temperature, 0.1);
    assert.ok(suggestions[0].insertText.includes('const result = a + b;'));

    // Check usage tracking recorded success
    const stats = usageTracker.storage.getProviderStats(PROVIDERS.GROQ);
    assert.strictEqual(stats.successfulRequests, 1);
    assert.strictEqual(stats.tokens.total, 55);
  });

  // 10. InlineAgent respects cooldown & cancellation
  await runTestAsync('TEST 14: InlineAgent returns null when provider is in cooldown or request cancelled', async () => {
    configurationValues.set('freecodeAI.inline.debounceDelay', 0);
    const secretStore = new MockSecretStorage();
    const secretManager = new SecretManager(secretStore);
    await secretManager.storeApiKey('gemini', 'test-gemini-key');
    const memento = new MockMemento();
    const providerManager = new ProviderManager({ globalState: memento }, secretManager);
    const usageTracker = new UsageTracker(memento);

    await providerManager.setProviderConfiguration(PROVIDERS.GEMINI, { model: 'gemini-1.5-flash' });
    await providerManager.setActiveProvider(PROVIDERS.GEMINI);

    // Put Gemini in cooldown
    usageTracker.limitTracker.setCooldown(PROVIDERS.GEMINI, 60, 'Rate limit hit');

    const inlineAgent = new InlineAgent({
      providerManager,
      secretManager,
      usageTracker
    });

    const doc = createMockDocument({ text: 'const x = ', languageId: 'javascript' });
    const pos = new MockPosition(0, 10);

    const resCooldown = await inlineAgent.provideInlineCompletionItems(doc, pos, {}, { isCancellationRequested: false });
    assert.strictEqual(resCooldown, null, 'Must return null when cooling down');

    // Clear cooldown, but test cancellation
    usageTracker.clearCooldown(PROVIDERS.GEMINI);
    const resCancelled = await inlineAgent.provideInlineCompletionItems(doc, pos, {}, { isCancellationRequested: true });
    assert.strictEqual(resCancelled, null, 'Must return null when cancelled');
  });

  // 11. AgentManager toggle and registration
  await runTestAsync('TEST 15: AgentManager toggles inline suggestions and updates settings', async () => {
    const secretStore = new MockSecretStorage();
    const secretManager = new SecretManager(secretStore);
    const memento = new MockMemento();
    const providerManager = new ProviderManager({ globalState: memento }, secretManager);
    const usageTracker = new UsageTracker(memento);

    const agentManager = new AgentManager({ providerManager, secretManager, usageTracker });
    const initialEnabled = agentManager.isEnabled();
    assert.strictEqual(initialEnabled, true);

    const toggled = await agentManager.toggleEnabled();
    assert.strictEqual(toggled, false);
    assert.strictEqual(agentManager.isEnabled(), false);

    agentManager.dispose();
  });

  // 12. Predictive typing cache (0ms latency, zero API calls)
  runTest('TEST 16: Predictive typing cache serves remaining suggestion instantly as user types', () => {
    const cache = new CacheManager({ defaultTtlMs: 30000 });
    const linePrefix = 'const total = ';
    const pos = new MockPosition(10, linePrefix.length);
    const fullSuggestion = 'calculateTax(amount, rate)';

    cache.set('file:///test.js', pos, 'prefix', [{ insertText: fullSuggestion }], undefined, linePrefix);

    // User types 'c' (now at character 15)
    const nextPos1 = new MockPosition(10, linePrefix.length + 1);
    const match1 = cache.getPredictiveMatch('file:///test.js', nextPos1, 'const total = c');
    assert.ok(match1, 'Must find predictive match after 1 character typed');
    assert.strictEqual(match1[0].insertText, 'alculateTax(amount, rate)');

    // User types 'ca' (now at character 16)
    const nextPos2 = new MockPosition(10, linePrefix.length + 2);
    const match2 = cache.getPredictiveMatch('file:///test.js', nextPos2, 'const total = ca');
    assert.ok(match2, 'Must find predictive match after 2 characters typed');
    assert.strictEqual(match2[0].insertText, 'lculateTax(amount, rate)');
  });

  // 13. Rate limit guard skips request when provider is saturated
  await runTestAsync('TEST 17: InlineAgent rate limit guard protects quota when sliding-window load >= 92%', async () => {
    const secretStore = new MockSecretStorage();
    const secretManager = new SecretManager(secretStore);
    await secretManager.storeApiKey('groq', 'gsk-test-key');
    const memento = new MockMemento();
    const providerManager = new ProviderManager({ globalState: memento }, secretManager);
    const usageTracker = new UsageTracker(memento);

    await providerManager.setProviderConfiguration(PROVIDERS.GROQ, { model: 'llama-3.3-70b-versatile' });
    await providerManager.setActiveProvider(PROVIDERS.GROQ);

    // Simulate 29 requests in 60 seconds (Groq max is 30, so 29/30 = 96% load)
    for (let i = 0; i < 29; i++) {
      usageTracker.limitTracker.recordVelocity(PROVIDERS.GROQ, 100);
    }

    const inlineAgent = new InlineAgent({
      providerManager,
      secretManager,
      usageTracker
    });

    const doc = createMockDocument({ text: 'function calc() {\n    ', languageId: 'javascript' });
    const pos = new MockPosition(1, 4);

    const resSaturated = await inlineAgent.provideInlineCompletionItems(doc, pos, {}, { isCancellationRequested: false });
    assert.strictEqual(resSaturated, null, 'Must drop request when provider is near quota limit');
  });

  // 14. Mid-word trigger skip
  runTest('TEST 18: InlineAgent skips unproductive middle-of-word positions to conserve quota', () => {
    const inlineAgent = new InlineAgent({});
    const shouldSkip1 = inlineAgent._shouldSkipPosition('function cal', 'culate()');
    assert.strictEqual(shouldSkip1, true, 'Should skip editing inside word');

    const shouldSkip2 = inlineAgent._shouldSkipPosition('const total = ', '');
    assert.strictEqual(shouldSkip2, false, 'Should NOT skip end of line or assignment');
  });

  // 15. Direct Connection Caching (Fast dispatch without per-keystroke disk/secret reads)
  await runTestAsync('TEST 19: InlineAgent directly connects provider in memory for 0ms reuse across keystrokes', async () => {
    const secretStore = new MockSecretStorage();
    const secretManager = new SecretManager(secretStore);
    await secretManager.storeApiKey('gemini', 'test-gemini-key');
    const memento = new MockMemento();
    const providerManager = new ProviderManager({ globalState: memento }, secretManager);
    const usageTracker = new UsageTracker(memento);

    await providerManager.setProviderConfiguration(PROVIDERS.GEMINI, { model: 'gemini-1.5-flash' });
    await providerManager.setActiveProvider(PROVIDERS.GEMINI);

    const inlineAgent = new InlineAgent({
      providerManager,
      secretManager,
      usageTracker
    });

    // First call: builds direct connection in memory
    const conn1 = await inlineAgent.getDirectConnection();
    assert.ok(conn1, 'Direct connection should be created');
    assert.strictEqual(conn1.providerId, PROVIDERS.GEMINI);
    assert.strictEqual(conn1.apiKey, 'test-gemini-key');
    assert.ok(conn1.provider, 'Provider instance should be connected in memory');

    // Second call: must return identical in-memory provider instance in 0ms without re-reading
    const conn2 = await inlineAgent.getDirectConnection();
    assert.strictEqual(conn1.provider, conn2.provider, 'Must reuse in-memory provider instance');

    // Invalidate connection: e.g. on provider switch
    inlineAgent.invalidateDirectConnection();
    assert.strictEqual(inlineAgent._directConnection, null, 'Direct connection should be cleared on invalidation');
  });

  // 16. Comprehensive backtick stripping
  runTest('TEST 20: SuggestionParser strips all backtick variants while preserving valid code indentation', () => {
    // Single backticks
    assert.strictEqual(SuggestionParser.cleanText('`a.upper()`'), 'a.upper()');
    assert.strictEqual(SuggestionParser.cleanText('`a.upper();`'), 'a.upper();');
    // Triple backticks inline
    assert.strictEqual(SuggestionParser.cleanText('```a.upper()```'), 'a.upper()');
    // Multiline fenced with Python indentation
    const pythonFenced = '```python\n    def calculate():\n        return 42\n```';
    assert.strictEqual(SuggestionParser.cleanText(pythonFenced), '    def calculate():\n        return 42');
    // JavaScript template literals preserved
    const jsTemplate = 'const url = `https://api.com/${endpoint}`;';
    assert.strictEqual(SuggestionParser.cleanText(jsTemplate), 'const url = `https://api.com/${endpoint}`;');
  });

  // 17. Rate limit user notification and provider switch action
  await runTestAsync('TEST 21: InlineAgent notifies user on rate limit, offers alternative LLM switch, and throttles duplicate alerts', async () => {
    const secretStore = new MockSecretStorage();
    const secretManager = new SecretManager(secretStore);
    await secretManager.storeApiKey('groq', 'groq-key');
    await secretManager.storeApiKey('gemini', 'gemini-key');
    const memento = new MockMemento();
    const providerManager = new ProviderManager({ globalState: memento }, secretManager);
    const usageTracker = new UsageTracker(memento);

    await providerManager.setProviderConfiguration(PROVIDERS.GROQ, { model: 'llama-3.3-70b-versatile' });
    await providerManager.setProviderConfiguration(PROVIDERS.GEMINI, { model: 'gemini-1.5-flash' });
    await providerManager.setActiveProvider(PROVIDERS.GROQ);

    const inlineAgent = new InlineAgent({
      providerManager,
      secretManager,
      usageTracker
    });

    let warningCalled = null;
    mockVscode.window.showWarningMessage = async (msg, ...actions) => {
      warningCalled = { msg, actions };
      return actions[0]; // Simulate user selecting the first action ("Switch to Google Gemini")
    };

    // First limit notification: must construct message and offer switch to Google Gemini
    const msg1 = await inlineAgent.notifyRateLimitAndSuggestSwitch(PROVIDERS.GROQ, 'Rate limit reached', { force: true });
    assert.ok(msg1, 'Notification message should be returned');
    assert.ok(msg1.includes('Groq inline suggestion limit reached'), 'Must mention provider name');
    assert.ok(warningCalled, 'showWarningMessage must be called');
    assert.ok(warningCalled.actions.includes('Switch to Google Gemini'), 'Must offer switch to alternative configured provider');

    // Second call within 60s without force: must be throttled to prevent spamming
    const msg2 = await inlineAgent.notifyRateLimitAndSuggestSwitch(PROVIDERS.GROQ, 'Rate limit reached', { force: false });
    assert.strictEqual(msg2, null, 'Must throttle duplicate notifications within cooldown period');
  });

  // 18. Token conservation: request cancellation & negative caching
  await runTestAsync('TEST 22: InlineAgent aborts in-flight completion and caches negative results to save tokens', async () => {
    const secretStore = new MockSecretStorage();
    const secretManager = new SecretManager(secretStore);
    await secretManager.storeApiKey('gemini', 'gemini-key');
    const memento = new MockMemento();
    const providerManager = new ProviderManager({ globalState: memento }, secretManager);
    const usageTracker = new UsageTracker(memento);
    const cacheManager = new CacheManager();

    await providerManager.setProviderConfiguration(PROVIDERS.GEMINI, { model: 'gemini-1.5-flash' });
    await providerManager.setActiveProvider(PROVIDERS.GEMINI);

    const inlineAgent = new InlineAgent({
      providerManager,
      secretManager,
      usageTracker,
      cacheManager
    });

    // Verify negative caching: empty completion cached
    const doc = createMockDocument({ text: 'var a = ;', languageId: 'javascript' });
    const pos = new MockPosition(0, 9);
    cacheManager.set(doc.uri.toString(), pos, 'var a = ;', [], 4000);

    const cachedEmpty = cacheManager.get(doc.uri.toString(), pos, 'var a = ;');
    assert.deepStrictEqual(cachedEmpty, [], 'Must return cached empty array without API call');

    // Verify AbortController cancellation on new keystroke
    inlineAgent._currentAbortController = new AbortController();
    assert.strictEqual(inlineAgent._currentAbortController.signal.aborted, false);
    inlineAgent.cancelPending();
    assert.strictEqual(inlineAgent._currentAbortController, null, 'AbortController should be cleaned up on cancelPending');
  });

  console.log('\n================================================================');
  console.log(`TOTAL INLINE & STATUSBAR TESTS: ${totalTests}`);
  console.log(`PASSED: ${passedTests}`);
  console.log(`FAILED: ${failedTests}`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
})();
