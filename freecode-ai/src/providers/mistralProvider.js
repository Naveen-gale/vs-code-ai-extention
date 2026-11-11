/**
 * Mistral AI Provider for FreeCode AI.
 * OpenAI-compatible API with response headers tracking for rate limits and billing.
 */

const httpClient = require('../utils/httpClient');

class MistralProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.model = options.model || 'codestral-latest';
    this.baseUrl = (options.baseUrl || 'https://api.mistral.ai/v1').replace(/\/+$/, '');
    this.providerId = 'mistral';
  }

  /**
   * Send chat completion request to Mistral AI.
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} [config]
   */
  async complete(messages, config = {}) {
    if (!this.apiKey) {
      throw new Error('Mistral AI API key is not configured. Please set your API key in Provider Management.');
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
    const text = choice?.message?.content || '';

    const usage = data?.usage;
    const promptTokens = usage?.prompt_tokens || 0;
    const completionTokens = usage?.completion_tokens || 0;
    const totalTokens = usage?.total_tokens || (promptTokens + completionTokens);

    const isEstimated = !usage;
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
   * Test the connection using Mistral's models list endpoint.
   */
  async testConnection() {
    if (!this.apiKey) {
      return { success: false, message: 'Mistral API key is missing.' };
    }

    try {
      const url = `${this.baseUrl}/models`;
      const data = await httpClient.request(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`
        }
      }, 15000);

      const count = data?.data?.length || 0;
      return {
        success: true,
        message: `Connected to Mistral AI! Found ${count} available models.`
      };
    } catch (err) {
      return {
        success: false,
        message: `Mistral AI connection failed: ${err.message}`
      };
    }
  }
}

module.exports = { MistralProvider };
