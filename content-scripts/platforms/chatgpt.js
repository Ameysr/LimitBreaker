/**
 * QueuePilot — ChatGPT Platform Adapter
 * Handles DOM interactions specific to chatgpt.com / chat.openai.com
 */

const ChatGPTAdapter = {
  name: 'chatgpt',
  displayName: 'ChatGPT',

  matchUrl: /^https:\/\/(chatgpt\.com|chat\.openai\.com)/,

  // ── Rate Limit Detection ──

  isRateLimited() {
    const bodyText = document.body.innerText || '';
    const limitPhrases = [
      'you\'ve reached the',
      'rate limit',
      'usage cap',
      'too many requests',
      'limit reached',
      'message cap',
      'try again in',
      'come back later',
      'temporarily unavailable',
      'upgrade your plan',
      'exceeded the number',
      'out of messages'
    ];
    const lowerText = bodyText.toLowerCase();
    for (const phrase of limitPhrases) {
      if (lowerText.includes(phrase)) {
        // Check modals, banners, toasts
        const indicators = document.querySelectorAll(
          '[role="dialog"], [role="alert"], [class*="modal"], ' +
          '[class*="toast"], [class*="banner"], [class*="limit"]'
        );
        for (const el of indicators) {
          if (el.innerText.toLowerCase().includes(phrase)) return true;
        }
      }
    }
    // Check for disabled textarea
    const input = this.getInputElement();
    if (input && input.disabled) return true;
    return false;
  },

  // ── DOM Element Selectors ──

  getInputElement() {
    return document.querySelector(
      '#prompt-textarea, ' +
      'textarea[data-id="root"], ' +
      'div[contenteditable="true"][id="prompt-textarea"], ' +
      'div#prompt-textarea'
    );
  },

  getSendButton() {
    return document.querySelector(
      'button[data-testid="send-button"], ' +
      'button[aria-label="Send prompt"], ' +
      'button[aria-label="Send message"], ' +
      'form button[type="submit"]'
    ) || this._findSendButtonFallback();
  },

  _findSendButtonFallback() {
    // Look for a button near the bottom of the page with an SVG
    const buttons = document.querySelectorAll('main button');
    for (const btn of buttons) {
      const rect = btn.getBoundingClientRect();
      if (rect.bottom > window.innerHeight - 200 && btn.querySelector('svg')) {
        return btn;
      }
    }
    return null;
  },

  // ── Input Detection ──

  isInputReady() {
    const input = this.getInputElement();
    return !!input && !input.disabled;
  },

  isResponseStreaming() {
    const stopBtn = document.querySelector(
      'button[aria-label="Stop generating"], ' +
      'button[aria-label="Stop streaming"], ' +
      'button[data-testid="stop-button"]'
    );
    return !!stopBtn;
  },

  // ── Prompt Submission ──

  async submitPrompt(text) {
    const input = this.getInputElement();
    if (!input) throw new Error('ChatGPT input element not found');

    input.focus();
    await this._wait(200);

    // ChatGPT may use a contenteditable div or textarea
    if (input.tagName === 'TEXTAREA') {
      // Native textarea
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      ).set;
      nativeSetter.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // Contenteditable div
      input.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = text;
      input.appendChild(p);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    await this._wait(500);

    const sendBtn = this.getSendButton();
    if (!sendBtn) throw new Error('ChatGPT send button not found');
    sendBtn.click();

    return true;
  },

  async waitForResponse(timeoutMs = 120000) {
    const startTime = Date.now();
    await this._wait(2000);

    while (Date.now() - startTime < timeoutMs) {
      if (!this.isResponseStreaming()) {
        await this._wait(1000);
        return true;
      }
      await this._wait(1000);
    }
    return false;
  },

  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};

if (typeof window !== 'undefined') {
  window.ChatGPTAdapter = ChatGPTAdapter;
}
