/**
 * Usage Tracker for FreeCode AI.
 * Tracks requests, tokens (reported vs estimated), errors, and rate limits
 * per provider and model.
 */

const { UsageStorage } = require('./usageStorage');
const { LimitTracker, ErrorCategory } = require('./limitTracker');

class UsageTracker {
  /**
   * @param {import('vscode').Memento} [memento]
   */
  constructor(memento = null) {
    this.storage = new UsageStorage(memento);
    this.limitTracker = new LimitTracker();
  }

  /**
   * Record that a request has started.
   * @param {string} providerId
   * @param {string} modelId
   */
  async recordRequestStart(providerId, modelId) {
    const pStats = this.storage.getProviderStats(providerId);
    const mStats = this.storage.getModelStats(providerId, modelId);

    pStats.totalRequests += 1;
    mStats.totalRequests += 1;

    await this.storage.save();
  }

  /**
   * Record a successful completion.
   * @param {string} providerId
   * @param {string} modelId
   * @param {{ promptTokens: number, completionTokens: number, totalTokens: number, isEstimated: boolean }} usage
   */
  async recordSuccess(providerId, modelId, usage = {}) {
    const pStats = this.storage.getProviderStats(providerId);
    const mStats = this.storage.getModelStats(providerId, modelId);
    const now = new Date().toISOString();

    pStats.successfulRequests += 1;
    mStats.successfulRequests += 1;
    pStats.lastSuccessfulRequest = now;
    mStats.lastSuccessfulRequest = now;

    const pTok = usage.promptTokens || 0;
    const cTok = usage.completionTokens || 0;
    const tTok = usage.totalTokens || (pTok + cTok);

    pStats.tokens.prompt += pTok;
    pStats.tokens.completion += cTok;
    pStats.tokens.total += tTok;

    mStats.tokens.prompt += pTok;
    mStats.tokens.completion += cTok;
    mStats.tokens.total += tTok;

    if (usage.isEstimated) {
      pStats.tokens.estimated += tTok;
      mStats.tokens.estimated += tTok;
    } else {
      pStats.tokens.reported += tTok;
      mStats.tokens.reported += tTok;
    }

    // Clear any active cooldown on verified success
    this.limitTracker.clearCooldown(providerId);

    await this.storage.save();
  }

  /**
   * Record a failed request with error classification.
   * @param {string} providerId
   * @param {string} modelId
   * @param {any} error
   * @param {any} [headers]
   * @returns {{ category: string, message: string, retryAfterSeconds: number|null }}
   */
  async recordFailure(providerId, modelId, error, headers = null) {
    const pStats = this.storage.getProviderStats(providerId);
    const mStats = this.storage.getModelStats(providerId, modelId);

    pStats.failedRequests += 1;
    mStats.failedRequests += 1;

    const classification = this.limitTracker.classifyError(error, headers);
    const errRecord = {
      message: classification.message,
      category: classification.category,
      timestamp: new Date().toISOString()
    };

    pStats.lastError = errRecord;
    mStats.lastError = errRecord;

    if (classification.category === ErrorCategory.RATE_LIMIT || classification.category === ErrorCategory.QUOTA_EXHAUSTED) {
      pStats.rateLimitErrors += 1;
      mStats.rateLimitErrors += 1;

      const duration = classification.retryAfterSeconds || 60;
      this.limitTracker.setCooldown(
        providerId,
        duration,
        classification.message,
        classification.category
      );
    }

    await this.storage.save();
    return classification;
  }

  /**
   * Check if a provider is cooling down.
   * @param {string} providerId
   */
  isCoolingDown(providerId) {
    return this.limitTracker.isCoolingDown(providerId);
  }

  /**
   * Get cooldown information for a provider.
   * @param {string} providerId
   */
  getCooldownInfo(providerId) {
    return this.limitTracker.getCooldownInfo(providerId);
  }

  /**
   * Get structured dashboard data.
   * @param {string} activeProvider
   * @param {string} activeModel
   */
  getDashboardData(activeProvider, activeModel) {
    const all = this.storage.getAll();
    const providerStats = this.storage.getProviderStats(activeProvider);
    const modelStats = this.storage.getModelStats(activeProvider, activeModel);
    const cooldownInfo = this.getCooldownInfo(activeProvider);

    return {
      activeProvider,
      activeModel,
      cooldown: cooldownInfo,
      providerStats,
      modelStats,
      allProviders: all.providers
    };
  }

  /**
   * Reset stats.
   * @param {string} [providerId]
   */
  async reset(providerId = null) {
    await this.storage.reset(providerId);
    this.limitTracker.clearCooldown(providerId);
  }

  clearCooldown(providerId = null) {
    this.limitTracker.clearCooldown(providerId);
  }
}

module.exports = {
  UsageTracker,
  ErrorCategory
};
