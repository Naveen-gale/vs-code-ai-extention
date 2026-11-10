/**
 * Chat Controller for FreeCode AI.
 * Handles chat orchestration, credentials retrieval, API calls,
 * and usage logging while never exposing keys to the webview.
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
   * @param {MessageManager} [options.messageManager]
   * @param {string} [options.initialProvider]
   * @param {string} [options.initialModel]
   * @param {string} [options.ollamaEndpoint]
   */
  constructor({
    secretManager,
    usageTracker,
    messageManager = new MessageManager(),
    initialProvider = PROVIDERS.GEMINI,
    initialModel = null,
    ollamaEndpoint = 'http://127.0.0.1:11434'
  }) {
    this.secretManager = secretManager;
    this.usageTracker = usageTracker;
    this.messageManager = messageManager;
    this.activeProvider = initialProvider;
    this.activeModel = initialModel || getDefaultModelId(initialProvider);
    this.ollamaEndpoint = ollamaEndpoint;
  }

  setProvider(providerId) {
    this.activeProvider = providerId;
    this.activeModel = getDefaultModelId(providerId);
  }

  setModel(modelId) {
    this.activeModel = modelId;
  }

  setOllamaEndpoint(endpoint) {
    this.ollamaEndpoint = endpoint;
  }

  /**
   * Get active state summary (safe to send to webview).
   */
  async getState() {
    const meta = PROVIDER_METADATA[this.activeProvider] || {};
    const hasKey = meta.requiresApiKey
      ? await this.secretManager.hasApiKey(this.activeProvider)
      : true;

    const cooldownInfo = this.usageTracker.getCooldownInfo(this.activeProvider);

    return {
      provider: this.activeProvider,
      providerName: meta.name || this.activeProvider,
      model: this.activeModel,
      requiresApiKey: meta.requiresApiKey,
      hasKey,
      ollamaEndpoint: this.ollamaEndpoint,
      cooldown: cooldownInfo
    };
  }

  /**
   * Process and send a user message.
   * @param {string} userText
   * @returns {Promise<{ userMessage: object, assistantMessage: object }>}
   */
  async sendMessage(userText) {
    const trimmed = (userText || '').trim();
    if (!trimmed) {
      throw new Error('Message cannot be empty.');
    }

    // 1. Check Cooldown
    const cooldownInfo = this.usageTracker.getCooldownInfo(this.activeProvider);
    if (cooldownInfo.active) {
      throw new Error(
        `Provider "${this.activeProvider}" is temporarily cooling down (${cooldownInfo.remainingSeconds}s remaining) due to: ${cooldownInfo.reason}.`
      );
    }

    // 2. Retrieve API Key if required
    const meta = PROVIDER_METADATA[this.activeProvider] || {};
    let apiKey = null;

    if (meta.requiresApiKey) {
      apiKey = await this.secretManager.getApiKey(this.activeProvider);
      if (!apiKey) {
        throw new Error(
          `API key for ${meta.name || this.activeProvider} is not set. Please click the settings icon or use "Set API Key" to configure it.`
        );
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
      endpoint: this.ollamaEndpoint
    });

    // 6. Record Request Start
    await this.usageTracker.recordRequestStart(this.activeProvider, this.activeModel);

    // 7. Execute Request with error tracking
    try {
      const response = await providerInstance.complete(preparedMessages, {
        systemPrompt,
        model: this.activeModel
      });

      // 8. Record Success
      await this.usageTracker.recordSuccess(
        this.activeProvider,
        this.activeModel,
        response.usage
      );

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
      const classification = await this.usageTracker.recordFailure(
        this.activeProvider,
        this.activeModel,
        err
      );

      let friendlyError = err.message;
      if (classification.category === 'INVALID_API_KEY') {
        friendlyError = `Invalid API key for ${meta.name}. Please check or re-enter your API key.`;
      } else if (classification.category === 'RATE_LIMIT') {
        friendlyError = `Rate limit reached. Provider will cool down for ${classification.retryAfterSeconds || 60} seconds.`;
      } else if (classification.category === 'QUOTA_EXHAUSTED') {
        friendlyError = `Account quota exhausted for ${meta.name}. Check your billing or subscription on the provider's portal.`;
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
