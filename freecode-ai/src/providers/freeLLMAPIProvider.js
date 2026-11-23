const httpClient = require('../utils/httpClient');

function textContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(part => part && (part.type === 'text' || part.type === 'output_text') && typeof part.text === 'string')
    .map(part => part.text)
    .join('');
}

function assistantChoiceText(choice) {
  if (!choice || choice.tool_calls || choice.function_call || choice.message?.tool_calls || choice.message?.function_call) return '';
  if (typeof choice.text === 'string' && choice.text.length > 0) return choice.text;
  const message = choice.message;
  if (message && (!message.role || message.role === 'assistant')) {
    return textContent(message.content);
  }
  return '';
}

function unusableFinishReason(reason) {
  return /^(?:tool_calls?|function_call|content_filter|safety|error)$/i.test(reason || '');
}

class FreeLLMAPIProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.model = options.model || '';
    this.baseUrl = (options.baseUrl || options.endpoint || 'http://127.0.0.1:31415/v1').replace(/\/+$/, '');
    this.providerId = 'freellmapi';
  }

  _validateBaseUrl() {
    let parsed;
    try {
      parsed = new URL(this.baseUrl);
    } catch (_) {
      throw new Error('FreeLLMAPI base URL is invalid. Use an http(s) URL ending in /v1.');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('FreeLLMAPI base URL must use http or https.');
    }
  }

  _headers(extraHeaders = {}) {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...extraHeaders
    };
  }

  async testConnection() {
    if (!this.apiKey) return { success: false, message: 'FreeLLMAPI unified API token is not configured.' };
    try {
      this._validateBaseUrl();
      const data = await httpClient.request(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: this._headers()
      }, 15000);
      const count = Array.isArray(data?.data) ? data.data.length : 0;
      if (count === 0) return { success: true, message: 'Connected to FreeLLMAPI, but no models are available.' };
      return { success: true, message: `Connected to FreeLLMAPI (${count} model${count === 1 ? '' : 's'} available).` };
    } catch (err) {
      return { success: false, message: `FreeLLMAPI connection failed: ${err.message}` };
    }
  }

  async getModels() {
    if (!this.apiKey) throw new Error('FreeLLMAPI unified API token is not configured.');
    this._validateBaseUrl();
    const data = await httpClient.request(`${this.baseUrl}/models`, {
      method: 'GET',
      headers: this._headers()
    }, 15000);
    return Array.isArray(data?.data) ? data.data.filter(m => m && typeof m.id === 'string').map(m => m.id) : [];
  }

  async getUsage() {
    if (!this.apiKey) throw new Error('FreeLLMAPI unified API token is not configured.');
    this._validateBaseUrl();
    return await httpClient.request(`${this.baseUrl}/usage`, {
      method: 'GET',
      headers: this._headers()
    }, 15000);
  }

  async complete(messages, config = {}) {
    if (!this.apiKey) throw new Error('FreeLLMAPI unified API token is not configured.');
    this._validateBaseUrl();
    if (!config.model && !this.model) throw new Error('No FreeLLMAPI model is selected.');

    const modelName = config.model || this.model;
    const formattedMessages = [];
    if (config.systemPrompt) formattedMessages.push({ role: 'system', content: config.systemPrompt });
    for (const message of messages || []) {
      formattedMessages.push({
        role: message.role === 'model' ? 'assistant' : message.role,
        content: message.content || ''
      });
    }

    const data = await httpClient.request(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this._headers({ 'X-FreeLLM-Task-Type': config.taskType || 'chat' }),
      body: JSON.stringify({
        model: modelName,
        messages: formattedMessages,
        stream: false,
        temperature: config.temperature !== undefined ? config.temperature : 0.7,
        max_tokens: config.maxTokens || 2048
      })
    }, config.timeoutMs || 45000);

    const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
    const finishReason = choice?.finish_reason || 'stop';
    let text = '';
    if (typeof choice?.message?.content === 'string') text = choice.message.content;
    else if (typeof choice?.text === 'string') text = choice.text;

    const usage = data?.usage;
    const promptTokens = usage?.prompt_tokens || 0;
    const completionTokens = usage?.completion_tokens || 0;
    const totalTokens = usage?.total_tokens || promptTokens + completionTokens;
    const isEstimated = totalTokens === 0;
    const finalUsage = isEstimated ? {
      promptTokens: Math.ceil(JSON.stringify(formattedMessages).length / 4),
      completionTokens: Math.ceil(text.length / 4),
      totalTokens: Math.ceil((JSON.stringify(formattedMessages).length + text.length) / 4),
      isEstimated: true
    } : { promptTokens, completionTokens, totalTokens, isEstimated: false };

    return {
      text,
      usage: finalUsage,
      finishReason,
      model: modelName,
      provider: this.providerId
    };
  }

  async completeLegacy(prompt, config = {}) {
    if (!this.apiKey) throw new Error('FreeLLMAPI unified API token is not configured.');
    this._validateBaseUrl();
    const modelName = config.model || this.model;
    if (!modelName) throw new Error('No FreeLLMAPI model is selected.');
    const data = await httpClient.request(`${this.baseUrl}/completions`, {
      method: 'POST',
      headers: this._headers({ 'X-FreeLLM-Task-Type': 'code' }),
      body: JSON.stringify({
        model: modelName,
        prompt,
        stream: false,
        temperature: config.temperature !== undefined ? config.temperature : 0.1,
        max_tokens: config.maxTokens || 96
      }),
      signal: config.signal,
      onResponseHeaders: config.onResponseHeaders
    }, config.timeoutMs || 15000);
    const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
    const finishReason = choice?.finish_reason || 'stop';
    return {
      text: unusableFinishReason(finishReason) ? '' : assistantChoiceText(choice),
      usage: data?.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
        isEstimated: !data.usage.total_tokens
      } : { promptTokens: 0, completionTokens: 0, totalTokens: 0, isEstimated: true },
      finishReason,
      model: modelName,
      provider: this.providerId
    };
  }

  async completeInline(prefix, suffix, config = {}) {
    const boundedPrefix = String(prefix || '').slice(-1200);
    const boundedSuffix = String(suffix || '').slice(0, 300);
    const prompt = config.inlinePrompt ||
      `You are a code-completion engine for ${config.language || 'the detected programming language'}.\n` +
      `Return only the exact source code text to insert at <CURSOR>.\n` +
      `Never explain, describe the task, reveal reasoning, repeat the prefix, return the whole file, or include Markdown or conversational text.\n` +
      `Preserve indentation, continue incomplete statements, and do not duplicate the suffix.\n\n` +
      `${boundedPrefix}<CURSOR>${boundedSuffix}\n\nBEGIN RAW CODE:`;
    return await this.completeLegacy(prompt, {
      ...config,
      maxTokens: config.maxTokens || 64,
      temperature: 0.1,
      timeoutMs: config.timeoutMs || 6000
    });
  }

  async completeStream(messages, config = {}, onChunk) {
    if (!this.apiKey) throw new Error('FreeLLMAPI unified API token is not configured.');
    this._validateBaseUrl();
    const modelName = config.model || this.model;
    if (!modelName) throw new Error('No FreeLLMAPI model is selected.');

    const formattedMessages = [];
    if (config.systemPrompt) formattedMessages.push({ role: 'system', content: config.systemPrompt });
    for (const message of messages || []) {
      formattedMessages.push({ role: message.role === 'model' ? 'assistant' : message.role, content: message.content || '' });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs || 45000);
    if (config.signal) {
      if (config.signal.aborted) controller.abort();
      else config.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this._headers({ 'X-FreeLLM-Task-Type': config.taskType || 'chat' }),
        body: JSON.stringify({
          model: modelName,
          messages: formattedMessages,
          stream: true,
          temperature: config.temperature !== undefined ? config.temperature : 0.7,
          max_tokens: config.maxTokens || 2048
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        let data = null;
        try { data = await response.json(); } catch (_) {}
        const error = new Error(data?.error?.message || data?.detail || `HTTP ${response.status}: ${response.statusText}`);
        error.status = response.status;
        error.data = data;
        error.headers = response.headers;
        throw error;
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Streaming response is not supported by this runtime.');
      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';
      let finishReason = 'stop';
      let hasToolCalls = false;

      const consumeLine = line => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) return;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') return;

        const event = JSON.parse(payload);
        if (event?.error) {
          const message = typeof event.error === 'string' ? event.error : event.error.message;
          throw new Error(message || 'FreeLLMAPI streaming request failed.');
        }
        const choice = Array.isArray(event?.choices) ? event.choices[0] : null;
        if (!choice) return;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        if (choice.tool_calls || choice.delta?.tool_calls || choice.delta?.function_call) hasToolCalls = true;

        const chunk = typeof choice.delta?.content === 'string'
          ? choice.delta.content
          : typeof choice.text === 'string'
            ? choice.text
            : textContent(choice.delta?.content || choice.message?.content);
        if (chunk) {
          text += chunk;
          if (typeof onChunk === 'function') onChunk(chunk, text);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          consumeLine(line);
        }
      }
      if (buffer.trim()) consumeLine(buffer);
      if (hasToolCalls || unusableFinishReason(finishReason)) text = '';
      return { text, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, isEstimated: true }, finishReason, model: modelName, provider: this.providerId };
    } catch (error) {
      if (error.name === 'AbortError') {
        const timeoutError = new Error(config.signal?.aborted ? 'Request was aborted by user' : 'FreeLLMAPI request timed out');
        timeoutError.status = config.signal?.aborted ? 499 : 408;
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

module.exports = { FreeLLMAPIProvider };
