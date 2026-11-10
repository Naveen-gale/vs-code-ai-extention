const assert = require('assert');
const { PromptBuilder } = require('../src/autocomplete/promptBuilder');

describe('PromptBuilder', () => {
  it('should construct FIM prompt', () => {
    const prompt = PromptBuilder.buildFIMPrompt({ prefix: 'const a = ', suffix: ';' });
    assert.ok(prompt.includes('<PRE>'));
    assert.ok(prompt.includes('<SUF>'));
  });
});
