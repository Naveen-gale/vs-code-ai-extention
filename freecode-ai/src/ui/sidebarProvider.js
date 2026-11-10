/**
 * FreeCode AI Sidebar View Provider.
 * Embeds the full-featured Chat and Provider management interface into the VS Code Activity Bar.
 */

const vscode = require('vscode');
const { ChatProvider } = require('./chatProvider');

class FreeCodeSidebarProvider {
  /**
   * @param {vscode.Uri} extensionUri
   * @param {object} [dependencies]
   * @param {import('../chat/chatController').ChatController} [dependencies.chatController]
   * @param {import('../security/secretManager').SecretManager} [dependencies.secretManager]
   * @param {import('../usage/usageTracker').UsageTracker} [dependencies.usageTracker]
   * @param {import('../providers/providerManager').ProviderManager} [dependencies.providerManager]
   */
  constructor(extensionUri, dependencies = {}) {
    this.extensionUri = extensionUri;
    this.chatController = dependencies.chatController;
    this.secretManager = dependencies.secretManager;
    this.usageTracker = dependencies.usageTracker;
    this.providerManager = dependencies.providerManager;
    this._view = null;
    this.chatProvider = null;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;

    // Instantiate ChatProvider bridge
    this.chatProvider = new ChatProvider({
      extensionUri: this.extensionUri,
      chatController: this.chatController,
      secretManager: this.secretManager,
      usageTracker: this.usageTracker,
      providerManager: this.providerManager
    });

    this.chatProvider.attachWebview(webviewView);
  }

  /**
   * Helper to post messages directly to webview if needed.
   */
  postMessage(msg) {
    if (this.chatProvider) {
      this.chatProvider.postMessage(msg);
    }
  }
}

module.exports = {
  FreeCodeSidebarProvider,
  SidebarProvider: FreeCodeSidebarProvider
};
