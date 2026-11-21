'use strict';

/**
 * Intelligent Inline Completion Provider for Laven.
 * Integrates:
 * - Debouncing (default 1200ms) to prevent per-keystroke requests
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

    // Track last typed timestamp per document for debouncing
    this._lastTypeTimes = new Map();
    this._latencySamples = [];
    this._typingIntervals = [];
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
    // 1. Check if inline suggestions are globally enabled
    const enabled = this.quotaManager.getConfig('enabled', true);
    if (!enabled) return [];

    // 2. Check supported language
    const lang = document.languageId;
    if (lang && !ContextCollector.SUPPORTED_LANGUAGES.has(lang)) {
      return [];
    }

    // 3. Collect bounded context around cursor (strip secrets & bounded tokens)
    const maxInputTokens = this.quotaManager.getConfig('maxInputTokens', 1500);
    const ctx = ContextCollector.collectBounded(document, position, { maxInputTokens });
    if (!ctx.isMeaningful) {
      return [];
    }

    const docKey = document.uri.toString();
    const now = Date.now();
    const previousType = this._lastTypeTimes.get(docKey) || 0;
    if (previousType > 0) {
      this._typingIntervals.push(now - previousType);
      if (this._typingIntervals.length > 20) this._typingIntervals.shift();
    }
    this._lastTypeTimes.set(docKey, now);

    const qualityContext = InlineQualityPipeline.extractRelevantContext(ctx.prefix, ctx.suffix, lang);
    Object.assign(qualityContext, {
      prefix: ctx.prefix,
      suffix: ctx.suffix,
      language: lang,
      linePrefix: ctx.linePrefix,
      lineSuffix: ctx.lineSuffix
    });

    const localPrediction = LocalPredictionEngine.predict(qualityContext);
    if (localPrediction) {
      this.quotaManager.stats.localCompletions++;
      return [this._buildCompletionItem(localPrediction.text, position, 'local', 'rule', false)];
    }

    // 5. Select eligible provider according to Mode and Priority
    const selection = await this.quotaManager.selectProviderForInline({
      estimatedTokens: 60,
      documentUri: docKey
    });

    if (!selection || !selection.providerId) {
      return [];
    }

    const providerId = selection.providerId;
    const model = selection.model;

    // 6. Check Intelligent Suggestion Cache (LRU + TTL)
    const cacheKey = SuggestionCache.buildKey({
      providerId,
      model,
      language: lang,
      prefix: ctx.prefix,
      suffix: ctx.suffix
    });

    const cached = this.quotaManager.cache.get(cacheKey);
    if (cached) {
      return [this._buildCompletionItem(cached, position, providerId, model, true)];
    }

    // 4. Debounce only AI requests; local rules and cache hits return immediately
    const configuredDebounce = this.quotaManager.getConfig('debounceMs', 250);
    const typingFast = this._typingIntervals.length
      && this._typingIntervals.reduce((sum, interval) => sum + interval, 0) / this._typingIntervals.length < 180;
    let debounceMs = typingFast ? Math.min(configuredDebounce, 180) : configuredDebounce;
    debounceMs = Math.max(80, Math.min(300, debounceMs));
    if (debounceMs > 0) {
      await new Promise(resolve => setTimeout(resolve, debounceMs));
      if (token.isCancellationRequested) return [];
      const latestType = this._lastTypeTimes.get(docKey) || 0;
      if (latestType > now) return [];
    }

    // 7. Concurrency Guard: register in-flight request & abort any stale request
    const abortCtrl = this.quotaManager.beginRequest(docKey);

    try {
      // 8. Retrieve credentials (API Key is NEVER deleted on error or cooldown)
      let apiKey = null;
      let endpoint = null;

      if (!selection.isLocal) {
        apiKey = await this.secretManager.getApiKey(providerId);
        if (!apiKey) {
          return [];
        }
        if (providerId === PROVIDERS.FREELLMAPI) {
          const freeLLMAPIConfig = await this.providerManager.getProviderConfiguration(PROVIDERS.FREELLMAPI);
          endpoint = freeLLMAPIConfig.endpoint || 'http://127.0.0.1:31415/v1';
        }
      } else {
        const ollamaCfg = await this.providerManager.getProviderConfiguration(PROVIDERS.OLLAMA);
        endpoint = ollamaCfg.endpoint || 'http://127.0.0.1:11434';
      }

      // 9. Instantiate provider
      const provider = ProviderFactory.create(providerId, {
        apiKey,
        model,
        endpoint
      });

      // 10. Build bounded prompt
      const messages = PromptBuilder.buildQualityChatMessages(qualityContext);

      const maxOutputTokens = this.quotaManager.getConfig('maxOutputTokens', 96);
      const systemPrompt = messages[0]?.role === 'system' ? messages[0].content : '';

      // 11. Execute request
      let response = null;
      try {
        const requestStart = Date.now();
        if (providerId === PROVIDERS.FREELLMAPI) {
          response = await provider.completeInline(ctx.prefix, ctx.suffix, {
            model,
            maxTokens: Math.min(maxOutputTokens, 64),
            temperature: 0.1,
            timeoutMs: 4500,
            signal: abortCtrl.signal,
            inlinePrompt: `${messages[0].content}\n\n${messages[1].content}`
          });
        } else {
          response = await provider.complete(messages, {
            systemPrompt,
            maxTokens: maxOutputTokens,
            temperature: 0.1,
            timeoutMs: selection.isLocal ? 3000 : 8000,
            signal: abortCtrl.signal
          });
        }
        this._latencySamples.push({
          providerId,
          model,
          milliseconds: Date.now() - requestStart,
          timestamp: Date.now()
        });
        if (this._latencySamples.length > 100) this._latencySamples.shift();
      } catch (err) {
        // If aborted by user typing or cancellation, exit cleanly without recording failure
        if (token.isCancellationRequested || abortCtrl.signal.aborted || err?.name === 'AbortError' || (err?.message && err.message.toLowerCase().includes('aborted'))) {
          return [];
        }

        // Record failure (sets cooldown and circuit breaker only on verified rate limits / quota exhaustion)
        const classification = await this.quotaManager.recordFailure(providerId, model, err);

        // If remote API hit actual rate limits, prompt user to switch providers immediately
        if (classification && (classification.category === 'RATE_LIMIT' || classification.category === 'QUOTA_EXHAUSTED')) {
          if (typeof this.quotaManager.notifyRateLimitAndPromptSwitch === 'function') {
            this.quotaManager.notifyRateLimitAndPromptSwitch(providerId, classification);
          }
        }

        // In Hybrid mode: If local Ollama failed, attempt cloud fallback
        if (selection.isLocal && this.quotaManager.isCloudFallbackEnabled()) {
          return await this._tryCloudFallback(document, position, ctx, token, cacheKey);
        }
        return [];
      }

      if (token.isCancellationRequested || abortCtrl.signal.aborted) {
        return [];
      }

      const rawText = response ? response.text : '';
      if (!rawText) return [];

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
      this.quotaManager.endRequest(docKey);
    }
  }

  /**
   * Helper to execute cloud fallback when local Ollama inference fails in Hybrid mode.
   */
  async _tryCloudFallback(document, position, ctx, token, originalCacheKey) {
    if (token.isCancellationRequested) return [];

    const ordered = await this.quotaManager.getPriorityOrderedProviders();
    for (const candidate of ordered) {
      if (candidate.id === PROVIDERS.OLLAMA) continue;

      const apiKey = await this.secretManager.getApiKey(candidate.id);
      if (!apiKey) continue;

      const cd = this.quotaManager.usageTracker.getCooldownInfo(candidate.id);
      if (cd && cd.active) continue;

      try {
        let endpoint = null;
        if (candidate.id === PROVIDERS.FREELLMAPI) {
          const cfg = await this.providerManager.getProviderConfiguration(PROVIDERS.FREELLMAPI);
          endpoint = cfg.endpoint || 'http://127.0.0.1:31415/v1';
        }
        const provider = ProviderFactory.create(candidate.id, {
          apiKey,
          model: candidate.model,
          endpoint
        });

        const qualityContext = InlineQualityPipeline.extractRelevantContext(ctx.prefix, ctx.suffix, document.languageId);
        Object.assign(qualityContext, {
          prefix: ctx.prefix,
          suffix: ctx.suffix,
          language: document.languageId,
          linePrefix: ctx.linePrefix,
          lineSuffix: ctx.lineSuffix
        });
        const messages = PromptBuilder.buildQualityChatMessages(qualityContext);

        const maxOutputTokens = this.quotaManager.getConfig('maxOutputTokens', 96);
        const systemPrompt = messages[0]?.role === 'system' ? messages[0].content : '';
        const response = candidate.id === PROVIDERS.FREELLMAPI
          ? await provider.completeInline(ctx.prefix, ctx.suffix, {
            model: candidate.model,
            maxTokens: Math.min(maxOutputTokens, 64),
            temperature: 0.1,
            timeoutMs: 4500,
            inlinePrompt: `${messages[0].content}\n\n${messages[1].content}`
          })
          : await provider.complete(messages, {
            systemPrompt,
            maxTokens: maxOutputTokens,
            temperature: 0.1,
            timeoutMs: 8000
          });

        if (token.isCancellationRequested) return [];

        const clean = SuggestionParser.parse(response ? response.text : '', {
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
        if (token.isCancellationRequested || cloudErr?.name === 'AbortError' || (cloudErr?.message && cloudErr.message.toLowerCase().includes('aborted'))) {
          continue;
        }
        const classification = await this.quotaManager.recordFailure(candidate.id, candidate.model, cloudErr);
        if (classification && (classification.category === 'RATE_LIMIT' || classification.category === 'QUOTA_EXHAUSTED')) {
          if (typeof this.quotaManager.notifyRateLimitAndPromptSwitch === 'function') {
            this.quotaManager.notifyRateLimitAndPromptSwitch(candidate.id, classification);
          }
        }
      }
    }
    return [];
  }

  /**
   * Formats string into a VS Code InlineCompletionItem with acceptance tracking command.
   */
  getLatencyStats() {
    if (!this._latencySamples.length) {
      return { count: 0, averageMs: 0, fastestMs: 0, slowestMs: 0 };
    }
    const values = this._latencySamples.map(sample => sample.milliseconds);
    return {
      count: values.length,
      averageMs: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
      fastestMs: Math.min(...values),
      slowestMs: Math.max(...values)
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
