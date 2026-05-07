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
        var modals = document.querySelectorAll('[role="dialog"], [role="alert"], [data-testid*="limit"], .modal, .overlay');
        if (modals.length > 0) return true;
        var toasts = document.querySelectorAll('[class*="toast"], [class*="banner"], [class*="notice"], [class*="warning"]');
        for (var j = 0; j < toasts.length; j++) {
          if (toasts[j].innerText.toLowerCase().includes(phrase)) return true;
        }
        var fixedEls = document.querySelectorAll('[style*="position: fixed"], [style*="position: sticky"]');
        for (var k = 0; k < fixedEls.length; k++) {
          if (fixedEls[k].innerText.toLowerCase().includes(phrase)) return true;
        }
      }
    }
    return false;
  },

  // ── DOM Element Selectors ──

  getInputElement() {
    // Try multiple selectors, Claude changes their DOM frequently
    var selectors = [
      'div.ProseMirror[contenteditable="true"]',
      '[contenteditable="true"].ProseMirror',
      'div[contenteditable="true"][data-placeholder]',
      'fieldset div[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) {
        console.log('[LimitBreaker] Found Claude input with selector:', selectors[i]);
        return el;
      }
    }
    console.warn('[LimitBreaker] Could not find Claude input element');
    return null;
  },

  getSendButton() {
    // Try aria labels first
    var ariaSelectors = [
      'button[aria-label*="Send"]',
      'button[aria-label*="send"]',
      'button[data-testid="send-button"]',
      'button[data-testid*="send"]'
    ];
    for (var i = 0; i < ariaSelectors.length; i++) {
      var btn = document.querySelector(ariaSelectors[i]);
      if (btn) {
        console.log('[LimitBreaker] Found send button with:', ariaSelectors[i]);
        return btn;
      }
    }

    // Fallback: find the last enabled button near the bottom of page that contains an SVG
    var allButtons = document.querySelectorAll('button');
    var candidates = [];
    for (var j = 0; j < allButtons.length; j++) {
      var b = allButtons[j];
      var rect = b.getBoundingClientRect();
      // Button must be near bottom of viewport and visible
      if (rect.bottom > window.innerHeight - 250 && rect.height > 0 && rect.width > 0) {
        if (b.querySelector('svg') && !b.disabled) {
          candidates.push(b);
        }
      }
    }
    if (candidates.length > 0) {
      // Return the rightmost candidate (send buttons are usually on the right)
      candidates.sort(function(a, b) { return b.getBoundingClientRect().right - a.getBoundingClientRect().right; });
      console.log('[LimitBreaker] Found send button via position fallback');
      return candidates[0];
    }

    console.warn('[LimitBreaker] Could not find Claude send button');
    return null;
  },

  // ── Input Detection ──

  isInputReady() {
    var input = this.getInputElement();
    return !!input;
  },

  isResponseStreaming() {
    var stopBtn = document.querySelector(
      'button[aria-label*="Stop"],' +
      'button[aria-label*="stop"]'
    );
    return !!stopBtn;
  },

  // ── Prompt Submission ──

  async submitPrompt(text) {
    var input = this.getInputElement();
    if (!input) {
      console.error('[LimitBreaker] Cannot submit: input element not found');
      throw new Error('Claude input element not found');
    }

    console.log('[LimitBreaker] Submitting prompt to Claude, length:', text.length);

    // Focus the input
    input.focus();
    await this._wait(300);

    // Clear existing content
    input.innerHTML = '';
    await this._wait(100);

    // Method 1: Use execCommand insertText (most reliable for contenteditable)
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      document.execCommand('insertText', false, text);
      console.log('[LimitBreaker] Used execCommand method');
    } catch (e) {
      // Method 2: Fallback to setting textContent with events
      console.log('[LimitBreaker] execCommand failed, using fallback');
      var p = document.createElement('p');
      p.textContent = text;
      input.innerHTML = '';
      input.appendChild(p);
    }

    // Fire all the events Claude might be listening to
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('keyup', { bubbles: true }));

    // Wait for Claude to register the input
    await this._wait(800);

    // Find and click the send button
    var sendBtn = this.getSendButton();
    if (!sendBtn) {
      console.error('[LimitBreaker] Cannot submit: send button not found');
      throw new Error('Claude send button not found');
    }

    if (sendBtn.disabled) {
      console.log('[LimitBreaker] Send button disabled, waiting...');
      await this._wait(1500);
      sendBtn = this.getSendButton();
      if (!sendBtn || sendBtn.disabled) {
        // Try pressing Enter instead
        console.log('[LimitBreaker] Trying Enter key instead');
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13,
          bubbles: true, cancelable: true
        }));
        await this._wait(500);
        return true;
      }
    }

    console.log('[LimitBreaker] Clicking send button');
    sendBtn.click();
    sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    return true;
  },

  async waitForResponse(timeoutMs) {
    timeoutMs = timeoutMs || 120000;
    var startTime = Date.now();
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
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }
};

if (typeof window !== 'undefined') {
  window.ClaudeAdapter = ClaudeAdapter;
}
