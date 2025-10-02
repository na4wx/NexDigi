const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const ChannelManager = require('./lib/channelManager');
const MockAdapter = require('./lib/adapters/mockAdapter');
const BBS = require('./lib/bbs');
const APRSMessageHandler = require('./lib/aprsMessageHandler');
const BBSSessionManager = require('./lib/bbsSession');
const WeatherAlertManager = require('./lib/weatherAlerts');
const bbs = new BBS();
let aprsMessageHandler = null;
let bbsSessionManager = null;

const app = express();
// Apply digipeater settings (routes + per-channel options) to runtime
function applyDigipeaterSettingsToRuntime() {
  try {
    // Expose to routes
    app.locals.digipeaterSettings = digipeaterSettings;
    // Rebuild routes from settings
    manager.routes = new Map();
    const enabled = !!digipeaterSettings.enabled;
    const routes = Array.isArray(digipeaterSettings.routes) ? digipeaterSettings.routes : [];
    if (enabled) {
      routes.forEach((r) => {
        try { manager.addRoute(r.from, r.to); } catch (e) { console.error('Route add failed:', e && e.message); }
      });
    }
    console.log(`Applied digipeater routes: ${enabled ? routes.length : 0} (enabled=${enabled})`);
    // Per-channel digipeater options
    const chMap = digipeaterSettings.channels || {};
    Object.keys(chMap).forEach((id) => {
      const s = chMap[id] || {};
      const ch = manager.channels.get(id);
      if (!ch) return;
      ch.mode = s.mode || 'digipeat';
      ch.options = ch.options || {};
      if (typeof s.callsign === 'string' && s.callsign.trim()) ch.options.callsign = s.callsign.trim();
      if (typeof s.igateForward === 'boolean') ch.options.igate = s.igateForward;
      ch.appendDigiCallsign = (typeof s.appendCallsign === 'boolean') ? s.appendCallsign : (ch.appendDigiCallsign ?? true);
      ch.idOnRepeat = (typeof s.idOnRepeat === 'boolean') ? s.idOnRepeat : (ch.idOnRepeat ?? false);
    });
  } catch (e) {
    console.error('Failed applying digipeater settings to runtime:', e);
  }
}

// Update digipeater settings: persist and apply
const updateDigipeaterSettings = (newSettings) => {
  console.log('[DEBUG] updateDigipeaterSettings called with:', JSON.stringify(newSettings));
  Object.assign(digipeaterSettings, newSettings);
  try {
    saveDigipeaterSettings(digipeaterSettings);
    console.log(`[DEBUG] digipeater settings saved to ${DIGIPEATER_SETTINGS_PATH}`);
  } catch (e) {
    console.error('Error saving digipeater settings:', e);
    throw e;
  }
  applyDigipeaterSettingsToRuntime();
  try {
    // Update weather alerts manager
    if (typeof weatherAlerts !== 'undefined' && weatherAlerts) weatherAlerts.updateSettings(digipeaterSettings);
  } catch (e) { console.error('Failed to update weatherAlerts settings:', e); }
  console.log('Digipeater settings updated:', {
    enabled: digipeaterSettings.enabled,
    channelCount: Object.keys(digipeaterSettings.channels || {}).length,
    routeCount: (digipeaterSettings.routes || []).length
  });
};
const DEBUG_VERBOSE = String(process.env.NEXDIGI_DEBUG || '').toLowerCase() === 'true';
// enable CORS so the frontend (vite dev server) can call this API
try {
  const cors = require('cors');
  app.use(cors());
} catch (e) {
  // cors not installed — requests from browsers may be blocked
}
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Robust error handling on server and websocket to avoid unhandled exceptions
server.on('error', (err) => {
  try { console.error('HTTP server error:', err && err.code || err); } catch (e) {}
  if (err && err.code === 'EADDRINUSE') {
    console.error('Port is already in use. Exiting so watcher can restart cleanly.');
    try { shutdown('EADDRINUSE'); } catch (e) { process.exit(1); }
  }
});
wss.on('error', (err) => {
  try { console.error('WebSocket server error:', err && err.code || err); } catch (e) {}
});

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const BBS_SETTINGS_PATH = path.join(__dirname, 'data', 'bbsSettings.json');
const DIGIPEATER_SETTINGS_PATH = path.join(__dirname, 'data', 'digipeaterSettings.json');

const manager = new ChannelManager();
// WeatherAlertManager will be instantiated after we load digipeaterSettings
let weatherAlerts = null;
const { parseAx25Frame } = require('./lib/ax25');
const { formatCallsign } = require('./lib/ax25');
const net = require('net');

// keep a small ring buffer of recent parsed frames for the UI
const RECENT_FRAMES_MAX = 200;
const recentFrames = [];

function pushRecent(out) {
  recentFrames.unshift(out);
  if (recentFrames.length > RECENT_FRAMES_MAX) recentFrames.pop();
}

// Maintain recent frames globally so /api/frames works even when no websocket client is connected
manager.on('frame', (event) => {
  let parsed = null;
  try { parsed = parseAx25Frame(Buffer.from(event.raw, 'hex')); } catch (e) { /* ignore */ }
  const out = Object.assign({}, event, { parsed, ts: event.ts || Date.now() });
  pushRecent(out);
  // forward to igate if enabled and this channel is allowed
  try {
    if (igate && cfg && cfg.igate && cfg.igate.enabled) {
      const allowed = (cfg.igate.channels && Array.isArray(cfg.igate.channels)) ? cfg.igate.channels : [];
      const ch = manager.channels.get(event.channel);
      const allowsChannel = (ch && ch.options && ch.options.igate) || allowed.indexOf(event.channel) !== -1;
      if (DEBUG_VERBOSE) console.log(`IGate forward check (RX): channel=${event.channel}, enabled=${cfg.igate.enabled}, allowsChannel=${allowsChannel}`);
      if (allowsChannel) {
        if (DEBUG_VERBOSE) console.log(`IGate forwarding RX frame from ${event.channel}`);
        try { igate.sendParsed(parsed, event.raw, { src: (ch && ch.options && ch.options.callsign) || ch && ch.name || event.channel }); } catch (e) { console.error('IGate sendParsed error:', e); }
      }
    }
  } catch (e) { console.error('IGate forward error:', e); }
});
manager.on('tx', (event) => {
  let parsed = null;
  try { parsed = parseAx25Frame(Buffer.from(event.raw, 'hex')); } catch (e) { /* ignore */ }
  const out = Object.assign({}, event, { parsed, ts: event.ts || Date.now() });
  pushRecent(out);
  // also forward transmits if igate enabled and channel allowed (optional)
  try {
    if (igate && cfg && cfg.igate && cfg.igate.enabled) {
      const allowed = (cfg.igate.channels && Array.isArray(cfg.igate.channels)) ? cfg.igate.channels : [];
      const ch = manager.channels.get(event.channel);
      const allowsChannel = (ch && ch.options && ch.options.igate) || allowed.indexOf(event.channel) !== -1;
      if (DEBUG_VERBOSE) console.log(`IGate forward check (TX): channel=${event.channel}, enabled=${cfg.igate.enabled}, allowsChannel=${allowsChannel}`);
      if (allowsChannel) {
        if (DEBUG_VERBOSE) console.log(`IGate forwarding TX frame from ${event.channel}`);
        try { igate.sendParsed(parsed, event.raw, { src: (ch && ch.options && ch.options.callsign) || ch && ch.name || event.channel }); } catch (e) { console.error('IGate sendParsed error:', e); }
      }
    }
  } catch (e) { console.error('IGate forward error:', e); }
});

// Handle 'igate' events from channel manager (special igate route target)
manager.on('igate', (event) => {
  if (DEBUG_VERBOSE) console.log(`IGate event received from channel manager: ${event.from}`);
  try {
    if (igate && cfg && cfg.igate && cfg.igate.enabled) {
      const ch = manager.channels.get(event.from);
      const allowsChannel = (ch && ch.options && ch.options.igate) || (cfg.igate.channels && cfg.igate.channels.indexOf(event.from) !== -1);
      if (DEBUG_VERBOSE) console.log(`IGate forward check (igate event): channel=${event.from}, enabled=${cfg.igate.enabled}, allowsChannel=${allowsChannel}`);
      if (allowsChannel) {
        if (DEBUG_VERBOSE) console.log(`IGate forwarding via igate event from ${event.from}`);
        // Use the servicedBuf if available (already processed by channel manager)
        const bufToUse = event.servicedBuf || Buffer.from(event.raw, 'hex');
        const parsed = event.parsed || (() => { try { return parseAx25Frame(bufToUse); } catch (e) { return null; } })();
        try { 
          igate.sendParsed(parsed, bufToUse.toString('hex'), { src: (ch && ch.options && ch.options.callsign) || ch && ch.name || event.from }); 
        } catch (e) { 
          console.error('IGate sendParsed error (igate event):', e); 
        }
      }
    }
  } catch (e) { 
    console.error('IGate igate event error:', e); 
  }
});

function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function loadBBSSettings() {
  try {
    const raw = fs.readFileSync(BBS_SETTINGS_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    // Return default settings if file doesn't exist or is invalid
    return { enabled: false, callsign: '', channels: [] };
  }
}

function saveBBSSettings(settings) {
  try {
    fs.writeFileSync(BBS_SETTINGS_PATH, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('Failed to save BBS settings:', e);
  }
}

function loadDigipeaterSettings() {
  try {
    const raw = fs.readFileSync(DIGIPEATER_SETTINGS_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    // Return default settings if file doesn't exist or is invalid
    return { enabled: false, channels: {}, routes: [] };
  }
}

function saveDigipeaterSettings(settings) {
  try {
    fs.writeFileSync(DIGIPEATER_SETTINGS_PATH, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('Failed to save Digipeater settings:', e);
  }
}

// wire channels from config
let cfg = loadConfig();
const IgateClient = require('./lib/igateClient');
// igate runtime client (created if cfg.igate && cfg.igate.enabled)
let igate = null;
function ensureIgate() {
  if (!cfg || !cfg.igate || !cfg.igate.enabled) {
    if (igate) { try { igate.stop(); } catch (e) {} igate = null; }
    return;
  }
  if (!igate) {
    igate = new IgateClient(Object.assign({}, cfg.igate));
    // guard against unhandled error events from the socket by handling them here
    igate.on && igate.on('error', (err) => {
      try { console.error('Igate client error (non-fatal):', err && err.message); } catch (e) {}
    });
    igate.start();
  }
}
ensureIgate();

// Initialize settings from disk early so they are available before first use
let bbsSettings = loadBBSSettings();
let digipeaterSettings = loadDigipeaterSettings();
// normalize nwsAlerts defaults
try {
  digipeaterSettings.nwsAlerts = digipeaterSettings.nwsAlerts || {};
  if (typeof digipeaterSettings.nwsAlerts.repeatExternalBulletins !== 'boolean') digipeaterSettings.nwsAlerts.repeatExternalBulletins = false;
} catch (e) {}
// After loading settings from disk, instantiate and initialize WeatherAlertManager
try {
  const WeatherAlertManager = require('./lib/weatherAlerts');
  weatherAlerts = new WeatherAlertManager({ manager, settings: null });
  if (weatherAlerts) weatherAlerts.updateSettings(digipeaterSettings);
} catch (e) { console.error('Failed to initialize WeatherAlertManager:', e); }
function createAdapterForChannel(c) {
  if (!c || !c.type) return null;
  if (c.type === 'mock') return new MockAdapter(c.id);
  if (c.type === 'serial') {
    try {
      const SerialKissAdapter = require('./lib/adapters/serialAdapter');
      const opts = c.options || {};
      return new SerialKissAdapter({ port: opts.port, baud: opts.baud || 9600, verbose: !!opts.verbose, parity: opts.parity || 'none', dataBits: opts.dataBits || 8, stopBits: opts.stopBits || 1, rtscts: !!opts.rtscts, xon: !!opts.xon, xoff: !!opts.xoff });
    } catch (e) {
      // log diagnostic info to help identify why serial adapter couldn't be constructed
      try {
        console.error('createAdapterForChannel: failed creating SerialKissAdapter:', e && (e.stack || e.message));
        let sp;
        try { sp = require('serialport'); } catch (er) { sp = null; }
        if (sp) {
          try { console.error('serialport module keys:', Object.keys(sp)); } catch (er) { console.error('serialport keys error', er && er.message); }
        } else {
          console.error('serialport module not available');
        }
      } catch (er) {}
      return null;
    }
  }
  if (c.type === 'kiss-tcp' || c.type === 'soundmodem') {
    try {
      const SoundModemAdapter = require('./lib/adapters/soundmodemAdapter');
      const opts = c.options || {};
      const protocol = c.type === 'kiss-tcp' ? 'kiss-tcp' : (opts.protocol || 'agw');
      const defaultPort = protocol === 'kiss-tcp' ? 8001 : 8000;
      const port = (opts && Object.prototype.hasOwnProperty.call(opts, 'port')) ? opts.port : defaultPort;
      return new SoundModemAdapter({ protocol, host: opts.host || '127.0.0.1', port });
    } catch (e) { return null; }
  }
  return null;
}

if (Array.isArray(cfg.channels)) {
  cfg.channels.forEach((c) => {
    // Do not create adapters for channels explicitly disabled in config
    if (c.enabled === false) {
      console.log(`Skipping disabled channel ${c.id}`);
      return;
    }
    const adapter = createAdapterForChannel(c);
    if (adapter) {
      manager.addChannel({ id: c.id, name: c.name, adapter, options: c.options || {}, enabled: c.enabled !== false });
      // apply per-channel target routes
      if (c.options && Array.isArray(c.options.targets) && c.enabled !== false) {
        c.options.targets.forEach((toId) => {
          try { manager.addRoute(c.id, toId); } catch (e) { /* ignore */ }
        });
      }
    }
  });
}

// apply operational routes from digipeater settings (authoritative)
if (digipeaterSettings) {
  applyDigipeaterSettingsToRuntime();
}

// Simple REST API
app.use(express.json());

// Load route modules
const channelsRoutes = require('./routes/channels');
const bbsRoutes = require('./routes/bbs');
const hardwareRoutes = require('./routes/hardware');
const igateRoutes = require('./routes/igate');
const systemRoutes = require('./routes/system');
const digipeaterRoutes = require('./routes/digipeater');

// Function to update BBS settings and handle APRS handler
const updateBBSSettings = (newSettings) => {
  Object.assign(bbsSettings, newSettings);
  
  // Save settings to disk
  saveBBSSettings(bbsSettings);
  
  // Update APRS message handler
  if (newSettings.enabled && bbsSettings.callsign) {
    if (!aprsMessageHandler) {
      const APRSMessageHandler = require('./lib/aprsMessageHandler');
      aprsMessageHandler = new APRSMessageHandler(bbs, manager, bbsSettings);
      console.log(`BBS APRS handler initialized for ${bbsSettings.callsign}`);
    } else {
      aprsMessageHandler.updateSettings(bbsSettings);
      console.log(`BBS APRS handler updated for ${bbsSettings.callsign}`);
    }
    // Initialize connected-mode BBS session manager
    if (!bbsSessionManager) {
      const allowed = Array.isArray(bbsSettings.channels) ? bbsSettings.channels : [];
      const frameDelayMs = bbsSettings.frameDelayMs || 0;
      bbsSessionManager = new BBSSessionManager(manager, bbsSettings.callsign, path.join(__dirname, 'data', 'bbsUsers.json'), { allowedChannels: allowed, frameDelayMs });
      console.log(`BBS connected-mode handler initialized for ${bbsSettings.callsign}${frameDelayMs > 0 ? ` (frame delay: ${frameDelayMs}ms)` : ''}`);
    }
  } else if (aprsMessageHandler) {
    aprsMessageHandler.updateSettings(bbsSettings);
    console.log('BBS APRS handler disabled');
  }
};

// Shared dependencies for routes
const dependencies = {
  manager,
  cfg,
  saveConfig,
  createAdapterForChannel,
  bbs,
  bbsSettings,
  updateBBSSettings,
  digipeaterSettings,
  updateDigipeaterSettings,
  aprsMessageHandler: () => aprsMessageHandler, // Function to get current handler
  recentFrames,
  formatCallsign,
  ensureIgate,
  igate: () => igate, // Function to get current igate
  weatherAlerts
};

// Debug middleware to log all requests
app.use((req, res, next) => {
  if (req.url.includes('/api/channels')) {
    console.log(`[DEBUG] ${req.method} ${req.url} - Body:`, JSON.stringify(req.body, null, 2));
  }
  next();
});

app.use('/api/channels', channelsRoutes(dependencies));
app.use('/api/bbs', bbsRoutes(dependencies));
app.use('/api', hardwareRoutes(dependencies));
app.use('/api/igate', igateRoutes({...dependencies, igate}));
app.use('/api', systemRoutes(dependencies));
app.use('/api/digipeater', digipeaterRoutes(dependencies));

// Expose current digipeaterSettings to route handlers that access req.app.locals
app.locals.digipeaterSettings = digipeaterSettings;

// WebSocket: stream frames and commands
wss.on('connection', (ws) => {
  // send current channels
  ws.send(JSON.stringify({ type: 'channels', data: manager.listChannels() }));
  const onFrame = (event) => {
    let parsed = null;
    try { parsed = parseAx25Frame(Buffer.from(event.raw, 'hex')); } catch (e) { /* ignore */ }
    const out = Object.assign({}, event, { parsed, ts: event.ts || Date.now() });
    ws.send(JSON.stringify({ type: 'frame', data: out }));
  };

  manager.on('frame', onFrame);
  const onTx = (event) => {
    try {
      const parsed = (() => { try { return parseAx25Frame(Buffer.from(event.raw, 'hex')); } catch (e) { return null } })();
      const out = Object.assign({}, event, { parsed, ts: event.ts || Date.now() });
      ws.send(JSON.stringify({ type: 'tx', data: out }));
    } catch (e) { /* ignore send errors */ }
  };
  manager.on('tx', onTx);

  ws.on('message', (msg) => {
    try {
      const payload = JSON.parse(msg.toString());
      if (payload.type === 'send' && payload.channel && payload.frame) {
        manager.sendFrame(payload.channel, Buffer.from(payload.frame, 'hex'));
      }
    } catch (err) { /* ignore */ }
  });

  ws.on('close', () => { manager.off('frame', onFrame); manager.off('tx', onTx); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`NexDigi server listening on ${PORT}`));

// Graceful shutdown to prevent EADDRINUSE on restart
let shuttingDown = false;
let aprsCleanupInterval = null;
function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  try { console.log('Shutting down...', reason ? '(' + reason + ')' : ''); } catch (e) {}
  try { fs.unwatchFile(CONFIG_PATH); } catch (e) {}
  try { if (aprsCleanupInterval) clearInterval(aprsCleanupInterval); } catch (e) {}
  try { if (wss && typeof wss.close === 'function') wss.close(); } catch (e) {}
  try { if (server && typeof server.close === 'function') server.close(() => process.exit(0)); } catch (e) { process.exit(0); }
  try {
    // Close adapters/channels
    manager.listChannels().forEach(ch => {
      try {
        const c = manager.channels.get(ch.id);
        if (c && c.adapter && typeof c.adapter.close === 'function') c.adapter.close();
      } catch (e) { /* ignore */ }
    });
  } catch (e) { /* ignore */ }
  try { if (igate) { igate.stop && igate.stop(); } } catch (e) {}
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => { try { console.error('uncaughtException:', err); } catch (e) {}; shutdown('uncaughtException'); });
process.on('unhandledRejection', (reason) => { try { console.error('unhandledRejection:', reason); } catch (e) {}; shutdown('unhandledRejection'); });

// Watch config.json for manual edits and reload channels when changed
try {
  fs.watchFile(CONFIG_PATH, { interval: 1000 }, (curr, prev) => {
    try {
      console.log('config.json changed; reloading channels')
      const newCfg = loadConfig();
      // simple reconcile: remove all channels from manager and re-add from new config
      manager.listChannels().forEach(ch => manager.removeChannel(ch.id));
      cfg = newCfg;
      if (Array.isArray(cfg.channels)) {
        cfg.channels.forEach((c) => {
          if (c.enabled === false) {
            console.log(`Skipping disabled channel ${c.id} during reload`);
            return;
          }
          const adapter = createAdapterForChannel(c);
          if (adapter) {
            manager.addChannel({ id: c.id, name: c.name, adapter, options: c.options || {}, enabled: c.enabled !== false });
          }
        });
      }
      // Reload operational routes from digipeaterSettings (authoritative)
      try {
        if (digipeaterSettings) {
          applyDigipeaterSettingsToRuntime();
          console.log('Reloaded digipeater routes and channel options after config.json change');
        }
      } catch (e) { console.error('error loading digipeater routes after config change', e) }
    } catch (e) { console.error('error reloading config.json', e) }
  });
} catch (e) { /* ignore watchers on unsupported platforms */ }

// Initialize APRS message handler for BBS if enabled
if (bbsSettings.enabled && bbsSettings.callsign) {
  aprsMessageHandler = new APRSMessageHandler(bbs, manager, bbsSettings);
  console.log(`BBS APRS handler initialized for ${bbsSettings.callsign}`);
  // also start connected-mode session handler
  const allowed = Array.isArray(bbsSettings.channels) ? bbsSettings.channels : [];
  const frameDelayMs = bbsSettings.frameDelayMs || 0;
  bbsSessionManager = new BBSSessionManager(manager, bbsSettings.callsign, path.join(__dirname, 'data', 'bbsUsers.json'), { allowedChannels: allowed, frameDelayMs });
  console.log(`BBS connected-mode handler initialized for ${bbsSettings.callsign}${frameDelayMs > 0 ? ` (frame delay: ${frameDelayMs}ms)` : ''}`);
}

// Periodic cleanup for APRS handler and BBS
aprsCleanupInterval = setInterval(() => {
  if (aprsMessageHandler) {
    aprsMessageHandler.cleanup();
  }
}, 5 * 60 * 1000); // Every 5 minutes
