/**
 * QueuePilot — Chrome Message Passing Helpers
 * Type-safe message definitions for communication between
 * content scripts, background worker, and popup.
 */

const MessageTypes = {
  // Content Script → Background
  RATE_LIMIT_DETECTED: 'RATE_LIMIT_DETECTED',
  RATE_LIMIT_CLEARED: 'RATE_LIMIT_CLEARED',
  PROMPT_SUBMITTED: 'PROMPT_SUBMITTED',
  PROMPT_RESPONSE_COMPLETE: 'PROMPT_RESPONSE_COMPLETE',
  PLATFORM_READY: 'PLATFORM_READY',

  // Background → Content Script
  SUBMIT_PROMPT: 'SUBMIT_PROMPT',
  CHECK_RATE_LIMIT: 'CHECK_RATE_LIMIT',
  GET_PLATFORM_STATUS: 'GET_PLATFORM_STATUS',

  // Popup → Background
  ADD_TO_QUEUE: 'ADD_TO_QUEUE',
  REMOVE_FROM_QUEUE: 'REMOVE_FROM_QUEUE',
  REORDER_QUEUE: 'REORDER_QUEUE',
  CLEAR_QUEUE: 'CLEAR_QUEUE',
  GET_STATE: 'GET_STATE',
  PAUSE_QUEUE: 'PAUSE_QUEUE',
  RESUME_QUEUE: 'RESUME_QUEUE',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',

  // Background → Popup
  STATE_UPDATED: 'STATE_UPDATED'
};

const Messenger = {
  /**
   * Send message to the background service worker
   */
  async sendToBackground(type, data = {}) {
    try {
      return await chrome.runtime.sendMessage({ type, data, source: 'content' });
    } catch (err) {
      console.warn('[QueuePilot] Failed to send to background:', err.message);
      return null;
    }
  },

  /**
   * Send message to all content scripts in a specific tab
   */
  async sendToTab(tabId, type, data = {}) {
    try {
      return await chrome.tabs.sendMessage(tabId, { type, data, source: 'background' });
    } catch (err) {
      console.warn('[QueuePilot] Failed to send to tab:', err.message);
      return null;
    }
  },

  /**
   * Listen for messages with a handler map
   * @param {Object} handlers - { MESSAGE_TYPE: (data, sender) => response }
   */
  onMessage(handlers) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const handler = handlers[message.type];
      if (!handler) return false;

      const result = handler(message.data, sender);

      if (result instanceof Promise) {
        result.then(sendResponse).catch(err => {
          console.error('[QueuePilot] Handler error:', err);
          sendResponse({ error: err.message });
        });
        return true; // Keep channel open for async response
      }

      sendResponse(result);
      return false;
    });
  }
};

// Make available globally
if (typeof window !== 'undefined') {
  window.MessageTypes = MessageTypes;
  window.Messenger = Messenger;
}
