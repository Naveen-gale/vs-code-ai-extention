const vscode = require('vscode');

const fileTools = {
  async readFile(uri) {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf8');
  },
  async writeFile(uri, content) {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
  }
};

module.exports = { fileTools };
