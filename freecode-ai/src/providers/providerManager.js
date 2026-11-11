/**
 * Provider Manager for FreeCode AI.
 * Handles multi-provider management, persistent active provider selection,
 * per-provider model preferences, connection states, and status reporting.
 */

const path = require('path');
const fs = require('fs');
const { PROVIDERS, PROVIDER_METADATA } = require('../config/providers');
const { getDefaultModelId } = require('../config/modelRegistry');

class ProviderManager {
  /**
   * @param {import('vscode').ExtensionContext|object} contextOrGlobalState
   * @param {import('../security/secretManager').SecretManager} [secretManager]
   */
  constructor(contextOrGlobalState, secretManager = null) {
    if (contextOrGlobalState && contextOrGlobalState.globalState) {
      this._globalState = contextOrGlobalState.globalState;
      this._context = contextOrGlobalState;
    } else {
      this._globalState = contextOrGlobalState;
      this._context = (contextOrGlobalState && (contextOrGlobalState.globalStorageUri || contextOrGlobalState.globalStoragePath))
        ? contextOrGlobalState
        : null;
    }

    this.secretManager = secretManager;
    this._CONFIG_KEY = 'freecodeAI.providerConfig'; // { [providerId]: { model?: string, endpoint?: string, connectionState?: string, configured?: boolean } }
    this._ACTIVE_KEY = 'freecodeAI.activeProvider';

    // In-memory connection test results cache
    this._connectionStates = new Map();
  }

  setSecretManager(sm) {
    this.secretManager = sm;
  }

  // ------------------- Internal Storage & Disk Persistence Helpers -------------------

  _getStorageFilePath() {
    try {
      let storageDir = null;
      if (this._context && this._context.globalStorageUri && this._context.globalStorageUri.fsPath) {
        storageDir = this._context.globalStorageUri.fsPath;
      } else if (this._context && this._context.globalStoragePath) {
        storageDir = this._context.globalStoragePath;
      }

      if (!storageDir) {
        return null;
      }

      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
      }

      return path.join(storageDir, 'provider-configs.json');
    } catch (e) {
      return null;
    }
  }

  _readDiskConfig() {
    try {
      const filePath = this._getStorageFilePath();
      if (filePath && fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
      }
    } catch (e) {
      // safe fallback
    }
    return null;
  }

  _writeDiskConfig(config) {
    try {
      const filePath = this._getStorageFilePath();
      if (filePath) {
        const safe = {};
        for (const [k, v] of Object.entries(config || {})) {
          if (typeof v === 'object' && v !== null) {
            // Strip any sensitive credentials if accidentally present
            const { apiKey, secret, ...rest } = v;
            safe[k] = rest;
          } else {
            safe[k] = v;
          }
        }
        fs.writeFileSync(filePath, JSON.stringify(safe, null, 2), 'utf8');
      }
    } catch (e) {
      // safe fallback
    }
  }

  _loadConfig() {
    let config = {};
    if (this._globalState && typeof this._globalState.get === 'function') {
      try {
        const raw = this._globalState.get(this._CONFIG_KEY, {});
        // Deep clone so in-place edits never mutate VS Code Memento internal object reference
        config = JSON.parse(JSON.stringify(raw || {}));
      } catch (e) {
        config = {};
      }
    }

    // Merge from disk storage backup
    const diskConfig = this._readDiskConfig();
    if (diskConfig && typeof diskConfig === 'object') {
      for (const [k, v] of Object.entries(diskConfig)) {
        if (k === '_activeProvider') continue;
        if (!config[k]) {
          config[k] = v;
        } else if (typeof v === 'object' && v !== null) {
          config[k] = { ...v, ...config[k] };
        }
      }
    }

    return config;
  }

  async _saveConfig(config) {
    // 1. Deep clone so VS Code globalState reference comparison triggers disk write
    const cloned = JSON.parse(JSON.stringify(config || {}));
    if (this._globalState && typeof this._globalState.update === 'function') {
      await this._globalState.update(this._CONFIG_KEY, cloned);
    }

    // 2. Persist to disk backup
    const diskConfig = this._readDiskConfig() || {};
    const merged = { ...diskConfig, ...cloned };
    this._writeDiskConfig(merged);
  }

  // ------------------- Public API -------------------

  /**
   * Returns metadata for all supported providers.
   * @returns {Array<object>}
   */
  getAllProviders() {
    return Object.values(PROVIDER_METADATA);
  }

  /**
   * Returns list of configured provider IDs.
   * @returns {Promise<Array<string>>}
   */
  async getConfiguredProviders() {
    const list = [];
    const config = this._loadConfig();
    for (const id of Object.values(PROVIDERS)) {
      const meta = PROVIDER_METADATA[id];
      if (meta.requiresApiKey) {
        if (this.secretManager && (await this.secretManager.hasApiKey(id))) {
          list.push(id);
        }
      } else {
        // Local provider like Ollama: only considered configured if user explicitly saved config/endpoint
        if (config[id] && (config[id].configured || config[id].endpoint || config[id].model)) {
          list.push(id);
        }
      }
    }
    return list;
  }

  /**
   * Sets the active provider.
   * @param {string|null} providerId
   * @returns {Promise<void>}
   */
  async setActiveProvider(providerId) {
    const val = providerId || null;
    if (this._globalState && typeof this._globalState.update === 'function') {
      await this._globalState.update(this._ACTIVE_KEY, val);
    }
    const diskConfig = this._readDiskConfig() || {};
    diskConfig._activeProvider = val;
    this._writeDiskConfig(diskConfig);
  }

  /**
   * Check whether a specific provider is configured with credentials.
   * @param {string} providerId
   * @returns {Promise<boolean>}
   */
  async isProviderConfigured(providerId) {
    if (!providerId) return false;
    const meta = PROVIDER_METADATA[providerId];
    if (!meta) return false;
    if (meta.requiresApiKey) {
      return this.secretManager ? await this.secretManager.hasApiKey(providerId) : false;
    } else {
      const config = this._loadConfig();
      return Boolean(config[providerId] && (config[providerId].configured || config[providerId].endpoint || config[providerId].model));
    }
  }

  /**
   * Gets the active provider ID (unvalidated raw value).
   * @returns {string|null}
   */
  getActiveProvider() {
    let active = null;
    if (this._globalState && typeof this._globalState.get === 'function') {
      active = this._globalState.get(this._ACTIVE_KEY, null);
    }
    if (!active) {
      const diskConfig = this._readDiskConfig();
      if (diskConfig && diskConfig._activeProvider) {
        active = diskConfig._activeProvider;
      }
    }
    return active || null;
  }

  /**
   * Gets the validated active provider ID.
   * If stored active provider is not configured, returns another configured provider or null.
   * @returns {Promise<string|null>}
   */
  async getValidatedActiveProvider() {
    const raw = this.getActiveProvider();
    if (!raw) {
      return null;
    }
    if (await this.isProviderConfigured(raw)) {
      return raw;
    }
    const configuredList = await this.getConfiguredProviders();
    if (configuredList.length > 0) {
      await this.setActiveProvider(configuredList[0]);
      return configuredList[0];
    }
    await this.setActiveProvider(null);
    return null;
  }

  _getDefaultPriority(providerId) {
    const defaults = {
      gemini: 1,
      groq: 2,
      openrouter: 3,
      ollama: 4
    };
    return defaults[providerId] || 99;
  }

  /**
   * Get non-secret configuration for a provider (e.g. selected model, endpoint, priority).
   * @param {string} providerId
   * @returns {Promise<object>}
   */
  async getProviderConfiguration(providerId) {
    const config = this._loadConfig();
    const meta = PROVIDER_METADATA[providerId] || {};
    const stored = config[providerId] || {};
    return {
      model: stored.model || getDefaultModelId(providerId) || meta.defaultModel,
      endpoint: stored.endpoint || meta.defaultEndpoint || null,
      connectionState: this._connectionStates.get(providerId) || stored.connectionState || 'untested',
      priority: stored.priority !== undefined ? Number(stored.priority) : this._getDefaultPriority(providerId)
    };
  }

  /**
   * Store non-secret configuration for a provider.
   * @param {string} providerId
   * @param {object} updates
   * @returns {Promise<void>}
   */
  async setProviderConfiguration(providerId, updates = {}) {
    const config = this._loadConfig();
    if (!config[providerId]) {
      config[providerId] = {};
    }
    config[providerId].configured = true;
    if (updates.model !== undefined) {
      config[providerId].model = updates.model;
    }
    if (updates.endpoint !== undefined) {
      config[providerId].endpoint = updates.endpoint;
    }
    if (updates.priority !== undefined) {
      config[providerId].priority = Number(updates.priority);
    }
    if (updates.connectionState !== undefined) {
      config[providerId].connectionState = updates.connectionState;
      this._connectionStates.set(providerId, updates.connectionState);
    }
    await this._saveConfig(config);
  }

  /**
   * Set fallback priority for a provider (e.g. 1 = Primary, 2 = 1st Fallback, etc.).
   * @param {string} providerId
   * @param {number} priority
   * @returns {Promise<void>}
   */
  async setProviderPriority(providerId, priority) {
    await this.setProviderConfiguration(providerId, { priority: Number(priority) });
  }

  /**
   * Get the next best fallback provider ordered by user priority.
   * Excludes the failed provider and any provider currently cooling down or unconfigured.
   * @param {string} failedProviderId
   * @param {import('../usage/usageTracker').UsageTracker} [usageTracker]
   * @returns {Promise<{ id: string, name: string, model: string, priority: number } | null>}
   */
  async getNextFallbackProvider(failedProviderId, usageTracker = null) {
    const configured = await this.getConfiguredProviders();
    const candidates = [];

    for (const id of configured) {
      if (id === failedProviderId) continue;

      // Filter out providers currently cooling down
      if (usageTracker) {
        const cd = usageTracker.getCooldownInfo(id);
        if (cd && cd.active) continue;
      }

      const cfg = await this.getProviderConfiguration(id);
      const meta = PROVIDER_METADATA[id] || { id, name: id };
      candidates.push({
        id,
        name: meta.name || id,
        model: cfg.model || meta.defaultModel,
        priority: typeof cfg.priority === 'number' ? cfg.priority : this._getDefaultPriority(id)
      });
    }

    if (candidates.length === 0) return null;

    // Sort by priority ascending (1 = highest priority, 2, 3...)
    candidates.sort((a, b) => a.priority - b.priority);
    return candidates[0];
  }

  /**
   * Update the live connection test state for a provider.
   * @param {string} providerId
   * @param {'connected'|'error'|'disconnected'|'untested'} state
   */
  setConnectionState(providerId, state) {
    this._connectionStates.set(providerId, state);
  }

  /**
   * Get detailed status for a provider (safe for UI display).
   * @param {string} providerId
   * @returns {Promise<object>}
   */
  async getProviderStatus(providerId) {
    const meta = PROVIDER_METADATA[providerId] || { id: providerId, name: providerId };
    const isConfigured = await this.isProviderConfigured(providerId);
    let maskedKey = 'Not configured';

    if (meta.requiresApiKey) {
      if (isConfigured && this.secretManager) {
        maskedKey = await this.secretManager.getMaskedKey(providerId);
      }
    } else {
      maskedKey = isConfigured ? 'Local (No key required)' : 'Not configured';
    }

    const config = await this.getProviderConfiguration(providerId);
    const activeProvider = await this.getValidatedActiveProvider();
    const liveConnState = this._connectionStates.get(providerId);

    // Calculate overall connection status
    let connectionStatus = 'not_configured';
    if (isConfigured) {
      if (liveConnState === 'connected') {
        connectionStatus = 'connected';
      } else if (liveConnState === 'error') {
        connectionStatus = 'error';
      } else if (liveConnState === 'disconnected') {
        connectionStatus = 'disconnected';
      } else {
        connectionStatus = 'configured';
      }
    }

    // A provider can only be active if it IS configured!
    const isActive = Boolean(isConfigured && activeProvider === providerId);

    return {
      id: providerId,
      name: meta.name || providerId,
      description: meta.description || '',
      requiresApiKey: meta.requiresApiKey,
      isConfigured,
      status: isConfigured ? 'Configured' : 'Not configured',
      connectionStatus,
      maskedKey,
      selectedModel: config.model,
      endpoint: config.endpoint,
      priority: config.priority,
      isActive,
      apiKeyUrl: meta.apiKeyUrl || null
    };
  }

  /**
   * Get statuses for all providers at once.
   * @returns {Promise<Array<object>>}
   */
  async getAllProviderStatuses() {
    const providers = Object.values(PROVIDERS);
    const statuses = [];
    for (const p of providers) {
      statuses.push(await this.getProviderStatus(p));
    }
    return statuses;
  }

  /**
   * Completely remove a provider configuration and its secret.
   * Other providers' credentials remain untouched.
   * @param {string} providerId
   * @returns {Promise<void>}
   */
  async removeProvider(providerId) {
    // 1. Delete secret if key-based
    if (this.secretManager) {
      await this.secretManager.deleteApiKey(providerId);
    }

    // 2. Clear stored globalState config for this provider
    const config = this._loadConfig();
    delete config[providerId];
    const cloned = JSON.parse(JSON.stringify(config || {}));
    if (this._globalState && typeof this._globalState.update === 'function') {
      await this._globalState.update(this._CONFIG_KEY, cloned);
    }

    // Explicitly update disk storage
    const diskConfig = this._readDiskConfig() || {};
    delete diskConfig[providerId];
    if (diskConfig._activeProvider === providerId) {
      diskConfig._activeProvider = null;
    }
    this._writeDiskConfig(diskConfig);

    // 3. Clear in-memory connection state
    this._connectionStates.delete(providerId);

    // 4. If this was the active provider, switch active to another configured provider
    if (this.getActiveProvider() === providerId) {
      const configured = await this.getConfiguredProviders();
      const remaining = configured.filter(p => p !== providerId);
      if (remaining.length > 0) {
        await this.setActiveProvider(remaining[0]);
      } else {
        await this.setActiveProvider(null);
      }
    }
  }
}

module.exports = { ProviderManager };
