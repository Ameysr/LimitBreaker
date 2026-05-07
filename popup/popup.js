/**
 * QueuePilot — Popup Controller
 * Manages the popup UI: queue display, adding/removing prompts,
 * status updates, settings, and communication with background worker.
 */

(function () {
  'use strict';

  // ── DOM References ──
  const els = {
    statusBar: document.getElementById('statusBar'),
    statusText: document.getElementById('statusText'),
    statusDetail: document.getElementById('statusDetail'),
    progressContainer: document.getElementById('progressContainer'),
    progressLabel: document.getElementById('progressLabel'),
    progressCount: document.getElementById('progressCount'),
    progressBar: document.getElementById('progressBar'),
    promptInput: document.getElementById('promptInput'),
    addBtn: document.getElementById('addBtn'),
    charCount: document.getElementById('charCount'),
    queueList: document.getElementById('queueList'),
    queueCount: document.getElementById('queueCount'),
    pauseBtn: document.getElementById('pauseBtn'),
    clearBtn: document.getElementById('clearBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    settingsPanel: document.getElementById('settingsPanel'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    settingAutoSubmit: document.getElementById('settingAutoSubmit'),
    settingNotifyHit: document.getElementById('settingNotifyHit'),
    settingNotifyClear: document.getElementById('settingNotifyClear'),
    settingNotifyDone: document.getElementById('settingNotifyDone')
  };

  let currentState = { queue: [], status: {}, settings: {}, history: [] };

  // ── Communication ──

  async function sendMessage(type, data = {}) {
    try {
      return await chrome.runtime.sendMessage({ type, data, source: 'popup' });
    } catch (err) {
      console.warn('[QueuePilot Popup] Send failed:', err.message);
      return null;
    }
  }

  async function loadState() {
    const state = await sendMessage('GET_STATE');
    if (state) {
      currentState = state;
      render();
    }
  }

  // ── Rendering ──

  function render() {
    renderStatus();
    renderProgress();
    renderQueue();
    renderSettings();
  }

  function renderStatus() {
    const { status } = currentState;
    const bar = els.statusBar;

    bar.className = 'status-bar';

    if (status.queuePaused) {
      bar.classList.add('status-paused');
      els.statusText.textContent = 'Paused';
      els.statusDetail.textContent = '';
      updatePauseBtn(true);
    } else if (status.isRateLimited) {
      bar.classList.add('status-limited');
      els.statusText.textContent = 'Rate Limited';
      els.statusDetail.textContent = status.platform ? `on ${status.platform}` : '';
      updatePauseBtn(false);
    } else if (status.queueRunning) {
      bar.classList.add('status-running');
      els.statusText.textContent = 'Processing Queue';
      els.statusDetail.textContent = `${status.completedPrompts || 0}/${status.totalPrompts || 0}`;
      updatePauseBtn(false);
    } else {
      const pending = currentState.queue.filter(i => i.status === 'pending').length;
      if (pending > 0) {
        bar.classList.add('status-monitoring');
        els.statusText.textContent = 'Ready';
        els.statusDetail.textContent = `${pending} queued`;
      } else {
        bar.classList.add('status-idle');
        els.statusText.textContent = 'Monitoring';
        els.statusDetail.textContent = '';
      }
      updatePauseBtn(false);
    }
  }

  function updatePauseBtn(isPaused) {
    if (isPaused) {
      els.pauseBtn.title = 'Resume Queue';
      els.pauseBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    } else {
      els.pauseBtn.title = 'Pause Queue';
      els.pauseBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
    }
  }

  function renderProgress() {
    const { status } = currentState;
    if (status.queueRunning && status.totalPrompts > 0) {
      els.progressContainer.classList.remove('hidden');
      const pct = Math.round((status.completedPrompts / status.totalPrompts) * 100);
      els.progressBar.style.width = pct + '%';
      els.progressCount.textContent = `${status.completedPrompts}/${status.totalPrompts}`;
      els.progressLabel.textContent = status.isRateLimited ? 'Waiting for limit reset' : 'Processing queue';
    } else {
      els.progressContainer.classList.add('hidden');
    }
  }

  function renderQueue() {
    const { queue } = currentState;
    const pending = queue.filter(i => i.status === 'pending' || i.status === 'submitting');
    els.queueCount.textContent = pending.length;

    if (pending.length === 0) {
      els.queueList.innerHTML = `
        <div class="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3">
            <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="12" y2="17"/>
          </svg>
          <p>No prompts queued</p>
          <span>Add prompts above. They'll be submitted automatically when your limit resets.</span>
        </div>`;
      return;
    }

    els.queueList.innerHTML = pending.map((item, idx) => `
      <div class="queue-item ${item.status === 'submitting' ? 'submitting' : ''}" data-id="${item.id}">
        <div class="queue-item-index">${idx + 1}</div>
        <div class="queue-item-content">
          <div class="queue-item-text">${escapeHtml(item.text)}</div>
          <div class="queue-item-meta">${timeAgo(item.addedAt)}${item.status === 'submitting' ? ' · Submitting...' : ''}</div>
        </div>
        <div class="queue-item-actions">
          ${idx > 0 ? `<button class="icon-btn small" data-action="up" data-id="${item.id}" data-index="${idx}" title="Move Up">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
          </button>` : ''}
          ${idx < pending.length - 1 ? `<button class="icon-btn small" data-action="down" data-id="${item.id}" data-index="${idx}" title="Move Down">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>` : ''}
          <button class="icon-btn small danger" data-action="remove" data-id="${item.id}" title="Remove">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
    `).join('');
  }

  function renderSettings() {
    const { settings } = currentState;
    els.settingAutoSubmit.checked = settings.autoSubmit !== false;
    els.settingNotifyHit.checked = settings.notifyOnLimitHit !== false;
    els.settingNotifyClear.checked = settings.notifyOnLimitClear !== false;
    els.settingNotifyDone.checked = settings.notifyOnComplete !== false;
  }

  // ── Event Handlers ──

  els.promptInput.addEventListener('input', () => {
    els.charCount.textContent = els.promptInput.value.length;
    els.addBtn.disabled = els.promptInput.value.trim().length === 0;
  });

  els.promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      addPrompt();
    }
  });

  els.addBtn.addEventListener('click', addPrompt);

  async function addPrompt() {
    const text = els.promptInput.value.trim();
    if (!text) return;

    els.addBtn.disabled = true;
    const result = await sendMessage('ADD_TO_QUEUE', { text });
    if (result && result.success) {
      els.promptInput.value = '';
      els.charCount.textContent = '0';
      await loadState();
    }
    els.addBtn.disabled = false;
    els.promptInput.focus();
  }

  els.queueList.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if (action === 'remove') {
      await sendMessage('REMOVE_FROM_QUEUE', { id });
      await loadState();
    } else if (action === 'up') {
      const idx = parseInt(btn.dataset.index);
      await sendMessage('REORDER_QUEUE', { fromIndex: idx, toIndex: idx - 1 });
      await loadState();
    } else if (action === 'down') {
      const idx = parseInt(btn.dataset.index);
      await sendMessage('REORDER_QUEUE', { fromIndex: idx, toIndex: idx + 1 });
      await loadState();
    }
  });

  els.pauseBtn.addEventListener('click', async () => {
    if (currentState.status.queuePaused) {
      await sendMessage('RESUME_QUEUE');
    } else {
      await sendMessage('PAUSE_QUEUE');
    }
    await loadState();
  });

  els.clearBtn.addEventListener('click', async () => {
    const pending = currentState.queue.filter(i => i.status === 'pending').length;
    if (pending === 0) return;
    await sendMessage('CLEAR_QUEUE');
    await loadState();
  });

  els.settingsBtn.addEventListener('click', () => {
    els.settingsPanel.classList.remove('hidden');
  });

  els.closeSettingsBtn.addEventListener('click', () => {
    els.settingsPanel.classList.add('hidden');
  });

  // Settings toggles
  const settingInputs = [
    { el: els.settingAutoSubmit, key: 'autoSubmit' },
    { el: els.settingNotifyHit, key: 'notifyOnLimitHit' },
    { el: els.settingNotifyClear, key: 'notifyOnLimitClear' },
    { el: els.settingNotifyDone, key: 'notifyOnComplete' }
  ];

  settingInputs.forEach(({ el, key }) => {
    el.addEventListener('change', async () => {
      await sendMessage('UPDATE_SETTINGS', { [key]: el.checked });
    });
  });

  // ── Helpers ──

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function timeAgo(timestamp) {
    if (!timestamp) return '';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  // ── Auto-refresh ──

  loadState();
  setInterval(loadState, 3000); // Refresh every 3 seconds

  // Listen for state updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'STATE_UPDATED') {
      loadState();
    }
  });
})();
