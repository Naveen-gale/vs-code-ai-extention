/**
 * Cache Manager for FreeCode AI Inline Completion Agent.
 * Provides LRU, TTL, and predictive typing cache.
 * When the user types characters that match an existing suggestion,
 * the remaining completion is served in 0ms with zero API calls.
 */

const vscode = require('vscode');

class CacheManager {
  /**
   * @param {object} [options]
   * @param {number} [options.maxEntries=150]
   * @param {number} [options.defaultTtlMs=45000] - 45 seconds
   */
  constructor(options = {}) {
    this.maxEntries = options.maxEntries || 150;
    this.defaultTtlMs = options.defaultTtlMs || 45000;
    /** @type {Map<string, { value: any, expiresAt: number }>} */
    this.cache = new Map();

    /** @type {Map<string, { line: number, character: number, linePrefix: string, insertText: string, expiresAt: number }>} */
    this._recentSuggestions = new Map();
  }

  /**
   * Generate cache key from document URI, position, and prefix tail.
   * @param {string} documentUri
   * @param {{ line: number, character: number }} position
   * @param {string} prefix
   * @returns {string}
   */
  _buildKey(documentUri, position, prefix = '') {
    const uri = documentUri || 'untitled';
    const line = position ? position.line : 0;
    const char = position ? position.character : 0;
    // Use last 100 chars of prefix
    const prefixTail = prefix ? prefix.slice(-100) : '';
    return `${uri}:${line}:${char}:${prefixTail}`;
  }

  /**
   * Retrieve cached item if present and unexpired.
   * @param {string} documentUri
   * @param {{ line: number, character: number }} position
   * @param {string} prefix
   * @returns {any|null}
   */
  get(documentUri, position, prefix = '') {
    const key = this._buildKey(documentUri, position, prefix);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Refresh LRU order
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * Predictive match: checks if user has typed characters that continue
   * a previously generated suggestion on the same line.
   * @param {string} documentUri
   * @param {{ line: number, character: number }} position
   * @param {string} currentLinePrefix
   * @returns {any|null}
   */
  getPredictiveMatch(documentUri, position, currentLinePrefix) {
    if (!documentUri || !position || !currentLinePrefix) {
      return null;
    }

    const recent = this._recentSuggestions.get(documentUri);
    if (!recent || Date.now() > recent.expiresAt) {
      return null;
    }

    // Must be on the exact same line and at or ahead of where suggestion was generated
    if (recent.line !== position.line || position.character < recent.character) {
      return null;
    }

    const typedSince = currentLinePrefix.substring(recent.character, position.character);

    // If the user typed the exact prefix of the suggestion
    if (recent.insertText.startsWith(typedSince)) {
      const remainingText = recent.insertText.substring(typedSince.length);
      if (remainingText && remainingText.trim().length > 0) {
        let range = null;
        if (typeof vscode.Range === 'function') {
          range = new vscode.Range(position, position);
        }

        let item;
        if (typeof vscode.InlineCompletionItem === 'function') {
          item = new vscode.InlineCompletionItem(remainingText, range);
        } else {
          item = { insertText: remainingText, range };
        }
        return [item];
      }
    }

    return null;
  }

  /**
   * Store item in cache with TTL.
   * @param {string} documentUri
   * @param {{ line: number, character: number }} position
   * @param {string} prefix
   * @param {any} value
   * @param {number} [ttlMs]
   * @param {string} [linePrefix]
   */
  set(documentUri, position, prefix = '', value, ttlMs, linePrefix = '') {
    if (value === undefined || value === null) {
      return;
    }

    const key = this._buildKey(documentUri, position, prefix);
    const ttl = ttlMs || this.defaultTtlMs;
    const expiresAt = Date.now() + ttl;

    // Evict oldest if reaching capacity
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { value, expiresAt });

    // Store recent suggestion for predictive typing acceleration
    if (Array.isArray(value) && value.length > 0 && value[0].insertText) {
      this._recentSuggestions.set(documentUri, {
        line: position.line,
        character: position.character,
        linePrefix: linePrefix || '',
        insertText: value[0].insertText,
        expiresAt
      });
    }
  }

  /**
   * Check if an unexpired item exists in cache.
   * @param {string} documentUri
   * @param {{ line: number, character: number }} position
   * @param {string} prefix
   * @returns {boolean}
   */
  has(documentUri, position, prefix = '') {
    return this.get(documentUri, position, prefix) !== null;
  }

  /**
   * Clear all cache entries for a given document URI.
   * @param {string} documentUri
   */
  invalidateDocument(documentUri) {
    if (!documentUri) return;
    this._recentSuggestions.delete(documentUri);
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${documentUri}:`)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cached completions.
   */
  clear() {
    this.cache.clear();
    this._recentSuggestions.clear();
  }

  get size() {
    return this.cache.size;
  }
}

module.exports = { CacheManager };
