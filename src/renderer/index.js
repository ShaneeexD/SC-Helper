// Elements
const lockBtn = document.getElementById('lockBtn');
const closeBtn = document.getElementById('closeBtn');
const llmInput = document.getElementById('llmInput');
const llmAskBtn = document.getElementById('llmAskBtn');
const llmAnswerEl = document.getElementById('llmAnswer');
const gameStatusEl = document.getElementById('gameStatus');
const llmStatusEl = document.getElementById('llmStatus');
const overlayRoot = document.querySelector('.overlay');

// Minimal, safe markdown renderer (escape first)
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
