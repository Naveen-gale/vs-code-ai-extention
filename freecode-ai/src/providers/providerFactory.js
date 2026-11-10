/**
 * Factory for creating AI Provider instances.
 */

const { PROVIDERS } = require('../config/providers');
const { GeminiProvider } = require('./geminiProvider');
const { GroqProvider } = require('./groqProvider');
const { OpenRouterProvider } = require('./openrouterProvider');
const { OllamaProvider } = require('./ollamaProvider');

class ProviderFactory {
  /**
   * Instantiate an AI provider by ID.
   * @param {string} providerId
   * @param {object} [options]
   * @param {string} [options.apiKey]
   * @param {string} [options.model]
   * @param {string} [options.endpoint]
   * @returns {GeminiProvider|GroqProvider|OpenRouterProvider|OllamaProvider}
   */
  static create(providerId, options = {}) {
    const normalized = (providerId || '').toLowerCase();

    switch (normalized) {
      case PROVIDERS.GEMINI:
      case 'google gemini':
        return new GeminiProvider(options);

      case PROVIDERS.GROQ:
        return new GroqProvider(options);

      case PROVIDERS.OPENROUTER:
        return new OpenRouterProvider(options);

      case PROVIDERS.OLLAMA:
      case 'ollama (local)':
        return new OllamaProvider(options);

      default:
        throw new Error(`Unsupported AI provider: "${providerId}". Valid providers: gemini, groq, openrouter, ollama.`);
    }
  }
}

module.exports = { ProviderFactory };
