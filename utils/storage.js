/**
 * LimitBreaker — Chrome Storage API Wrapper
 * Handles all persistent data: queue, settings, platform state.
 */

const QueueStorage = {
  KEYS: {
    QUEUE: 'qp_queue',
    SETTINGS: 'qp_settings',
    STATUS: 'qp_status',
    HISTORY: 'qp_history'
  },

  DEFAULT_SETTINGS: {
    autoSubmit: true,
    pollIntervalSeconds: 30,
    notifyOnLimitHit: true,
    notifyOnLimitClear: true,
    notifyOnComplete: true,
    enabledPlatforms: ['claude', 'chatgpt', 'gemini']
  },

  DEFAULT_STATUS: {
    isRateLimited: false,
    platform: null,
    limitDetectedAt: null,
    estimatedResetTime: null,
    queueRunning: false,
    currentPromptIndex: 0,
    totalPrompts: 0
  },

  // ── Queue Operations ──

  async getQueue() {
    const result = await chrome.storage.local.get(this.KEYS.QUEUE);
    return result[this.KEYS.QUEUE] || [];
  },

  async addToQueue(prompt) {
    const queue = await this.getQueue();
    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      text: prompt,
      platform: null,
      status: 'pending',
      addedAt: Date.now(),
      submittedAt: null
    };
    queue.push(item);
    await chrome.storage.local.set({ [this.KEYS.QUEUE]: queue });
    return item;
  },

  async removeFromQueue(id) {
    let queue = await this.getQueue();
    queue = queue.filter(item => item.id !== id);
    await chrome.storage.local.set({ [this.KEYS.QUEUE]: queue });
    return queue;
  },

  async reorderQueue(fromIndex, toIndex) {
    const queue = await this.getQueue();
    if (fromIndex < 0 || fromIndex >= queue.length) return queue;
    if (toIndex < 0 || toIndex >= queue.length) return queue;
    const [item] = queue.splice(fromIndex, 1);
    queue.splice(toIndex, 0, item);
    await chrome.storage.local.set({ [this.KEYS.QUEUE]: queue });
    return queue;
  },

  async updateQueueItem(id, updates) {
    const queue = await this.getQueue();
    const index = queue.findIndex(item => item.id === id);
    if (index === -1) return null;
    queue[index] = { ...queue[index], ...updates };
    await chrome.storage.local.set({ [this.KEYS.QUEUE]: queue });
    return queue[index];
  },

  async clearQueue() {
    await chrome.storage.local.set({ [this.KEYS.QUEUE]: [] });
  },

  async getNextPending() {
    const queue = await this.getQueue();
    return queue.find(item => item.status === 'pending') || null;
  },

  // ── Settings ──

  async getSettings() {
    const result = await chrome.storage.local.get(this.KEYS.SETTINGS);
    return { ...this.DEFAULT_SETTINGS, ...(result[this.KEYS.SETTINGS] || {}) };
  },

  async updateSettings(updates) {
    const settings = await this.getSettings();
    const updated = { ...settings, ...updates };
    await chrome.storage.local.set({ [this.KEYS.SETTINGS]: updated });
    return updated;
  },

  // ── Status ──

  async getStatus() {
    const result = await chrome.storage.local.get(this.KEYS.STATUS);
    return { ...this.DEFAULT_STATUS, ...(result[this.KEYS.STATUS] || {}) };
  },

  async updateStatus(updates) {
    const status = await this.getStatus();
    const updated = { ...status, ...updates };
    await chrome.storage.local.set({ [this.KEYS.STATUS]: updated });
    return updated;
  },

  async resetStatus() {
    await chrome.storage.local.set({ [this.KEYS.STATUS]: this.DEFAULT_STATUS });
  },

  // ── History ──

  async addToHistory(item) {
    const result = await chrome.storage.local.get(this.KEYS.HISTORY);
    const history = result[this.KEYS.HISTORY] || [];
    history.unshift({
      ...item,
      completedAt: Date.now()
    });
    // Keep only last 50 items
    if (history.length > 50) history.length = 50;
    await chrome.storage.local.set({ [this.KEYS.HISTORY]: history });
  },

  async getHistory() {
    const result = await chrome.storage.local.get(this.KEYS.HISTORY);
    return result[this.KEYS.HISTORY] || [];
  }
};

// Make available in both content script and module contexts
if (typeof window !== 'undefined') {
  window.QueueStorage = QueueStorage;
}
