/**
 * Chat Controller for FreeCode AI.
 * Handles chat orchestration, credentials retrieval, API calls,
 * per-provider model memory, and usage logging while never exposing keys to the webview.
 */

const { PROVIDERS, PROVIDER_METADATA } = require('../config/providers');
const { getDefaultModelId } = require('../config/modelRegistry');
const { ProviderFactory } = require('../providers/providerFactory');
const { PromptBuilder } = require('./promptBuilder');
const { MessageManager } = require('./messageManager');

class ChatController {
  /**
   * @param {object} options
   * @param {import('../security/secretManager').SecretManager} options.secretManager
   * @param {import('../usage/usageTracker').UsageTracker} options.usageTracker
   * @param {import('../providers/providerManager').ProviderManager} [options.providerManager]
   * @param {MessageManager} [options.messageManager]
   * @param {string} [options.initialProvider]
   * @param {string} [options.initialModel]
   * @param {string} [options.ollamaEndpoint]
   */
  constructor({
    secretManager,
    usageTracker,
    providerManager = null,
    messageManager = new MessageManager(),
    initialProvider = null,
    initialModel = null,
    ollamaEndpoint = 'http://127.0.0.1:11434'
  }) {
    this.secretManager = secretManager;
    this.usageTracker = usageTracker;
    this.providerManager = providerManager;
    this.messageManager = messageManager;

    const savedProvider = providerManager ? providerManager.getActiveProvider() : null;
    this.activeProvider = initialProvider !== undefined ? initialProvider : savedProvider;
    this.activeModel = initialModel || (this.activeProvider ? getDefaultModelId(this.activeProvider) : null);
    this.ollamaEndpoint = ollamaEndpoint;

    // Load initial stored model asynchronously if providerManager exists
    if (this.providerManager && this.activeProvider) {
      this.providerManager.getProviderConfiguration(this.activeProvider).then(cfg => {
        if (cfg && cfg.model) {
          this.activeModel = cfg.model;
        }
        if (cfg && cfg.endpoint) {
          this.ollamaEndpoint = cfg.endpoint;
        }
      }).catch(() => {});
    }
  }

  /**
   * Switch the active provider, restore that provider's saved model,
   * and persist the active provider choice.
   * @param {string|null} providerId
   * @returns {Promise<void>}
   */
  async setProvider(providerId) {
    if (!providerId) {
      this.activeProvider = null;
      this.activeModel = null;
      if (this.providerManager) {
        await this.providerManager.setActiveProvider(null);
      }
      return;
    }

    this.activeProvider = providerId;

    if (this.providerManager) {
      await this.providerManager.setActiveProvider(providerId);
      const cfg = await this.providerManager.getProviderConfiguration(providerId);
      this.activeModel = cfg.model || getDefaultModelId(providerId);
      if (providerId === PROVIDERS.OLLAMA && cfg.endpoint) {
        this.ollamaEndpoint = cfg.endpoint;
      }
    } else {
      this.activeModel = getDefaultModelId(providerId);
    }
  }

  /**
   * Set and persist the model selection for the active provider.
   * @param {string} modelId
   * @returns {Promise<void>}
   */
  async setModel(modelId) {
    if (!modelId) return;
    this.activeModel = modelId;
    if (this.providerManager) {
      await this.providerManager.setProviderConfiguration(this.activeProvider, {
        model: modelId
      });
    }
  }

  /**
   * Set and persist Ollama endpoint.
   * @param {string} endpoint
   * @returns {Promise<void>}
   */
  async setOllamaEndpoint(endpoint) {
    if (!endpoint) return;
    this.ollamaEndpoint = endpoint;
    if (this.providerManager) {
      await this.providerManager.setProviderConfiguration(PROVIDERS.OLLAMA, {
        endpoint
      });
    }
  }

  /**
   * Get active state summary (safe to send to webview).
   * @returns {Promise<object>}
   */
  async getState() {
    if (this.providerManager && this.activeProvider) {
      const isConfigured = await this.providerManager.isProviderConfigured(this.activeProvider);
      if (!isConfigured) {
        this.activeProvider = null;
        this.activeModel = null;
        await this.providerManager.setActiveProvider(null);
      }
    }

    if (!this.activeProvider) {
      return {
        provider: null,
        providerName: 'No Provider Configured',
        model: 'None',
        requiresApiKey: false,
        hasKey: false,
        ollamaEndpoint: this.ollamaEndpoint,
        cooldown: { active: false, remainingSeconds: 0 }
      };
    }

    const meta = PROVIDER_METADATA[this.activeProvider] || {};
    const hasKey = meta.requiresApiKey
      ? (this.secretManager ? await this.secretManager.hasApiKey(this.activeProvider) : false)
      : true;

    const cooldownInfo = this.usageTracker
      ? this.usageTracker.getCooldownInfo(this.activeProvider)
      : { active: false, remainingSeconds: 0 };

    return {
      provider: this.activeProvider,
      providerName: meta.name || this.activeProvider,
      model: this.activeModel,
      requiresApiKey: Boolean(meta.requiresApiKey),
      hasKey,
      ollamaEndpoint: this.ollamaEndpoint,
      cooldown: cooldownInfo
    };
  }

  /**
   * Process and send a user message.
   * Uses the currently active provider and its saved API key/endpoint.
   * @param {string} userText
   * @returns {Promise<{ userMessage: object, assistantMessage: object }>}
   */
  async sendMessage(userText) {
    const trimmed = (userText || '').trim();
    if (!trimmed) {
      throw new Error('Message cannot be empty.');
    }

    if (!this.activeProvider) {
      throw new Error('No AI provider configured. Please click "+ Add / Set Up Provider" in the Providers tab to configure one.');
    }

    // 1. Check Cooldown
    if (this.usageTracker) {
      const cooldownInfo = this.usageTracker.getCooldownInfo(this.activeProvider);
      if (cooldownInfo && cooldownInfo.active) {
        throw new Error(
          `Provider "${this.activeProvider}" is temporarily cooling down (${cooldownInfo.remainingSeconds}s remaining) due to: ${cooldownInfo.reason}.`
        );
      }
    }

    // 2. Retrieve API Key if required
    const meta = PROVIDER_METADATA[this.activeProvider] || {};
    let apiKey = null;

    if (meta.requiresApiKey) {
      if (!this.secretManager) {
        throw new Error('SecretManager is not available.');
      }
      apiKey = await this.secretManager.getApiKey(this.activeProvider);
      if (!apiKey) {
        throw new Error(
          `API key for ${meta.name || this.activeProvider} is not configured. Please open Provider Management to configure it.`
        );
      }
    }

    // Determine endpoint for Ollama
    let endpoint = this.ollamaEndpoint;
    if (this.activeProvider === PROVIDERS.OLLAMA && this.providerManager) {
      const cfg = await this.providerManager.getProviderConfiguration(PROVIDERS.OLLAMA);
      if (cfg.endpoint) {
        endpoint = cfg.endpoint;
      }
    }

    // 3. Add User Message to History
    const userMsg = this.messageManager.addMessage({
      role: 'user',
      content: trimmed,
      provider: this.activeProvider,
      model: this.activeModel
    });

    // 4. Prepare conversation context
    const rawHistory = this.messageManager.getMessages();
    const preparedMessages = PromptBuilder.prepareMessages(rawHistory);
    const systemPrompt = PromptBuilder.getSystemPrompt();

    // 5. Create Provider Instance
    const providerInstance = ProviderFactory.create(this.activeProvider, {
      apiKey,
      model: this.activeModel,
      endpoint
    });

    // 6. Record Request Start
    if (this.usageTracker) {
      await this.usageTracker.recordRequestStart(this.activeProvider, this.activeModel);
    }

    // 7. Execute Request with error tracking
    try {
      const response = await providerInstance.complete(preparedMessages, {
        systemPrompt,
        model: this.activeModel
      });

      // 8. Record Success & mark provider connected
      if (this.usageTracker) {
        await this.usageTracker.recordSuccess(
          this.activeProvider,
          this.activeModel,
          response.usage
        );
      }
      if (this.providerManager) {
        this.providerManager.setConnectionState(this.activeProvider, 'connected');
      }

      // 9. Add Assistant Message
      const assistantMsg = this.messageManager.addMessage({
        role: 'assistant',
        content: response.text,
        provider: this.activeProvider,
        model: this.activeModel,
        usage: response.usage
      });

      return {
        userMessage: userMsg,
        assistantMessage: assistantMsg
      };
    } catch (err) {
      // 10. Record Failure & Classify
      let classification = { category: 'UNKNOWN', retryAfterSeconds: 0 };
      if (this.usageTracker) {
        classification = await this.usageTracker.recordFailure(
          this.activeProvider,
          this.activeModel,
          err
        );
      }
      if (this.providerManager) {
        this.providerManager.setConnectionState(this.activeProvider, 'error');
      }

      let friendlyError = err.message;
      if (classification.category === 'INVALID_API_KEY') {
        friendlyError = `Invalid API key for ${meta.name}. Please check or re-enter your API key in Provider Management.`;
      } else if (classification.category === 'RATE_LIMIT') {
        friendlyError = `Rate limit reached for ${meta.name}. Provider will cool down for ${classification.retryAfterSeconds || 60} seconds.`;
      } else if (classification.category === 'QUOTA_EXHAUSTED') {
        friendlyError = `Account quota exhausted for ${meta.name}. Please check your plan or billing on the provider's portal.`;
      }

      const errorMsg = this.messageManager.addMessage({
        role: 'assistant',
        content: `⚠️ Error: ${friendlyError}`,
        provider: this.activeProvider,
        model: this.activeModel,
        error: true
      });

      const wrappedError = new Error(friendlyError);
      wrappedError.classification = classification;
      wrappedError.errorMessageObject = errorMsg;
      throw wrappedError;
    }
  }

  /**
   * Reset the current conversation.
   */
  newChat() {
    this.messageManager.clear();
  }

  /**
   * Get all messages.
   */
  getMessages() {
    return this.messageManager.getMessages();
  }
}

module.exports = { ChatController };
