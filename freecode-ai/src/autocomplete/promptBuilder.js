'use strict';

/**
 * Prompt Builder for Inline Code Completions.
 * Supports both FIM (Fill-In-the-Middle) format for local/specialized models
 * and clean instruction format for cloud chat models.
 */
class PromptBuilder {
  static buildInlineCompletionMessages(context = {}) {
    const language = context.language || 'plaintext';
    const relevant = [
      context.imports && context.imports.length ? `Existing imports: ${context.imports.join(', ')}` : '',
      context.declarations && context.declarations.length ? `Existing functions: ${context.declarations.join(', ')}` : '',
      context.variables && context.variables.length ? `Existing variables: ${context.variables.join(', ')}` : '',
      context.classes && context.classes.length ? `Existing classes: ${context.classes.join(', ')}` : ''
    ].filter(Boolean);

    const systemPrompt =
      `You are a code-completion engine for ${language}.\n` +
      `Predict only the next code at the cursor and return only the exact text to insert.\n` +
      `Never explain, describe the task, reveal reasoning, or include conversational text.\n` +
      `Never repeat code before the cursor or return the source file.\n` +
      `Never include Markdown fences or formatting.\n` +
      `Follow the language, existing project symbols, indentation, and surrounding code.\n` +
      `Continue incomplete statements correctly and do not duplicate code after the cursor.\n` +
      `If no reliable code completion is possible, return an empty response.`;

    const userContent =
      `Language: ${language}\n` +
      (relevant.length ? `Project context:\n${relevant.join('\n')}\n` : '') +
      `Code before cursor:\n${context.prefix || ''}\n` +
      `<CURSOR>\n` +
      `Code after cursor:\n${context.suffix || ''}\n` +
      `Return only the insertion text.`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ];
  }

  static buildInlineCompletionPrompt(context = {}) {
    const messages = PromptBuilder.buildInlineCompletionMessages(context);
    return `${messages[0].content}\n\n${messages[1].content}`;
  }

  static buildQualityChatMessages(context) {
    const { InlineQualityPipeline } = require('./qualityPipeline');
    return InlineQualityPipeline.buildPrompt(context);
  }
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
