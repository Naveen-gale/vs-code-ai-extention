const ErrorType = {
  RATE_LIMIT: 'RATE_LIMIT',
  AUTH: 'AUTH',
  TIMEOUT: 'TIMEOUT',
  SERVER_ERROR: 'SERVER_ERROR',
  UNKNOWN: 'UNKNOWN'
};

class ErrorClassifier {
  static classify(error) {
    if (error && error.status === 429) return ErrorType.RATE_LIMIT;
    if (error && (error.status === 401 || error.status === 403)) return ErrorType.AUTH;
    if (error && error.code === 'ETIMEDOUT') return ErrorType.TIMEOUT;
    return ErrorType.UNKNOWN;
  }
}

module.exports = { ErrorClassifier, ErrorType };
