/**
 * Ollama Provider for local model inference.
 * Requires no API key and works with locally running Ollama instances.
 */

const httpClient = require('../utils/httpClient');

class OllamaProvider {
  constructor(options = {}) {
    this.endpoint = (options.endpoint || 'http://127.0.0.1:11434').replace(/\/+$/, '');
    this.model = options.model || 'llama3:latest';
    this.providerId = 'ollama';
  }

  /**
   * Send chat completion request to local Ollama instance.
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} [config]
   */
  async complete(messages, config = {}) {
    const modelName = config.model || this.model;
    const url = `${this.endpoint}/api/chat`;

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
      stream: false,
      options: {
        temperature: config.temperature !== undefined ? config.temperature : 0.7,
        num_predict: config.maxTokens || 2048
      }
    };

    const timeout = config.timeoutMs || 300000; // 5 minutes default for local LLM inference
    let data;
    try {
      data = await httpClient.request(url, {
        method: 'POST',
        body: JSON.stringify(body)
      }, timeout);
    } catch (err) {
      if (err.message && (err.message.includes('ECONNREFUSED') || err.message.includes('fetch failed'))) {
        throw new Error(`Cannot reach Ollama at ${this.endpoint}. Please ensure Ollama is running ('ollama serve').`);
      }
      if (err.message && (err.message.includes('timed out') || err.status === 408)) {
        throw new Error(`Ollama request timed out after ${timeout}ms. Local models take longer to load weights and generate tokens on local hardware. Consider using a smaller model (e.g. llama3.2:1b or phi3) or check system resource utilization.`);
      }
      throw err;
    }

    const text = data?.message?.content || '';

    const promptTokens = data?.prompt_eval_count || 0;
    const completionTokens = data?.eval_count || 0;
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
      finishReason: data?.done ? 'stop' : 'length',
      model: modelName,
      provider: this.providerId
    };
  }

  /**
   * Test connection to Ollama by checking /api/tags.
   */
  async testConnection() {
    try {
      const url = `${this.endpoint}/api/tags`;
      const data = await httpClient.request(url, { method: 'GET' }, 15000);

      if (data && Array.isArray(data.models)) {
        const count = data.models.length;
        if (count === 0) {
          return {
            success: true,
            message: `Connected to Ollama at ${this.endpoint}, but no local models found. Run 'ollama pull llama3' to download a model.`
          };
        }
        return {
          success: true,
          message: `Connected to Ollama! Found ${count} locally installed model${count > 1 ? 's' : ''}.`
        };
      }

      return { success: true, message: `Connected to Ollama at ${this.endpoint}.` };
    } catch (err) {
      return {
        success: false,
        message: `Ollama connection failed at ${this.endpoint}. Make sure the Ollama application is running.`
      };
    }
  }
}

module.exports = { OllamaProvider };
