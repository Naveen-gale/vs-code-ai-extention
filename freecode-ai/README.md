# Laven — 100% Free Multi-Provider AI Coding Assistant for VS Code

[![Visual Studio Marketplace](https://img.shields.io/badge/VS%20Code-Extension-blue.svg)](https://marketplace.visualstudio.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests: 92 Passed](https://img.shields.io/badge/Tests-92%20Passed-brightgreen.svg)]()
[![Providers: 11 Supported](https://img.shields.io/badge/AI%20Providers-11%20Supported-purple.svg)]()

> **The open, privacy-first, zero-subscription AI coding assistant for Visual Studio Code.**  
> *Copilot-like inline ghost text, multi-provider AI chat, autonomous agent fixes, native status bar manager, and 100% offline local models with Ollama.*

For complete, detailed, point-by-point architecture and website blueprints, please refer to [PROJECT_DOCUMENTATION.md](../PROJECT_DOCUMENTATION.md).

---

## Key Features

- **Inline Ghost Text Suggestions:** Sub-second AI completions right at your cursor position as you type.
- **11 AI Providers Out-of-the-Box:** Google Gemini, Groq, OpenRouter, Ollama, Cohere, Cloudflare Workers AI, Mistral AI, NVIDIA NIM, DeepSeek, Hugging Face, and OpenAI.
- **100% Offline with Ollama:** Run local coding models (`qwen2.5-coder`, `deepseek-coder`, `llama3.2`) with zero telemetry, zero latency, and zero token costs.
- **Bottom Status Bar Manager:** Native VS Code status bar item showing active provider, model, inline toggle, and honest RPM/token metrics.
- **Direct In-Memory Connection (0ms Local Overhead):** Providers and keys are held in memory for sub-millisecond autocomplete dispatch without disk or IPC lag.
- **Smart Rate-Limit Shield:** Sliding-window velocity tracking (RPM/TPM), pre-emptive 92% circuit breaker, and one-click provider switching when limits hit.
- **0ms Predictive Typing Cache:** In-memory suggestion slicing that serves matching keystrokes instantly without network requests.
- **Enterprise-Grade OS Keychain Security:** All credentials are encrypted in native VS Code `SecretStorage` (`WinCred`, `Keychain`, `SecretService`).

---

## Supported AI Providers

| Provider | Flagship Models | Tier / Cost | Rate Limit |
| :--- | :--- | :--- | :--- |
| **Google Gemini** | `gemini-1.5-flash`, `gemini-1.5-pro` | Free Tier & Paid | 15 RPM / 1M TPM |
| **Groq** | `llama-3.3-70b-versatile`, `8b-instant` | Free Tier & Ultra-Fast | 30 RPM / 6,000 TPM |
| **OpenRouter** | 100+ Models (`:free` and paid) | Free & BYOK | 20 RPM |
| **Ollama (Local)** | `qwen2.5-coder`, `deepseek-coder` | **100% Free (Offline)** | **Unlimited** |
| **Cohere** | `command-r-plus`, `command-r` | Free Trial & Metered | 10 RPM |
| **Cloudflare Workers AI** | `llama-3-8b-instruct`, `deepseek-r1` | 10,000 Daily Neurons | **1,200 RPM** |
| **Mistral AI** | `codestral-latest`, `mistral-large` | Metered Pay-per-use | 10 RPM |
| **NVIDIA NIM** | `llama-3.1-70b-instruct`, `deepseek-r1`| 1,000 Free Credits | 20 RPM |
| **DeepSeek** | `deepseek-chat`, `deepseek-reasoner` | Ultra-Low Cost API | 60 RPM |
| **Hugging Face** | `Qwen2.5-Coder-32B`, `starcoder2` | Serverless Free Tier | 15 RPM |
| **OpenAI** | `gpt-4o`, `gpt-4o-mini`, `o1-mini` | Standard Tier | 60 RPM |

---

## Keyboard Shortcuts

| Shortcut | Command | Action |
| :--- | :--- | :--- |
| `Alt + /` or `Alt + \` | `freecodeAI.triggerInline` | Trigger inline suggestion manually at cursor |
| `Ctrl + Alt + A` | `freecodeAI.openSidebar` | Open and focus Laven Sidebar Chat |
| `Tab` | Native VS Code | Accept inline ghost text completion |
| `Esc` | Native VS Code | Dismiss inline ghost text completion |
| Status Bar Click | `freecodeAI.openProviderPopup` | Open provider switcher & usage manager |

---

## Extension Settings

Customizable via VS Code Settings (`Ctrl + ,` search `freecodeAI`):

- `freecodeAI.inline.enabled`: Enable or disable inline ghost text completions (Default: `true`).
- `freecodeAI.inline.debounceDelay`: Delay in ms before requesting inline suggestion (Default: `75`).
- `freecodeAI.inline.maxContextLines`: Maximum nearby context lines sent to the LLM (Default: `40`).
- `freecodeAI.inline.maxCompletionTokens`: Maximum output tokens generated (Default: `64`).
- `freecodeAI.inline.cacheEnabled`: Enable in-memory LRU and predictive typing cache (Default: `true`).
- `freecodeAI.inline.useActiveProvider`: Automatically use the active provider and model (Default: `true`).

---

## Verification & Tests

Run the full automated test suite (92 tests covering all 11 providers, inline completions, and rate limit shield):
```bash
npm test
```

---

## License

MIT License — see [LICENSE](./LICENSE) for details.
