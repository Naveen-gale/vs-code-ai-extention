const vscode = require('vscode');

class Logger {
  static outputChannel = null;

  static init() {
    if (!Logger.outputChannel) {
      Logger.outputChannel = vscode.window.createOutputChannel('FreeCode AI');
    }
  }

  static info(message) {
    Logger.init();
    Logger.outputChannel.appendLine('[INFO] ' + new Date().toISOString() + ' - ' + message);
  }

  static error(message, err) {
    Logger.init();
    Logger.outputChannel.appendLine('[ERROR] ' + new Date().toISOString() + ' - ' + message + ' ' + (err ? (err.stack || err) : ''));
  }
}

module.exports = { Logger };
