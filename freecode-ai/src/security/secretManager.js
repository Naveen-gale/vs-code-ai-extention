/**
 * Secure API Key Storage using VS Code SecretStorage.
 * Ensures API keys are securely stored independently per provider and never leaked to Webview JavaScript.
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
    return `freecode-ai.apiKey.${(providerId || '').toLowerCase()}`;
  }

  /**
   * Store an API key securely for a specific provider.
   * @param {string} providerId
   * @param {string} apiKey
   * @returns {Promise<void>}
   */
  async storeApiKey(providerId, apiKey) {
    if (!providerId) throw new Error('Provider ID is required');
    const trimmedKey = (apiKey || '').trim();
    const keyName = this._getKeyName(providerId);

    if (this.storage && typeof this.storage.store === 'function') {
      try {
        await this.storage.store(keyName, trimmedKey);
      } catch (err) {
        console.warn(`FreeCode AI: Failed to store key in SecretStorage for ${providerId}, using fallback:`, err.message);
        this._memoryFallback.set(keyName, trimmedKey);
      }
    } else {
      this._memoryFallback.set(keyName, trimmedKey);
    }
  }

  /**
   * Alias for storeApiKey to satisfy API requirements.
   * @param {string} providerId
   * @param {string} apiKey
   * @returns {Promise<void>}
   */
  async saveApiKey(providerId, apiKey) {
    return this.storeApiKey(providerId, apiKey);
  }

  /**
   * Retrieve an API key securely for a specific provider.
   * @param {string} providerId
   * @returns {Promise<string|null>}
   */
  async getApiKey(providerId) {
    if (!providerId) return null;
    const keyName = this._getKeyName(providerId);

    if (this.storage && typeof this.storage.get === 'function') {
      try {
        const key = await this.storage.get(keyName);
        if (key) return key;
      } catch (err) {
        console.warn(`FreeCode AI: Failed to read key from SecretStorage for ${providerId}:`, err.message);
      }
    }

    return this._memoryFallback.get(keyName) || null;
  }

  /**
   * Delete an API key from secure storage for a specific provider.
   * @param {string} providerId
   * @returns {Promise<void>}
   */
  async deleteApiKey(providerId) {
    if (!providerId) return;
    const keyName = this._getKeyName(providerId);

    if (this.storage && typeof this.storage.delete === 'function') {
      try {
        await this.storage.delete(keyName);
      } catch (err) {
        console.warn(`FreeCode AI: Failed to delete key from SecretStorage for ${providerId}:`, err.message);
      }
    }

    this._memoryFallback.delete(keyName);
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
   * Never returns the real key or exposes sensitive middle bytes.
   * e.g. "••••••••1234"
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
