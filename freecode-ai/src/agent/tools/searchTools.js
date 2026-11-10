const vscode = require('vscode');

const searchTools = {
  async findFiles(pattern) {
    return await vscode.workspace.findFiles(pattern);
  }
};

module.exports = { searchTools };
