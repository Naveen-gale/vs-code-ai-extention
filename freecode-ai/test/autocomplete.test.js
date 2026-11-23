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
const { InlineQualityPipeline } = require('../src/autocomplete/qualityPipeline');
const { LocalPredictionEngine } = require('../src/autocomplete/localPredictionEngine');
const mockPosition = require('vscode').Position;

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
  assert.strictEqual(cleanedIntro, '');

  // 4. ContextCollector secret sanitization
  const secretText = 'const API_KEY = "sk-1234567890abcdef1234567890abcdef";';
  const sanitized = ContextCollector.sanitizeContent(secretText);
  assert.ok(!sanitized.includes('sk-1234567890abcdef'));
  assert.ok(sanitized.includes('[REDACTED'));

  const largeLines = Array.from({ length: 4000 }, (_, index) => `const value${index} = ${index};`);
  const largeSource = largeLines.join('\n');
  const largeOffsets = [];
  let largeOffset = 0;
  for (const line of largeLines) {
    largeOffsets.push(largeOffset);
    largeOffset += line.length + 1;
  }
  let unboundedReads = 0;
  let boundedCharacters = 0;
  const largeDocument = {
    languageId: 'javascript',
    fileName: 'large.js',
    lineCount: largeLines.length,
    lineAt: line => ({ text: largeLines[line] }),
    offsetAt: position => largeOffsets[position.line] + position.character,
    positionAt: offset => {
      let low = 0;
      let high = largeOffsets.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (largeOffsets[mid] <= offset) low = mid;
        else high = mid - 1;
      }
      return new mockPosition(low, Math.min(largeLines[low].length, offset - largeOffsets[low]));
    },
    getText: range => {
      if (!range) {
        unboundedReads++;
        return largeSource.split('').join('');
      }
      const start = largeOffsets[range.start.line] + range.start.character;
      const end = largeOffsets[range.end.line] + range.end.character;
      boundedCharacters += end - start;
      return largeSource.slice(start, end);
    }
  };
  const largeContext = ContextCollector.collectBounded(
    largeDocument,
    new mockPosition(2000, 10),
    { maxInputTokens: 120 }
  );
  assert.strictEqual(unboundedReads, 0, 'Bounded collection must not read the entire document');
  assert.ok(boundedCharacters <= 480, 'Only the requested context window should be read');
  assert.ok(largeContext.prefix.length > 0);
  console.log(
    `[MOCK PERF] Context read ${boundedCharacters} of ${largeSource.length} document characters ` +
    `(${Math.round((1 - boundedCharacters / largeSource.length) * 100)}% less than a full-document read)`
  );

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
  assert.notStrictEqual(
    key,
    SuggestionCache.buildKey({
      providerId: 'gemini',
      model: 'gemini-1.5-flash',
      language: 'javascript',
      prefix: `${'x'.repeat(350)}const x =`,
      suffix: ''
    }),
    'Different earlier context must not collide in the cache'
  );
  assert.notStrictEqual(
    key,
    SuggestionCache.buildKey({
      providerId: 'gemini',
      model: 'gemini-1.5-flash',
      language: 'javascript',
      prefix: 'const x =',
      suffix: '',
      config: { temperature: 0.4 }
    }),
    'Generation configuration must participate in the cache key'
  );

  // 6. Gemini message formatting extracts system instruction and ensures alternating turns
  const { GeminiProvider } = require('../src/providers/geminiProvider');
  const gemini = new GeminiProvider({ apiKey: 'mock-key' });
  const formattedContents = gemini._formatContents(chatMsgs);
  // Verify contents does NOT contain role 'system'
  assert.strictEqual(formattedContents.some(c => c.role === 'system'), false);
  // Verify contents starts with 'user'
  assert.strictEqual(formattedContents[0].role, 'user');
  // Verify no consecutive identical roles
  for (let i = 1; i < formattedContents.length; i++) {
    assert.notStrictEqual(formattedContents[i].role, formattedContents[i - 1].role);
  }

  // 7. ContextCollector supports extended languages including plaintext
  assert.strictEqual(ContextCollector.SUPPORTED_LANGUAGES.has('plaintext'), true);
  assert.strictEqual(ContextCollector.SUPPORTED_LANGUAGES.has('yaml'), true);
  assert.strictEqual(ContextCollector.SUPPORTED_LANGUAGES.has('vue'), true);

  // 8. Quality pipeline extracts Python symbols and produces a cursor-focused prompt
  const pythonSource =
    'def add(a, b):\n    return a + b\n\n' +
    'def subtract(a, b):\n    return a - b\n\n' +
    'a = input("enter the number ")\n\n' +
    'b = input("Enter the second number ")\n\n' +
    'print';
  const pythonContext = InlineQualityPipeline.extractRelevantContext(pythonSource, '', 'python');
  Object.assign(pythonContext, {
    prefix: pythonSource,
    suffix: '',
    language: 'python',
    linePrefix: 'print',
    lineSuffix: ''
  });
  const qualityPrompt = InlineQualityPipeline.buildPrompt(pythonContext);
  assert.ok(qualityPrompt[1].content.includes('add'));
  assert.ok(qualityPrompt[1].content.includes('subtract'));
  assert.ok(qualityPrompt[1].content.includes('<CURSOR>' ) || qualityPrompt[1].content.includes('INSERTION'));

  const { buildInlineCompletionMessages, buildInlineCompletionPrompt } = PromptBuilder;
  const strictMessages = buildInlineCompletionMessages({
    language: 'python',
    prefix: 'import os\nimport ',
    suffix: '',
    imports: ['os']
  });
  assert.strictEqual(strictMessages[0].role, 'system');
  assert.ok(strictMessages[0].content.includes('Never explain'));
  assert.ok(strictMessages[0].content.includes('Never repeat code'));
  assert.ok(strictMessages[1].content.includes('Language: python'));
  assert.ok(strictMessages[1].content.includes('<CURSOR>'));
  assert.ok(buildInlineCompletionPrompt({ language: 'python', prefix: 'import ', suffix: '' }).includes('Return only the insertion text.'));

  // 9. Exact Python regression: cursor immediately after print
  const rawPython =
    'print("Sum:", add(int(a), int(b)))\n' +
    'print("Difference:", subtract(int(a), int(b)))';
  const pythonInsertion = InlineQualityPipeline.postProcess(rawPython, pythonContext);
  assert.strictEqual(
    pythonInsertion,
    '(\"Sum:\", add(int(a), int(b)))\nprint(\"Difference:\", subtract(int(a), int(b)))'
  );

  const completedPython =
    pythonSource.replace(/print$/, '') +
    'print' +
    pythonInsertion;
  assert.ok(completedPython.includes('print("Sum:", add(int(a), int(b)))'));
  assert.ok(completedPython.includes('print("Difference:", subtract(int(a), int(b)))'));

  // 10. Markdown, duplicate suffix, and malformed bracket responses are rejected or cleaned
  const fenced = InlineQualityPipeline.postProcess(
    '```javascript\nadd(1, 2);\n```',
    { language: 'javascript', prefix: 'const result = ', suffix: '', linePrefix: 'const result = ', lineSuffix: '' }
  );
  assert.strictEqual(fenced, 'add(1, 2);');

  const malformed = InlineQualityPipeline.postProcess(
    'const broken = [1, 2;',
    { language: 'javascript', prefix: '', suffix: '', linePrefix: '', lineSuffix: '' }
  );
  assert.strictEqual(malformed, '');

  const duplicatedSuffix = InlineQualityPipeline.postProcess(
    'return value;\n}',
    { language: 'javascript', prefix: 'function test() {\n', suffix: '}', linePrefix: '  return', lineSuffix: '' }
  );
  assert.ok(!duplicatedSuffix.endsWith('}\n'));

  // 11. Inline parser rejects prose and still accepts real code
  assert.strictEqual(
    InlineQualityPipeline.postProcess(
      'Here is the code:\n  return x * 2;',
      { language: 'javascript', prefix: 'function test() {\n', suffix: '', linePrefix: '  ', lineSuffix: '' }
    ),
    ''
  );
  assert.strictEqual(
    InlineQualityPipeline.postProcess(
      'This code calculates the sum.',
      { language: 'javascript', prefix: 'const total = ', suffix: '', linePrefix: 'const total = ', lineSuffix: '' }
    ),
    ''
  );
  for (const prose of [
    'We need to complete the statement.',
    'The code before cursor is import os.',
    'Here is the suggested code:\n```python\nsys\n```',
    '```text\nLet me think through this problem.\n```'
  ]) {
    assert.strictEqual(
      InlineQualityPipeline.postProcess(prose, {
        language: 'python',
        prefix: 'import os\nimport ',
        suffix: '',
        linePrefix: 'import ',
        lineSuffix: ''
      }),
      '',
      `Prose must not be suggested: ${prose}`
    );
  }

  assert.strictEqual(
    InlineQualityPipeline.postProcess(
      '# Keep this comment: the code before cursor is useful.',
      { language: 'python', prefix: '', suffix: '', linePrefix: '', lineSuffix: '' }
    ),
    '# Keep this comment: the code before cursor is useful.'
  );
  assert.strictEqual(
    InlineQualityPipeline.postProcess(
      'message = "We need to preserve this string."',
      { language: 'python', prefix: '', suffix: '', linePrefix: '', lineSuffix: '' }
    ),
    'message = "We need to preserve this string."'
  );

  const middleInsertion = InlineQualityPipeline.postProcess(
    'const result = foobar;',
    {
      language: 'javascript',
      prefix: 'const result = fo',
      suffix: 'r;',
      linePrefix: 'const result = fo',
      lineSuffix: 'r;'
    }
  );
  assert.strictEqual(middleInsertion, 'oba');

  // 11. Local prediction completes the exact Python print cursor without repeating print
  const exactPythonPrefix =
    'def add(a, b):\n    return a + b\n\n' +
    'def subtract(a, b):\n    return a - b\n\n' +
    'a = int(input("Enter first number: "))\n' +
    'b = int(input("Enter second number: "))\n\nprint';
  const local = LocalPredictionEngine.predict({
    language: 'python',
    prefix: exactPythonPrefix,
    linePrefix: 'print',
    lineSuffix: '',
    lineEnding: '\n'
  });
  assert.strictEqual(local.source, 'local-pattern');
  assert.strictEqual(
    local.text,
    '("Sum:", add(a, b))\nprint("Difference:", subtract(a, b))'
  );
  assert.strictEqual(
    exactPythonPrefix.slice(0, -5) + 'print' + local.text,
    'def add(a, b):\n    return a + b\n\n' +
    'def subtract(a, b):\n    return a - b\n\n' +
    'a = int(input("Enter first number: "))\n' +
    'b = int(input("Enter second number: "))\n\n' +
    'print("Sum:", add(a, b))\nprint("Difference:", subtract(a, b))'
  );

  // 12. Safe local bracket completion and no-suffix guard
  const bracket = LocalPredictionEngine.predict({
    language: 'javascript',
    prefix: 'const value = multiply(first, second)',
    linePrefix: 'const value = multiply(first, second)',
    lineSuffix: '',
    lineEnding: '\n'
  });
  assert.strictEqual(bracket, null);

  const openBracket = LocalPredictionEngine.predict({
    language: 'javascript',
    prefix: 'const value = multiply(first, second',
    linePrefix: 'const value = multiply(first, second',
    lineSuffix: '',
    lineEnding: '\n'
  });
  assert.strictEqual(openBracket.text, ')');

  console.log('All Autocomplete Unit Tests Passed!\n');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
