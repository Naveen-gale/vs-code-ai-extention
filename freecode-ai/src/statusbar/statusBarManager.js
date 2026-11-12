/**
 * Status Bar Manager for FreeCode AI.
 * Creates and updates the native VS Code bottom status bar item,
 * displaying active provider, model, inline suggestion state, and API usage.
 */

const vscode = require('vscode');
const { PROVIDER_METADATA } = require('../config/providers');
const { UsageDisplay } = require('./usageDisplay');

class StatusBarManager {
  /**
   * @param {object} options
   * @param {import('../providers/providerManager').ProviderManager} options.providerManager
   * @param {import('../usage/usageTracker').UsageTracker} options.usageTracker
   * @param {import('../../agent/agentManager').AgentManager} [options.agentManager]
   */
  constructor({ providerManager, usageTracker, agentManager }) {
    this.providerManager = providerManager;
    this.usageTracker = usageTracker;
    this.agentManager = agentManager;

    this.statusBarItem = null;
    this._createStatusBarItem();
  }

  setAgentManager(agentManager) {
    this.agentManager = agentManager;
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
    const inlineEnabled = this.agentManager ? this.agentManager.isEnabled() : true;

    if (!activeProvider) {
      this.statusBarItem.text = '$(freecode-logo) Laven: Configure';
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

    // Format concise text for status bar
    const shortName = meta.name.replace(' (Local)', '').replace(' Workers AI', '').replace(' AI', '');
    const shortModel = model ? (model.length > 18 ? model.slice(0, 16) + '…' : model) : '';
    const modelTag = shortModel ? ` (${shortModel})` : '';

    this.statusBarItem.text = `$(freecode-logo) Laven: ${shortName}${modelTag}`;

    // Format rich Markdown tooltip
    const tooltipText = UsageDisplay.formatTooltip(activeProvider, model, this.usageTracker, inlineEnabled);
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
