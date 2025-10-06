const express = require('express');
const router = express.Router();

// Digipeater routes
module.exports = (dependencies) => {
  const { digipeaterSettings, updateDigipeaterSettings, manager, weatherAlerts } = dependencies;

  router.get('/settings', (req, res) => {
    res.json(digipeaterSettings);
  });

  router.post('/settings', (req, res) => {
    const { enabled, channels, routes, nwsAlerts, metricsThresholds, metricsCheckIntervalSec } = req.body;
    console.log('[DEBUG] POST /api/digipeater/settings - body:', JSON.stringify(req.body));
    try {
      // ensure nwsAlerts is an object and has repeatExternalBulletins defaulted
      const nws = (nwsAlerts && typeof nwsAlerts === 'object') ? nwsAlerts : {};
      if (typeof nws.repeatExternalBulletins !== 'boolean') nws.repeatExternalBulletins = false;

      // Validate channels: ensure role is fill-in or wide, and maxWideN is numeric 1-7
      const safeChannels = {};
      if (channels && typeof channels === 'object') {
        Object.keys(channels).forEach((cid) => {
          const s = channels[cid] || {};
          const r = (typeof s.role === 'string') ? String(s.role).toLowerCase() : 'wide';
          const role = (r === 'fill-in' || r === 'fillin' || r === 'fill_in') ? 'fill-in' : 'wide';
          const mw = Number(s.maxWideN);
          const maxWideN = (Number.isFinite(mw) && mw > 0) ? Math.min(7, Math.max(1, mw)) : 2;
          safeChannels[cid] = Object.assign({}, s, { role, maxWideN });
        });
      }

  // Optional seenCache tuning
  const seenCache = (req.body.seenCache && typeof req.body.seenCache === 'object') ? req.body.seenCache : undefined;
  // Optional metric thresholds and check interval
  const safeMetricsThresholds = (metricsThresholds && typeof metricsThresholds === 'object') ? metricsThresholds : undefined;
  const safeMetricsCheckIntervalSec = (Number.isFinite(Number(metricsCheckIntervalSec)) && Number(metricsCheckIntervalSec) > 0) ? Number(metricsCheckIntervalSec) : undefined;

      updateDigipeaterSettings({ 
        enabled: !!enabled, 
        channels: safeChannels,
        routes: routes || [],
        nwsAlerts: nws,
        seenCache,
        metricsThresholds: safeMetricsThresholds,
        metricsCheckIntervalSec: safeMetricsCheckIntervalSec
      });
      console.log('Updated Digipeater settings:', digipeaterSettings);
      res.status(200).send();
    } catch (e) {
      console.error('Failed to update digipeater settings:', e);
      res.status(500).json({ error: 'failed to save settings' });
    }
  });

  // Helper: fetch SAME codes for area
  router.get('/same-codes', async (req, res) => {
    try {
      const area = (req.query.area || '').toUpperCase();
      // First try local SAMECodes.json. Support area=ALL to return flattened list.
      try {
        const path = require('path');
        const fs = require('fs');
        const sameFile = path.join(__dirname, '..', 'data', 'SAMECodes.json');
        if (fs.existsSync(sameFile)) {
          const raw = fs.readFileSync(sameFile, 'utf8');
          const parsed = JSON.parse(raw);
          const states = Array.isArray(parsed.states) ? parsed.states : [];
          if (area === 'ALL' || !area) {
            // flatten all codes into { code, label, state }
            const out = [];
            for (const s of states) {
              const st = (s.state || '').toUpperCase();
              const map = s.SAME || {};
              for (const [code, label] of Object.entries(map)) {
                out.push({ code: String(code), label: String(label), state: st });
              }
            }
            // dedupe by code keeping first
            const seen = new Set();
            const dedup = [];
            for (const c of out) {
              if (!seen.has(c.code)) { seen.add(c.code); dedup.push(c); }
            }
            dedup.sort((a,b) => a.label.localeCompare(b.label));
            return res.json(dedup);
          } else {
            const found = states.find(s => (s.state || '').toUpperCase() === area);
            if (found && found.SAME) {
              const codes = Object.keys(found.SAME).map(k => ({ code: String(k), label: String(found.SAME[k]) }));
              // sort by label for nicer dropdown
              codes.sort((a, b) => a.label.localeCompare(b.label));
              return res.json(codes);
            }
          }
        }
      } catch (e) {
        console.error('same-codes local read failed', e);
      }

      // Fallback: use NWS alerts / zones like before
      let url = 'https://api.weather.gov/alerts/active';
      if (area && area !== 'ALL' && area.length === 2) {
        url = `${url}?area=${encodeURIComponent(area)}`;
      }
      const resp = await fetch(url, { headers: { 'User-Agent': 'NexDigi/1.0 (na4wx)' } });
      if (!resp.ok) return res.status(502).json({ error: 'failed to fetch alerts' });
      const j = await resp.json();
      const features = Array.isArray(j.features) ? j.features : [];

      const codes = [];
      for (const f of features) {
        const p = f.properties || {};
        // parameters.SAME often contains SAME codes (array or single)
        const params = p.parameters || {};
        const sameRaw = params.SAME || params.same || p.SAME || p.same || null;
        if (!sameRaw) continue;
        const items = Array.isArray(sameRaw) ? sameRaw : [sameRaw];
        for (let s of items) {
          if (!s) continue;
          s = String(s).trim();
          // try to extract 6-digit numeric code, otherwise use raw uppercased
          const m = s.match(/(\d{6})/);
          const code = m ? m[1] : s.toUpperCase();
          const label = p.areaDesc || p.headline || p.event || p.description || (f.id || '');
          codes.push({ code: String(code), label });
        }
      }
      // dedupe by code keeping first label
      const seen = new Set();
      const dedup = [];
      for (const c of codes) {
        if (!seen.has(c.code)) { seen.add(c.code); dedup.push(c); }
      }
      // If no codes found in alerts, fallback to zones endpoint (best-effort)
      if (dedup.length === 0) {
        try {
          let zurl = 'https://api.weather.gov/zones?type=county';
          if (area && area !== 'ALL' && area.length === 2) zurl += `&area=${encodeURIComponent(area)}`;
          const zr = await fetch(zurl, { headers: { 'User-Agent': 'NexDigi/1.0 (na4wx)' } });
          if (zr.ok) {
            const zj = await zr.json();
            const zfeatures = Array.isArray(zj.features) ? zj.features : [];
            for (const f of zfeatures) {
              const p = f.properties || {};
              const same = p.SAME || p.same || (p.parameters && p.parameters.SAME) || null;
              const s = Array.isArray(same) ? same[0] : same;
              if (!s) continue;
              const m = String(s).match(/(\d{6})/);
              const code = m ? m[1] : String(s);
              const label = p.name || p.areaDesc || p.description || (f.id || '');
              if (!seen.has(code)) { seen.add(code); dedup.push({ code: String(code), label }); }
            }
          }
        } catch (e) { /* ignore */ }
      }
      res.json(dedup);
    } catch (e) {
      console.error('same-codes error', e);
      res.status(500).json({ error: 'internal error' });
    }
  });

  // Test endpoint: force-send an APRS WX alert (for debugging/testing)
  router.post('/test-alert', (req, res) => {
    try {
      const { code, headline, area } = req.body || {};
      if (!code || !headline) return res.status(400).json({ error: 'missing code or headline' });
      const path = (digipeaterSettings && digipeaterSettings.nwsAlerts && digipeaterSettings.nwsAlerts.alertPath) ? digipeaterSettings.nwsAlerts.alertPath : 'WIDE1-1';
      const payload = `!WX ALERT! ${headline} (SAME=${code}${area ? ' AREA=' + area : ''})`;
      // send via channels that are enabled and configured as digipeaters
      const results = [];
      for (const [chId, ch] of manager.channels.entries()) {
        try {
          if (!ch.enabled) continue;
          const mode = (ch.mode || (ch.options && ch.options.mode) || '').toString().toLowerCase();
          const isDigipeat = mode.includes('digipeat') || (ch.options && ch.options.digipeat) || false;
          if (!isDigipeat) continue;
          const srcCall = (ch.options && ch.options.callsign) ? ch.options.callsign : (ch.name || ch.id);
          const ok = manager.sendAPRSMessage({ from: srcCall, to: 'APRS', payload, channel: chId, path });
          results.push({ channel: chId, ok: !!ok });
        } catch (e) {
          results.push({ channel: chId, ok: false, err: String(e) });
        }
      }
      res.json({ ok: true, results });
    } catch (e) {
      console.error('test-alert error', e);
      res.status(500).json({ error: 'internal error' });
    }
  });

  // Debug/Test: simulate an incoming APRS frame payload on a channel (so WeatherAlertManager can process it)
  router.post('/simulate-incoming-bulletin', (req, res) => {
    try {
      const { payload, channel } = req.body || {};
      if (!payload || !channel) return res.status(400).json({ error: 'missing payload or channel' });
      // create a minimal AX.25 UI frame buffer: dest APRS, src SIM-1, control, pid, payload
      const { formatCallsign, buildAx25Frame } = require('../lib/ax25');
      const dest = 'APRS';
      const src = 'SIM-1';
      const frameBuf = buildAx25Frame({ dest, src, control: 0x03, pid: 0xF0, payload });
      // emit a frame event on the manager as if it was received
      if (manager && typeof manager.emit === 'function') {
        manager.emit('frame', { channel: channel, raw: frameBuf.toString('hex'), length: frameBuf.length });
        return res.json({ ok: true });
      }
      res.status(500).json({ error: 'manager unavailable' });
    } catch (e) {
      console.error('simulate-incoming-bulletin error', e);
      res.status(500).json({ error: 'internal error' });
    }
  });

  // Return list of available state abbreviations from local SAMECodes.json
  router.get('/same-states', (req, res) => {
    try {
      const path = require('path');
      const fs = require('fs');
      const sameFile = path.join(__dirname, '..', 'data', 'SAMECodes.json');
      if (!fs.existsSync(sameFile)) return res.json([]);
      const raw = fs.readFileSync(sameFile, 'utf8');
      const parsed = JSON.parse(raw);
      const states = Array.isArray(parsed.states) ? parsed.states : [];
      const list = states.map(s => (s.state || '').toUpperCase()).filter(Boolean).sort();
      res.json(list);
    } catch (e) {
      console.error('same-states error', e);
      res.status(500).json({ error: 'internal error' });
    }
  });

  // Return persisted active alerts
  router.get('/active-alerts', (req, res) => {
    try {
      if (!weatherAlerts || typeof weatherAlerts.getActiveAlerts !== 'function') return res.json([]);
      const list = weatherAlerts.getActiveAlerts();
      res.json(list);
    } catch (e) {
      console.error('active-alerts error', e);
      res.status(500).json({ error: 'internal error' });
    }
  });

  // Expose ChannelManager metrics and seen-cache info
  router.get('/metrics', (req, res) => {
    try {
      const out = { metrics: {}, seen: {} };
      if (manager && typeof manager.getMetrics === 'function') out.metrics = manager.getMetrics();
      if (manager) {
        out.seen = {
          size: manager.seen ? manager.seen.size : 0,
          ttl: manager.SEEN_TTL,
          maxEntries: manager.MAX_SEEN_ENTRIES
        };
        try {
          out.channels = { total: manager.channels ? manager.channels.size : 0, online: Array.from(manager.channels.values()).filter(c => c && c.status && c.status.connected).length };
        } catch (e) { out.channels = { total: 0, online: 0 }; }
        try { out.metrics.digipeats = manager.metrics ? (manager.metrics.digipeats || 0) : (out.metrics.digipeats || 0); } catch (e) {}
        try { out.metrics.uniqueStations = manager.metrics ? (manager.metrics.uniqueStations || manager.seen.size || 0) : (out.metrics.uniqueStations || 0); } catch (e) {}
      }
      res.json(out);
    } catch (e) {
      console.error('metrics endpoint error', e);
      res.status(500).json({ error: 'internal error' });
    }
  });

  // Metric alerts listing
  router.get('/metric-alerts', (req, res) => {
    try {
      if (!dependencies || typeof dependencies.getMetricAlerts !== 'function') return res.json([]);
      const list = dependencies.getMetricAlerts();
      res.json(list || []);
    } catch (e) {
      console.error('metric-alerts error', e);
      res.status(500).json({ error: 'internal error' });
    }
  });

  // Clear metric alerts
  router.post('/metric-alerts/clear', (req, res) => {
    try {
      if (!dependencies || typeof dependencies.clearMetricAlerts !== 'function') return res.status(400).json({ error: 'not available' });
      dependencies.clearMetricAlerts();
      res.json({ ok: true });
    } catch (e) {
      console.error('clear metric-alerts error', e);
      res.status(500).json({ error: 'internal error' });
    }
  });

  // Clear persisted active alerts (admin/debug)
  router.post('/active-alerts/clear', (req, res) => {
    try {
      if (!weatherAlerts) return res.status(400).json({ error: 'weatherAlerts not available' });
      // remove persisted file and in-memory map
      try { const p = require('path').join(__dirname, '..', 'data', 'activeAlerts.json'); if (require('fs').existsSync(p)) require('fs').unlinkSync(p); } catch (e) {}
      weatherAlerts.sent && weatherAlerts.sent.clear && weatherAlerts.sent.clear();
      res.json({ ok: true });
    } catch (e) {
      console.error('clear active-alerts error', e);
      res.status(500).json({ error: 'internal error' });
    }
  });

  // finally return the configured router
  return router;
};