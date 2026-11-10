/**
 * Prompt Builder for FreeCode AI.
 * Formats system instructions, conversation context, and message history.
 */

const DEFAULT_SYSTEM_PROMPT = `You are FreeCode AI, an expert, concise, and helpful AI coding assistant in Visual Studio Code.
Guidelines:
- Provide direct, production-quality code and clear explanations.
- When generating code, always use fenced code blocks with language identifiers.
- Keep answers focused, practical, and well-structured.
- Identify potential bugs, edge cases, and best practices when relevant.`;

class PromptBuilder {
  /**
   * Build the system prompt.
   * @param {string} [customInstruction]
   */
  static getSystemPrompt(customInstruction = '') {
    if (!customInstruction) {
      return DEFAULT_SYSTEM_PROMPT;
    }
    return `${DEFAULT_SYSTEM_PROMPT}\n\nAdditional instructions:\n${customInstruction}`;
  }

  /**
   * Filter and window messages to fit within context limits.
   * @param {Array<{role: string, content: string}>} messages
   * @param {number} [maxMessages=30]
   */
  static prepareMessages(messages = [], maxMessages = 30) {
    if (!Array.isArray(messages)) return [];

    // Filter valid messages
    const valid = messages.filter(m => m && typeof m.content === 'string' && m.content.trim().length > 0);

    // Keep the most recent messages
    const sliced = valid.slice(-maxMessages);

    return sliced.map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content.trim()
    }));
  }
}

module.exports = {
  PromptBuilder,
  DEFAULT_SYSTEM_PROMPT
};
