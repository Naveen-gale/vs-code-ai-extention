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
  const modalSelectionMode = document.getElementById('modal-selection-mode');

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
    freellmapi: 'https://github.com/tashfeenahmed/freellmapi',
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

  // 2. Chat Logic & Markdown / Code Rendering System
  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    if (vscode) {
      vscode.postMessage({ command: 'copyCode', text: text });
    }
  }

  // Tokenize & colorize code syntax without HTML collision
  function highlightSyntax(code, lang) {
    const l = (lang || '').toLowerCase();
    const isPy = ['python', 'py'].includes(l);

    const rules = [
      { type: 'comment', rx: isPy ? /#(?:[^\r\n]*)/y : /(?:\/\/.*|\/\*[\s\S]*?\*\/)/y },
      { type: 'string', rx: isPy ? /(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\r\n])*"|'(?:\\.|[^'\r\n])*')/y : /(?:"(?:\\.|[^"\r\n])*"|'(?:\\.|[^'\r\n])*'|`[\s\S]*?`)/y },
      { type: 'kw', rx: /\b(def|class|return|if|else|elif|for|while|import|from|as|try|except|finally|raise|async|await|function|const|let|var|export|default|new|typeof|instanceof|void|delete|in|of|with|yield|pass|break|continue|lambda|switch|case|catch|throw)\b/y },
      { type: 'builtin', rx: /\b(True|False|None|true|false|null|undefined|self|this|int|str|bool|float|list|dict|set|tuple|print|range|len|console|window|document|Math|JSON)\b/y },
      { type: 'decorator', rx: /@[a-zA-Z_]\w*/y },
      { type: 'fn', rx: /[a-zA-Z_]\w*(?=\s*\()/y },
      { type: 'num', rx: /\b\d+(?:\.\d+)?\b/y },
      { type: 'op', rx: /(?:===|!==|==|!=|<=|>=|->|=>|\+=|-=|\*=|\/=|&&|\|\||[-+*\/%<>=!])/y },
      { type: 'ident', rx: /[a-zA-Z_]\w*/y },
      { type: 'space', rx: /\s+/y },
      { type: 'punct', rx: /./y }
    ];

    let i = 0;
    let out = '';
    while (i < code.length) {
      let matched = false;
      for (const r of rules) {
        r.rx.lastIndex = i;
        const m = r.rx.exec(code);
        if (m && m.index === i) {
          matched = true;
          const text = m[0];
          i += text.length;
          const esc = escapeHtml(text);
          if (r.type === 'space' || r.type === 'ident' || r.type === 'punct') {
            out += esc;
          } else {
            out += `<span class="tok-${r.type}">${esc}</span>`;
          }
          break;
        }
      }
      if (!matched) {
        out += escapeHtml(code[i]);
        i++;
      }
    }
    return out;
  }

  function formatInline(text) {
    let s = escapeHtml(text);
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong class="md-bold">$1</strong>');
    s = s.replace(/(^|[^\*])\*([^\*]+?)\*([^\*]|$)/g, '$1<em class="md-italic">$2</em>$3');
    s = s.replace(/`([^`]+?)`/g, '<code class="md-inline-code">$1</code>');
    return s;
  }

  function parseMarkdown(text) {
    if (!text) return { html: '', codeBlocks: [] };

    const codeBlocks = [];
    // 1. Extract closed fenced code blocks
    let src = text.replace(/```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g, (match, lang, code) => {
      const trimmedCode = code.replace(/\r?\n$/, '');
      const cleanLang = (lang || 'code').trim();
      const highlighted = highlightSyntax(trimmedCode, cleanLang);
      const placeholder = `___FREECODE_BLOCK_${codeBlocks.length}___`;
      codeBlocks.push({
        raw: trimmedCode,
        lang: cleanLang,
        html: `
<div class="code-block-container" data-lang="${cleanLang}">
  <textarea class="raw-code" style="display:none;">${escapeHtml(trimmedCode)}</textarea>
  <div class="code-block-header">
    <div class="code-lang-label">
      <svg class="code-lang-icon" viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
        <path d="M4.7 11.3L1.4 8l3.3-3.3L4 4l-4 4 4 4 .7-.7zm6.6 0l3.3-3.3L11.3 4.7 12 4l4 4-4 4-.7-.7z"/>
      </svg>
      <span class="code-lang-tag">${cleanLang.toUpperCase()}</span>
    </div>
    <div class="code-block-actions">
      <button class="code-btn btn-copy-code" title="Copy code">
        <svg class="btn-icon" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
          <path d="M4 4v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V4H4zm1-1h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>
          <path d="M2 1h7a1 1 0 0 1 1 1v1H9V2H2v8h1v1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"/>
        </svg>
        <span class="btn-text">Copy</span>
      </button>
      <button class="code-btn btn-insert-code" title="Insert at cursor in active editor">
        <svg class="btn-icon" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
          <path d="M8 1v11.293l3.146-3.147a.5.5 0 0 1 .708.708l-4 4a.5.5 0 0 1-.708 0l-4-4a.5.5 0 1 1 .708-.708L7 12.293V1a.5.5 0 0 1 1 0z"/>
          <path d="M1 14.5a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 0 1h-13a.5.5 0 0 1-.5-.5z"/>
        </svg>
        <span class="btn-text">Insert</span>
      </button>
    </div>
  </div>
  <pre class="code-pre"><code class="code-body language-${cleanLang}">${highlighted}</code></pre>
</div>`
      });
      return placeholder;
    });

    // Handle unclosed code block (e.g. while streaming)
    src = src.replace(/```([a-zA-Z0-9_-]*)\r?\n([\s\S]*)$/, (match, lang, code) => {
      const trimmedCode = code;
      const cleanLang = (lang || 'code').trim();
      const highlighted = highlightSyntax(trimmedCode, cleanLang);
      const placeholder = `___FREECODE_BLOCK_${codeBlocks.length}___`;
      codeBlocks.push({
        raw: trimmedCode,
        lang: cleanLang,
        html: `
<div class="code-block-container" data-lang="${cleanLang}">
  <textarea class="raw-code" style="display:none;">${escapeHtml(trimmedCode)}</textarea>
  <div class="code-block-header">
    <div class="code-lang-label">
      <svg class="code-lang-icon" viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
        <path d="M4.7 11.3L1.4 8l3.3-3.3L4 4l-4 4 4 4 .7-.7zm6.6 0l3.3-3.3L11.3 4.7 12 4l4 4-4 4-.7-.7z"/>
      </svg>
      <span class="code-lang-tag">${cleanLang.toUpperCase()} (generating...)</span>
    </div>
    <div class="code-block-actions">
      <button class="code-btn btn-copy-code" title="Copy code">
        <svg class="btn-icon" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
          <path d="M4 4v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V4H4zm1-1h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>
          <path d="M2 1h7a1 1 0 0 1 1 1v1H9V2H2v8h1v1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"/>
        </svg>
        <span class="btn-text">Copy</span>
      </button>
    </div>
  </div>
  <pre class="code-pre"><code class="code-body language-${cleanLang}">${highlighted}</code></pre>
</div>`
      });
      return placeholder;
    });

    // 2. Process markdown line by line
    const lines = src.split(/\r?\n/);
    const out = [];
    let inList = false;
    let inOrderedList = false;
    let inCallout = false;

    const closeList = () => {
      if (inList) { out.push('</ul>'); inList = false; }
      if (inOrderedList) { out.push('</ol>'); inOrderedList = false; }
    };
    const closeCallout = () => {
      if (inCallout) { out.push('</div></div>'); inCallout = false; }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Code block placeholder
      if (line.trim().startsWith('___FREECODE_BLOCK_') && line.trim().endsWith('___')) {
        closeList();
        closeCallout();
        out.push(line.trim());
        continue;
      }

      // Callout card: e.g. **Notes**, **Important**, **Warning**, **Tip**
      if (/^\s*\*\*(Notes?|Important|Warning|Tip)\*\*\s*$/i.test(line)) {
        closeList();
        closeCallout();
        const title = line.replace(/\*\*/g, '').trim();
        inCallout = true;
        out.push(`<div class="callout-card ${title.toLowerCase()}"><div class="callout-header"><span class="callout-icon">💡</span> <span class="callout-title">${escapeHtml(title)}</span></div><div class="callout-body">`);
        continue;
      }

      // Markdown Headers: ###, ##, #
      if (/^###\s+(.+)$/.test(line)) {
        closeList();
        closeCallout();
        out.push(`<h5 class="md-h3">${formatInline(line.replace(/^###\s+/, ''))}</h5>`);
        continue;
      }
      if (/^##\s+(.+)$/.test(line)) {
        closeList();
        closeCallout();
        out.push(`<h4 class="md-h2">${formatInline(line.replace(/^##\s+/, ''))}</h4>`);
        continue;
      }
      if (/^#\s+(.+)$/.test(line)) {
        closeList();
        closeCallout();
        out.push(`<h3 class="md-h1">${formatInline(line.replace(/^#\s+/, ''))}</h3>`);
        continue;
      }

      // Bold numbered subheadings like: **1. Iterative (recommended for performance)**
      const numSubHeader = line.match(/^\s*\*\*(\d+\.\s+[^*]+)\*\*\s*$/);
      if (numSubHeader) {
        closeList();
        closeCallout();
        const numPart = numSubHeader[1].match(/^\d+/)[0];
        const titlePart = numSubHeader[1].replace(/^\d+\.\s*/, '');
        out.push(`<div class="md-subheading"><span class="subheading-badge">${escapeHtml(numPart)}</span><span class="subheading-text">${formatInline(titlePart)}</span></div>`);
        continue;
      }

      // Blockquote: > ...
      if (/^>\s*(.*)$/.test(line)) {
        closeList();
        const quoteText = line.replace(/^>\s*/, '');
        out.push(`<blockquote class="md-quote">${formatInline(quoteText)}</blockquote>`);
        continue;
      }

      // Unordered lists: - item or * item
      if (/^\s*[-*]\s+(.+)$/.test(line)) {
        if (inOrderedList) { out.push('</ol>'); inOrderedList = false; }
        if (!inList) { out.push('<ul class="md-list">'); inList = true; }
        const itemText = line.replace(/^\s*[-*]\s+/, '');
        out.push(`<li>${formatInline(itemText)}</li>`);
        continue;
      }

      // Ordered lists: 1. item
      if (/^\s*(\d+)\.\s+(.+)$/.test(line)) {
        if (inList) { out.push('</ul>'); inList = false; }
        if (!inOrderedList) { out.push('<ol class="md-olist">'); inOrderedList = true; }
        const itemText = line.replace(/^\s*\d+\.\s+/, '');
        out.push(`<li>${formatInline(itemText)}</li>`);
        continue;
      }

      // Empty line
      if (!line.trim()) {
        closeList();
        continue;
      }

      // Regular paragraph
      closeList();
      out.push(`<p class="md-para">${formatInline(line)}</p>`);
    }

    closeList();
    closeCallout();

    let rendered = out.join('\n');
    // Function replacement prevents $1 special replacement pattern collision
    codeBlocks.forEach((block, idx) => {
      rendered = rendered.replace(`___FREECODE_BLOCK_${idx}___`, () => block.html);
    });

    return { html: rendered, codeBlocks };
  }

  function appendMessage(msg) {
    if (emptyState) {
      emptyState.style.display = 'none';
    }

    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${msg.role} ${msg.error ? 'error' : ''}`;

    if (msg.role === 'assistant') {
      const isMissing = !msg.content || typeof msg.content !== 'string' || msg.content.trim().length === 0;
      const contentText = isMissing
        ? 'No response text received from provider. Please switch models or check your configuration.'
        : msg.content;
      if (isMissing) bubble.classList.add('error');

      // Hidden raw text for exact 1-click clipboard copy
      const rawArea = document.createElement('textarea');
      rawArea.className = 'raw-message-content';
      rawArea.style.display = 'none';
      rawArea.value = contentText;
      bubble.appendChild(rawArea);

      // Assistant Header Bar
      const senderBar = document.createElement('div');
      senderBar.className = 'message-sender-bar';
      senderBar.innerHTML = `
        <div class="assistant-identity">
          <svg class="assistant-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
          <span class="assistant-name">Laven</span>
        </div>
        <span class="active-model-tag">${currentActiveModel || 'AI'}</span>
      `;
      bubble.appendChild(senderBar);

      // Assistant Content
      const body = document.createElement('div');
      body.className = 'message-text assistant-text md-content';
      if (msg.error || isMissing) {
        body.innerHTML = `<div class="error-banner">${escapeHtml(contentText)}</div>`;
      } else {
        const parsed = parseMarkdown(contentText);
        body.innerHTML = parsed.html;
      }
      bubble.appendChild(body);

      // Assistant Footer Bar (Tokens + Copy Entire Response)
      const footerBar = document.createElement('div');
      footerBar.className = 'message-footer';
      let tokenText = '';
      if (msg.usage && !msg.error) {
        const isEst = msg.usage.isEstimated ? 'est.' : 'rep.';
        tokenText = `⚡ ${msg.usage.totalTokens} tokens (${isEst})`;
      }
      footerBar.innerHTML = `
        <div class="footer-left">
          ${tokenText ? `<span class="token-pill">${tokenText}</span>` : ''}
        </div>
        <button class="btn-copy-response" title="Copy entire response">
          <svg class="action-icon" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
            <path d="M4 4v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V4H4zm1-1h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>
            <path d="M2 1h7a1 1 0 0 1 1 1v1H9V2H2v8h1v1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"/>
          </svg>
          <span class="copy-resp-text">Copy Response</span>
        </button>
      `;
      bubble.appendChild(footerBar);
    } else {
      // User or System message
      const sender = document.createElement('div');
      sender.className = 'message-sender';
      sender.textContent = msg.role === 'user' ? 'You' : 'System';

      const body = document.createElement('div');
      body.className = 'message-text user-text';
      body.textContent = msg.content;

      bubble.appendChild(sender);
      bubble.appendChild(body);
    }

    messagesContainer.appendChild(bubble);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Global Event Delegation for Copy, Insert, and Full Response Copy
  if (messagesContainer) {
    messagesContainer.addEventListener('click', (e) => {
      // Copy code snippet
      const btnCopyCode = e.target.closest('.btn-copy-code');
      if (btnCopyCode) {
        const codeContainer = btnCopyCode.closest('.code-block-container');
        const rawArea = codeContainer ? codeContainer.querySelector('.raw-code') : null;
        const code = rawArea ? rawArea.value : '';
        if (code) {
          copyToClipboard(code);
          btnCopyCode.classList.add('copied');
          const textSpan = btnCopyCode.querySelector('.btn-text');
          const oldText = textSpan ? textSpan.textContent : 'Copy';
          if (textSpan) textSpan.textContent = 'Copied!';
          setTimeout(() => {
            btnCopyCode.classList.remove('copied');
            if (textSpan) textSpan.textContent = oldText;
          }, 2000);
        }
        return;
      }

      // Insert code snippet at editor cursor
      const btnInsertCode = e.target.closest('.btn-insert-code');
      if (btnInsertCode) {
        const codeContainer = btnInsertCode.closest('.code-block-container');
        const rawArea = codeContainer ? codeContainer.querySelector('.raw-code') : null;
        const code = rawArea ? rawArea.value : '';
        if (code && vscode) {
          vscode.postMessage({ command: 'insertCode', text: code });
          btnInsertCode.classList.add('inserted');
          const textSpan = btnInsertCode.querySelector('.btn-text');
          const oldText = textSpan ? textSpan.textContent : 'Insert';
          if (textSpan) textSpan.textContent = 'Inserted!';
          setTimeout(() => {
            btnInsertCode.classList.remove('inserted');
            if (textSpan) textSpan.textContent = oldText;
          }, 2000);
        }
        return;
      }

      // Copy whole response
      const btnCopyResponse = e.target.closest('.btn-copy-response');
      if (btnCopyResponse) {
        const bubble = btnCopyResponse.closest('.message-bubble');
        const rawArea = bubble ? bubble.querySelector('.raw-message-content') : null;
        const text = rawArea ? rawArea.value : (bubble ? bubble.innerText : '');
        if (text) {
          copyToClipboard(text);
          btnCopyResponse.classList.add('copied');
          const textSpan = btnCopyResponse.querySelector('.copy-resp-text');
          if (textSpan) textSpan.textContent = 'Copied!';
          setTimeout(() => {
            btnCopyResponse.classList.remove('copied');
            if (textSpan) textSpan.textContent = 'Copy Response';
          }, 2000);
        }
        return;
      }
    });
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
          <p>Add an AI provider to start using Laven.</p>
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
    freellmapi: [],
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
    const isFreeLLMAPI = providerId === 'freellmapi';
    const isCloudflare = providerId === 'cloudflare';
    const isNvidia = providerId === 'nvidia';
    modalGroupKey.style.display = isOllama ? 'none' : 'flex';
    modalGroupEndpoint.style.display = (isOllama || isFreeLLMAPI || isCloudflare || isNvidia) ? 'flex' : 'none';

    if (modalEndpointLabel) {
      if (isCloudflare) modalEndpointLabel.textContent = 'Cloudflare Account ID (Optional)';
      else if (isNvidia) modalEndpointLabel.textContent = 'NVIDIA NIM Base URL (Optional)';
      else if (isFreeLLMAPI) modalEndpointLabel.textContent = 'FreeLLMAPI Base URL';
      else modalEndpointLabel.textContent = 'Ollama Server Endpoint';
    }
    if (modalEndpointHint) {
      if (isCloudflare) modalEndpointHint.textContent = 'Enter your 32-char Account ID or custom gateway URL.';
      else if (isNvidia) modalEndpointHint.textContent = 'Default: https://integrate.api.nvidia.com/v1';
      else if (isFreeLLMAPI) modalEndpointHint.textContent = 'Default local router endpoint: http://127.0.0.1:31415/v1';
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
      } else if (isFreeLLMAPI) {
        modalEndpointInput.placeholder = 'http://127.0.0.1:31415/v1';
        modalEndpointInput.value = providerInfo.endpoint || 'http://127.0.0.1:31415/v1';
      }
    }

    if (modalPrioritySelect) {
      modalPrioritySelect.value = String(providerInfo.priority || 1);
    }
    if (modalSelectionMode) {
      modalSelectionMode.value = providerInfo.selectionMode || 'manual';
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
    const selectionMode = modalSelectionMode ? modalSelectionMode.value : 'manual';

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

      const endpointVal = ((modalTargetProvider === 'cloudflare' || modalTargetProvider === 'nvidia' || modalTargetProvider === 'freellmapi') && modalEndpointInput)
        ? (modalEndpointInput.value.trim() || undefined)
        : undefined;

      showModalAlert(`Testing connection for ${modalTargetProvider.toUpperCase()}...`, 'info');

      if (vscode) {
        vscode.postMessage({
          command: 'saveAndTestConnection',
          provider: modalTargetProvider,
          apiKey: key || undefined,
          endpoint: endpointVal,
          priority: priorityVal,
          selectionMode
        });
      }
    }
  }

  function handleSelectThisModel() {
    if (!modalTargetProvider) return;

    const providerInfo = cachedProvidersList.find(p => p.id === modalTargetProvider);
    let selectedModel = modalModelSelect ? modalModelSelect.value : null;
    const priorityVal = modalPrioritySelect ? Number(modalPrioritySelect.value) : 1;
    const selectionMode = modalSelectionMode ? modalSelectionMode.value : 'manual';

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
          selectionMode,
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

      const endpointVal = ((modalTargetProvider === 'cloudflare' || modalTargetProvider === 'nvidia' || modalTargetProvider === 'freellmapi') && modalEndpointInput)
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
            selectionMode,
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
      const endpointVal = ((modalTargetProvider === 'cloudflare' || modalTargetProvider === 'nvidia' || modalTargetProvider === 'ollama' || modalTargetProvider === 'freellmapi') && modalEndpointInput)
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
    if (data.providerUsageMessage) {
      dashTokenType.textContent = data.providerUsageMessage;
    } else if (data.providerUsage) {
      const requests = data.providerUsage.requests;
      const tokensUsed = data.providerUsage.tokens;
      dashTokenType.textContent =
        Number.isFinite(requests) || Number.isFinite(tokensUsed)
          ? `FreeLLMAPI usage: ${Number.isFinite(requests) ? `${requests} requests` : 'requests unavailable'}; ${Number.isFinite(tokensUsed) ? `${tokensUsed} tokens` : 'tokens unavailable'}`
          : 'FreeLLMAPI provider usage available.';
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
        const streamingBubble = messagesContainer.querySelector('.message-bubble.assistant.streaming');
        if (streamingBubble) streamingBubble.remove();
        appendMessage(msg.message);
        break;

      case 'messageDelta': {
        hideTyping();
        let bubble = messagesContainer.querySelector('.message-bubble.assistant.streaming');
        if (!bubble) {
          bubble = document.createElement('div');
          bubble.className = 'message-bubble assistant streaming';
          bubble.innerHTML = `
            <textarea class="raw-message-content" style="display:none;"></textarea>
            <div class="message-sender-bar">
              <div class="assistant-identity">
                <svg class="assistant-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
                <span class="assistant-name">Laven</span>
                <span class="streaming-dot"></span>
              </div>
              <span class="active-model-tag">${currentActiveModel || 'AI'}</span>
            </div>
            <div class="message-text assistant-text md-content"></div>
          `;
          messagesContainer.appendChild(bubble);
        }
        const rawArea = bubble.querySelector('.raw-message-content');
        if (rawArea) rawArea.value = msg.message.content;
        const parsed = parseMarkdown(msg.message.content);
        const body = bubble.querySelector('.message-text');
        if (body) body.innerHTML = parsed.html;
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        break;
      }

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