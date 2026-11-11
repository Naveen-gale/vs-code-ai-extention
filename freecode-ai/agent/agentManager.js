/**
 * Agent Manager for FreeCode AI.
 * Orchestrates AI agents including the Inline Completion Agent,
 * registers VS Code providers, and manages agent lifecycles and toggle states.
 */

const vscode = require('vscode');
const { InlineAgent } = require('./inline/inlineAgent');
const { CacheManager } = require('./inline/cacheManager');

class AgentManager {
  /**
   * @param {object} options
   * @param {import('../src/providers/providerManager').ProviderManager} options.providerManager
   * @param {import('../src/security/secretManager').SecretManager} options.secretManager
   * @param {import('../src/usage/usageTracker').UsageTracker} options.usageTracker
   */
  constructor({ providerManager, secretManager, usageTracker }) {
    this.providerManager = providerManager;
    this.secretManager = secretManager;
    this.usageTracker = usageTracker;

    this.cacheManager = new CacheManager();
    this.inlineAgent = new InlineAgent({
      providerManager,
      secretManager,
      usageTracker,
      cacheManager: this.cacheManager
    });

    this._registration = null;
    this._disposables = [];
  }

  /**
   * Register inline completion item provider with VS Code.
   * @param {vscode.ExtensionContext} context
   */
  register(context) {
    if (vscode.languages && typeof vscode.languages.registerInlineCompletionItemProvider === 'function') {
      try {
        // Match all documents, languages, and schemes
        const selector = '*';

        this._registration = vscode.languages.registerInlineCompletionItemProvider(
          selector,
          this.inlineAgent
        );

        if (context && context.subscriptions) {
          context.subscriptions.push(this._registration);
        }
      } catch (err) {
        console.warn('FreeCode AI: Failed to register inline completion provider:', err);
      }
    }

    // Listen for configuration changes
    if (vscode.workspace && typeof vscode.workspace.onDidChangeConfiguration === 'function') {
      const configListener = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('freecodeAI.inline')) {
          this.cacheManager.clear();
        }
      });
      this._disposables.push(configListener);
      if (context && context.subscriptions) {
        context.subscriptions.push(configListener);
      }
    }
  }

  /**
   * Check if inline suggestions are currently enabled.
   * @returns {boolean}
   */
  isEnabled() {
    return this.inlineAgent.getConfig().enabled;
  }

  /**
   * Toggle inline suggestions enabled/disabled state.
   * @returns {Promise<boolean>} new enabled state
   */
  async toggleEnabled() {
    const current = this.isEnabled();
    const nextState = !current;

    try {
      if (vscode.workspace && typeof vscode.workspace.getConfiguration === 'function') {
        const config = vscode.workspace.getConfiguration('freecodeAI.inline');
        await config.update('enabled', nextState, vscode.ConfigurationTarget.Global);
      }
    } catch (e) {
      console.warn('FreeCode AI: Error updating inline setting:', e);
    }

    return nextState;
  }

  /**
   * Invalidate direct provider connection cache when provider/key changes.
   */
  invalidateDirectConnection() {
    if (this.inlineAgent) {
      this.inlineAgent.invalidateDirectConnection();
    }
  }

  /**
   * Clear all cached suggestions across open documents.
   */
  clearCache() {
    this.cacheManager.clear();
  }

  dispose() {
    if (this._registration) {
      try {
        this._registration.dispose();
      } catch (e) {}
      this._registration = null;
    }

    for (const d of this._disposables) {
      try {
        d.dispose();
      } catch (e) {}
    }
    this._disposables = [];

    if (this.inlineAgent) {
      this.inlineAgent.dispose();
    }
  }
}

module.exports = { AgentManager };
