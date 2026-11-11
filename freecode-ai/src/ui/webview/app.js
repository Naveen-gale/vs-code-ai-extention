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
  const btnTestFailover = document.getElementById('btn-test-failover');
  const globalProviderAlert = document.getElementById('global-provider-alert');

  // DOM Elements - Manage Modal
  const manageModal = document.getElementById('manage-modal');
  const modalProviderTitle = document.getElementById('modal-provider-title');
  const modalProviderDropdown = document.getElementById('modal-provider-dropdown');
  const modalPrioritySelect = document.getElementById('modal-priority-select');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const modalStatusAlert = document.getElementById('modal-status-alert');
  const modalGroupKey = document.getElementById('modal-group-key');
  const modalApiKeyInput = document.getElementById('modal-api-key-input');
  const modalMaskedKey = document.getElementById('modal-masked-key');
  const modalApiKeyLink = document.getElementById('modal-api-key-link');
  const modalGroupEndpoint = document.getElementById('modal-group-endpoint');
  const modalEndpointLabel = document.getElementById('modal-endpoint-label');
  const modalEndpointHint = document.getElementById('modal-endpoint-hint');
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
  const btnResetRateLimits = document.getElementById('btn-reset-rate-limits');
  const dashVelocityStatus = document.getElementById('dash-velocity-status');
  const dashVelocityDesc = document.getElementById('dash-velocity-desc');
  const dashRpm = document.getElementById('dash-rpm');
  const dashMaxRpm = document.getElementById('dash-max-rpm');
  const dashTpm = document.getElementById('dash-tpm');
  const dashMaxTpm = document.getElementById('dash-max-tpm');
  const dashTokensSaved = document.getElementById('dash-tokens-saved');
  const dashSavingsBadge = document.getElementById('dash-savings-badge');

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
    ollama: 'https://ollama.ai/',
    cohere: 'https://dashboard.cohere.com/api-keys',
    cloudflare: 'https://dash.cloudflare.com/',
    mistral: 'https://console.mistral.ai/api-keys/',
    nvidia: 'https://build.nvidia.com/',
    deepseek: 'https://platform.deepseek.com/api_keys',
    huggingface: 'https://huggingface.co/settings/tokens',
    openai: 'https://platform.openai.com/api-keys'
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
    if (msg.role === 'assistant' && (!msg.content || typeof msg.content !== 'string' || msg.content.trim().length === 0)) {
      body.textContent = 'No response text received from provider. Please switch models or check your configuration.';
      bubble.classList.add('error');
    } else {
      body.textContent = msg.content;
    }

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
    showTyping('Thinking...');
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

  if (sendBtn) sendBtn.addEventListener('click', sendMessage);

  if (promptInput) {
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
  }

  if (newChatBtn) {
    newChatBtn.addEventListener('click', () => {
      if (vscode) {
        vscode.postMessage({ command: 'newChat' });
      }
    });
  }

  if (clearChatBtn) {
    clearChatBtn.addEventListener('click', () => {
      if (vscode) {
        vscode.postMessage({ command: 'clearChat' });
      }
    });
  }

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
      currentActiveProvider = null;
      currentActiveModel = null;
      updateHeaderPill(null, null, null);

      providersCardsList.innerHTML = `
        <div class="empty-providers-box">
          <h4>No Providers Configured</h4>
          <p>Add an AI provider to start using FreeCode AI.</p>
          <button id="btn-empty-add-provider" class="primary-btn btn-sm">
            + Add Provider
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
          <span>${p.name}</span>
          <span class="priority-tag" title="Failover Priority #${p.priority || 1}">#${p.priority || 1}</span>
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

      let connText = 'Not configured';
      if (p.connectionStatus === 'connected') connText = 'Connected';
      else if (p.connectionStatus === 'error') connText = 'Error';
      else if (p.connectionStatus === 'configured') connText = 'Configured';

      details.innerHTML = `
        <div class="detail-line">
          <span class="detail-label">Connection</span>
          <span class="detail-val">${connText}</span>
        </div>
        <div class="detail-line">
          <span class="detail-label">Priority</span>
          <span class="detail-val">#${p.priority || 1} ${p.priority === 1 ? '(Primary)' : '(Fallback)'}</span>
        </div>
        <div class="detail-line">
          <span class="detail-label">${p.requiresApiKey ? 'API Key' : 'Endpoint'}</span>
          <span class="detail-val">${p.requiresApiKey ? (p.maskedKey || 'Not configured') : (p.endpoint || 'Default local')}</span>
        </div>
        <div class="detail-line">
          <span class="detail-label">Model</span>
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
        actBtn.textContent = 'In Use';
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
      manageBtn.textContent = 'Configure';
      manageBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openManageModal(p.id);
      });
      actions.appendChild(manageBtn);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'card-btn remove-icon-btn';
      removeBtn.textContent = 'Delete';
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
      confirmModalMsg.textContent = `Remove saved credentials and settings for ${providerName}? Other providers will remain untouched.`;
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
      showGlobalAlert(`Removed configuration for ${provId.toUpperCase()}.`, 'info');
    });
  }

  if (btnAddProvider) {
    btnAddProvider.addEventListener('click', () => {
      openManageModal(null);
    });
  }

  const DEFAULT_MODELS = {
    gemini: [
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Fast multimodal model', isFree: true },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Next-gen multimodal model', isFree: true },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: 'Complex reasoning model', isFree: true }
    ],
    groq: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', description: 'Meta flagship model on Groq', isFree: true },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', description: 'Fast lightweight model', isFree: true },
      { id: 'deepseek-r1-distill-llama-70b', name: 'DeepSeek R1 Distill 70B', description: 'DeepSeek R1 reasoning on Groq', isFree: true },
      { id: 'qwen-2.5-coder-32b', name: 'Qwen 2.5 Coder 32B', description: 'Specialized coding model', isFree: true }
    ],
    openrouter: [
      { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (Free)', description: 'Free tier instruction model', isFree: true },
      { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (Free)', description: 'Free experimental model', isFree: true },
      { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 (Free)', description: 'DeepSeek R1 reasoning free tier', isFree: true },
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', description: 'Anthropic coding & reasoning model', isFree: false }
    ],
    ollama: [
      { id: 'llama3:latest', name: 'Llama 3 (8B)', description: 'Default local Llama 3 model', isFree: true },
      { id: 'qwen2.5-coder:latest', name: 'Qwen 2.5 Coder', description: 'Local coding model', isFree: true },
      { id: 'deepseek-r1:latest', name: 'DeepSeek R1', description: 'Local DeepSeek R1 reasoning', isFree: true }
    ],
    cohere: [
      { id: 'command-r-plus', name: 'Command R+', description: 'Cohere reasoning & code model', isFree: true },
      { id: 'command-r', name: 'Command R', description: 'Fast scalable model', isFree: true }
    ],
    cloudflare: [
      { id: '@cf/meta/llama-3.3-70b-instruct', name: '@cf/meta/llama-3.3-70b-instruct', description: 'Llama 3.3 70B on Workers AI', isFree: true },
      { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', name: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', description: 'DeepSeek R1 on Workers AI', isFree: true },
      { id: '@cf/qwen/qwen2.5-coder-32b-instruct', name: '@cf/qwen/qwen2.5-coder-32b-instruct', description: 'Qwen 2.5 Coder on Workers AI', isFree: true }
    ],
    mistral: [
      { id: 'codestral-latest', name: 'Codestral Latest', description: 'Mistral coding model', isFree: false },
      { id: 'mistral-large-latest', name: 'Mistral Large Latest', description: 'Mistral flagship reasoning model', isFree: false },
      { id: 'mistral-small-latest', name: 'Mistral Small Latest', description: 'Fast lightweight model', isFree: false }
    ],
    nvidia: [
      { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct', description: 'Meta 70B on NVIDIA NIM', isFree: true },
      { id: 'meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B Instruct', description: 'Meta 3.1 70B on NVIDIA NIM', isFree: true },
      { id: 'meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B Instruct', description: 'Fast 8B model on NVIDIA NIM', isFree: true },
      { id: 'deepseek-ai/deepseek-r1', name: 'DeepSeek R1', description: 'Reasoning and code generation', isFree: true },
      { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70B Instruct', description: 'NVIDIA tuned reasoning model', isFree: true },
      { id: 'qwen/qwen2.5-coder-32b-instruct', name: 'Qwen 2.5 Coder 32B', description: 'Specialized code generation model', isFree: true },
      { id: 'mistralai/mistral-large-2-instruct', name: 'Mistral Large 2', description: 'Multilingual reasoning and code', isFree: true }
    ],
    deepseek: [
      { id: 'deepseek-chat', name: 'DeepSeek-V3', description: 'DeepSeek flagship chat & code model', isFree: false },
      { id: 'deepseek-reasoner', name: 'DeepSeek-R1', description: 'DeepSeek reasoning model', isFree: false }
    ],
    huggingface: [
      { id: 'meta-llama/Llama-3.2-3B-Instruct', name: 'Llama 3.2 3B Instruct', description: 'Fast model on HF Serverless', isFree: true },
      { id: 'Qwen/Qwen2.5-Coder-32B-Instruct', name: 'Qwen 2.5 Coder 32B', description: 'Qwen 2.5 Coder on HF Serverless', isFree: true },
      { id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B', name: 'DeepSeek R1 Distill 32B', description: 'DeepSeek R1 distilled on HF', isFree: true }
    ],
    openai: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast, lightweight OpenAI model', isFree: false },
      { id: 'gpt-4o', name: 'GPT-4o', description: 'OpenAI flagship multimodal model', isFree: false },
      { id: 'o3-mini', name: 'o3 Mini', description: 'OpenAI fast reasoning model', isFree: false },
      { id: 'o1', name: 'o1', description: 'OpenAI full reasoning model', isFree: false }
    ]
  };

  // 4. Manage Modal Logic
  function openManageModal(providerId) {
    if (!providerId) {
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
    const isCloudflare = providerId === 'cloudflare';
    const isNvidia = providerId === 'nvidia';
    modalGroupKey.style.display = isOllama ? 'none' : 'flex';
    modalGroupEndpoint.style.display = (isOllama || isCloudflare || isNvidia) ? 'flex' : 'none';

    if (modalEndpointLabel) {
      if (isCloudflare) modalEndpointLabel.textContent = 'Cloudflare Account ID (Optional)';
      else if (isNvidia) modalEndpointLabel.textContent = 'NVIDIA NIM Base URL (Optional)';
      else modalEndpointLabel.textContent = 'Ollama Server Endpoint';
    }
    if (modalEndpointHint) {
      if (isCloudflare) modalEndpointHint.textContent = 'Enter your 32-char Account ID or custom gateway URL.';
      else if (isNvidia) modalEndpointHint.textContent = 'Default: https://integrate.api.nvidia.com/v1';
      else modalEndpointHint.textContent = "Default local server endpoint. Ensure 'ollama serve' is running.";
    }

    modalMaskedKey.textContent = providerInfo.maskedKey || 'Not configured';

    if (modalApiKeyLink) {
      modalApiKeyLink.href = providerLinks[providerId] || '#';
      modalApiKeyLink.style.display = isOllama ? 'none' : 'inline';
    }

    if (modalEndpointInput) {
      if (isCloudflare) {
        modalEndpointInput.placeholder = '0123456789abcdef0123456789abcdef';
        modalEndpointInput.value = providerInfo.endpoint || '';
      } else if (isNvidia) {
        modalEndpointInput.placeholder = 'https://integrate.api.nvidia.com/v1';
        modalEndpointInput.value = providerInfo.endpoint || '';
      } else if (isOllama) {
        modalEndpointInput.placeholder = 'http://127.0.0.1:11434';
        modalEndpointInput.value = providerInfo.endpoint || 'http://127.0.0.1:11434';
      }
    }

    if (modalPrioritySelect) {
      modalPrioritySelect.value = String(providerInfo.priority || 1);
    }

    const initialModels = DEFAULT_MODELS[providerId] || [];
    populateModalModels(initialModels, providerInfo.selectedModel || (initialModels[0] ? initialModels[0].id : null));

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

  if (modalPrioritySelect) {
    modalPrioritySelect.addEventListener('change', () => {
      if (modalTargetProvider && vscode) {
        vscode.postMessage({
          command: 'setProviderPriority',
          provider: modalTargetProvider,
          priority: Number(modalPrioritySelect.value)
        });
      }
    });
  }

  if (btnTestFailover) {
    btnTestFailover.addEventListener('click', () => {
      if (vscode) {
        vscode.postMessage({ command: 'simulateFailover' });
      }
    });
  }

  function closeManageModal() {
    manageModal.style.display = 'none';
    modalTargetProvider = null;
  }

  if (btnCloseModal) btnCloseModal.addEventListener('click', closeManageModal);
  if (manageModal) {
    manageModal.addEventListener('click', (e) => {
      if (e.target === manageModal) closeManageModal();
    });
  }

  function handleSaveAndTestConnection() {
    if (!modalTargetProvider) return;

    const providerInfo = cachedProvidersList.find(p => p.id === modalTargetProvider);
    const priorityVal = modalPrioritySelect ? Number(modalPrioritySelect.value) : 1;

    if (modalTargetProvider === 'ollama') {
      const endpoint = (modalEndpointInput && modalEndpointInput.value.trim()) || 'http://127.0.0.1:11434';
      showModalAlert('Saving endpoint and testing connection...', 'info');
      if (vscode) {
        vscode.postMessage({
          command: 'saveAndTestConnection',
          provider: 'ollama',
          endpoint: endpoint,
          priority: priorityVal
        });
      }
    } else {
      const key = modalApiKeyInput ? modalApiKeyInput.value.trim() : '';
      const isAlreadyConfigured = Boolean(
        (providerInfo && providerInfo.isConfigured) ||
        (providerInfo && providerInfo.maskedKey && providerInfo.maskedKey !== 'Not configured')
      );

      if (!key && !isAlreadyConfigured) {
        showModalAlert(`Please enter an API key for ${modalTargetProvider.toUpperCase()}.`, 'error');
        return;
      }

      const endpointVal = ((modalTargetProvider === 'cloudflare' || modalTargetProvider === 'nvidia') && modalEndpointInput)
        ? (modalEndpointInput.value.trim() || undefined)
        : undefined;

      showModalAlert(`Testing connection for ${modalTargetProvider.toUpperCase()}...`, 'info');

      if (vscode) {
        vscode.postMessage({
          command: 'saveAndTestConnection',
          provider: modalTargetProvider,
          apiKey: key || undefined,
          endpoint: endpointVal,
          priority: priorityVal
        });
      }
    }
  }

  function handleSelectThisModel() {
    if (!modalTargetProvider) return;

    const providerInfo = cachedProvidersList.find(p => p.id === modalTargetProvider);
    let selectedModel = modalModelSelect ? modalModelSelect.value : null;
    const priorityVal = modalPrioritySelect ? Number(modalPrioritySelect.value) : 1;

    if (!selectedModel || selectedModel.startsWith('Loading')) {
      const defaults = DEFAULT_MODELS[modalTargetProvider] || [];
      selectedModel = defaults.length > 0 ? defaults[0].id : null;
    }

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
          priority: priorityVal,
          activate: true
        });
      }
      currentActiveProvider = 'ollama';
      currentActiveModel = selectedModel;
      updateHeaderPill('ollama', selectedModel, 'Ollama');
      showGlobalAlert(`Activated Ollama (${selectedModel}).`, 'success');
      closeManageModal();
      switchTab('chat');
    } else {
      const key = modalApiKeyInput ? modalApiKeyInput.value.trim() : '';
      const isAlreadyConfigured = Boolean(
        (providerInfo && providerInfo.isConfigured) ||
        (providerInfo && providerInfo.maskedKey && providerInfo.maskedKey !== 'Not configured')
      );

      if (!key && !isAlreadyConfigured) {
        showModalAlert(`Please enter an API key for ${modalTargetProvider.toUpperCase()} first.`, 'error');
        return;
      }

      const endpointVal = ((modalTargetProvider === 'cloudflare' || modalTargetProvider === 'nvidia') && modalEndpointInput)
        ? (modalEndpointInput.value.trim() || undefined)
        : undefined;

      if (key) {
        if (vscode) {
          vscode.postMessage({
            command: 'saveApiKey',
            provider: modalTargetProvider,
            apiKey: key,
            endpoint: endpointVal,
            model: selectedModel,
            priority: priorityVal,
            activate: true
          });
        }
      } else {
        if (vscode) {
          vscode.postMessage({
            command: 'selectModel',
            provider: modalTargetProvider,
            model: selectedModel,
            endpoint: endpointVal,
            priority: priorityVal,
            activate: true
          });
        }
      }

      if (providerInfo) {
        providerInfo.isConfigured = true;
        providerInfo.selectedModel = selectedModel;
      }
      currentActiveProvider = modalTargetProvider;
      currentActiveModel = selectedModel;
      const provName = providerInfo ? providerInfo.name : modalTargetProvider.toUpperCase();
      updateHeaderPill(currentActiveProvider, currentActiveModel, provName);

      showGlobalAlert(`Activated ${provName} (${selectedModel}).`, 'success');
      closeManageModal();
      switchTab('chat');
    }
  }

  if (modalBtnSaveTestConn) {
    modalBtnSaveTestConn.addEventListener('click', handleSaveAndTestConnection);
  }

  if (modalBtnSelectModel) {
    modalBtnSelectModel.addEventListener('click', handleSelectThisModel);
  }

  // Compatibility bindings
  if (modalBtnTestConn) modalBtnTestConn.addEventListener('click', handleSaveAndTestConnection);
  if (modalBtnSaveOnly) modalBtnSaveOnly.addEventListener('click', handleSaveAndTestConnection);
  if (modalBtnSaveSelectModel) modalBtnSaveSelectModel.addEventListener('click', handleSelectThisModel);
  if (modalBtnSaveKey) modalBtnSaveKey.addEventListener('click', handleSaveAndTestConnection);
  if (modalBtnApplyModel) modalBtnApplyModel.addEventListener('click', handleSelectThisModel);
  if (modalBtnUseNow) modalBtnUseNow.addEventListener('click', handleSelectThisModel);

  if (modalBtnRefreshModels) {
    modalBtnRefreshModels.addEventListener('click', () => {
      if (!modalTargetProvider) return;
      const keyVal = modalApiKeyInput ? modalApiKeyInput.value.trim() : '';
      const endpointVal = ((modalTargetProvider === 'cloudflare' || modalTargetProvider === 'nvidia' || modalTargetProvider === 'ollama') && modalEndpointInput)
        ? modalEndpointInput.value.trim()
        : undefined;

      if (modalModelSelect) {
        modalModelSelect.innerHTML = '<option value="" disabled selected>Loading models...</option>';
      }
      if (modalModelDesc) {
        modalModelDesc.textContent = 'Refreshing models from provider...';
      }

      if (vscode) {
        vscode.postMessage({
          command: 'fetchModels',
          provider: modalTargetProvider,
          apiKey: keyVal || undefined,
          endpoint: endpointVal
        });
      }
    });
  }

  if (modalBtnRemove) {
    modalBtnRemove.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!modalTargetProvider) return;
      const target = cachedProvidersList.find(p => p.id === modalTargetProvider);
      const name = target ? target.name : modalTargetProvider.toUpperCase();
      showDeleteConfirmation(modalTargetProvider, name);
    });
  }

  let apiKeyFetchTimer = null;
  if (modalApiKeyInput) {
    modalApiKeyInput.addEventListener('input', () => {
      const keyVal = modalApiKeyInput.value.trim();
      if (keyVal.length >= 6 && modalTargetProvider && vscode) {
        clearTimeout(apiKeyFetchTimer);
        apiKeyFetchTimer = setTimeout(() => {
          vscode.postMessage({
            command: 'fetchModels',
            provider: modalTargetProvider,
            apiKey: keyVal
          });
        }, 600);
      }
    });
  }

  function getModelPricingTag(model, providerId) {
    if (model.isFree === true) return 'Free';
    if (model.isFree === false) return 'Paid';

    const pId = providerId || modalTargetProvider;
    if (pId === 'mistral' || pId === 'deepseek' || pId === 'openai') return 'Paid';
    if (pId === 'ollama' || pId === 'gemini' || pId === 'groq' || pId === 'cloudflare' || pId === 'cohere' || pId === 'nvidia' || pId === 'huggingface') return 'Free';
    if (pId === 'openrouter') {
      return (model.id && model.id.endsWith(':free')) ? 'Free' : 'Paid';
    }
    return model.isFree ? 'Free' : 'Paid';
  }

  function populateModalModels(models, activeModelId) {
    modalModels = models || [];
    modalModelSelect.innerHTML = '';

    modalModels.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      const tag = getModelPricingTag(m, modalTargetProvider);
      const rawName = m.name || m.id;
      const cleanName = rawName.replace(/\s*\((Free|Paid)[^)]*\)$/i, '').trim();
      opt.textContent = `${cleanName} (${tag})`;
      if (m.id === activeModelId) {
        opt.selected = true;
      }
      modalModelSelect.appendChild(opt);
    });

    updateModalModelDesc();
  }

  function updateModalModelDesc() {
    if (!modalModelSelect || !modalModelDesc) return;
    const selectedId = modalModelSelect.value;
    const found = modalModels.find(m => m.id === selectedId);
    if (found) {
      const tag = getModelPricingTag(found, modalTargetProvider);
      const badge = tag === 'Free' ? '🟢 Free Model' : '💳 Paid Model';
      const desc = found.description ? ` · ${found.description}` : '';
      modalModelDesc.textContent = `${badge}${desc}`;
    } else {
      modalModelDesc.textContent = '';
    }
  }

  if (modalModelSelect) {
    modalModelSelect.addEventListener('change', updateModalModelDesc);
  }

  function showModalAlert(msg, type) {
    if (modalStatusAlert) {
      modalStatusAlert.textContent = msg;
      modalStatusAlert.className = `status-alert ${type}`;
      modalStatusAlert.style.display = 'block';
    }
  }

  function showGlobalAlert(msg, type) {
    if (globalProviderAlert) {
      globalProviderAlert.textContent = msg;
      globalProviderAlert.className = `status-alert ${type}`;
      globalProviderAlert.style.display = 'block';
      setTimeout(() => {
        globalProviderAlert.style.display = 'none';
      }, 4000);
    }
  }

  // 5. Dashboard Logic
  function requestDashboardData() {
    if (vscode) {
      const selectedProv = dashProviderSelect ? dashProviderSelect.value : 'current';
      vscode.postMessage({
        command: 'getDashboardData',
        provider: selectedProv
      });
    }
  }

  if (dashProviderSelect) dashProviderSelect.addEventListener('change', requestDashboardData);
  if (refreshDashboardBtn) refreshDashboardBtn.addEventListener('click', requestDashboardData);

  if (resetUsageBtn) {
    resetUsageBtn.addEventListener('click', () => {
      if (vscode) {
        const selectedProv = dashProviderSelect ? dashProviderSelect.value : 'current';
        vscode.postMessage({
          command: 'resetUsage',
          provider: selectedProv === 'current' ? currentActiveProvider : selectedProv
        });
      }
    });
  }

  if (btnResetRateLimits) {
    btnResetRateLimits.addEventListener('click', () => {
      if (vscode) {
        const selectedProv = dashProviderSelect ? dashProviderSelect.value : 'current';
        vscode.postMessage({
          command: 'resetRateLimits',
          provider: selectedProv === 'current' ? currentActiveProvider : selectedProv
        });
      }
    });
  }

  function renderDashboard(data) {
    if (!data) return;

    const stats = data.providerStats || {};
    const tokens = stats.tokens || { prompt: 0, completion: 0, total: 0, reported: 0, estimated: 0 };
    const cooldown = data.cooldown || { active: false };

    if (cooldown.active) {
      dashCooldown.className = 'cooldown-badge cooling';
      dashCooldown.textContent = `Cooldown (${cooldown.remainingSeconds}s remaining)`;
    } else {
      dashCooldown.className = 'cooldown-badge normal';
      dashCooldown.textContent = 'Ready';
    }

    dashLastReq.textContent = stats.lastSuccessfulRequest
      ? `Last request: ${new Date(stats.lastSuccessfulRequest).toLocaleTimeString()}`
      : 'Last request: None';

    const totalReqs = stats.totalRequests || 0;
    const successReqs = stats.successfulRequests || 0;
    const rate = totalReqs > 0 ? Math.round((successReqs / totalReqs) * 100) : 100;

    dashTotalReqs.textContent = totalReqs;
    dashSuccessRate.textContent = `${rate}% success (${successReqs} passed)`;

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

    // Velocity & API Limit Guard
    const velocity = data.velocity || { rpm: 0, tpm: 0, maxRpm: 30, maxTpm: 6000, status: 'Optimal', headroomPercent: 100, description: 'Standard Tier' };
    if (dashRpm) dashRpm.textContent = velocity.rpm;
    if (dashMaxRpm) dashMaxRpm.textContent = velocity.maxRpm.toLocaleString();
    if (dashTpm) dashTpm.textContent = velocity.tpm.toLocaleString();
    if (dashMaxTpm) dashMaxTpm.textContent = velocity.maxTpm.toLocaleString();
    if (dashVelocityDesc) dashVelocityDesc.textContent = velocity.description || 'Standard Tier';

    if (dashVelocityStatus) {
      if (velocity.status === 'Cooldown') {
        dashVelocityStatus.className = 'cooldown-badge cooling';
        dashVelocityStatus.textContent = '● Cooling Down';
      } else if (velocity.status === 'Near Limit') {
        dashVelocityStatus.className = 'cooldown-badge cooling';
        dashVelocityStatus.textContent = `● Near Limit (${velocity.headroomPercent}% Headroom)`;
      } else if (velocity.status === 'Moderate') {
        dashVelocityStatus.className = 'cooldown-badge normal';
        dashVelocityStatus.textContent = `● Moderate (${velocity.headroomPercent}% Headroom)`;
      } else {
        dashVelocityStatus.className = 'cooldown-badge normal';
        dashVelocityStatus.textContent = `● Optimal (${velocity.headroomPercent}% Headroom)`;
      }
    }

    // Token Efficiency & Savings
    const efficiency = data.efficiency || { tokensSaved: tokens.saved || 0, savingsPercent: 0 };
    if (dashTokensSaved) dashTokensSaved.textContent = (efficiency.tokensSaved || 0).toLocaleString();
    if (dashSavingsBadge) {
      const pct = efficiency.savingsPercent || 0;
      dashSavingsBadge.textContent = `${pct}% tokens saved`;
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
          const count = Array.isArray(msg.models) ? msg.models.length : 0;
          if (count > 0 && modalStatusAlert && !modalStatusAlert.classList.contains('error')) {
            showModalAlert(`Connection verified. ${count} models loaded from ${msg.provider.toUpperCase()}.`, 'success');
          }
        }
        break;

      case 'fallbackSuggestion': {
        const { failedProvider, reason, fallbackProvider, pendingPrompt, isRateLimit } = msg;
        if (!fallbackProvider) break;

        const headerTitle = isRateLimit
          ? `${failedProvider.name} Rate Limited`
          : `${failedProvider.name} Request Failed`;

        const box = document.createElement('div');
        box.className = 'fallback-prompt-box';
        box.innerHTML = `
          <div class="fallback-prompt-header">
            <span style="font-weight: 600; color: var(--danger);">
              ${headerTitle}
            </span>
            <span class="badge-status error">Failover Available</span>
          </div>
          <div style="font-size: 11px; color: var(--text-muted);">
            ${reason}
          </div>
          <div style="background: rgba(0,0,0,0.12); padding: 8px 10px; border-radius: 4px; font-size: 11px;">
            <div style="color: var(--text-muted); margin-bottom: 2px;">Next in priority order:</div>
            <div style="font-weight: 600; display: flex; align-items: center; gap: 6px;">
              <span>${fallbackProvider.name}</span>
              <span class="priority-tag">#${fallbackProvider.priority}</span>
              <span style="color: var(--text-muted); font-weight: 400;">(${fallbackProvider.model})</span>
            </div>
          </div>
          <div style="display: flex; gap: 6px;">
            <button class="primary-btn btn-accept-fallback" style="flex: 2;">
              Switch to ${fallbackProvider.name} & Retry
            </button>
            <button class="secondary-btn btn-dismiss-fallback" style="flex: 1;">
              Dismiss
            </button>
          </div>
        `;

        const btnAccept = box.querySelector('.btn-accept-fallback');
        const btnDismiss = box.querySelector('.btn-dismiss-fallback');

        btnAccept.addEventListener('click', () => {
          box.innerHTML = `<div style="font-size: 11px; color: var(--text-muted);">Switching to ${fallbackProvider.name} and retrying...</div>`;
          if (vscode) {
            vscode.postMessage({
              command: 'acceptFallback',
              provider: fallbackProvider.id,
              retryText: pendingPrompt
            });
          }
        });

        btnDismiss.addEventListener('click', () => {
          box.remove();
        });

        messagesContainer.appendChild(box);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        break;
      }

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