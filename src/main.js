const electronModule = require('electron');
console.log('Electron module keys:', Object.keys(electronModule));
try {
  console.log('Electron resolved path:', require.resolve('electron'));
} catch (e) {
  console.log('Electron resolve error:', e?.message || String(e));
}
const { app, BrowserWindow, ipcMain, globalShortcut, Menu, screen } = electronModule;
const path = require('path');
const fs = require('fs');

let mainWindow;
let clickThrough = true; // locked by default (passes clicks through)

// Simple in-memory cache
const cache = {
  rsi: { data: null, ts: 0 },
  wiki: new Map(), // key: query, value: { data, ts }
};

const TTL = {
  rsi: 5 * 60 * 1000, // 5 min
  wiki: 60 * 60 * 1000, // 1 hour
};

// Cache config values
let cachedConfig = null;
function loadConfigOnce() {
  if (cachedConfig) return cachedConfig;
  try {
    // Try project root config.json (src/main.js is in src/, so ../config.json)
    const cfgPath = path.resolve(__dirname, '..', 'config.json');
    if (fs.existsSync(cfgPath)) {
      const raw = fs.readFileSync(cfgPath, 'utf-8');
      cachedConfig = JSON.parse(raw);
      return cachedConfig;
    }
  } catch (e) {
    console.warn('Failed to read config.json:', e?.message || String(e));
  }
  cachedConfig = {};
  return cachedConfig;
}

function getGeminiApiKey() {
  // 1) Environment variable wins
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  // 2) config.json fallback
  const cfg = loadConfigOnce();
  return (
    cfg.GEMINI_API_KEY ||
    cfg.gemini_api_key ||
    cfg.geminiKey ||
    cfg.apiKey ||
    ''
  );
}

function createWindow() {
  // Remove default menu
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 560,
    height: 220,
    frame: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Make it a real overlay
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  setClickThrough(clickThrough);

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setClickThrough(enabled) {
  clickThrough = enabled;
  if (!mainWindow) return;
  // forward: true lets scroll and some events pass to the game
  mainWindow.setIgnoreMouseEvents(enabled, { forward: true });
  // When click-through is enabled, window should not be focusable to avoid stealing focus
  try {
    mainWindow.setFocusable(!enabled);
  } catch (_) {}
}

async function fetchRSIStatus() {
  // Scrape overall status text from the HTML page
  const now = Date.now();
  if (cache.rsiSummary && now - cache.rsiSummary.time < 60_000) return cache.rsiSummary.data;
  try {
    const resp = await fetch('https://status.robertsspaceindustries.com');
    const html = await resp.text();
    // Try to find the page-level status string
    let overallText = '';
    const spanMatch = html.match(/<span[^>]*class=["'][^"']*status[^"']*["'][^>]*>([^<]+)<\/span>/i);
    if (spanMatch && spanMatch[1]) overallText = spanMatch[1].trim();
    if (!overallText) {
      const metaMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i);
      if (metaMatch && metaMatch[1]) overallText = metaMatch[1].trim();
    }
    if (!overallText) {
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch && titleMatch[1]) overallText = titleMatch[1].trim();
    }
    const data = { overallText };
    cache.rsiSummary = { time: now, data };
    return data;
  } catch (e) {
    return { error: true, message: 'Failed to scrape RSI status', details: String(e) };
  }
}

async function fetchWikiShips(query) {
  const key = (query || '').trim().toLowerCase();
  const now = Date.now();
  const cached = cache.wiki.get(key);
  if (cached && now - cached.ts < TTL.wiki) {
    return cached.data;
  }
  try {
    // NOTE: API routes can change; this endpoint works for common queries but may need adjustment per docs.
    const base = 'https://api.star-citizen.wiki/api/ships';
    const u = new URL(base);
    if (key) u.searchParams.set('search', key);
    u.searchParams.set('limit', '5');
    const resp = await fetch(u.toString(), { headers: { 'accept': 'application/json' } });
    if (!resp.ok) throw new Error('Bad response ' + resp.status);
    const json = await resp.json();
    const data = Array.isArray(json?.data) ? json.data : json; // tolerate different shapes
    cache.wiki.set(key, { data, ts: now });
    return data;
  } catch (e) {
    return { error: true, message: 'Unable to fetch Wiki data', details: String(e) };
  }
}

// IPC handlers (registered after app is ready)
function registerIpcHandlers() {
  ipcMain.handle('overlay:getStatus', async () => {
    return await fetchRSIStatus();
  });

  // Ship search removed per request

  ipcMain.handle('overlay:setClickThrough', async (_evt, enabled) => {
    setClickThrough(Boolean(enabled));
    return { clickThrough };
  });

  ipcMain.handle('overlay:getClickThrough', async () => ({ clickThrough }));

  ipcMain.handle('overlay:quit', async () => {
    app.quit();
    return { ok: true };
  });

  ipcMain.handle('overlay:llmQuery', async (_evt, question) => {
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      return { error: true, message: 'GEMINI_API_KEY not set. Set env var or put it in config.json at project root.' };
    }
    try {
      const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent';
      const preamble = [
        'You are an expert assistant focused on Star Citizen.',
        'CONCISENESS: Keep answers short and to-the-point.',
        'SCOPE: Only answer Star Citizen questions. If out-of-scope, say so.',
        'LOOKUP: If Google Search retrieval tools are available, use them when the question involves time-sensitive, numeric, or verifiable facts (e.g., ship prices, locations, spawn availability, patch/PTS details, stats, schedules) or when uncertain. Prefer grounded answers with citations when possible.',
        'EVIDENCE: Avoid fabricating specifics; state uncertainty if needed.'
      ].join(' ');
      const cfg = loadConfigOnce();
      const enableSearch = !!(cfg.enable_google_search || cfg.googleSearch || cfg.enableSearch);
      const body = {
        contents: [
          { parts: [ { text: `${preamble}\n\nUser question: ${String(question || '').slice(0, 2000)}\n\nRespond concisely with only the minimally necessary information.` } ] }
        ],
        ...(enableSearch ? { tools: [ { google_search: {} } ] } : {})
      };
      const resp = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        return { error: true, message: `LLM HTTP ${resp.status}` };
      }
      const json = await resp.json();
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return { text };
    } catch (e) {
      return { error: true, message: 'LLM request failed', details: String(e) };
    }
  });

  // Dynamically resize window to content height
  ipcMain.handle('overlay:resizeToContent', async (_evt, contentHeight) => {
    if (!mainWindow) return { error: true };
    const bounds = mainWindow.getBounds();
    const display = screen.getDisplayMatching(bounds) || screen.getPrimaryDisplay();
    const maxH = Math.floor((display?.workAreaSize?.height || 800) * 0.9);
    const minH = 140;
    // Add small padding for comfort
    const desired = Math.ceil(Number(contentHeight) || 0) + 12;
    const targetH = Math.min(Math.max(desired, minH), maxH);
    mainWindow.setContentSize(bounds.width, targetH);
    return { height: targetH };
  });
}

function registerShortcuts() {
  // Ctrl+Shift+O toggles lock
  globalShortcut.register('Control+Shift+O', () => {
    setClickThrough(!clickThrough);
    if (mainWindow) mainWindow.webContents.send('overlay:clickThroughChanged', { clickThrough });
  });
}

app.whenReady().then(() => {
  createWindow();
  registerIpcHandlers();
  registerShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Keep app running in background for overlays; quit on non-mac as well for simplicity
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
