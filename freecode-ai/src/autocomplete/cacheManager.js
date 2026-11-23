'use strict';

const crypto = require('crypto');

/**
 * Intelligent Bounded In-Memory Suggestion Cache.
 * Stores inline suggestions with LRU eviction and TTL invalidation.
 * Never writes source code to disk.
 */
class SuggestionCache {
  /**
   * @param {object} [options]
   * @param {number} [options.maxSize=200]
   * @param {number} [options.defaultTtlMs=60000]
   */
  constructor(options = {}) {
    this.maxSize = options.maxSize || 200;
    this.defaultTtlMs = options.defaultTtlMs || 60000; // 1 minute default
    this.enabled = options.enabled !== false;

    /** @type {Map<string, { value: any, expiresAt: number, tokensSaved: number }>} */
    this._map = new Map();

    // Statistics
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      requestsAvoided: 0,
      tokensSaved: 0
    };
  }

  /**
   * Generates a deterministic cache key from completion context.
   * @param {object} params
   * @param {string} params.providerId
   * @param {string} params.model
   * @param {string} params.language
   * @param {string} params.prefix
   * @param {string} params.suffix
   * @param {object} [params.config]
   * @returns {string}
   */
  static buildKey({ providerId = '', model = '', language = '', prefix = '', suffix = '', config = {} }) {
    const normProv = (providerId || '').toLowerCase().trim();
    const normModel = (model || '').toLowerCase().trim();
    const normLang = (language || '').toLowerCase().trim();
    const normalize = value => {
      if (Array.isArray(value)) return value.map(normalize);
      if (value && typeof value === 'object') {
        return Object.keys(value).sort().reduce((result, key) => {
          result[key] = normalize(value[key]);
          return result;
        }, {});
      }
      return value;
    };
    const normalizedConfig = JSON.stringify(normalize(config || {}));
    const digest = crypto.createHash('sha256')
      .update('inline-v2\0')
      .update(prefix || '')
      .update('\0')
      .update(suffix || '')
      .update('\0')
      .update(normalizedConfig)
      .digest('hex');

    return `${normProv}:${normModel}:${normLang}:${digest}`;
  }

  /**
   * Retrieves a cached suggestion if present and unexpired.
   * @param {string} key
   * @returns {any|null}
   */
  get(key) {
    if (!this.enabled || !key || !this._map.has(key)) {
      this.stats.misses++;
      return null;
    }

    const entry = this._map.get(key);
    const now = Date.now();

    if (entry.expiresAt <= now) {
      this._map.delete(key);
      this.stats.misses++;
      return null;
    }

    // Refresh LRU position (delete & re-insert)
    this._map.delete(key);
    this._map.set(key, entry);

    this.stats.hits++;
    this.stats.requestsAvoided++;
    this.stats.tokensSaved += (entry.tokensSaved || 20);

    return entry.value;
  }

  /**
   * Stores a suggestion in cache.
   * @param {string} key
   * @param {any} value
   * @param {object} [options]
   * @param {number} [options.ttlMs]
   * @param {number} [options.tokensSaved]
   */
  set(key, value, options = {}) {
    if (!this.enabled || !key) return;

    const ttl = options.ttlMs || this.defaultTtlMs;
    const tokensSaved = options.tokensSaved || 20;
    const expiresAt = Date.now() + ttl;

    // LRU eviction if at capacity
    if (this._map.size >= this.maxSize && !this._map.has(key)) {
      const oldestKey = this._map.keys().next().value;
      if (oldestKey) {
        this._map.delete(oldestKey);
        this.stats.evictions++;
      }
    }

    this._map.set(key, { value, expiresAt, tokensSaved });
  }

  /**
   * Removes a specific key or invalidates entries matching a prefix.
   * @param {string} [prefix]
   */
  invalidate(prefix) {
    if (!prefix) {
      this.clear();
      return;
    }
    for (const k of this._map.keys()) {
      if (k.startsWith(prefix)) {
        this._map.delete(k);
      }
    }
  }

  /**
   * Clears the entire cache.
   */
  clear() {
    this._map.clear();
  }

  /**
   * Returns copy of performance metrics.
   * @returns {object}
   */
  getMetrics() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? Math.round((this.stats.hits / total) * 100) : 0;
    return {
      size: this._map.size,
      maxSize: this.maxSize,
      enabled: this.enabled,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRatePercent: hitRate,
      evictions: this.stats.evictions,
      requestsAvoided: this.stats.requestsAvoided,
      tokensSaved: this.stats.tokensSaved
    };
  }
}

module.exports = { SuggestionCache };
