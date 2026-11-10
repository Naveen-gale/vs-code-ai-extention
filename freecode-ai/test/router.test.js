const assert = require('assert');
const { ErrorClassifier, ErrorType } = require('../src/router/errorClassifier');

describe('ErrorClassifier', () => {
  it('should identify rate limits', () => {
    const type = ErrorClassifier.classify({ status: 429 });
    assert.strictEqual(type, ErrorType.RATE_LIMIT);
  });
});
