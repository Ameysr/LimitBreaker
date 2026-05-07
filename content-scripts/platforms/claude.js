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
    var bodyText = document.body.innerText || '';
    var limitPhrases = [
      'usage limit', 'out of messages', 'message limit',
      'rate limit', 'limit reached', 'too many messages',
      'you\'ve hit your', 'come back', 'try again later',
      'exceeded your', 'upgrade to continue', 'you have used all'
    ];
    var lowerText = bodyText.toLowerCase();
    for (var i = 0; i < limitPhrases.length; i++) {
      if (lowerText.includes(limitPhrases[i])) {
        var indicators = document.querySelectorAll('[role="dialog"], [role="alert"]');
        if (indicators.length > 0) return true;
        var banners = document.querySelectorAll('[class*="toast"], [class*="banner"], [class*="notice"]');
        for (var j = 0; j < banners.length; j++) {
          if (banners[j].innerText.toLowerCase().includes(limitPhrases[i])) return true;
        }
      }
    }
    return false;
  },

  // ── DOM Element Selectors ──

  getInputElement() {
    var selectors = [
      'div.ProseMirror[contenteditable="true"]',
      '[contenteditable="true"].ProseMirror',
      'div[contenteditable="true"][data-placeholder]',
      'fieldset div[contenteditable="true"]',
      'div[contenteditable="true"]'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) {
        console.log('[LimitBreaker] Found input:', selectors[i]);
        return el;
      }
    }
    console.warn('[LimitBreaker] Input not found');
    return null;
  },

  getSendButton() {
    // Claude's send button is a small button (around 32x32) near the bottom
    // with classes like: inline-flex items-center justify-center can-focus
    // It has NO aria-label, so we find it by position and shape

    // Method 1: Look for the button right after the input area
    // Claude puts the send button inside or near a fieldset/form area at the bottom
    var allButtons = document.querySelectorAll('button');
    var bestCandidate = null;
    var bestScore = -1;

    for (var i = 0; i < allButtons.length; i++) {
      var btn = allButtons[i];
      var rect = btn.getBoundingClientRect();

      // Skip invisible or disabled buttons
      if (rect.width === 0 || rect.height === 0) continue;

      // Must be near the bottom of the viewport
      if (rect.top < window.innerHeight - 300) continue;

      var score = 0;

      // Small square button (send buttons are usually 28-40px)
      if (rect.width >= 24 && rect.width <= 48 && rect.height >= 24 && rect.height <= 48) {
        score += 3;
      }

      // Has an SVG icon
      if (btn.querySelector('svg')) {
        score += 2;
      }

      // Has classes suggesting it's a clickable action button
      var cls = btn.className || '';
      if (cls.includes('can-focus') || cls.includes('inline-flex')) {
        score += 2;
      }

      // Is on the right side of the viewport
      if (rect.left > window.innerWidth / 2) {
        score += 1;
      }

      // Not disabled
      if (!btn.disabled) {
        score += 1;
      }

      // Has background color (send buttons usually have a colored bg)
      var style = window.getComputedStyle(btn);
      var bg = style.backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        score += 2;
      }

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = btn;
      }
    }

    if (bestCandidate) {
      console.log('[LimitBreaker] Found send button with score:', bestScore, bestCandidate.className.substring(0, 60));
      return bestCandidate;
    }

    console.warn('[LimitBreaker] Send button not found');
    return null;
  },

  isInputReady() {
    return !!this.getInputElement();
  },

  isResponseStreaming() {
    // When Claude is streaming, a stop button appears
    var stopBtn = document.querySelector('button[aria-label*="Stop"]');
    if (stopBtn) return true;
    // Also check for any loading/streaming indicators
    var loading = document.querySelector('[class*="streaming"], [class*="loading"]');
    return !!loading;
  },

  // ── Prompt Submission ──

  async submitPrompt(text) {
    console.log('[LimitBreaker] === Starting prompt submission ===');

    var input = this.getInputElement();
    if (!input) {
      console.error('[LimitBreaker] FAIL: No input element found on page');
      throw new Error('Claude input element not found');
    }

    // Step 1: Focus and clear
    console.log('[LimitBreaker] Step 1: Focus input');
    input.focus();
    await this._wait(300);

    // Step 2: Clear existing text
    console.log('[LimitBreaker] Step 2: Clear existing text');
    input.innerHTML = '';
    await this._wait(100);

    // Step 3: Insert text using multiple strategies
    console.log('[LimitBreaker] Step 3: Insert text');

    var inserted = false;

    // Strategy A: execCommand insertText (works in many contenteditable editors)
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      if (input.textContent.trim().length > 0) {
        console.log('[LimitBreaker] Strategy A (execCommand) worked');
        inserted = true;
      }
    } catch(e) {
      console.log('[LimitBreaker] Strategy A failed:', e.message);
    }

    // Strategy B: Clipboard paste simulation
    if (!inserted) {
      try {
        input.innerHTML = '';
        var dt = new DataTransfer();
        dt.setData('text/plain', text);
        var pasteEvent = new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true
        });
        input.dispatchEvent(pasteEvent);
        await this._wait(200);
        if (input.textContent.trim().length > 0) {
          console.log('[LimitBreaker] Strategy B (paste event) worked');
          inserted = true;
        }
      } catch(e) {
        console.log('[LimitBreaker] Strategy B failed:', e.message);
      }
    }

    // Strategy C: Direct DOM insertion with input events
    if (!inserted) {
      console.log('[LimitBreaker] Strategy C: Direct DOM insertion');
      input.innerHTML = '';
      var p = document.createElement('p');
      p.textContent = text;
      input.appendChild(p);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      inserted = true;
    }

    // Fire events to make sure the framework picks up the change
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    console.log('[LimitBreaker] Input text content after insertion:', input.textContent.substring(0, 50));

    // Step 4: Wait for Claude to register the input
    await this._wait(1000);

    // Step 5: Click send
    console.log('[LimitBreaker] Step 4: Find and click send button');
    var sendBtn = this.getSendButton();

    if (sendBtn) {
      if (sendBtn.disabled) {
        console.log('[LimitBreaker] Send button is disabled, waiting...');
        await this._wait(2000);
        sendBtn = this.getSendButton();
      }

      if (sendBtn && !sendBtn.disabled) {
        console.log('[LimitBreaker] Clicking send button with full event sequence');

        // Simulate a real mouse click with full event chain
        var rect = sendBtn.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        var evtOpts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };

        sendBtn.dispatchEvent(new PointerEvent('pointerover', evtOpts));
        sendBtn.dispatchEvent(new PointerEvent('pointerenter', evtOpts));
        sendBtn.dispatchEvent(new MouseEvent('mouseover', evtOpts));
        sendBtn.dispatchEvent(new MouseEvent('mouseenter', evtOpts));
        sendBtn.dispatchEvent(new PointerEvent('pointerdown', { ...evtOpts, button: 0 }));
        sendBtn.dispatchEvent(new MouseEvent('mousedown', { ...evtOpts, button: 0 }));
        sendBtn.focus();
        await this._wait(50);
        sendBtn.dispatchEvent(new PointerEvent('pointerup', { ...evtOpts, button: 0 }));
        sendBtn.dispatchEvent(new MouseEvent('mouseup', { ...evtOpts, button: 0 }));
        sendBtn.dispatchEvent(new MouseEvent('click', { ...evtOpts, button: 0 }));

        await this._wait(500);

        // Check if the text was cleared (meaning Claude accepted the input)
        var afterText = input.textContent.trim();
        if (afterText.length === 0 || afterText !== text) {
          console.log('[LimitBreaker] === Submission complete (click worked) ===');
          return true;
        }

        // If text still there, click didn't work. Try native click.
        console.log('[LimitBreaker] Pointer events didnt work, trying native click');
        sendBtn.click();
        await this._wait(500);

        afterText = input.textContent.trim();
        if (afterText.length === 0 || afterText !== text) {
          console.log('[LimitBreaker] === Submission complete (native click) ===');
          return true;
        }

        // Still didn't work, try Enter key on the input
        console.log('[LimitBreaker] Click methods failed, trying Enter key');
        input.focus();
        await this._wait(100);
      }
    }

    // Fallback: Try pressing Enter
    console.log('[LimitBreaker] Send button unavailable, trying Enter key');
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true
    }));
    input.dispatchEvent(new KeyboardEvent('keypress', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true
    }));
    input.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true
    }));

    await this._wait(500);
    console.log('[LimitBreaker] === Submission complete (Enter fallback) ===');
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
