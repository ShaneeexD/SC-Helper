// Elements
const lockBtn = document.getElementById('lockBtn');
const closeBtn = document.getElementById('closeBtn');
const llmInput = document.getElementById('llmInput');
const llmAskBtn = document.getElementById('llmAskBtn');
const llmClearBtn = document.getElementById('llmClearBtn');
const llmAnswerEl = document.getElementById('llmAnswer');
const gameStatusEl = document.getElementById('gameStatus');
const llmStatusEl = document.getElementById('llmStatus');
const overlayRoot = document.querySelector('.overlay');
// Settings elements
const settingsBtn = document.getElementById('settingsBtn');
const settingsMenu = document.getElementById('settingsMenu');
const gameStatusRow = document.getElementById('gameStatusRow');
const llmStatusPanel = document.getElementById('llmStatusPanel');
const aiPanel = document.getElementById('aiPanel');
const timerPanel = document.getElementById('timerPanel');
const toggleGame = document.getElementById('toggleGame');
const toggleLLM = document.getElementById('toggleLLM');
const toggleAI = document.getElementById('toggleAI');
const toggleTimer = document.getElementById('toggleTimer');

// Timer elements
const timerModeSel = document.getElementById('timerMode');
const timerInput = document.getElementById('timerInput');
const timerDisplay = document.getElementById('timerDisplay');
const timerStartPauseBtn = document.getElementById('timerStartPause');
const timerResetBtn = document.getElementById('timerReset');
let timerInterval = null;
let timerRunning = false;
let timerMode = (timerModeSel?.value) || 'up';
let timerMs = 0; // current remaining (down) or elapsed (up) in ms
let targetMs = 0; // for countdown

// Minimal, safe markdown renderer (escape first)
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- Timer helpers ---
function pad(n) { return String(n).padStart(2, '0'); }
function formatMMSS(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${pad(m)}:${pad(s)}`;
}
function parseMMSS(str) {
  const m = String(str || '').trim();
  if (!m) return 0;
  const parts = m.split(':');
  if (parts.length !== 2) return 0;
  const mm = parseInt(parts[0], 10);
  const ss = parseInt(parts[1], 10);
  if (isNaN(mm) || isNaN(ss) || mm < 0 || ss < 0) return 0;
  return (mm * 60 + ss) * 1000;
}
function renderTimer() {
  if (!timerDisplay) return;
  timerDisplay.textContent = formatMMSS(timerMs);
}
function stopTimerInterval() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}
function setTimerMode(mode) {
  timerMode = mode === 'down' ? 'down' : 'up';
  if (timerInput) timerInput.disabled = timerMode === 'up';
}
function startTimer() {
  if (timerRunning) return;
  // Initialize timers based on mode
  if (timerMode === 'down') {
    if (timerMs <= 0) {
      targetMs = parseMMSS(timerInput?.value);
      timerMs = targetMs;
    }
  } else {
    // up mode: continue from current timerMs (elapsed)
  }
  timerRunning = true;
  timerStartPauseBtn && (timerStartPauseBtn.textContent = 'Pause');
  const tick = () => {
    if (timerMode === 'down') {
      timerMs = Math.max(0, timerMs - 1000);
      renderTimer();
      reportSize();
      if (timerMs <= 0) {
        stopTimerInterval();
        timerRunning = false;
        timerStartPauseBtn && (timerStartPauseBtn.textContent = 'Start');
        // Beep on completion
        beep({ freq: 880, duration: 400, type: 'sine', volume: 0.25 });
      }
    } else {
      timerMs += 1000;
      renderTimer();
      reportSize();
    }
  };
  // Immediate render so UI updates without 1s delay
  renderTimer();
  reportSize();
  stopTimerInterval();
  timerInterval = setInterval(tick, 1000);
}
function pauseTimer() {
  if (!timerRunning) return;
  timerRunning = false;
  stopTimerInterval();
  timerStartPauseBtn && (timerStartPauseBtn.textContent = 'Start');
}
function resetTimer() {
  stopTimerInterval();
  timerRunning = false;
  if (timerMode === 'down') {
    timerMs = parseMMSS(timerInput?.value);
  } else {
    timerMs = 0;
  }
  timerStartPauseBtn && (timerStartPauseBtn.textContent = 'Start');
  renderTimer();
  reportSize();
}

// Beep using Web Audio API
let _audioCtx;
function beep({ freq = 880, duration = 350, type = 'sine', volume = 0.2 } = {}) {
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
    gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + duration / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration / 1000 + 0.02);
  } catch (_) { /* ignore */ }
}

// Timer event wiring
if (timerModeSel) {
  timerModeSel.addEventListener('change', () => {
    setTimerMode(timerModeSel.value);
    if (timerRunning) {
      // Pause when switching modes to avoid odd states
      pauseTimer();
    }
    resetTimer();
  });
  setTimerMode(timerModeSel.value);
}
if (timerStartPauseBtn) {
  timerStartPauseBtn.addEventListener('click', () => {
    if (timerRunning) pauseTimer(); else startTimer();
  });
}
if (timerResetBtn) {
  timerResetBtn.addEventListener('click', () => {
    resetTimer();
  });
}
if (timerInput) {
  timerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (timerRunning) pauseTimer(); else startTimer();
    }
  });
}
// Initial render
renderTimer();

function mdToSafeHtml(md) {
  const escaped = escapeHtml(md);
  // code
  let html = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
  // bold then italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  // links
  html = html.replace(/(https?:\/\/[^\s)]+)(?![^<]*>)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  // line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
}

// Resize helper
async function reportSize() {
  if (!overlayRoot) return;
  const rect = overlayRoot.getBoundingClientRect();
  try { await window.overlay.resizeToContent(rect.height); } catch (_) {}
}

// Observe overlay size changes
if (window.ResizeObserver && overlayRoot) {
  const ro = new ResizeObserver(() => reportSize());
  ro.observe(overlayRoot);
}

function renderStatus(payload) {
  if (!payload || payload.error) {
    updateGameStatus('unknown', 'Unknown');
    return;
  }
  const txt = (payload.overallText || '').trim();
  // Map common phrases to pill states
  const L = txt.toLowerCase();
  let state = 'unknown';
  let label = txt || 'Unknown';
  if (/operational|all systems operational/.test(L)) { state = 'ok'; label = 'Operational'; }
  else if (/degraded/.test(L)) { state = 'degraded'; label = 'Degraded'; }
  else if (/partial/.test(L)) { state = 'partial'; label = 'Partial Outage'; }
  else if (/major|outage|unavailable|down/.test(L)) { state = 'major'; label = 'Major Outage'; }
  else if (/maintenance/.test(L)) { state = 'degraded'; label = 'Maintenance'; }
  updateGameStatus(state, label);
}

function updateGameStatus(state, label) {
  if (!gameStatusEl) return;
  const classes = ['status-unknown','status-ok','status-degraded','status-partial','status-major'];
  gameStatusEl.classList.remove(...classes);
  const cls = `status-${state}`;
  if (classes.includes(cls)) gameStatusEl.classList.add(cls);
  else gameStatusEl.classList.add('status-unknown');
  gameStatusEl.textContent = label || 'Unknown';
}

async function refreshStatus() {
  try {
    const data = await window.overlay.getStatus();
    renderStatus(data);
  } catch (e) {
    // Ignore text; just set unknown pill
    updateGameStatus('unknown', 'Unknown');
  }
}

function updateLlmStatus(ok) {
  if (!llmStatusEl) return;
  const classes = ['status-unknown','status-ok','status-degraded','status-partial','status-major'];
  llmStatusEl.classList.remove(...classes);
  if (ok) {
    llmStatusEl.classList.add('status-ok');
    llmStatusEl.textContent = 'Operational';
  } else {
    llmStatusEl.classList.add('status-major');
    llmStatusEl.textContent = 'Unavailable';
  }
}

async function syncLockBtn() {
  const { clickThrough } = await window.overlay.getClickThrough();
  lockBtn.textContent = clickThrough ? 'Locked' : 'Unlocked';
  lockBtn.classList.toggle('active', !clickThrough);
}

lockBtn.addEventListener('click', async () => {
  const { clickThrough } = await window.overlay.getClickThrough();
  const res = await window.overlay.setClickThrough(!clickThrough);
  lockBtn.textContent = res.clickThrough ? 'Locked' : 'Unlocked';
});

window.overlay.onClickThroughChanged(async ({ clickThrough }) => {
  lockBtn.textContent = clickThrough ? 'Locked' : 'Unlocked';
});

closeBtn.addEventListener('click', async () => {
  try { await window.overlay.quit(); } catch (_) {}
});

llmAskBtn.addEventListener('click', async () => {
  const q = (llmInput.value || '').trim();
  if (!q) {
    llmAnswerEl.textContent = 'Enter a question.';
    return;
  }
  // Clear input after capturing the question
  llmInput.value = '';
  llmAnswerEl.textContent = 'Analyzing…';
  const res = await window.overlay.llmQuery(q);
  if (!res || res.error) {
    llmAnswerEl.textContent = res?.message || 'LLM error';
    return;
  }
  llmAnswerEl.innerHTML = mdToSafeHtml(res.text || 'No answer.');
  // Ensure window resizes to fit the new answer text
  reportSize();
});

// Pressing Enter in the input triggers Ask
llmInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    llmAskBtn.click();
  }
});

// Clear button: clears input and answer and shrinks overlay if needed
if (llmClearBtn) {
  llmClearBtn.addEventListener('click', () => {
    llmInput.value = '';
    llmAnswerEl.textContent = '';
    reportSize();
    llmInput.focus();
  });
}

// Initial load
syncLockBtn();
refreshStatus();
setInterval(refreshStatus, 60_000);

// LLM health check on load and every 5 minutes
(async function initLlmHealth() {
  try {
    const res = await window.overlay.llmHealth();
    updateLlmStatus(Boolean(res && res.ok));
  } catch (_) {
    updateLlmStatus(false);
  }
})();
setInterval(async () => {
  try {
    const res = await window.overlay.llmHealth();
    updateLlmStatus(Boolean(res && res.ok));
  } catch (_) {
    updateLlmStatus(false);
  }
}, 300_000);

// Initial size
reportSize();

// ------- Settings: panel visibility -------
const PANEL_STORE_KEY = 'sc_helper_panel_toggles_v1';
function getPanelToggles() {
  try { return JSON.parse(localStorage.getItem(PANEL_STORE_KEY)) || {}; } catch { return {}; }
}
function savePanelToggles(t) {
  try { localStorage.setItem(PANEL_STORE_KEY, JSON.stringify(t)); } catch {}
}
function applyPanelToggles(t) {
  if (gameStatusRow) gameStatusRow.style.display = t.game !== false ? '' : 'none';
  if (llmStatusPanel) llmStatusPanel.style.display = t.llm !== false ? '' : 'none';
  if (aiPanel) aiPanel.style.display = t.ai !== false ? '' : 'none';
  if (timerPanel) timerPanel.style.display = t.timer !== false ? '' : 'none';
  // Sync checkboxes if present
  if (toggleGame) toggleGame.checked = t.game !== false;
  if (toggleLLM) toggleLLM.checked = t.llm !== false;
  if (toggleAI) toggleAI.checked = t.ai !== false;
  if (toggleTimer) toggleTimer.checked = t.timer !== false;
  reportSize();
}
const initialToggles = getPanelToggles();
applyPanelToggles(initialToggles);

function updateToggle(key, checked) {
  const current = getPanelToggles();
  current[key] = checked; // true means visible; false hidden
  savePanelToggles(current);
  applyPanelToggles(current);
}

if (toggleGame) toggleGame.addEventListener('change', () => updateToggle('game', toggleGame.checked));
if (toggleLLM) toggleLLM.addEventListener('change', () => updateToggle('llm', toggleLLM.checked));
if (toggleAI) toggleAI.addEventListener('change', () => updateToggle('ai', toggleAI.checked));
if (toggleTimer) toggleTimer.addEventListener('change', () => updateToggle('timer', toggleTimer.checked));

// Settings menu open/close
function openMenu() { settingsMenu?.classList.remove('hidden'); }
function closeMenu() { settingsMenu?.classList.add('hidden'); }
function toggleMenu() { if (!settingsMenu) return; settingsMenu.classList.toggle('hidden'); }

if (settingsBtn) settingsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
if (settingsMenu) settingsMenu.addEventListener('click', (e) => e.stopPropagation());
// Click outside closes
document.addEventListener('click', () => closeMenu());
// ESC closes
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
