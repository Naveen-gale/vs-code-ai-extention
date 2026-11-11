/**
 * Context Manager for FreeCode AI Inline Completion Agent.
 * Extracts code prefix, suffix, language, and indentation context around the cursor position
 * with safe boundary checking to prevent editor crashes.
 */

const vscode = require('vscode');

class ContextManager {
  /**
   * Extract completion context from active text document and cursor position.
   * @param {vscode.TextDocument} document
   * @param {vscode.Position} position
   * @param {object} [options]
   * @param {number} [options.maxContextLines=40]
   * @returns {{
   *   languageId: string,
   *   fileName: string,
   *   prefix: string,
   *   suffix: string,
   *   linePrefix: string,
   *   lineSuffix: string,
   *   position: vscode.Position,
   *   indentation: string
   * }|null}
   */
  static getContext(document, position, options = {}) {
    if (!document || !position) {
      return null;
    }

    try {
      const maxContextLines = options.maxContextLines || 40;
      const languageId = document.languageId || 'plaintext';
      const fileName = document.fileName ? document.fileName.split(/[\\/]/).pop() : 'untitled';
      const lineCount = document.lineCount || 1;

      // Safe line index bounds
      const currentLineIdx = Math.max(0, Math.min(position.line, lineCount - 1));

      // 1. Calculate prefix range (up to 75% of maxContextLines before cursor)
      const prefixLineCount = Math.floor(maxContextLines * 0.75);
      const startLine = Math.max(0, currentLineIdx - prefixLineCount);
      const startPos = new vscode.Position(startLine, 0);
      const prefix = document.getText(new vscode.Range(startPos, position));

      // 2. Calculate suffix range (up to 25% of maxContextLines after cursor)
      const suffixLineCount = Math.max(5, Math.floor(maxContextLines * 0.25));
      const endLine = Math.min(lineCount - 1, currentLineIdx + suffixLineCount);
      const endLineText = (endLine >= 0 && endLine < lineCount) ? document.lineAt(endLine).text : '';
      const endPos = new vscode.Position(endLine, endLineText.length);
      const suffix = document.getText(new vscode.Range(position, endPos));

      // 3. Current line context
      const currentLine = (currentLineIdx >= 0 && currentLineIdx < lineCount)
        ? document.lineAt(currentLineIdx)
        : { text: '' };
      const lineText = currentLine.text || '';
      const charPos = Math.max(0, Math.min(position.character, lineText.length));
      const linePrefix = lineText.substring(0, charPos);
      const lineSuffix = lineText.substring(charPos);

      // 4. Detect indentation style and current line indent
      const indentMatch = lineText.match(/^([ \t]*)/);
      const indentation = indentMatch ? indentMatch[1] : '';

      return {
        languageId,
        fileName,
        prefix,
        suffix,
        linePrefix,
        lineSuffix,
        position,
        indentation
      };
    } catch (err) {
      console.warn('FreeCode AI: ContextManager error:', err);
      return null;
    }
  }
}

module.exports = { ContextManager };
