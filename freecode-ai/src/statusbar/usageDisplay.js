'use strict';

/**
 * Usage Display Helper for Laven / FreeCode AI Status Bar.
 * Computes honest, provider-specific usage metrics without hardcoded or fake numbers.
 */

const { PROVIDERS, PROVIDER_METADATA } = require('../config/providers');

class UsageDisplay {
  /**
   * Get honest, distinct status / quota string for a given provider.
   * @param {string} providerId
   * @param {import('../usage/usageTracker').UsageTracker} [usageTracker]
   * @param {import('../quota/smartQuotaManager').SmartQuotaManager} [quotaManager]
   * @returns {{
   *   statusText: string,
   *   isCoolingDown: boolean,
   *   loadPercent: number|null,
   *   detail: string
   * }}
   */
  static getProviderMetrics(providerId, usageTracker, quotaManager = null) {
    if (!providerId) {
      return {
        statusText: 'Not configured',
        isCoolingDown: false,
        loadPercent: null,
        detail: 'No provider selected'
      };
    }

    // 1. Ollama is local execution without remote rate limits
    if (providerId === PROVIDERS.OLLAMA) {
      const stats = usageTracker?.storage?.getProviderStats(providerId);
      const reqCount = stats ? stats.totalRequests : 0;
      return {
        statusText: 'LOCAL',
        isCoolingDown: false,
        loadPercent: 0,
        detail: reqCount > 0 ? `Local inference • ${reqCount} requests` : 'Local inference (unlimited)'
      };
    }

    if (!usageTracker) {
      return {
        statusText: 'Usage unavailable',
        isCoolingDown: false,
        loadPercent: null,
        detail: 'Usage tracking unavailable'
      };
    }

    // 2. Check active cooldown
    const cooldownInfo = usageTracker.getCooldownInfo(providerId);
    if (cooldownInfo && (cooldownInfo.active || cooldownInfo.coolingDown)) {
      const secs = cooldownInfo.remainingSeconds || 0;
      return {
        statusText: `Cooldown (${secs}s)`,
        isCoolingDown: true,
        loadPercent: 100,
        detail: `Rate limited: ${cooldownInfo.reason || 'Cooling down'} (${secs}s remaining)`
      };
    }

    // 3. Check live sliding-window velocity
    const velocity = usageTracker.getVelocityInfo(providerId);
    const stats = usageTracker.storage ? usageTracker.storage.getProviderStats(providerId) : null;
    const totalRequests = stats ? stats.totalRequests : 0;
    const totalTokens = stats?.tokens ? stats.tokens.total : 0;

    if (velocity && velocity.rpm > 0) {
      const load = velocity.loadPercent || 0;
      return {
        statusText: `${load}% RPM`,
        isCoolingDown: false,
        loadPercent: load,
        detail: `${velocity.rpm}/${velocity.maxRpm} RPM • ${totalRequests} total reqs (${totalTokens} toks)`
      };
    }

    // 4. If no requests in last 60s, but historical requests exist
    if (totalRequests > 0) {
      return {
        statusText: '0% RPM',
        isCoolingDown: false,
        loadPercent: 0,
        detail: `Optimal • ${totalRequests} total requests (${totalTokens} tokens logged)`
      };
    }

    // 5. No requests recorded yet
    return {
      statusText: 'Usage unavailable',
      isCoolingDown: false,
      loadPercent: null,
      detail: 'Ready • No requests recorded yet'
    };
  }

  /**
   * Format a full status bar tooltip including hybrid quota stats.
   * @param {string|null} activeProvider
   * @param {string|null} activeModel
   * @param {import('../usage/usageTracker').UsageTracker} [usageTracker]
   * @param {boolean} [inlineEnabled=true]
   * @param {import('../quota/smartQuotaManager').SmartQuotaManager} [quotaManager]
   * @returns {string} Markdown tooltip string
   */
  static formatTooltip(activeProvider, activeModel, usageTracker, inlineEnabled = true, quotaManager = null) {
    const meta = activeProvider ? PROVIDER_METADATA[activeProvider] : null;
    const providerName = meta ? meta.name : (activeProvider || 'None');
    const modelName = activeModel || 'None';
    const inlineStatus = inlineEnabled ? 'Enabled $(check)' : 'Disabled $(x)';

    let usageLine = 'Usage: Unavailable';
    if (activeProvider) {
      const metrics = UsageDisplay.getProviderMetrics(activeProvider, usageTracker, quotaManager);
      usageLine = `**API Usage:** ${metrics.statusText} (${metrics.detail})`;
    }

    const lines = [
      `### Laven AI Assistant`,
      `**Active Provider:** ${providerName}`,
      `**Active Model:** \`${modelName}\``,
      `**Inline Suggestions:** ${inlineStatus}`
    ];

    if (quotaManager) {
      const d = quotaManager.getDashboardData();
      const modeLabel = d.mode.charAt(0).toUpperCase() + d.mode.slice(1);
      lines.push(`**Completion Mode:** \`${modeLabel}\``);
      lines.push(usageLine);

      if (d.cache) {
        lines.push(`---`);
        lines.push(`**Cache Hit Rate:** ${d.cache.hitRatePercent}% (${d.cache.hits} hits / ${d.cache.hits + d.cache.misses} total)`);
        lines.push(`**Requests Avoided:** ${d.requestsAvoided} • **Tokens Saved:** ~${d.tokensSaved}`);
        lines.push(`**Completions:** Local: ${d.stats.localCompletions} | Cloud: ${d.stats.cloudCompletions}`);
        lines.push(`**Accepted:** ${d.stats.acceptedSuggestions} | **Rejected:** ${d.stats.rejectedSuggestions}`);
      }
    } else {
      lines.push(usageLine);
    }

    lines.push(`---`);
    lines.push(`*Click to switch provider, change completion mode, or adjust settings*`);

    return lines.join('\n\n');
  }
}

module.exports = { UsageDisplay };
