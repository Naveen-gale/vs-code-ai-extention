const vscode = require('vscode');

class DashboardProvider {
  static createOrShow(extensionUri) {
    const panel = vscode.window.createWebviewPanel(
      'freecodeAiDashboard',
      'FreeCode AI Dashboard',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );
    return panel;
  }
}

module.exports = { DashboardProvider };
