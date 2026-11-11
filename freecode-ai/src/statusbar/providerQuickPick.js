/**
 * Provider QuickPick for FreeCode AI Status Bar.
 * Opens an interactive picker to switch active providers, view honest per-provider usage,
 * toggle inline suggestions, and launch configuration actions.
 */

const vscode = require('vscode');
const { PROVIDERS, PROVIDER_METADATA } = require('../config/providers');
const { UsageDisplay } = require('./usageDisplay');

class ProviderQuickPick {
  /**
   * @param {object} options
   * @param {import('../providers/providerManager').ProviderManager} options.providerManager
   * @param {import('../security/secretManager').SecretManager} options.secretManager
   * @param {import('../usage/usageTracker').UsageTracker} options.usageTracker
   * @param {import('../chat/chatController').ChatController} [options.chatController]
   * @param {import('../../agent/agentManager').AgentManager} [options.agentManager]
   * @param {import('./statusBarManager').StatusBarManager} [options.statusBarManager]
   * @param {object} [options.sidebarProvider]
   */
  constructor({
    providerManager,
    secretManager,
    usageTracker,
    chatController,
    agentManager,
    statusBarManager,
    sidebarProvider
  }) {
    this.providerManager = providerManager;
    this.secretManager = secretManager;
    this.usageTracker = usageTracker;
    this.chatController = chatController;
    this.agentManager = agentManager;
    this.statusBarManager = statusBarManager;
    this.sidebarProvider = sidebarProvider;
  }

  /**
   * Open the QuickPick menu.
   * @returns {Promise<void>}
   */
  async show() {
    const activeProvider = this.providerManager ? this.providerManager.getActiveProvider() : null;
    const configuredList = this.providerManager ? await this.providerManager.getConfiguredProviders() : [];
    const inlineEnabled = this.agentManager ? this.agentManager.isEnabled() : true;

    const items = [];

    // 1. Configured Providers Section
    if (configuredList.length > 0) {
      for (const pid of configuredList) {
        const meta = PROVIDER_METADATA[pid] || { name: pid };
        const cfg = await this.providerManager.getProviderConfiguration(pid);
        const isActive = pid === activeProvider;
        const metrics = UsageDisplay.getProviderMetrics(pid, this.usageTracker);

        const checkIcon = isActive ? '$(check) ' : '$(circle-outline) ';
        const activeLabel = isActive ? ' (Active)' : '';

        items.push({
          label: `${checkIcon}${meta.name}${activeLabel}`,
          description: `Model: ${cfg.model || 'Default'}`,
          detail: `API Usage: ${metrics.statusText} • ${metrics.detail}`,
          action: 'selectProvider',
          providerId: pid,
          model: cfg.model
        });
      }
    } else {
      items.push({
        label: '$(info) No Configured Providers Found',
        description: 'Click below to set up an API key or local Ollama',
        detail: 'Configure a provider to enable AI chat and inline suggestions',
        action: 'configureProvider'
      });
    }

    // 2. Separator
    const separatorKind = vscode.QuickPickItemKind ? vscode.QuickPickItemKind.Separator : undefined;
    if (separatorKind !== undefined) {
      items.push({
        label: 'Actions & Settings',
        kind: separatorKind
      });
    }

    // 3. Action Items
    items.push({
      label: `$(sparkle) Inline Code Suggestions: ${inlineEnabled ? 'ON' : 'OFF'}`,
      description: inlineEnabled ? 'Click to disable ghost-text completions' : 'Click to enable ghost-text completions',
      action: 'toggleInline'
    });

    items.push({
      label: '$(plug) Configure AI Provider...',
      description: 'Add API key or change model configuration',
      action: 'configureProvider'
    });

    items.push({
      label: '$(graph) Open Usage Dashboard',
      description: 'View token counts, efficiency savings, and rate limits',
      action: 'openDashboard'
    });

    items.push({
      label: '$(refresh) Reset Rate Limit Cooldowns',
      description: 'Clear cooldown timers across all providers',
      action: 'resetRateLimits'
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'FreeCode AI — Switch Provider or Adjust Settings',
      matchOnDescription: true,
      matchOnDetail: true
    });

    if (!selected || !selected.action) {
      return;
    }

    switch (selected.action) {
      case 'selectProvider': {
        const targetPid = selected.providerId;
        const meta = PROVIDER_METADATA[targetPid] || { name: targetPid };

        if (this.providerManager) {
          await this.providerManager.setActiveProvider(targetPid);
        }
        if (this.chatController) {
          await this.chatController.setProvider(targetPid);
        }
        if (this.agentManager) {
          this.agentManager.invalidateDirectConnection();
        }
        if (this.statusBarManager) {
          await this.statusBarManager.update();
        }

        // Notify sidebar webview if active
        if (this.sidebarProvider) {
          try {
            this.sidebarProvider.postMessage({
              type: 'stateUpdated',
              state: this.chatController ? await this.chatController.getState() : {}
            });
            this.sidebarProvider.postMessage({
              type: 'providersListUpdated',
              providers: await this.providerManager.getAllProviderStatuses()
            });
          } catch (e) {}
        }

        vscode.window.showInformationMessage(
          `FreeCode AI: Switched to ${meta.name} (${selected.model || 'Default'})`
        );
        break;
      }

      case 'toggleInline': {
        if (this.agentManager) {
          const newState = await this.agentManager.toggleEnabled();
          if (this.statusBarManager) {
            await this.statusBarManager.update();
          }
          vscode.window.showInformationMessage(
            `FreeCode AI: Inline code suggestions ${newState ? 'enabled' : 'disabled'}.`
          );
        }
        break;
      }

      case 'configureProvider': {
        await vscode.commands.executeCommand('freecodeAI.setApiKey');
        break;
      }

      case 'openDashboard': {
        await vscode.commands.executeCommand('freecodeAI.openDashboard');
        break;
      }

      case 'resetRateLimits': {
        await vscode.commands.executeCommand('freecodeAI.resetRateLimits');
        if (this.statusBarManager) {
          await this.statusBarManager.update();
        }
        break;
      }
    }
  }
}

module.exports = { ProviderQuickPick };
