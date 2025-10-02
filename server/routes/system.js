const express = require('express');
const router = express.Router();

// System routes (frames, routes, beacon)
module.exports = (dependencies) => {
  const { cfg, saveConfig, manager, recentFrames, formatCallsign, digipeaterSettings, updateDigipeaterSettings } = dependencies;

  // Routes endpoints - use digipeaterSettings.routes as authoritative operational storage
  router.get('/routes', (req, res) => {
    // prefer app.locals (set in index.js) falling back to injected digipeaterSettings or cfg.routes for compatibility
    const ds = (req.app && req.app.locals && req.app.locals.digipeaterSettings) ? req.app.locals.digipeaterSettings : (digipeaterSettings || null);
    if (ds && Array.isArray(ds.routes)) return res.json(ds.routes);
    return res.json(cfg.routes || []);
  });

  router.post('/routes', (req, res) => {
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'from,to required' });
    // Update operational digipeaterSettings if available
    const ds = (req.app && req.app.locals && req.app.locals.digipeaterSettings) ? req.app.locals.digipeaterSettings : (digipeaterSettings || null);
    if (ds && Array.isArray(ds.routes)) {
      ds.routes.push({ from, to });
      // persist via provided updater if available
      if (typeof updateDigipeaterSettings === 'function') {
        try { updateDigipeaterSettings(ds); } catch (e) { console.error('updateDigipeaterSettings failed:', e); }
      }
      try { manager.addRoute(from, to); } catch (e) { /* ignore */ }
      return res.status(201).json({ from, to });
    }
    // Fallback to legacy cfg.routes
    cfg.routes = cfg.routes || [];
    cfg.routes.push({ from, to });
    saveConfig(cfg);
    try { manager.addRoute(from, to); } catch (e) { /* ignore */ }
    res.status(201).json({ from, to });
  });

  router.delete('/routes', (req, res) => {
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'from,to required' });
    const ds = (req.app && req.app.locals && req.app.locals.digipeaterSettings) ? req.app.locals.digipeaterSettings : (digipeaterSettings || null);
    if (ds && Array.isArray(ds.routes)) {
      const idx = ds.routes.findIndex(r => r.from === from && r.to === to);
      if (idx === -1) return res.status(404).json({ error: 'not found' });
      ds.routes.splice(idx, 1);
      if (typeof updateDigipeaterSettings === 'function') {
        try { updateDigipeaterSettings(ds); } catch (e) { console.error('updateDigipeaterSettings failed:', e); }
      }
      try { manager.removeRoute(from, to); } catch (e) { /* ignore */ }
      return res.status(204).end();
    }
    // fallback to legacy cfg.routes
    cfg.routes = cfg.routes || [];
    const idx = cfg.routes.findIndex(r => r.from === from && r.to === to);
    if (idx === -1) return res.status(404).json({ error: 'not found' });
    cfg.routes.splice(idx, 1);
    saveConfig(cfg);
    try { manager.removeRoute(from, to); } catch (e) { /* ignore */ }
    res.status(204).end();
  });

  // REST endpoint to fetch recent frames
  router.get('/frames', (req, res) => {
    res.json(recentFrames.slice(0, 200));
  });

  // Beacon endpoint: send a composed AX.25 UI frame via a channel
  router.post('/beacon', (req, res) => {
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

  return router;
};