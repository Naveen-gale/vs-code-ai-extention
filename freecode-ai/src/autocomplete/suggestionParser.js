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
    const { InlineQualityPipeline } = require('./qualityPipeline');
    return InlineQualityPipeline.postProcess(rawText, context);
  }
}

module.exports = { SuggestionParser };
