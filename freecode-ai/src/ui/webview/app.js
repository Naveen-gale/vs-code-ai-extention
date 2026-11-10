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
  const pillModel = document.getElementById('pill-model');
  const activeModelPill = document.getElementById('active-model-pill');
  const quickPromptButtons = document.querySelectorAll('.quick-prompt-btn');

  // DOM Elements - Settings
  const providerSelect = document.getElementById('provider-select');
  const groupApiKey = document.getElementById('group-api-key');
  const apiKeyInput = document.getElementById('api-key-input');
  const groupEndpoint = document.getElementById('group-endpoint');
  const endpointInput = document.getElementById('endpoint-input');
  const saveKeyBtn = document.getElementById('btn-save-key');
  const testConnectionBtn = document.getElementById('btn-test-connection');
  const connectionStatus = document.getElementById('connection-status');
  const modelSelect = document.getElementById('model-select');
  const modelDescription = document.getElementById('model-description');
  const refreshModelsBtn = document.getElementById('btn-refresh-models');
  const applyModelBtn = document.getElementById('btn-apply-model');
  const apiKeyLink = document.getElementById('api-key-link');

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
  let currentProvider = 'gemini';
  let currentModel = 'gemini-1.5-flash';
  let availableModels = [];
  let dashboardStats = null;

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

  // 3. Provider Settings Logic
  function updateProviderUI(providerId) {
    currentProvider = providerId;
    const isOllama = providerId === 'ollama';

    groupApiKey.style.display = isOllama ? 'none' : 'flex';
    groupEndpoint.style.display = isOllama ? 'flex' : 'none';

    if (apiKeyLink) {
      apiKeyLink.href = providerLinks[providerId] || '#';
      apiKeyLink.style.display = isOllama ? 'none' : 'inline';
    }

    if (vscode) {
      vscode.postMessage({
        command: 'providerSelected',
        provider: providerId
      });
    }
  }

  providerSelect.addEventListener('change', () => {
    updateProviderUI(providerSelect.value);
  });

  saveKeyBtn.addEventListener('click', () => {
    if (currentProvider === 'ollama') {
      const endpoint = endpointInput.value.trim();
      if (vscode) {
        vscode.postMessage({
          command: 'saveEndpoint',
          provider: 'ollama',
          endpoint: endpoint
        });
      }
    } else {
      const key = apiKeyInput.value.trim();
      if (!key) {
        showStatusAlert('Please enter a valid API key.', 'error');
        return;
      }
      if (vscode) {
        vscode.postMessage({
          command: 'saveApiKey',
          provider: currentProvider,
          apiKey: key
        });
      }
    }
  });

  testConnectionBtn.addEventListener('click', () => {
    showStatusAlert('Testing connection...', 'info');
    if (vscode) {
      vscode.postMessage({
        command: 'testConnection',
        provider: currentProvider,
        endpoint: endpointInput.value.trim()
      });
    }
  });

  refreshModelsBtn.addEventListener('click', () => {
    if (vscode) {
      vscode.postMessage({
        command: 'fetchModels',
        provider: currentProvider
      });
    }
  });

  applyModelBtn.addEventListener('click', () => {
    const selectedModel = modelSelect.value;
    if (selectedModel && vscode) {
      vscode.postMessage({
        command: 'selectModel',
        model: selectedModel
      });
      showStatusAlert(`Active model changed to: ${selectedModel}`, 'success');
      switchTab('chat');
    }
  });

  function populateModels(models, activeModelId) {
    availableModels = models || [];
    modelSelect.innerHTML = '';

    availableModels.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.name || m.id}${m.isFree ? ' (Free)' : ''}`;
      if (m.id === activeModelId) {
        opt.selected = true;
      }
      modelSelect.appendChild(opt);
    });

    updateModelDescription();
  }

  function updateModelDescription() {
    const selectedId = modelSelect.value;
    const found = availableModels.find(m => m.id === selectedId);
    if (found && found.description) {
      modelDescription.textContent = found.description;
    } else {
      modelDescription.textContent = '';
    }
  }

  modelSelect.addEventListener('change', updateModelDescription);

  function showStatusAlert(msg, type) {
    connectionStatus.textContent = msg;
    connectionStatus.className = `status-alert ${type}`;
    connectionStatus.style.display = 'block';
  }

  // 4. Dashboard Logic
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
        provider: dashProviderSelect.value === 'current' ? currentProvider : dashProviderSelect.value
      });
    }
  });

  function renderDashboard(data) {
    if (!data) return;
    dashboardStats = data;

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

  // 5. Message listener from Extension Host
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) return;

    switch (msg.type) {
      case 'init':
        currentProvider = msg.state.provider;
        currentModel = msg.state.model;
        providerSelect.value = currentProvider;
        updateProviderUI(currentProvider);

        if (pillProvider) pillProvider.textContent = msg.state.providerName || currentProvider;
        if (pillModel) pillModel.textContent = currentModel;

        if (msg.state.ollamaEndpoint) {
          endpointInput.value = msg.state.ollamaEndpoint;
        }

        populateModels(msg.state.models, currentModel);

        if (Array.isArray(msg.state.messages) && msg.state.messages.length > 0) {
          if (emptyState) emptyState.style.display = 'none';
          messagesContainer.innerHTML = '';
          msg.state.messages.forEach(appendMessage);
        }
        break;

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
            showStatusAlert(msg.message, 'error');
          }
        }
        break;

      case 'connectionResult':
        showStatusAlert(msg.message, msg.success ? 'success' : 'error');
        break;

      case 'modelsUpdated':
        populateModels(msg.models, msg.activeModel);
        break;

      case 'stateUpdated':
        currentProvider = msg.state.provider;
        currentModel = msg.state.model;
        providerSelect.value = currentProvider;
        if (pillProvider) pillProvider.textContent = msg.state.providerName || currentProvider;
        if (pillModel) pillModel.textContent = currentModel;
        break;

      case 'dashboardData':
        renderDashboard(msg.data);
        break;
    }
  });

  // Announce ready
  if (vscode) {
    vscode.postMessage({ command: 'webviewReady' });
  }
})();
