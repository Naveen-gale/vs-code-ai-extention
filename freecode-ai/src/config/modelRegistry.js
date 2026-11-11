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
      isDefault: true,
      isFree: true
    },
    {
      id: 'gemini-1.5-pro',
      name: 'Gemini 1.5 Pro',
      description: 'High-capability model for complex reasoning and large codebases.',
      contextWindow: 2097152,
      isDefault: false,
      isFree: true
    },
    {
      id: 'gemini-2.0-flash-exp',
      name: 'Gemini 2.0 Flash (Experimental)',
      description: 'Next-gen experimental multimodal model with real-time speed.',
      contextWindow: 1048576,
      isDefault: false,
      isFree: true
    }
  ],
  [PROVIDERS.GROQ]: [
    {
      id: 'llama-3.3-70b-versatile',
      name: 'Llama 3.3 70B Versatile',
      description: 'Flagship Meta model with remarkable speed on Groq LPUs.',
      contextWindow: 131072,
      isDefault: true,
      isFree: true
    },
    {
      id: 'llama-3.1-8b-instant',
      name: 'Llama 3.1 8B Instant',
      description: 'Ultra-fast lightweight model for quick edits and completions.',
      contextWindow: 131072,
      isDefault: false,
      isFree: true
    },
    {
      id: 'mixtral-8x7b-32768',
      name: 'Mixtral 8x7B 32k',
      description: 'Mixture of experts model with high reasoning capacity.',
      contextWindow: 32768,
      isDefault: false,
      isFree: true
    },
    {
      id: 'qwen-2.5-coder-32b',
      name: 'Qwen 2.5 Coder 32B',
      description: 'Specialized coding LLM running fast on Groq.',
      contextWindow: 32768,
      isDefault: false,
      isFree: true
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
      isDefault: false,
      isFree: false
    }
  ],
  [PROVIDERS.OLLAMA]: [
    {
      id: 'llama3:latest',
      name: 'Llama 3 (8B)',
      description: 'Default local Llama 3 model.',
      contextWindow: 8192,
      isDefault: true,
      isFree: true
    },
    {
      id: 'qwen2.5-coder:latest',
      name: 'Qwen 2.5 Coder',
      description: 'Optimized local coding model.',
      contextWindow: 32768,
      isDefault: false,
      isFree: true
    },
    {
      id: 'codellama:latest',
      name: 'Code Llama',
      description: 'Local code completion and generation model.',
      contextWindow: 16384,
      isDefault: false,
      isFree: true
    },
    {
      id: 'deepseek-coder-v2:latest',
      name: 'DeepSeek Coder V2',
      description: 'High-capability local programming model.',
      contextWindow: 32768,
      isDefault: false,
      isFree: true
    }
  ],
  [PROVIDERS.COHERE]: [
    {
      id: 'command-r-plus',
      name: 'Command R+ (Latest)',
      description: "Cohere's flagship model optimized for reasoning, code, and enterprise RAG (Free dev tier).",
      contextWindow: 128000,
      isDefault: true,
      isFree: true
    },
    {
      id: 'command-r',
      name: 'Command R',
      description: 'Fast, scalable model for chat, tasks, and code.',
      contextWindow: 128000,
      isDefault: false,
      isFree: true
    },
    {
      id: 'command-light',
      name: 'Command Light',
      description: 'Fast, lightweight model for high-throughput completions.',
      contextWindow: 4096,
      isDefault: false,
      isFree: true
    },
    {
      id: 'c4ai-aya-expanse-32b',
      name: 'Aya Expanse 32B',
      description: 'Multilingual research model by Cohere For AI.',
      contextWindow: 128000,
      isDefault: false,
      isFree: true
    }
  ],
  [PROVIDERS.CLOUDFLARE]: [
    {
      id: '@cf/meta/llama-3.3-70b-instruct',
      name: 'Llama 3.3 70B (Workers AI)',
      description: "Flagship Meta Llama 3.3 70B running serverless on Cloudflare (Free daily neurons).",
      contextWindow: 131072,
      isDefault: true,
      isFree: true
    },
    {
      id: '@cf/meta/llama-3.1-8b-instruct',
      name: 'Llama 3.1 8B (Workers AI)',
      description: 'Fast lightweight instruction-tuned model on Cloudflare.',
      contextWindow: 131072,
      isDefault: false,
      isFree: true
    },
    {
      id: '@cf/qwen/qwen2.5-coder-32b-instruct',
      name: 'Qwen 2.5 Coder 32B (Workers AI)',
      description: 'High-performance coding model on Cloudflare Workers AI.',
      contextWindow: 32768,
      isDefault: false,
      isFree: true
    },
    {
      id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
      name: 'DeepSeek R1 Distill Qwen 32B (Workers AI)',
      description: 'Advanced reasoning model distilled by DeepSeek on Cloudflare.',
      contextWindow: 32768,
      isDefault: false,
      isFree: true
    },
    {
      id: '@cf/mistral/mistral-7b-instruct-v0.1',
      name: 'Mistral 7B (Workers AI)',
      description: 'Mistral 7B on Cloudflare Workers AI.',
      contextWindow: 8192,
      isDefault: false,
      isFree: true
    }
  ],
  [PROVIDERS.MISTRAL]: [
    {
      id: 'codestral-latest',
      name: 'Codestral (Latest)',
      description: 'State-of-the-art generative coding model by Mistral AI.',
      contextWindow: 32768,
      isDefault: true,
      isFree: false
    },
    {
      id: 'mistral-large-latest',
      name: 'Mistral Large (Latest)',
      description: 'Top-tier flagship reasoning model with 128k context.',
      contextWindow: 131072,
      isDefault: false,
      isFree: false
    },
    {
      id: 'mistral-small-latest',
      name: 'Mistral Small (Latest)',
      description: 'Cost-effective, low-latency reasoning and coding model.',
      contextWindow: 32768,
      isDefault: false,
      isFree: false
    },
    {
      id: 'open-mixtral-8x7b',
      name: 'Mixtral 8x7B',
      description: 'Mixture-of-experts 8x7B model by Mistral AI.',
      contextWindow: 32768,
      isDefault: false,
      isFree: false
    },
    {
      id: 'open-mistral-7b',
      name: 'Mistral 7B',
      description: 'First-generation open 7B model by Mistral AI.',
      contextWindow: 32768,
      isDefault: false,
      isFree: false
    }
  ],
  [PROVIDERS.NVIDIA]: [
    {
      id: 'meta/llama-3.3-70b-instruct',
      name: 'Llama 3.3 70B Instruct (NVIDIA NIM)',
      description: 'High-speed flagship Meta model hosted on NVIDIA NIM (1,000 free starter credits).',
      contextWindow: 131072,
      isDefault: true,
      isFree: true
    },
    {
      id: 'meta/llama-3.1-70b-instruct',
      name: 'Llama 3.1 70B Instruct (NVIDIA NIM)',
      description: 'Standard high-reliability Meta 70B model on NVIDIA NIM.',
      contextWindow: 131072,
      isDefault: false,
      isFree: true
    },
    {
      id: 'meta/llama-3.1-8b-instruct',
      name: 'Llama 3.1 8B Instruct (NVIDIA NIM)',
      description: 'Ultra-low-latency Meta 8B instruction model on NVIDIA NIM.',
      contextWindow: 131072,
      isDefault: false,
      isFree: true
    },
    {
      id: 'deepseek-ai/deepseek-r1',
      name: 'DeepSeek R1 (NVIDIA NIM)',
      description: 'Breakthrough reasoning and code generation model on NVIDIA NIM.',
      contextWindow: 65536,
      isDefault: false,
      isFree: true
    },
    {
      id: 'nvidia/llama-3.1-nemotron-70b-instruct',
      name: 'Nemotron 70B Instruct',
      description: "NVIDIA's customized high-reasoning model optimized for complex workflows.",
      contextWindow: 131072,
      isDefault: false,
      isFree: true
    },
    {
      id: 'qwen/qwen2.5-coder-32b-instruct',
      name: 'Qwen 2.5 Coder 32B (NVIDIA NIM)',
      description: 'Leading code generation LLM hosted on NVIDIA NIM infrastructure.',
      contextWindow: 32768,
      isDefault: false,
      isFree: true
    },
    {
      id: 'mistralai/mistral-large-2-instruct',
      name: 'Mistral Large 2 (NVIDIA NIM)',
      description: 'Flagship multilingual reasoning and code model by Mistral on NVIDIA NIM.',
      contextWindow: 131072,
      isDefault: false,
      isFree: true
    }
  ],
  [PROVIDERS.DEEPSEEK]: [
    {
      id: 'deepseek-chat',
      name: 'DeepSeek-V3 (Chat / Code)',
      description: 'DeepSeek flagship V3 model: fast, ultra-smart at coding and math (Cost-effective).',
      contextWindow: 65536,
      isDefault: true,
      isFree: false
    },
    {
      id: 'deepseek-reasoner',
      name: 'DeepSeek-R1 (Reasoning)',
      description: 'DeepSeek R1 reasoning model with deep thought processes for hard engineering tasks.',
      contextWindow: 65536,
      isDefault: false,
      isFree: false
    }
  ],
  [PROVIDERS.HUGGINGFACE]: [
    {
      id: 'meta-llama/Llama-3.2-3B-Instruct',
      name: 'Llama 3.2 3B Instruct',
      description: 'Lightweight, ultra-fast model running on Hugging Face Serverless Inference.',
      contextWindow: 131072,
      isDefault: true,
      isFree: true
    },
    {
      id: 'Qwen/Qwen2.5-Coder-32B-Instruct',
      name: 'Qwen 2.5 Coder 32B',
      description: 'High-capability open coding model on Hugging Face Serverless API.',
      contextWindow: 32768,
      isDefault: false,
      isFree: true
    },
    {
      id: 'mistralai/Mistral-7B-Instruct-v0.3',
      name: 'Mistral 7B Instruct v0.3',
      description: 'Reliable general instruction model on Hugging Face Serverless.',
      contextWindow: 32768,
      isDefault: false,
      isFree: true
    },
    {
      id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
      name: 'DeepSeek R1 Distill Qwen 32B',
      description: 'Distilled deep reasoning model running on Hugging Face serverless routers.',
      contextWindow: 32768,
      isDefault: false,
      isFree: true
    }
  ],
  [PROVIDERS.OPENAI]: [
    {
      id: 'gpt-4o-mini',
      name: 'GPT-4o Mini',
      description: 'Fast, cost-efficient small model for everyday coding and conversations.',
      contextWindow: 128000,
      isDefault: true,
      isFree: false
    },
    {
      id: 'gpt-4o',
      name: 'GPT-4o (Omni)',
      description: 'Flagship high-intelligence multimodal model for complex programming.',
      contextWindow: 128000,
      isDefault: false,
      isFree: false
    },
    {
      id: 'o3-mini',
      name: 'o3-mini (Reasoning)',
      description: 'Next-gen reasoning model tailored for science, math, and coding.',
      contextWindow: 200000,
      isDefault: false,
      isFree: false
    },
    {
      id: 'o1',
      name: 'o1 (Deep Reasoning)',
      description: 'Advanced reasoning model designed to think before answering complex tasks.',
      contextWindow: 200000,
      isDefault: false,
      isFree: false
    },
    {
      id: 'gpt-4-turbo',
      name: 'GPT-4 Turbo',
      description: 'Previous generation flagship GPT-4 Turbo model.',
      contextWindow: 128000,
      isDefault: false,
      isFree: false
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
