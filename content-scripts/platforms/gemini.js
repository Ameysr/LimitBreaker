/**
 * QueuePilot — Gemini Platform Adapter
 * Handles DOM interactions specific to gemini.google.com
 */

const GeminiAdapter = {
  name: 'gemini',
  displayName: 'Gemini',

  matchUrl: /^https:\/\/gemini\.google\.com/,

  // ── Rate Limit Detection ──

  isRateLimited() {
    const bodyText = document.body.innerText || '';
    const limitPhrases = [
      'quota exceeded',
      'rate limit',
      'too many requests',
      'try again later',
      'temporarily unavailable',
      'come back later',
      'limit reached',
      'exceeded your',
      'slow down',
      'usage limit'
    ];
    const lowerText = bodyText.toLowerCase();
    for (const phrase of limitPhrases) {
      if (lowerText.includes(phrase)) {
        const indicators = document.querySelectorAll(
          '[role="dialog"], [role="alert"], [class*="error"], ' +
          '[class*="toast"], [class*="snackbar"], [class*="banner"]'
        );
        for (const el of indicators) {
          if (el.innerText.toLowerCase().includes(phrase)) return true;
        }
      }
    }
    return false;
  },

  // ── DOM Element Selectors ──

  getInputElement() {
    return document.querySelector(
      '.ql-editor[contenteditable="true"], ' +
      'div[contenteditable="true"][aria-label*="prompt"], ' +
      'div[contenteditable="true"][aria-label*="Enter"], ' +
      'rich-textarea div[contenteditable="true"], ' +
      '.text-input-field div[contenteditable="true"]'
    );
  },

  getSendButton() {
    return document.querySelector(
      'button[aria-label="Send message"], ' +
      'button[aria-label="Submit"], ' +
      'button.send-button, ' +
      'button[data-test-id="send-button"], ' +
      '.input-buttons button[mat-icon-button]'
    ) || this._findSendButtonFallback();
  },

  _findSendButtonFallback() {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const ariaLabel = btn.getAttribute('aria-label') || '';
      if (ariaLabel.toLowerCase().includes('send')) return btn;
    }
    return null;
  },

  // ── Input Detection ──

  isInputReady() {
    const input = this.getInputElement();
    return !!input;
  },

  isResponseStreaming() {
    // Gemini uses a loading indicator or stop button
    const stopBtn = document.querySelector(
      'button[aria-label="Stop"], ' +
      'button[aria-label="Stop generating"], ' +
      '.loading-indicator, ' +
      '[class*="streaming"]'
    );
    return !!stopBtn;
  },

  // ── Prompt Submission ──

  async submitPrompt(text) {
    const input = this.getInputElement();
    if (!input) throw new Error('Gemini input element not found');

    input.focus();
    await this._wait(200);

    // Clear and set content
    input.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = text;
    input.appendChild(p);

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await this._wait(500);

    const sendBtn = this.getSendButton();
    if (!sendBtn) throw new Error('Gemini send button not found');
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
  window.GeminiAdapter = GeminiAdapter;
}
