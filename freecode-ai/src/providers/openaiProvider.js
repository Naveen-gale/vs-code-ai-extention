/**
 * OpenAI Provider for FreeCode AI.
 * Connects to OpenAI official chat completions API (GPT-4o, GPT-4o-mini, o1, o3-mini).
 */

const httpClient = require('../utils/httpClient');

class OpenAIProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.model = options.model || 'gpt-4o-mini';
    this.baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.providerId = 'openai';
  }

  /**
   * Send chat completion request to OpenAI API.
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} [config]
   */
  async complete(messages, config = {}) {
    if (!this.apiKey) {
      throw new Error('OpenAI API key is not configured. Please set your key in Provider Management.');
    }

    const modelName = config.model || this.model;
    const url = `${this.baseUrl}/chat/completions`;

    const formattedMessages = [];
    if (config.systemPrompt && !modelName.startsWith('o1')) {
      formattedMessages.push({ role: 'system', content: config.systemPrompt });
    }
    messages.forEach(m => {
      formattedMessages.push({
        role: m.role === 'model' ? 'assistant' : m.role,
        content: m.content || ''
      });
    });

    const isOModel = modelName.startsWith('o1') || modelName.startsWith('o3');
    const body = {
      model: modelName,
      messages: formattedMessages,
      stream: false
    };

    if (isOModel) {
      body.max_completion_tokens = config.maxTokens || 4096;
    } else {
      body.temperature = config.temperature !== undefined ? config.temperature : 0.7;
      body.max_tokens = config.maxTokens || 2048;
    }

    const data = await httpClient.request(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }, config.timeoutMs || 45000);

    const choice = data?.choices?.[0];
    let text = '';
    const rawContent = choice?.message?.content;
    if (typeof rawContent === 'string') {
      text = rawContent;
    } else if (Array.isArray(rawContent)) {
      text = rawContent
        .map(part => (typeof part === 'string' ? part : (part?.text || '')))
        .join('');
    } else if (choice?.text) {
      text = choice.text;
    }

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
   * Test connection using OpenAI models list endpoint.
   */
  async testConnection() {
    if (!this.apiKey) {
      return { success: false, message: 'OpenAI API key is not configured.' };
    }

    try {
      const url = `${this.baseUrl}/models`;
      const data = await httpClient.request(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`
        }
      }, 15000);

      const count = Array.isArray(data?.data) ? data.data.length : 0;
      return {
        success: true,
        message: `Connected successfully to OpenAI (${count > 0 ? `${count} models available` : 'API active'}).`
      };
    } catch (err) {
      return {
        success: false,
        message: `OpenAI connection failed: ${err.message}`
      };
    }
  }
}

module.exports = { OpenAIProvider };
