/**
 * Fallback Manager for FreeCode AI.
 * Orchestrates multi-provider failover according to user-defined priority order.
 * Ensures the user is always notified and prompted before switching models when errors or rate limits occur.
 */

const { PROVIDER_METADATA } = require('../config/providers');

class FallbackManager {
  /**
   * @param {import('../providers/providerManager').ProviderManager} providerManager
   * @param {import('../usage/usageTracker').UsageTracker} [usageTracker]
   */
  constructor(providerManager, usageTracker = null) {
    this.providerManager = providerManager;
    this.usageTracker = usageTracker;
  }

  /**
   * Find the next candidate provider in priority order.
   * Excludes the failed provider and any provider currently cooling down.
   * @param {string} failedProviderId
   * @returns {Promise<{ id: string, name: string, model: string, priority: number } | null>}
   */
  async getNextProvider(failedProviderId) {
    if (!this.providerManager) return null;
    return await this.providerManager.getNextFallbackProvider(failedProviderId, this.usageTracker);
  }

  /**
   * Get sorted fallback chain of all currently configured providers.
   * @returns {Promise<Array<{ id: string, name: string, model: string, priority: number, isCoolingDown: boolean }>>}
   */
  async getPriorityChain() {
    if (!this.providerManager) return [];
    const configured = await this.providerManager.getConfiguredProviders();
    const chain = [];

    for (const id of configured) {
      const cfg = await this.providerManager.getProviderConfiguration(id);
      const meta = PROVIDER_METADATA[id] || { id, name: id };
      const cd = this.usageTracker ? this.usageTracker.getCooldownInfo(id) : null;
      chain.push({
        id,
        name: meta.name || id,
        model: cfg.model || meta.defaultModel,
        priority: typeof cfg.priority === 'number' ? cfg.priority : 99,
        isCoolingDown: Boolean(cd && cd.active)
      });
    }

    chain.sort((a, b) => a.priority - b.priority);
    return chain;
  }
}

module.exports = { FallbackManager };
