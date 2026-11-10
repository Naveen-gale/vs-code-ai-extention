const assert = require('assert');
const { ProviderFactory } = require('../src/providers/providerFactory');

describe('ProviderFactory', () => {
  it('should instantiate GeminiProvider', () => {
    const provider = ProviderFactory.create('gemini');
    assert.ok(provider);
  });
});
