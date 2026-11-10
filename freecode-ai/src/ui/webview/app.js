(function () {
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

  // DOM Elements - Tabs
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  // DOM Elements - Chat
  const messagesContainer = document.getElementById('messages-container');
  const emptyState = document.getElementById('empty-state');
  const promptInput = document.getElementById('prompt-input');
  const sendBtn = document.getElementById('btn-send');
  const newChatBtn = document.getElementById('btn-new-chat');
  const clearChatBtn = document.getElementById('btn-clear-chat');
  const typingIndicator = document.getElementById('typing-indicator');
  const pillProvider = document.getElementById('pill-provider');
  const pillSeparator = document.getElementById('pill-separator');
  const pillModel = document.getElementById('pill-model');
  const activeModelPill = document.getElementById('active-model-pill');
  const quickPromptButtons = document.querySelectorAll('.quick-prompt-btn');

  // DOM Elements - Provider Dashboard
  const providersCardsList = document.getElementById('providers-cards-list');
  const btnAddProvider = document.getElementById('btn-add-provider');
  const globalProviderAlert = document.getElementById('global-provider-alert');

  // DOM Elements - Manage Modal
  const manageModal = document.getElementById('manage-modal');
  const modalProviderTitle = document.getElementById('modal-provider-title');
  const modalProviderDropdown = document.getElementById('modal-provider-dropdown');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const modalStatusAlert = document.getElementById('modal-status-alert');
  const modalGroupKey = document.getElementById('modal-group-key');
  const modalApiKeyInput = document.getElementById('modal-api-key-input');
  const modalMaskedKey = document.getElementById('modal-masked-key');
  const modalApiKeyLink = document.getElementById('modal-api-key-link');
  const modalGroupEndpoint = document.getElementById('modal-group-endpoint');
  const modalEndpointInput = document.getElementById('modal-endpoint-input');
  const modalBtnSaveTestConn = document.getElementById('modal-btn-save-test-conn');
  const modalBtnSelectModel = document.getElementById('modal-btn-select-model');
  const modalBtnTestConn = document.getElementById('modal-btn-test-conn');
  const modalModelSelect = document.getElementById('modal-model-select');
  const modalModelDesc = document.getElementById('modal-model-desc');
  const modalBtnRefreshModels = document.getElementById('modal-btn-refresh-models');
  const modalBtnSaveOnly = document.getElementById('modal-btn-save-only');
  const modalBtnSaveSelectModel = document.getElementById('modal-btn-save-select-model');
  const modalBtnSaveKey = document.getElementById('modal-btn-save-key');
  const modalBtnApplyModel = document.getElementById('modal-btn-apply-model');
  const modalBtnRemove = document.getElementById('modal-btn-remove');
  const modalBtnUseNow = document.getElementById('modal-btn-use-now');

  // DOM Elements - Delete Confirmation Modal
  const confirmModal = document.getElementById('confirm-modal');
  const confirmModalTitle = document.getElementById('confirm-modal-title');
  const confirmModalMsg = document.getElementById('confirm-modal-msg');
  const btnCancelDelete = document.getElementById('btn-cancel-delete');
  const btnExecuteDelete = document.getElementById('btn-execute-delete');

  // DOM Elements - Dashboard
  const dashProviderSelect = document.getElementById('dashboard-provider-select');
  const dashCooldown = document.getElementById('dash-cooldown');
  const dashLastReq = document.getElementById('dash-last-req');
  const dashTotalReqs = document.getElementById('dash-total-reqs');
  const dashSuccessRate = document.getElementById('dash-success-rate');
  const dashRateLimits = document.getElementById('dash-rate-limits');
  const dashFailedReqs = document.getElementById('dash-failed-reqs');
  const dashTotalTokens = document.getElementById('dash-total-tokens');
  const dashPromptTokens = document.getElementById('dash-prompt-tokens');
  const dashCompTokens = document.getElementById('dash-comp-tokens');
  const dashTokenType = document.getElementById('dash-token-type');
  const refreshDashboardBtn = document.getElementById('btn-refresh-dashboard');
  const resetUsageBtn = document.getElementById('btn-reset-usage');

  // State
  let currentActiveProvider = null;
  let currentActiveModel = null;
  let modalTargetProvider = null;
  let cachedProvidersList = [];
  let modalModels = [];

  function updateHeaderPill(provider, model, providerName) {
    if (!activeModelPill) return;
    if (!provider) {
      activeModelPill.classList.add('unconfigured');
      if (pillProvider) pillProvider.textContent = 'No Provider Configured';
      if (pillSeparator) pillSeparator.style.display = 'none';
      if (pillModel) {
        pillModel.textContent = '';
        pillModel.style.display = 'none';
      }
      activeModelPill.title = 'No active AI provider. Click to add or configure a provider.';
    } else {
      activeModelPill.classList.remove('unconfigured');
      const dispName = providerName || provider.toUpperCase();
      if (pillProvider) pillProvider.textContent = dispName;
      if (pillSeparator) pillSeparator.style.display = 'inline';
      if (pillModel) {
        pillModel.textContent = model || 'Default';
        pillModel.style.display = 'inline';
      }
      activeModelPill.title = `Active: ${dispName} (${model || 'Default'}). Click to switch or configure.`;
    }
  }

  const providerLinks = {
    gemini: 'https://aistudio.google.com/app/apikey',
    groq: 'https://console.groq.com/keys',
    openrouter: 'https://openrouter.ai/keys',
    ollama: 'https://ollama.ai/'
  };

  // 1. Navigation / Tab Switching
  function switchTab(tabId) {
    tabButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    tabContents.forEach(content => {
      content.classList.toggle('active', content.id === `view-${tabId}`);
    });

    if (tabId === 'dashboard') {
      requestDashboardData();
    } else if (tabId === 'settings') {
      if (vscode) {
        vscode.postMessage({ command: 'getProvidersList' });
      }
    }
  }

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  if (activeModelPill) {
    activeModelPill.addEventListener('click', () => switchTab('settings'));
  }

  // 2. Chat Logic
  function appendMessage(msg) {
    if (emptyState) {
      emptyState.style.display = 'none';
    }

    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${msg.role} ${msg.error ? 'error' : ''}`;

    const sender = document.createElement('div');
    sender.className = 'message-sender';
    sender.textContent = msg.role === 'user' ? 'You' : (msg.role === 'assistant' ? 'FreeCode AI' : 'System');

    const body = document.createElement('div');
    body.className = 'message-text';
    body.textContent = msg.content;

    bubble.appendChild(sender);
    bubble.appendChild(body);

    if (msg.usage && !msg.error) {
      const meta = document.createElement('div');
      meta.className = 'message-meta';
      const isEst = msg.usage.isEstimated ? 'est.' : 'rep.';
      meta.textContent = `${msg.usage.totalTokens} tokens (${isEst})`;
      bubble.appendChild(meta);
    }

    messagesContainer.appendChild(bubble);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function sendMessage() {
    const text = promptInput.value.trim();
    if (!text) return;

    if (vscode) {
      vscode.postMessage({
        command: 'sendMessage',
        text: text
      });
    }

    promptInput.value = '';
    promptInput.style.height = 'auto';
    sendBtn.disabled = true;
    showTyping('FreeCode AI is thinking...');
  }

  function showTyping(label) {
    typingIndicator.classList.add('active');
    document.getElementById('typing-text').textContent = label || 'Thinking...';
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function hideTyping() {
    typingIndicator.classList.remove('active');
    sendBtn.disabled = false;
  }

  sendBtn.addEventListener('click', sendMessage);

  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  promptInput.addEventListener('input', () => {
    promptInput.style.height = 'auto';
    promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
  });

  newChatBtn.addEventListener('click', () => {
    if (vscode) {
      vscode.postMessage({ command: 'newChat' });
    }
  });

  clearChatBtn.addEventListener('click', () => {
    if (vscode) {
      vscode.postMessage({ command: 'clearChat' });
    }
  });

  quickPromptButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      promptInput.value = btn.dataset.prompt;
      sendMessage();
    });
  });

  // 3. Multi-Provider Persistent Dashboard Logic

  function renderProvidersCards(providers) {
    cachedProvidersList = providers || [];
    providersCardsList.innerHTML = '';

    const configuredList = cachedProvidersList.filter(p => p.isConfigured);

    if (configuredList.length === 0) {
      // Sync chat header: no providers exist, clear header pill
      currentActiveProvider = null;
      currentActiveModel = null;
      updateHeaderPill(null, null, null);

      providersCardsList.innerHTML = `
        <div class="empty-providers-box">
          <div style="font-size: 28px; margin-bottom: 6px;">⚙️</div>
          <h4>No AI Providers Configured</h4>
          <p>You have deleted or haven't configured any AI providers yet.</p>
          <button id="btn-empty-add-provider" class="primary-btn" style="width: auto; padding: 7px 18px; margin: 0 auto; display: inline-flex; align-items: center; gap: 6px;">
            + Add / Set Up Provider
          </button>
        </div>
      `;
      const btnEmpty = document.getElementById('btn-empty-add-provider');
      if (btnEmpty) {
        btnEmpty.addEventListener('click', () => {
          openManageModal(null);
        });
      }
      return;
    }

    // Sync active provider from configured list
    const activeProv = configuredList.find(p => p.isActive);
    if (activeProv) {
      currentActiveProvider = activeProv.id;
      currentActiveModel = activeProv.selectedModel;
      updateHeaderPill(activeProv.id, activeProv.selectedModel, activeProv.name);
    } else {
      currentActiveProvider = null;
      currentActiveModel = null;
      updateHeaderPill(null, null, null);
    }

    configuredList.forEach(p => {
      const isAct = p.isActive;
      const card = document.createElement('div');
      card.className = `provider-card ${isAct ? 'active-card' : ''}`;

      // Header
      const header = document.createElement('div');
      header.className = 'provider-card-header';
      header.innerHTML = `
        <div class="provider-card-title">
          <span>${p.name.toUpperCase()}</span>
          ${isAct ? '<span class="active-tag">Active</span>' : ''}
        </div>
        <span class="badge-status ${p.isConfigured ? 'configured' : 'unconfigured'}">
          ${p.status}
        </span>
      `;
      card.appendChild(header);

      // Body Details
      const details = document.createElement('div');
      details.className = 'provider-card-details';

      let connBadge = '';
      if (p.connectionStatus === 'connected') {
        connBadge = '<span class="badge-status connected">Connected</span>';
      } else if (p.connectionStatus === 'error') {
        connBadge = '<span class="badge-status error">Error</span>';
      } else if (p.connectionStatus === 'configured') {
        connBadge = '<span style="color:var(--vscode-descriptionForeground)">Configured</span>';
      } else {
        connBadge = '<span style="color:var(--vscode-descriptionForeground)">Not configured</span>';
      }

      details.innerHTML = `
        <div class="detail-line">
          <span class="detail-label">Status:</span>
          <span>${p.status} (${connBadge})</span>
        </div>
        <div class="detail-line">
          <span class="detail-label">${p.requiresApiKey ? 'API Key:' : 'Endpoint:'}</span>
          <span class="detail-val">${p.requiresApiKey ? (p.maskedKey || 'Not configured') : (p.endpoint || 'Default local')}</span>
        </div>
        <div class="detail-line">
          <span class="detail-label">Model:</span>
          <span class="detail-val" style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.selectedModel || 'Default'}</span>
        </div>
      `;
      card.appendChild(details);

      // Action Buttons
      const actions = document.createElement('div');
      actions.className = 'provider-card-actions';

      if (isAct) {
        const actBtn = document.createElement('button');
        actBtn.className = 'card-btn active-btn';
        actBtn.textContent = '✓ In Use';
        actions.appendChild(actBtn);
      } else {
        const useBtn = document.createElement('button');
        useBtn.className = 'card-btn use-btn';
        useBtn.textContent = 'Use Provider';
        useBtn.title = `Switch active provider to ${p.name}`;
        useBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          switchActiveProvider(p.id);
        });
        actions.appendChild(useBtn);
      }

      const manageBtn = document.createElement('button');
      manageBtn.className = 'card-btn manage-btn';
      manageBtn.textContent = 'Manage';
      manageBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openManageModal(p.id);
      });
      actions.appendChild(manageBtn);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'card-btn remove-icon-btn';
      removeBtn.innerHTML = '🗑️ Delete';
      removeBtn.title = `Delete credentials and configuration for ${p.name}`;
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showDeleteConfirmation(p.id, p.name);
      });
      actions.appendChild(removeBtn);

      card.appendChild(actions);
      providersCardsList.appendChild(card);
    });
  }

  function switchActiveProvider(providerId) {
    if (vscode) {
      vscode.postMessage({
        command: 'switchProvider',
        provider: providerId
      });
    }
    showGlobalAlert(`Switched active provider to ${providerId.toUpperCase()}.`, 'info');
  }

  let pendingDeleteProviderId = null;

  function showDeleteConfirmation(providerId, providerName) {
    pendingDeleteProviderId = providerId;
    if (confirmModalTitle) {
      confirmModalTitle.textContent = `Delete ${providerName}?`;
    }
    if (confirmModalMsg) {
      confirmModalMsg.textContent = `Are you sure you want to remove credentials and settings for ${providerName}? Other saved providers will remain untouched.`;
    }
    if (confirmModal) {
      confirmModal.style.display = 'flex';
    }
  }

  function hideDeleteConfirmation() {
    pendingDeleteProviderId = null;
    if (confirmModal) {
      confirmModal.style.display = 'none';
    }
  }

  if (btnCancelDelete) {
    btnCancelDelete.addEventListener('click', hideDeleteConfirmation);
  }

  if (confirmModal) {
    confirmModal.addEventListener('click', (e) => {
      if (e.target === confirmModal) hideDeleteConfirmation();
    });
  }

  if (btnExecuteDelete) {
    btnExecuteDelete.addEventListener('click', () => {
      if (!pendingDeleteProviderId) return;
      const provId = pendingDeleteProviderId;
      hideDeleteConfirmation();
      closeManageModal();
      if (vscode) {
        vscode.postMessage({
          command: 'removeProvider',
          provider: provId
        });
      }
      showGlobalAlert(`Deleting configuration for ${provId.toUpperCase()}...`, 'info');
    });
  }

  btnAddProvider.addEventListener('click', () => {
    openManageModal(null);
  });

  // 4. Manage Modal Logic
  function openManageModal(providerId) {
    if (!providerId) {
      // Find first unconfigured provider or default to gemini
      const unconfigured = cachedProvidersList.find(p => !p.isConfigured);
      providerId = unconfigured ? unconfigured.id : 'gemini';
    }

    modalTargetProvider = providerId;
    if (modalProviderDropdown) {
      modalProviderDropdown.value = providerId;
    }

    const providerInfo = cachedProvidersList.find(p => p.id === providerId) || {
      id: providerId,
      name: providerId.toUpperCase(),
      requiresApiKey: providerId !== 'ollama',
      maskedKey: 'Not configured',
      endpoint: 'http://127.0.0.1:11434'
    };

    modalProviderTitle.textContent = `Configure ${providerInfo.name}`;
    modalStatusAlert.style.display = 'none';
    modalApiKeyInput.value = '';

    const isOllama = providerId === 'ollama';
    modalGroupKey.style.display = isOllama ? 'none' : 'flex';
    modalGroupEndpoint.style.display = isOllama ? 'flex' : 'none';

    modalMaskedKey.textContent = providerInfo.maskedKey || 'Not configured';

    if (modalApiKeyLink) {
      modalApiKeyLink.href = providerLinks[providerId] || '#';
      modalApiKeyLink.style.display = isOllama ? 'none' : 'inline';
    }

    if (isOllama && modalEndpointInput) {
      modalEndpointInput.value = providerInfo.endpoint || 'http://127.0.0.1:11434';
    }

    // Request available models for this provider
    if (vscode) {
      vscode.postMessage({
        command: 'fetchModels',
        provider: providerId
      });
    }

    manageModal.style.display = 'flex';
  }

  if (modalProviderDropdown) {
    modalProviderDropdown.addEventListener('change', () => {
      openManageModal(modalProviderDropdown.value);
    });
  }

  function closeManageModal() {
    manageModal.style.display = 'none';
    modalTargetProvider = null;
  }

  btnCloseModal.addEventListener('click', closeManageModal);
  manageModal.addEventListener('click', (e) => {
    if (e.target === manageModal) closeManageModal();
  });

  function handleSaveAndTestConnection() {
    if (!modalTargetProvider) return;

    const providerInfo = cachedProvidersList.find(p => p.id === modalTargetProvider);

    if (modalTargetProvider === 'ollama') {
      const endpoint = (modalEndpointInput && modalEndpointInput.value.trim()) || 'http://127.0.0.1:11434';
      showModalAlert('Saving endpoint & testing Ollama connection...', 'info');
      if (vscode) {
        vscode.postMessage({
          command: 'saveAndTestConnection',
          provider: 'ollama',
          endpoint: endpoint
        });
      }
    } else {
      const key = modalApiKeyInput ? modalApiKeyInput.value.trim() : '';
      const isAlreadyConfigured = providerInfo && providerInfo.isConfigured;

      if (!key && !isAlreadyConfigured) {
        showModalAlert(`Please enter an API key for ${modalTargetProvider.toUpperCase()} before testing.`, 'error');
        return;
      }

      showModalAlert(`Saving credentials & testing connection for ${modalTargetProvider.toUpperCase()}...`, 'info');

      if (vscode) {
        vscode.postMessage({
          command: 'saveAndTestConnection',
          provider: modalTargetProvider,
          apiKey: key || undefined
        });
      }
      if (key && modalApiKeyInput) {
        modalApiKeyInput.value = '';
      }
    }
  }

  function handleSelectThisModel() {
    if (!modalTargetProvider) return;

    const providerInfo = cachedProvidersList.find(p => p.id === modalTargetProvider);
    const selectedModel = modalModelSelect ? modalModelSelect.value : null;

    if (!selectedModel) {
      showModalAlert('Please select a model from the list.', 'error');
      return;
    }

    if (modalTargetProvider === 'ollama') {
      const endpoint = (modalEndpointInput && modalEndpointInput.value.trim()) || 'http://127.0.0.1:11434';
      if (vscode) {
        vscode.postMessage({
          command: 'saveEndpoint',
          provider: 'ollama',
          endpoint: endpoint,
          model: selectedModel,
          activate: true
        });
      }
      showGlobalAlert(`Activated Ollama (${selectedModel}) for chat!`, 'success');
      closeManageModal();
      switchTab('chat');
    } else {
      const key = modalApiKeyInput ? modalApiKeyInput.value.trim() : '';
      const isAlreadyConfigured = providerInfo && providerInfo.isConfigured;

      if (!key && !isAlreadyConfigured) {
        showModalAlert(`Please enter an API key for ${modalTargetProvider.toUpperCase()} first.`, 'error');
        return;
      }

      if (key) {
        if (vscode) {
          vscode.postMessage({
            command: 'saveApiKey',
            provider: modalTargetProvider,
            apiKey: key,
            model: selectedModel,
            activate: true
          });
        }
        if (modalApiKeyInput) modalApiKeyInput.value = '';
      } else {
        if (vscode) {
          vscode.postMessage({
            command: 'selectModel',
            provider: modalTargetProvider,
            model: selectedModel,
            activate: true
          });
          vscode.postMessage({
            command: 'switchProvider',
            provider: modalTargetProvider
          });
        }
      }

      showGlobalAlert(`Activated ${modalTargetProvider.toUpperCase()} (${selectedModel}) for chat!`, 'success');
      closeManageModal();
      switchTab('chat');
    }
  }

  function handleSaveCredentials(activate) {
    if (activate) {
      handleSelectThisModel();
    } else {
      handleSaveAndTestConnection();
    }
  }

  if (modalBtnSaveTestConn) {
    modalBtnSaveTestConn.addEventListener('click', handleSaveAndTestConnection);
  }

  if (modalBtnSelectModel) {
    modalBtnSelectModel.addEventListener('click', handleSelectThisModel);
  }

  // Compatibility bindings for legacy / alias buttons
  if (modalBtnTestConn) {
    modalBtnTestConn.addEventListener('click', handleSaveAndTestConnection);
  }
  if (modalBtnSaveOnly) {
    modalBtnSaveOnly.addEventListener('click', handleSaveAndTestConnection);
  }
  if (modalBtnSaveSelectModel) {
    modalBtnSaveSelectModel.addEventListener('click', handleSelectThisModel);
  }
  if (modalBtnSaveKey) {
    modalBtnSaveKey.addEventListener('click', handleSaveAndTestConnection);
  }
  if (modalBtnApplyModel) {
    modalBtnApplyModel.addEventListener('click', handleSelectThisModel);
  }
  if (modalBtnUseNow) {
    modalBtnUseNow.addEventListener('click', handleSelectThisModel);
  }

  modalBtnRefreshModels.addEventListener('click', () => {
    if (!modalTargetProvider) return;
    if (vscode) {
      vscode.postMessage({
        command: 'fetchModels',
        provider: modalTargetProvider
      });
    }
  });

  modalBtnRemove.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!modalTargetProvider) return;
    const target = cachedProvidersList.find(p => p.id === modalTargetProvider);
    const name = target ? target.name : modalTargetProvider.toUpperCase();
    showDeleteConfirmation(modalTargetProvider, name);
  });

  if (modalBtnUseNow) {
    modalBtnUseNow.addEventListener('click', () => {
      if (!modalTargetProvider) return;
      switchActiveProvider(modalTargetProvider);
      closeManageModal();
      switchTab('chat');
    });
  }

  function populateModalModels(models, activeModelId) {
    modalModels = models || [];
    modalModelSelect.innerHTML = '';

    modalModels.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.name || m.id}${m.isFree ? ' (Free Tier)' : ''}`;
      if (m.id === activeModelId) {
        opt.selected = true;
      }
      modalModelSelect.appendChild(opt);
    });

    updateModalModelDesc();
  }

  function updateModalModelDesc() {
    const selectedId = modalModelSelect.value;
    const found = modalModels.find(m => m.id === selectedId);
    if (found && found.description) {
      modalModelDesc.textContent = found.description;
    } else {
      modalModelDesc.textContent = '';
    }
  }

  modalModelSelect.addEventListener('change', updateModalModelDesc);

  function showModalAlert(msg, type) {
    modalStatusAlert.textContent = msg;
    modalStatusAlert.className = `status-alert ${type}`;
    modalStatusAlert.style.display = 'block';
  }

  function showGlobalAlert(msg, type) {
    globalProviderAlert.textContent = msg;
    globalProviderAlert.className = `status-alert ${type}`;
    globalProviderAlert.style.display = 'block';
    setTimeout(() => {
      globalProviderAlert.style.display = 'none';
    }, 4000);
  }

  // 5. Dashboard Logic
  function requestDashboardData() {
    if (vscode) {
      vscode.postMessage({
        command: 'getDashboardData',
        provider: dashProviderSelect.value
      });
    }
  }

  dashProviderSelect.addEventListener('change', requestDashboardData);
  refreshDashboardBtn.addEventListener('click', requestDashboardData);

  resetUsageBtn.addEventListener('click', () => {
    if (vscode) {
      vscode.postMessage({
        command: 'resetUsage',
        provider: dashProviderSelect.value === 'current' ? currentActiveProvider : dashProviderSelect.value
      });
    }
  });

  function renderDashboard(data) {
    if (!data) return;

    const stats = data.providerStats || {};
    const tokens = stats.tokens || { prompt: 0, completion: 0, total: 0, reported: 0, estimated: 0 };
    const cooldown = data.cooldown || { active: false };

    // Cooldown
    if (cooldown.active) {
      dashCooldown.className = 'cooldown-badge cooling';
      dashCooldown.textContent = `⏳ Cooling Down (${cooldown.remainingSeconds}s left)`;
    } else {
      dashCooldown.className = 'cooldown-badge normal';
      dashCooldown.textContent = '● Ready / Normal';
    }

    dashLastReq.textContent = stats.lastSuccessfulRequest
      ? `Last success: ${new Date(stats.lastSuccessfulRequest).toLocaleTimeString()}`
      : 'Last request: None';

    const totalReqs = stats.totalRequests || 0;
    const successReqs = stats.successfulRequests || 0;
    const rate = totalReqs > 0 ? Math.round((successReqs / totalReqs) * 100) : 100;

    dashTotalReqs.textContent = totalReqs;
    dashSuccessRate.textContent = `${rate}% success rate (${successReqs} passed)`;

    dashRateLimits.textContent = stats.rateLimitErrors || 0;
    dashFailedReqs.textContent = `${stats.failedRequests || 0} failed requests`;

    dashTotalTokens.textContent = tokens.total.toLocaleString();
    dashPromptTokens.textContent = tokens.prompt.toLocaleString();
    dashCompTokens.textContent = tokens.completion.toLocaleString();

    if (tokens.reported > 0 && tokens.estimated === 0) {
      dashTokenType.textContent = 'Exact tokens reported by provider API.';
    } else if (tokens.reported === 0 && tokens.estimated > 0) {
      dashTokenType.textContent = 'Estimated tokens based on character counts.';
    } else if (tokens.total > 0) {
      dashTokenType.textContent = `${tokens.reported} reported, ${tokens.estimated} estimated.`;
    } else {
      dashTokenType.textContent = 'No token usage recorded yet.';
    }
  }

  // 6. Message Listener from Extension Host
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) return;

    switch (msg.type) {
      case 'init': {
        const isReady = Boolean(msg.state && msg.state.provider && msg.state.hasKey !== false);
        if (isReady) {
          currentActiveProvider = msg.state.provider;
          currentActiveModel = msg.state.model;
          updateHeaderPill(currentActiveProvider, currentActiveModel, msg.state.providerName);
        } else {
          currentActiveProvider = null;
          currentActiveModel = null;
          updateHeaderPill(null, null, null);
        }

        if (msg.state && Array.isArray(msg.state.messages) && msg.state.messages.length > 0) {
          if (emptyState) emptyState.style.display = 'none';
          messagesContainer.innerHTML = '';
          msg.state.messages.forEach(appendMessage);
        }
        break;
      }

      case 'providersListUpdated':
        renderProvidersCards(msg.providers);
        break;

      case 'stateUpdated': {
        const isReady = Boolean(msg.state && msg.state.provider && msg.state.hasKey !== false);
        if (isReady) {
          currentActiveProvider = msg.state.provider;
          currentActiveModel = msg.state.model;
          updateHeaderPill(currentActiveProvider, currentActiveModel, msg.state.providerName);
        } else {
          currentActiveProvider = null;
          currentActiveModel = null;
          updateHeaderPill(null, null, null);
        }
        break;
      }

      case 'messageAdded':
        hideTyping();
        appendMessage(msg.message);
        break;

      case 'chatCleared':
        hideTyping();
        messagesContainer.innerHTML = '';
        if (emptyState) {
          messagesContainer.appendChild(emptyState);
          emptyState.style.display = 'block';
        }
        break;

      case 'status':
        if (msg.status === 'thinking') {
          showTyping(msg.message);
        } else {
          hideTyping();
          if (msg.status === 'error') {
            showGlobalAlert(msg.message, 'error');
          }
        }
        break;

      case 'connectionResult':
        if (manageModal.style.display === 'flex') {
          showModalAlert(msg.message, msg.success ? 'success' : 'error');
        } else {
          showGlobalAlert(msg.message, msg.success ? 'success' : 'error');
        }
        break;

      case 'modelsUpdated':
        if (modalTargetProvider === msg.provider || !modalTargetProvider) {
          populateModalModels(msg.models, msg.activeModel);
        }
        break;

      case 'dashboardData':
        renderDashboard(msg.data);
        break;
    }
  });

  // Announce ready to Extension Host
  if (vscode) {
    vscode.postMessage({ command: 'webviewReady' });
  }
})();
