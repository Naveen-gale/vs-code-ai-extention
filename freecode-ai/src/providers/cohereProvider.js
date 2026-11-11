/**
 * Cohere Provider for FreeCode AI.
 * Uses Cohere's Chat v2 API with support for command-r, command-r-plus, etc.
 */

const httpClient = require('../utils/httpClient');

class CohereProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.model = options.model || 'command-r-plus';
    this.baseUrl = (options.baseUrl || 'https://api.cohere.com/v2').replace(/\/+$/, '');
    this.providerId = 'cohere';
  }

  /**
   * Send chat completion request to Cohere.
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} [config]
   */
  async complete(messages, config = {}) {
    if (!this.apiKey) {
      throw new Error('Cohere API key is not configured. Please set your API key in Provider Management.');
    }

    const modelName = config.model || this.model;
    const url = `${this.baseUrl}/chat`;

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
      messages: formattedMessages
    };

    const data = await httpClient.request(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    }, config.timeoutMs || 45000);

    // Extract text from Cohere v2 response format or v1 fallback
    let text = '';
    if (data?.message?.content && Array.isArray(data.message.content)) {
      text = data.message.content.map(c => c.text || '').join('');
    } else if (typeof data?.text === 'string') {
      text = data.text;
    }

    const usage = data?.usage?.tokens || data?.usage?.billed_units || data?.meta?.billed_units || data?.usage;
    const promptTokens = usage?.input_tokens || usage?.prompt_tokens || 0;
    const completionTokens = usage?.output_tokens || usage?.completion_tokens || 0;
    const totalTokens = promptTokens + completionTokens;

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
      finishReason: 'stop',
      model: modelName,
      provider: this.providerId
    };
  }

  /**
   * Test connection using Cohere models list endpoint.
   */
  async testConnection() {
    if (!this.apiKey) {
      return { success: false, message: 'Cohere API key is missing.' };
    }

    try {
      const url = 'https://api.cohere.com/v1/models';
      const data = await httpClient.request(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`
        }
      }, 15000);

      const count = data?.models?.length || 0;
      return {
        success: true,
        message: `Connected to Cohere! Found ${count} available models.`
      };
    } catch (err) {
      return {
        success: false,
        message: `Cohere connection failed: ${err.message}`
      };
    }
  }
}

module.exports = { CohereProvider };
