'use strict';

/**
 * Suggestion Parser & Formatter for Inline Completions.
 * Strips conversational artifacts, markdown code fences, and avoids
 * duplicating linePrefix or lineSuffix.
 */
class SuggestionParser {
  /**
   * Cleans and sanitizes raw LLM output into a clean inline completion string.
   * @param {string} rawText
   * @param {object} [context]
   * @param {string} [context.linePrefix]
   * @param {string} [context.lineSuffix]
   * @returns {string}
   */
  static parse(rawText, context = {}) {
    if (!rawText || typeof rawText !== 'string') return '';
    try {
      const { InlineQualityPipeline } = require('./qualityPipeline');
      if (context.language) {
        return InlineQualityPipeline.postProcess(rawText, context);
      }
    } catch (_) {}

    let text = rawText;

    // 1. Remove markdown fences (e.g. ```javascript ... ``` or ``` ...)
    text = text.replace(/^```[a-zA-Z0-9_\-]*\r?\n?/i, '');
    text = text.replace(/\r?\n?```\s*$/i, '');
    text = text.replace(/```/g, '');

    // 2. Remove conversational introductions / chatty intros
    const conversationalIntros = [
      /^(?:Here(?:'s| is) (?:the |your )?(?:code|completion|suggestion|solution|snippet):?)/i,
      /^(?:Sure(?: thing)?,? (?:here(?:'s| is) )?(?:the |your )?(?:code|snippet):?)/i,
      /^(?:I have (?:completed|written) the code:?)/i,
      /^(?:Output:?)/i,
      /^(?:Solution:?)/i
    ];

    for (const pat of conversationalIntros) {
      text = text.replace(pat, '').trimStart();
    }

    // 3. Remove FIM token leakage (e.g. <MID>, <PRE>, <SUF>, <EOT>, <FILL_ME>, <|endoftext|>)
    text = text.replace(/<MID>|<PRE>|<SUF>|<EOT>|<FILL_ME>|<\|endoftext\|>|<\|fim_prefix\|>|<\|fim_suffix\|>|<\|fim_middle\|>/g, '');

    // 4. Handle prefix overlap: if suggestion repeats what is already at the end of linePrefix
    const prefix = context.linePrefix || '';
    if (prefix && text.startsWith(prefix.trim())) {
      text = text.slice(prefix.trim().length);
    } else if (prefix) {
      // Check partial overlap (up to 30 characters)
      const maxOverlap = Math.min(30, prefix.length, text.length);
      for (let len = maxOverlap; len > 0; len--) {
        const tail = prefix.slice(-len);
        if (text.startsWith(tail)) {
          text = text.slice(len);
          break;
        }
      }
    }

    // 5. Handle suffix overlap: if suggestion duplicates what is immediately after the cursor
    const suffix = (context.lineSuffix || '').trim();
    if (suffix && text.endsWith(suffix)) {
      text = text.slice(0, -suffix.length);
    }

    return text;
  }
}

module.exports = { SuggestionParser };
