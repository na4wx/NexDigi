const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const ChannelManager = require('./lib/channelManager');
const MockAdapter = require('./lib/adapters/mockAdapter');
const BBS = require('./lib/bbs');
const APRSMessageHandler = require('./lib/aprsMessageHandler');
const BBSSessionManager = require('./lib/bbsSession');
const WeatherAlertManager = require('./lib/weatherAlerts');
const LookupHandler = require('./lib/lookupHandler');
const BeaconScheduler = require('./lib/beaconScheduler');
const MessageAlertManager = require('./lib/messageAlertManager');
const BackboneManager = require('./lib/backbone/BackboneManager');
const bbs = new BBS();
const WinlinkManager = require('./lib/winlinkManager');
const ChatManager = require('./lib/chatManager');
const ChatHistoryManager = require('./lib/chatHistoryManager');
const ChatSyncManager = require('./lib/ChatSyncManager');
let aprsMessageHandler = null;
let bbsSessionManager = null;
let lookupHandler = null;
let beaconScheduler = null;
let messageAlertManager = null;
let backboneManager = null;
let chatManager = null;
let chatHistoryManager = null;
let chatSyncManager = null;

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
      // New: role (fill-in | wide) and maxWideN guardrail
      ch.role = (typeof s.role === 'string' && s.role) ? s.role.toLowerCase() : (ch.role || 'wide');
      const mw = Number(s.maxWideN);
      ch.maxWideN = Number.isFinite(mw) && mw > 0 ? mw : (Number.isFinite(ch.maxWideN) ? ch.maxWideN : 2);
    });
  } catch (e) {
    console.error('Failed applying digipeater settings to runtime:', e);
  }
}

// Update digipeater settings: persist and apply
const updateDigipeaterSettings = (newSettings) => {
  console.log('[DEBUG] updateDigipeaterSettings called with:', JSON.stringify(newSettings));
  // Validate and normalize incoming channel settings to avoid invalid runtime state
  try {
    if (newSettings && newSettings.channels && typeof newSettings.channels === 'object') {
      Object.keys(newSettings.channels).forEach((chid) => {
        const s = newSettings.channels[chid] || {};
        // normalize role
        if (typeof s.role === 'string') s.role = String(s.role).toLowerCase();
        else s.role = 'wide';
        // normalize maxWideN
        const mw = Number(s.maxWideN);
        s.maxWideN = (Number.isFinite(mw) && mw > 0) ? Math.min(7, Math.max(1, mw)) : 2;
      });
    }
  } catch (e) { console.error('Normalization error for digipeater settings', e); }

  Object.assign(digipeaterSettings, newSettings);
  try {
    saveDigipeaterSettings(digipeaterSettings);
    console.log(`[DEBUG] digipeater settings saved to ${DIGIPEATER_SETTINGS_PATH}`);
  } catch (e) {
    console.error('Error saving digipeater settings:', e);
    throw e;
  }
  applyDigipeaterSettingsToRuntime();
  // restart metric checker when digipeater settings change
  try { startMetricChecker(); } catch (e) { console.error('Failed to start metric checker after applying settings', e); }
  // apply seen cache tuning if provided
  try {
    if (digipeaterSettings && digipeaterSettings.seenCache) {
      const sc = digipeaterSettings.seenCache || {};
      if (typeof sc.ttl === 'number' && sc.ttl > 0) manager.setSeenTTL(sc.ttl);
      if (typeof sc.maxEntries === 'number' && sc.maxEntries > 0) manager.setMaxSeenEntries(sc.maxEntries);
    }
  } catch (e) { console.error('Failed to apply seenCache settings to manager', e); }
  try {
    // Update weather alerts manager
    if (typeof weatherAlerts !== 'undefined' && weatherAlerts) weatherAlerts.updateSettings(digipeaterSettings);
  } catch (e) { console.error('Failed to update weatherAlerts settings:', e); }
  try {
    // Update beacon scheduler
    if (typeof beaconScheduler !== 'undefined' && beaconScheduler) beaconScheduler.updateSettings(digipeaterSettings);
  } catch (e) { console.error('Failed to update beacon scheduler settings:', e); }
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
const { writeJsonAtomicSync } = require('./lib/fileHelpers');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const BBS_SETTINGS_PATH = path.join(__dirname, 'data', 'bbsSettings.json');
const DIGIPEATER_SETTINGS_PATH = path.join(__dirname, 'data', 'digipeaterSettings.json');
const METRIC_ALERTS_PATH = path.join(__dirname, 'data', 'metricAlerts.json');
const WINLINK_SETTINGS_PATH = path.join(__dirname, 'data', 'winlinkSettings.json');

const manager = new ChannelManager();
// WeatherAlertManager will be instantiated after we load digipeaterSettings
let weatherAlerts = null;
let winlinkManager = null;
// LastHeard manager (stores recent heard stations for UI)
const LastHeard = require('./lib/lastHeard');
const lastHeard = new LastHeard({ filePath: path.join(__dirname, 'data', 'lastHeard.json') });
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

// Metric alerts storage and helper persistence
let metricAlerts = [];
function loadMetricAlerts() {
  try {
    if (fs.existsSync(METRIC_ALERTS_PATH)) {
      const raw = fs.readFileSync(METRIC_ALERTS_PATH, 'utf8');
      metricAlerts = JSON.parse(raw) || [];
    }
  } catch (e) { console.error('Failed to load metric alerts:', e); metricAlerts = []; }
}
function saveMetricAlerts() {
  try { writeJsonAtomicSync(METRIC_ALERTS_PATH, metricAlerts); } catch (e) { console.error('Failed to save metric alerts:', e); }
}
loadMetricAlerts();

// periodic metric threshold checker
let metricCheckerInterval = null;
let lastMetricsSnapshot = manager.getMetrics ? manager.getMetrics() : {};
function startMetricChecker() {
  try {
    // stop existing
    if (metricCheckerInterval) clearInterval(metricCheckerInterval);
    // reset last metrics snapshot to avoid spurious alerts on startup
    try { lastMetricsSnapshot = manager.getMetrics ? manager.getMetrics() : {}; } catch (e) { lastMetricsSnapshot = {}; }
    const cfgThresh = (digipeaterSettings && digipeaterSettings.metricsThresholds) ? digipeaterSettings.metricsThresholds : {};
    const intervalSec = (digipeaterSettings && digipeaterSettings.metricsCheckIntervalSec) ? Number(digipeaterSettings.metricsCheckIntervalSec) : 60;
    const thresholds = Object.assign({ servicedWideBlocked: 10, maxWideBlocked: 10 }, cfgThresh || {});
    metricCheckerInterval = setInterval(() => {
      try {
        const m = manager.getMetrics ? manager.getMetrics() : {};
        // compare metrics and create alerts when thresholds exceeded (on increase)
        Object.keys(thresholds).forEach(k => {
          const val = Number(m[k] || 0);
          const lastVal = Number(lastMetricsSnapshot[k] || 0);
          if (val >= thresholds[k] && val > lastVal) {
            const msg = `Metric threshold exceeded: ${k}=${val} (threshold ${thresholds[k]})`;
            console.warn(msg);
            const alert = { ts: Date.now(), metric: k, value: val, threshold: thresholds[k], message: msg };
            metricAlerts.unshift(alert);
            if (metricAlerts.length > 200) metricAlerts.pop();
            saveMetricAlerts();
          }
        });
        lastMetricsSnapshot = m;
      } catch (e) { console.error('metricChecker tick failed', e); }
    }, Math.max(5, Number(intervalSec)) * 1000);
  } catch (e) { console.error('Failed to start metric checker', e); }
}

// Periodic seen-cache cleanup to keep memory bounded and remove stale entries
let seenCleanupInterval = null;
try {
  if (seenCleanupInterval) clearInterval(seenCleanupInterval);
  // default cleanup every 10 seconds (tunable)
  seenCleanupInterval = setInterval(() => {
    try { manager.cleanupSeen(); } catch (e) { /* ignore */ }
  }, 10 * 1000);
} catch (e) { /* ignore */ }
// begin checker after initial settings applied

// Maintain recent frames globally so /api/frames works even when no websocket client is connected
manager.on('frame', (event) => {
  let parsed = null;
  try { parsed = parseAx25Frame(Buffer.from(event.raw, 'hex')); } catch (e) { /* ignore */ }
  const out = Object.assign({}, event, { parsed, ts: event.ts || Date.now() });
  pushRecent(out);
  // record last-heard entries (RX)
  try {
    if (lastHeard) {
      // parsed may be null if parse failed; attempt to extract source callsign from parsed or raw
      let cs = null;
      let ssid = null;
      if (parsed && Array.isArray(parsed.addresses) && parsed.addresses[1]) {
        cs = parsed.addresses[1].callsign || null;
        ssid = (typeof parsed.addresses[1].ssid === 'number') ? parsed.addresses[1].ssid : null;
      }
      // mode: distinguish Packet vs APRS by heuristics (payload starting with '>' often APRS status)
      let mode = 'APRS';
      try {
        const pld = parsed && parsed.payload ? parsed.payload.toString() : (out && out.parsed && out.parsed.payload ? out.parsed.payload.toString() : null);
        if (!pld) mode = 'Packet';
        else if (typeof pld === 'string' && pld.length > 0) {
          if (pld.startsWith('>') || pld.startsWith('@') || pld.startsWith('!') || pld.startsWith('$')) mode = 'APRS';
          else mode = 'APRS';
        }
      } catch (e) { mode = 'APRS'; }
      lastHeard.add({ callsign: cs, ssid, mode, channel: event.channel, raw: event.raw, info: (parsed || null), ts: out.ts });
    }
  } catch (e) { console.error('lastHeard add error:', e && e.message); }
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
  writeJsonAtomicSync(CONFIG_PATH, cfg);
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
    writeJsonAtomicSync(BBS_SETTINGS_PATH, settings);
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
    writeJsonAtomicSync(DIGIPEATER_SETTINGS_PATH, settings);
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
// Initialize WinlinkManager (simple stub manager)
try {
  const WinlinkManager = require('./lib/winlinkManager');
  winlinkManager = new WinlinkManager({ settingsPath: WINLINK_SETTINGS_PATH, manager, digipeaterSettings });
  console.log('WinlinkManager created, settings:', winlinkManager.settings);
  // If autoConnect requested, optionally start (non-blocking)
  if (winlinkManager.settings && winlinkManager.settings.autoConnect) {
    console.log('Auto-starting WinlinkManager...');
    try { winlinkManager.start(); } catch (e) { console.error('Failed to auto-start WinlinkManager:', e); }
  } else {
    console.log('WinlinkManager not auto-starting, autoConnect:', winlinkManager.settings?.autoConnect);
  }
} catch (e) { console.error('Failed to initialize WinlinkManager:', e); }

// Initialize BackboneManager (mesh networking)
try {
  backboneManager = new BackboneManager(manager);
  console.log('BackboneManager created');
  
  // Initialize backbone asynchronously (non-blocking)
  backboneManager.initialize().then(() => {
    if (backboneManager.enabled) {
      console.log('BackboneManager initialized and running');
      
      // Listen for incoming data from backbone
      backboneManager.on('data', (packet) => {
        console.log(`[Backbone] Data received from ${packet.source}:`, packet.data.length, 'bytes');
        // TODO: Route data to appropriate handler (BBS, Winlink, etc.)
      });
      
      backboneManager.on('neighbor-update', (callsign, info) => {
        console.log(`[Backbone] Neighbor update: ${callsign}, transports: ${info.transports.join(', ')}`);
      });
      
      // Initialize ChatSyncManager now that backbone is ready
      if (chatManager) {
        try {
          chatSyncManager = new ChatSyncManager(chatManager, backboneManager, {
            enabled: true,
            syncInterval: 30000, // 30 seconds
            maxMessagesPerSync: 100
          });
          console.log('ChatSyncManager initialized with NexNet backbone');
        } catch (e) {
          console.error('Failed to create ChatSyncManager:', e);
        }
      }
    } else {
      console.log('BackboneManager initialized but disabled in configuration');
    }
  }).catch(err => {
    console.error('Failed to initialize BackboneManager:', err.message);
  });
} catch (e) { 
  console.error('Failed to create BackboneManager:', e); 
  backboneManager = null;
}

// Initialize ChatManager (keyboard-to-keyboard chat)
try {
  // Create ChatHistoryManager for persistent chat storage
  chatHistoryManager = new ChatHistoryManager(
    path.join(__dirname, 'data', 'chatHistory.json'),
    {
      retentionDays: 7,
      maxMessagesPerRoom: 1000
    }
  );
  console.log('ChatHistoryManager created');

  chatManager = new ChatManager(manager, { historyManager: chatHistoryManager });
  console.log('ChatManager created with history persistence');
  
  // Initialize ChatSyncManager after BackboneManager is ready
  // This will be done after backbone initialization completes
} catch (e) {
  console.error('Failed to create ChatManager:', e);
  chatManager = null;
}

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

// Debug: dump initial channel -> adapter port information
try {
  console.log('[DEBUG] Initial channels and adapters:');
  manager.listChannels().forEach(ch => {
    const cobj = manager.channels.get(ch.id);
    const port = (cobj && cobj.adapter && cobj.adapter.portPath) ? cobj.adapter.portPath : (cobj && cobj.adapter && cobj.adapter.host && cobj.adapter.port) ? `${cobj.adapter.host}:${cobj.adapter.port}` : (cobj && cobj.adapter && cobj.adapter.transport) || 'unknown';
    console.log(`  - ${ch.id} -> adapter: ${port}`);
  });
} catch (e) {}

// apply operational routes from digipeater settings (authoritative)
if (digipeaterSettings) {
  applyDigipeaterSettingsToRuntime();
}

// Initialize standalone lookup handler (independent of BBS)
try {
  const lookupSettings = (digipeaterSettings && digipeaterSettings.lookup) || {};
  lookupHandler = new LookupHandler(manager, {
    enabled: lookupSettings.enabled !== false, // Default to enabled
    callsign: lookupSettings.callsign || 'LOOKUP',
    endpointTemplate: lookupSettings.endpointTemplate || 'https://callook.info/{CALL}/json',
    timeoutMs: lookupSettings.timeoutMs || 5000,
    cacheTtlMs: lookupSettings.cacheTtlMs || (10 * 60 * 1000)
  });
  console.log(`Lookup handler initialized (callsign: ${lookupSettings.callsign || 'LOOKUP'})`);
} catch (e) {
  console.error('Failed to initialize lookup handler:', e);
}

// Initialize beacon scheduler
try {
  beaconScheduler = new BeaconScheduler(manager);
  beaconScheduler.updateSettings(digipeaterSettings);
  console.log('Beacon scheduler initialized');
} catch (e) {
  console.error('Failed to initialize beacon scheduler:', e);
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
    // Initialize message alert manager if not already done
    if (!messageAlertManager) {
      messageAlertManager = new MessageAlertManager(bbs, manager, {
        enabled: true,
        alertCallsign: bbsSettings.callsign.includes('-') ? bbsSettings.callsign : `${bbsSettings.callsign}-MSG`,
        reminderIntervalHours: 4,
        maxReminders: 10
      });
      console.log(`Message Alert Manager initialized for ${messageAlertManager.settings.alertCallsign}`);
    }
    
    if (!aprsMessageHandler) {
      const APRSMessageHandler = require('./lib/aprsMessageHandler');
      aprsMessageHandler = new APRSMessageHandler(bbs, manager, bbsSettings, messageAlertManager);
      console.log(`BBS APRS handler initialized for ${bbsSettings.callsign}`);
    } else {
      aprsMessageHandler.updateSettings(bbsSettings);
      console.log(`BBS APRS handler updated for ${bbsSettings.callsign}`);
    }
    // Initialize connected-mode BBS session manager
    if (!bbsSessionManager) {
      const allowed = Array.isArray(bbsSettings.channels) ? bbsSettings.channels : [];
      const frameDelayMs = bbsSettings.frameDelayMs || 0;
      bbsSessionManager = new BBSSessionManager(
        manager, 
        bbsSettings.callsign, 
        path.join(__dirname, 'data', 'bbsUsers.json'), 
        { allowedChannels: allowed, frameDelayMs },
        bbs, // Pass BBS instance
        messageAlertManager, // Pass message alert manager
        chatManager // Pass chat manager for RF chat access
      );
      console.log(`BBS connected-mode handler initialized for ${bbsSettings.callsign}${frameDelayMs > 0 ? ` (frame delay: ${frameDelayMs}ms)` : ''}`);
      
      // Set up frame handler for BBS session manager
      manager.on('frame', (event) => {
        if (bbsSessionManager) {
          try {
            const frameBuffer = Buffer.from(event.raw, 'hex');
            bbsSessionManager.onFrame(frameBuffer, event.channel);
          } catch (err) {
            console.error('Error processing frame in BBS session manager:', err);
          }
        }
      });
    }
  } else if (aprsMessageHandler) {
    aprsMessageHandler.updateSettings(bbsSettings);
    console.log('BBS APRS handler disabled');
  }
};

// Initialize BBS system at startup
try {
  updateBBSSettings(bbsSettings);
} catch (e) {
  console.error('Failed to initialize BBS system:', e);
}

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
  weatherAlerts,
  beaconScheduler: () => beaconScheduler, // Function to get current beacon scheduler
  messageAlertManager: () => messageAlertManager // Function to get current alert manager
};

// expose winlink manager instance (may be null until initialized)
dependencies.winlinkManager = winlinkManager;

// expose chatManager
dependencies.chatManager = chatManager;
dependencies.chatSyncManager = () => chatSyncManager; // Function to get current sync manager

// expose lastHeard via dependencies
dependencies.lastHeard = lastHeard;
// expose metric alerts management
dependencies.metricAlerts = metricAlerts;
dependencies.clearMetricAlerts = () => { metricAlerts = []; saveMetricAlerts(); };
dependencies.getMetricAlerts = () => metricAlerts;

// Debug middleware to log all requests
app.use((req, res, next) => {
  if (req.url.includes('/api/channels')) {
    console.log(`[DEBUG] ${req.method} ${req.url} - Body:`, JSON.stringify(req.body, null, 2));
  }
  next();
});

// Health check routes (NO authentication required - for monitoring/Docker)
app.use('/api', require('./routes/health')(dependencies));

// Auth routes MUST be mounted before authentication middleware
app.use('/api/auth', require('./routes/auth'));

// Authentication middleware (applied to protected routes)
const { authenticate } = require('./middleware/auth');
app.use('/api', authenticate);

app.use('/api/channels', channelsRoutes(dependencies));
app.use('/api/lastheard', require('./routes/lastheard')(dependencies));
app.use('/api/bbs', bbsRoutes(dependencies));
app.use('/api', hardwareRoutes(dependencies));
app.use('/api/igate', igateRoutes({...dependencies, igate}));
app.use('/api', systemRoutes(dependencies));
app.use('/api/digipeater', digipeaterRoutes(dependencies));
// Winlink routes
try { app.use('/api', require('./routes/winlink')(dependencies)); } catch (e) { console.error('Failed to mount winlink routes', e); }
// Backbone routes
try { 
  const backboneRoutes = require('./routes/backbone');
  app.use('/api', backboneRoutes({...dependencies, backboneManager})); 
} catch (e) { 
  console.error('Failed to mount backbone routes', e); 
}
// NexNet advanced settings routes
try {
  const nexnetRoutes = require('./routes/nexnet');
  app.use('/api/nexnet', nexnetRoutes);
} catch (e) {
  console.error('Failed to mount nexnet routes', e);
}
// Chat routes
let chatWebSocketHandlers = null;
try {
  const chatRoutes = require('./routes/chat');
  const chatRouter = chatRoutes({...dependencies, chatManager, wsServer: wss});
  app.use('/api/chat', chatRouter);
  chatWebSocketHandlers = chatRouter.chatWebSocketHandlers;
  console.log('Chat routes mounted, WebSocket handlers:', !!chatWebSocketHandlers);
} catch (e) {
  console.error('Failed to mount chat routes', e);
}

// Expose current digipeaterSettings to route handlers that access req.app.locals
app.locals.digipeaterSettings = digipeaterSettings;

// WebSocket: stream frames and commands
const { verifyWebSocketAuth } = require('./middleware/auth');

wss.on('connection', (ws, req) => {
  // Extract password from query string or headers
  const url = new URL(req.url, `http://${req.headers.host}`);
  const password = url.searchParams.get('password') || req.headers['x-ui-password'];
  
  // Verify authentication for UI WebSocket connections
  // Skip for backbone/node connections
  const userAgent = req.headers['user-agent'] || '';
  const isNodeConnection = userAgent.includes('NexDigi-Node') || req.headers['x-nexdigi-node'];
  
  if (!isNodeConnection && !verifyWebSocketAuth(password)) {
    ws.close(1008, 'Authentication required'); // Policy Violation
    console.warn('WebSocket connection rejected: Invalid or missing password');
    return;
  }
  
  // send current channels
  ws.send(JSON.stringify({ type: 'channels', data: manager.listChannels() }));
  
  // send backbone status if available
  try {
    if (backboneManager && backboneManager.enabled) {
      const backboneStatus = backboneManager.getStatus();
      ws.send(JSON.stringify({ type: 'backbone-status', data: backboneStatus }));
    }
  } catch (e) { /* ignore */ }
  
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
      
      // Handle chat messages if chat is enabled
      if (chatWebSocketHandlers && payload.type && payload.type.startsWith('chat-')) {
        chatWebSocketHandlers.handleChatMessage(ws, payload);
        return;
      }
      
      // Handle regular frame sending
      if (payload.type === 'send' && payload.channel && payload.frame) {
        manager.sendFrame(payload.channel, Buffer.from(payload.frame, 'hex'));
      }
    } catch (err) { /* ignore */ }
  });

  ws.on('close', () => { 
    manager.off('frame', onFrame); 
    manager.off('tx', onTx);
    
    // Handle chat disconnect
    if (chatWebSocketHandlers) {
      chatWebSocketHandlers.handleDisconnect(ws);
    }
  });
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
  try { if (metricCheckerInterval) clearInterval(metricCheckerInterval); } catch (e) {}
  try { if (seenCleanupInterval) clearInterval(seenCleanupInterval); } catch (e) {}
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
  try { 
    if (backboneManager && backboneManager.enabled) { 
      console.log('Shutting down backbone...');
      backboneManager.shutdown().catch(e => console.error('Backbone shutdown error:', e)); 
    } 
  } catch (e) { console.error('Backbone shutdown error:', e); }
  try {
    if (chatHistoryManager) {
      console.log('Shutting down chat history manager...');
      chatHistoryManager.shutdown();
    }
  } catch (e) { console.error('Chat history shutdown error:', e); }
  try {
    if (chatSyncManager) {
      console.log('Shutting down chat sync manager...');
      chatSyncManager.shutdown();
    }
  } catch (e) { console.error('Chat sync shutdown error:', e); }
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
            // Debug: dump channel -> adapter port information
            try {
              console.log('[DEBUG] Configured channels and adapters:');
              manager.listChannels().forEach(ch => {
                const cobj = manager.channels.get(ch.id);
                const port = (cobj && cobj.adapter && cobj.adapter.portPath) ? cobj.adapter.portPath : (cobj && cobj.adapter && cobj.adapter.transport) || 'unknown';
                console.log(`  - ${ch.id} -> adapter port/transport: ${port}`);
              });
            } catch (e) {}
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

// Cleanup intervals
setInterval(() => {
  if (messageAlertManager) {
    messageAlertManager.cleanup();
  }
}, 60 * 60 * 1000); // Every hour

// APRS message cleanup
setInterval(() => {
  if (aprsMessageHandler) {
    aprsMessageHandler.cleanup();
  }
}, 5 * 60 * 1000); // Every 5 minutes
