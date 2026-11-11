/**
 * Provider metadata and configurations.
 */

const PROVIDERS = {
  GEMINI: 'gemini',
  GROQ: 'groq',
  OPENROUTER: 'openrouter',
  OLLAMA: 'ollama',
  COHERE: 'cohere',
  CLOUDFLARE: 'cloudflare',
  MISTRAL: 'mistral',
  NVIDIA: 'nvidia',
  DEEPSEEK: 'deepseek',
  HUGGINGFACE: 'huggingface',
  OPENAI: 'openai'
};

const PROVIDER_METADATA = {
  [PROVIDERS.GEMINI]: {
    id: PROVIDERS.GEMINI,
    name: 'Google Gemini',
    description: 'High-speed multimodal AI from Google.',
    requiresApiKey: true,
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    defaultModel: 'gemini-1.5-flash',
    baseUrl: 'https://generativelanguage.googleapis.com',
    freeApi: true
  },
  [PROVIDERS.GROQ]: {
    id: PROVIDERS.GROQ,
    name: 'Groq',
    description: 'Ultra-low latency inference engine.',
    requiresApiKey: true,
    apiKeyUrl: 'https://console.groq.com/keys',
    defaultModel: 'llama-3.3-70b-versatile',
    baseUrl: 'https://api.groq.com/openai/v1',
    freeApi: true
  },
  [PROVIDERS.OPENROUTER]: {
    id: PROVIDERS.OPENROUTER,
    name: 'OpenRouter',
    description: 'Unified gateway with hundreds of models including free tiers.',
    requiresApiKey: true,
    apiKeyUrl: 'https://openrouter.ai/keys',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    baseUrl: 'https://openrouter.ai/api/v1',
    freeApi: true
  },
  [PROVIDERS.OLLAMA]: {
    id: PROVIDERS.OLLAMA,
    name: 'Ollama (Local)',
    description: 'Run local open-source models on your machine without an API key.',
    requiresApiKey: false,
    defaultEndpoint: 'http://127.0.0.1:11434',
    defaultModel: 'llama3:latest',
    baseUrl: 'http://127.0.0.1:11434',
    freeApi: true
  },
  [PROVIDERS.COHERE]: {
    id: 'cohere',
    name: 'Cohere',
    description: 'Enterprise NLP and Command models with free developer tier.',
    requiresApiKey: true,
    apiKeyUrl: 'https://dashboard.cohere.com/api-keys',
    defaultModel: 'command-r-plus',
    baseUrl: 'https://api.cohere.com/v2',
    apiSupported: true,
    freeApi: true,
    billingRequired: false,
    quotaType: 'developer_tier',
    useResponseHeaders: true
  },
  [PROVIDERS.CLOUDFLARE]: {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    description: 'Serverless AI models running on Cloudflare with daily free neurons.',
    requiresApiKey: true,
    apiKeyUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    defaultModel: '@cf/meta/llama-3.3-70b-instruct',
    defaultEndpoint: 'https://api.cloudflare.com/client/v4',
    baseUrl: 'https://api.cloudflare.com/client/v4',
    apiSupported: true,
    freeApi: true,
    billingRequired: false,
    quotaType: 'daily_neurons',
    useResponseHeaders: true
  },
  [PROVIDERS.MISTRAL]: {
    id: 'mistral',
    name: 'Mistral AI',
    description: 'Advanced European AI models (Mistral Large, Codestral, Mixtral).',
    requiresApiKey: true,
    apiKeyUrl: 'https://console.mistral.ai/api-keys/',
    defaultModel: 'codestral-latest',
    baseUrl: 'https://api.mistral.ai/v1',
    apiSupported: true,
    freeApi: false,
    billingRequired: true,
    quotaType: 'organization_managed',
    useResponseHeaders: true
  },
  [PROVIDERS.NVIDIA]: {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    description: 'NVIDIA Inference Microservices with 1,000 free starter credits for Llama 3.3, DeepSeek R1, Nemotron.',
    requiresApiKey: true,
    apiKeyUrl: 'https://build.nvidia.com/',
    defaultModel: 'meta/llama-3.3-70b-instruct',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiSupported: true,
    freeApi: true,
    billingRequired: false,
    quotaType: 'starter_credits',
    useResponseHeaders: true,
    keyPrefixHint: 'nvapi-'
  },
  [PROVIDERS.DEEPSEEK]: {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'High-capability reasoning and coding models (DeepSeek-V3 and DeepSeek-R1).',
    requiresApiKey: true,
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    defaultModel: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com',
    apiSupported: true,
    freeApi: false,
    billingRequired: true,
    quotaType: 'pay_as_you_go',
    useResponseHeaders: true,
    keyPrefixHint: 'sk-'
  },
  [PROVIDERS.HUGGINGFACE]: {
    id: 'huggingface',
    name: 'Hugging Face',
    description: 'Serverless AI Inference API hosting thousands of open-source models with free rate limits.',
    requiresApiKey: true,
    apiKeyUrl: 'https://huggingface.co/settings/tokens',
    defaultModel: 'meta-llama/Llama-3.2-3B-Instruct',
    baseUrl: 'https://api-inference.huggingface.co/v1',
    apiSupported: true,
    freeApi: true,
    billingRequired: false,
    quotaType: 'rate_limited',
    useResponseHeaders: true,
    keyPrefixHint: 'hf_'
  },
  [PROVIDERS.OPENAI]: {
    id: 'openai',
    name: 'OpenAI',
    description: 'Industry-standard flagship models (GPT-4o, GPT-4o mini, o1, o3-mini).',
    requiresApiKey: true,
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    apiSupported: true,
    freeApi: false,
    billingRequired: true,
    quotaType: 'organization_managed',
    useResponseHeaders: true,
    keyPrefixHint: 'sk-'
  }
};

module.exports = {
  PROVIDERS,
  PROVIDER_METADATA
};
