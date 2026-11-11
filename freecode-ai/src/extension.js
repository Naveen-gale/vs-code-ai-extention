const vscode = require("vscode");
const { FreeCodeSidebarProvider } = require("./ui/sidebarProvider");
const { SecretManager } = require("./security/secretManager");
const { UsageTracker } = require("./usage/usageTracker");
const { ChatController } = require("./chat/chatController");
const { ProviderManager } = require("./providers/providerManager");
const { PROVIDERS, PROVIDER_METADATA } = require("./config/providers");

/**
 * Activates the FreeCode AI extension.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log("FreeCode AI: Activation starting...");

    try {
        // Initialize core services
        const secretManager = new SecretManager(context.secrets);
        const usageTracker = new UsageTracker(context.globalState);
        const providerManager = new ProviderManager(context, secretManager);

        const activeProvider = providerManager.getActiveProvider();
        const chatController = new ChatController({
            secretManager,
            usageTracker,
            providerManager,
            initialProvider: activeProvider || null
        });

        // Initialize and register the Sidebar Webview View Provider
        const sidebarProvider = new FreeCodeSidebarProvider(context.extensionUri, {
            chatController,
            secretManager,
            usageTracker,
            providerManager
        });

        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(
                "freecodeAI.sidebar",
                sidebarProvider
            )
        );
        console.log("FreeCode AI: Sidebar view provider registered (freecodeAI.sidebar).");

        // Command: Open Sidebar
        context.subscriptions.push(
            vscode.commands.registerCommand(
                "freecodeAI.openSidebar",
                async () => {
                    try {
                        await vscode.commands.executeCommand("workbench.view.extension.freecodeAI");
                    } catch (err) {
                        console.warn("FreeCode AI: Focusing view directly:", err);
                        await vscode.commands.executeCommand("freecodeAI.sidebar.focus");
                    }
                }
            )
        );

        // Command: Select AI Provider
        context.subscriptions.push(
            vscode.commands.registerCommand(
                "freecodeAI.selectProvider",
                async () => {
                    const providers = [
                        "Google Gemini",
                        "Groq",
                        "OpenRouter",
                        "Ollama (Local)",
                        "Cohere",
                        "Cloudflare Workers AI",
                        "Mistral AI",
                        "NVIDIA NIM",
                        "DeepSeek",
                        "Hugging Face",
                        "OpenAI"
                    ];

                    const selected = await vscode.window.showQuickPick(
                        providers,
                        { placeHolder: "Select your AI provider" }
                    );

                    if (selected) {
                        let providerKey = PROVIDERS.GEMINI;
                        if (selected.includes("Groq")) providerKey = PROVIDERS.GROQ;
                        else if (selected.includes("OpenRouter")) providerKey = PROVIDERS.OPENROUTER;
                        else if (selected.includes("Ollama")) providerKey = PROVIDERS.OLLAMA;
                        else if (selected.includes("Cohere")) providerKey = PROVIDERS.COHERE;
                        else if (selected.includes("Cloudflare")) providerKey = PROVIDERS.CLOUDFLARE;
                        else if (selected.includes("Mistral")) providerKey = PROVIDERS.MISTRAL;
                        else if (selected.includes("NVIDIA")) providerKey = PROVIDERS.NVIDIA;
                        else if (selected.includes("DeepSeek")) providerKey = PROVIDERS.DEEPSEEK;
                        else if (selected.includes("Hugging Face")) providerKey = PROVIDERS.HUGGINGFACE;
                        else if (selected.includes("OpenAI")) providerKey = PROVIDERS.OPENAI;

                        await chatController.setProvider(providerKey);

                        vscode.window.showInformationMessage(
                            `Selected provider: ${selected}`
                        );
                        console.log(`FreeCode AI: Selected provider -> ${selected} (${providerKey})`);

                        // Notify sidebar provider to update UI if active
                        sidebarProvider.postMessage({
                            type: 'stateUpdated',
                            state: await chatController.getState()
                        });
                        sidebarProvider.postMessage({
                            type: 'providersListUpdated',
                            providers: await providerManager.getAllProviderStatuses()
                        });
                    }
                }
            )
        );

        // Command: Set API Key
        context.subscriptions.push(
            vscode.commands.registerCommand(
                "freecodeAI.setApiKey",
                async (targetProvider) => {
                    let providerId = targetProvider;
                    if (!providerId) {
                        const choice = await vscode.window.showQuickPick([
                            { label: "Google Gemini", id: PROVIDERS.GEMINI },
                            { label: "Groq", id: PROVIDERS.GROQ },
                            { label: "OpenRouter", id: PROVIDERS.OPENROUTER },
                            { label: "Cohere", id: PROVIDERS.COHERE },
                            { label: "Cloudflare Workers AI", id: PROVIDERS.CLOUDFLARE },
                            { label: "Mistral AI", id: PROVIDERS.MISTRAL },
                            { label: "NVIDIA NIM", id: PROVIDERS.NVIDIA },
                            { label: "DeepSeek", id: PROVIDERS.DEEPSEEK },
                            { label: "Hugging Face", id: PROVIDERS.HUGGINGFACE },
                            { label: "OpenAI", id: PROVIDERS.OPENAI }
                        ], { placeHolder: "Select provider to configure API Key" });

                        if (!choice) return;
                        providerId = choice.id;
                    }

                    const key = await vscode.window.showInputBox({
                        prompt: `Enter API key for ${PROVIDER_METADATA[providerId]?.name || providerId}`,
                        password: true,
                        ignoreFocusOut: true,
                        validateInput: (text) => text.trim().length === 0 ? "API key cannot be empty" : null
                    });

                    if (key) {
                        await secretManager.storeApiKey(providerId, key);
                        if (usageTracker) {
                            usageTracker.clearCooldown(providerId);
                        }
                        vscode.window.showInformationMessage(
                            `API key for ${PROVIDER_METADATA[providerId]?.name || providerId} saved securely in SecretStorage.`
                        );

                        sidebarProvider.postMessage({
                            type: 'providersListUpdated',
                            providers: await providerManager.getAllProviderStatuses()
                        });
                    }
                }
            )
        );

        // Command: Delete Provider Configuration
        context.subscriptions.push(
            vscode.commands.registerCommand(
                "freecodeAI.deleteProvider",
                async (targetProvider) => {
                    let providerId = targetProvider;
                    if (!providerId) {
                        const configured = await providerManager.getConfiguredProviders();
                        if (configured.length === 0) {
                            vscode.window.showInformationMessage("No configured providers found to delete.");
                            return;
                        }
                        const choices = configured.map(id => ({
                            label: PROVIDER_METADATA[id]?.name || id,
                            id
                        }));
                        const picked = await vscode.window.showQuickPick(choices, {
                            placeHolder: "Select a provider to delete"
                        });
                        if (!picked) return;
                        providerId = picked.id;
                    }

                    const name = PROVIDER_METADATA[providerId]?.name || providerId;
                    const confirm = await vscode.window.showWarningMessage(
                        `Are you sure you want to delete credentials and settings for ${name}?`,
                        { modal: true },
                        "Delete",
                        "Cancel"
                    );

                    if (confirm === "Delete") {
                        await secretManager.deleteApiKey(providerId);
                        await providerManager.removeProvider(providerId);
                        if (chatController.activeProvider === providerId) {
                            await chatController.setProvider(providerManager.getActiveProvider() || null);
                        }
                        vscode.window.showInformationMessage(`Deleted credentials for ${name}.`);
                        sidebarProvider.postMessage({
                            type: 'providersListUpdated',
                            providers: await providerManager.getAllProviderStatuses()
                        });
                        sidebarProvider.postMessage({
                            type: 'stateUpdated',
                            state: await chatController.getState()
                        });
                    }
                }
            )
        );

        // Command: New Chat
        context.subscriptions.push(
            vscode.commands.registerCommand(
                "freecodeAI.newChat",
                () => {
                    chatController.newChat();
                    sidebarProvider.postMessage({ type: 'chatCleared' });
                    vscode.window.showInformationMessage("FreeCode AI: Started a new conversation.");
                }
            )
        );

        // Command: Open Dashboard
        context.subscriptions.push(
            vscode.commands.registerCommand(
                "freecodeAI.openDashboard",
                async () => {
                    await vscode.commands.executeCommand("freecodeAI.openSidebar");
                }
            )
        );

        // Command: Simulate Rate Limit / Failover Test
        context.subscriptions.push(
            vscode.commands.registerCommand(
                "freecodeAI.simulateFailover",
                async () => {
                    if (sidebarProvider && sidebarProvider.chatProvider) {
                        await sidebarProvider.chatProvider.handleSimulateFailover();
                    } else {
                        await vscode.commands.executeCommand("freecodeAI.openSidebar");
                        setTimeout(async () => {
                            if (sidebarProvider && sidebarProvider.chatProvider) {
                                await sidebarProvider.chatProvider.handleSimulateFailover();
                            }
                        }, 600);
                    }
                }
            )
        );

        // Command: Reset Rate Limit Cooldowns
        context.subscriptions.push(
            vscode.commands.registerCommand(
                "freecodeAI.resetRateLimits",
                async () => {
                    if (usageTracker) {
                        usageTracker.clearCooldown();
                    }
                    vscode.window.showInformationMessage("FreeCode AI: All rate limit cooldowns have been reset.");
                    if (sidebarProvider && sidebarProvider.chatProvider) {
                        await sidebarProvider.chatProvider.sendProvidersList();
                        await sidebarProvider.chatProvider.sendStateUpdate();
                    }
                }
            )
        );

        // Command: Show Extension Status
        context.subscriptions.push(
            vscode.commands.registerCommand(
                "freecodeAI.showStatus",
                () => {
                    vscode.window.showInformationMessage(
                        "FreeCode AI is running successfully!"
                    );
                    console.log("FreeCode AI: Status reported - running successfully.");
                }
            )
        );

        vscode.window.showInformationMessage(
            "FreeCode AI activated successfully!"
        );
        console.log("FreeCode AI: Activation completed successfully.");
    } catch (error) {
        console.error("FreeCode AI: Error during activation:", error);
        vscode.window.showErrorMessage(
            `FreeCode AI activation failed: ${error.message}`
        );
    }
}

function deactivate() {
    console.log("FreeCode AI: Extension deactivated.");
}

module.exports = {
    activate,
    deactivate
};
