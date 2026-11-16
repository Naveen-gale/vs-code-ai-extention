'use strict';

/**
 * Provider QuickPick for Laven Status Bar.
 * Allows switching providers, changing completion modes (Hybrid/Local/Cloud),
 * viewing honest quota usage, clearing suggestion cache, and resetting cooldowns.
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
   * @param {import('../quota/smartQuotaManager').SmartQuotaManager} [options.quotaManager]
   * @param {import('./statusBarManager').StatusBarManager} [options.statusBarManager]
   * @param {object} [options.sidebarProvider]
   */
  constructor({
    providerManager,
    secretManager,
    usageTracker,
    chatController,
    quotaManager,
    statusBarManager,
    sidebarProvider
  }) {
    this.providerManager  = providerManager;
    this.secretManager    = secretManager;
    this.usageTracker     = usageTracker;
    this.chatController   = chatController;
    this.quotaManager     = quotaManager;
    this.statusBarManager = statusBarManager;
    this.sidebarProvider  = sidebarProvider;
  }

  /**
   * Open the QuickPick menu.
   * @returns {Promise<void>}
   */
  async show() {
    const activeProvider = this.providerManager ? this.providerManager.getActiveProvider() : null;
    const configuredList = this.providerManager ? await this.providerManager.getConfiguredProviders() : [];
    const inlineEnabled = this.quotaManager ? this.quotaManager.getConfig('enabled', true) : true;
    const currentMode = this.quotaManager ? this.quotaManager.getCompletionMode() : 'hybrid';

    const items = [];

    // 1. Configured Providers Section
    if (configuredList.length > 0) {
      for (const pid of configuredList) {
        const meta = PROVIDER_METADATA[pid] || { name: pid };
        const cfg = await this.providerManager.getProviderConfiguration(pid);
        const isActive = pid === activeProvider;
        const metrics = UsageDisplay.getProviderMetrics(pid, this.usageTracker, this.quotaManager);

        const checkIcon = isActive ? '$(check) ' : '$(circle-outline) ';
        const activeLabel = isActive ? ' (Active)' : '';

        items.push({
          label: `${checkIcon}${meta.name}${activeLabel}`,
          description: `Model: ${cfg.model || 'Default'} • Priority #${cfg.priority || 99}`,
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

    // 2. Separator: Modes & Controls
    const separatorKind = vscode.QuickPickItemKind ? vscode.QuickPickItemKind.Separator : undefined;
    if (separatorKind !== undefined) {
      items.push({
        label: 'Completion Mode & Controls',
        kind: separatorKind
      });
    }

    // 3. Mode Switcher
    const modeLabels = {
      hybrid: 'Hybrid (Local Ollama first + Cloud fallback)',
      local: 'Local Only (Ollama offline inference)',
      cloud: 'Cloud Only (Skip local Ollama)'
    };

    items.push({
      label: `$(sync) Completion Strategy: ${currentMode.toUpperCase()}`,
      description: modeLabels[currentMode] || currentMode,
      detail: 'Click to switch between Hybrid, Local-Only, or Cloud-Only',
      action: 'switchMode'
    });

    items.push({
      label: `$(sparkle) Inline Code Suggestions: ${inlineEnabled ? 'ON' : 'OFF'}`,
      description: inlineEnabled ? 'Click to disable ghost-text completions' : 'Click to enable ghost-text completions',
      action: 'toggleInline'
    });

    if (separatorKind !== undefined) {
      items.push({
        label: 'Actions & Maintenance',
        kind: separatorKind
      });
    }

    items.push({
      label: '$(trash) Clear Suggestion Cache',
      description: this.quotaManager ? `${this.quotaManager.cache.stats.hits} hits, ${this.quotaManager.cache.stats.requestsAvoided} avoided` : 'Clear in-memory suggestions',
      action: 'clearCache'
    });

    items.push({
      label: '$(plug) Configure AI Provider API Key...',
      description: 'Add or update API key in SecretStorage',
      action: 'configureProvider'
    });

    items.push({
      label: '$(graph) Open Usage Dashboard',
      description: 'View token counts, velocity, and quota savings',
      action: 'openDashboard'
    });

    items.push({
      label: '$(refresh) Reset Rate Limit Cooldowns',
      description: 'Clear cooldown timers across all providers',
      action: 'resetRateLimits'
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Laven Assistant — Switch Provider or Adjust Quota Settings',
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
        if (this.statusBarManager) {
          await this.statusBarManager.update();
        }

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
          } catch (_) {}
        }

        vscode.window.showInformationMessage(
          `Laven: Switched to ${meta.name} (${selected.model || 'Default'})`
        );
        break;
      }

      case 'switchMode': {
        const modes = [
          { label: 'Hybrid (Recommended)', id: 'hybrid', description: 'Local Ollama first; cloud fallback on failure' },
          { label: 'Local Only', id: 'local', description: 'Ollama only; zero cloud requests; completely offline' },
          { label: 'Cloud Only', id: 'cloud', description: 'Skip local Ollama; use cloud providers in priority order' }
        ];

        const pickedMode = await vscode.window.showQuickPick(modes, {
          placeHolder: 'Select Inline Completion Mode'
        });

        if (pickedMode && this.quotaManager) {
          await this.quotaManager.setCompletionMode(pickedMode.id);
          if (this.statusBarManager) {
            await this.statusBarManager.update();
          }
          vscode.window.showInformationMessage(
            `Laven: Completion mode set to ${pickedMode.label}.`
          );
        }
        break;
      }

      case 'toggleInline': {
        const cfg = vscode.workspace.getConfiguration('laven.inline');
        const current = cfg.get('enabled', true);
        await cfg.update('enabled', !current, vscode.ConfigurationTarget.Global);
        if (this.statusBarManager) {
          await this.statusBarManager.update();
        }
        vscode.window.showInformationMessage(
          `Laven: Inline suggestions ${!current ? 'enabled' : 'disabled'}.`
        );
        break;
      }

      case 'clearCache': {
        if (this.quotaManager && this.quotaManager.cache) {
          this.quotaManager.cache.clear();
          vscode.window.showInformationMessage('Laven: Suggestion cache cleared.');
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
