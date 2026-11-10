/**
 * Default verified models registry for each AI provider.
 */

const { PROVIDERS } = require('./providers');

const MODEL_REGISTRY = {
  [PROVIDERS.GEMINI]: [
    {
      id: 'gemini-1.5-flash',
      name: 'Gemini 1.5 Flash',
      description: 'Fast and versatile multimodal model with 1M context window (Recommended).',
      contextWindow: 1048576,
      isDefault: true
    },
    {
      id: 'gemini-1.5-pro',
      name: 'Gemini 1.5 Pro',
      description: 'High-capability model for complex reasoning and large codebases.',
      contextWindow: 2097152,
      isDefault: false
    },
    {
      id: 'gemini-2.0-flash-exp',
      name: 'Gemini 2.0 Flash (Experimental)',
      description: 'Next-gen experimental multimodal model with real-time speed.',
      contextWindow: 1048576,
      isDefault: false
    }
  ],
  [PROVIDERS.GROQ]: [
    {
      id: 'llama-3.3-70b-versatile',
      name: 'Llama 3.3 70B Versatile',
      description: 'Flagship Meta model with remarkable speed on Groq LPUs.',
      contextWindow: 131072,
      isDefault: true
    },
    {
      id: 'llama-3.1-8b-instant',
      name: 'Llama 3.1 8B Instant',
      description: 'Ultra-fast lightweight model for quick edits and completions.',
      contextWindow: 131072,
      isDefault: false
    },
    {
      id: 'mixtral-8x7b-32768',
      name: 'Mixtral 8x7B 32k',
      description: 'Mixture of experts model with high reasoning capacity.',
      contextWindow: 32768,
      isDefault: false
    },
    {
      id: 'qwen-2.5-coder-32b',
      name: 'Qwen 2.5 Coder 32B',
      description: 'Specialized coding LLM running fast on Groq.',
      contextWindow: 32768,
      isDefault: false
    }
  ],
  [PROVIDERS.OPENROUTER]: [
    {
      id: 'meta-llama/llama-3.3-70b-instruct:free',
      name: 'Llama 3.3 70B (Free)',
      description: 'Free tier high-accuracy instruction model.',
      contextWindow: 131072,
      isDefault: true,
      isFree: true
    },
    {
      id: 'google/gemini-2.0-flash-exp:free',
      name: 'Gemini 2.0 Flash (Free)',
      description: 'Free experimental model via OpenRouter.',
      contextWindow: 1048576,
      isDefault: false,
      isFree: true
    },
    {
      id: 'qwen/qwen-2.5-coder-32b-instruct:free',
      name: 'Qwen 2.5 Coder 32B (Free)',
      description: 'Free tier specialized programming LLM.',
      contextWindow: 32768,
      isDefault: false,
      isFree: true
    },
    {
      id: 'anthropic/claude-3.5-sonnet',
      name: 'Claude 3.5 Sonnet',
      description: 'Leading benchmark performance for software engineering.',
      contextWindow: 200000,
      isDefault: false
    }
  ],
  [PROVIDERS.OLLAMA]: [
    {
      id: 'llama3:latest',
      name: 'Llama 3 (8B)',
      description: 'Default local Llama 3 model.',
      contextWindow: 8192,
      isDefault: true
    },
    {
      id: 'qwen2.5-coder:latest',
      name: 'Qwen 2.5 Coder',
      description: 'Optimized local coding model.',
      contextWindow: 32768,
      isDefault: false
    },
    {
      id: 'codellama:latest',
      name: 'Code Llama',
      description: 'Local code completion and generation model.',
      contextWindow: 16384,
      isDefault: false
    },
    {
      id: 'deepseek-coder-v2:latest',
      name: 'DeepSeek Coder V2',
      description: 'High-capability local programming model.',
      contextWindow: 32768,
      isDefault: false
    }
  ]
};

function getDefaultModels(providerId) {
  return MODEL_REGISTRY[providerId] || [];
}

function getDefaultModelId(providerId) {
  const models = getDefaultModels(providerId);
  const def = models.find(m => m.isDefault);
  return def ? def.id : (models[0] ? models[0].id : '');
}

module.exports = {
  MODEL_REGISTRY,
  getDefaultModels,
  getDefaultModelId
};
