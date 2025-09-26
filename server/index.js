const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const ChannelManager = require('./lib/channelManager');
const MockAdapter = require('./lib/adapters/mockAdapter');

const app = express();
// enable CORS so the frontend (vite dev server) can call this API
try {
  const cors = require('cors');
  app.use(cors());
} catch (e) {
  // cors not installed — requests from browsers may be blocked
}
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

const manager = new ChannelManager();
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
      console.log(`IGate forward check (RX): channel=${event.channel}, enabled=${cfg.igate.enabled}, allowsChannel=${allowsChannel}`);
      if (allowsChannel) {
        console.log(`IGate forwarding RX frame from ${event.channel}`);
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
      console.log(`IGate forward check (TX): channel=${event.channel}, enabled=${cfg.igate.enabled}, allowsChannel=${allowsChannel}`);
      if (allowsChannel) {
        console.log(`IGate forwarding TX frame from ${event.channel}`);
        try { igate.sendParsed(parsed, event.raw, { src: (ch && ch.options && ch.options.callsign) || ch && ch.name || event.channel }); } catch (e) { console.error('IGate sendParsed error:', e); }
      }
    }
  } catch (e) { console.error('IGate forward error:', e); }
});

// Handle 'igate' events from channel manager (special igate route target)
manager.on('igate', (event) => {
  console.log(`IGate event received from channel manager: ${event.from}`);
  try {
    if (igate && cfg && cfg.igate && cfg.igate.enabled) {
      const ch = manager.channels.get(event.from);
      const allowsChannel = (ch && ch.options && ch.options.igate) || (cfg.igate.channels && cfg.igate.channels.indexOf(event.from) !== -1);
      console.log(`IGate forward check (igate event): channel=${event.from}, enabled=${cfg.igate.enabled}, allowsChannel=${allowsChannel}`);
      if (allowsChannel) {
        console.log(`IGate forwarding via igate event from ${event.from}`);
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
      // KISS TCP servers (UZ7HO soundmodem "KISS server port") commonly use 8001; AGW uses 8000
  const defaultPort = protocol === 'kiss-tcp' ? 8001 : 8000;
  const port = (opts && Object.prototype.hasOwnProperty.call(opts, 'port')) ? opts.port : defaultPort;
  return new SoundModemAdapter({ protocol, host: opts.host || '127.0.0.1', port });
    } catch (e) { return null }
  }
  return null;
}

if (Array.isArray(cfg.channels)) {
  cfg.channels.forEach((c) => {
    const adapter = createAdapterForChannel(c);
    if (adapter) {
      manager.addChannel({ id: c.id, name: c.name, adapter, options: c.options || {}, enabled: c.enabled !== false });
      // apply per-channel target routes
      if (c.options && Array.isArray(c.options.targets)) {
        c.options.targets.forEach((toId) => {
          try { manager.addRoute(c.id, toId); } catch (e) { /* ignore */ }
        });
      }
    }
  });
}

// apply routes
if (Array.isArray(cfg.routes)) {
  cfg.routes.forEach((r) => {
    console.log(`Loading route: ${r.from} -> ${r.to}`);
    try { manager.addRoute(r.from, r.to); } catch (e) { console.error('Route add failed:', e.message); }
  });
  console.log(`Total routes loaded: ${cfg.routes.length}`);
}

// Simple REST API
app.use(express.json());

// Return channels with runtime status from manager when available
app.get('/api/channels', (req, res) => {
  try {
    // Return all persisted channels, merging runtime status from manager when available.
    const persisted = Array.isArray(cfg.channels) ? cfg.channels : [];
    const runtime = new Map(manager.listChannels().map(c => [c.id, c]));
    const merged = persisted.map((p) => {
      const r = runtime.get(p.id) || {};
      const mergedObj = Object.assign({}, p, r);
      // attach a runtimeStatus object to indicate adapter state when available
      mergedObj.status = (r && r.status) ? r.status : (p.status || { connected: false });
      mergedObj.mode = p.mode || (p.options && p.options.mode) || (r && r.mode) || 'digipeat';
      // indicate whether this channel has a runtime adapter
      mergedObj.runtime = !!r && !!r.adapter;
      return mergedObj;
    });
    res.json(merged);
  } catch (e) {
    res.json(cfg.channels || []);
  }
});

app.post('/api/channels', (req, res) => {
  const { id, name, type, options } = req.body;
  if (!id || !name || !type) return res.status(400).json({ error: 'id,name,type required' });
  const existing = cfg.channels.find((c) => c.id === id);
  if (existing) return res.status(409).json({ error: 'channel exists' });
  const ch = { id, name, type, enabled: true, options: options || {} };
  cfg.channels.push(ch);
  saveConfig(cfg);
  const adapter = createAdapterForChannel(ch);
  if (adapter) {
    manager.addChannel({ id, name, adapter, options: ch.options, enabled: ch.enabled });
    if (ch.options && Array.isArray(ch.options.targets)) ch.options.targets.forEach(t => manager.addRoute(id, t));
  }
  res.status(201).json(ch);
});

app.put('/api/channels/:id', (req, res) => {
  const id = req.params.id;
  const idx = cfg.channels.findIndex((c) => c.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const old = cfg.channels[idx];
  const updated = Object.assign({}, old, req.body);
  cfg.channels[idx] = updated;
  saveConfig(cfg);

  // if type or options changed, recreate adapter
  const changedType = old.type !== updated.type;
  const changedOptions = JSON.stringify(old.options || {}) !== JSON.stringify(updated.options || {});
  if (changedType || changedOptions) {
    // remove old from manager and add new
    manager.removeChannel(id);
    const adapter = createAdapterForChannel(updated);
    if (adapter) {
      manager.addChannel({ id: updated.id, name: updated.name, adapter, options: updated.options || {}, enabled: updated.enabled !== false });
      // re-apply targets/routes for this channel
      if (updated.options && Array.isArray(updated.options.targets)) {
        // first clear existing routes from this channel
        try {
          const existing = cfg.routes ? cfg.routes.filter(r => r.from === updated.id) : [];
          existing.forEach(r => manager.removeRoute(r.from, r.to));
        } catch (e) { /* ignore */ }
        updated.options.targets.forEach(t => manager.addRoute(updated.id, t));
        // persist into cfg.routes (clean previous entries for this 'from')
        cfg.routes = cfg.routes || [];
        // remove old
        cfg.routes = cfg.routes.filter(r => r.from !== updated.id);
        updated.options.targets.forEach(t => cfg.routes.push({ from: updated.id, to: t }));
        saveConfig(cfg);
      }
    }
  }

  res.json(updated);
});

app.delete('/api/channels/:id', (req, res) => {
  const id = req.params.id;
  const idx = cfg.channels.findIndex((c) => c.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  cfg.channels.splice(idx, 1);
  saveConfig(cfg);
  // remove from manager and close adapter
  manager.removeChannel(id);
  res.status(204).end();
});

// Force reconnect / recreate adapter for a channel from current config
app.post('/api/channels/:id/reconnect', (req, res) => {
  const id = req.params.id;
  const ch = (cfg.channels || []).find(c => c.id === id);
  if (!ch) return res.status(404).json({ error: 'not found' });
  try {
    manager.removeChannel(id);
    console.log(`Reconnecting channel ${id} using config port=${(ch.options && ch.options.port) || ''}`);
    const adapter = createAdapterForChannel(ch);
    if (!adapter) {
      console.error(`Reconnect: createAdapterForChannel returned null for ${id}`);
      return res.status(500).json({ error: 'failed to create adapter (check server logs)' });
    }
    // Attach listeners to expose lifecycle events
    try {
      adapter.on && adapter.on('error', (err) => console.error(`Adapter error for ${id}:`, err && err.message));
      adapter.on && adapter.on('open', () => console.log(`Adapter open for ${id}`));
      adapter.on && adapter.on('close', () => console.log(`Adapter close for ${id}`));
    } catch (e) { /* ignore */ }
    manager.addChannel({ id: ch.id, name: ch.name, adapter, options: ch.options || {}, enabled: ch.enabled !== false });
    
    // Reload ALL routes (removing a channel can affect multiple route relationships)
    if (Array.isArray(cfg.routes)) {
      cfg.routes.forEach((r) => {
        console.log(`Reconnect: reloading route: ${r.from} -> ${r.to}`);
        try { manager.addRoute(r.from, r.to); } catch (e) { console.error('Reconnect route add failed:', e.message); }
      });
      console.log(`Reconnect: ${cfg.routes.length} total routes reloaded after ${id} reconnection`);
    }
    
    console.log(`Reconnect: adapter created and manager.addChannel called for ${id}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// list available serial ports (if serialport installed)
app.get('/api/serial-ports', async (req, res) => {
  try {
    const sp = require('serialport');
    let list = [];
    if (typeof sp.list === 'function') list = await sp.list();
    else if (sp && sp.SerialPort && typeof sp.SerialPort.list === 'function') list = await sp.SerialPort.list();
    // Normalize entries
    const out = list.map(p => ({ path: p.path || p.comName || p.device || p.locationId, manufacturer: p.manufacturer }));
    res.json(out);
  } catch (e) {
    // serialport not available or error
    res.json([]);
  }
});

// Debug: return last written bytes for a channel's adapter (if supported)
app.get('/api/channels/:id/last-written', (req, res) => {
  const id = req.params.id;
  const ch = manager.channels.get(id);
  if (!ch) return res.status(404).json({ error: 'channel not active' });
  const adapter = ch.adapter;
  if (!adapter) return res.status(404).json({ error: 'adapter not present' });
  if (typeof adapter.getLastWrite === 'function') {
    return res.json({ last: adapter.getLastWrite() });
  }
  return res.status(404).json({ error: 'adapter does not expose last-write' });
});

// Debug: return last raw bytes received for a channel (hex) if available
app.get('/api/channels/:id/last-received', (req, res) => {
  const id = req.params.id;
  const ch = manager.channels.get(id);
  if (!ch) return res.status(404).json({ error: 'channel not active' });
  const last = ch._lastRawRx || null;
  return res.json({ last });
});

// Debug: return adapter internals for a channel
app.get('/api/channels/:id/debug', (req, res) => {
  const id = req.params.id;
  const ch = manager.channels.get(id);
  if (!ch) return res.status(404).json({ error: 'channel not active' });
  const adapter = ch.adapter;
  if (!adapter) return res.status(404).json({ error: 'adapter not present' });
  const info = {
    transport: adapter.transport || null,
    isSerial: !!adapter.isSerial,
    open: !!adapter._open,
    lastWrite: (typeof adapter.getLastWrite === 'function') ? adapter.getLastWrite() : null,
  };
  // if serial adapter, try to include portPath
  if (adapter.isSerial) {
    info.portPath = adapter.portPath || (adapter.port && adapter.port.path) || null;
    info.baud = adapter.baud || (adapter.port && adapter.port.baudRate) || null;
  }
  res.json(info);
});

// Routes endpoints
app.get('/api/routes', (req, res) => res.json(cfg.routes || []));
app.post('/api/routes', (req, res) => {
  const { from, to } = req.body;
  if (!from || !to) return res.status(400).json({ error: 'from,to required' });
  cfg.routes = cfg.routes || [];
  cfg.routes.push({ from, to });
  saveConfig(cfg);
  manager.addRoute(from, to);
  res.status(201).json({ from, to });
});

app.delete('/api/routes', (req, res) => {
  const { from, to } = req.body;
  if (!from || !to) return res.status(400).json({ error: 'from,to required' });
  cfg.routes = cfg.routes || [];
  const idx = cfg.routes.findIndex(r => r.from === from && r.to === to);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  cfg.routes.splice(idx, 1);
  saveConfig(cfg);
  manager.removeRoute(from, to);
  res.status(204).end();
});

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
          const adapter = createAdapterForChannel(c);
          if (adapter) {
            manager.addChannel({ id: c.id, name: c.name, adapter, options: c.options || {}, enabled: c.enabled !== false });
            if (c.options && Array.isArray(c.options.targets)) c.options.targets.forEach(t => manager.addRoute(c.id, t));
          }
        });
      }
    } catch (e) { console.error('error reloading config.json', e) }
  });
} catch (e) { /* ignore watchers on unsupported platforms */ }

// REST endpoint to fetch recent frames
app.get('/api/frames', (req, res) => {
  res.json(recentFrames.slice(0, RECENT_FRAMES_MAX));
});

// IGATE config endpoints
app.get('/api/igate', (req, res) => {
  res.json(cfg.igate || { enabled: false, host: '', port: 14580, call: '', pass: '', channels: [] });
});

// GET /api/igate/status - return current igate connection status
app.get('/api/igate/status', (req, res) => {
  if (!igate) {
    res.json({ connected: false, authenticated: false, enabled: false });
    return;
  }
  const status = igate.getStatus();
  status.enabled = !!(cfg && cfg.igate && cfg.igate.enabled);
  res.json(status);
});

app.put('/api/igate', (req, res) => {
  const body = req.body || {};
  cfg.igate = Object.assign({}, cfg.igate || {}, body);
  saveConfig(cfg);
  try { ensureIgate(); } catch (e) {}
  res.json(cfg.igate);
});

// Simple TCP probe endpoint to test connectivity to a host:port
app.get('/api/probe', async (req, res) => {
  const host = req.query.host;
  const port = Number(req.query.port || 0);
  if (!host || !port) return res.status(400).json({ error: 'host,port required' });
  const socket = new net.Socket();
  let done = false;
  const timeout = setTimeout(() => {
    if (done) return; done = true; try { socket.destroy(); } catch(e){}; res.status(504).json({ ok: false, error: 'timeout' });
  }, 3000);
  socket.once('error', (err) => { if (done) return; done = true; clearTimeout(timeout); try { socket.destroy(); } catch(e){}; res.json({ ok: false, error: err.message }); });
  socket.connect(port, host, () => { if (done) return; done = true; clearTimeout(timeout); socket.end(); res.json({ ok: true }); });
});

// Serial probe: attempt to open the named serial port briefly to verify availability
app.get('/api/serial-probe', async (req, res) => {
  const portName = req.query.port;
  const baud = Number(req.query.baud || 9600);
  if (!portName) return res.status(400).json({ error: 'port required' });
  try {
    let sp;
    try {
      sp = require('serialport');
    } catch (e) {
      return res.json({ ok: false, error: 'serialport package not installed: ' + e.message });
    }

    // serialport v>=9 exports classes differently; support both common patterns
    const SerialPortClass = sp && sp.SerialPort ? sp.SerialPort : sp;
    let portObj;
    try {
      // Newer API: new SerialPort({ path, baudRate, autoOpen: false })
      if (typeof SerialPortClass === 'function') {
        try {
          portObj = new SerialPortClass({ path: portName, baudRate: baud, autoOpen: false });
        } catch (e) {
          // Fallback to older constructor style: new SerialPortClass(path, options)
          portObj = new SerialPortClass(portName, { baudRate: baud, autoOpen: false });
        }
      } else {
        return res.json({ ok: false, error: 'serialport API not recognized' });
      }
    } catch (e) {
      return res.json({ ok: false, error: 'failed constructing SerialPort: ' + e.message });
    }

    let done = false;
    const timer = setTimeout(() => {
      if (done) return; done = true; try { if (portObj && portObj.close) portObj.close(); } catch (e) {};
      return res.status(504).json({ ok: false, error: 'timeout' });
    }, 3000);

    const finish = (result) => { if (done) return; done = true; clearTimeout(timer); return res.json(result); };

    // attach one-time listeners for 'open' and 'error'
    const onOpen = () => {
      try {
        if (portObj && portObj.close) {
          // try close then respond
          portObj.close(() => finish({ ok: true }));
        } else {
          finish({ ok: true });
        }
      } catch (e) { finish({ ok: false, error: 'open succeeded but close failed: ' + e.message }); }
    };
    const onError = (err) => { finish({ ok: false, error: (err && err.message) ? err.message : String(err) }); };

    try {
      if (typeof portObj.open === 'function') {
        portObj.once && portObj.once('open', onOpen);
        portObj.once && portObj.once('error', onError);
        // open may return a Promise or accept a callback
        const p = portObj.open();
        if (p && typeof p.then === 'function') {
          p.catch(onError);
        }
      } else if (portObj.open && typeof portObj.open === 'undefined') {
        // older API might open on constructor; attach listeners and assume it's open
        portObj.once && portObj.once('open', onOpen);
        portObj.once && portObj.once('error', onError);
      } else {
        return finish({ ok: false, error: 'serialport open API not available' });
      }
    } catch (e) {
      return finish({ ok: false, error: 'error opening port: ' + e.message });
    }
  } catch (e) {
    return res.json({ ok: false, error: 'unexpected error: ' + e.message });
  }
});

// Beacon endpoint: send a composed AX.25 UI frame via a channel
app.post('/api/beacon', (req, res) => {
  const { channel, dest, source, path, payload } = req.body || {};
  if (!channel || !dest || !source || !payload) return res.status(400).json({ error: 'channel,dest,source,payload required' });
  try {
    console.log('BEACON request', { channel, dest, source, path, payload: String(payload).slice(0,60) });
    // check runtime channel presence
    const runtimeCh = manager.channels && manager.channels.get ? manager.channels.get(channel) : null;
    if (!runtimeCh) {
      console.warn('Beacon failed: channel not active in manager', channel);
      return res.status(404).json({ error: 'channel not active; call reconnect to create adapter' });
    }
    // build addresses: dest(7), src(7), path entries (each 7) with EA bit set on last
    const parts = [];
    // allow callsigns like 'NA4WX-9' to encode the numeric suffix into the SSID nibble
    const parseCall = (s) => {
      const m = String(s || '').toUpperCase().trim().match(/^([A-Z0-9]{1,6})(?:-(\d+))?$/);
      if (m) return { callsign: m[1].slice(0,6), ssid: m[2] ? Number(m[2]) : 0 };
      return { callsign: String(s || '').toUpperCase().slice(0,6), ssid: 0 };
    };
    const destParsed = parseCall(dest);
    const srcParsed = parseCall(source);
    parts.push(formatCallsign(destParsed.callsign, destParsed.ssid));
    parts.push(formatCallsign(srcParsed.callsign, srcParsed.ssid));
    if (Array.isArray(path)) {
      path.forEach((p, idx) => {
        const last = (idx === path.length - 1);
        // detect textual suffix like 'WIDE2-2' and encode numeric suffix into SSID when present
        const m = String(p || '').toUpperCase().trim().match(/^([A-Z0-9]{1,6})(?:-(\d+))?$/);
        let callsignPart = String(p || '').toUpperCase().slice(0,6);
        let ssidVal = 0;
        if (m) {
          callsignPart = m[1].slice(0,6);
          if (m[2]) ssidVal = Number(m[2]) || 0;
        }
        const buf = formatCallsign(callsignPart, ssidVal);
        // set EA bit on last address
        if (last) buf[6] = buf[6] | 0x01;
        parts.push(buf);
      });
    } else {
      // set EA on source if no path
      parts[1][6] = parts[1][6] | 0x01;
    }
    const header = Buffer.concat(parts);
    const control = Buffer.from([0x03]); // UI
    const pid = Buffer.from([0xF0]);
    const payloadBuf = Buffer.from(payload);
    const frame = Buffer.concat([header, control, pid, payloadBuf]);
    const ok = manager.sendFrame(channel, frame);
    if (!ok) {
      console.error('Beacon send failed: manager.sendFrame returned false for channel', channel);
      return res.status(500).json({ error: 'failed to send (no adapter or send error)' });
    }
    console.log('Beacon sent via manager for channel', channel);
    res.status(202).json({ sent: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
