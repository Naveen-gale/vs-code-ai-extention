/**
 * Dynamic Model Discovery for AI providers.
 * Queries official provider APIs to fetch live lists of available models,
 * with fallback to the verified default registry when offline.
 */

const { PROVIDERS } = require('../config/providers');
const { getDefaultModels } = require('../config/modelRegistry');
const { request } = require('../utils/httpClient');

class ModelDiscovery {
  /**
   * Fetch available models for a given provider.
   * @param {string} providerId
   * @param {object} [options]
   * @param {string} [options.apiKey]
   * @param {string} [options.endpoint]
   * @returns {Promise<Array<{id: string, name: string, description: string, contextWindow?: number, isFree?: boolean}>>}
   */
  static async fetchModels(providerId, options = {}) {
    const fallback = getDefaultModels(providerId);

    try {
      switch (providerId) {
        case PROVIDERS.GEMINI:
          return await ModelDiscovery._fetchGeminiModels(options.apiKey, fallback);

        case PROVIDERS.GROQ:
          return await ModelDiscovery._fetchGroqModels(options.apiKey, fallback);

        case PROVIDERS.OPENROUTER:
          return await ModelDiscovery._fetchOpenRouterModels(fallback);

        case PROVIDERS.OLLAMA:
          return await ModelDiscovery._fetchOllamaModels(options.endpoint || 'http://127.0.0.1:11434', fallback);

        default:
          return fallback;
      }
    } catch (err) {
      console.warn(`FreeCode AI: Failed to fetch live models for ${providerId}, using default registry:`, err.message);
      return fallback;
    }
  }

  static async _fetchGeminiModels(apiKey, fallback) {
    if (!apiKey) return fallback;

    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const data = await request(url, { method: 'GET' }, 15000);

    if (!data || !Array.isArray(data.models)) return fallback;

    const models = data.models
      .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map(m => {
        const id = m.name.startsWith('models/') ? m.name.replace('models/', '') : m.name;
        return {
          id,
          name: m.displayName || id,
          description: m.description || 'Google Gemini model',
          contextWindow: m.inputTokenLimit || 1048576,
          isDefault: id === 'gemini-1.5-flash'
        };
      });

    return models.length > 0 ? models : fallback;
  }

  static async _fetchGroqModels(apiKey, fallback) {
    if (!apiKey) return fallback;

    const url = 'https://api.groq.com/openai/v1/models';
    const data = await request(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` }
    }, 15000);

    if (!data || !Array.isArray(data.data)) return fallback;

    const models = data.data
      .filter(m => m.active !== false)
      .map(m => ({
        id: m.id,
        name: m.id,
        description: m.owned_by ? `Groq (${m.owned_by})` : 'Groq fast inference',
        contextWindow: m.context_window || 131072,
        isDefault: m.id === 'llama-3.3-70b-versatile'
      }));

    return models.length > 0 ? models : fallback;
  }

  static async _fetchOpenRouterModels(fallback) {
    const url = 'https://openrouter.ai/api/v1/models';
    const data = await request(url, { method: 'GET' }, 15000);

    if (!data || !Array.isArray(data.data)) return fallback;

    // Put free models and top models first
    const freeModels = [];
    const otherModels = [];

    data.data.forEach(m => {
      const isFree = m.id.endsWith(':free');
      const item = {
        id: m.id,
        name: m.name || m.id,
        description: m.description ? m.description.slice(0, 100) + '...' : '',
        contextWindow: m.context_length || 131072,
        isFree,
        isDefault: m.id === 'meta-llama/llama-3.3-70b-instruct:free'
      };

      if (isFree) {
        freeModels.push(item);
      } else {
        otherModels.push(item);
      }
    });

    const combined = [...freeModels, ...otherModels.slice(0, 40)];
    return combined.length > 0 ? combined : fallback;
  }

  static async _fetchOllamaModels(endpoint, fallback) {
    const cleanEndpoint = endpoint.replace(/\/+$/, '');
    const url = `${cleanEndpoint}/api/tags`;
    const data = await request(url, { method: 'GET' }, 8000);

    if (!data || !Array.isArray(data.models)) return fallback;

    const models = data.models.map((m, idx) => {
      const sizeGB = m.size ? (m.size / (1024 * 1024 * 1024)).toFixed(1) + ' GB' : '';
      return {
        id: m.name,
        name: m.name,
        description: sizeGB ? `Local Ollama model (${sizeGB})` : 'Local Ollama model',
        contextWindow: 8192,
        isDefault: idx === 0
      };
    });

    return models.length > 0 ? models : fallback;
  }
}

module.exports = { ModelDiscovery };
