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
    this._lastTypeTimes.set(docKey, now);

    // 4. Debounce: wait for user to pause typing before sending network requests
    const debounceMs = this.quotaManager.getConfig('debounceMs', 1200);
    if (debounceMs > 0) {
      await new Promise(resolve => setTimeout(resolve, debounceMs));

      // Check if user pressed another key or canceled during debounce
      if (token.isCancellationRequested) {
        return [];
      }
      const latestType = this._lastTypeTimes.get(docKey) || 0;
      if (latestType > now) {
        // User typed again during debounce interval
        return [];
      }
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
      const messages = PromptBuilder.buildChatMessages({
        prefix: ctx.prefix,
        suffix: ctx.suffix,
        language: lang,
        linePrefix: ctx.linePrefix
      });

      const maxOutputTokens = this.quotaManager.getConfig('maxOutputTokens', 96);

      // 11. Execute request
      let response = null;
      try {
        response = await provider.complete(messages, {
          maxTokens: maxOutputTokens,
          temperature: 0.1,
          timeoutMs: selection.isLocal ? 10000 : 8000
        });
      } catch (err) {
        // Record failure (sets cooldown and circuit breaker without touching credentials)
        await this.quotaManager.recordFailure(providerId, model, err);

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
        lineSuffix: ctx.lineSuffix
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
        const provider = ProviderFactory.create(candidate.id, {
          apiKey,
          model: candidate.model
        });

        const messages = PromptBuilder.buildChatMessages({
          prefix: ctx.prefix,
          suffix: ctx.suffix,
          language: document.languageId,
          linePrefix: ctx.linePrefix
        });

        const maxOutputTokens = this.quotaManager.getConfig('maxOutputTokens', 96);
        const response = await provider.complete(messages, {
          maxTokens: maxOutputTokens,
          temperature: 0.1,
          timeoutMs: 8000
        });

        if (token.isCancellationRequested) return [];

        const clean = SuggestionParser.parse(response ? response.text : '', {
          linePrefix: ctx.linePrefix,
          lineSuffix: ctx.lineSuffix
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
        await this.quotaManager.recordFailure(candidate.id, candidate.model, cloudErr);
      }
    }
    return [];
  }

  /**
   * Formats string into a VS Code InlineCompletionItem with acceptance tracking command.
   */
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
      { pattern: '**' },
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
