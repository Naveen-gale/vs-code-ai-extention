class FallbackManager {
  constructor(priorityList = []) {
    this.priorityList = priorityList;
  }

  getNextProvider(failedProvider) {
    // Determine next provider in fallback chain
  }
}

module.exports = { FallbackManager };
