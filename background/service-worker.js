/**
 * LimitBreaker — Background Service Worker
 * Orchestrates the entire queue system: polling, auto-submit, notifications, alarms.
 */

// ── Storage helpers (duplicated for service worker context) ──
const KEYS = {
  QUEUE: 'qp_queue',
  SETTINGS: 'qp_settings',
  STATUS: 'qp_status',
  HISTORY: 'qp_history'
};

const DEFAULT_SETTINGS = {
  autoSubmit: true,
  pollIntervalSeconds: 30,
  notifyOnLimitHit: true,
  notifyOnLimitClear: true,
  notifyOnComplete: true,
  enabledPlatforms: ['claude', 'chatgpt', 'gemini']
};

const DEFAULT_STATUS = {
  isRateLimited: false,
  platform: null,
  limitDetectedAt: null,
  estimatedResetTime: null,
  queueRunning: false,
  queuePaused: false,
  currentPromptIndex: 0,
  totalPrompts: 0,
  completedPrompts: 0
};

async function getQueue() {
  const r = await chrome.storage.local.get(KEYS.QUEUE);
  return r[KEYS.QUEUE] || [];
}

async function setQueue(queue) {
  await chrome.storage.local.set({ [KEYS.QUEUE]: queue });
}

async function getSettings() {
  const r = await chrome.storage.local.get(KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(r[KEYS.SETTINGS] || {}) };
}

async function getStatus() {
  const r = await chrome.storage.local.get(KEYS.STATUS);
  return { ...DEFAULT_STATUS, ...(r[KEYS.STATUS] || {}) };
}

async function updateStatus(updates) {
  const status = await getStatus();
  const updated = { ...status, ...updates };
  await chrome.storage.local.set({ [KEYS.STATUS]: updated });
  return updated;
}

async function addToHistory(item) {
  const r = await chrome.storage.local.get(KEYS.HISTORY);
  const history = r[KEYS.HISTORY] || [];
  history.unshift({ ...item, completedAt: Date.now() });
  if (history.length > 50) history.length = 50;
  await chrome.storage.local.set({ [KEYS.HISTORY]: history });
}

// ── Badge Management ──

function updateBadge(count, color = '#7c3aed') {
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color });
}

async function refreshBadge() {
  const queue = await getQueue();
  const pending = queue.filter(i => i.status === 'pending').length;
  const status = await getStatus();
  if (status.isRateLimited) {
    updateBadge(pending, '#ef4444'); // Red when rate limited
  } else if (pending > 0) {
    updateBadge(pending, '#7c3aed'); // Purple when items queued
  } else {
    updateBadge(0);
  }
}

// ── Notifications ──

async function notify(title, message, id = 'qp_' + Date.now()) {
  const settings = await getSettings();
  try {
    chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'LimitBreaker: ' + title,
      message: message,
      priority: 2
    });
  } catch (err) {
    console.warn('[LimitBreaker] Notification failed:', err.message);
  }
}

// ── Active Tab Tracking ──

let activeAITabId = null;
let activePlatform = null;

async function findAITab() {
  const tabs = await chrome.tabs.query({ url: [
    'https://claude.ai/*',
    'https://chatgpt.com/*',
    'https://chat.openai.com/*',
    'https://gemini.google.com/*'
  ]});
  if (tabs.length > 0) {
    activeAITabId = tabs[0].id;
    return tabs[0];
  }
  return null;
}

// ── Queue Processing ──

let processingQueue = false;

async function processNextInQueue() {
  if (processingQueue) return;
  processingQueue = true;

  try {
    const status = await getStatus();
    if (status.queuePaused) {
      processingQueue = false;
      return;
    }

    const queue = await getQueue();
    const nextItem = queue.find(i => i.status === 'pending');

    if (!nextItem) {
      await updateStatus({ queueRunning: false, completedPrompts: status.completedPrompts });
      processingQueue = false;
      refreshBadge();

      const settings = await getSettings();
      if (settings.notifyOnComplete && status.totalPrompts > 0) {
        notify('All Done', 'All ' + status.totalPrompts + ' prompts have been submitted and completed');
      }
      return;
    }

    // Find the AI tab
    if (!activeAITabId) await findAITab();
    if (!activeAITabId) {
      console.warn('[LimitBreaker] No AI tab found, will retry on next poll');
      processingQueue = false;
      return;
    }

    // Check if rate limited or streaming
    let tabStatus;
    try {
      tabStatus = await chrome.tabs.sendMessage(activeAITabId, {
        type: 'CHECK_RATE_LIMIT', data: {}, source: 'background'
      });
      console.log('[LimitBreaker] Tab status:', JSON.stringify(tabStatus));
    } catch (err) {
      console.warn('[LimitBreaker] Cannot reach content script:', err.message);
      activeAITabId = null;
      processingQueue = false;
      return;
    }

    if (tabStatus && tabStatus.rateLimited) {
      await updateStatus({ isRateLimited: true });
      processingQueue = false;
      refreshBadge();
      return;
    }

    if (tabStatus && tabStatus.streaming) {
      console.log('[LimitBreaker] AI is still streaming, waiting...');
      processingQueue = false;
      return;
    }

    // Mark as submitting
    const queueCopy = await getQueue();
    const idx = queueCopy.findIndex(i => i.id === nextItem.id);
    if (idx !== -1) {
      queueCopy[idx].status = 'submitting';
      queueCopy[idx].retries = (queueCopy[idx].retries || 0);
      await setQueue(queueCopy);
    }

    await updateStatus({
      queueRunning: true,
      currentPromptIndex: status.completedPrompts + 1,
      totalPrompts: queue.filter(i => i.status === 'pending' || i.status === 'submitting').length + status.completedPrompts
    });

    // Submit the prompt
    let result;
    try {
      console.log('[LimitBreaker] Sending SUBMIT_PROMPT to tab:', activeAITabId);
      result = await chrome.tabs.sendMessage(activeAITabId, {
        type: 'SUBMIT_PROMPT',
        data: { text: nextItem.text },
        source: 'background'
      });
      console.log('[LimitBreaker] Submit result:', JSON.stringify(result));
    } catch (err) {
      console.error('[LimitBreaker] Submit message failed:', err.message);
      const q = await getQueue();
      const i = q.findIndex(item => item.id === nextItem.id);
      if (i !== -1) {
        q[i].retries = (q[i].retries || 0) + 1;
        if (q[i].retries >= 3) {
          q[i].status = 'failed';
          console.error('[LimitBreaker] Prompt failed after 3 retries, skipping');
        } else {
          q[i].status = 'pending';
        }
        await setQueue(q);
      }
      processingQueue = false;
      return;
    }

    if (result && result.success) {
      // Mark as completed
      const q = await getQueue();
      const i = q.findIndex(item => item.id === nextItem.id);
      if (i !== -1) {
        q[i].status = 'completed';
        q[i].submittedAt = Date.now();
        await setQueue(q);
        await addToHistory(q[i]);
      }

      await updateStatus({
        completedPrompts: status.completedPrompts + 1
      });

      refreshBadge();
      console.log('[LimitBreaker] Prompt submitted successfully, waiting for response...');

      // Wait for response to complete before submitting next
      setTimeout(async () => {
        processingQueue = false;
        await waitForResponseCompletion();
        processNextInQueue();
      }, 3000);
      return;
    } else {
      // Submission failed
      console.error('[LimitBreaker] Submission returned failure:', result ? result.error : 'no result');
      const q = await getQueue();
      const i = q.findIndex(item => item.id === nextItem.id);
      if (i !== -1) {
        q[i].retries = (q[i].retries || 0) + 1;
        if (q[i].retries >= 3) {
          q[i].status = 'failed';
          console.error('[LimitBreaker] Prompt failed after 3 retries, skipping');
          notify('Prompt Failed', 'Could not submit prompt after 3 attempts. Check the console for details.');
        } else {
          q[i].status = 'pending';
          console.log('[LimitBreaker] Will retry, attempt ' + q[i].retries + ' of 3');
        }
        await setQueue(q);
      }
    }
  } catch (err) {
    console.error('[LimitBreaker] Queue processing error:', err);
  }

  processingQueue = false;
}

async function waitForResponseCompletion(timeoutMs = 120000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (!activeAITabId) return;
    try {
      const status = await chrome.tabs.sendMessage(activeAITabId, {
        type: 'CHECK_RATE_LIMIT', data: {}, source: 'background'
      });
      if (status && !status.streaming) return;
    } catch { return; }
    await new Promise(r => setTimeout(r, 2000));
  }
}

// ── Alarm-based Polling ──

chrome.alarms.create('LimitBreaker-poll', { periodInMinutes: 0.5 }); // Every 30 seconds

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'LimitBreaker-poll') return;

  const status = await getStatus();
  const queue = await getQueue();
  const hasPending = queue.some(i => i.status === 'pending');

  if (!hasPending) return;

  if (status.isRateLimited) {
    // Check if limit has cleared
    if (!activeAITabId) await findAITab();
    if (!activeAITabId) return;

    try {
      const tabStatus = await chrome.tabs.sendMessage(activeAITabId, {
        type: 'CHECK_RATE_LIMIT', data: {}, source: 'background'
      });

      if (tabStatus && !tabStatus.rateLimited) {
        await updateStatus({ isRateLimited: false });
        refreshBadge();

        const settings = await getSettings();
        if (settings.notifyOnLimitClear) {
          notify('Limit Cleared', `${activePlatform || 'AI'} is ready. Processing your queue now...`);
        }

        if (settings.autoSubmit) {
          processNextInQueue();
        }
      }
    } catch (err) {
      activeAITabId = null;
    }
  } else if (status.queueRunning && !status.queuePaused && !processingQueue) {
    processNextInQueue();
  }
});

// ── Message Handlers ──

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = messageHandlers[message.type];
  if (!handler) return false;

  const result = handler(message.data, sender);
  if (result instanceof Promise) {
    result.then(sendResponse).catch(err => {
      console.error('[LimitBreaker] Handler error:', err);
      sendResponse({ error: err.message });
    });
    return true;
  }

  sendResponse(result);
  return false;
});

const messageHandlers = {
  // ── From Content Scripts ──

  [/* MessageTypes */ 'RATE_LIMIT_DETECTED']: async (data) => {
    activePlatform = data.platform;
    await updateStatus({
      isRateLimited: true,
      platform: data.platform,
      limitDetectedAt: data.timestamp
    });
    refreshBadge();

    const settings = await getSettings();
    if (settings.notifyOnLimitHit) {
      notify('Rate Limit Hit', `You've been rate limited on ${data.platform}. Your queue is active and waiting.`);
    }
    return { received: true };
  },

  ['RATE_LIMIT_CLEARED']: async (data) => {
    activePlatform = data.platform;
    await updateStatus({ isRateLimited: false });
    refreshBadge();

    const settings = await getSettings();
    if (settings.notifyOnLimitClear) {
      notify('Limit Cleared', `${data.platform} is back! Processing queue...`);
    }

    if (settings.autoSubmit) {
      processNextInQueue();
    }
    return { received: true };
  },

  ['PLATFORM_READY']: async (data, sender) => {
    activeAITabId = sender.tab?.id || null;
    activePlatform = data.platform;

    // Check if we have pending items to process
    const queue = await getQueue();
    const status = await getStatus();
    const hasPending = queue.some(i => i.status === 'pending');

    if (hasPending && !status.isRateLimited && !status.queuePaused) {
      const settings = await getSettings();
      if (settings.autoSubmit) {
        setTimeout(() => processNextInQueue(), 2000);
      }
    }
    return { received: true };
  },

  ['PROMPT_RESPONSE_COMPLETE']: async () => {
    // Response finished, try next item
    if (!processingQueue) {
      processNextInQueue();
    }
    return { received: true };
  },

  // ── From Popup ──

  ['ADD_TO_QUEUE']: async (data) => {
    const queue = await getQueue();
    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      text: data.text,
      platform: data.platform || null,
      status: 'pending',
      addedAt: Date.now(),
      submittedAt: null
    };
    queue.push(item);
    await setQueue(queue);
    refreshBadge();

    // Start processing if not already
    const status = await getStatus();
    if (!status.isRateLimited && !status.queuePaused && !processingQueue) {
      await updateStatus({ queueRunning: true, totalPrompts: queue.filter(i => i.status === 'pending').length });
      const settings = await getSettings();
      if (settings.autoSubmit) {
        setTimeout(() => processNextInQueue(), 1000);
      }
    }

    return { success: true, item };
  },

  ['REMOVE_FROM_QUEUE']: async (data) => {
    let queue = await getQueue();
    queue = queue.filter(i => i.id !== data.id);
    await setQueue(queue);
    refreshBadge();
    return { success: true, queue };
  },

  ['REORDER_QUEUE']: async (data) => {
    const queue = await getQueue();
    if (data.fromIndex >= 0 && data.toIndex >= 0 && data.fromIndex < queue.length && data.toIndex < queue.length) {
      const [item] = queue.splice(data.fromIndex, 1);
      queue.splice(data.toIndex, 0, item);
      await setQueue(queue);
    }
    return { success: true, queue };
  },

  ['CLEAR_QUEUE']: async () => {
    await setQueue([]);
    await updateStatus({ queueRunning: false, totalPrompts: 0, completedPrompts: 0, currentPromptIndex: 0 });
    refreshBadge();
    return { success: true };
  },

  ['GET_STATE']: async () => {
    const queue = await getQueue();
    const status = await getStatus();
    const settings = await getSettings();
    const r = await chrome.storage.local.get(KEYS.HISTORY);
    const history = r[KEYS.HISTORY] || [];
    return { queue, status, settings, history };
  },

  ['PAUSE_QUEUE']: async () => {
    await updateStatus({ queuePaused: true });
    return { success: true };
  },

  ['RESUME_QUEUE']: async () => {
    await updateStatus({ queuePaused: false });
    const status = await getStatus();
    if (!status.isRateLimited) {
      processNextInQueue();
    }
    return { success: true };
  },

  ['UPDATE_SETTINGS']: async (data) => {
    const settings = await getSettings();
    const updated = { ...settings, ...data };
    await chrome.storage.local.set({ [KEYS.SETTINGS]: updated });
    return { success: true, settings: updated };
  }
};

// ── Tab tracking ──

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeAITabId) {
    activeAITabId = null;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === activeAITabId && changeInfo.status === 'loading') {
    // Tab is reloading, will get PLATFORM_READY again
  }
});

// ── Init ──
refreshBadge();
console.log('[LimitBreaker] Background service worker started');
