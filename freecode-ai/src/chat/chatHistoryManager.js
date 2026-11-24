/**
 * Chat History Manager for FreeCode AI / Laven.
 * Provides persistent local storage of chat sessions, allowing users to:
 * - Automatically preserve previous conversations when starting a New Chat.
 * - Restore active conversation across extension reloads.
 * - Browse, search, resume, and delete individual chat sessions or clear all history.
 */

const STORAGE_KEY = 'laven_chat_sessions_v1';
const ACTIVE_SESSION_KEY = 'laven_active_session_id_v1';
const MAX_SESSIONS = 60;

class ChatHistoryManager {
  /**
   * @param {object} [storage] Memento-compatible storage (e.g. context.globalState or MockMemento)
   */
  constructor(storage = null) {
    this.storage = storage;
    /** @type {Array<object>} */
    this.sessions = [];
    /** @type {string|null} */
    this.activeSessionId = null;
    this._inMemoryStore = new Map();

    this._loadFromStorage();
  }

  /**
   * Read saved sessions from storage.
   * @private
   */
  _loadFromStorage() {
    try {
      if (this.storage && typeof this.storage.get === 'function') {
        this.sessions = this.storage.get(STORAGE_KEY, []) || [];
        this.activeSessionId = this.storage.get(ACTIVE_SESSION_KEY, null);
      } else {
        this.sessions = this._inMemoryStore.get(STORAGE_KEY) || [];
        this.activeSessionId = this._inMemoryStore.get(ACTIVE_SESSION_KEY) || null;
      }

      if (!Array.isArray(this.sessions)) {
        this.sessions = [];
      }
    } catch {
      this.sessions = [];
      this.activeSessionId = null;
    }
  }

  /**
   * Persist sessions and active ID to storage.
   * @private
   */
  async _saveToStorage() {
    try {
      // Keep only up to MAX_SESSIONS
      if (this.sessions.length > MAX_SESSIONS) {
        this.sessions = this.sessions.slice(0, MAX_SESSIONS);
      }

      if (this.storage && typeof this.storage.update === 'function') {
        await this.storage.update(STORAGE_KEY, this.sessions);
        await this.storage.update(ACTIVE_SESSION_KEY, this.activeSessionId);
      } else {
        this._inMemoryStore.set(STORAGE_KEY, this.sessions);
        this._inMemoryStore.set(ACTIVE_SESSION_KEY, this.activeSessionId);
      }
    } catch (err) {
      console.warn('Laven: Failed to persist chat history:', err);
    }
  }

  /**
   * Generate a clean title from messages or prompt text.
   * @param {string} text
   * @returns {string}
   */
  generateTitle(text) {
    if (!text || typeof text !== 'string') return 'New Conversation';
    const clean = text
      .replace(/^[\s#*>-]+/, '')
      .replace(/\r?\n.*/s, '') // only first line
      .trim();
    if (!clean) return 'New Conversation';
    return clean.length > 52 ? `${clean.slice(0, 52).trim()}...` : clean;
  }

  /**
   * Get summaries of all sessions (lightweight metadata for UI rendering).
   * @returns {Array<object>}
   */
  getSessionsSummary() {
    return this.sessions.map(s => {
      const firstUserMsg = (s.messages || []).find(m => m.role === 'user');
      const previewText = firstUserMsg ? firstUserMsg.content.slice(0, 80).replace(/\r?\n/g, ' ') : '';

      return {
        id: s.id,
        title: s.title || 'New Conversation',
        createdAt: s.createdAt,
        updatedAt: s.updatedAt || s.createdAt,
        messageCount: (s.messages || []).length,
        provider: s.provider || null,
        model: s.model || null,
        preview: previewText,
        isActive: s.id === this.activeSessionId
      };
    });
  }

  /**
   * Get full session by ID.
   * @param {string} sessionId
   * @returns {object|null}
   */
  getSession(sessionId) {
    if (!sessionId) return null;
    return this.sessions.find(s => s.id === sessionId) || null;
  }

  /**
   * Get active session ID.
   * @returns {string|null}
   */
  getActiveSessionId() {
    return this.activeSessionId;
  }

  /**
   * Create a new blank session and mark it as active.
   * @param {object} [options]
   * @param {string} [options.provider]
   * @param {string} [options.model]
   * @param {string} [options.title]
   * @returns {object}
   */
  createSession(options = {}) {
    const now = new Date().toISOString();
    const newSession = {
      id: `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title: options.title || 'New Conversation',
      createdAt: now,
      updatedAt: now,
      provider: options.provider || null,
      model: options.model || null,
      messages: []
    };

    // Add to beginning of sessions list synchronously
    this.sessions.unshift(newSession);
    this.activeSessionId = newSession.id;
    this._saveToStorage();
    return newSession;
  }

  /**
   * Save or update the active session with current messages.
   * @param {Array<object>} messages
   * @param {string} [provider]
   * @param {string} [model]
   * @returns {object}
   */
  saveCurrentSession(messages, provider = null, model = null) {
    let session = this.getSession(this.activeSessionId);

    if (!session) {
      const firstUserMsg = (messages || []).find(m => m.role === 'user');
      const title = firstUserMsg ? this.generateTitle(firstUserMsg.content) : 'New Conversation';
      session = this.createSession({ provider, model, title });
    }

    session.messages = Array.isArray(messages) ? [...messages] : [];
    session.updatedAt = new Date().toISOString();
    if (provider) session.provider = provider;
    if (model) session.model = model;

    // Auto-update title if it's still default and there's a user message
    if (!session.title || session.title === 'New Conversation') {
      const firstUser = session.messages.find(m => m.role === 'user');
      if (firstUser && firstUser.content) {
        session.title = this.generateTitle(firstUser.content);
      }
    }

    // Move updated session to top
    const idx = this.sessions.findIndex(s => s.id === session.id);
    if (idx > 0) {
      this.sessions.splice(idx, 1);
      this.sessions.unshift(session);
    }

    this._saveToStorage();
    return session;
  }

  /**
   * Load and activate a session by ID.
   * @param {string} sessionId
   * @returns {object|null}
   */
  loadSession(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) return null;
    this.activeSessionId = session.id;
    this._saveToStorage();
    return session;
  }

  /**
   * Delete a session by ID.
   * @param {string} sessionId
   * @returns {{ deleted: boolean, wasActive: boolean, nextActiveId: string|null }}
   */
  deleteSession(sessionId) {
    const wasActive = this.activeSessionId === sessionId;
    const initialLen = this.sessions.length;
    this.sessions = this.sessions.filter(s => s.id !== sessionId);

    if (wasActive) {
      this.activeSessionId = this.sessions.length > 0 ? this.sessions[0].id : null;
    }

    this._saveToStorage();
    return {
      deleted: this.sessions.length < initialLen,
      wasActive,
      nextActiveId: this.activeSessionId
    };
  }

  /**
   * Delete all saved sessions and reset active session.
   * @returns {void}
   */
  clearAllSessions() {
    this.sessions = [];
    this.activeSessionId = null;
    this._saveToStorage();
  }
}

module.exports = { ChatHistoryManager };
