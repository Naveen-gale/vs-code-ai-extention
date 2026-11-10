/**
 * Chat Webview Provider & Message Bridge.
 * Connects the Webview UI to ChatController, SecretManager, ModelDiscovery, and UsageTracker.
 */

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { PROVIDERS, PROVIDER_METADATA } = require('../config/providers');
const { ModelDiscovery } = require('../providers/modelDiscovery');
const { getDefaultModels } = require('../config/modelRegistry');

class ChatProvider {
  /**
   * @param {object} options
   * @param {vscode.Uri} options.extensionUri
   * @param {import('../chat/chatController').ChatController} options.chatController
   * @param {import('../security/secretManager').SecretManager} options.secretManager
   * @param {import('../usage/usageTracker').UsageTracker} options.usageTracker
   */
  constructor({ extensionUri, chatController, secretManager, usageTracker }) {
    this.extensionUri = extensionUri;
    this.chatController = chatController;
    this.secretManager = secretManager;
    this.usageTracker = usageTracker;
    this._view = null;
  }

  /**
   * Bind a WebviewView instance and setup message listeners.
   * @param {vscode.WebviewView} webviewView
   */
  attachWebview(webviewView) {
    this._view = webviewView;

    const webviewPath = path.join(this.extensionUri.fsPath, 'src', 'ui', 'webview');
    const mediaPath = path.join(this.extensionUri.fsPath, 'media');

    const resourceRoots = [
      vscode.Uri.file(webviewPath),
      vscode.Uri.file(mediaPath)
    ];

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: resourceRoots
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      try {
        await this.handleMessage(message);
      } catch (err) {
        console.error('FreeCode AI: Unhandled webview message error:', err);
        this.postMessage({
          type: 'status',
          status: 'error',
          message: err.message
        });
      }
    });
  }

  /**
   * Post message to webview safely.
   */
  postMessage(message) {
    if (this._view && this._view.webview && typeof this._view.webview.postMessage === 'function') {
      this._view.webview.postMessage(message);
    }
  }

  /**
   * Handle incoming messages from the Webview.
   */
  async handleMessage(message) {
    switch (message.command) {
      case 'webviewReady':
        await this.sendInitialState();
        break;

      case 'sendMessage':
        await this.handleUserMessage(message.text);
        break;

      case 'newChat':
      case 'clearChat':
        if (this.chatController) this.chatController.newChat();
        this.postMessage({ type: 'chatCleared' });
        break;

      case 'providerSelected':
        await this.handleProviderSelected(message.provider);
        break;

      case 'saveApiKey':
        await this.handleSaveApiKey(message.provider, message.apiKey);
        break;

      case 'saveEndpoint':
        if (this.chatController) this.chatController.setOllamaEndpoint(message.endpoint);
        this.postMessage({
          type: 'connectionResult',
          success: true,
          message: `Ollama endpoint updated to: ${message.endpoint}`
        });
        await this.handleProviderSelected('ollama');
        break;

      case 'testConnection':
        await this.handleTestConnection(message.provider, message.endpoint);
        break;

      case 'fetchModels':
        await this.handleFetchModels(message.provider);
        break;

      case 'selectModel':
        if (this.chatController) this.chatController.setModel(message.model);
        await this.sendStateUpdate();
        break;

      case 'getDashboardData':
        this.sendDashboardData(message.provider);
        break;

      case 'resetUsage':
        if (this.usageTracker) {
          await this.usageTracker.reset(message.provider === 'current' ? null : message.provider);
        }
        this.sendDashboardData(message.provider);
        vscode.window.showInformationMessage('FreeCode AI: Usage metrics have been reset.');
        break;

      // Compatibility with Day 1 legacy triggers
      case 'selectProvider':
        await vscode.commands.executeCommand('freecodeAI.selectProvider');
        break;

      case 'showStatus':
        await vscode.commands.executeCommand('freecodeAI.showStatus');
        break;

      default:
        console.warn(`FreeCode AI: Unknown message: ${message.command}`);
    }
  }

  async sendInitialState() {
    const state = this.chatController ? await this.chatController.getState() : { provider: 'gemini', model: 'gemini-1.5-flash' };
    const models = await this.getModelsForProvider(state.provider);

    this.postMessage({
      type: 'init',
      state: {
        ...state,
        messages: this.chatController ? this.chatController.getMessages() : [],
        models
      }
    });
  }

  async sendStateUpdate() {
    if (!this.chatController) return;
    const state = await this.chatController.getState();
    this.postMessage({
      type: 'stateUpdated',
      state
    });
  }

  async getModelsForProvider(providerId) {
    const apiKey = this.secretManager ? await this.secretManager.getApiKey(providerId) : null;
    return await ModelDiscovery.fetchModels(providerId, {
      apiKey,
      endpoint: this.chatController ? this.chatController.ollamaEndpoint : 'http://127.0.0.1:11434'
    });
  }

  async handleUserMessage(text) {
    // 1. Immediately echo user message to UI
    this.postMessage({
      type: 'messageAdded',
      message: {
        role: 'user',
        content: text
      }
    });

    // 2. Set thinking status
    this.postMessage({
      type: 'status',
      status: 'thinking',
      message: 'FreeCode AI is analyzing & generating...'
    });

    try {
      if (!this.chatController) {
        throw new Error('ChatController is not initialized.');
      }

      // 3. Delegate to ChatController
      const result = await this.chatController.sendMessage(text);

      // 4. Return assistant response
      this.postMessage({
        type: 'messageAdded',
        message: result.assistantMessage
      });

      this.postMessage({ type: 'status', status: 'ready' });
    } catch (err) {
      this.postMessage({
        type: 'messageAdded',
        message: {
          role: 'assistant',
          content: `⚠️ ${err.message}`,
          error: true
        }
      });
      this.postMessage({ type: 'status', status: 'ready' });
    }
  }

  async handleProviderSelected(providerId) {
    if (this.chatController) {
      this.chatController.setProvider(providerId);
    }
    const models = await this.getModelsForProvider(providerId);

    this.postMessage({
      type: 'modelsUpdated',
      provider: providerId,
      models,
      activeModel: this.chatController ? this.chatController.activeModel : null
    });

    await this.sendStateUpdate();
  }

  async handleSaveApiKey(providerId, apiKey) {
    if (this.secretManager) {
      await this.secretManager.storeApiKey(providerId, apiKey);
    }
    this.postMessage({
      type: 'connectionResult',
      success: true,
      message: `API Key securely saved for ${PROVIDER_METADATA[providerId]?.name || providerId}.`
    });

    // Automatically refresh models after saving key
    await this.handleFetchModels(providerId);
  }

  async handleTestConnection(providerId, customEndpoint) {
    const meta = PROVIDER_METADATA[providerId] || {};
    let apiKey = null;

    if (meta.requiresApiKey && this.secretManager) {
      apiKey = await this.secretManager.getApiKey(providerId);
      if (!apiKey) {
        this.postMessage({
          type: 'connectionResult',
          success: false,
          message: `API key not found for ${meta.name}. Please enter and save your key first.`
        });
        return;
      }
    }

    try {
      const { ProviderFactory } = require('../providers/providerFactory');
      const endpoint = customEndpoint || (this.chatController ? this.chatController.ollamaEndpoint : 'http://127.0.0.1:11434');
      const providerInstance = ProviderFactory.create(providerId, {
        apiKey,
        endpoint
      });

      const res = await providerInstance.testConnection();
      this.postMessage({
        type: 'connectionResult',
        success: res.success,
        message: res.message
      });
    } catch (err) {
      this.postMessage({
        type: 'connectionResult',
        success: false,
        message: err.message || 'Connection failed'
      });
    }
  }

  async handleFetchModels(providerId) {
    const models = await this.getModelsForProvider(providerId);
    this.postMessage({
      type: 'modelsUpdated',
      provider: providerId,
      models,
      activeModel: this.chatController ? this.chatController.activeModel : null
    });
  }

  sendDashboardData(providerFilter) {
    if (!this.usageTracker || !this.chatController) return;

    const p = (!providerFilter || providerFilter === 'current')
      ? this.chatController.activeProvider
      : providerFilter;

    const data = this.usageTracker.getDashboardData(p, this.chatController.activeModel);
    this.postMessage({
      type: 'dashboardData',
      data
    });
  }

  /**
   * Produce the HTML with webview-safe URIs.
   * @param {vscode.Webview} webview
   */
  getHtml(webview) {
    const webviewDir = path.join(this.extensionUri.fsPath, 'src', 'ui', 'webview');
    const htmlPath = path.join(webviewDir, 'index.html');

    let html = fs.readFileSync(htmlPath, 'utf8');

    if (webview && typeof webview.asWebviewUri === 'function') {
      const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(webviewDir, 'style.css')));
      const appUri = webview.asWebviewUri(vscode.Uri.file(path.join(webviewDir, 'app.js')));

      html = html.replace('href="style.css"', `href="${styleUri}"`);
      html = html.replace('src="app.js"', `src="${appUri}"`);
    }

    return html;
  }
}

module.exports = { ChatProvider };
