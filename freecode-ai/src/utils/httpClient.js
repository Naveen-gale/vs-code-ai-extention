/**
 * Lightweight HTTP client with timeout, error extraction, and streaming support.
 */

class HttpError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Perform a JSON request with timeout.
 * @param {string} url
 * @param {object} options
 * @param {number} [timeoutMs=30000]
 * @returns {Promise<any>}
 */
async function request(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const isJson = (response.headers.get('content-type') || '').includes('application/json');
    const data = isJson ? await response.json() : await response.text();

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      if (typeof data === 'object' && data !== null) {
        if (data.error) {
          errorMessage = typeof data.error === 'string' 
            ? data.error 
            : data.error.message || JSON.stringify(data.error);
        } else if (data.message) {
          errorMessage = data.message;
        }
      } else if (typeof data === 'string' && data.length < 500) {
        errorMessage = data;
      }

      throw new HttpError(errorMessage, response.status, data);
    }

    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new HttpError(`Request timed out after ${timeoutMs}ms`, 408, null);
    }
    throw error;
  }
}

module.exports = {
  request,
  HttpError
};
