'use strict';

/**
 * Smart Quota Manager for Laven / FreeCode AI.
 * Coordinates:
 * - Hybrid local-first (Ollama) & cloud fallback routing
 * - Strict user provider priority order
 * - Request eligibility, RPM/TPM sliding window tracking, and cooldowns
 * - Circuit breakers (Closed, Open, Half-open)
 * - Intelligent suggestion cache integration
 * - Concurrency tracking & stale request cancellation
 * - Absolute API key preservation in SecretStorage
 */

const vscode = require('vscode');
const { PROVIDERS, PROVIDER_METADATA } = require('../config/providers');
const { SuggestionCache } = require('../autocomplete/cacheManager');

const CircuitState = {
  CLOSED: 'CLOSED',       // Normal operation
  OPEN: 'OPEN',           // Cooldown active, provider bypassed
  HALF_OPEN: 'HALF_OPEN'  // Testing recovery with cautious request
};

class SmartQuotaManager {
  /**
   * @param {object} deps
   * @param {import('../providers/providerManager').ProviderManager} deps.providerManager
   * @param {import('../security/secretManager').SecretManager} deps.secretManager
   * @param {import('../usage/usageTracker').UsageTracker} deps.usageTracker
   * @param {import('vscode').ExtensionContext} [deps.context]
   * @param {object} [deps.options]
   */
  constructor({ providerManager, secretManager, usageTracker, context, options = {} }) {
    if (!providerManager) throw new Error('SmartQuotaManager: providerManager is required');
    if (!secretManager)   throw new Error('SmartQuotaManager: secretManager is required');
    if (!usageTracker)    throw new Error('SmartQuotaManager: usageTracker is required');

    this.providerManager = providerManager;
    this.secretManager   = secretManager;
    this.usageTracker    = usageTracker;
    this._context        = context;

    // Cache
    this.cache = new SuggestionCache({
      enabled: options.cacheEnabled !== false,
      maxSize: options.cacheMaxSize || 300,
      defaultTtlMs: options.cacheTtlMs || 60000
    });

    // Concurrency tracking: documentUri -> { controller: AbortController, timestamp: number }
    this._activeRequests = new Map();
    this.maxConcurrent = options.maxConcurrent || 2;

    // Circuit breakers: providerId -> { state: CircuitState, failCount: number, lastStateChange: number }
    this._circuitBreakers = new Map();

    // Local usage stats (in addition to usageTracker)
    this.stats = {
      acceptedSuggestions: 0,
      rejectedSuggestions: 0,
      localCompletions: 0,
      cloudCompletions: 0,
      dailyRequestsCount: 0,
      dailyEstimatedTokens: 0,
      dailyResetDate: new Date().toDateString()
    };

    // Logging prefix
    this.logTag = '[ Laven Quota ]';
  }

  // --------------------------------------------------------------------------
  // Configuration & Mode Getters / Setters
  // --------------------------------------------------------------------------

  /**
   * Reads configuration setting with backwards-compatible prefix support.
   * Checks 'laven.inline.*', 'laven.providers.*', and 'freecodeAi.*'.
   */
  getConfig(key, defaultValue) {
    try {
      if (typeof vscode !== 'undefined' && vscode.workspace && vscode.workspace.getConfiguration) {
        const lavenInline = vscode.workspace.getConfiguration('laven.inline');
        if (lavenInline.has(key)) return lavenInline.get(key);

        const lavenProviders = vscode.workspace.getConfiguration('laven.providers');
        if (lavenProviders.has(key)) return lavenProviders.get(key);

        const legacy = vscode.workspace.getConfiguration('freecodeAi');
        if (legacy.has(key)) return legacy.get(key);
      }
    } catch (_) {}
    return defaultValue;
  }

  /**
   * Get current completion mode: 'hybrid' (default), 'local', or 'cloud'.
   * @returns {'hybrid'|'local'|'cloud'}
   */
  getCompletionMode() {
    const rawMode = this.getConfig('completionMode', 'hybrid');
    const localOnly = this.getConfig('localOnly', false);
    if (localOnly || rawMode === 'local') return 'local';
    if (rawMode === 'cloud') return 'cloud';
    return 'hybrid';
  }

  /**
   * Sets completion mode.
   * @param {'hybrid'|'local'|'cloud'} mode
   */
  async setCompletionMode(mode) {
    const valid = ['hybrid', 'local', 'cloud'].includes(mode) ? mode : 'hybrid';
    try {
      if (typeof vscode !== 'undefined' && vscode.workspace && vscode.workspace.getConfiguration) {
        await vscode.workspace.getConfiguration('laven.inline').update('completionMode', valid, vscode.ConfigurationTarget.Global);
      }
    } catch (_) {}
  }

  /**
   * Check if cloud fallback is enabled.
   * @returns {boolean}
   */
  isCloudFallbackEnabled() {
    if (this.getCompletionMode() === 'local') return false;
    return this.getConfig('cloudFallbackEnabled', true) !== false;
  }

  // --------------------------------------------------------------------------
  // Provider Priority & Eligibility Routing
  // --------------------------------------------------------------------------

  /**
   * Returns list of configured providers ordered strictly by user priority (lowest number = highest priority).
   * @returns {Promise<Array<{ id: string, name: string, model: string, priority: number, isLocal: boolean }>>}
   */
  async getPriorityOrderedProviders() {
    const configured = await this.providerManager.getConfiguredProviders();
    const activeId = this.providerManager && typeof this.providerManager.getActiveProvider === 'function'
      ? this.providerManager.getActiveProvider()
      : null;
    const list = [];

    for (const id of configured) {
      const cfg = await this.providerManager.getProviderConfiguration(id);
      const meta = PROVIDER_METADATA[id] || { id, name: id, defaultModel: 'default' };
      const priority = typeof cfg.priority === 'number'
        ? cfg.priority
        : (id === activeId ? 0 : 99);
      list.push({
        id,
        name: meta.name || id,
        model: cfg.model || meta.defaultModel,
        priority,
        isLocal: id === PROVIDERS.OLLAMA
      });
    }

    list.sort((a, b) => a.priority - b.priority);
    return list;
  }

  /**
   * Selects the single best eligible provider for an inline completion request.
   * Respects Mode (Hybrid / Local / Cloud) and strict User Priority.
   * @param {object} [context]
   * @param {number} [context.estimatedTokens=50]
   * @param {string} [context.documentUri]
   * @returns {Promise<{ provider: object|null, providerId: string|null, model: string|null, isLocal: boolean, reason: string|null }>}
   */
  async selectProviderForInline(context = {}) {
    this._checkDailyReset();

    const mode = this.getCompletionMode();
    const ordered = await this.getPriorityOrderedProviders();

    // 1. MODE B: LOCAL ONLY
    if (mode === 'local') {
      const ollamaConfig = ordered.find(p => p.id === PROVIDERS.OLLAMA);
      if (!ollamaConfig) {
        this._log('Local-only mode: Ollama is not configured in settings.');
        return { provider: null, providerId: null, model: null, isLocal: true, reason: 'Local-only mode active, but Ollama is not configured.' };
      }

      const cd = this.usageTracker.getCooldownInfo(PROVIDERS.OLLAMA);
      const circuit = this._getCircuitState(PROVIDERS.OLLAMA);
      if ((cd && cd.active) || circuit === CircuitState.OPEN) {
        const remaining = (cd && cd.remainingSeconds) ? `${cd.remainingSeconds}s remaining` : 'cooling down';
        this._log(`Local-only mode: Ollama is cooling down (${remaining}).`);
        return { provider: null, providerId: null, model: null, isLocal: true, reason: `Ollama is in cooldown (${remaining}).` };
      }

      this._log(`Local Ollama selected (Local-only mode, model: ${ollamaConfig.model}).`);
      return { provider: ollamaConfig, providerId: PROVIDERS.OLLAMA, model: ollamaConfig.model, isLocal: true, reason: null };
    }

    // 2. MODE A: HYBRID (Local Ollama First)
    if (mode === 'hybrid') {
      const localFirst = this.getConfig('localFirst', true);
      const ollamaConfig = ordered.find(p => p.id === PROVIDERS.OLLAMA);

      if (localFirst && ollamaConfig) {
        const cd = this.usageTracker.getCooldownInfo(PROVIDERS.OLLAMA);
        const circuit = this._getCircuitState(PROVIDERS.OLLAMA);

        if ((!cd || !cd.active) && circuit !== CircuitState.OPEN) {
          this._log(`Hybrid mode: Trying local Ollama first (${ollamaConfig.model}).`);
          return { provider: ollamaConfig, providerId: PROVIDERS.OLLAMA, model: ollamaConfig.model, isLocal: true, reason: null };
        } else {
          this._log('Hybrid mode: Local Ollama in cooldown/offline, proceeding to cloud fallback.');
        }
      }
    }

    // 3. CLOUD ROUTING (Mode C or Hybrid Cloud Fallback)
    if (!this.isCloudFallbackEnabled() && mode === 'hybrid') {
      return { provider: null, providerId: null, model: null, isLocal: false, reason: 'Local model unavailable and cloud fallback is disabled.' };
    }

    // Iterate through cloud providers strictly in user priority order
    for (const candidate of ordered) {
      if (candidate.id === PROVIDERS.OLLAMA) continue; // Skip local provider in cloud pass

      // A. Check API Key presence in SecretStorage (Preserve key at all times)
      const apiKey = await this.secretManager.getApiKey(candidate.id);
      if (!apiKey || apiKey.trim().length === 0) {
        continue; // Unconfigured provider, skip to next in priority
      }

      // B. Check Cooldown
      const cd = this.usageTracker.getCooldownInfo(candidate.id);
      if (cd && cd.active) {
        this._log(`Cloud provider skipped: ${candidate.name} cooldown active (${cd.remainingSeconds}s remaining).`);
        continue;
      }

      // C. Check Circuit Breaker
      const circuit = this._getCircuitState(candidate.id);
      if (circuit === CircuitState.OPEN) {
        this._log(`Cloud provider skipped: ${candidate.name} circuit open.`);
        continue;
      }

      // D. Check Local Daily Request & Token Budgets
      const dailyReqBudget = this.getConfig('dailyRequestBudget', 500);
      if (this.stats.dailyRequestsCount >= dailyReqBudget) {
        this._log(`Daily request budget reached (${this.stats.dailyRequestsCount}/${dailyReqBudget}).`);
        return { provider: null, providerId: null, model: null, isLocal: false, reason: `Local daily request budget reached (${dailyReqBudget} reqs).` };
      }

      // Candidate meets all eligibility criteria and is highest in user priority!
      this._log(`${candidate.name} selected according to user priority #${candidate.priority}.`);
      return { provider: candidate, providerId: candidate.id, model: candidate.model, isLocal: false, reason: null };
    }

    this._log('No eligible provider found (all providers cooling down, unconfigured, or over budget).');
    return {
      provider: null,
      providerId: null,
      model: null,
      isLocal: false,
      reason: 'All configured providers are temporarily cooling down, reached rate limits, or unconfigured.'
    };
  }

  // --------------------------------------------------------------------------
  // Concurrency & Stale Request Cancellation
  // --------------------------------------------------------------------------

  /**
   * Registers a new in-flight request for a document.
   * Cancels any previously active request for the same document to prevent stale ghost text and race conditions.
   * @param {string} documentUri
   * @returns {AbortController}
   */
  beginRequest(documentUri) {
    if (!documentUri) return new AbortController();

    // Cancel existing pending request for this document
    if (this._activeRequests.has(documentUri)) {
      const prev = this._activeRequests.get(documentUri);
      try {
        prev.controller.abort();
        this._log(`Cancelled previous in-flight request for ${documentUri.slice(-25)}`);
      } catch (_) {}
      this._activeRequests.delete(documentUri);
    }

    // Enforce max concurrent global requests
    if (this._activeRequests.size >= this.maxConcurrent) {
      const oldestKey = this._activeRequests.keys().next().value;
      if (oldestKey) {
        const old = this._activeRequests.get(oldestKey);
        try { old.controller.abort(); } catch (_) {}
        this._activeRequests.delete(oldestKey);
      }
    }

    const controller = new AbortController();
    this._activeRequests.set(documentUri, {
      controller,
      timestamp: Date.now()
    });

    return controller;
  }

  /**
   * Removes in-flight request tracking upon completion or error.
   * @param {string} documentUri
   */
  endRequest(documentUri) {
    if (documentUri && this._activeRequests.has(documentUri)) {
      this._activeRequests.delete(documentUri);
    }
  }

  // --------------------------------------------------------------------------
  // Request Completion & Accounting
  // --------------------------------------------------------------------------

  /**
   * Records successful completion and updates metrics.
   * Clears any active cooldown and transitions circuit breaker to CLOSED.
   * NEVER alters or deletes API keys in SecretStorage.
   * @param {string} providerId
   * @param {string} modelId
   * @param {object} usage
   * @param {object} [options]
   */
  async recordSuccess(providerId, modelId, usage = {}, options = {}) {
    if (!providerId) return;

    this._checkDailyReset();
    this.stats.dailyRequestsCount++;
    this.stats.dailyEstimatedTokens += (usage.totalTokens || 50);

    if (providerId === PROVIDERS.OLLAMA) {
      this.stats.localCompletions++;
    } else {
      this.stats.cloudCompletions++;
    }

    // Reset circuit breaker to healthy CLOSED
    this._circuitBreakers.set(providerId, {
      state: CircuitState.CLOSED,
      failCount: 0,
      lastStateChange: Date.now()
    });

    await this.usageTracker.recordSuccess(providerId, modelId, usage, options);
    this._log(`Request completed successfully via ${providerId} (${usage.totalTokens || 0} tokens).`);
  }

  /**
   * Records a failed request (e.g. 429, timeout, network error).
   * Reads Retry-After and sets cooldown without touching stored credentials.
   * @param {string} providerId
   * @param {string} modelId
   * @param {any} error
   * @param {any} [headers]
   * @returns {Promise<{ category: string, retryAfterSeconds: number|null }>}
   */
  async recordFailure(providerId, modelId, error, headers = null) {
    if (!providerId) return { category: 'UNKNOWN', retryAfterSeconds: null };

    // Record failure in usageTracker (parses Retry-After headers and sets cooldown)
    const result = await this.usageTracker.recordFailure(providerId, modelId, error, headers);

    // Update circuit breaker
    const breaker = this._circuitBreakers.get(providerId) || { state: CircuitState.CLOSED, failCount: 0 };
    breaker.failCount++;
    breaker.lastStateChange = Date.now();

    // Update circuit breaker:
    // Only actual RATE_LIMIT, QUOTA_EXHAUSTED, INVALID_API_KEY, or local Ollama offline immediately opens circuit.
    // Transient timeouts or cloud network hiccups require repeated consecutive failures (>= 3).
    const isRealLimit = result.category === 'RATE_LIMIT' || result.category === 'QUOTA_EXHAUSTED';
    const isAuthErr = result.category === 'INVALID_API_KEY';
    const isOllamaOffline = (providerId === PROVIDERS.OLLAMA || providerId === 'ollama') && result.category === 'NETWORK_ERROR';

    if (isRealLimit || isAuthErr || isOllamaOffline || breaker.failCount >= 3) {
      breaker.state = CircuitState.OPEN;
      this._log(`Circuit OPEN for ${providerId} (${result.category}, cooldown active).`);
    }

    this._circuitBreakers.set(providerId, breaker);
    this._log(`API key preserved after error on ${providerId} (${result.category}).`);

    return result;
  }

  /**
   * Notifies the user that a provider reached its API rate limit and prompts them to switch providers.
   * Throttled to at most once per 30 seconds per provider so typing doesn't create dialog spam.
   * @param {string} providerId
   * @param {object} [classification]
   */
  async notifyRateLimitAndPromptSwitch(providerId, classification = {}) {
    if (!providerId) return;
    if (!this._lastRateLimitNotification) {
      this._lastRateLimitNotification = new Map();
    }
    const now = Date.now();
    const lastNotified = this._lastRateLimitNotification.get(providerId) || 0;
    if (now - lastNotified < 30000) return;
    this._lastRateLimitNotification.set(providerId, now);

    const meta = PROVIDER_METADATA[providerId] || { name: providerId };
    const provName = meta.name || providerId;
    const cd = this.usageTracker ? this.usageTracker.getCooldownInfo(providerId) : null;
    const retrySec = (cd && cd.remainingSeconds) ? `${cd.remainingSeconds}s` : (classification.retryAfterSeconds ? `${classification.retryAfterSeconds}s` : '60s');

    let nextCandidate = null;
    try {
      if (this.providerManager) {
        nextCandidate = await this.providerManager.getNextFallbackProvider(providerId, this.usageTracker);
      }
    } catch (_) {}

    const switchBtn = nextCandidate ? `Switch to ${nextCandidate.name}` : 'Switch Provider';
    const manageBtn = 'Open Provider Menu';

    if (typeof vscode !== 'undefined' && vscode.window && vscode.window.showWarningMessage) {
      vscode.window.showWarningMessage(
        `Laven: Provider "${provName}" reached its API rate limit (${retrySec} cooldown). Please switch provider.`,
        switchBtn,
        manageBtn,
        'Dismiss'
      ).then(async (selection) => {
        if (selection === switchBtn) {
          if (nextCandidate && this.providerManager) {
            await this.providerManager.setActiveProvider(nextCandidate.id);
            if (vscode.window.showInformationMessage) {
              vscode.window.showInformationMessage(`Laven: Switched active provider to ${nextCandidate.name}.`);
            }
          } else if (vscode.commands && vscode.commands.executeCommand) {
            await vscode.commands.executeCommand('freecodeAI.selectProvider');
          }
        } else if (selection === manageBtn && vscode.commands && vscode.commands.executeCommand) {
          await vscode.commands.executeCommand('freecodeAI.openProviderPopup');
        }
      });
    }
  }

  // --------------------------------------------------------------------------
  // Suggestion Acceptance and Rejection Tracking
  // --------------------------------------------------------------------------

  /**
   * Tracks user accepting an inline suggestion (e.g. Tab pressed).
   * Does NOT trigger new requests, reset usage, or modify API keys.
   * @param {object} [details]
   */
  recordAcceptance(details = {}) {
    this.stats.acceptedSuggestions++;
    this._log('Suggestion accepted by user.');
  }

  /**
   * Tracks user rejecting or typing past a suggestion.
   * @param {object} [details]
   */
  recordRejection(details = {}) {
    this.stats.rejectedSuggestions++;
    this._log('Suggestion rejected by user.');
  }

  // --------------------------------------------------------------------------
  // Circuit Breaker Helpers
  // --------------------------------------------------------------------------

  _getCircuitState(providerId) {
    const cd = this.usageTracker.getCooldownInfo(providerId);
    if (cd && cd.active) {
      return CircuitState.OPEN;
    }

    const breaker = this._circuitBreakers.get(providerId);
    if (!breaker) return CircuitState.CLOSED;

    if (breaker.state === CircuitState.OPEN) {
      // Cooldown expired: transition to HALF_OPEN to cautiously test recovery
      if (!cd || !cd.active) {
        breaker.state = CircuitState.HALF_OPEN;
        return CircuitState.HALF_OPEN;
      }
      return CircuitState.OPEN;
    }

    return breaker.state;
  }

  _checkDailyReset() {
    const today = new Date().toDateString();
    if (this.stats.dailyResetDate !== today) {
      this.stats.dailyRequestsCount = 0;
      this.stats.dailyEstimatedTokens = 0;
      this.stats.dailyResetDate = today;
    }
  }

  // --------------------------------------------------------------------------
  // Summary & Diagnostics
  // --------------------------------------------------------------------------

  /**
   * Returns complete metrics summary for Status Bar and Dashboard.
   * @returns {object}
   */
  getDashboardData() {
    const cacheMetrics = this.cache.getMetrics();
    const mode = this.getCompletionMode();
    const activeProv = this.providerManager.getActiveProvider();

    return {
      mode,
      activeProvider: activeProv,
      isLocal: activeProv === PROVIDERS.OLLAMA,
      stats: {
        acceptedSuggestions: this.stats.acceptedSuggestions,
        rejectedSuggestions: this.stats.rejectedSuggestions,
        localCompletions: this.stats.localCompletions,
        cloudCompletions: this.stats.cloudCompletions,
        dailyRequestsCount: this.stats.dailyRequestsCount,
        dailyEstimatedTokens: this.stats.dailyEstimatedTokens
      },
      cache: cacheMetrics,
      requestsAvoided: cacheMetrics.requestsAvoided,
      tokensSaved: cacheMetrics.tokensSaved
    };
  }

  _log(message) {
    if (process.env.LAVEN_DEBUG || process.env.NODE_ENV === 'test') {
      console.log(`${this.logTag} ${message}`);
    }
  }
}

module.exports = { SmartQuotaManager, CircuitState };
