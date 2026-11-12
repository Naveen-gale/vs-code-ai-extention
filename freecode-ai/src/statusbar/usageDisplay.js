/**
 * Usage Display Helper for FreeCode AI Status Bar.
 * Computes honest, provider-specific usage metrics without hardcoded or fake numbers.
 */

const { PROVIDERS, PROVIDER_METADATA } = require('../config/providers');

class UsageDisplay {
  /**
   * Get honest, distinct status / quota string for a given provider.
   * @param {string} providerId
   * @param {import('../usage/usageTracker').UsageTracker} [usageTracker]
   * @returns {{
   *   statusText: string,
   *   isCoolingDown: boolean,
   *   loadPercent: number|null,
   *   detail: string
   * }}
   */
  static getProviderMetrics(providerId, usageTracker) {
    if (!providerId) {
      return {
        statusText: 'Not configured',
        isCoolingDown: false,
        loadPercent: null,
        detail: 'No provider selected'
      };
    }

    // 1. Ollama is always local execution without rate limits
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
    const stats = usageTracker.storage.getProviderStats(providerId);
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
   * Format a full status bar tooltip.
   * @param {string|null} activeProvider
   * @param {string|null} activeModel
   * @param {import('../usage/usageTracker').UsageTracker} [usageTracker]
   * @param {boolean} [inlineEnabled=true]
   * @returns {string} Markdown tooltip string
   */
  static formatTooltip(activeProvider, activeModel, usageTracker, inlineEnabled = true) {
    const meta = activeProvider ? PROVIDER_METADATA[activeProvider] : null;
    const providerName = meta ? meta.name : (activeProvider || 'None');
    const modelName = activeModel || 'None';
    const inlineStatus = inlineEnabled ? 'Enabled $(check)' : 'Disabled $(x)';

    let usageLine = 'Usage: Unavailable';
    if (activeProvider) {
      const metrics = UsageDisplay.getProviderMetrics(activeProvider, usageTracker);
      usageLine = `**API Usage:** ${metrics.statusText} (${metrics.detail})`;
    }

    return [
      `### Laven`,
      `**Active Provider:** ${providerName}`,
      `**Active Model:** \`${modelName}\``,
      `**Inline Suggestions:** ${inlineStatus}`,
      usageLine,
      `---`,
      `*Click to switch provider or change settings*`
    ].join('\n\n');
  }
}

module.exports = { UsageDisplay };
