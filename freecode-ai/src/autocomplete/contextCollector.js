'use strict';

const vscode = require('vscode');

class ContextCollector {
  /**
   * Supported languages for inline suggestions.
   */
  static get SUPPORTED_LANGUAGES() {
    return new Set([
      'javascript', 'javascriptreact', 'typescript', 'typescriptreact',
      'python', 'html', 'css', 'json', 'markdown', 'java', 'c', 'cpp',
      'csharp', 'go', 'rust', 'php', 'ruby', 'shellscript', 'sql',
      'plaintext', 'vue', 'svelte', 'dart', 'kotlin', 'swift', 'yaml',
      'xml', 'scss', 'less', 'dockerfile', 'lua', 'r', 'scala', 'perl',
      'powershell', 'bat', 'ini', 'toml', 'latex', 'graphql'
    ]);
  }

  /**
   * Collects bounded code context around cursor position.
   * Enforces token limits (prefix + suffix <= maxInputTokens) and sanitizes sensitive data.
   * @param {import('vscode').TextDocument} document
   * @param {import('vscode').Position} position
   * @param {object} [options]
   * @param {number} [options.maxInputTokens=1500]
   * @returns {{ prefix: string, suffix: string, linePrefix: string, lineSuffix: string, language: string, line: number, isMeaningful: boolean }}
   */
  static collectBounded(document, position, options = {}) {
    if (!document || !position) {
      return { prefix: '', suffix: '', linePrefix: '', lineSuffix: '', language: 'plaintext', line: 0, isMeaningful: false };
    }

    const language = document.languageId || 'plaintext';
    const maxTokens = options.maxInputTokens || 1500;
    // Rule of thumb: ~4 characters per token
    const maxChars = maxTokens * 4;
    const prefixChars = Math.floor(maxChars * 0.8);
    const suffixChars = Math.floor(maxChars * 0.2);

    const currentLine = document.lineAt(position.line);
    const linePrefix = currentLine.text.substring(0, position.character);
    const lineSuffix = currentLine.text.substring(position.character);

    const cursorOffset = document.offsetAt(position);
    const lastLine = document.lineAt(document.lineCount - 1);
    const documentEnd = document.offsetAt(new vscode.Position(document.lineCount - 1, lastLine.text.length));
    const prefixStart = document.positionAt(Math.max(0, cursorOffset - prefixChars));
    const suffixEnd = document.positionAt(Math.min(documentEnd, cursorOffset + suffixChars));
    const rawPrefix = document.getText(new vscode.Range(prefixStart, position));
    const rawSuffix = document.getText(new vscode.Range(position, suffixEnd));

    // Sanitize credentials
    const prefix = this.sanitizeContent(rawPrefix);
    const suffix = this.sanitizeContent(rawSuffix);

    // Determine if context is meaningful for requesting a suggestion
    const trimmedLine = linePrefix.trim();
    // Meaningful if: line has characters, or preceding lines have code context
    const hasCodeContext = prefix.trim().length > 0;
    const isMeaningful = (trimmedLine.length > 0 || hasCodeContext) && !this.isIgnoredFile(document.fileName);

    return {
      prefix,
      suffix,
      linePrefix,
      lineSuffix,
      language,
      line: position.line,
      isMeaningful
    };
  }

  /**
   * Redacts API keys, secrets, tokens, and passwords from prompts.
   * @param {string} text
   * @returns {string}
   */
  static sanitizeContent(text) {
    if (!text || typeof text !== 'string') return '';
    return text
      .replace(/AIza[A-Za-z0-9_-]{30,40}/g, '[REDACTED_KEY]')
      .replace(/sk-[a-zA-Z0-9_-]{20,}/g, '[REDACTED_KEY]')
      .replace(/gsk_[a-zA-Z0-9_-]{20,}/g, '[REDACTED_KEY]')
      .replace(/nvapi-[a-zA-Z0-9_-]{20,}/g, '[REDACTED_KEY]')
      .replace(/(?:API[_-]?KEY|SECRET|PASSWORD|TOKEN)\s*[:=]\s*["']?[A-Za-z0-9_\-\.\/+=]{8,}["']?/gi, '$1=[REDACTED]');
  }

  /**
   * Checks whether a file should be ignored from inline AI completion.
   * @param {string} fileName
   * @returns {boolean}
   */
  static isIgnoredFile(fileName) {
    if (!fileName) return false;
    const lower = fileName.toLowerCase();
    if (lower.includes('.env') || lower.endsWith('.key') || lower.endsWith('.pem') || lower.endsWith('.cert')) {
      return true;
    }
    if (lower.includes('node_modules') || lower.includes('.git')) {
      return true;
    }
    return false;
  }
}

module.exports = { ContextCollector };
