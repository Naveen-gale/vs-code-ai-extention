const assert = require("assert");
const path = require("path");
const fs = require("fs");

console.log("=========================================");
console.log("   RUNNING DAY 1 EXTENSION TEST SUITE   ");
console.log("=========================================\n");

let testsPassed = 0;
let testsFailed = 0;

function runTest(testName, fn) {
    try {
        fn();
        console.log(`[PASS] ${testName}`);
        testsPassed++;
    } catch (err) {
        console.error(`[FAIL] ${testName}`);
        console.error(`       Error: ${err.message}`);
        testsFailed++;
    }
}

async function runTestAsync(testName, fn) {
    try {
        await fn();
        console.log(`[PASS] ${testName}`);
        testsPassed++;
    } catch (err) {
        console.error(`[FAIL] ${testName}`);
        console.error(`       Error: ${err.message}`);
        testsFailed++;
    }
}

(async () => {
    const projectRoot = path.resolve(__dirname, "..");

    // 1. Package.json inspection
    runTest("package.json exists and is valid JSON", () => {
        const pkgPath = path.join(projectRoot, "package.json");
        assert.ok(fs.existsSync(pkgPath), "package.json does not exist");
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        assert.ok(pkg.name === "laven" || pkg.name === "freecode-ai");
        assert.strictEqual(pkg.main, "./src/extension.js");
        assert.ok(pkg.contributes, "package.json missing contributes");
        assert.ok(pkg.contributes.commands, "package.json missing commands");
    });

    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

    // 2. Main entry file exists
    runTest("Main entry file exists at ./src/extension.js", () => {
        const mainPath = path.join(projectRoot, pkg.main);
        assert.ok(fs.existsSync(mainPath), `Entry point not found at ${mainPath}`);
    });

    // 3. Icon exists
    runTest("Activity bar icon exists at media/icon.svg", () => {
        const iconPath = path.join(projectRoot, "media", "icon.svg");
        assert.ok(fs.existsSync(iconPath), "media/icon.svg does not exist");
        const content = fs.readFileSync(iconPath, "utf8");
        assert.ok(content.includes("<svg"), "media/icon.svg is not a valid SVG");
    });

    // 4. Mock VS Code environment to test extension activation
    const registeredCommands = new Map();
    const registeredViews = new Map();
    const messagesShown = [];
    const executedCommands = [];
    let quickPickItems = null;

    const mockVscode = {
        window: {
            showInformationMessage: (msg) => {
                messagesShown.push({ type: "info", msg });
                return Promise.resolve(msg);
            },
            showErrorMessage: (msg) => {
                messagesShown.push({ type: "error", msg });
                return Promise.resolve(msg);
            },
            showQuickPick: (items, options) => {
                quickPickItems = items;
                // Default pick the first one for automated testing
                return Promise.resolve(items[0]);
            },
            showInputBox: (options) => {
                return Promise.resolve("mock-key-12345");
            },
            registerWebviewViewProvider: (viewId, provider) => {
                registeredViews.set(viewId, provider);
                return { dispose: () => registeredViews.delete(viewId) };
            }
        },
        commands: {
            registerCommand: (commandId, handler) => {
                registeredCommands.set(commandId, handler);
                return { dispose: () => registeredCommands.delete(commandId) };
            },
            executeCommand: (commandId, ...args) => {
                executedCommands.push({ commandId, args });
                if (registeredCommands.has(commandId)) {
                    return registeredCommands.get(commandId)(...args);
                }
                return Promise.resolve();
            }
        },
        Uri: {
            file: (p) => ({ fsPath: p, scheme: "file" }),
            joinPath: (base, ...segs) => ({ fsPath: path.join(base.fsPath || base, ...segs), scheme: "file" })
        }
    };

    // Inject mock into require cache for 'vscode'
    const Module = require("module");
    const originalRequire = Module.prototype.require;
    Module.prototype.require = function (id) {
        if (id === "vscode") {
            return mockVscode;
        }
        return originalRequire.apply(this, arguments);
    };

    // Mock storage classes
    class MockStorage {
        constructor() { this.data = new Map(); }
        async store(k, v) { this.data.set(k, v); }
        async get(k) { return this.data.get(k) || null; }
        async delete(k) { this.data.delete(k); }
    }
    class MockState {
        constructor() { this.data = new Map(); }
        get(k) { return this.data.get(k); }
        async update(k, v) { this.data.set(k, v); }
    }

    // 5. Load extension.js
    let extension;
    runTest("extension.js loads without syntax or evaluation errors", () => {
        extension = require("../src/extension.js");
        assert.ok(extension, "Failed to require extension.js");
        assert.strictEqual(typeof extension.activate, "function", "activate is not a function");
        assert.strictEqual(typeof extension.deactivate, "function", "deactivate is not a function");
    });

    // 6. Test activate()
    const mockContext = {
        subscriptions: [],
        extensionUri: { fsPath: projectRoot },
        secrets: new MockStorage(),
        globalState: new MockState()
    };

    runTest("activate(context) executes cleanly", () => {
        extension.activate(mockContext);
        assert.ok(mockContext.subscriptions.length >= 4, "Subscriptions were not added to context");
    });

    // 7. Verify registered view provider
    runTest("Sidebar view provider 'freecodeAI.sidebar' is registered", () => {
        assert.ok(registeredViews.has("freecodeAI.sidebar"), "freecodeAI.sidebar view provider not registered");
    });

    // 8. Verify registered commands
    const expectedCommands = [
        "freecodeAI.openSidebar",
        "freecodeAI.selectProvider",
        "freecodeAI.showStatus"
    ];

    expectedCommands.forEach((cmdId) => {
        runTest(`Command '${cmdId}' is registered`, () => {
            assert.ok(registeredCommands.has(cmdId), `Command ${cmdId} was not registered`);
        });
    });

    // 9. Command match between package.json and extension.js
    runTest("All package.json contributes.commands match registered commands", () => {
        const pkgCommands = pkg.contributes.commands.map((c) => c.command);
        pkgCommands.forEach((cmd) => {
            assert.ok(registeredCommands.has(cmd), `package.json command ${cmd} is not registered in extension.js`);
        });
    });

    // 10. Test Command: freecodeAI.showStatus
    await runTestAsync("Command 'freecodeAI.showStatus' displays expected message", async () => {
        messagesShown.length = 0;
        await registeredCommands.get("freecodeAI.showStatus")();
        const found = messagesShown.some((m) => m.msg.includes("Laven is running successfully!") || m.msg.includes("FreeCode AI is running successfully!"));
        assert.ok(found, "Expected status message not shown");
    });

    // 11. Test Command: freecodeAI.selectProvider
    await runTestAsync("Command 'freecodeAI.selectProvider' shows expected providers and confirmation", async () => {
        messagesShown.length = 0;
        quickPickItems = null;

        await registeredCommands.get("freecodeAI.selectProvider")();

        assert.ok(Array.isArray(quickPickItems), "QuickPick was not called with items");
        assert.ok(quickPickItems.includes("Google Gemini"), "Missing Google Gemini");
        assert.ok(quickPickItems.includes("Groq"), "Missing Groq");
        assert.ok(quickPickItems.includes("OpenRouter"), "Missing OpenRouter");
        assert.ok(quickPickItems.includes("Ollama (Local)"), "Missing Ollama (Local)");

        const found = messagesShown.some((m) => m.msg.startsWith("Selected provider:"));
        assert.ok(found, "Confirmation message not shown after provider selection");
    });

    // 12. Test Command: freecodeAI.openSidebar
    await runTestAsync("Command 'freecodeAI.openSidebar' invokes workbench view command", async () => {
        executedCommands.length = 0;
        await registeredCommands.get("freecodeAI.openSidebar")();
        const found = executedCommands.some((c) => c.commandId === "workbench.view.extension.freecodeAI");
        assert.ok(found, "workbench.view.extension.freecodeAI was not called");
    });

    // 13. Test Sidebar Webview Provider
    runTest("SidebarProvider renders HTML with provider and status action buttons", () => {
        const provider = registeredViews.get("freecodeAI.sidebar");
        assert.ok(provider, "Sidebar provider not found");

        let htmlSet = "";
        let messageHandler = null;

        const mockWebviewView = {
            webview: {
                options: {},
                asWebviewUri: (uri) => uri.fsPath || uri.toString(),
                set html(val) {
                    htmlSet = val;
                },
                get html() {
                    return htmlSet;
                },
                onDidReceiveMessage: (cb) => {
                    messageHandler = cb;
                }
            }
        };

        provider.resolveWebviewView(mockWebviewView);

        assert.ok(htmlSet.includes('id="provider"'), "HTML missing #provider button");
        assert.ok(htmlSet.includes('id="status"'), "HTML missing #status button");
        assert.ok(htmlSet.includes("Select AI Provider"), "HTML missing Select AI Provider label");
        assert.ok(htmlSet.includes("Check Extension Status"), "HTML missing Check Extension Status label");
        assert.ok(typeof messageHandler === "function", "Message handler was not registered");
    });

    // 14. Test Webview Message Handling
    await runTestAsync("Webview message 'selectProvider' executes command freecodeAI.selectProvider", async () => {
        const provider = registeredViews.get("freecodeAI.sidebar");
        let messageHandler = null;

        const mockWebviewView = {
            webview: {
                options: {},
                asWebviewUri: (uri) => uri.fsPath || uri.toString(),
                set html(val) {},
                onDidReceiveMessage: (cb) => {
                    messageHandler = cb;
                }
            }
        };

        provider.resolveWebviewView(mockWebviewView);
        executedCommands.length = 0;

        await messageHandler({ command: "selectProvider" });
        const found = executedCommands.some((c) => c.commandId === "freecodeAI.selectProvider");
        assert.ok(found, "freecodeAI.selectProvider was not called from webview message");
    });

    await runTestAsync("Webview message 'showStatus' executes command freecodeAI.showStatus", async () => {
        const provider = registeredViews.get("freecodeAI.sidebar");
        let messageHandler = null;

        const mockWebviewView = {
            webview: {
                options: {},
                asWebviewUri: (uri) => uri.fsPath || uri.toString(),
                set html(val) {},
                onDidReceiveMessage: (cb) => {
                    messageHandler = cb;
                }
            }
        };

        provider.resolveWebviewView(mockWebviewView);
        executedCommands.length = 0;

        await messageHandler({ command: "showStatus" });
        const found = executedCommands.some((c) => c.commandId === "freecodeAI.showStatus");
        assert.ok(found, "freecodeAI.showStatus was not called from webview message");
    });

    console.log("\n=========================================");
    console.log(`TOTAL TESTS: ${testsPassed + testsFailed}`);
    console.log(`PASSED: ${testsPassed}`);
    console.log(`FAILED: ${testsFailed}`);
    console.log("=========================================\n");

    if (testsFailed > 0) {
        process.exit(1);
    }
})();
