/**
 * Hugging Face Provider for FreeCode AI.
 * Connects to Hugging Face Serverless Inference API with free rate limits.
 */

const httpClient = require('../utils/httpClient');

class HuggingFaceProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.model = options.model || 'meta-llama/Llama-3.2-3B-Instruct';
    this.baseUrl = (options.baseUrl || 'https://api-inference.huggingface.co/v1').replace(/\/+$/, '');
    this.providerId = 'huggingface';
  }

  /**
   * Send chat completion request to Hugging Face Inference API.
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} [config]
   */
  async complete(messages, config = {}) {
    if (!this.apiKey) {
      throw new Error('Hugging Face User Access Token (API key) is not configured. Please set your token in Provider Management.');
    }

    const modelName = config.model || this.model;
    const url = `${this.baseUrl}/chat/completions`;

    const formattedMessages = [];
    if (config.systemPrompt) {
      formattedMessages.push({ role: 'system', content: config.systemPrompt });
    }
    messages.forEach(m => {
      formattedMessages.push({
        role: m.role === 'model' ? 'assistant' : m.role,
        content: m.content || ''
      });
    });

    const body = {
      model: modelName,
      messages: formattedMessages,
      temperature: config.temperature !== undefined ? config.temperature : 0.7,
      max_tokens: config.maxTokens || 2048
    };

    const data = await httpClient.request(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    }, config.timeoutMs || 45000);

    const choice = data?.choices?.[0];
    const text = choice?.message?.content || (Array.isArray(data) && data[0]?.generated_text) || '';

    const usage = data?.usage;
    const promptTokens = usage?.prompt_tokens || 0;
    const completionTokens = usage?.completion_tokens || 0;
    const totalTokens = usage?.total_tokens || (promptTokens + completionTokens);

    const isEstimated = totalTokens === 0;
    const finalUsage = isEstimated ? {
      promptTokens: Math.ceil(JSON.stringify(formattedMessages).length / 4),
      completionTokens: Math.ceil(text.length / 4),
      totalTokens: Math.ceil((JSON.stringify(formattedMessages).length + text.length) / 4),
      isEstimated: true
    } : {
      promptTokens,
      completionTokens,
      totalTokens,
      isEstimated: false
    };

    return {
      text,
      usage: finalUsage,
      finishReason: choice?.finish_reason || 'stop',
      model: modelName,
      provider: this.providerId
    };
  }

  /**
   * Test connection using Hugging Face whoami or lightweight test call.
   */
  async testConnection() {
    if (!this.apiKey) {
      return { success: false, message: 'Hugging Face API key is not configured.' };
    }

    try {
      const url = 'https://huggingface.co/api/whoami-v2';
      const data = await httpClient.request(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`
        }
      }, 15000);

      const username = data?.name || data?.username || 'user';
      return {
        success: true,
        message: `Connected successfully to Hugging Face (Authenticated as ${username}).`
      };
    } catch (err) {
      return {
        success: false,
        message: `Hugging Face connection failed: ${err.message}`
      };
    }
  }
}

module.exports = { HuggingFaceProvider };
