/**
 * LimitBreaker — Popup Controller
 * Manages the popup UI: platform detection, queue display,
 * adding/removing prompts, status updates, settings.
 */

(function () {
  'use strict';

  const els = {
    platformBar: document.getElementById('platformBar'),
    platformIcon: document.getElementById('platformIcon'),
    platformName: document.getElementById('platformName'),
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

  const PLATFORM_INFO = {
    claude: { icon: '🟣', name: 'Claude.ai', color: '#d4a574' },
    chatgpt: { icon: '🟢', name: 'ChatGPT', color: '#10a37f' },
    gemini: { icon: '🔵', name: 'Google Gemini', color: '#4285f4' }
  };

  let currentState = { queue: [], status: {}, settings: {}, history: [] };
  let detectedPlatform = null;

  // ── Communication ──

  async function sendMessage(type, data) {
    try {
      return await chrome.runtime.sendMessage({ type: type, data: data || {}, source: 'popup' });
    } catch (err) {
      console.warn('[LimitBreaker Popup] Send failed:', err.message);
      return null;
    }
  }

  // ── Detect which AI platform tab is open ──

  async function detectPlatform() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length > 0) {
        const url = tabs[0].url || '';
        if (url.includes('claude.ai')) {
          detectedPlatform = 'claude';
        } else if (url.includes('chatgpt.com') || url.includes('chat.openai.com')) {
          detectedPlatform = 'chatgpt';
        } else if (url.includes('gemini.google.com')) {
          detectedPlatform = 'gemini';
        }
      }

      // Also check all tabs for any AI platform
      if (!detectedPlatform) {
        const aiTabs = await chrome.tabs.query({ url: [
          'https://claude.ai/*',
          'https://chatgpt.com/*',
          'https://chat.openai.com/*',
          'https://gemini.google.com/*'
        ]});
        if (aiTabs.length > 0) {
          const url = aiTabs[0].url || '';
          if (url.includes('claude.ai')) detectedPlatform = 'claude';
          else if (url.includes('chatgpt.com') || url.includes('chat.openai.com')) detectedPlatform = 'chatgpt';
          else if (url.includes('gemini.google.com')) detectedPlatform = 'gemini';
        }
      }
    } catch (err) {
      console.warn('[LimitBreaker] Tab detection failed:', err.message);
    }

    renderPlatformBar();
  }

  function renderPlatformBar() {
    if (detectedPlatform && PLATFORM_INFO[detectedPlatform]) {
      const info = PLATFORM_INFO[detectedPlatform];
      els.platformIcon.textContent = info.icon;
      els.platformName.textContent = 'Connected to ' + info.name;
      els.platformBar.classList.add('connected');
      els.platformBar.style.borderLeftColor = info.color;
    } else {
      els.platformIcon.textContent = '⚠️';
      els.platformName.textContent = 'No AI platform tab found';
      els.platformBar.classList.remove('connected');
      els.platformBar.style.borderLeftColor = '#f59e0b';
    }
  }

  // ── State Management ──

  async function loadState() {
    var state = await sendMessage('GET_STATE');
    if (state && !state.error) {
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
    var status = currentState.status;
    var bar = els.statusBar;
    bar.className = 'status-bar';

    if (status.queuePaused) {
      bar.classList.add('status-paused');
      els.statusText.textContent = 'Paused';
      els.statusDetail.textContent = '';
      updatePauseBtn(true);
    } else if (status.isRateLimited) {
      bar.classList.add('status-limited');
      els.statusText.textContent = 'Rate Limited';
      var p = status.platform;
      els.statusDetail.textContent = p && PLATFORM_INFO[p] ? 'on ' + PLATFORM_INFO[p].name : '';
      updatePauseBtn(false);
    } else if (status.queueRunning) {
      bar.classList.add('status-running');
      els.statusText.textContent = 'Processing Queue';
      els.statusDetail.textContent = (status.completedPrompts || 0) + '/' + (status.totalPrompts || 0);
      updatePauseBtn(false);
    } else {
      var pending = currentState.queue.filter(function(i) { return i.status === 'pending'; }).length;
      if (pending > 0) {
        bar.classList.add('status-monitoring');
        els.statusText.textContent = 'Ready';
        els.statusDetail.textContent = pending + ' queued';
      } else {
        bar.classList.add('status-idle');
        els.statusText.textContent = 'Monitoring';
        els.statusDetail.textContent = detectedPlatform ? PLATFORM_INFO[detectedPlatform].name : '';
      }
      updatePauseBtn(false);
    }
  }

  function updatePauseBtn(isPaused) {
    if (isPaused) {
      els.pauseBtn.title = 'Resume Queue';
      els.pauseBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
    } else {
      els.pauseBtn.title = 'Pause Queue';
      els.pauseBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
    }
  }

  function renderProgress() {
    var status = currentState.status;
    if (status.queueRunning && status.totalPrompts > 0) {
      els.progressContainer.classList.remove('hidden');
      var pct = Math.round((status.completedPrompts / status.totalPrompts) * 100);
      els.progressBar.style.width = pct + '%';
      els.progressCount.textContent = (status.completedPrompts || 0) + '/' + (status.totalPrompts || 0);
      els.progressLabel.textContent = status.isRateLimited ? 'Waiting for limit reset' : 'Processing queue';
    } else {
      els.progressContainer.classList.add('hidden');
    }
  }

  function renderQueue() {
    var queue = currentState.queue;
    var pending = queue.filter(function(i) { return i.status === 'pending' || i.status === 'submitting'; });
    els.queueCount.textContent = pending.length;

    if (pending.length === 0) {
      els.queueList.innerHTML =
        '<div class="empty-state">' +
        '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3">' +
        '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="12" y2="17"/>' +
        '</svg>' +
        '<p>No prompts queued</p>' +
        '<span>Add prompts above. They\'ll be submitted automatically when your limit resets.</span>' +
        '</div>';
      return;
    }

    var html = '';
    for (var idx = 0; idx < pending.length; idx++) {
      var item = pending[idx];
      var cls = item.status === 'submitting' ? ' submitting' : '';
      html += '<div class="queue-item' + cls + '" data-id="' + item.id + '">';
      html += '<div class="queue-item-index">' + (idx + 1) + '</div>';
      html += '<div class="queue-item-content">';
      html += '<div class="queue-item-text">' + escapeHtml(item.text) + '</div>';
      html += '<div class="queue-item-meta">' + timeAgo(item.addedAt) + (item.status === 'submitting' ? ' · Submitting...' : '') + '</div>';
      html += '</div>';
      html += '<div class="queue-item-actions">';
      if (idx > 0) {
        html += '<button class="icon-btn small" data-action="up" data-id="' + item.id + '" data-index="' + idx + '" title="Move Up"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>';
      }
      if (idx < pending.length - 1) {
        html += '<button class="icon-btn small" data-action="down" data-id="' + item.id + '" data-index="' + idx + '" title="Move Down"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>';
      }
      html += '<button class="icon-btn small danger" data-action="remove" data-id="' + item.id + '" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
      html += '</div></div>';
    }
    els.queueList.innerHTML = html;
  }

  function renderSettings() {
    var s = currentState.settings;
    els.settingAutoSubmit.checked = s.autoSubmit !== false;
    els.settingNotifyHit.checked = s.notifyOnLimitHit !== false;
    els.settingNotifyClear.checked = s.notifyOnLimitClear !== false;
    els.settingNotifyDone.checked = s.notifyOnComplete !== false;
  }

  // ── Event Handlers ──

  els.promptInput.addEventListener('input', function() {
    els.charCount.textContent = els.promptInput.value.length;
    els.addBtn.disabled = els.promptInput.value.trim().length === 0;
  });

  els.promptInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      addPrompt();
    }
  });

  els.addBtn.addEventListener('click', addPrompt);

  async function addPrompt() {
    var text = els.promptInput.value.trim();
    if (!text) return;
    els.addBtn.disabled = true;
    var result = await sendMessage('ADD_TO_QUEUE', { text: text });
    if (result && result.success) {
      els.promptInput.value = '';
      els.charCount.textContent = '0';
      await loadState();
    }
    els.addBtn.disabled = false;
    els.promptInput.focus();
  }

  els.queueList.addEventListener('click', async function(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;
    var id = btn.dataset.id;
    if (action === 'remove') {
      await sendMessage('REMOVE_FROM_QUEUE', { id: id });
    } else if (action === 'up') {
      await sendMessage('REORDER_QUEUE', { fromIndex: parseInt(btn.dataset.index), toIndex: parseInt(btn.dataset.index) - 1 });
    } else if (action === 'down') {
      await sendMessage('REORDER_QUEUE', { fromIndex: parseInt(btn.dataset.index), toIndex: parseInt(btn.dataset.index) + 1 });
    }
    await loadState();
  });

  els.pauseBtn.addEventListener('click', async function() {
    if (currentState.status.queuePaused) {
      await sendMessage('RESUME_QUEUE');
    } else {
      await sendMessage('PAUSE_QUEUE');
    }
    await loadState();
  });

  els.clearBtn.addEventListener('click', async function() {
    await sendMessage('CLEAR_QUEUE');
    await loadState();
  });

  els.settingsBtn.addEventListener('click', function() {
    els.settingsPanel.classList.remove('hidden');
  });

  els.closeSettingsBtn.addEventListener('click', function() {
    els.settingsPanel.classList.add('hidden');
  });

  els.settingAutoSubmit.addEventListener('change', function() {
    sendMessage('UPDATE_SETTINGS', { autoSubmit: els.settingAutoSubmit.checked });
  });
  els.settingNotifyHit.addEventListener('change', function() {
    sendMessage('UPDATE_SETTINGS', { notifyOnLimitHit: els.settingNotifyHit.checked });
  });
  els.settingNotifyClear.addEventListener('change', function() {
    sendMessage('UPDATE_SETTINGS', { notifyOnLimitClear: els.settingNotifyClear.checked });
  });
  els.settingNotifyDone.addEventListener('change', function() {
    sendMessage('UPDATE_SETTINGS', { notifyOnComplete: els.settingNotifyDone.checked });
  });

  // ── Helpers ──

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function timeAgo(timestamp) {
    if (!timestamp) return '';
    var seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    return Math.floor(hours / 24) + 'd ago';
  }

  // ── Init ──

  detectPlatform();
  loadState();
  setInterval(loadState, 3000);
  setInterval(detectPlatform, 5000);

  chrome.runtime.onMessage.addListener(function(message) {
    if (message.type === 'STATE_UPDATED') loadState();
  });
})();
