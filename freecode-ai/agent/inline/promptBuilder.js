/**
 * Prompt Builder for Laven Inline Completion Agent.
 * Generates compact, context-aware prompts for high-accuracy inline code completions.
 */

const INLINE_SYSTEM_PROMPT = `You are Laven, an intelligent inline code completion engine.

Your task is to continue the user's code at the cursor position.

RULES:

1. Generate only code that belongs at the cursor.
2. Never repeat code that already exists.
3. Follow the current programming language.
4. Follow the existing indentation and formatting.
5. Respect variable names and function names already in use.
6. Follow the surrounding code style.
7. Prefer concise, useful and correct suggestions.
8. Do not explain the code.
9. Do not include conversational text.
10. Do not use Markdown code fences. Never wrap the code in backticks (\`code\`).
11. Do not add unnecessary comments.
12. Return an empty response if no useful completion is possible.

Return only the code that should be inserted at the cursor without quotes or backticks.`;

class PromptBuilder {
  /**
   * Get the standard inline system prompt.
   * @returns {string}
   */
  static getSystemPrompt() {
    return INLINE_SYSTEM_PROMPT;
  }

  /**
   * Build completion prompt messages from extracted editor context.
   * @param {{
   *   languageId: string,
   *   fileName?: string,
   *   prefix: string,
   *   suffix: string,
   *   linePrefix: string,
   *   lineSuffix: string,
   *   position?: { line: number, character: number },
   *   indentation?: string
   * }} context
   * @param {object} [options]
   * @param {number} [options.maxPromptChars=2500]
   * @returns {{
   *   systemPrompt: string,
   *   messages: Array<{ role: string, content: string }>,
   *   promptText: string
   * }}
   */
  static buildPrompt(context, options = {}) {
    if (!context) {
      return {
        systemPrompt: INLINE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: '' }],
        promptText: ''
      };
    }

    const language = context.languageId || 'plaintext';
    const fileName = context.fileName || 'file';
    const maxChars = options.maxPromptChars || 1200;

    // Compress consecutive blank lines to minimize token consumption
    let prefix = (context.prefix || '').replace(/(\r?\n\s*){3,}/g, '\n\n');
    let suffix = (context.suffix || '').replace(/(\r?\n\s*){3,}/g, '\n\n');

    // Truncate prefix if too long, keeping the end closest to cursor
    if (prefix.length > maxChars * 0.75) {
      prefix = prefix.slice(-Math.floor(maxChars * 0.75));
    }

    // Truncate suffix if too long, keeping the beginning closest to cursor
    if (suffix.length > maxChars * 0.25) {
      suffix = suffix.slice(0, Math.floor(maxChars * 0.25));
    }

    const linePrefix = context.linePrefix || '';
    const lineSuffix = context.lineSuffix || '';

    const promptText = `Language: ${language}
File: ${fileName}

--- CODE BEFORE CURSOR ---
${prefix}
--- CURSOR POSITION ---
--- CODE AFTER CURSOR ---
${suffix}

Current line before cursor: "${linePrefix}"
Current line after cursor: "${lineSuffix}"

Generate only the immediate code continuation at the cursor. Do not repeat the prefix or suffix, and never wrap code in backticks:`;

    const messages = [
      {
        role: 'user',
        content: promptText
      }
    ];

    return {
      systemPrompt: INLINE_SYSTEM_PROMPT,
      messages,
      promptText
    };
  }
}

module.exports = {
  PromptBuilder,
  INLINE_SYSTEM_PROMPT
};
