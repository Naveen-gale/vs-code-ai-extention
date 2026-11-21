/**
 * FreeCode AI — Chat UI Output, Code Rendering & Copy/Insert Test Suite
 *
 * Verifies:
 * 1. Markdown parsing extracts code blocks, subheadings, callouts, and inline code.
 * 2. Syntax highlighting produces VS Code Dark+ token classes without HTML collision.
 * 3. Raw code is preserved faithfully inside a hidden textarea for 1-click copying.
 * 4. ChatProvider handles 'insertCode' and 'copyCode' webview messages.
 * 5. CSS contains modern styling for code blocks, syntax tokens, and callout cards.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Global Mock for 'vscode'
let lastInsertedText = null;
let lastClipboardText = null;

const mockEditor = {
  selection: { active: { line: 0, character: 0 } },
  edit: (callback) => {
    const editBuilder = {
      insert: (pos, text) => {
        lastInsertedText = text;
      }
    };
    callback(editBuilder);
    return Promise.resolve(true);
  }
};

const mockVscode = {
  window: {
    activeTextEditor: mockEditor,
    showInformationMessage: () => Promise.resolve(),
    showWarningMessage: () => Promise.resolve(),
    showErrorMessage: () => Promise.resolve()
  },
  env: {
    clipboard: {
      writeText: (text) => {
        lastClipboardText = text;
        return Promise.resolve();
      }
    }
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

const { ChatProvider } = require('../src/ui/chatProvider');

console.log('================================================================');
console.log('   RUNNING CHAT UI OUTPUT & CODE RENDERING TEST SUITE           ');
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

(async () => {
  const cssPath = path.resolve(__dirname, '../src/ui/webview/style.css');
  const appJsPath = path.resolve(__dirname, '../src/ui/webview/app.js');

  const cssContent = fs.readFileSync(cssPath, 'utf8');
  const appJsContent = fs.readFileSync(appJsPath, 'utf8');

  // TEST 1: CSS contains modern code block and syntax highlighting classes
  await test('TEST 1: style.css has complete code container, action buttons, and token classes', () => {
    assert.ok(cssContent.includes('.code-block-container'), 'Must have .code-block-container');
    assert.ok(cssContent.includes('.code-block-header'), 'Must have .code-block-header');
    assert.ok(cssContent.includes('.btn-copy-code'), 'Must have .btn-copy-code');
    assert.ok(cssContent.includes('.btn-insert-code'), 'Must have .btn-insert-code');
    assert.ok(cssContent.includes('.tok-kw'), 'Must style .tok-kw');
    assert.ok(cssContent.includes('.tok-fn'), 'Must style .tok-fn');
    assert.ok(cssContent.includes('.tok-string'), 'Must style .tok-string');
    assert.ok(cssContent.includes('.tok-num'), 'Must style .tok-num');
    assert.ok(cssContent.includes('.tok-comment'), 'Must style .tok-comment');
    assert.ok(cssContent.includes('.tok-builtin'), 'Must style .tok-builtin');
    assert.ok(cssContent.includes('.md-subheading'), 'Must style .md-subheading');
    assert.ok(cssContent.includes('.callout-card'), 'Must style .callout-card');
    assert.ok(cssContent.includes('.md-inline-code'), 'Must style .md-inline-code');
    assert.ok(cssContent.includes('.btn-copy-response'), 'Must style .btn-copy-response');
  });

  // TEST 2: app.js contains markdown parser and syntax tokenizer
  await test('TEST 2: app.js contains highlightSyntax, parseMarkdown, and event delegation', () => {
    assert.ok(appJsContent.includes('function highlightSyntax'), 'Must define highlightSyntax');
    assert.ok(appJsContent.includes('function parseMarkdown'), 'Must define parseMarkdown');
    assert.ok(appJsContent.includes('btn-copy-code'), 'Must handle btn-copy-code');
    assert.ok(appJsContent.includes('btn-insert-code'), 'Must handle btn-insert-code');
    assert.ok(appJsContent.includes('btn-copy-response'), 'Must handle btn-copy-response');
    assert.ok(appJsContent.includes('raw-message-content'), 'Must save raw message content');
    assert.ok(appJsContent.includes('raw-code'), 'Must save raw code in textarea');
  });

  // TEST 3: Validate markdown parsing directly on user sample prompt
  await test('TEST 3: parseMarkdown processes Fibonacci response into structured code cards & callouts', () => {
    // Extract parseMarkdown function from app.js in a safe context
    const sandbox = {};
    const parseCode = `
      function escapeHtml ${appJsContent.split('function escapeHtml')[1].split('function appendMessage')[0]}
      exports.parseMarkdown = parseMarkdown;
      exports.highlightSyntax = highlightSyntax;
      exports.escapeHtml = escapeHtml;
    `;
    const fn = new Function('exports', parseCode);
    fn(sandbox);

    const sample = `Here are a few ways to compute the Fibonacci sequence in Python:

**1. Iterative (recommended for performance)**
\`\`\`python
def fib(n: int) -> int:
    """Return the nth Fibonacci number (0-indexed)."""
    if n < 0:
        raise ValueError("n must be non-negative")
    if n <= 1:
        return n
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b
\`\`\`

**2. Generate first \`n\` numbers**
\`\`\`python
def fib_series(n: int) -> list[int]:
    """Return the first n Fibonacci numbers."""
    if n <= 0:
        return []
    seq = [0]
    if n > 1:
        seq.append(1)
    for _ in range(2, n):
        seq.append(seq[-1] + seq[-2])
    return seq
\`\`\`

**Notes**
- The iterative version runs in **O(n)** time and **O(1)** space — best for single lookups.
- \`fib_series\` builds the full list in **O(n)** time/space.
- Avoid naive recursion (\`O(2ⁿ)\`) for large \`n\`; use memoization or iteration instead.`;

    const result = sandbox.parseMarkdown(sample);
    assert.strictEqual(result.codeBlocks.length, 2, 'Must extract both code blocks');
    assert.ok(result.html.includes('code-block-container'), 'HTML must include code-block-container');
    assert.ok(result.html.includes('PYTHON'), 'HTML must show uppercase language badge');
    assert.ok(result.html.includes('tok-kw'), 'Syntax highlighting must produce keyword tokens');
    assert.ok(result.html.includes('tok-fn'), 'Syntax highlighting must produce function tokens');
    assert.ok(result.html.includes('tok-string'), 'Syntax highlighting must produce string tokens');
    assert.ok(result.html.includes('subheading-badge'), 'Subheading numbered badges must be rendered');
    assert.ok(result.html.includes('callout-card notes'), 'Callout card for Notes must be created');
    assert.ok(result.html.includes('md-inline-code'), 'Inline code must be rendered with md-inline-code');
    assert.ok(result.html.includes('btn-copy-code'), 'Code block must have copy button');
    assert.ok(result.html.includes('btn-insert-code'), 'Code block must have insert button');
  });

  // TEST 4: ChatProvider handles 'insertCode' webview message
  await test('TEST 4: ChatProvider executes editor.insert when receiving insertCode command', async () => {
    lastInsertedText = null;
    const chatProvider = new ChatProvider({
      extensionUri: { fsPath: path.resolve(__dirname, '..') },
      chatController: null,
      secretManager: null,
      usageTracker: null
    });

    const testSnippet = 'def fib(n):\n    return n if n <= 1 else fib(n-1) + fib(n-2)';
    await chatProvider.handleMessage({
      command: 'insertCode',
      text: testSnippet
    });

    assert.strictEqual(lastInsertedText, testSnippet, 'Inserted code must match the snippet exactly');
  });

  // TEST 5: ChatProvider handles 'copyCode' webview message
  await test('TEST 5: ChatProvider writes text to clipboard when receiving copyCode command', async () => {
    lastClipboardText = null;
    const chatProvider = new ChatProvider({
      extensionUri: { fsPath: path.resolve(__dirname, '..') },
      chatController: null,
      secretManager: null,
      usageTracker: null
    });

    const testSnippet = 'const greet = () => console.log("Hello Laven");';
    await chatProvider.handleMessage({
      command: 'copyCode',
      text: testSnippet
    });

    assert.strictEqual(lastClipboardText, testSnippet, 'Clipboard text must match the snippet exactly');
  });

  console.log('\n================================================================');
  console.log(`TOTAL CHAT UI TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
})();
