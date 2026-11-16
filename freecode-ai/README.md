# 🤖 Laven (FreeCode AI)

> **The Privacy-First, Multi-LLM Autonomous Coding Assistant for Visual Studio Code.**  
> Completely open-source, written in pure CommonJS JavaScript with zero TypeScript bloat, supporting 11 AI providers, local-first offline inference with Ollama, intelligent API quota reduction, debounced ghost-text code autocomplete, and encrypted credential storage.

---

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.85.0%2B-blue.svg)](https://code.visualstudio.com/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![JavaScript](https://img.shields.io/badge/Language-CommonJS%20JavaScript-F7DF1E.svg)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Tests Passing](https://img.shields.io/badge/Tests-100%2B%20Passing-brightgreen.svg)]()
[![Providers](https://img.shields.io/badge/AI%20Providers-11%20Supported-purple.svg)]()

---

## 📑 Table of Contents

- [Overview](#-overview)
- [Why Laven?](#-why-laven)
- [Key Features](#-key-features)
  - [1. 11 Supported AI Providers](#1-11-supported-ai-providers)
  - [2. Smart API Quota Manager & Token Saver](#2-smart-api-quota-manager--token-saver)
  - [3. Intelligent Inline Code Autocomplete (Ghost Text)](#3-intelligent-inline-code-autocomplete-ghost-text)
  - [4. Encrypted SecretStorage & Key Protection](#4-encrypted-secretstorage--key-protection)
  - [5. Status Bar Control Center & QuickPick Menu](#5-status-bar-control-center--quickpick-menu)
  - [6. Interactive Chat & Code Diagnostics](#6-interactive-chat--code-diagnostics)
- [System Architecture](#-system-architecture)
  - [High-Level Data Flow](#high-level-data-flow)
  - [Directory Structure](#directory-structure)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation & Setup](#installation--setup)
  - [Configuring API Keys](#configuring-api-keys)
- [How to Use](#-how-to-use)
  - [Ghost-Text Autocomplete](#ghost-text-autocomplete)
  - [Switching Completion Strategies](#switching-completion-strategies)
  - [Opening the Status Bar QuickPick](#opening-the-status-bar-quickpick)
  - [Interactive AI Chat](#interactive-ai-chat)
  - [Code Diagnostics & Error Explanations](#code-diagnostics--error-explanations)
- [Configuration Reference](#-configuration-reference)
- [Developer & Contributor Guide](#-developer--contributor-guide)
  - [Running the Extension Locally (F5 Debugging)](#running-the-extension-locally-f5-debugging)
  - [Running Automated Tests](#running-automated-tests)
  - [Packaging the Extension (.vsix)](#packaging-the-extension-vsix)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🌟 Overview

**Laven** (internally published as `freecode-ai`) is an open-source, privacy-conscious AI coding extension for Visual Studio Code. Unlike proprietary extensions that lock you into a single closed ecosystem or silently leak code context to external servers, Laven gives you **100% ownership and control** over your AI development workflow.

With Laven, you can use local models through **Ollama** completely offline, tap into free cloud inference tiers (such as Google Gemini, Groq, NVIDIA NIM, and Cloudflare Workers AI), or connect premium models (such as OpenAI, Mistral, and DeepSeek) — all through a single, unified interface.

---

## 💡 Why Laven?

Most AI coding assistants suffer from three critical problems:
1. **API Rate-Limit Burnout**: Sending requests on every single keystroke triggers HTTP 429 errors within minutes.
2. **Vendor Lock-in & Privacy Loss**: Your proprietary code is sent to closed cloud endpoints without local fallback or secret sanitization.
3. **Flaky Credential Management**: Extensions frequently lose, overwrite, or expose API keys during restarts or provider switches.

**Laven solves all three:**
- **Reduces token consumption by 80–90%** through aggressive 1200ms debouncing, in-memory LRU suggestion caching, single-request concurrency locks, and bounded context windows.
- **Local-First & Offline Capable**: Zero cloud network packets leave your machine when using Local-Only mode.
- **Encrypted Secret Storage**: API keys are securely persisted in VS Code's operating-system-level keychain (`SecretStorage`) across multiple namespaces, never deleted unless explicitly requested.

---

## 🚀 Key Features

### 1. 11 Supported AI Providers

Laven includes custom, lightweight HTTP adapters for 11 AI providers with automatic model discovery and free/paid tier indicators:

| Provider | Type | Default Model | Free Tier Available? |
| :--- | :--- | :--- | :---: |
| **Ollama** | Local / Offline | `qwen2.5-coder:1.5b` / `codellama` | ✅ Yes (100% Local) |
| **Google Gemini** | Cloud API | `gemini-1.5-flash` | ✅ Yes (Generous Free Quota) |
| **Groq** | Cloud Ultra-Fast | `llama-3.3-70b-versatile` | ✅ Yes (Free Tier) |
| **NVIDIA NIM** | Cloud API | `meta/llama-3.1-8b-instruct` | ✅ Yes (Free Cloud Credits) |
| **Cloudflare Workers AI** | Cloud Serverless | `@cf/meta/llama-3.1-8b-instruct` | ✅ Yes (Free Daily Quota) |
| **Cohere** | Cloud API | `command-r` | ✅ Yes (Trial Keys) |
| **Hugging Face** | Cloud Inference | `meta-llama/Llama-3.2-3B-Instruct`| ✅ Yes (Free Community API) |
| **OpenRouter** | Multi-Model Gateway | `meta-llama/llama-3.2-3b-instruct:free` | ✅ Yes (Free Models Included) |
| **Mistral AI** | Cloud API | `mistral-small-latest` | 💳 Paid |
| **DeepSeek** | Cloud API | `deepseek-chat` | 💳 Paid |
| **OpenAI** | Cloud API | `gpt-4o-mini` | 💳 Paid |

### 2. Smart API Quota Manager & Token Saver

The **Smart Quota Manager** (`src/quota/smartQuotaManager.js`) enforces intelligent request routing and circuit breaking to prevent API exhaustion:

- **Three Completion Strategies**:
  - `hybrid` *(Recommended Default)*: First attempts inline generation using local Ollama. If Ollama is offline or times out, it seamlessly falls back to eligible cloud providers in user priority order.
  - `local`: Pure local inference via Ollama. **Zero cloud network calls are ever made.**
  - `cloud`: Bypasses local models and strictly routes through your configured cloud providers in priority order.
- **Real-Time Sliding-Window Velocity Tracking**:
  - Tracks Requests Per Minute (RPM) and Tokens Per Minute (TPM).
  - Automatically trips circuit breakers (`CLOSED` → `OPEN` → `HALF_OPEN`) when rate limits approach danger thresholds.
- **RFC-Compliant Cooldown Extraction**:
  - Intercepts HTTP 429 status codes, extracts `Retry-After` headers, and automatically cools down the failing provider without blocking the user.
- **Daily Budget Protections**:
  - Built-in configurable ceiling (default: 500 requests/day, 200,000 tokens/day) prevents accidental wallet draining.

### 3. Intelligent Inline Code Autocomplete (Ghost Text)

Laven's inline autocomplete engine (`src/autocomplete/inlineProvider.js`) provides GitHub Copilot-style ghost text completions right in your editor:

- **1200ms Adaptive Debounce**: Suspends API requests while you are actively typing. Only dispatches an inference request when you pause, cutting keystroke API spam by over 90%.
- **Single-Request Document Concurrency**: Uses `AbortController` to immediately abort any pending in-flight request when a new character is typed.
- **In-Memory LRU Suggestion Cache**: Caches responses with a 60-second TTL. Typing back and forth over familiar lines yields instant sub-millisecond suggestions with 0 network calls and tracks saved tokens.
- **Context Window Limiter & Secret Redaction**: Gathers a maximum of 1,500 bounded tokens (prefix + suffix) and redacts sensitive environment variables, `.env` patterns, and API keys before dispatching.
- **Code Fence & Overlap Sanitizer**: Strips markdown backticks, conversational chat intros (`"Here is the code..."`), and leading/trailing line overlaps.

### 4. Encrypted SecretStorage & Key Protection

- API credentials are encrypted and stored via VS Code's native `context.secrets` API (`src/security/secretManager.js`).
- Backward compatible with legacy and modern namespace prefixes: `freecode-ai.apiKey.*`, `freecodeAI.apiKey.*`, and `laven.apiKey.*`.
- **Key Safety Guarantee**: API keys are **never** cleared or overwritten when accepting/rejecting suggestions, switching providers, changing models, encountering HTTP 429 errors, or reloading VS Code.

### 5. Status Bar Control Center & QuickPick Menu

- **Native Status Bar**: Displays current mode, provider, and active model:
  `$(sparkle) Laven [Hybrid]: ollama (qwen2.5-coder:1.5b)`
- **Rich Honest Markdown Tooltip**: Hovering over the status bar reveals real-time metrics:
  - Active completion strategy (`hybrid`, `local`, `cloud`).
  - Request velocity (current RPM / TPM).
  - Cooldown states and circuit breaker health.
  - Cache hit ratio and total tokens saved.
- **Interactive QuickPick Menu** (Click the status bar or run `Laven: Open Provider Menu`):
  - 🔄 Switch Completion Strategy (Hybrid / Local Only / Cloud Only).
  - ⚡ Select Active AI Provider.
  - 🧹 Clear Suggestion Cache.
  - ⏳ Reset Rate Limit Cooldowns.
  - ⚙️ Configure API Keys.

### 6. Interactive Chat & Code Diagnostics

- **Webview Chat Sidebar**: Interactive natural language assistant for asking code questions, explaining algorithms, and generating new files.
- **Inline Error Explanations**: Diagnostic manager that detects compiler errors and linter warnings, offering one-click AI explanations and targeted code patches.

---

## 🏗️ System Architecture

### High-Level Data Flow

```
   ┌─────────────────────────────────────────────────────────────┐
   │                   VS Code Editor / User                     │
   └───────────────┬─────────────────────────────▲───────────────┘
                   │                             │
    [Typing / FIM] │ (1200ms Debounce)           │ Ghost Text Suggestion
                   ▼                             │
   ┌───────────────────────────────┐             │
   │  InlineCompletionProvider     │             │
   │  - AbortController Lock       │             │
   │  - Secret Redactor            │             │
   │  - LRU Cache (60s TTL)        │─────────────┘ (Cache Hit -> 0 Network Calls)
   └───────────────┬───────────────┘
                   │ Cache Miss
                   ▼
   ┌───────────────────────────────┐
   │     Smart Quota Manager       │
   │  - Strategy Router            │
   │  - Sliding Window RPM/TPM     │
   │  - Circuit Breakers           │
   └───────┬───────────────┬───────┘
           │               │
  [Hybrid / Local]         │ [Cloud Fallback / Priority]
           ▼               ▼
   ┌───────────────┐ ┌───────────────────────────────────────────┐
   │ Local Ollama  │ │        Cloud AI Provider Adapters         │
   │ (Offline FIM) │ │ Gemini | Groq | NVIDIA | Cloudflare | etc │
   └───────────────┘ └─────────────────────┬─────────────────────┘
                                           │
                                           ▼
                             ┌───────────────────────────┐
                             │    VS Code SecretStorage  │
                             │ (OS Encrypted API Keys)   │
                             └───────────────────────────┘
```

### Directory Structure

```text
vs-code-ai-extention/
├── freecode-ai/                    # Extension root directory
│   ├── media/                      # Icons, styling, and webview assets
│   │   ├── icon.svg
│   │   └── styles.css
│   ├── src/                        # 100% Pure CommonJS JavaScript Source
│   │   ├── agent/                  # Multi-step tool & planner foundations
│   │   ├── autocomplete/           # Ghost-text autocomplete engine
│   │   │   ├── cacheManager.js     # In-memory LRU cache with TTL
│   │   │   ├── contextCollector.js # Context window bounding & secret redaction
│   │   │   ├── inlineProvider.js   # Debounced inline completion provider
│   │   │   ├── promptBuilder.js    # FIM and chat prompt formatters
│   │   │   └── suggestionParser.js # Markdown fence & line overlap trimmer
│   │   ├── chat/                   # Sidebar conversation & prompt controllers
│   │   ├── config/                 # Default models, registry & settings
│   │   ├── diagnostics/            # Linter & error explanation generator
│   │   ├── providers/              # 11 Custom HTTP Provider Adapters
│   │   │   ├── cloudflareProvider.js
│   │   │   ├── cohereProvider.js
│   │   │   ├── deepseekProvider.js
│   │   │   ├── geminiProvider.js
│   │   │   ├── groqProvider.js
│   │   │   ├── huggingfaceProvider.js
│   │   │   ├── mistralProvider.js
│   │   │   ├── modelDiscovery.js   # Live remote model fetcher
│   │   │   ├── nvidiaProvider.js
│   │   │   ├── ollamaProvider.js   # Local offline runner
│   │   │   ├── openaiProvider.js
│   │   │   ├── openrouterProvider.js
│   │   │   ├── providerFactory.js
│   │   │   └── providerManager.js
│   │   ├── quota/                  # API Quota Optimization Engine
│   │   │   └── smartQuotaManager.js# Hybrid strategy & circuit breaker
│   │   ├── router/                 # Fallback routing & error classification
│   │   │   ├── cooldownManager.js
│   │   │   ├── errorClassifier.js
│   │   │   ├── fallbackManager.js
│   │   │   └── modelRouter.js
│   │   ├── security/               # SecretStorage & API key encryption
│   │   │   └── secretManager.js
│   │   ├── statusbar/              # Native VS Code status bar & quick pick
│   │   │   ├── providerQuickPick.js
│   │   │   ├── statusBarManager.js
│   │   │   └── usageDisplay.js
│   │   ├── ui/                     # Webview providers & HTML UI
│   │   ├── usage/                  # Velocity limit tracking & metrics
│   │   │   ├── limitTracker.js
│   │   │   ├── usageStorage.js
│   │   │   └── usageTracker.js
│   │   ├── utils/                  # HTTP client, logger & file utils
│   │   └── extension.js            # Main VS Code extension entry point
│   ├── test/                       # Comprehensive Automated Test Suites
│   │   ├── autocomplete.test.js
│   │   ├── day1.test.js
│   │   ├── day2Ui.test.js
│   │   ├── diagnostics.test.js
│   │   ├── multiProvider.test.js
│   │   ├── newProviders.test.js
│   │   ├── providers.test.js
│   │   ├── quotaAndInline.test.js  # 30 Quota, cache & inline tests
│   │   ├── router.test.js
│   │   └── upgrade.test.js
│   ├── package.json                # Extension manifest & configuration specs
│   └── README.md
├── CONTRIBUTING.md                 # Contributor guidelines
└── README.md                       # Master repository documentation
```

---

## 🛠️ Getting Started

### Prerequisites

- [Visual Studio Code](https://code.visualstudio.com/) version `1.85.0` or higher.
- [Node.js](https://nodejs.org/) version `18.0.0` or higher.
- *(Optional for offline mode)* [Ollama](https://ollama.ai/) installed and running locally.

### Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Naveen-gale/vs-code-ai-extention.git
   cd vs-code-ai-extention/freecode-ai
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Verify the installation by running the test suite:**
   ```bash
   npm test
   ```
   All test suites should pass with 100% success.

### Configuring API Keys

You can add API keys through either the VS Code Command Palette or the Status Bar:

1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS).
2. Type `FreeCode AI: Set Provider API Key` and select the provider (e.g. Gemini, Groq, NVIDIA, OpenAI).
3. Paste your API key. It will be encrypted immediately into VS Code's `SecretStorage`.

*To use Local Ollama:*  
Simply install Ollama, pull your preferred coding model (e.g. `ollama pull qwen2.5-coder:1.5b`), and start the Ollama server (`ollama serve`). Laven connects to `http://127.0.0.1:11434` automatically with no API keys required!

---

## 📖 How to Use

### Ghost-Text Autocomplete

As you edit code in any language file:
- Simply type normally. When you pause for **1200ms**, Laven analyzes the surrounding context (prefix and suffix) and renders gray ghost text ahead of your cursor.
- Press **`Tab`** to accept the suggestion.
- Press **`Esc`** or continue typing to reject the suggestion.

### Switching Completion Strategies

Click the **Laven status bar item** at the bottom-right of VS Code, or run `Laven: Switch Completion Mode` from the command palette:
- **`hybrid`**: Uses local Ollama first; automatically falls back to cloud providers if Ollama is unreachable.
- **`local`**: Offline-only; never touches the internet.
- **`cloud`**: Uses your configured cloud providers according to your manual priority settings.

### Opening the Status Bar QuickPick

Click `$(sparkle) Laven [Hybrid]...` in the bottom status bar to open the quick action menu:
- Select and activate any of the 11 AI providers.
- Toggle inline completions on or off.
- Clear the in-memory suggestion cache.
- Reset rate-limit cooldown timers.

### Interactive AI Chat

1. Click the **FreeCode AI / Laven icon** in the VS Code Activity Bar (left sidebar).
2. Ask any programming question, request refactoring, or ask the AI to write unit tests.
3. Switch models on the fly using the provider dropdown at the top of the chat panel.

### Code Diagnostics & Error Explanations

Whenever your editor highlights a syntax or runtime error:
- Hover over the error and click **Explain with Laven**, or trigger diagnostics from the command palette.
- Laven analyzes the compiler diagnostic and generates a targeted explanation and fix.

---

## ⚙️ Configuration Reference

All settings can be configured via VS Code `settings.json` or through the Settings UI under `Extensions -> Laven`:

| Setting | Type | Default | Description |
| :--- | :---: | :---: | :--- |
| `laven.inline.enabled` | `boolean` | `true` | Enable or disable intelligent inline code completions. |
| `laven.inline.completionMode` | `string` | `"hybrid"` | Completion strategy: `"hybrid"`, `"local"`, or `"cloud"`. |
| `laven.inline.localFirst` | `boolean` | `true` | Prefer local Ollama inference before cloud provider quotas. |
| `laven.inline.localOnly` | `boolean` | `false` | Enforce local-only inference; zero requests sent to cloud. |
| `laven.inline.cloudFallbackEnabled` | `boolean` | `true` | Allow falling back to cloud providers when Ollama is offline. |
| `laven.inline.debounceMs` | `number` | `1200` | Keystroke pause duration (ms) before sending inline requests. |
| `laven.inline.maxInputTokens` | `number` | `1500` | Bounded token limit for context window to save quota. |
| `laven.inline.maxOutputTokens` | `number` | `96` | Maximum generated tokens for inline suggestions. |
| `laven.inline.cacheEnabled` | `boolean` | `true` | Enable in-memory LRU suggestion caching. |
| `laven.inline.cacheTtlMs` | `number` | `60000` | Cache time-to-live in milliseconds (default: 60 seconds). |
| `laven.inline.maxRequestsPerMinute` | `number` | `30` | Safety rate-limit protection ceiling for requests per minute. |
| `laven.inline.dailyRequestBudget` | `number` | `500` | Local daily request budget limit. |
| `laven.inline.maxEstimatedTokensPerDay`| `number` | `200000` | Local daily estimated token ceiling. |
| `laven.providers.cooldownEnabled` | `boolean` | `true` | Enforce automatic cooldown periods on HTTP 429 rate limits. |

---

## 💻 Developer & Contributor Guide

We welcome contributions from open-source developers worldwide!

### Running the Extension Locally (F5 Debugging)

1. Open the project folder in VS Code:
   ```bash
   code .
   ```
2. Navigate to the Run & Debug view (`Ctrl+Shift+D` or `Cmd+Shift+D`).
3. Select **"Launch FreeCode AI Extension"** from the debug dropdown.
4. Press **`F5`**. A new **Extension Development Host** window will open with Laven active and loaded from your local source code.
5. Set breakpoints anywhere in `src/` to step through execution.

### Running Automated Tests

Laven features a comprehensive test suite covering all modules, providers, SecretStorage encryption, cache eviction, and quota limits:

```bash
cd freecode-ai
npm test
```

The test runner will sequentially execute:
1. `day1.test.js`: Core extension activation, sidebar registration, commands.
2. `upgrade.test.js`: SecretManager, ModelRegistry, LimitTracker, UsageTracker.
3. `multiProvider.test.js`: Independent provider key isolation & switching.
4. `day2Ui.test.js`: Webview UI, rate-limit reset, and modal events.
5. `newProviders.test.js`: 11 provider adapters, live discovery, NVIDIA NIM, DeepSeek, Cloudflare.
6. `autocomplete.test.js`: FIM formatting, overlap parsing, and token budgeting.
7. `quotaAndInline.test.js`: 30 quota manager, hybrid routing, cache, and SecretStorage survival tests.

### Packaging the Extension (.vsix)

To package Laven into an installable `.vsix` file:
```bash
cd freecode-ai
npx @vscode/vsce package
```
This produces a `laven-0.1.0.vsix` file which can be installed in any VS Code instance via `Extensions: Install from VSIX...`.

---

## 🤝 Contributing

Please see our [CONTRIBUTING.md](CONTRIBUTING.md) guide for full details on:
- Architecture contracts and coding conventions (**Pure CommonJS JavaScript only; no TypeScript**).
- Step-by-step instructions for adding a new AI provider adapter.
- Pull request submission workflow.

---

## 📄 License

This project is licensed under the [MIT License](freecode-ai/LICENSE) — see the LICENSE file for details.
