const vscode = require("vscode");
const { FreeCodeSidebarProvider } = require("./ui/sidebarProvider");
const { SecretManager } = require("./security/secretManager");
const { UsageTracker } = require("./usage/usageTracker");
const { ChatController } = require("./chat/chatController");
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
        const chatController = new ChatController({
            secretManager,
            usageTracker,
            initialProvider: PROVIDERS.GEMINI
        });

        // Initialize and register the Sidebar Webview View Provider
        const sidebarProvider = new FreeCodeSidebarProvider(context.extensionUri, {
            chatController,
            secretManager,
            usageTracker
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
                        "Ollama (Local)"
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

                        chatController.setProvider(providerKey);

                        vscode.window.showInformationMessage(
                            `Selected provider: ${selected}`
                        );
                        console.log(`FreeCode AI: Selected provider -> ${selected} (${providerKey})`);

                        // Notify sidebar provider to update UI if active
                        sidebarProvider.postMessage({
                            type: 'stateUpdated',
                            state: await chatController.getState()
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
                            { label: "OpenRouter", id: PROVIDERS.OPENROUTER }
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
                        vscode.window.showInformationMessage(
                            `API key for ${PROVIDER_METADATA[providerId]?.name || providerId} saved securely in SecretStorage.`
                        );
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
