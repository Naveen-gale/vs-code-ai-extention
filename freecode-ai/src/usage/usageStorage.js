/**
 * Persistent Storage for LLM Usage Statistics using VS Code Memento / globalState.
 */

class UsageStorage {
  /**
   * @param {import('vscode').Memento} [memento]
   */
  constructor(memento = null) {
    this.memento = memento;
    this.storageKey = 'freecode-ai.usage.records';
    this.cache = this._loadInitial();
  }

  _loadInitial() {
    if (this.memento && typeof this.memento.get === 'function') {
      const saved = this.memento.get(this.storageKey);
      if (saved && typeof saved === 'object') {
        return saved;
      }
    }
    return { providers: {} };
  }

  _getEmptyStats() {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitErrors: 0,
      tokens: {
        prompt: 0,
        completion: 0,
        total: 0,
        reported: 0,
        estimated: 0
      },
      lastSuccessfulRequest: null,
      lastError: null,
      models: {}
    };
  }

  _getEmptyModelStats() {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitErrors: 0,
      tokens: {
        prompt: 0,
        completion: 0,
        total: 0,
        reported: 0,
        estimated: 0
      },
      lastSuccessfulRequest: null,
      lastError: null
    };
  }

  /**
   * Get raw statistics object.
   */
  getAll() {
    return this.cache;
  }

  /**
   * Get stats for a specific provider.
   * @param {string} providerId
   */
  getProviderStats(providerId) {
    if (!providerId) {
      return this._getEmptyStats();
    }
    const id = providerId.toLowerCase();
    if (!this.cache.providers[id]) {
      this.cache.providers[id] = this._getEmptyStats();
    }
    return this.cache.providers[id];
  }

  /**
   * Get stats for a specific model under a provider.
   * @param {string} providerId
   * @param {string} modelId
   */
  getModelStats(providerId, modelId) {
    if (!providerId || !modelId) {
      return this._getEmptyModelStats();
    }
    const provider = this.getProviderStats(providerId);
    if (!provider.models[modelId]) {
      provider.models[modelId] = this._getEmptyModelStats();
    }
    return provider.models[modelId];
  }

  /**
   * Persist current cache to Memento.
   */
  async save() {
    if (this.memento && typeof this.memento.update === 'function') {
      await this.memento.update(this.storageKey, this.cache);
    }
  }

  /**
   * Reset stats for a provider or all providers.
   * @param {string} [providerId]
   */
  async reset(providerId = null) {
    if (providerId) {
      delete this.cache.providers[providerId.toLowerCase()];
    } else {
      this.cache = { providers: {} };
    }
    await this.save();
  }
}

module.exports = { UsageStorage };
