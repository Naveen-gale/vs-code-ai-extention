/**
 * Message Manager for conversation history.
 */

class MessageManager {
  constructor() {
    /** @type {Array<{ id: string, role: string, content: string, timestamp: string, provider?: string, model?: string, error?: boolean, usage?: object }>} */
    this.messages = [];
  }

  /**
   * Add a message to history.
   * @param {object} param0
   * @param {'user'|'assistant'|'system'} param0.role
   * @param {string} param0.content
   * @param {string} [param0.provider]
   * @param {string} [param0.model]
   * @param {boolean} [param0.error]
   * @param {object} [param0.usage]
   */
  addMessage({ role, content, provider, model, error = false, usage = null }) {
    const msg = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      role,
      content,
      timestamp: new Date().toISOString(),
      provider,
      model,
      error,
      usage
    };
    this.messages.push(msg);
    return msg;
  }

  /**
   * Get all messages.
   */
  getMessages() {
    return [...this.messages];
  }

  /**
   * Clear all messages in current conversation.
   */
  clear() {
    this.messages = [];
  }

  /**
   * Serialize messages for persistence.
   */
  serialize() {
    return JSON.stringify(this.messages);
  }

  /**
   * Restore messages from saved JSON.
   * @param {string|Array} data
   */
  deserialize(data) {
    try {
      if (Array.isArray(data)) {
        this.messages = data;
      } else if (typeof data === 'string') {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          this.messages = parsed;
        }
      }
    } catch {
      this.messages = [];
    }
  }
}

module.exports = { MessageManager };
