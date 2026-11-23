'use strict';

/**
 * Intelligent Inline Completion Provider for Laven.
 * Integrates:
 * - Adaptive 100-200ms debounce to prevent per-keystroke requests
 * - Strict 1-active-request-per-document concurrency
 * - Intelligent LRU suggestion cache (zero duplicate network calls)
 * - Hybrid local-first (Ollama) & cloud fallback routing
 * - Context bounding & token minimization
 * - Suggestion acceptance tracking
 */

const vscode = require('vscode');
const { ContextCollector } = require('./contextCollector');
const { PromptBuilder } = require('./promptBuilder');
const { SuggestionParser } = require('./suggestionParser');
const { SuggestionCache } = require('./cacheManager');
const { ProviderFactory } = require('../providers/providerFactory');
const { PROVIDERS } = require('../config/providers');
const { InlineQualityPipeline } = require('./qualityPipeline');
const { LocalPredictionEngine } = require('./localPredictionEngine');

const monotonicNow = () => Number(process.hrtime.bigint()) / 1e6;

class LavenInlineCompletionProvider {
  /**
   * @param {object} deps
   * @param {import('../quota/smartQuotaManager').SmartQuotaManager} deps.quotaManager
   * @param {import('../security/secretManager').SecretManager} deps.secretManager
   * @param {import('../providers/providerManager').ProviderManager} deps.providerManager
   */
  constructor({ quotaManager, secretManager, providerManager }) {
    this.quotaManager    = quotaManager;
    this.secretManager   = secretManager;
    this.providerManager = providerManager;

    // Track typing cadence and request generations per document.
    this._lastTypeTimes = new Map();
    this._requestGenerations = new Map();
    this._latencySamples = [];
    this._typingIntervals = new Map();
    this._metrics = {
      invocations: 0,
      cancellations: 0,
      cacheHits: 0,
      providers: new Map(),
      globalTimings: new Map()
    };
  }

  /**
   * Main entry point called by VS Code on typing or cursor motion.
   * @param {vscode.TextDocument} document
   * @param {vscode.Position} position
   * @param {vscode.InlineCompletionContext} context
   * @param {vscode.CancellationToken} token
   * @returns {Promise<vscode.InlineCompletionItem[]|null>}
   */
  async provideInlineCompletionItems(document, position, context, token) {
    const requestStartedAt = monotonicNow();

    // 1. Check if inline suggestions are globally enabled
    const enabled = this.quotaManager.getConfig('enabled', true);
    if (!enabled) return [];

    // 2. Check supported language
    const lang = document.languageId;
    if (lang && !ContextCollector.SUPPORTED_LANGUAGES.has(lang)) {
      return [];
    }

    const docKey = document.uri.toString();
    const requestGeneration = (this._requestGenerations.get(docKey) || 0) + 1;
    this._requestGenerations.set(docKey, requestGeneration);
    this.quotaManager.cancelRequest(docKey);
    this._metrics.invocations++;
    if (token.isCancellationRequested) {
      this._metrics.cancellations++;
      return [];
    }

    // 3. Collect only bounded context around the cursor.
    const contextStartedAt = monotonicNow();
    const maxInputTokens = this.quotaManager.getConfig('maxInputTokens', 1500);
    const ctx = ContextCollector.collectBounded(document, position, { maxInputTokens });
    if (!ctx.isMeaningful) {
      return [];
    }

    const now = Date.now();
    const previousType = this._lastTypeTimes.get(docKey) || 0;
    let intervals = this._typingIntervals.get(docKey) || [];
    if (previousType > 0) {
      const interval = now - previousType;
      if (interval <= 2000) {
        intervals.push(interval);
        if (intervals.length > 20) intervals.shift();
      }
    }
    this._typingIntervals.set(docKey, intervals);
    this._lastTypeTimes.set(docKey, now);

    const qualityContext = InlineQualityPipeline.extractRelevantContext(ctx.prefix, ctx.suffix, lang);
    Object.assign(qualityContext, {
      prefix: ctx.prefix,
      suffix: ctx.suffix,
      language: lang,
      linePrefix: ctx.linePrefix,
      lineSuffix: ctx.lineSuffix
    });

    this._recordTiming(null, 'contextPreparationMs', monotonicNow() - contextStartedAt);

    const localPrediction = LocalPredictionEngine.predict(qualityContext);
    if (localPrediction) {
      this.quotaManager.stats.localCompletions++;
      return [this._buildCompletionItem(localPrediction.text, position, 'local', 'rule', false)];
    }

    const debounceMs = this._getAdaptiveDebounceMs(ctx, context, intervals);
    const debounceWait = this._createDebounceWait(debounceMs, token);
    const selectionStartedAt = monotonicNow();
    let selection;
    try {
      selection = await this.quotaManager.selectProviderForInline({
        estimatedTokens: 60,
        documentUri: docKey
      });
    } catch (err) {
      debounceWait.cancel();
      throw err;
    }
    const selectionMs = monotonicNow() - selectionStartedAt;

    if (token.isCancellationRequested || this._requestGenerations.get(docKey) !== requestGeneration) {
      debounceWait.cancel();
      this._metrics.cancellations++;
      return [];
    }

    if (!selection || !selection.providerId) {
      debounceWait.cancel();
      return [];
    }

    const providerId = selection.providerId;
    const model = selection.model;
    this._recordTiming(providerId, 'providerSelectionMs', selectionMs);

    // 6. Check the exact-context cache before waiting for debounce.
    const configuredOutputTokens = Number(this.quotaManager.getConfig('maxOutputTokens', 48));
    const maxOutputTokens = Number.isFinite(configuredOutputTokens) && configuredOutputTokens > 0
      ? Math.floor(configuredOutputTokens)
      : 48;
    const effectiveMaxOutputTokens = providerId === PROVIDERS.FREELLMAPI
      ? Math.min(maxOutputTokens, 64)
      : maxOutputTokens;
    const cacheKey = SuggestionCache.buildKey({
      providerId,
      model,
      language: lang,
      prefix: ctx.prefix,
      suffix: ctx.suffix,
      config: {
        endpoint: selection.provider?.endpoint || '',
        maxOutputTokens: effectiveMaxOutputTokens,
        temperature: 0.1
      }
    });

    const cached = this.quotaManager.cache.get(cacheKey);
    if (cached) {
      debounceWait.cancel();
      this._metrics.cacheHits++;
      return [this._buildCompletionItem(cached, position, providerId, model, true)];
    }

    const debounceAllowed = await debounceWait.promise;
    if (debounceMs > 0) {
      this._recordTiming(providerId, 'debounceMs', monotonicNow() - debounceWait.startedAt);
    }
    if (!debounceAllowed || token.isCancellationRequested || this._requestGenerations.get(docKey) !== requestGeneration) {
      this._metrics.cancellations++;
      return [];
    }

    // 7. Concurrency Guard: register in-flight request & abort any stale request
    const abortCtrl = this.quotaManager.beginRequest(docKey, { providerId, model });
    const onAbort = () => {
      this._incrementMetric(providerId, 'cancellations');
      this._metrics.cancellations++;
    };
    abortCtrl.signal.addEventListener('abort', onAbort, { once: true });
    let cancellationDisposable = null;
    if (token && typeof token.onCancellationRequested === 'function') {
      cancellationDisposable = token.onCancellationRequested(() => abortCtrl.abort());
      if (token.isCancellationRequested) abortCtrl.abort();
    }

    try {
      // 8. Retrieve credentials (API Key is NEVER deleted on error or cooldown)
      const setupStartedAt = monotonicNow();
      let apiKey = null;
      const endpoint = selection.provider?.endpoint || null;

      if (!selection.isLocal) {
        apiKey = await this.secretManager.getApiKey(providerId);
        if (!apiKey) {
          return [];
        }
      }

      // 9. Instantiate provider
      const provider = ProviderFactory.create(providerId, {
        apiKey,
        model,
        endpoint
      });
      this._recordTiming(providerId, 'providerSetupMs', monotonicNow() - setupStartedAt);

      // 10. Build bounded prompt
      const messages = PromptBuilder.buildInlineCompletionMessages(qualityContext);
      const inlinePrompt = PromptBuilder.buildInlineCompletionPrompt(qualityContext);

      // 11. Execute request
      let response = null;
      const generationStartedAt = monotonicNow();
      const onResponseHeaders = elapsedMs => this._recordTiming(providerId, 'responseHeadersMs', elapsedMs);
      this._incrementMetric(providerId, 'requests');
      try {
        if (providerId === PROVIDERS.FREELLMAPI) {
          response = await provider.completeInline(ctx.prefix, ctx.suffix, {
            model,
            maxTokens: effectiveMaxOutputTokens,
            temperature: 0.1,
            timeoutMs: 4500,
            signal: abortCtrl.signal,
            onResponseHeaders,
            inlinePrompt
          });
        } else {
          response = await provider.complete(messages, {
            maxTokens: maxOutputTokens,
            temperature: 0.1,
            timeoutMs: selection.isLocal ? 3000 : 8000,
            signal: abortCtrl.signal,
            onResponseHeaders
          });
        }
        const generationMs = monotonicNow() - generationStartedAt;
        this._recordTiming(providerId, 'generationMs', generationMs);
        this._latencySamples.push({
          providerId,
          model,
          milliseconds: generationMs,
          timestamp: Date.now()
        });
        if (this._latencySamples.length > 100) this._latencySamples.shift();
      } catch (err) {
        this._recordTiming(providerId, 'generationMs', monotonicNow() - generationStartedAt);
        // If aborted by user typing or cancellation, exit cleanly without recording failure
        if (token.isCancellationRequested || abortCtrl.signal.aborted || err?.name === 'AbortError' || (err?.message && err.message.toLowerCase().includes('aborted'))) {
          return [];
        }

        // Record failure (sets cooldown and circuit breaker only on verified rate limits / quota exhaustion)
        this._incrementMetric(providerId, 'providerErrors');
        const classification = await this.quotaManager.recordFailure(providerId, model, err);
        if (classification && (classification.category === 'RATE_LIMIT' || classification.category === 'QUOTA_EXHAUSTED')) {
          this._incrementMetric(providerId, 'rateLimits');
        }

        // If remote API hit actual rate limits, prompt user to switch providers immediately
        if (classification && (classification.category === 'RATE_LIMIT' || classification.category === 'QUOTA_EXHAUSTED')) {
          if (typeof this.quotaManager.notifyRateLimitAndPromptSwitch === 'function') {
            this.quotaManager.notifyRateLimitAndPromptSwitch(providerId, classification);
          }
        }

        // In Hybrid mode: If local Ollama failed, attempt cloud fallback
        if (selection.isLocal && this.quotaManager.isCloudFallbackEnabled()) {
          return await this._tryCloudFallback(document, position, ctx, token, cacheKey, abortCtrl);
        }
        return [];
      }

      if (token.isCancellationRequested || abortCtrl.signal.aborted) {
        return [];
      }

      const rawText = response ? response.text : '';
      if (!rawText) return [];
      if (response.finishReason && /^(?:tool_calls?|function_call|content_filter|safety|error)$/i.test(response.finishReason)) {
        return [];
      }

      // 12. Parse & sanitize suggestion
      const cleanSuggestion = SuggestionParser.parse(rawText, {
        linePrefix: ctx.linePrefix,
        lineSuffix: ctx.lineSuffix,
        language: lang,
        prefix: ctx.prefix,
        suffix: ctx.suffix,
        lineEnding: qualityContext.lineEnding,
        lineIndent: qualityContext.lineIndent
      });

      if (!cleanSuggestion || cleanSuggestion.trim().length === 0) {
        return [];
      }

      // 13. Save into cache & record usage
      const cacheTtlMs = this.quotaManager.getConfig('cacheTtlMs', 60000);
      this.quotaManager.cache.set(cacheKey, cleanSuggestion, {
        ttlMs: cacheTtlMs,
        tokensSaved: response.usage ? response.usage.totalTokens : 30
      });

      await this.quotaManager.recordSuccess(providerId, model, response.usage || {}, {
        tokensSaved: 0
      });

      return [this._buildCompletionItem(cleanSuggestion, position, providerId, model, false)];
    } catch (err) {
      return [];
    } finally {
      if (cancellationDisposable) cancellationDisposable.dispose();
      abortCtrl.signal.removeEventListener('abort', onAbort);
      this._recordTiming(providerId, 'totalLatencyMs', monotonicNow() - requestStartedAt);
      this.quotaManager.endRequest(docKey, abortCtrl);
    }
  }

  /**
   * Helper to execute cloud fallback when local Ollama inference fails in Hybrid mode.
   */
  async _tryCloudFallback(document, position, ctx, token, originalCacheKey, abortCtrl) {
    if (token.isCancellationRequested || abortCtrl.signal.aborted) return [];

    const ordered = await this.quotaManager.getPriorityOrderedProviders();
    for (const candidate of ordered) {
      if (candidate.id === PROVIDERS.OLLAMA) continue;

      const apiKey = await this.secretManager.getApiKey(candidate.id);
      if (!apiKey) continue;

      const cd = this.quotaManager.usageTracker.getCooldownInfo(candidate.id);
      if (cd && cd.active) continue;

      const attemptStartedAt = monotonicNow();
      let generationStartedAt = null;
      let generationRecorded = false;
      try {
        const setupStartedAt = monotonicNow();
        const provider = ProviderFactory.create(candidate.id, {
          apiKey,
          model: candidate.model,
          endpoint: candidate.endpoint || null
        });
        this._recordTiming(candidate.id, 'providerSetupMs', monotonicNow() - setupStartedAt);

        const qualityContext = InlineQualityPipeline.extractRelevantContext(ctx.prefix, ctx.suffix, document.languageId);
        Object.assign(qualityContext, {
          prefix: ctx.prefix,
          suffix: ctx.suffix,
          language: document.languageId,
          linePrefix: ctx.linePrefix,
          lineSuffix: ctx.lineSuffix
        });
        const messages = PromptBuilder.buildInlineCompletionMessages(qualityContext);
        const inlinePrompt = PromptBuilder.buildInlineCompletionPrompt(qualityContext);

        const configuredOutputTokens = Number(this.quotaManager.getConfig('maxOutputTokens', 48));
        const maxOutputTokens = Number.isFinite(configuredOutputTokens) && configuredOutputTokens > 0
          ? Math.floor(configuredOutputTokens)
          : 48;
        generationStartedAt = monotonicNow();
        this._incrementMetric(candidate.id, 'requests');
        const response = candidate.id === PROVIDERS.FREELLMAPI
          ? await provider.completeInline(ctx.prefix, ctx.suffix, {
            model: candidate.model,
            maxTokens: Math.min(maxOutputTokens, 64),
            temperature: 0.1,
            timeoutMs: 4500,
            signal: abortCtrl.signal,
              onResponseHeaders: elapsedMs => this._recordTiming(candidate.id, 'responseHeadersMs', elapsedMs),
            inlinePrompt
          })
          : await provider.complete(messages, {
            maxTokens: maxOutputTokens,
            temperature: 0.1,
            timeoutMs: 8000,
            signal: abortCtrl.signal,
            onResponseHeaders: elapsedMs => this._recordTiming(candidate.id, 'responseHeadersMs', elapsedMs)
          });
        this._recordTiming(candidate.id, 'generationMs', monotonicNow() - generationStartedAt);
        generationRecorded = true;

        if (token.isCancellationRequested || abortCtrl.signal.aborted) return [];

        const clean = response && response.finishReason && /^(?:tool_calls?|function_call|content_filter|safety|error)$/i.test(response.finishReason)
          ? ''
          : SuggestionParser.parse(response ? response.text : '', {
          linePrefix: ctx.linePrefix,
          lineSuffix: ctx.lineSuffix,
          language: document.languageId,
          prefix: ctx.prefix,
          suffix: ctx.suffix,
          lineEnding: qualityContext.lineEnding,
          lineIndent: qualityContext.lineIndent
        });

        if (clean && clean.trim().length > 0) {
          this.quotaManager.cache.set(originalCacheKey, clean, {
            ttlMs: 60000,
            tokensSaved: response.usage ? response.usage.totalTokens : 30
          });
          await this.quotaManager.recordSuccess(candidate.id, candidate.model, response.usage || {});
          return [this._buildCompletionItem(clean, position, candidate.id, candidate.model, false)];
        }
      } catch (cloudErr) {
        if (generationStartedAt !== null && !generationRecorded) {
          this._recordTiming(candidate.id, 'generationMs', monotonicNow() - generationStartedAt);
        }
        if (token.isCancellationRequested || abortCtrl.signal.aborted || cloudErr?.name === 'AbortError' || (cloudErr?.message && cloudErr.message.toLowerCase().includes('aborted'))) {
          continue;
        }
        this._incrementMetric(candidate.id, 'providerErrors');
        const classification = await this.quotaManager.recordFailure(candidate.id, candidate.model, cloudErr);
        if (classification && (classification.category === 'RATE_LIMIT' || classification.category === 'QUOTA_EXHAUSTED')) {
          this._incrementMetric(candidate.id, 'rateLimits');
          if (typeof this.quotaManager.notifyRateLimitAndPromptSwitch === 'function') {
            this.quotaManager.notifyRateLimitAndPromptSwitch(candidate.id, classification);
          }
        }
      } finally {
        this._recordTiming(candidate.id, 'totalLatencyMs', monotonicNow() - attemptStartedAt);
      }
    }
    return [];
  }

  _getAdaptiveDebounceMs(ctx, context, intervals) {
    const triggerKind = vscode.InlineCompletionTriggerKind;
    if (triggerKind && context && context.triggerKind === triggerKind.Invoke) return 0;

    const configured = Number(this.quotaManager.getConfig('debounceMs', 150));
    if (Number.isFinite(configured) && configured <= 0) return 0;

    let debounceMs = Math.max(80, Math.min(200, Number.isFinite(configured) ? configured : 150));
    if (intervals.length) {
      const average = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
      if (average < 120) debounceMs = Math.max(debounceMs, 180);
      else if (average > 350) debounceMs = Math.min(debounceMs, 100);
    }

    const trimmedPrefix = (ctx.linePrefix || '').trimEnd();
    const usefulBoundary = /(?:[=(:,.[{]|->|=>|\b(?:return|import|from|const|let|var|def|class|function)\s*)$/i.test(trimmedPrefix)
      || (!trimmedPrefix && /\r?\n$/.test(ctx.prefix || ''));
    if (usefulBoundary) debounceMs = Math.min(debounceMs, 100);
    return debounceMs;
  }

  _createDebounceWait(debounceMs, token) {
    const startedAt = monotonicNow();
    let timer = null;
    let cancellationDisposable = null;
    let settled = false;
    let resolveWait;
    const promise = new Promise(resolve => { resolveWait = resolve; });

    const finish = allowed => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (cancellationDisposable) cancellationDisposable.dispose();
      resolveWait(allowed);
    };

    if (debounceMs <= 0) {
      finish(true);
    } else if (token.isCancellationRequested) {
      finish(false);
    } else {
      timer = setTimeout(() => finish(true), debounceMs);
      if (token && typeof token.onCancellationRequested === 'function') {
        cancellationDisposable = token.onCancellationRequested(() => finish(false));
        if (settled && cancellationDisposable) cancellationDisposable.dispose();
      }
    }

    return {
      promise,
      startedAt,
      cancel: () => finish(false)
    };
  }

  _getProviderMetrics(providerId) {
    if (!providerId) return null;
    let metrics = this._metrics.providers.get(providerId);
    if (!metrics) {
      metrics = { counters: Object.create(null), timings: new Map() };
      this._metrics.providers.set(providerId, metrics);
    }
    return metrics;
  }

  _incrementMetric(providerId, name) {
    const metrics = this._getProviderMetrics(providerId);
    if (metrics) metrics.counters[name] = (metrics.counters[name] || 0) + 1;
  }

  _recordTiming(providerId, name, milliseconds) {
    const metrics = this._getProviderMetrics(providerId);
    const timings = metrics ? metrics.timings : this._metrics.globalTimings;
    let samples = timings.get(name);
    if (!samples) {
      samples = [];
      timings.set(name, samples);
    }
    samples.push(Math.max(0, milliseconds));
    if (samples.length > 100) samples.shift();
  }

  _summarizeTimings(timings) {
    const summary = {};
    for (const [name, values] of timings) {
      const sorted = values.slice().sort((a, b) => a - b);
      summary[name] = {
        count: values.length,
        averageMs: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
        p50Ms: Math.round(sorted[Math.floor((sorted.length - 1) * 0.5)]),
        maxMs: Math.round(sorted[sorted.length - 1])
      };
    }
    return summary;
  }

  getPerformanceMetrics() {
    const providers = {};
    for (const [providerId, metrics] of this._metrics.providers) {
      providers[providerId] = {
        ...metrics.counters,
        timings: this._summarizeTimings(metrics.timings),
        timeToFirstTokenMs: null,
        connectionMs: null
      };
    }
    return {
      invocations: this._metrics.invocations,
      cancellations: this._metrics.cancellations,
      cacheHits: this._metrics.cacheHits,
      cache: this.quotaManager.cache.getMetrics(),
      contextTimings: this._summarizeTimings(this._metrics.globalTimings),
      providers,
      unavailable: {
        timeToFirstToken: 'Inline provider adapters return complete responses, not token events.',
        connectionTime: 'TCP setup cannot be separated from request-to-response-header time with fetch.'
      }
    };
  }

  /**
   * Formats string into a VS Code InlineCompletionItem with acceptance tracking command.
   */
  getLatencyStats() {
    if (!this._latencySamples.length) {
      return { count: 0, averageMs: 0, fastestMs: 0, slowestMs: 0, byProvider: {} };
    }
    const values = this._latencySamples.map(sample => sample.milliseconds);
    const byProvider = {};
    for (const sample of this._latencySamples) {
      if (!byProvider[sample.providerId]) byProvider[sample.providerId] = [];
      byProvider[sample.providerId].push(sample.milliseconds);
    }
    return {
      count: values.length,
      averageMs: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
      fastestMs: Math.min(...values),
      slowestMs: Math.max(...values),
      byProvider: Object.fromEntries(Object.entries(byProvider).map(([providerId, samples]) => [
        providerId,
        {
          count: samples.length,
          averageMs: Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length),
          fastestMs: Math.min(...samples),
          slowestMs: Math.max(...samples)
        }
      ]))
    };
  }

  _buildCompletionItem(insertText, position, providerId, model, isCached = false) {
    const item = new vscode.InlineCompletionItem(
      insertText,
      new vscode.Range(position, position)
    );

    // Track suggestion acceptance on Tab without making duplicate network requests
    item.command = {
      command: 'freecodeAI.suggestionAccepted',
      title: 'Suggestion Accepted',
      arguments: [{ providerId, model, isCached }]
    };

    return item;
  }
}

/**
 * Registers the Laven Inline Completion Provider with VS Code.
 * @param {vscode.ExtensionContext} context
 * @param {object} deps
 * @returns {vscode.Disposable}
 */
function registerInlineProvider(context, deps) {
  const provider = new LavenInlineCompletionProvider(deps);
  if (deps.quotaManager) {
    deps.quotaManager.inlineProvider = provider;
  }

  let disposable = { dispose: () => {} };
  if (vscode.languages && typeof vscode.languages.registerInlineCompletionItemProvider === 'function') {
    disposable = vscode.languages.registerInlineCompletionItemProvider(
      [
        { pattern: '**' },
        { scheme: 'file' },
        { scheme: 'untitled' }
      ],
      provider
    );
  }

  if (context && context.subscriptions) {
    context.subscriptions.push(disposable);
  }

  return disposable;
}

module.exports = {
  LavenInlineCompletionProvider,
  registerInlineProvider
};
