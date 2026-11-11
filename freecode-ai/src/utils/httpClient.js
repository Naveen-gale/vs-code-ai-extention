/**
 * Lightweight HTTP client with timeout, error extraction, and streaming support.
 */

class HttpError extends Error {
  constructor(message, status, data, headers = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.data = data;
    this.headers = headers;
  }
}

/**
 * Perform a JSON request with timeout and abort signal support.
 * @param {string} url
 * @param {object} options
 * @param {number} [timeoutMs=30000]
 * @returns {Promise<any>}
 */
async function request(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Link external signal to controller for immediate keystroke cancellation
  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(timeoutId);
      controller.abort();
    } else {
      options.signal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        controller.abort();
      });
    }
  }

  try {
    const headers = {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = rawText;
    }

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      if (typeof data === 'object' && data !== null) {
        if (typeof data.detail === 'string') {
          errorMessage = data.detail;
        } else if (data.error) {
          errorMessage = typeof data.error === 'string' 
            ? data.error 
            : data.error.message || JSON.stringify(data.error);
        } else if (data.message) {
          errorMessage = data.message;
        } else if (data.title) {
          errorMessage = data.title;
        } else if (data.detail) {
          errorMessage = JSON.stringify(data.detail);
        }
      } else if (typeof data === 'string' && data.length < 500) {
        errorMessage = data;
      }

      throw new HttpError(errorMessage, response.status, data, response.headers);
    }

    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      if (options.signal && options.signal.aborted) {
        throw new HttpError('Request was aborted by user keystroke', 499, null);
      }
      throw new HttpError(`Request timed out after ${timeoutMs}ms`, 408, null);
    }
    throw error;
  }
}

module.exports = {
  request,
  HttpError
};
