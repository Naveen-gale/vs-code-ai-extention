/**
 * Groq Provider using Groq's high-speed OpenAI-compatible API.
 */

const { request, HttpError } = require('../utils/httpClient');

class GroqProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.model = options.model || 'llama-3.3-70b-versatile';
    this.baseUrl = options.baseUrl || 'https://api.groq.com/openai/v1';
    this.providerId = 'groq';
  }

  /**
   * Send chat completion request to Groq.
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} [config]
   */
  async complete(messages, config = {}) {
    if (!this.apiKey) {
      throw new Error('Groq API key is not configured. Please set your API key in Settings.');
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

    const data = await request(url, {
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
   * Test the connection using Groq's models list endpoint.
   */
  async testConnection() {
    if (!this.apiKey) {
      return { success: false, message: 'API key is missing.' };
    }

    try {
      const url = `${this.baseUrl}/models`;
      const data = await request(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`
        }
      }, 15000);

      if (data && Array.isArray(data.data)) {
        return {
          success: true,
          message: `Connected to Groq! Found ${data.data.length} available models.`
        };
      }
      return { success: true, message: 'Groq connection verified.' };
    } catch (err) {
      return {
        success: false,
        message: err instanceof HttpError ? err.message : (err.message || 'Connection failed')
      };
    }
  }
}

module.exports = { GroqProvider };
