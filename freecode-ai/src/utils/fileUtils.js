const vscode = require('vscode');

class FileUtils {
  static async exists(uri) {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = { FileUtils };
