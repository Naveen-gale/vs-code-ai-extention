/**
 * Dynamic Model Discovery for AI providers.
 * Queries official provider APIs to fetch live lists of available models,
 * with fallback to the verified default registry when offline.
 */

const { PROVIDERS } = require('../config/providers');
const { getDefaultModels } = require('../config/modelRegistry');
const httpClient = require('../utils/httpClient');

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
          return await ModelDiscovery._fetchOpenRouterModels(options.apiKey, fallback);

        case PROVIDERS.OLLAMA:
          return await ModelDiscovery._fetchOllamaModels(options.endpoint || 'http://127.0.0.1:11434', fallback);

        case PROVIDERS.COHERE:
          return await ModelDiscovery._fetchCohereModels(options.apiKey, fallback);

        case PROVIDERS.MISTRAL:
          return await ModelDiscovery._fetchMistralModels(options.apiKey, fallback);

        case PROVIDERS.CLOUDFLARE:
          return await ModelDiscovery._fetchCloudflareModels(options.apiKey, options.endpoint, fallback);

        case PROVIDERS.NVIDIA:
          return await ModelDiscovery._fetchNvidiaModels(options.apiKey, options.endpoint, fallback);

        case PROVIDERS.DEEPSEEK:
          return await ModelDiscovery._fetchDeepSeekModels(options.apiKey, fallback);

        case PROVIDERS.HUGGINGFACE:
          return await ModelDiscovery._fetchHuggingFaceModels(options.apiKey, fallback);

        case PROVIDERS.OPENAI:
          return await ModelDiscovery._fetchOpenAIModels(options.apiKey, fallback);

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
    const data = await httpClient.request(url, { method: 'GET' }, 15000);

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
          isFree: true,
          isDefault: id === 'gemini-1.5-flash'
        };
      });

    return models.length > 0 ? models : fallback;
  }

  static async _fetchGroqModels(apiKey, fallback) {
    if (!apiKey) return fallback;

    const url = 'https://api.groq.com/openai/v1/models';
    const data = await httpClient.request(url, {
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
        isFree: true,
        isDefault: m.id === 'llama-3.3-70b-versatile'
      }));

    return models.length > 0 ? models : fallback;
  }

  static async _fetchOpenRouterModels(apiKey, fallback) {
    const url = 'https://openrouter.ai/api/v1/models';
    const headers = {};
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const data = await httpClient.request(url, { method: 'GET', headers }, 15000);

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
    const data = await httpClient.request(url, { method: 'GET' }, 15000);

    if (!data || !Array.isArray(data.models)) return fallback;

    const models = data.models.map((m, idx) => {
      const sizeGB = m.size ? (m.size / (1024 * 1024 * 1024)).toFixed(1) + ' GB' : '';
      return {
        id: m.name,
        name: m.name,
        description: sizeGB ? `Local Ollama model (${sizeGB})` : 'Local Ollama model',
        contextWindow: 8192,
        isFree: true,
        isDefault: idx === 0
      };
    });

    return models.length > 0 ? models : fallback;
  }

  static async _fetchMistralModels(apiKey, fallback) {
    if (!apiKey) return fallback;

    const url = 'https://api.mistral.ai/v1/models';
    const data = await httpClient.request(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` }
    }, 15000);

    if (!data || !Array.isArray(data.data)) return fallback;

    const models = data.data.map(m => ({
      id: m.id,
      name: m.id,
      description: m.description || `Mistral AI model (${m.id})`,
      contextWindow: m.max_context_length || 32768,
      isFree: false,
      isDefault: m.id === 'codestral-latest' || m.id.includes('codestral')
    }));

    return models.length > 0 ? models : fallback;
  }

  static async _fetchCohereModels(apiKey, fallback) {
    if (!apiKey) return fallback;

    const url = 'https://api.cohere.com/v1/models';
    const data = await httpClient.request(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` }
    }, 15000);

    if (!data || !Array.isArray(data.models)) return fallback;

    const models = data.models
      .filter(m => m.endpoints && m.endpoints.includes('chat'))
      .map(m => ({
        id: m.name,
        name: m.name,
        description: `Cohere ${m.name} model (${m.context_length || 128000} ctx)`,
        contextWindow: m.context_length || 128000,
        isFree: true,
        isDefault: m.name === 'command-r-plus'
      }));

    return models.length > 0 ? models : fallback;
  }

  static async _fetchCloudflareModels(apiKey, endpoint, fallback) {
    if (!apiKey) return fallback;

    let accountId = null;
    if (endpoint) {
      const clean = endpoint.trim().replace(/^https?:\/\/[^/]+\//, '').replace(/\/.*$/, '');
      if (/^[a-f0-9]{32}$/i.test(clean) || clean.length >= 10) {
        accountId = clean;
      }
    }

    if (!accountId) {
      return fallback;
    }

    try {
      const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search?task=Text%20Generation`;
      const data = await httpClient.request(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` }
      }, 15000);

      const list = data?.result || data?.models;
      if (!Array.isArray(list)) return fallback;

      const models = list.map(m => {
        const id = m.name || m.id;
        return {
          id,
          name: id,
          description: m.description || `Cloudflare Workers AI model (${id})`,
          contextWindow: 131072,
          isFree: true,
          isDefault: id.includes('llama-3.3-70b')
        };
      });

      return models.length > 0 ? models : fallback;
    } catch {
      return fallback;
    }
  }

  static async _fetchNvidiaModels(apiKey, endpoint, fallback) {
    if (!apiKey) return fallback;

    let base = (endpoint || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '');
    if (base.endsWith('/chat/completions')) {
      base = base.replace(/\/chat\/completions$/, '');
    }
    const url = `${base}/models`;
    const data = await httpClient.request(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` }
    }, 15000);

    if (!data || !Array.isArray(data.data)) return fallback;

    // Filter out non-chat models like embeddings, rerankers, vision-only, and audio models
    const nonChatKeywords = ['embed', 'rerank', 'whisper', 'tts', 'asr', 'audio', 'clip', 'sdxl', 'diffusion', 'retrieval'];
    const chatModels = data.data.filter(m => {
      const id = (m.id || '').toLowerCase();
      return !nonChatKeywords.some(kw => id.includes(kw));
    });

    const list = chatModels.length > 0 ? chatModels : data.data;

    // Priority sorting for top chat/coding LLMs
    const priorityModels = [
      'meta/llama-3.3-70b-instruct',
      'deepseek-ai/deepseek-r1',
      'nvidia/llama-3.1-nemotron-70b-instruct',
      'qwen/qwen2.5-coder-32b-instruct',
      'mistralai/mistral-large-2-instruct'
    ];

    const sorted = [...list].sort((a, b) => {
      const aIdx = priorityModels.indexOf(a.id);
      const bIdx = priorityModels.indexOf(b.id);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.id.localeCompare(b.id);
    });

    const models = sorted.map(m => ({
      id: m.id,
      name: m.id,
      description: `NVIDIA NIM model (${m.id})`,
      contextWindow: 131072,
      isFree: true,
      isDefault: m.id === 'meta/llama-3.3-70b-instruct' || m.id.includes('llama-3.3-70b')
    }));

    return models.length > 0 ? models : fallback;
  }

  static async _fetchDeepSeekModels(apiKey, fallback) {
    if (!apiKey) return fallback;

    const url = 'https://api.deepseek.com/models';
    const data = await httpClient.request(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` }
    }, 15000);

    if (!data || !Array.isArray(data.data)) return fallback;

    const models = data.data.map(m => ({
      id: m.id,
      name: m.id,
      description: `DeepSeek model (${m.id})`,
      contextWindow: 65536,
      isFree: false,
      isDefault: m.id === 'deepseek-chat'
    }));

    return models.length > 0 ? models : fallback;
  }

  static async _fetchHuggingFaceModels(apiKey, fallback) {
    const url = 'https://huggingface.co/api/models?pipeline_tag=text-generation&sort=trending&direction=-1&limit=40';
    const headers = {};
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    try {
      const data = await httpClient.request(url, { method: 'GET', headers }, 15000);
      if (!Array.isArray(data)) return fallback;

      const instructModels = data
        .filter(m => m.id && (m.id.toLowerCase().includes('instruct') || m.id.toLowerCase().includes('chat') || m.id.toLowerCase().includes('coder') || m.id.toLowerCase().includes('r1')))
        .map((m, idx) => ({
          id: m.id,
          name: m.id,
          description: `Hugging Face text generation model (${m.downloads || 'popular'} downloads)`,
          contextWindow: 32768,
          isFree: true,
          isDefault: idx === 0 || m.id.includes('Llama-3.2-3B-Instruct')
        }));

      const combined = [...instructModels];
      fallback.forEach(f => {
        if (!combined.some(c => c.id === f.id)) {
          combined.push(f);
        }
      });

      return combined.length > 0 ? combined : fallback;
    } catch {
      return fallback;
    }
  }

  static async _fetchOpenAIModels(apiKey, fallback) {
    if (!apiKey) return fallback;

    const url = 'https://api.openai.com/v1/models';
    const data = await httpClient.request(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` }
    }, 15000);

    if (!data || !Array.isArray(data.data)) return fallback;

    // Filter to chat & reasoning models
    const chatPrefixes = ['gpt-4o', 'gpt-4', 'o1', 'o3', 'chatgpt'];
    const filtered = data.data.filter(m => {
      const id = (m.id || '').toLowerCase();
      return chatPrefixes.some(p => id.startsWith(p)) && !id.includes('realtime') && !id.includes('audio') && !id.includes('transcription');
    });

    const priorityOrder = ['gpt-4o-mini', 'gpt-4o', 'o3-mini', 'o1', 'gpt-4-turbo'];
    const sorted = [...filtered].sort((a, b) => {
      const aIdx = priorityOrder.indexOf(a.id);
      const bIdx = priorityOrder.indexOf(b.id);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.id.localeCompare(b.id);
    });

    const models = sorted.map(m => ({
      id: m.id,
      name: m.id,
      description: `OpenAI model (${m.id})`,
      contextWindow: 128000,
      isFree: false,
      isDefault: m.id === 'gpt-4o-mini'
    }));

    return models.length > 0 ? models : fallback;
  }
}

module.exports = { ModelDiscovery };
