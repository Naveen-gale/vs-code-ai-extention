/**
 * Prompt Builder & Token Optimization Engine for Laven.
 * Formats system instructions, conversation context, and applies intelligent
 * prompt compaction to conserve tokens and prevent API rate-limit exhaustion
 * while ensuring high-accuracy results.
 */

const DEFAULT_SYSTEM_PROMPT = `You are Laven, an expert, concise, and helpful AI coding assistant in Visual Studio Code.
Guidelines:
- Provide direct, production-quality code and clear explanations.
- When generating code, always use fenced code blocks with language identifiers.
- Keep answers focused, practical, and well-structured.
- Identify potential bugs, edge cases, and best practices when relevant.
- Be token-efficient: avoid conversational filler, introductory pleasantries, and redundant code repetitions.
- Ensure 100% code correctness, accurate syntax, and verified logic.`;

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
   * Estimate token count from text using character-ratio approximation (1 token ≈ 4 chars).
   * @param {string} text
   * @returns {number}
   */
  static estimateTokenCount(text) {
    if (!text || typeof text !== 'string') return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Compact text by eliminating redundant blank lines and trailing whitespace
   * without altering code indentation or semantics.
   * @param {string} text
   * @returns {string}
   */
  static compactText(text) {
    if (!text || typeof text !== 'string') return '';
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n') // Collapse 3+ newlines to 2
      .replace(/[ \t]+$/gm, '')  // Strip trailing whitespace per line
      .trim();
  }

  /**
   * Filter, compact, and window messages to fit within token budgets.
   * Conserves tokens on multi-turn conversations to prevent API rate limits.
   * @param {Array<{role: string, content: string}>} messages
   * @param {number|object} [maxMessagesOrOptions=20]
   * @returns {Array<{role: string, content: string}> & { tokensSaved: number }}
   */
  static prepareMessages(messages = [], maxMessagesOrOptions = 20) {
    if (!Array.isArray(messages)) {
      const empty = [];
      empty.tokensSaved = 0;
      return empty;
    }

    let maxMessages = 20;
    let maxTokenBudget = 2500; // Safe prompt token budget across all free/paid tiers

    if (typeof maxMessagesOrOptions === 'number') {
      maxMessages = maxMessagesOrOptions;
    } else if (typeof maxMessagesOrOptions === 'object' && maxMessagesOrOptions !== null) {
      if (maxMessagesOrOptions.maxMessages) maxMessages = maxMessagesOrOptions.maxMessages;
      if (maxMessagesOrOptions.maxTokenBudget) maxTokenBudget = maxMessagesOrOptions.maxTokenBudget;
    }

    // 1. Filter valid non-empty messages
    const valid = messages.filter(
      m => m && typeof m.content === 'string' && m.content.trim().length > 0
    );

    if (valid.length === 0) {
      const empty = [];
      empty.tokensSaved = 0;
      return empty;
    }

    // Calculate raw uncompacted characters for savings calculation
    let rawChars = 0;
    valid.forEach(m => {
      rawChars += (m.content || '').length;
    });

    // 2. Work backwards from the newest message (newest user question has highest priority)
    const reversed = [...valid].reverse();
    const selectedReversed = [];
    let currentTokens = 0;

    for (let i = 0; i < reversed.length && selectedReversed.length < maxMessages; i++) {
      const msg = reversed[i];
      const compacted = this.compactText(msg.content);
      const estTokens = this.estimateTokenCount(compacted);

      // The most recent user prompt (i === 0) is always included
      if (i === 0 || (currentTokens + estTokens) <= maxTokenBudget) {
        selectedReversed.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: compacted
        });
        currentTokens += estTokens;
      } else {
        // Token budget reached; stop including older history to protect API limits
        break;
      }
    }

    // 3. Restore chronological order
    const result = selectedReversed.reverse();

    // 4. Calculate tokens saved by compaction and pruning
    let finalChars = 0;
    result.forEach(m => {
      finalChars += m.content.length;
    });

    const rawTokens = Math.ceil(rawChars / 4);
    const finalTokens = Math.ceil(finalChars / 4);
    const tokensSaved = Math.max(0, rawTokens - finalTokens);

    // Attach tokensSaved to array for caller consumption
    result.tokensSaved = tokensSaved;

    return result;
  }
}

module.exports = {
  PromptBuilder,
  DEFAULT_SYSTEM_PROMPT
};
