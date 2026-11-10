/**
 * Provider metadata and configurations.
 */

const PROVIDERS = {
  GEMINI: 'gemini',
  GROQ: 'groq',
  OPENROUTER: 'openrouter',
  OLLAMA: 'ollama'
};

const PROVIDER_METADATA = {
  [PROVIDERS.GEMINI]: {
    id: PROVIDERS.GEMINI,
    name: 'Google Gemini',
    description: 'High-speed multimodal AI from Google.',
    requiresApiKey: true,
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    defaultModel: 'gemini-1.5-flash',
    baseUrl: 'https://generativelanguage.googleapis.com'
  },
  [PROVIDERS.GROQ]: {
    id: PROVIDERS.GROQ,
    name: 'Groq',
    description: 'Ultra-low latency inference engine.',
    requiresApiKey: true,
    apiKeyUrl: 'https://console.groq.com/keys',
    defaultModel: 'llama-3.3-70b-versatile',
    baseUrl: 'https://api.groq.com/openai/v1'
  },
  [PROVIDERS.OPENROUTER]: {
    id: PROVIDERS.OPENROUTER,
    name: 'OpenRouter',
    description: 'Unified gateway with hundreds of models including free tiers.',
    requiresApiKey: true,
    apiKeyUrl: 'https://openrouter.ai/keys',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    baseUrl: 'https://openrouter.ai/api/v1'
  },
  [PROVIDERS.OLLAMA]: {
    id: PROVIDERS.OLLAMA,
    name: 'Ollama (Local)',
    description: 'Run local open-source models on your machine without an API key.',
    requiresApiKey: false,
    defaultEndpoint: 'http://127.0.0.1:11434',
    defaultModel: 'llama3:latest',
    baseUrl: 'http://127.0.0.1:11434'
  }
};

module.exports = {
  PROVIDERS,
  PROVIDER_METADATA
};
