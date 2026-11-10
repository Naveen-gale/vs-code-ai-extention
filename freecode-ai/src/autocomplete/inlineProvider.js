const vscode = require('vscode');

function registerInlineProvider(context) {
  const provider = {
    async provideInlineCompletionItems(document, position, context, token) {
      return [];
    }
  };

  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, provider)
  );
}

module.exports = { registerInlineProvider };
