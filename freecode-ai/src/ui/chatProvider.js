/**
 * Chat Webview Provider & Message Bridge.
 * Connects the Webview UI to ChatController, ProviderManager, SecretManager,
 * ModelDiscovery, and UsageTracker.
 */

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { PROVIDERS, PROVIDER_METADATA } = require('../config/providers');
const { ModelDiscovery } = require('../providers/modelDiscovery');
const { FallbackManager } = require('../router/fallbackManager');

class ChatProvider {
  /**
   * @param {object} options
   * @param {vscode.Uri} options.extensionUri
   * @param {import('../chat/chatController').ChatController} options.chatController
   * @param {import('../security/secretManager').SecretManager} options.secretManager
   * @param {import('../usage/usageTracker').UsageTracker} options.usageTracker
   * @param {import('../providers/providerManager').ProviderManager} [options.providerManager]
   */
  constructor({ extensionUri, chatController, secretManager, usageTracker, providerManager = null }) {
    this.extensionUri = extensionUri;
    this.chatController = chatController;
    this.secretManager = secretManager;
    this.usageTracker = usageTracker;
    this.providerManager = providerManager;
    this.fallbackManager = new FallbackManager(providerManager, usageTracker);
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
    if (!message || !message.command) return;

    switch (message.command) {
      case 'webviewReady':
        await this.sendInitialState();
        await this.sendProvidersList();
        break;

      case 'sendMessage':
        await this.handleUserMessage(message.text);
        break;

      case 'newChat':
      case 'clearChat':
        if (this.chatController) this.chatController.newChat();
        this.postMessage({ type: 'chatCleared' });
        break;

      case 'getProvidersList':
        await this.sendProvidersList();
        break;

      case 'switchProvider':
        await this.handleSwitchProvider(message.provider);
        break;

      // Legacy trigger
      case 'providerSelected':
        await this.handleSwitchProvider(message.provider);
        break;

      case 'saveApiKey':
        await this.handleSaveApiKey(message.provider, message.apiKey, {
          activate: message.activate,
          model: message.model
        });
        break;

      case 'saveEndpoint':
        await this.handleSaveEndpoint(message.endpoint, {
          activate: message.activate,
          model: message.model
        });
        break;

      case 'testConnection':
        await this.handleTestConnection(message.provider, message.endpoint);
        break;

      case 'saveAndTestConnection':
        if (message.provider === PROVIDERS.OLLAMA) {
          if (message.endpoint) {
            await this.handleSaveEndpoint(message.endpoint, { activate: false });
          }
        } else if (message.apiKey) {
          await this.handleSaveApiKey(message.provider, message.apiKey, { activate: false });
        }
        await this.handleTestConnection(message.provider, message.endpoint);
        await this.handleFetchModels(message.provider);
        break;

      case 'removeProvider':
        await this.handleRemoveProvider(message.provider);
        break;

      case 'fetchModels':
        await this.handleFetchModels(message.provider);
        break;

      case 'selectModel':
        await this.handleSelectModel(message.provider, message.model, {
          activate: message.activate,
          priority: message.priority
        });
        break;

      case 'acceptFallback':
        await this.executeFailoverSwitch(message.provider, message.retryText);
        break;

      case 'simulateFailover':
        await this.handleSimulateFailover(message.reason, message.retryText);
        break;

      case 'setProviderPriority':
        if (this.providerManager) {
          await this.providerManager.setProviderPriority(message.provider, message.priority);
          await this.sendProvidersList();
        }
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
        console.warn(`FreeCode AI: Unknown webview command: ${message.command}`);
    }
  }

  async sendInitialState() {
    if (this.providerManager) {
      const validActive = await this.providerManager.getValidatedActiveProvider();
      if (this.chatController) {
        await this.chatController.setProvider(validActive);
      }
    }

    const state = this.chatController
      ? await this.chatController.getState()
      : { provider: null, providerName: 'No Provider Configured', model: null };
    const models = state.provider ? await this.getModelsForProvider(state.provider) : [];

    this.postMessage({
      type: 'init',
      state: {
        ...state,
        messages: this.chatController ? this.chatController.getMessages() : [],
        models
      }
    });
  }

  async sendProvidersList() {
    if (!this.providerManager) return;
    const validActive = await this.providerManager.getValidatedActiveProvider();
    if (this.chatController && this.chatController.activeProvider !== validActive) {
      await this.chatController.setProvider(validActive);
    }
    const providerStatuses = await this.providerManager.getAllProviderStatuses();
    this.postMessage({
      type: 'providersListUpdated',
      providers: providerStatuses,
      activeProvider: this.chatController ? this.chatController.activeProvider : null
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
    let endpoint = this.chatController ? this.chatController.ollamaEndpoint : 'http://127.0.0.1:11434';
    if (providerId === PROVIDERS.OLLAMA && this.providerManager) {
      const cfg = await this.providerManager.getProviderConfiguration(PROVIDERS.OLLAMA);
      if (cfg && cfg.endpoint) endpoint = cfg.endpoint;
    }
    return await ModelDiscovery.fetchModels(providerId, {
      apiKey,
      endpoint
    });
  }

  async handleUserMessage(text, options = {}) {
    const trimmed = (text || '').trim();
    const retryDepth = options.retryDepth || 0;

    // 1. Immediately echo user message to UI
    this.postMessage({
      type: 'messageAdded',
      message: {
        role: 'user',
        content: text
      }
    });

    // Handle special simulated failover test commands
    if (trimmed === '/test-ratelimit' || trimmed === '/simulate-failover') {
      await this.handleSimulateFailover('Simulated HTTP 429: Too Many Requests (Rate limit reached)', 'Hello from failover test!');
      return;
    }

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
      const activeProv = this.chatController ? this.chatController.activeProvider : null;
      const failedMeta = PROVIDER_METADATA[activeProv] || { name: activeProv || 'AI Provider' };

      this.postMessage({
        type: 'messageAdded',
        message: {
          role: 'assistant',
          content: `⚠️ ${err.message}`,
          error: true
        }
      });
      this.postMessage({ type: 'status', status: 'ready' });

      // Determine next fallback provider according to user priority (prevent infinite loop)
      if (this.providerManager && activeProv && retryDepth < 1) {
        const fallback = await this.providerManager.getNextFallbackProvider(activeProv, this.usageTracker);
        if (fallback) {
          // 1. Post interactive fallback suggestion to Webview
          this.postMessage({
            type: 'fallbackSuggestion',
            failedProvider: {
              id: activeProv,
              name: failedMeta.name
            },
            reason: err.message,
            fallbackProvider: fallback,
            pendingPrompt: text
          });

          // 2. Ask user via VS Code notification before switching
          const switchButton = `Switch to ${fallback.name}`;
          vscode.window.showWarningMessage(
            `FreeCode AI: ${failedMeta.name} failed (${err.message.slice(0, 90)}...). Would you like to switch to priority ${fallback.priority} provider ${fallback.name}?`,
            switchButton,
            'Keep Current'
          ).then(async (selection) => {
            if (selection === switchButton) {
              await this.executeFailoverSwitch(fallback.id, text, { retryDepth: retryDepth + 1 });
            }
          });
        }
      }
    }
  }

  async handleSwitchProvider(providerId) {
    if (!providerId) return;
    if (this.chatController) {
      await this.chatController.setProvider(providerId);
    }
    const models = await this.getModelsForProvider(providerId);

    this.postMessage({
      type: 'modelsUpdated',
      provider: providerId,
      models,
      activeModel: this.chatController ? this.chatController.activeModel : null
    });

    await this.sendStateUpdate();
    await this.sendProvidersList();
  }

  async handleSaveApiKey(providerId, apiKey, options = {}) {
    if (this.secretManager) {
      await this.secretManager.storeApiKey(providerId, apiKey);
    }
    if (this.providerManager) {
      const updateData = { connectionState: 'configured' };
      if (options.model) {
        updateData.model = options.model;
      }
      if (options.priority !== undefined) {
        updateData.priority = Number(options.priority);
      }
      await this.providerManager.setProviderConfiguration(providerId, updateData);
    }

    const shouldActivate = options.activate === true || (options.activate === undefined && (!this.providerManager || !this.providerManager.getActiveProvider()));

    if (shouldActivate) {
      if (this.providerManager) {
        await this.providerManager.setActiveProvider(providerId);
      }
      if (this.chatController) {
        await this.chatController.setProvider(providerId);
        if (options.model) {
          await this.chatController.setModel(options.model);
        }
      }
    } else {
      if (options.model && this.chatController && this.chatController.activeProvider === providerId) {
        await this.chatController.setModel(options.model);
      }
    }

    this.postMessage({
      type: 'connectionResult',
      provider: providerId,
      success: true,
      message: shouldActivate
        ? `API Key saved and ${PROVIDER_METADATA[providerId]?.name || providerId} set as active.`
        : `API Key saved for ${PROVIDER_METADATA[providerId]?.name || providerId}.`
    });

    // Automatically refresh models and cards
    await this.handleFetchModels(providerId);
    await this.sendProvidersList();
    await this.sendStateUpdate();
  }

  async handleSaveEndpoint(endpoint, options = {}) {
    if (this.providerManager) {
      const updateData = { endpoint, connectionState: 'configured' };
      if (options.model) {
        updateData.model = options.model;
      }
      if (options.priority !== undefined) {
        updateData.priority = Number(options.priority);
      }
      await this.providerManager.setProviderConfiguration(PROVIDERS.OLLAMA, updateData);
    }

    const shouldActivate = options.activate === true || (options.activate === undefined && (!this.providerManager || !this.providerManager.getActiveProvider()));

    if (shouldActivate) {
      if (this.chatController) {
        await this.chatController.setOllamaEndpoint(endpoint);
        await this.chatController.setProvider(PROVIDERS.OLLAMA);
        if (options.model) {
          await this.chatController.setModel(options.model);
        }
      }
      if (this.providerManager) {
        await this.providerManager.setActiveProvider(PROVIDERS.OLLAMA);
      }
    } else {
      if (this.chatController && this.chatController.activeProvider === PROVIDERS.OLLAMA) {
        await this.chatController.setOllamaEndpoint(endpoint);
        if (options.model) {
          await this.chatController.setModel(options.model);
        }
      }
    }

    this.postMessage({
      type: 'connectionResult',
      provider: PROVIDERS.OLLAMA,
      success: true,
      message: shouldActivate
        ? `Ollama endpoint updated and set as active.`
        : `Ollama endpoint updated to: ${endpoint}`
    });

    await this.handleFetchModels(PROVIDERS.OLLAMA);
    await this.sendProvidersList();
    await this.sendStateUpdate();
  }

  async handleTestConnection(providerId, customEndpoint) {
    const meta = PROVIDER_METADATA[providerId] || {};
    let apiKey = null;

    if (meta.requiresApiKey && this.secretManager) {
      apiKey = await this.secretManager.getApiKey(providerId);
      if (!apiKey) {
        this.postMessage({
          type: 'connectionResult',
          provider: providerId,
          success: false,
          message: `API key not found for ${meta.name}. Please configure your API key first.`
        });
        if (this.providerManager) {
          this.providerManager.setConnectionState(providerId, 'error');
          await this.sendProvidersList();
        }
        return;
      }
    }

    try {
      const { ProviderFactory } = require('../providers/providerFactory');
      let endpoint = customEndpoint || (this.chatController ? this.chatController.ollamaEndpoint : 'http://127.0.0.1:11434');
      if (providerId === PROVIDERS.OLLAMA && this.providerManager && !customEndpoint) {
        const cfg = await this.providerManager.getProviderConfiguration(PROVIDERS.OLLAMA);
        if (cfg.endpoint) endpoint = cfg.endpoint;
      }

      const providerInstance = ProviderFactory.create(providerId, {
        apiKey,
        endpoint
      });

      const res = await providerInstance.testConnection();

      if (this.providerManager) {
        this.providerManager.setConnectionState(providerId, res.success ? 'connected' : 'error');
      }

      this.postMessage({
        type: 'connectionResult',
        provider: providerId,
        success: res.success,
        message: res.message
      });

      await this.sendProvidersList();
    } catch (err) {
      if (this.providerManager) {
        this.providerManager.setConnectionState(providerId, 'error');
      }
      this.postMessage({
        type: 'connectionResult',
        provider: providerId,
        success: false,
        message: err.message || 'Connection test failed.'
      });
      await this.sendProvidersList();
    }
  }

  async handleRemoveProvider(providerId) {
    if (!providerId) return;

    if (this.secretManager) {
      await this.secretManager.deleteApiKey(providerId);
    }
    if (this.providerManager) {
      await this.providerManager.removeProvider(providerId);
    }

    if (this.chatController && this.chatController.activeProvider === providerId) {
      const newActive = this.providerManager ? this.providerManager.getActiveProvider() : null;
      await this.chatController.setProvider(newActive);
    }

    this.postMessage({
      type: 'connectionResult',
      provider: providerId,
      success: true,
      message: `Configuration removed for ${PROVIDER_METADATA[providerId]?.name || providerId}.`
    });

    await this.sendProvidersList();
    await this.sendStateUpdate();
  }

  async handleFetchModels(providerId) {
    const models = await this.getModelsForProvider(providerId);
    let activeModel = null;
    if (this.providerManager) {
      const cfg = await this.providerManager.getProviderConfiguration(providerId);
      activeModel = cfg.model;
    }
    if (!activeModel && this.chatController && this.chatController.activeProvider === providerId) {
      activeModel = this.chatController.activeModel;
    }

    this.postMessage({
      type: 'modelsUpdated',
      provider: providerId,
      models,
      activeModel
    });
  }

  async handleSelectModel(providerId, modelId, options = {}) {
    const targetProvider = providerId || (this.chatController ? this.chatController.activeProvider : null);
    if (!targetProvider) return;

    if (this.providerManager) {
      const updateData = { model: modelId };
      if (options.priority !== undefined) {
        updateData.priority = Number(options.priority);
      }
      await this.providerManager.setProviderConfiguration(targetProvider, updateData);
    }

    if (options.activate) {
      if (this.providerManager) {
        await this.providerManager.setActiveProvider(targetProvider);
      }
      if (this.chatController) {
        await this.chatController.setProvider(targetProvider);
        await this.chatController.setModel(modelId);
      }
    } else if (this.chatController && this.chatController.activeProvider === targetProvider) {
      await this.chatController.setModel(modelId);
    }

    this.postMessage({
      type: 'connectionResult',
      provider: targetProvider,
      success: true,
      message: `Selected model set to ${modelId} for ${PROVIDER_METADATA[targetProvider]?.name || targetProvider}.`
    });

    await this.sendProvidersList();
    await this.sendStateUpdate();
  }

  /**
   * Switch to a fallback provider and optionally retry the pending prompt.
   * @param {string} targetProviderId
   * @param {string} [retryPrompt]
   * @param {object} [options]
   */
  async executeFailoverSwitch(targetProviderId, retryPrompt = null, options = {}) {
    if (!targetProviderId) return;
    const targetMeta = PROVIDER_METADATA[targetProviderId] || { name: targetProviderId };

    await this.handleSwitchProvider(targetProviderId);

    vscode.window.showInformationMessage(
      `FreeCode AI: Switched active provider to ${targetMeta.name}.`
    );

    const depth = options.retryDepth || 0;
    if (retryPrompt && depth < 1) {
      await this.handleUserMessage(retryPrompt, { retryDepth: depth + 1 });
    }
  }

  /**
   * Simulate a rate limit (HTTP 429) or failure on the active provider for testing failover.
   * Allows the user to verify failover switching without needing to exhaust real API quotas.
   * @param {string} [reason]
   * @param {string} [retryPrompt]
   */
  async handleSimulateFailover(reason = 'Simulated HTTP 429: Rate limit reached (Too Many Requests)', retryPrompt = 'Hello from failover test!') {
    const activeProv = this.chatController ? this.chatController.activeProvider : null;
    if (!activeProv) {
      vscode.window.showInformationMessage('FreeCode AI: No active provider configured to test failover.');
      return;
    }
    const failedMeta = PROVIDER_METADATA[activeProv] || { name: activeProv };

    // Record error in chat history
    this.postMessage({
      type: 'messageAdded',
      message: {
        role: 'assistant',
        content: `⚠️ [SIMULATION TEST] Rate limit reached for ${failedMeta.name}: ${reason}`,
        error: true
      }
    });

    const fallback = await this.providerManager.getNextFallbackProvider(activeProv, this.usageTracker);

    if (!fallback) {
      vscode.window.showWarningMessage(
        `FreeCode AI Test: ${failedMeta.name} simulated rate limit, but no other configured fallback provider was found. Please configure a secondary provider in the Providers tab to test switching.`
      );
      return;
    }

    // 1. Post fallback suggestion to Webview for 1-click switch
    this.postMessage({
      type: 'fallbackSuggestion',
      failedProvider: {
        id: activeProv,
        name: failedMeta.name
      },
      reason: `[Simulation Test] ${reason}`,
      fallbackProvider: fallback,
      pendingPrompt: retryPrompt
    });

    // 2. Ask user via VS Code notification before switching
    const switchButton = `Switch to ${fallback.name}`;
    vscode.window.showWarningMessage(
      `FreeCode AI [TEST]: ${failedMeta.name} reached rate limit. Switch to next priority provider ${fallback.name} (Priority #${fallback.priority})?`,
      switchButton,
      'Keep Current'
    ).then(async (selection) => {
      if (selection === switchButton) {
        await this.executeFailoverSwitch(fallback.id, retryPrompt);
      }
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
