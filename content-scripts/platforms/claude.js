/**
 * LimitBreaker — Claude.ai Platform Adapter
 * Handles DOM interactions specific to claude.ai
 */

const ClaudeAdapter = {
  name: 'claude',
  displayName: 'Claude',

  matchUrl: /^https:\/\/claude\.ai/,

  // ── Rate Limit Detection ──

  isRateLimited() {
    const bodyText = document.body.innerText || '';
    const limitPhrases = [
      'usage limit',
      'out of messages',
      'message limit',
      'rate limit',
      'limit reached',
      'too many messages',
      'you\'ve hit your',
      'come back',
      'try again later',
      'exceeded your',
      'upgrade to continue',
      'you have used all'
    ];
    const lowerText = bodyText.toLowerCase();
    for (const phrase of limitPhrases) {
      if (lowerText.includes(phrase)) {
        // Verify it's a real limit banner, not just text in a conversation
        const modals = document.querySelectorAll('[role="dialog"], [role="alert"], [data-testid*="limit"], .modal, .overlay');
        if (modals.length > 0) return true;
        // Check for toasts or banners
        const toasts = document.querySelectorAll('[class*="toast"], [class*="banner"], [class*="notice"], [class*="warning"]');
        for (const toast of toasts) {
          if (toast.innerText.toLowerCase().includes(phrase)) return true;
        }
        // Check for sticky/fixed position elements (often used for limit banners)
        const fixedEls = document.querySelectorAll('[style*="position: fixed"], [style*="position: sticky"]');
        for (const el of fixedEls) {
          if (el.innerText.toLowerCase().includes(phrase)) return true;
        }
      }
    }
    // Also check for disabled input as a signal
    const input = this.getInputElement();
    if (input && input.getAttribute('aria-disabled') === 'true') return true;
    return false;
  },

  // ── DOM Element Selectors ──

  getInputElement() {
    // Claude uses a contenteditable div or a ProseMirror editor
    return document.querySelector(
      '[contenteditable="true"].ProseMirror, ' +
      'div[contenteditable="true"][data-placeholder], ' +
      'fieldset div[contenteditable="true"], ' +
      'div.ProseMirror[contenteditable="true"]'
    );
  },

  getSendButton() {
    // Try multiple selectors since Claude updates UI frequently
    return document.querySelector(
      'button[aria-label="Send Message"], ' +
      'button[aria-label="Send message"], ' +
      'button[data-testid="send-button"], ' +
      'fieldset button[type="button"]:last-of-type, ' +
      'button svg[viewBox] ~ span'
    )?.closest('button') || this._findSendButtonByIcon();
  },

  _findSendButtonByIcon() {
    // Fallback: find button with arrow/send SVG icon near the input
    const buttons = document.querySelectorAll('fieldset button, form button');
    for (const btn of buttons) {
      const svg = btn.querySelector('svg');
      if (svg && !btn.disabled) {
        const rect = btn.getBoundingClientRect();
        if (rect.bottom > window.innerHeight - 200) return btn;
      }
    }
    return null;
  },

  // ── Input Detection ──

  isInputReady() {
    const input = this.getInputElement();
    if (!input) return false;
    const send = this.getSendButton();
    return !!input && !input.getAttribute('aria-disabled');
  },

  isResponseStreaming() {
    // Check if Claude is currently generating a response
    const stopBtn = document.querySelector(
      'button[aria-label="Stop Response"], ' +
      'button[aria-label="Stop response"], ' +
      'button[aria-label="Stop"]'
    );
    return !!stopBtn;
  },

  // ── Prompt Submission ──

  async submitPrompt(text) {
    const input = this.getInputElement();
    if (!input) throw new Error('Claude input element not found');

    // Focus the input
    input.focus();
    await this._wait(200);

    // Clear existing content
    input.innerHTML = '';
    input.textContent = '';

    // Set the text content
    // For ProseMirror, we need to create a paragraph node
    const p = document.createElement('p');
    p.textContent = text;
    input.appendChild(p);

    // Dispatch input events to trigger Claude's reactivity
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      inputType: 'insertText',
      data: text
    }));

    await this._wait(500);

    // Click send
    const sendBtn = this.getSendButton();
    if (!sendBtn) throw new Error('Claude send button not found');
    if (sendBtn.disabled) {
      // Wait a bit and retry
      await this._wait(1000);
      if (sendBtn.disabled) throw new Error('Claude send button is disabled');
    }
    sendBtn.click();

    return true;
  },

  async waitForResponse(timeoutMs = 120000) {
    const startTime = Date.now();

    // Wait for streaming to start
    await this._wait(2000);

    // Then wait for streaming to finish
    while (Date.now() - startTime < timeoutMs) {
      if (!this.isResponseStreaming()) {
        await this._wait(1000); // Extra buffer after streaming stops
        return true;
      }
      await this._wait(1000);
    }

    return false; // Timed out
  },

  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};

if (typeof window !== 'undefined') {
  window.ClaudeAdapter = ClaudeAdapter;
}
