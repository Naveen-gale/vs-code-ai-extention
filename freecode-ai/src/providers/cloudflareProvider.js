/**
 * Cloudflare Workers AI Provider for FreeCode AI.
 * Connects to serverless models running on Cloudflare's global network with free daily neurons.
 */

const httpClient = require('../utils/httpClient');

class CloudflareProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.endpoint = (options.endpoint || '').trim();
    this.model = options.model || '@cf/meta/llama-3.3-70b-instruct';
    this.providerId = 'cloudflare';
  }

  _getChatUrl() {
    if (!this.endpoint) {
      return 'https://api.cloudflare.com/client/v4/ai/v1/chat/completions';
    }
    const clean = this.endpoint.replace(/\/+$/, '');
    if (clean.endsWith('/chat/completions')) {
      return clean;
    }
    if (clean.includes('/ai/v1')) {
      return `${clean}/chat/completions`;
    }
    if (clean.includes('/accounts/')) {
      return `${clean}/ai/v1/chat/completions`;
    }
    // If user provided a 32-character hexadecimal account ID directly
    if (/^[a-f0-9]{32}$/i.test(clean)) {
      return `https://api.cloudflare.com/client/v4/accounts/${clean}/ai/v1/chat/completions`;
    }
    if (/^https?:\/\//i.test(clean)) {
      return `${clean}/chat/completions`;
    }
    return 'https://api.cloudflare.com/client/v4/ai/v1/chat/completions';
  }

  /**
   * Send chat completion request to Cloudflare Workers AI.
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} [config]
   */
  async complete(messages, config = {}) {
    if (!this.apiKey) {
      throw new Error('Cloudflare API Token is not configured. Please set your token in Provider Management.');
    }

    const modelName = config.model || this.model;
    const url = this._getChatUrl();

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
      max_tokens: config.maxTokens || 2048
    };

    const data = await httpClient.request(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    }, config.timeoutMs || 45000);

    const choice = data?.choices?.[0] || data?.result;
    const text = choice?.message?.content || choice?.response || (typeof data?.result === 'string' ? data.result : '');

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
      finishReason: 'stop',
      model: modelName,
      provider: this.providerId
    };
  }

  /**
   * Test connection using a lightweight test call.
   */
  async testConnection() {
    if (!this.apiKey) {
      return { success: false, message: 'Cloudflare API Token is missing.' };
    }

    try {
      const url = this._getChatUrl();
      const testBody = {
        model: this.model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5
      };

      await httpClient.request(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(testBody)
      }, 15000);

      return {
        success: true,
        message: `Connected to Cloudflare Workers AI with model ${this.model}!`
      };
    } catch (err) {
      return {
        success: false,
        message: `Cloudflare Workers AI connection failed: ${err.message}`
      };
    }
  }
}

module.exports = { CloudflareProvider };
