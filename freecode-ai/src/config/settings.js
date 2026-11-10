const vscode = require('vscode');

function getConfiguration() {
  return vscode.workspace.getConfiguration('freecodeAi');
}

module.exports = {
  getConfiguration
};
