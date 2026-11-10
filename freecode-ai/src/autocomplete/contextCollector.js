const vscode = require('vscode');

class ContextCollector {
  static collect(document, position) {
    const textBefore = document.getText(
      new vscode.Range(new vscode.Position(0, 0), position)
    );
    return { textBefore };
  }
}

module.exports = { ContextCollector };
