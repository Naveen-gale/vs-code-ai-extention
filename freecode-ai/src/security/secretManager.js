/**
 * Secure API Key Storage using VS Code SecretStorage.
 * Ensures API keys are securely stored and never leaked to Webview JavaScript.
 */

class SecretManager {
  /**
   * @param {import('vscode').SecretStorage} secretStorage
   */
  constructor(secretStorage) {
    this.storage = secretStorage;
    this._memoryFallback = new Map();
  }

  _getKeyName(providerId) {
    return `freecode-ai.apiKey.${providerId.toLowerCase()}`;
  }

  /**
   * Store an API key securely.
   * @param {string} providerId
   * @param {string} apiKey
   * @returns {Promise<void>}
   */
  async storeApiKey(providerId, apiKey) {
    if (!providerId) throw new Error('Provider ID is required');
    const trimmedKey = (apiKey || '').trim();
    const keyName = this._getKeyName(providerId);

    if (this.storage && typeof this.storage.store === 'function') {
      await this.storage.store(keyName, trimmedKey);
    } else {
      this._memoryFallback.set(keyName, trimmedKey);
    }
  }

  /**
   * Retrieve an API key securely.
   * @param {string} providerId
   * @returns {Promise<string|null>}
   */
  async getApiKey(providerId) {
    if (!providerId) return null;
    const keyName = this._getKeyName(providerId);

    if (this.storage && typeof this.storage.get === 'function') {
      const key = await this.storage.get(keyName);
      return key || null;
    }

    return this._memoryFallback.get(keyName) || null;
  }

  /**
   * Delete an API key from secure storage.
   * @param {string} providerId
   * @returns {Promise<void>}
   */
  async deleteApiKey(providerId) {
    if (!providerId) return;
    const keyName = this._getKeyName(providerId);

    if (this.storage && typeof this.storage.delete === 'function') {
      await this.storage.delete(keyName);
    } else {
      this._memoryFallback.delete(keyName);
    }
  }

  /**
   * Check whether an API key exists for a provider.
   * @param {string} providerId
   * @returns {Promise<boolean>}
   */
  async hasApiKey(providerId) {
    const key = await this.getApiKey(providerId);
    return Boolean(key && key.trim().length > 0);
  }

  /**
   * Get a masked representation of the key for safe UI status indicators.
   * Never returns the real key.
   * @param {string} providerId
   * @returns {Promise<string>}
   */
  async getMaskedKey(providerId) {
    const key = await this.getApiKey(providerId);
    if (!key) return 'Not configured';
    if (key.length <= 8) return '••••••••';
    const start = key.substring(0, 3);
    const end = key.substring(key.length - 4);
    return `${start}...${end}`;
  }
}

module.exports = { SecretManager };
