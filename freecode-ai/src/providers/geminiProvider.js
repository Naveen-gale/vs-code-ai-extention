/**
 * Google Gemini Provider using Google Generative Language API.
 */

const { request, HttpError } = require('../utils/httpClient');

class GeminiProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.model = options.model || 'gemini-1.5-flash';
    this.baseUrl = options.baseUrl || 'https://generativelanguage.googleapis.com';
    this.providerId = 'gemini';
  }

  /**
   * Format standard chat messages into Gemini's format.
   * @param {Array<{role: string, content: string}>} messages
   */
  _formatContents(messages) {
    return messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content || '' }]
    }));
  }

  /**
   * Send chat completion request to Gemini.
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} [config]
   */
  async complete(messages, config = {}) {
    if (!this.apiKey) {
      throw new Error('Gemini API key is not configured. Please set your API key in Settings.');
    }

    const modelName = config.model || this.model;
    const cleanModel = modelName.startsWith('models/') ? modelName.replace('models/', '') : modelName;
    const url = `${this.baseUrl}/v1beta/models/${cleanModel}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const contents = this._formatContents(messages);

    const body = {
      contents,
      generationConfig: {
        temperature: config.temperature !== undefined ? config.temperature : 0.7,
        maxOutputTokens: config.maxTokens || 2048
      }
    };

    if (config.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: config.systemPrompt }]
      };
    }

    const data = await request(url, {
      method: 'POST',
      body: JSON.stringify(body)
    }, config.timeoutMs || 45000);

    const candidate = data?.candidates?.[0];
    const textPart = candidate?.content?.parts?.[0]?.text;
    const text = textPart !== undefined ? textPart : '';

    const usageMetadata = data?.usageMetadata;
    const promptTokens = usageMetadata?.promptTokenCount || 0;
    const completionTokens = usageMetadata?.candidatesTokenCount || 0;
    const totalTokens = usageMetadata?.totalTokenCount || (promptTokens + completionTokens);

    const isEstimated = !usageMetadata;
    const finalUsage = isEstimated ? {
      promptTokens: Math.ceil(JSON.stringify(contents).length / 4),
      completionTokens: Math.ceil(text.length / 4),
      totalTokens: Math.ceil((JSON.stringify(contents).length + text.length) / 4),
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
      finishReason: candidate?.finishReason || 'STOP',
      model: cleanModel,
      provider: this.providerId
    };
  }

  /**
   * Test the connection using Gemini's models list endpoint.
   */
  async testConnection() {
    if (!this.apiKey) {
      return { success: false, message: 'API key is missing.' };
    }

    try {
      const url = `${this.baseUrl}/v1beta/models?key=${encodeURIComponent(this.apiKey)}&pageSize=5`;
      const data = await request(url, { method: 'GET' }, 15000);
      if (data && Array.isArray(data.models)) {
        return {
          success: true,
          message: `Connected successfully! Found ${data.models.length}+ Gemini models.`
        };
      }
      return { success: true, message: 'Gemini connection verified.' };
    } catch (err) {
      return {
        success: false,
        message: err instanceof HttpError ? err.message : (err.message || 'Connection failed')
      };
    }
  }
}

module.exports = { GeminiProvider };
