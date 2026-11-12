/**
 * High-Performance, Rate-Limit-Aware Inline Completion Agent for Laven.
 * Implements vscode.InlineCompletionItemProvider with:
 * - 0ms predictive typing cache
 * - Immediate response on manual shortcut triggers (0ms debounce on Alt+/, Alt+\)
 * - Ultra-snappy dynamic debounce (80ms-120ms) during typing
 * - Automatic provider auto-discovery and failover across all 11 providers
 * - Always-cache completion persistence for continuous keystroke acceleration
 * - OutputChannel live diagnostics for developer transparency
 * - Proactive rate limit guard
 * - Tight token budget (64 tokens) for sub-second generation
 * - Low-temperature deterministic completion for maximum code accuracy
 */

const vscode = require('vscode');
const { ContextManager } = require('./contextManager');
const { PromptBuilder } = require('./promptBuilder');
const { SuggestionParser } = require('./suggestionParser');
const { CacheManager } = require('./cacheManager');
const { ProviderFactory } = require('../../src/providers/providerFactory');
const { PROVIDERS, PROVIDER_METADATA } = require('../../src/config/providers');
const { getDefaultModelId } = require('../../src/config/modelRegistry');

class InlineAgent {
  /**
   * @param {object} options
   * @param {import('../../src/providers/providerManager').ProviderManager} options.providerManager
   * @param {import('../../src/security/secretManager').SecretManager} options.secretManager
   * @param {import('../../src/usage/usageTracker').UsageTracker} options.usageTracker
   * @param {CacheManager} [options.cacheManager]
   */
  constructor({
    providerManager,
    secretManager,
    usageTracker,
    cacheManager = new CacheManager()
  }) {
    this.providerManager = providerManager;
    this.secretManager = secretManager;
    this.usageTracker = usageTracker;
    this.cacheManager = cacheManager;

    this._pendingTimer = null;
    this._pendingResolve = null;
    this._currentAbortController = null;
    this._outputChannel = null;
    this._directConnection = null;
    this._lastLimitNotification = new Map(); // providerId -> timestamp
    this._notificationCooldownMs = 60000;    // 60-second notification throttle per provider
  }

  _log(message) {
    try {
      if (!this._outputChannel && vscode.window && typeof vscode.window.createOutputChannel === 'function') {
        this._outputChannel = vscode.window.createOutputChannel('Laven');
      }
      if (this._outputChannel) {
        const time = new Date().toLocaleTimeString();
        this._outputChannel.appendLine(`[${time}] ${message}`);
      }
    } catch (e) {}
  }

  /**
   * Read inline agent settings from VS Code configuration.
   * @returns {{
   *   enabled: boolean,
   *   debounceDelay: number,
   *   maxContextLines: number,
   *   maxCompletionTokens: number,
   *   cacheEnabled: boolean,
   *   useActiveProvider: boolean
   * }}
   */
  getConfig() {
    let cfg = null;
    try {
      if (vscode.workspace && typeof vscode.workspace.getConfiguration === 'function') {
        cfg = vscode.workspace.getConfiguration('freecodeAI.inline');
      }
    } catch (e) {
      // safe fallback
    }

    return {
      enabled: cfg ? cfg.get('enabled', true) : true,
      debounceDelay: cfg ? cfg.get('debounceDelay', 75) : 75,
      maxContextLines: cfg ? cfg.get('maxContextLines', 40) : 40,
      maxCompletionTokens: cfg ? cfg.get('maxCompletionTokens', 64) : 64,
      cacheEnabled: cfg ? cfg.get('cacheEnabled', true) : true,
      useActiveProvider: cfg ? cfg.get('useActiveProvider', true) : true
    };
  }

  /**
   * Cancel pending debounce timer and in-flight request cleanly without leaking promises.
   */
  cancelPending() {
    if (this._pendingTimer) {
      clearTimeout(this._pendingTimer);
      this._pendingTimer = null;
    }
    if (this._pendingResolve) {
      this._pendingResolve(false);
      this._pendingResolve = null;
    }
    if (this._currentAbortController) {
      try {
        this._currentAbortController.abort();
      } catch (e) {}
      this._currentAbortController = null;
    }
  }

  /**
   * Check whether current position is an unproductive trigger position.
   * Only skip if strictly inside an existing word identifier.
   * @param {string} linePrefix
   * @param {string} lineSuffix
   * @returns {boolean}
   */
  _shouldSkipPosition(linePrefix, lineSuffix) {
    if (linePrefix && lineSuffix) {
      const charBefore = linePrefix.slice(-1);
      const charAfter = lineSuffix.charAt(0);
      if (/\w/.test(charBefore) && /\w/.test(charAfter)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Calculate dynamic debounce delay based on cursor context and typing speed.
   * @param {string} linePrefix
   * @param {number} baseDelay
   * @param {number} rateLimitLoad
   * @returns {number}
   */
  _calculateDebounce(linePrefix, baseDelay, rateLimitLoad) {
    let delay = baseDelay;

    // Snappy trigger characters (. ( , = { [ : -> space) trigger in 35ms
    if (linePrefix) {
      const trimmed = linePrefix.trim();
      const lastChar = trimmed.slice(-1);
      if (['.', '(', '{', '[', '=', ',', ':', '>', ' ', ';'].includes(lastChar)) {
        delay = Math.min(baseDelay, 35);
      }
    }

    // Adaptive rate-limit backoff: if approaching provider rate limit, pace requests
    if (rateLimitLoad >= 80) {
      delay = Math.max(delay * 2, 350);
    } else if (rateLimitLoad >= 60) {
      delay = Math.max(delay * 1.5, 200);
    }

    return delay;
  }

  /**
   * Resolve an available provider: uses active provider, or falls back to another
   * configured provider if active provider is cooling down or unconfigured.
   * @param {boolean} [isManualTrigger=false]
   * @returns {Promise<{ providerId: string, model: string, apiKey: string|null, endpoint: string|null }|null>}
   */
  async _resolveUsableProvider(isManualTrigger = false) {
    if (!this.providerManager) return null;

    let targetId = this.providerManager.getActiveProvider();
    if (!targetId) {
      targetId = await this.providerManager.getValidatedActiveProvider();
    }

    // Auto-discover configured provider from secret storage if targetId is still null
    if (!targetId) {
      const configured = await this.providerManager.getConfiguredProviders();
      if (configured.length > 0) {
        targetId = configured[0];
        await this.providerManager.setActiveProvider(targetId);
      }
    }

    // If still null, check all known providers for stored keys
    if (!targetId && this.secretManager) {
      for (const pid of Object.values(PROVIDERS)) {
        if (pid === PROVIDERS.OLLAMA) continue;
        if (await this.secretManager.hasApiKey(pid)) {
          targetId = pid;
          await this.providerManager.setActiveProvider(pid);
          break;
        }
      }
    }

    // Fallback to Ollama if local instance configured
    if (!targetId && this.providerManager) {
      const ollamaCfg = await this.providerManager.getProviderConfiguration(PROVIDERS.OLLAMA);
      if (ollamaCfg && (ollamaCfg.configured || ollamaCfg.endpoint)) {
        targetId = PROVIDERS.OLLAMA;
      }
    }

    if (!targetId) {
      return null;
    }

    // If active provider is cooling down, attempt failover to another configured provider
    if (this.usageTracker && this.usageTracker.isCoolingDown(targetId)) {
      const configured = await this.providerManager.getConfiguredProviders();
      const available = configured.find(pid => !this.usageTracker.isCoolingDown(pid));
      if (available) {
        targetId = available;
      } else {
        // Active provider cooling down and no alternative available: notify user to switch LLM
        await this.notifyRateLimitAndSuggestSwitch(targetId, 'Provider cooling down', { force: isManualTrigger });
        return null;
      }
    }

    const providerConfig = await this.providerManager.getProviderConfiguration(targetId);
    const model = providerConfig.model || getDefaultModelId(targetId);

    let apiKey = null;
    let endpoint = providerConfig.endpoint || null;

    if (targetId === PROVIDERS.OLLAMA) {
      endpoint = endpoint || 'http://127.0.0.1:11434';
    } else {
      apiKey = this.secretManager ? await this.secretManager.getApiKey(targetId) : null;
      if (!apiKey) {
        // Try any alternative configured provider with a valid key
        const configured = await this.providerManager.getConfiguredProviders();
        for (const alt of configured) {
          if (alt === targetId) continue;
          const altKey = await this.secretManager.getApiKey(alt);
          if (altKey) {
            targetId = alt;
            apiKey = altKey;
            const altCfg = await this.providerManager.getProviderConfiguration(alt);
            endpoint = altCfg.endpoint || null;
            break;
          }
        }
        if (!apiKey) {
          return null;
        }
      }
    }

    return { providerId: targetId, model, apiKey, endpoint };
  }

  /**
   * Directly get or refresh the in-memory connected provider instance.
   * Eliminates disk reads and SecretStorage IPC on every keystroke,
   * keeping the provider adapter and API key directly connected in memory for sub-millisecond dispatch.
   * @param {boolean} [forceRefresh=false]
   * @param {boolean} [isManualTrigger=false]
   * @returns {Promise<{ providerId: string, model: string, apiKey: string|null, endpoint: string|null, provider: any }|null>}
   */
  async getDirectConnection(forceRefresh = false, isManualTrigger = false) {
    const now = Date.now();
    const currentActiveId = this.providerManager ? this.providerManager.getActiveProvider() : null;

    if (
      !forceRefresh &&
      this._directConnection &&
      this._directConnection.provider &&
      (!currentActiveId || this._directConnection.providerId === currentActiveId) &&
      (now - this._directConnection.cachedAt < 60000)
    ) {
      // If active provider is cooling down, check if failover is needed
      if (this.usageTracker && this.usageTracker.isCoolingDown(this._directConnection.providerId)) {
        if (!isManualTrigger) {
          const cInfo = this.usageTracker.getCooldownInfo(this._directConnection.providerId);
          if (cInfo && cInfo.remainingSeconds > 10) {
            return this._refreshDirectConnection(isManualTrigger);
          }
        }
      }
      return this._directConnection;
    }

    return this._refreshDirectConnection(isManualTrigger);
  }

  /**
   * Refresh direct connection from provider manager and secret storage.
   * @param {boolean} [isManualTrigger=false]
   * @returns {Promise<{ providerId: string, model: string, apiKey: string|null, endpoint: string|null, provider: any }|null>}
   */
  async _refreshDirectConnection(isManualTrigger = false) {
    const info = await this._resolveUsableProvider(isManualTrigger);
    if (!info) {
      this._directConnection = null;
      return null;
    }

    try {
      const providerInstance = ProviderFactory.create(info.providerId, {
        apiKey: info.apiKey,
        model: info.model,
        endpoint: info.endpoint
      });

      this._directConnection = {
        providerId: info.providerId,
        model: info.model,
        apiKey: info.apiKey,
        endpoint: info.endpoint,
        provider: providerInstance,
        cachedAt: Date.now()
      };

      return this._directConnection;
    } catch (err) {
      this._directConnection = null;
      return null;
    }
  }

  /**
   * Invalidate direct connection when user changes provider, model, or updates API key.
   */
  invalidateDirectConnection() {
    this._directConnection = null;
  }

  /**
   * Notify the user when an inline suggestion limit or rate limit is hit,
   * offering quick actions to switch to another configured LLM, open provider picker, or reset limits.
   * Throttled to at most once per 60 seconds per provider to avoid interrupting typing flow.
   * @param {string} providerId
   * @param {string} [reason='Rate limit reached']
   * @param {object} [options]
   * @param {boolean} [options.isNearingLimit=false]
   * @param {boolean} [options.force=false]
   * @returns {Promise<string|null>}
   */
  async notifyRateLimitAndSuggestSwitch(providerId, reason = 'Rate limit reached', options = {}) {
    if (!providerId) return null;

    const now = Date.now();
    const lastNotified = this._lastLimitNotification.get(providerId) || 0;
    const cooldownMs = options.force ? 0 : this._notificationCooldownMs;

    if (now - lastNotified < cooldownMs) {
      return null; // Throttled to avoid spamming the user during typing
    }
    this._lastLimitNotification.set(providerId, now);

    const currentMeta = PROVIDER_METADATA[providerId] || { name: providerId };
    const cInfo = this.usageTracker ? this.usageTracker.getCooldownInfo(providerId) : null;
    const remainingSec = cInfo && cInfo.remainingSeconds ? ` (${cInfo.remainingSeconds}s cooldown)` : '';

    // Find configured alternative providers that are available (not in cooldown)
    let altProvider = null;
    let altMeta = null;
    if (this.providerManager) {
      try {
        const configured = await this.providerManager.getConfiguredProviders();
        const available = configured.filter(p => p !== providerId && !(this.usageTracker && this.usageTracker.isCoolingDown(p)));
        if (available.length > 0) {
          altProvider = available[0];
          altMeta = PROVIDER_METADATA[altProvider] || { name: altProvider };
        }
      } catch (e) {}
    }

    let message;
    if (options.isNearingLimit) {
      message = `Laven: ${currentMeta.name} is approaching its request rate limit. Switch to another LLM to avoid interruptions?`;
    } else {
      message = `Laven: ${currentMeta.name} inline suggestion limit reached${remainingSec}. Switch to another LLM?`;
    }

    this._log(`[Inline] Limit warning: ${message}`);

    const actions = [];
    if (altMeta && altProvider) {
      actions.push(`Switch to ${altMeta.name}`);
    }
    actions.push('Switch Provider');
    actions.push('Reset Limits');

    if (vscode.window && typeof vscode.window.showWarningMessage === 'function') {
      try {
        const promise = vscode.window.showWarningMessage(message, ...actions);
        if (promise && typeof promise.then === 'function') {
          promise.then(async selection => {
            if (!selection) return;

            if (altMeta && selection === `Switch to ${altMeta.name}`) {
              if (this.providerManager) {
                await this.providerManager.setActiveProvider(altProvider);
              }
              this.invalidateDirectConnection();
              try {
                await vscode.commands.executeCommand('freecodeAI.showStatus');
              } catch (e) {}
              if (vscode.window && typeof vscode.window.showInformationMessage === 'function') {
                vscode.window.showInformationMessage(`Laven: Switched to ${altMeta.name} for inline suggestions.`);
              }
            } else if (selection === 'Switch Provider') {
              try {
                await vscode.commands.executeCommand('freecodeAI.openProviderPopup');
              } catch (e) {
                try {
                  await vscode.commands.executeCommand('freecodeAI.selectProvider');
                } catch (e2) {}
              }
            } else if (selection === 'Reset Limits') {
              try {
                await vscode.commands.executeCommand('freecodeAI.resetRateLimits');
              } catch (e) {}
            }
          });
        }
      } catch (e) {}
    }

    return message;
  }

  /**
   * Primary entry point for VS Code InlineCompletionItemProvider.
   * @param {vscode.TextDocument} document
   * @param {vscode.Position} position
   * @param {vscode.InlineCompletionContext} context
   * @param {vscode.CancellationToken} token
   * @returns {Promise<vscode.InlineCompletionItem[]|vscode.InlineCompletionList|null>}
   */
  async provideInlineCompletionItems(document, position, context, token) {
    const config = this.getConfig();

    // 1. Check if inline suggestions are enabled
    if (!config.enabled) {
      return null;
    }

    // 2. Detect if user explicitly invoked inline completion (e.g. via Alt+/, Alt+\, or command)
    const isManualTrigger = context && (
      context.triggerKind === 1 ||
      (vscode.InlineCompletionTriggerKind && context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke)
    );

    // 3. Extract basic context
    const codeContext = ContextManager.getContext(document, position, {
      maxContextLines: config.maxContextLines
    });
    if (!codeContext) {
      return null;
    }

    const docUri = document.uri ? document.uri.toString() : (document.fileName || 'untitled');

    // 4. FAST PATH: Predictive Cache Check (0ms latency, zero API calls!)
    // If the user typed characters matching a previous suggestion on the same line,
    // immediately serve the remaining slice without hitting the network.
    if (config.cacheEnabled) {
      const predictiveMatch = this.cacheManager.getPredictiveMatch(
        docUri,
        position,
        codeContext.linePrefix
      );
      if (predictiveMatch && predictiveMatch.length > 0) {
        return predictiveMatch;
      }

      // Check exact cache
      const cached = this.cacheManager.get(docUri, position, codeContext.prefix);
      if (cached) {
        return cached;
      }
    }

    // 5. Skip unproductive trigger positions (unless user explicitly pressed the shortcut)
    if (!isManualTrigger && this._shouldSkipPosition(codeContext.linePrefix, codeContext.lineSuffix)) {
      return null;
    }

    // 6. Cancel prior pending timer & request
    this.cancelPending();

    // 7. Directly connected provider instance (0ms in-memory cache, no disk/SecretStorage IPC)
    const directConn = await this.getDirectConnection(false, isManualTrigger);
    if (!directConn) {
      this._log('[Inline] No active or configured AI provider available. Open sidebar to configure.');
      return null;
    }
    const { providerId, model, provider } = directConn;

    // 8. RATE LIMIT GUARD: Check quota headroom (bypassed on manual trigger)
    let rateLimitLoad = 0;
    if (this.usageTracker && !isManualTrigger) {
      const velocity = this.usageTracker.getVelocityInfo(providerId);
      rateLimitLoad = velocity ? (velocity.loadPercent || 0) : 0;

      // If at >=92% capacity in the sliding 60s window, drop background request to protect quota
      // and notify user to switch LLMs before hard 429 lockout
      if (rateLimitLoad >= 92) {
        this._log(`[Inline] Rate limit load ${rateLimitLoad}% near capacity. Throttling request.`);
        await this.notifyRateLimitAndSuggestSwitch(providerId, `Rate limit load ${rateLimitLoad}% near capacity`, { isNearingLimit: true });
        return null;
      }
    }

    // 9. Non-blocking adaptive debounce (0ms on manual trigger)
    const debounceMs = isManualTrigger ? 0 : this._calculateDebounce(codeContext.linePrefix, config.debounceDelay, rateLimitLoad);
    if (debounceMs > 0) {
      const completed = await new Promise(resolve => {
        this._pendingResolve = resolve;
        this._pendingTimer = setTimeout(() => {
          this._pendingTimer = null;
          this._pendingResolve = null;
          resolve(true);
        }, debounceMs);

        if (token && typeof token.onCancellationRequested === 'function') {
          token.onCancellationRequested(() => {
            if (this._pendingTimer) {
              clearTimeout(this._pendingTimer);
              this._pendingTimer = null;
            }
            if (this._pendingResolve) {
              this._pendingResolve = null;
              resolve(false);
            }
          });
        }
      });

      if (!completed) {
        return null;
      }
    }

    // 10. Check cancellation after debounce
    if (token && token.isCancellationRequested) {
      return null;
    }

    // 11. Build compact completion prompt (compressed whitespace to minimize tokens)
    const promptData = PromptBuilder.buildPrompt(codeContext, { maxPromptChars: 1200 });

    // 12. Execute LLM completion request with speed, cancellation & tight token budget
    try {
      this._currentAbortController = new AbortController();
      const maxTokens = Math.min(config.maxCompletionTokens, 64); // Cap to 64 tokens to conserve API quota

      if (this.usageTracker) {
        await this.usageTracker.recordRequestStart(providerId, model, { estimatedTokens: 35 });
      }

      this._log(`[Inline] Request at ${codeContext.fileName}:${position.line}:${position.character} (${providerId}/${model})`);

      // 5-second timeout with abort signal for immediate keystroke cancellation
      const response = await provider.complete(promptData.messages, {
        systemPrompt: promptData.systemPrompt,
        model,
        temperature: 0.1, // Near-greedy sampling for deterministic syntax accuracy
        maxTokens,
        timeoutMs: 5000,
        signal: this._currentAbortController.signal
      });

      if (this.usageTracker && response) {
        await this.usageTracker.recordSuccess(providerId, model, response.usage || {});
      }

      // 13. Clean and parse completion output
      const items = SuggestionParser.parse(response ? response.text : '', codeContext);

      // 14. Cache result with line context for predictive completion
      // Negative cache 4s for empty responses to avoid re-querying unproductive keystrokes
      if (config.cacheEnabled) {
        if (items && items.length > 0) {
          this.cacheManager.set(
            docUri,
            position,
            codeContext.prefix,
            items,
            undefined,
            codeContext.linePrefix
          );
        } else {
          this.cacheManager.set(docUri, position, codeContext.prefix, [], 4000);
        }
      }

      if (token && token.isCancellationRequested) {
        return null;
      }

      if (items && items.length > 0) {
        this._log(`[Inline] Ghost text ready: "${items[0].insertText.replace(/\r?\n/g, '\\n')}"`);
      }

      return items;
    } catch (err) {
      this._log(`[Inline] Request failed for ${providerId}: ${err.message}`);
      if (err.message && (err.message.includes('401') || err.message.toLowerCase().includes('auth') || err.message.toLowerCase().includes('key'))) {
        this.invalidateDirectConnection();
      }
      if (this.usageTracker) {
        const classification = await this.usageTracker.recordFailure(providerId, model, err);
        if (classification && (classification.category === 'RATE_LIMIT' || classification.category === 'QUOTA_EXHAUSTED')) {
          this.invalidateDirectConnection();
          await this.notifyRateLimitAndSuggestSwitch(providerId, classification.message);
        }
      }
      return null;
    }
  }

  /**
   * Clear in-memory suggestions cache.
   */
  clearCache() {
    this.cacheManager.clear();
  }

  dispose() {
    this.cancelPending();
    this.clearCache();
    this.invalidateDirectConnection();
    if (this._outputChannel) {
      try {
        this._outputChannel.dispose();
      } catch (e) {}
      this._outputChannel = null;
    }
  }
}

module.exports = { InlineAgent };
