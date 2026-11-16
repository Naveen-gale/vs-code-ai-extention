'use strict';

const assert = require('assert');
const Module = require('module');

const origReq = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'vscode') {
    return {
      Position: class { constructor(l, c) { this.line = l; this.character = c; } },
      Range: class { constructor(s, e) { this.start = s; this.end = e; } }
    };
  }
  return origReq.apply(this, arguments);
};

const { PromptBuilder } = require('../src/autocomplete/promptBuilder');
const { ContextCollector } = require('../src/autocomplete/contextCollector');
const { SuggestionParser } = require('../src/autocomplete/suggestionParser');
const { SuggestionCache } = require('../src/autocomplete/cacheManager');

async function run() {
  console.log('Running Autocomplete Unit Tests...');

  // 1. PromptBuilder FIM
  const fim = PromptBuilder.buildFIMPrompt({ prefix: 'const a = ', suffix: ';' });
  assert.ok(fim.includes('<PRE>'));
  assert.ok(fim.includes('<SUF>'));
  assert.ok(fim.includes('<MID>'));

  // 2. PromptBuilder Chat
  const chatMsgs = PromptBuilder.buildChatMessages({
    prefix: 'function add(a, b) {\n  return',
    suffix: '}\n',
    language: 'javascript'
  });
  assert.strictEqual(chatMsgs.length, 2);
  assert.strictEqual(chatMsgs[0].role, 'system');
  assert.ok(chatMsgs[1].content.includes('function add'));

  // 3. SuggestionParser cleans markdown and intros
  const rawWithFences = '```javascript\n a + b;\n```';
  const cleaned = SuggestionParser.parse(rawWithFences);
  assert.strictEqual(cleaned.trim(), 'a + b;');

  const rawWithIntro = 'Here is the code:\n  return x * 2;';
  const cleanedIntro = SuggestionParser.parse(rawWithIntro);
  assert.strictEqual(cleanedIntro.trim(), 'return x * 2;');

  // 4. ContextCollector secret sanitization
  const secretText = 'const API_KEY = "sk-1234567890abcdef1234567890abcdef";';
  const sanitized = ContextCollector.sanitizeContent(secretText);
  assert.ok(!sanitized.includes('sk-1234567890abcdef'));
  assert.ok(sanitized.includes('[REDACTED'));

  // 5. SuggestionCache operations
  const cache = new SuggestionCache({ maxSize: 10, defaultTtlMs: 5000 });
  const key = SuggestionCache.buildKey({
    providerId: 'gemini',
    model: 'gemini-1.5-flash',
    language: 'javascript',
    prefix: 'const x =',
    suffix: ''
  });

  cache.set(key, ' 42;');
  const val = cache.get(key);
  assert.strictEqual(val, ' 42;');
  assert.strictEqual(cache.stats.hits, 1);
  assert.strictEqual(cache.stats.requestsAvoided, 1);

  console.log('All Autocomplete Unit Tests Passed!\n');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
