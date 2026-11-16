'use strict';

/**
 * Status Bar Manager for Laven / FreeCode AI.
 * Displays active provider, model, completion mode, and quota health in VS Code status bar.
 */

const vscode = require('vscode');
const { PROVIDER_METADATA } = require('../config/providers');
const { UsageDisplay } = require('./usageDisplay');

class StatusBarManager {
  /**
   * @param {object} options
   * @param {import('../providers/providerManager').ProviderManager} options.providerManager
   * @param {import('../usage/usageTracker').UsageTracker} options.usageTracker
   * @param {import('../quota/smartQuotaManager').SmartQuotaManager} [options.quotaManager]
   */
  constructor({ providerManager, usageTracker, quotaManager }) {
    this.providerManager = providerManager;
    this.usageTracker = usageTracker;
    this.quotaManager = quotaManager;

    this.statusBarItem = null;
    this._createStatusBarItem();
  }

  setQuotaManager(qm) {
    this.quotaManager = qm;
  }

  _createStatusBarItem() {
    if (vscode.window && typeof vscode.window.createStatusBarItem === 'function') {
      const alignment = vscode.StatusBarAlignment ? vscode.StatusBarAlignment.Right : 2;
      this.statusBarItem = vscode.window.createStatusBarItem(alignment, 100);
      this.statusBarItem.command = 'freecodeAI.openProviderPopup';
      this.update();
      this.statusBarItem.show();
    }
  }

  /**
   * Update the status bar text and tooltip dynamically.
   */
  async update() {
    if (!this.statusBarItem) {
      return;
    }

    const activeProvider = this.providerManager ? this.providerManager.getActiveProvider() : null;
    const inlineEnabled = this.quotaManager ? this.quotaManager.getConfig('enabled', true) : true;
    const mode = this.quotaManager ? this.quotaManager.getCompletionMode() : 'hybrid';
    const modeShort = mode.charAt(0).toUpperCase() + mode.slice(1);

    if (!activeProvider) {
      this.statusBarItem.text = '$(sparkle) Laven: Configure';
      this.statusBarItem.tooltip = 'Laven: Click to configure an AI provider';
      return;
    }

    const meta = PROVIDER_METADATA[activeProvider] || { name: activeProvider };
    let model = null;
    if (this.providerManager) {
      try {
        const cfg = await this.providerManager.getProviderConfiguration(activeProvider);
        model = cfg ? cfg.model : null;
      } catch (e) {}
    }

    const shortName = meta.name.replace(' (Local)', '').replace(' Workers AI', '').replace(' AI', '');
    const shortModel = model ? (model.length > 14 ? model.slice(0, 12) + '…' : model) : '';
    const modelTag = shortModel ? ` (${shortModel})` : '';

    this.statusBarItem.text = `$(sparkle) Laven [${modeShort}]: ${shortName}${modelTag}`;

    const tooltipText = UsageDisplay.formatTooltip(
      activeProvider,
      model,
      this.usageTracker,
      inlineEnabled,
      this.quotaManager
    );

    if (typeof vscode.MarkdownString === 'function') {
      const md = new vscode.MarkdownString(tooltipText);
      md.isTrusted = true;
      this.statusBarItem.tooltip = md;
    } else {
      this.statusBarItem.tooltip = tooltipText;
    }
  }

  /**
   * Clean up and hide status bar item.
   */
  dispose() {
    if (this.statusBarItem) {
      try {
        this.statusBarItem.dispose();
      } catch (e) {}
      this.statusBarItem = null;
    }
  }
}

module.exports = { StatusBarManager };
