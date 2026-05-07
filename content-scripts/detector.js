/**
 * QueuePilot — Content Script Detector
 * Main content script that runs on AI platform pages.
 * Detects rate limits using platform adapters and reports to background worker.
 */

(function () {
  'use strict';

  const POLL_INTERVAL = 5000; // Check every 5 seconds
  let activeAdapter = null;
  let wasRateLimited = false;
  let observerActive = false;

  // ── Find the right adapter for current page ──

  function detectPlatform() {
    const url = window.location.href;
    const adapters = [
      window.ClaudeAdapter,
      window.ChatGPTAdapter,
      window.GeminiAdapter
    ].filter(Boolean);

    for (const adapter of adapters) {
      if (adapter.matchUrl.test(url)) {
        return adapter;
      }
    }
    return null;
  }

  // ── Rate Limit Monitoring ──

  function checkRateLimit() {
    if (!activeAdapter) return;

    try {
      const isLimited = activeAdapter.isRateLimited();

      if (isLimited && !wasRateLimited) {
        // Just got rate limited
        wasRateLimited = true;
        console.log(`[QueuePilot] Rate limit detected on ${activeAdapter.displayName}`);
        Messenger.sendToBackground(MessageTypes.RATE_LIMIT_DETECTED, {
          platform: activeAdapter.name,
          timestamp: Date.now(),
          url: window.location.href
        });
      } else if (!isLimited && wasRateLimited) {
        // Rate limit just cleared
        wasRateLimited = false;
        console.log(`[QueuePilot] Rate limit cleared on ${activeAdapter.displayName}`);
        Messenger.sendToBackground(MessageTypes.RATE_LIMIT_CLEARED, {
          platform: activeAdapter.name,
          timestamp: Date.now()
        });
      }
    } catch (err) {
      console.warn('[QueuePilot] Error checking rate limit:', err.message);
    }
  }

  // ── DOM Mutation Observer (catches dynamic rate limit banners) ──

  function startObserver() {
    if (observerActive) return;
    observerActive = true;

    const observer = new MutationObserver((mutations) => {
      // Only check if we see significant DOM changes
      let shouldCheck = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
          shouldCheck = true;
          break;
        }
      }
      if (shouldCheck) {
        // Debounce: wait a tick so the DOM settles
        setTimeout(checkRateLimit, 500);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // ── Message Handlers (from background worker) ──

  function setupMessageHandlers() {
    Messenger.onMessage({
      [MessageTypes.CHECK_RATE_LIMIT]: () => {
        if (!activeAdapter) return { rateLimited: false, platform: null };
        return {
          rateLimited: activeAdapter.isRateLimited(),
          platform: activeAdapter.name,
          inputReady: activeAdapter.isInputReady(),
          streaming: activeAdapter.isResponseStreaming()
        };
      },

      [MessageTypes.SUBMIT_PROMPT]: async (data) => {
        if (!activeAdapter) return { success: false, error: 'No adapter found' };
        try {
          await activeAdapter.submitPrompt(data.text);
          return { success: true, platform: activeAdapter.name };
        } catch (err) {
          return { success: false, error: err.message };
        }
      },

      [MessageTypes.GET_PLATFORM_STATUS]: () => {
        if (!activeAdapter) return { active: false };
        return {
          active: true,
          platform: activeAdapter.name,
          displayName: activeAdapter.displayName,
          rateLimited: activeAdapter.isRateLimited(),
          inputReady: activeAdapter.isInputReady(),
          streaming: activeAdapter.isResponseStreaming()
        };
      }
    });
  }

  // ── Initialize ──

  function init() {
    activeAdapter = detectPlatform();
    if (!activeAdapter) {
      console.log('[QueuePilot] No matching platform adapter for this page');
      return;
    }

    console.log(`[QueuePilot] Loaded on ${activeAdapter.displayName}`);

    // Tell background we're ready
    Messenger.sendToBackground(MessageTypes.PLATFORM_READY, {
      platform: activeAdapter.name,
      displayName: activeAdapter.displayName
    });

    // Setup handlers
    setupMessageHandlers();

    // Start monitoring
    checkRateLimit();
    setInterval(checkRateLimit, POLL_INTERVAL);
    startObserver();
  }

  // Wait for page to be fully ready
  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();
