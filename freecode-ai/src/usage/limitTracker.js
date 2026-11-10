/**
 * Limit Tracker & Error Classifier.
 * Distinguishes rate limits, quota limits, auth issues, and manages provider cooldowns.
 */

const ErrorCategory = {
  RATE_LIMIT: 'RATE_LIMIT',
  QUOTA_EXHAUSTED: 'QUOTA_EXHAUSTED',
  INVALID_API_KEY: 'INVALID_API_KEY',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  TIMEOUT: 'TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  SERVER_ERROR: 'SERVER_ERROR',
  UNKNOWN: 'UNKNOWN'
};

class LimitTracker {
  constructor() {
    /** @type {Map<string, { expiresAt: number, reason: string, category: string }>} */
    this.cooldowns = new Map();
  }

  /**
   * Classify an error into detailed category with user-friendly diagnosis.
   * @param {any} error
   * @param {Headers|object} [headers]
   * @returns {{ category: string, message: string, retryAfterSeconds: number|null }}
   */
  classifyError(error, headers = null) {
    const status = error?.status;
    const msg = (error?.message || '').toLowerCase();
    const dataStr = error?.data ? JSON.stringify(error.data).toLowerCase() : '';

    const combined = `${msg} ${dataStr}`;
    let category = ErrorCategory.UNKNOWN;
    let retryAfterSeconds = this._extractRetryAfter(headers);

    if (status === 429 || combined.includes('rate limit') || combined.includes('rate_limit') || combined.includes('too many requests')) {
      if (combined.includes('quota') || combined.includes('insufficient_quota') || combined.includes('exceeded your current quota') || combined.includes('billing')) {
        category = ErrorCategory.QUOTA_EXHAUSTED;
      } else {
        category = ErrorCategory.RATE_LIMIT;
        if (!retryAfterSeconds) {
          retryAfterSeconds = 60; // Default 60 seconds rate limit cooldown
        }
      }
    } else if (status === 401 || combined.includes('invalid api key') || combined.includes('api key not valid') || combined.includes('unauthorized') || combined.includes('authentication')) {
      category = ErrorCategory.INVALID_API_KEY;
    } else if (status === 403 || combined.includes('permission denied') || combined.includes('forbidden') || combined.includes('access denied')) {
      category = ErrorCategory.PERMISSION_DENIED;
    } else if (status === 404 || combined.includes('model not found') || combined.includes('does not exist')) {
      category = ErrorCategory.MODEL_NOT_FOUND;
    } else if (status === 408 || error?.name === 'AbortError' || combined.includes('timeout') || combined.includes('timed out')) {
      category = ErrorCategory.TIMEOUT;
    } else if (combined.includes('econnrefused') || combined.includes('fetch failed') || combined.includes('network error') || combined.includes('enotfound')) {
      category = ErrorCategory.NETWORK_ERROR;
    } else if (status >= 500 && status < 600) {
      category = ErrorCategory.SERVER_ERROR;
      retryAfterSeconds = retryAfterSeconds || 15;
    }

    return {
      category,
      message: error?.message || 'An unexpected error occurred.',
      retryAfterSeconds
    };
  }

  _extractRetryAfter(headers) {
    if (!headers) return null;

    let headerVal = null;
    if (typeof headers.get === 'function') {
      headerVal = headers.get('retry-after') || headers.get('Retry-After');
    } else if (typeof headers === 'object') {
      headerVal = headers['retry-after'] || headers['Retry-After'];
    }

    if (!headerVal) return null;

    // Could be seconds or HTTP date
    const parsedSec = parseInt(headerVal, 10);
    if (!isNaN(parsedSec)) {
      return parsedSec;
    }

    const parsedDate = Date.parse(headerVal);
    if (!isNaN(parsedDate)) {
      const diff = Math.max(0, Math.ceil((parsedDate - Date.now()) / 1000));
      return diff;
    }

    return null;
  }

  /**
   * Set a cooldown period for a provider.
   * @param {string} providerId
   * @param {number} seconds
   * @param {string} reason
   * @param {string} category
   */
  setCooldown(providerId, seconds, reason = 'Rate limited', category = ErrorCategory.RATE_LIMIT) {
    const duration = Math.max(5, seconds || 60);
    const expiresAt = Date.now() + duration * 1000;
    this.cooldowns.set(providerId.toLowerCase(), {
      expiresAt,
      reason,
      category
    });
  }

  /**
   * Check if a provider is currently under cooldown.
   * @param {string} providerId
   * @returns {boolean}
   */
  isCoolingDown(providerId) {
    const info = this.getCooldownInfo(providerId);
    return info.active;
  }

  /**
   * Get detailed cooldown status for a provider.
   * @param {string} providerId
   * @returns {{ active: boolean, remainingSeconds: number, reason: string|null, category: string|null }}
   */
  getCooldownInfo(providerId) {
    const entry = this.cooldowns.get(providerId.toLowerCase());
    if (!entry) {
      return { active: false, remainingSeconds: 0, reason: null, category: null };
    }

    const remainingMs = entry.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.cooldowns.delete(providerId.toLowerCase());
      return { active: false, remainingSeconds: 0, reason: null, category: null };
    }

    return {
      active: true,
      remainingSeconds: Math.ceil(remainingMs / 1000),
      reason: entry.reason,
      category: entry.category
    };
  }

  /**
   * Clear cooldown for a provider manually.
   * @param {string} providerId
   */
  clearCooldown(providerId) {
    this.cooldowns.delete(providerId.toLowerCase());
  }
}

module.exports = {
  LimitTracker,
  ErrorCategory
};
