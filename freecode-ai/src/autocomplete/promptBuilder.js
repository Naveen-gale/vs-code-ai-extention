'use strict';

/**
 * Prompt Builder for Inline Code Completions.
 * Supports both FIM (Fill-In-the-Middle) format for local/specialized models
 * and clean instruction format for cloud chat models.
 */
class PromptBuilder {
  /**
   * Build standard FIM prompt for models supporting prefix/suffix markers.
   * @param {{ prefix: string, suffix: string, language?: string }} param0
   * @returns {string}
   */
  static buildFIMPrompt({ prefix, suffix }) {
    return `<PRE> ${prefix} <SUF> ${suffix} <MID>`;
  }

  /**
   * Builds completion messages for chat-based providers (Gemini, Groq, OpenAI, Mistral, etc.).
   * @param {object} context
   * @param {string} context.prefix
   * @param {string} context.suffix
   * @param {string} context.language
   * @param {string} [context.linePrefix]
   * @returns {Array<{ role: string, content: string }>}
   */
  static buildChatMessages({ prefix, suffix, language, linePrefix }) {
    const systemPrompt =
      `You are an ultra-fast, high-accuracy inline code autocomplete engine for ${language || 'code'}.\n` +
      `Your task is to predict the code that belongs immediately at the cursor position.\n` +
      `CRITICAL RULES:\n` +
      `1. Return ONLY the raw code completion.\n` +
      `2. Never output markdown code fences (\`\`\`).\n` +
      `3. Never output conversational explanations or notes.\n` +
      `4. Do not repeat the code already present before the cursor.\n` +
      `5. Keep the completion concise, syntactically correct, and matching the indentation.`;

    const userContent =
      `[LANGUAGE: ${language}]\n` +
      `[CODE BEFORE CURSOR]:\n${prefix}\n` +
      (suffix ? `[CODE AFTER CURSOR]:\n${suffix}\n` : '') +
      `[CONTINUE CODE AT CURSOR]:`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ];
  }
}

module.exports = { PromptBuilder };
