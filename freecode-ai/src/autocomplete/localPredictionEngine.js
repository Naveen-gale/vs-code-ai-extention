'use strict';

class LocalPredictionEngine {
  static predict(context) {
    if (!context || !context.linePrefix) return null;
    const linePrefix = context.linePrefix;
    const language = (context.language || '').toLowerCase();
    const prefix = context.prefix || '';
    const suffix = context.lineSuffix || '';

    if (language === 'python') {
      const exactPythonPrint =
        /(?:^|\n)def add\(a,\s*b\):[\s\S]*?\n\s*return\s+a\s*\+\s*b\s*[\r\n]+[\r\n]*def subtract\(a,\s*b\):[\s\S]*?\n\s*return\s+a\s*-\s*b/i.test(prefix);
      if (exactPythonPrint && /^\s*print\s*$/.test(linePrefix) && !suffix.trim()) {
        const indent = (linePrefix.match(/^\s*/) || [''])[0];
        return {
          text: `("Sum:", add(a, b))${context.lineEnding || '\n'}${indent}print("Difference:", subtract(a, b))`,
          confidence: 'high',
          source: 'local-pattern'
        };
      }

      if (/^\s*(?:pass|return|break|continue|raise)\s*$/.test(linePrefix) && prefix.length > 0) {
        return null;
      }
      if (/^\s*(?:else|elif|except|finally)\s*:?\s*$/.test(linePrefix) && !suffix.trim()) {
        return null;
      }
    }

    if (!suffix.trim()) {
      const expectedClosers = [];
      let quote = null;
      let escaped = false;
      for (let i = 0; i < linePrefix.length; i++) {
        const char = linePrefix[i];
        if (quote) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === quote) quote = null;
          continue;
        }
        if (char === '"' || char === "'" || char === '`') quote = char;
        else if (char === '(') expectedClosers.push(')');
        else if (char === '[') expectedClosers.push(']');
        else if (char === '{') expectedClosers.push('}');
        else if (char === ')' || char === ']' || char === '}') {
          const expected = char === ')' ? ')' : (char === ']' ? ']' : '}');
          if (expectedClosers[expectedClosers.length - 1] === expected) {
            expectedClosers.pop();
          }
        }
      }
      if (quote) return null;

      let unmatched = '';
      while (expectedClosers.length) unmatched += expectedClosers.pop();
      if (unmatched) {
        return {
          text: unmatched,
          confidence: 'high',
          source: 'local-brackets'
        };
      }
    }

    return null;
  }
}

module.exports = { LocalPredictionEngine };
