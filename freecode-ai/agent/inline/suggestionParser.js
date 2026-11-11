/**
 * Suggestion Parser for FreeCode AI Inline Completion Agent.
 * Cleans raw LLM outputs:
 * - Strips triple backtick markdown fences (```lang ... ```)
 * - Strips single and inline backticks (`code`)
 * - Removes conversational preamble ("Here is...", "Sure!...")
 * - Removes trailing explanations and commentary
 * - Overlap-based prefix and suffix deduplication
 * - Formats valid vscode.InlineCompletionItem objects without rigid zero-width range locks.
 */

const vscode = require('vscode');

class SuggestionParser {
  /**
   * Strip inline backticks: `code` -> code, ``code`` -> code, ```code``` -> code
   * Preserves valid code indentation and internal template literals.
   * @param {string} text
   * @returns {string}
   */
  static stripBackticks(text) {
    if (!text || typeof text !== 'string') return '';
    if (!text.includes('`')) return text;

    let t = text;

    // 1. If text (after trimming) is entirely enclosed in backticks: `code` or ```code```
    const trimmed = t.trim();
    const enclosedMatch = trimmed.match(/^(`+)([\s\S]*?)\1$/);
    if (enclosedMatch) {
      let inner = enclosedMatch[2];
      // If inner is single-line, trim stray whitespace adjacent to markdown backticks
      if (!inner.includes('\n')) {
        inner = inner.trim();
      }
      // Check if original text had leading indentation/newlines before the first backtick
      const leadingIndentMatch = t.match(/^([ \t]*\r?\n[ \t]*)/);
      if (leadingIndentMatch) {
        return leadingIndentMatch[1] + inner;
      }
      return inner;
    }

    // 2. Remove stray leading or trailing backticks that don't match balanced pairs
    t = t.replace(/^`+/, '').replace(/`+$/, '');

    return t;
  }

  /**
   * Strip prefix overlap between what the user already typed and the LLM completion.
   * e.g. prefix: "function add(", text: "add(a, b) {" -> "a, b) {"
   * @param {string} prefix
   * @param {string} text
   * @returns {string}
   */
  static stripPrefixOverlap(prefix, text) {
    if (!prefix || !text) return text;

    // 1. Exact prefix match
    if (text.startsWith(prefix)) {
      return text.substring(prefix.length);
    }

    // 2. Trimmed prefix match (ignoring indentation)
    const trimmedPrefix = prefix.trimStart();
    if (trimmedPrefix.length > 0 && text.startsWith(trimmedPrefix)) {
      return text.substring(trimmedPrefix.length);
    }

    // 3. Sliding overlap match
    const maxOverlap = Math.min(prefix.length, text.length);
    for (let len = maxOverlap; len > 0; len--) {
      const sub = text.substring(0, len);
      if (prefix.endsWith(sub)) {
        return text.substring(len);
      }
    }

    return text;
  }

  /**
   * Strip suffix overlap between the end of the LLM completion and what is already after cursor.
   * e.g. text: "price * qty;", suffix: ";" -> "price * qty"
   * @param {string} text
   * @param {string} suffix
   * @returns {string}
   */
  static stripSuffixOverlap(text, suffix) {
    if (!text || !suffix) return text;

    // 1. Exact suffix match
    if (text.endsWith(suffix)) {
      return text.slice(0, -suffix.length);
    }

    // 2. Trimmed suffix match
    const trimmedSuffix = suffix.trim();
    if (trimmedSuffix.length > 0 && text.endsWith(trimmedSuffix)) {
      return text.slice(0, -trimmedSuffix.length);
    }

    // 3. Sliding overlap match
    const maxOverlap = Math.min(text.length, suffix.length);
    for (let len = maxOverlap; len > 0; len--) {
      const sub = text.slice(-len);
      if (suffix.startsWith(sub)) {
        return text.slice(0, -len);
      }
    }

    return text;
  }

  /**
   * Clean raw completion text from LLM.
   * @param {string} rawText
   * @param {{
   *   linePrefix?: string,
   *   lineSuffix?: string,
   *   suffix?: string,
   *   indentation?: string
   * }} [context]
   * @returns {string}
   */
  static cleanText(rawText, context = {}) {
    if (!rawText || typeof rawText !== 'string') {
      return '';
    }

    let text = rawText.trimEnd();

    // 1. Remove markdown code fences if wrapped in triple backticks
    const fencedMatch = text.match(/^```(?:[a-zA-Z0-9_-]+)?\r?\n([\s\S]*?)(\r?\n```|$)/);
    if (fencedMatch) {
      text = fencedMatch[1];
    } else {
      // If no newline fence, strip outer ``` without swallowing valid code identifiers
      text = text.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    // 2. Remove inline backticks: `code` -> code
    text = SuggestionParser.stripBackticks(text);

    // 3. Remove conversational introductory lines
    const conversationalRegex = /^(Here is|Here's|Sure|Certainly|Below is|The completion is|Continuation:)[^\n]*:\s*\r?\n?/i;
    text = text.replace(conversationalRegex, '');

    // 4. Cut off trailing commentary or explanations
    const trailingCommentaryMatch = text.match(/\r?\n\s*(?:\/\/\s*Explanation|\/\*\s*Explanation|\/\/\s*Note|This (?:code|function|snippet)|Explanation:)/i);
    if (trailingCommentaryMatch && trailingCommentaryMatch.index !== undefined) {
      text = text.substring(0, trailingCommentaryMatch.index);
    }

    // 5. Overlap-based prefix deduplication (handles full and partial repetitions)
    if (context.linePrefix) {
      text = SuggestionParser.stripPrefixOverlap(context.linePrefix, text);
    }

    // 6. Overlap-based suffix deduplication (prevents double semicolons, braces, quotes)
    if (context.lineSuffix) {
      text = SuggestionParser.stripSuffixOverlap(text, context.lineSuffix);
    }

    // 7. Strip backticks again if exposed after deduplication
    text = SuggestionParser.stripBackticks(text);

    // 8. Deduplicate next line if it already exists in suffix
    if (context.suffix && typeof context.suffix === 'string') {
      const firstSuffixLine = context.suffix.split(/\r?\n/).find(l => l.trim().length > 0);
      if (firstSuffixLine) {
        const trimmedFirst = firstSuffixLine.trim();
        if (trimmedFirst.length > 0 && text.endsWith('\n' + trimmedFirst)) {
          text = text.slice(0, -('\n' + trimmedFirst).length);
        } else if (trimmedFirst.length > 0 && text.endsWith('\r\n' + trimmedFirst)) {
          text = text.slice(0, -('\r\n' + trimmedFirst).length);
        }
      }
    }

    // 9. Strip accidental leading empty lines if cursor is in middle of an unfinished expression
    if (context.linePrefix && context.linePrefix.trim().length > 0) {
      const lastChar = context.linePrefix.trim().slice(-1);
      if (!['{', ':', ';'].includes(lastChar)) {
        text = text.replace(/^\r?\n+/, '');
      }
    }

    return text;
  }

  /**
   * Parse LLM completion output into VS Code InlineCompletionItem array.
   * @param {string} rawText
   * @param {object} context - context from ContextManager
   * @param {vscode.Position} [context.position]
   * @param {string} [context.linePrefix]
   * @param {string} [context.lineSuffix]
   * @param {string} [context.suffix]
   * @returns {vscode.InlineCompletionItem[]}
   */
  static parse(rawText, context = {}) {
    const cleaned = SuggestionParser.cleanText(rawText, context);

    if (!cleaned || cleaned.trim().length === 0) {
      return [];
    }

    let item;
    if (typeof vscode.InlineCompletionItem === 'function') {
      // In official VS Code API, omitting range allows native insertion at current cursor position
      // without being dropped if the cursor shifts during asynchronous completion
      item = new vscode.InlineCompletionItem(cleaned);
      if (context.range) {
        item.range = context.range;
      }
    } else {
      item = {
        insertText: cleaned,
        range: context.range || null
      };
    }

    return [item];
  }
}

module.exports = { SuggestionParser };
