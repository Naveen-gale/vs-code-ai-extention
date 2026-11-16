# 🤝 Contributing to Laven (FreeCode AI)

Thank you for your interest in contributing to **Laven**! We are committed to building an open, privacy-preserving, and quota-efficient AI coding assistant for all developers.

Whether you're fixing a bug, adding a new AI provider adapter, improving suggestion caching, or enhancing documentation, your help is warmly welcomed.

---

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Architectural Principles](#architectural-principles)
- [Development Setup](#development-setup)
- [How to Add a New AI Provider Adapter](#how-to-add-a-new-ai-provider-adapter)
- [Testing Standards](#testing-standards)
- [Git Workflow & Pull Requests](#git-workflow--pull-requests)
- [Security & API Key Guidelines](#security--api-key-guidelines)

---

## 📜 Code of Conduct

- Be respectful, constructive, and collaborative.
- Provide clear context, reproducible examples, and honest descriptions with your issues and pull requests.
- Prioritize user privacy: never commit personal API keys or log user workspace code.

---

## 🏛️ Architectural Principles

Before writing code, please keep these core guidelines in mind:

1. **JavaScript Only (Strictly No TypeScript)**:
   - The entire codebase is written in pure CommonJS JavaScript (`require()` and `module.exports`).
   - Do not add TypeScript compiler pipelines, `.ts` files, or Babel transpilers. Keeping it in vanilla JavaScript keeps the extension lightweight, instantly debuggable, and free of complex build chains.
2. **Local-First & Offline Privacy**:
   - Never send network requests when `localOnly` mode is active.
   - Always sanitize context (strip API keys and secrets) before dispatching prompts to remote cloud endpoints.
3. **Encrypted Secret Storage**:
   - Never store raw API keys in VS Code configuration (`workspace.getConfiguration`) or plaintext files.
   - Always use `SecretManager` (`context.secrets`).
4. **Quota Efficiency & Low Latency**:
   - Respect the 1200ms debouncing window and in-memory LRU caching.
   - Respect user provider priority and honor HTTP 429 `Retry-After` cooldown periods.

---

## 🛠️ Development Setup

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/<your-username>/vs-code-ai-extention.git
   cd vs-code-ai-extention/freecode-ai
   ```

2. **Install development dependencies:**
   ```bash
   npm install
   ```

3. **Open the project in VS Code:**
   ```bash
   code .
   ```

4. **Launch the Extension in Debug Mode:**
   - Press **`F5`** to launch a new **Extension Development Host** window.
   - Test your changes interactively in the newly spawned window.

---

## 🔌 How to Add a New AI Provider Adapter

Adding a new AI provider to Laven requires only four clean steps:

### Step 1: Create the Provider Adapter
Create a new file in `freecode-ai/src/providers/<providerName>Provider.js`. It must implement `complete()`, `models()`, and `validateKey()` methods:

```javascript
// src/providers/myProvider.js
const { postJson } = require('../utils/httpClient');

class MyProvider {
  constructor(apiKey, config = {}) {
    this.name = 'myprovider';
    this.displayName = 'My Provider';
    this.apiKey = apiKey;
    this.config = config;
  }

  async complete(prompt, options = {}) {
    const model = options.model || 'default-model';
    const response = await postJson('https://api.myprovider.com/v1/completions', {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: {
        model,
        prompt,
        max_tokens: options.maxTokens || 128,
        temperature: options.temperature || 0.2
      },
      signal: options.signal
    });

    return {
      text: response.data.choices[0].text,
      model,
      usage: response.data.usage
    };
  }

  async models() {
    return ['model-alpha', 'model-beta'];
  }
}

module.exports = MyProvider;
```

### Step 2: Register in `providerFactory.js`
In `src/providers/providerFactory.js`, import your adapter and add it to the instantiation switch:

```javascript
const MyProvider = require('./myProvider');

// Inside createProvider(providerName, apiKey, config):
case 'myprovider':
  return new MyProvider(apiKey, config);
```

### Step 3: Add to `modelRegistry.js`
In `src/config/modelRegistry.js`, add your provider's metadata and indicate if it provides free or paid tiers:

```javascript
myprovider: {
  name: 'My Provider',
  freeTier: true,
  defaultModel: 'model-alpha',
  models: [
    { id: 'model-alpha', label: 'Model Alpha (Free)' },
    { id: 'model-beta', label: 'Model Beta (Paid)' }
  ]
}
```

### Step 4: Write Unit Tests
Add test cases in `test/newProviders.test.js` or create a new test file in `test/` to verify instantiation, model listing, and mock completion handling.

---

## 🧪 Testing Standards

All code contributions **must pass 100% of the test suite** before being merged.

Run the test suite locally:
```bash
cd freecode-ai
npm test
```

### Writing Tests
- All tests are written in pure Node.js using the built-in `assert` module.
- Mock VS Code APIs and network calls to ensure tests run fast and offline without external network dependencies.
- Ensure any new features have corresponding positive and negative test cases.

---

## 🌿 Git Workflow & Pull Requests

1. **Create a topic branch from `main`:**
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feat/add-my-awesome-feature
   ```

2. **Commit your changes with clear, descriptive commit messages:**
   ```bash
   git commit -m "feat(providers): add adapter for Anthropic Claude"
   ```

3. **Verify the entire test suite passes:**
   ```bash
   npm test
   ```

4. **Push your branch to your fork:**
   ```bash
   git push origin feat/add-my-awesome-feature
   ```

5. **Open a Pull Request:**
   - Target the `main` branch.
   - Describe what changed and include screenshots or test outputs.
   - Confirm that all existing tests pass and no new warnings are introduced.

---

## 🔒 Security & API Key Guidelines

- **Never commit `.env` files, actual API keys, or personal tokens.**
- Any PR that leaks or logs real API credentials will be rejected immediately.
- Secret keys must always be handled through `SecretManager` and masked in any UI or log representation (`sk-...1234`).

---

Thank you for helping make Laven the best open-source AI coding assistant! 🚀
