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

const PROVIDER_RATE_LIMITS = {
  groq: { maxRpm: 30, maxTpm: 6000, safeRpm: 25, safeTpm: 5000, desc: '30 RPM / 6,000 TPM (Free Tier)' },
  gemini: { maxRpm: 15, maxTpm: 1000000, safeRpm: 12, safeTpm: 800000, desc: '15 RPM / 1M TPM (Free Tier)' },
  openrouter: { maxRpm: 20, maxTpm: 40000, safeRpm: 16, safeTpm: 32000, desc: '20 RPM (Free Tier)' },
  cohere: { maxRpm: 10, maxTpm: 10000, safeRpm: 8, safeTpm: 8000, desc: '10 RPM (Trial Tier)' },
  cloudflare: { maxRpm: 1200, maxTpm: 100000, safeRpm: 1000, safeTpm: 90000, desc: '1,200 RPM (Workers AI)' },
  mistral: { maxRpm: 10, maxTpm: 15000, safeRpm: 8, safeTpm: 12000, desc: '10 RPM (Standard)' },
  nvidia: { maxRpm: 20, maxTpm: 20000, safeRpm: 16, safeTpm: 16000, desc: '20 RPM (Starter Credits)' },
  deepseek: { maxRpm: 60, maxTpm: 60000, safeRpm: 50, safeTpm: 50000, desc: '60 RPM (Pay-as-you-go)' },
  huggingface: { maxRpm: 15, maxTpm: 15000, safeRpm: 12, safeTpm: 12000, desc: '15 RPM (Serverless Free)' },
  openai: { maxRpm: 60, maxTpm: 40000, safeRpm: 50, safeTpm: 35000, desc: '60 RPM (Standard Tier)' },
  ollama: { maxRpm: 9999, maxTpm: 9999999, safeRpm: 9999, safeTpm: 9999999, desc: 'Unlimited (Local Offline)' }
};

class LimitTracker {
  constructor() {
    /** @type {Map<string, { expiresAt: number, reason: string, category: string }>} */
    this.cooldowns = new Map();
    /** @type {Map<string, Array<{ timestamp: number, tokens: number }>>} */
    this.requestWindows = new Map();
  }

  /**
   * Record request velocity in sliding 60-second window to prevent rate-limit hits.
   * @param {string} providerId
   * @param {number} [tokenEstimate=0]
   */
  recordVelocity(providerId, tokenEstimate = 0) {
    if (!providerId) return;
    const id = providerId.toLowerCase();
    this._pruneVelocity(id);
    const windowList = this.requestWindows.get(id) || [];
    windowList.push({
      timestamp: Date.now(),
      tokens: tokenEstimate || 0
    });
    this.requestWindows.set(id, windowList);
  }

  _pruneVelocity(providerId) {
    const id = providerId.toLowerCase();
    const windowList = this.requestWindows.get(id);
    if (!windowList || windowList.length === 0) return;
    const cutoff = Date.now() - 60000;
    const filtered = windowList.filter(item => item.timestamp >= cutoff);
    this.requestWindows.set(id, filtered);
  }

  /**
   * Get velocity and rate-limit headroom information for a provider.
   * @param {string} providerId
   */
  getVelocityInfo(providerId) {
    if (!providerId) {
      return {
        rpm: 0,
        tpm: 0,
        maxRpm: 30,
        maxTpm: 6000,
        loadPercent: 0,
        headroomPercent: 100,
        status: 'Optimal',
        isNearingLimit: false,
        description: 'Standard'
      };
    }

    const id = providerId.toLowerCase();
    const limits = PROVIDER_RATE_LIMITS[id] || { maxRpm: 30, maxTpm: 30000, safeRpm: 25, safeTpm: 25000, desc: 'Standard Tier' };

    this._pruneVelocity(id);
    const windowList = this.requestWindows.get(id) || [];

    const rpm = windowList.length;
    let tpm = 0;
    for (const w of windowList) {
      tpm += (w.tokens || 0);
    }

    const rpmRatio = limits.maxRpm > 0 ? rpm / limits.maxRpm : 0;
    const tpmRatio = limits.maxTpm > 0 ? tpm / limits.maxTpm : 0;
    const loadFactor = Math.max(rpmRatio, tpmRatio);
    const loadPercent = Math.min(100, Math.round(loadFactor * 100));

    const cd = this.getCooldownInfo(providerId);
    let status = 'Optimal';
    let isNearingLimit = false;

    if (cd && cd.active) {
      status = 'Cooldown';
      isNearingLimit = true;
    } else if (loadPercent >= 80) {
      status = 'Near Limit';
      isNearingLimit = true;
    } else if (loadPercent >= 50) {
      status = 'Moderate';
    } else {
      status = 'Optimal';
    }

    return {
      rpm,
      tpm,
      maxRpm: limits.maxRpm,
      maxTpm: limits.maxTpm,
      loadPercent,
      headroomPercent: Math.max(0, 100 - loadPercent),
      status,
      isNearingLimit,
      description: limits.desc
    };
  }

  /**
   * Check if provider is nearing rate limits (>80% capacity within 60s window).
   * @param {string} providerId
   * @returns {boolean}
   */
  isNearingRateLimit(providerId) {
    if (!providerId) return false;
    const v = this.getVelocityInfo(providerId);
    return v.isNearingLimit;
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

    const effectiveHeaders = headers || error?.headers || null;
    const combined = `${msg} ${dataStr}`;
    let category = ErrorCategory.UNKNOWN;
    let retryAfterSeconds = this._extractRetryAfter(effectiveHeaders);

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
    } else if (status === 403 || combined.includes('permission denied') || combined.includes('forbidden') || combined.includes('access denied') || combined.includes('not found for account')) {
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

    const getVal = (name) => {
      if (typeof headers.get === 'function') {
        return headers.get(name) || headers.get(name.toLowerCase());
      } else if (typeof headers === 'object') {
        return headers[name] || headers[name.toLowerCase()];
      }
      return null;
    };

    // Check multiple standard and provider-specific rate limit headers (Mistral, Groq, Cohere, Cloudflare, OpenAI)
    const headerVal = getVal('retry-after') ||
      getVal('x-ratelimit-reset-requests') ||
      getVal('x-ratelimit-reset-tokens') ||
      getVal('x-ratelimit-reset') ||
      getVal('ratelimit-reset');

    if (!headerVal) return null;

    // Check if seconds or epoch timestamp
    const parsedSec = parseFloat(headerVal);
    if (!isNaN(parsedSec)) {
      // If epoch timestamp in seconds (e.g., 1700000000)
      if (parsedSec > 1000000000) {
        const delta = Math.max(1, Math.ceil((parsedSec * 1000 - Date.now()) / 1000));
        return delta;
      }
      return Math.max(1, Math.ceil(parsedSec));
    }

    const parsedDate = Date.parse(headerVal);
    if (!isNaN(parsedDate)) {
      const diff = Math.max(0, Math.ceil((parsedDate - Date.now()) / 1000));
      return diff;
    }

    return null;
  }

  /**
   * Reset / clear cooldown for a provider or all providers.
   * Useful when an API key is updated or rate limit is cleared.
   * @param {string|null} [providerId]
   */
  clearCooldown(providerId = null) {
    if (providerId) {
      this.cooldowns.delete(providerId.toLowerCase());
    } else {
      this.cooldowns.clear();
    }
  }

  /**
   * Set a cooldown period for a provider.
   * @param {string} providerId
   * @param {number} seconds
   * @param {string} reason
   * @param {string} category
   */
  setCooldown(providerId, seconds, reason = 'Rate limited', category = ErrorCategory.RATE_LIMIT) {
    if (!providerId) return;
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
    if (!providerId) return false;
    const info = this.getCooldownInfo(providerId);
    return info.active;
  }

  /**
   * Get detailed cooldown status for a provider.
   * @param {string} providerId
   * @returns {{ active: boolean, remainingSeconds: number, reason: string|null, category: string|null }}
   */
  getCooldownInfo(providerId) {
    if (!providerId) {
      return { active: false, remainingSeconds: 0, reason: null, category: null };
    }
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
  clearCooldown(providerId = null) {
    if (!providerId) {
      this.cooldowns.clear();
      return;
    }
    this.cooldowns.delete(providerId.toLowerCase());
  }
}

module.exports = {
  LimitTracker,
  ErrorCategory
};
