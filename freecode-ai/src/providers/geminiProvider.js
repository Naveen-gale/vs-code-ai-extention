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
   * Ensures roles strictly alternate and merges consecutive turns with same role.
   * Excludes system messages (which are set on systemInstruction).
   * @param {Array<{role: string, content: string}>} messages
   */
  _formatContents(messages) {
    const formatted = [];
    for (const msg of messages) {
      if (msg.role === 'system') continue;
      const role = msg.role === 'assistant' || msg.role === 'model' ? 'model' : 'user';
      const text = msg.content || '';
      if (formatted.length > 0 && formatted[formatted.length - 1].role === role) {
        formatted[formatted.length - 1].parts.push({ text });
      } else {
        formatted.push({
          role,
          parts: [{ text }]
        });
      }
    }
    // Gemini requires the contents array to start with a 'user' turn
    if (formatted.length === 0) {
      formatted.push({ role: 'user', parts: [{ text: '' }] });
    } else if (formatted[0].role !== 'user') {
      formatted.unshift({ role: 'user', parts: [{ text: '' }] });
    }
    return formatted;
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

    // Extract any system prompt from config or messages array
    let systemText = config.systemPrompt || '';
    for (const m of messages) {
      if (m.role === 'system' && m.content) {
        systemText = systemText ? `${systemText}\n\n${m.content}` : m.content;
      }
    }

    const contents = this._formatContents(messages);

    const body = {
      contents,
      generationConfig: {
        temperature: config.temperature !== undefined ? config.temperature : 0.7,
        maxOutputTokens: config.maxTokens || 2048
      }
    };

    if (systemText) {
      body.systemInstruction = {
        parts: [{ text: systemText }]
      };
    }

    const data = await request(url, {
      method: 'POST',
      body: JSON.stringify(body),
      signal: config.signal,
      onResponseHeaders: config.onResponseHeaders
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
