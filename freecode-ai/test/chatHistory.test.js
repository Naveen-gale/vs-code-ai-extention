/**
 * FreeCode AI — Chat History Management & Local Persistence Test Suite
 *
 * Verifies:
 * 1. ChatHistoryManager saves, updates, and retrieves sessions using Memento storage.
 * 2. Starting a New Chat preserves the previous conversation in local storage.
 * 3. User can load and resume a past conversation.
 * 4. User can delete individual chat sessions or clear all history.
 * 5. ChatProvider message bridge supports getChatHistory, loadSession, deleteSession, and clearAllHistory.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Global Mock for 'vscode'
const mockVscode = {
  window: {
    showInformationMessage: () => Promise.resolve(),
    showWarningMessage: () => Promise.resolve(),
    showErrorMessage: () => Promise.resolve()
  },
  env: {
    clipboard: {
      writeText: () => Promise.resolve()
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

// Mock Memento
class MockMemento {
  constructor() {
    this.map = new Map();
  }
  get(key, defaultValue) {
    return this.map.has(key) ? this.map.get(key) : defaultValue;
  }
  async update(key, value) {
    if (value === undefined) {
      this.map.delete(key);
    } else {
      this.map.set(key, value);
    }
  }
}

const { ChatHistoryManager } = require('../src/chat/chatHistoryManager');
const { ChatController } = require('../src/chat/chatController');
const { ChatProvider } = require('../src/ui/chatProvider');

console.log('================================================================');
console.log('       RUNNING CHAT HISTORY & LOCAL PERSISTENCE TESTS           ');
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
  // TEST 1: ChatHistoryManager session creation and persistence
  await test('TEST 1: ChatHistoryManager creates sessions and persists in Memento storage', async () => {
    const storage = new MockMemento();
    const manager = new ChatHistoryManager(storage);

    const session = await manager.createSession({
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      title: 'Fibonacci discussion'
    });

    assert.ok(session.id.startsWith('session_'));
    assert.strictEqual(session.title, 'Fibonacci discussion');
    assert.strictEqual(manager.getActiveSessionId(), session.id);

    // Verify storage has the session
    const stored = storage.get('laven_chat_sessions_v1');
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0].id, session.id);

    // Simulate reload from storage
    const reloaded = new ChatHistoryManager(storage);
    assert.strictEqual(reloaded.sessions.length, 1);
    assert.strictEqual(reloaded.getActiveSessionId(), session.id);
  });

  // TEST 2: Automatic title generation and message saving
  await test('TEST 2: saveCurrentSession auto-generates title from user message and saves messages', async () => {
    const storage = new MockMemento();
    const manager = new ChatHistoryManager(storage);

    const messages = [
      { role: 'user', content: 'How do I optimize quicksort in C++?' },
      { role: 'assistant', content: 'Here are 3 ways to optimize quicksort...' }
    ];

    const saved = await manager.saveCurrentSession(messages, 'groq', 'llama-3.3-70b');
    assert.strictEqual(saved.title, 'How do I optimize quicksort in C++?');
    assert.strictEqual(saved.messages.length, 2);
    assert.strictEqual(saved.provider, 'groq');
    assert.strictEqual(saved.model, 'llama-3.3-70b');

    const summaries = manager.getSessionsSummary();
    assert.strictEqual(summaries.length, 1);
    assert.strictEqual(summaries[0].messageCount, 2);
    assert.strictEqual(summaries[0].preview, 'How do I optimize quicksort in C++?');
  });

  // TEST 3: New Chat preserves previous conversation in local storage
  await test('TEST 3: ChatController.newChat preserves previous conversation and creates a new session', async () => {
    const storage = new MockMemento();
    const controller = new ChatController({
      secretManager: null,
      usageTracker: null,
      initialProvider: 'gemini',
      initialModel: 'gemini-2.0-flash',
      storage
    });

    // Simulate sending messages in session 1
    controller.messageManager.addMessage({ role: 'user', content: 'First chat question about Python' });
    controller.messageManager.addMessage({ role: 'assistant', content: 'Python is a great language...' });

    // Call newChat()
    controller.newChat();

    // Verify current messages are cleared
    assert.strictEqual(controller.getMessages().length, 0);

    // Verify history retained session 1
    const history = controller.getHistorySummary();
    assert.strictEqual(history.length, 2); // Previous session + newly created session
    const prevSession = history.find(s => s.title.includes('First chat question'));
    assert.ok(prevSession, 'Previous session must be preserved in history');
    assert.strictEqual(prevSession.messageCount, 2);
  });

  // TEST 4: Loading a past session restores messages
  await test('TEST 4: ChatController.loadSession restores past conversation into active view', async () => {
    const storage = new MockMemento();
    const controller = new ChatController({
      secretManager: null,
      usageTracker: null,
      initialProvider: 'gemini',
      storage
    });

    // Session 1
    controller.messageManager.addMessage({ role: 'user', content: 'Session 1 question' });
    controller.messageManager.addMessage({ role: 'assistant', content: 'Session 1 answer' });
    controller.newChat();

    // Session 2
    controller.messageManager.addMessage({ role: 'user', content: 'Session 2 question' });
    controller.messageManager.addMessage({ role: 'assistant', content: 'Session 2 answer' });
    controller.newChat();

    const history = controller.getHistorySummary();
    const session1Meta = history.find(s => s.title.includes('Session 1'));
    assert.ok(session1Meta);

    // Load Session 1
    const loaded = await controller.loadSession(session1Meta.id);
    assert.ok(loaded);
    assert.strictEqual(controller.getMessages().length, 2);
    assert.strictEqual(controller.getMessages()[0].content, 'Session 1 question');
  });

  // TEST 5: Deleting an individual session and clearing all history
  await test('TEST 5: Delete individual session and clear all history works cleanly', async () => {
    const storage = new MockMemento();
    const controller = new ChatController({
      secretManager: null,
      usageTracker: null,
      storage
    });

    controller.messageManager.addMessage({ role: 'user', content: 'Chat to keep' });
    controller.newChat();
    controller.messageManager.addMessage({ role: 'user', content: 'Chat to delete' });
    controller.newChat();

    let history = controller.getHistorySummary();
    const toDelete = history.find(s => s.title.includes('Chat to delete'));
    assert.ok(toDelete);

    // Delete single session
    const delRes = await controller.deleteSession(toDelete.id);
    assert.strictEqual(delRes.deleted, true);

    history = controller.getHistorySummary();
    assert.strictEqual(history.some(s => s.id === toDelete.id), false);

    // Clear all history
    await controller.clearAllHistory();
    assert.strictEqual(controller.getHistorySummary().length, 0);
    assert.strictEqual(controller.getMessages().length, 0);
  });

  // TEST 6: ChatProvider bridge responds to history commands
  await test('TEST 6: ChatProvider handles getChatHistory, loadSession, deleteSession, and clearAllHistory', async () => {
    const storage = new MockMemento();
    const controller = new ChatController({
      secretManager: null,
      usageTracker: null,
      storage
    });

    const sent = [];
    const chatProvider = new ChatProvider({
      extensionUri: { fsPath: path.resolve(__dirname, '..') },
      chatController: controller,
      secretManager: null,
      usageTracker: null
    });

    chatProvider.attachWebview({
      webview: {
        options: {},
        set html(v) {},
        postMessage: (m) => sent.push(m),
        onDidReceiveMessage: () => {}
      }
    });

    // Populate a session
    controller.messageManager.addMessage({ role: 'user', content: 'Bridge test question' });
    controller.newChat();

    // 1. getChatHistory
    sent.length = 0;
    await chatProvider.handleMessage({ command: 'getChatHistory' });
    assert.ok(sent.some(m => m.type === 'chatHistoryUpdated'));

    // 2. loadSession
    const history = controller.getHistorySummary();
    const session = history.find(s => s.title.includes('Bridge test'));
    sent.length = 0;
    await chatProvider.handleMessage({ command: 'loadSession', sessionId: session.id });
    assert.ok(sent.some(m => m.type === 'sessionLoaded'));

    // 3. deleteSession
    sent.length = 0;
    await chatProvider.handleMessage({ command: 'deleteSession', sessionId: session.id });
    assert.ok(sent.some(m => m.type === 'chatHistoryUpdated'));

    // 4. clearAllHistory
    sent.length = 0;
    await chatProvider.handleMessage({ command: 'clearAllHistory' });
    assert.ok(sent.some(m => m.type === 'chatHistoryUpdated'));
    assert.ok(sent.some(m => m.type === 'chatCleared'));
  });

  console.log('\n================================================================');
  console.log(`TOTAL CHAT HISTORY TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
})();
