class CooldownManager {
  constructor() {
    this.cooldowns = new Map();
  }

  setCooldown(provider, durationMs) {
    this.cooldowns.set(provider, Date.now() + durationMs);
  }

  isCoolingDown(provider) {
    const expiresAt = this.cooldowns.get(provider);
    if (!expiresAt) return false;
    if (Date.now() > expiresAt) {
      this.cooldowns.delete(provider);
      return false;
    }
    return true;
  }
}

module.exports = { CooldownManager };
