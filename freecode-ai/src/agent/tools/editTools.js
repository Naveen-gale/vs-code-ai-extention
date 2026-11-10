const vscode = require('vscode');

const editTools = {
  async applyEdit(uri, range, newText) {
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.replace(uri, range, newText);
    return await vscode.workspace.applyEdit(workspaceEdit);
  }
};

module.exports = { editTools };
