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
    width: 580,
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

  // Find an image URL on Star Citizen Wiki via MediaWiki API
  // Strategy: resolve article (ns=0) -> get lead image (pageimages original or thumb)
  // Fallback: previous File: search (ns=6)
  ipcMain.handle('overlay:findWikiImage', async (_evt, topic) => {
    try {
      const q = String(topic || '').trim();
      if (!q) return { ok: false, error: 'Empty topic' };

      const apiBase = 'https://starcitizen.tools/api.php';
      const mediaHost = 'media.starcitizen.tools';

      const withinMediaHost = (u) => {
        try { const h = new URL(u).host.toLowerCase(); return h === mediaHost; } catch { return false; }
      };

      // 1) Resolve the top article result for this query (namespace 0)
      const searchU = new URL(apiBase);
      searchU.searchParams.set('action', 'query');
      searchU.searchParams.set('format', 'json');
      searchU.searchParams.set('list', 'search');
      searchU.searchParams.set('srsearch', q);
      searchU.searchParams.set('srnamespace', '0');
      searchU.searchParams.set('srlimit', '1');
      const sResp = await fetch(searchU.toString());
      if (sResp.ok) {
        const sJson = await sResp.json();
        const title = sJson?.query?.search?.[0]?.title;
        if (title) {
          // 2) Try to get the original lead image via pageimages
          const piU = new URL(apiBase);
          piU.searchParams.set('action', 'query');
          piU.searchParams.set('format', 'json');
          piU.searchParams.set('prop', 'pageimages');
          piU.searchParams.set('titles', title);
          piU.searchParams.set('piprop', 'original');
          let piResp = await fetch(piU.toString());
          if (piResp.ok) {
            const piJson = await piResp.json();
            const pages = piJson?.query?.pages || {};
            const first = Object.values(pages)[0];
            const original = first?.original?.source;
            if (original && withinMediaHost(original)) {
              console.log('[overlay:findWikiImage] topic=', q, 'title=', title, 'url=', original);
              return { ok: true, url: original };
            }
          }
          // 3) If original not available, request a large thumbnail
          const pitU = new URL(apiBase);
          pitU.searchParams.set('action', 'query');
          pitU.searchParams.set('format', 'json');
          pitU.searchParams.set('prop', 'pageimages');
          pitU.searchParams.set('titles', title);
          pitU.searchParams.set('pithumbsize', '1600');
          piResp = await fetch(pitU.toString());
          if (piResp.ok) {
            const piJson = await piResp.json();
            const pages = piJson?.query?.pages || {};
            const first = Object.values(pages)[0];
            const thumb = first?.thumbnail?.source;
            if (thumb && withinMediaHost(thumb)) {
              console.log('[overlay:findWikiImage] topic=', q, 'title=', title, 'url=', thumb);
              return { ok: true, url: thumb };
            }
          }
        }
      }

      // 4) Fallback: search File: namespace and pick the first valid image URL
      const api = new URL(apiBase);
      api.searchParams.set('action', 'query');
      api.searchParams.set('format', 'json');
      api.searchParams.set('prop', 'imageinfo');
      api.searchParams.set('iiprop', 'url');
      api.searchParams.set('generator', 'search');
      api.searchParams.set('gsrsearch', q);
      api.searchParams.set('gsrnamespace', '6'); // File:
      api.searchParams.set('gsrlimit', '5');
      const resp = await fetch(api.toString());
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      const data = await resp.json();
      const pages = data?.query?.pages || {};
      const urls = Object.values(pages)
        .map(p => (p.imageinfo && p.imageinfo[0] && p.imageinfo[0].url) || '')
        .filter(Boolean)
        .filter(u => /\.(jpg|jpeg|png|webp)(\?|$)/i.test(u))
        .filter(withinMediaHost);
      const pick = urls[0];
      if (!pick) return { ok: false, error: 'No image found' };
      console.log('[overlay:findWikiImage] topic=', q, 'url=', pick);
      return { ok: true, url: pick };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // Fetch remote image and return as data URL to avoid hotlink/CSP issues
  ipcMain.handle('overlay:fetchImage', async (_evt, url) => {
    try {
      if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false, error: 'Invalid URL' };
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8',
          'Referer': 'https://starcitizen.tools/'
        }
      });
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      const contentType = resp.headers.get('content-type') || 'image/png';
      const buf = Buffer.from(await resp.arrayBuffer());
      const b64 = buf.toString('base64');
      const dataUrl = `data:${contentType};base64,${b64}`;
      console.log('[overlay:fetchImage] fetched', url, 'type:', contentType, 'bytes:', buf.length);
      return { ok: true, dataUrl, contentType, bytes: buf.length };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // Make it a real overlay
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  setClickThrough(clickThrough);

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // LLM health check: verify key present and model reachable quickly
  ipcMain.handle('overlay:llmHealth', async () => {
    const apiKey = getGeminiApiKey();
    if (!apiKey) return { ok: false, reason: 'no_key' };
    try {
      const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent';
      const cfg = loadConfigOnce();
      const enableSearch = !!(cfg.enable_google_search || cfg.googleSearch || cfg.enableSearch);
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const body = {
        contents: [ { parts: [ { text: 'ping' } ] } ],
        ...(enableSearch ? { tools: [ { google_search: {} } ] } : {})
      };
      const resp = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal
      });
      clearTimeout(t);
      if (!resp.ok) return { ok: false, reason: 'http_' + resp.status };
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'error', details: String(e) };
    }
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
        'IMAGES: If an illustrative image would help, find ONE high-quality, direct image URL from Google Search results (must end in .jpg, .jpeg, .png, or .webp) and include it on its own line at the end in the format: IMAGE: <URL>. Do not output this line if you cannot find a suitable image URL. Never use an example URL; find a new one based on the current search.',
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
      const data = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n') || '';
      console.log('[overlay:llmQuery] Raw response text:', text);
      return { error: false, text };
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
    const minH = 170; // a bit taller to avoid cutoff when only a few panels are visible
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

  // Ctrl+Shift+I toggles overlay visibility
  globalShortcut.register('Control+Shift+I', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      // Show without stealing focus
      try { mainWindow.showInactive(); } catch (_) { mainWindow.show(); }
      // Re-assert overlay behavior
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      setClickThrough(clickThrough);
    }
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
