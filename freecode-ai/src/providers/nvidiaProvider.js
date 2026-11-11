/**
 * NVIDIA NIM Provider for FreeCode AI.
 * Connects to NVIDIA Inference Microservices with 1,000 free starter credits.
 */

const httpClient = require('../utils/httpClient');

class NvidiaProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.model = options.model || 'meta/llama-3.3-70b-instruct';
    let base = (options.endpoint || options.baseUrl || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '');
    if (base.endsWith('/chat/completions')) {
      base = base.replace(/\/chat\/completions$/, '');
    }
    this.baseUrl = base;
    this.providerId = 'nvidia';
  }

  /**
   * Send chat completion request to NVIDIA NIM API.
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} [config]
   */
  async complete(messages, config = {}) {
    if (!this.apiKey) {
      throw new Error('NVIDIA NIM API key is not configured. Please set your key in Provider Management.');
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
      temperature: config.temperature !== undefined ? config.temperature : 0.6,
      top_p: config.topP !== undefined ? config.topP : 0.7,
      max_tokens: config.maxTokens || 2048,
      stream: false
    };

    try {
      const data = await httpClient.request(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }, config.timeoutMs || 45000);

      let responseData = data;
      // Handle string response (raw JSON or SSE event stream chunks)
      if (typeof responseData === 'string') {
        try {
          responseData = JSON.parse(responseData);
        } catch {
          // Parse SSE stream if provider returned chunked events
          if (responseData.includes('data:')) {
            let sseContent = '';
            let sseReasoning = '';
            let sseUsage = null;
            const lines = responseData.split('\n');
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('data:') && !trimmed.includes('[DONE]')) {
                try {
                  const chunk = JSON.parse(trimmed.replace(/^data:\s*/, ''));
                  const delta = chunk?.choices?.[0]?.delta;
                  if (delta?.content) sseContent += delta.content;
                  if (delta?.reasoning_content) sseReasoning += delta.reasoning_content;
                  if (delta?.text) sseContent += delta.text;
                  const choiceMsg = chunk?.choices?.[0]?.message;
                  if (choiceMsg?.content) sseContent += choiceMsg.content;
                  if (choiceMsg?.reasoning_content) sseReasoning += choiceMsg.reasoning_content;
                  if (chunk?.choices?.[0]?.text) sseContent += chunk.choices[0].text;
                  if (chunk?.usage) sseUsage = chunk.usage;
                } catch {}
              }
            }
            responseData = {
              choices: [{
                message: {
                  content: sseContent || sseReasoning
                }
              }],
              usage: sseUsage
            };
          }
        }
      }

      // Handle array wrapped responses e.g. [{ choices: [...] }]
      if (Array.isArray(responseData) && responseData.length > 0) {
        responseData = responseData[0];
      }

      // Extract text from choice or choices array
      let text = '';
      let finishReason = 'stop';
      const choices = Array.isArray(responseData?.choices) ? responseData.choices : [];

      for (const choice of choices) {
        const rawContent = choice?.message?.content;
        if (typeof rawContent === 'string' && rawContent.length > 0) {
          text = rawContent;
          finishReason = choice?.finish_reason || 'stop';
          break;
        } else if (Array.isArray(rawContent) && rawContent.length > 0) {
          text = rawContent
            .map(part => (typeof part === 'string' ? part : (part?.text || part?.content || '')))
            .join('');
          if (text.length > 0) {
            finishReason = choice?.finish_reason || 'stop';
            break;
          }
        } else if (choice?.message?.reasoning_content) {
          text = choice.message.reasoning_content;
          finishReason = choice?.finish_reason || 'stop';
          break;
        } else if (choice?.message?.text) {
          text = choice.message.text;
          finishReason = choice?.finish_reason || 'stop';
          break;
        } else if (typeof choice?.text === 'string' && choice.text.length > 0) {
          text = choice.text;
          finishReason = choice?.finish_reason || 'stop';
          break;
        } else if (choice?.delta?.content) {
          text = choice.delta.content;
          finishReason = choice?.finish_reason || 'stop';
          break;
        }
      }

      // Direct fallback to root fields if choices didn't yield text
      if (!text && responseData) {
        if (typeof responseData.text === 'string' && responseData.text.length > 0) {
          text = responseData.text;
        } else if (typeof responseData.content === 'string' && responseData.content.length > 0) {
          text = responseData.content;
        } else if (typeof responseData.response === 'string' && responseData.response.length > 0) {
          text = responseData.response;
        }
      }

      // If text is empty, check for error in response payload or throw helpful diagnostic
      if (!text || text.trim().length === 0) {
        const detail = responseData?.detail
          || responseData?.error?.message
          || (typeof responseData?.error === 'string' ? responseData.error : '')
          || responseData?.message
          || responseData?.title
          || '';
        const choiceFinish = choices[0]?.finish_reason ? ` (finish_reason: ${choices[0].finish_reason})` : '';

        throw new Error(
          `NVIDIA NIM returned an empty completion for model "${modelName}"${choiceFinish}.${detail ? ` Details: ${detail}` : ''}\n` +
          `Troubleshooting:\n` +
          `1. Try switching to "meta/llama-3.1-70b-instruct" or "nvidia/llama-3.1-nemotron-70b-instruct".\n` +
          `2. Check that your API key on build.nvidia.com has active credits and "Public API Endpoints" permission.\n` +
          `3. Switch to another configured provider (e.g. Gemini, Groq, Ollama, OpenRouter).`
        );
      }

      const usage = responseData?.usage;
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
        finishReason,
        model: modelName,
        provider: this.providerId
      };
    } catch (err) {
      const msg = err?.message || '';
      const detail = err?.data?.detail || '';
      if (msg.includes('Not found for account') || detail.includes('Not found for account')) {
        throw new Error(
          `NVIDIA NIM Account Entitlement Error: Your account lacks "Public API Endpoints" permission (${detail || msg}).\nTo resolve this:\n1. Verify your phone number on build.nvidia.com\n2. Try revoking and generating a fresh API key\n3. Contact help@build.nvidia.com to enable public inference endpoints for your account.`
        );
      }
      throw err;
    }
  }

  /**
   * Test connection using NVIDIA models list and live chat completion probe.
   */
  async testConnection() {
    if (!this.apiKey) {
      return { success: false, message: 'NVIDIA API key is not configured.' };
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

      // Verify that the account actually has Public API Endpoints provisioned for chat completions
      const probeModel = this.model || 'meta/llama-3.3-70b-instruct';
      try {
        await httpClient.request(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: probeModel,
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 1,
            stream: false
          })
        }, 15000);

        return {
          success: true,
          message: `Connected successfully to NVIDIA NIM (${probeModel} verified, ${count > 0 ? `${count} models available` : 'active'}).`
        };
      } catch (probeErr) {
        const msg = probeErr?.message || '';
        const detail = probeErr?.data?.detail || '';
        if (msg.includes('Not found for account') || detail.includes('Not found for account')) {
          return {
            success: false,
            message: `NVIDIA key authenticated, but account is missing "Public API Endpoints" permission (${detail || msg}). Fix: Complete phone verification on build.nvidia.com or email help@build.nvidia.com.`
          };
        }
        return {
          success: false,
          message: `NVIDIA chat verification failed for ${probeModel}: ${probeErr.message}`
        };
      }
    } catch (err) {
      return {
        success: false,
        message: `NVIDIA NIM connection failed: ${err.message}`
      };
    }
  }
}

module.exports = { NvidiaProvider };
