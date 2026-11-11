/**
 * Factory for creating AI Provider instances.
 */

const { PROVIDERS } = require('../config/providers');
const { GeminiProvider } = require('./geminiProvider');
const { GroqProvider } = require('./groqProvider');
const { OpenRouterProvider } = require('./openrouterProvider');
const { OllamaProvider } = require('./ollamaProvider');
const { CohereProvider } = require('./cohereProvider');
const { CloudflareProvider } = require('./cloudflareProvider');
const { MistralProvider } = require('./mistralProvider');
const { NvidiaProvider } = require('./nvidiaProvider');
const { DeepSeekProvider } = require('./deepseekProvider');
const { HuggingFaceProvider } = require('./huggingfaceProvider');
const { OpenAIProvider } = require('./openaiProvider');

class ProviderFactory {
  /**
   * Instantiate an AI provider by ID.
   * @param {string} providerId
   * @param {object} [options]
   * @param {string} [options.apiKey]
   * @param {string} [options.model]
   * @param {string} [options.endpoint]
   * @returns {GeminiProvider|GroqProvider|OpenRouterProvider|OllamaProvider|CohereProvider|CloudflareProvider|MistralProvider|NvidiaProvider|DeepSeekProvider|HuggingFaceProvider|OpenAIProvider}
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

      case PROVIDERS.COHERE:
        return new CohereProvider(options);

      case PROVIDERS.CLOUDFLARE:
      case 'cloudflare workers ai':
        return new CloudflareProvider(options);

      case PROVIDERS.MISTRAL:
      case 'mistral ai':
        return new MistralProvider(options);

      case PROVIDERS.NVIDIA:
      case 'nvidia nim':
        return new NvidiaProvider(options);

      case PROVIDERS.DEEPSEEK:
        return new DeepSeekProvider(options);

      case PROVIDERS.HUGGINGFACE:
      case 'hugging face':
        return new HuggingFaceProvider(options);

      case PROVIDERS.OPENAI:
        return new OpenAIProvider(options);

      default:
        throw new Error(`Unsupported AI provider: "${providerId}". Valid providers: gemini, groq, openrouter, ollama, cohere, cloudflare, mistral, nvidia, deepseek, huggingface, openai.`);
    }
  }
}

module.exports = { ProviderFactory };
