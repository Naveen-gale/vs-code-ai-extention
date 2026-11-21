const { PROVIDERS } = require('../config/providers');
const { ModelDiscovery } = require('../providers/modelDiscovery');

class ModelRouter {
  constructor({ providerManager, secretManager, usageTracker = null, fallbackManager = null } = {}) {
    this.providerManager = providerManager;
    this.secretManager = secretManager;
    this.usageTracker = usageTracker;
    this.fallbackManager = fallbackManager;
  }

  async route(request = {}) {
    const taskType = request.taskType || 'auto';
    const providerId = request.providerId ||
      (this.providerManager ? this.providerManager.getActiveProvider() : null);
    if (!providerId) return null;

    const cfg = this.providerManager
      ? await this.providerManager.getProviderConfiguration(providerId)
      : {};

    if (providerId === PROVIDERS.FREELLMAPI) {
      const key = this.secretManager
        ? await this.secretManager.getApiKey(PROVIDERS.FREELLMAPI)
        : null;
      const models = key
        ? await ModelDiscovery.fetchModels(PROVIDERS.FREELLMAPI, {
          apiKey: key,
          endpoint: cfg.endpoint
        })
        : [];

      if (cfg.selectionMode === 'manual') {
        if (cfg.model && (!models.length || models.some(m => m.id === cfg.model))) {
          return { providerId, model: cfg.model, mode: 'manual', reason: 'Manual model selection' };
        }
      }

      let model;
      if (taskType === 'inline') model = 'auto:fast';
      else if (taskType === 'agent' || taskType === 'code') model = 'auto:smart';
      else model = 'auto';

      return { providerId, model, mode: 'auto', reason: `FreeLLMAPI ${taskType} routing` };
    }

    return {
      providerId,
      model: request.model || cfg.model,
      mode: cfg.selectionMode === 'auto' ? 'auto' : 'manual',
      reason: 'Existing provider routing'
    };
  }
}

module.exports = { ModelRouter };
