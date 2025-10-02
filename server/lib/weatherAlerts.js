const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// load SAME codes mapping lazily
let SAME_MAP = null;
function loadSameMap() {
  if (SAME_MAP) return SAME_MAP;
  try {
    const p = path.join(__dirname, '..', 'data', 'SAMECodes.json');
    if (!fs.existsSync(p)) return (SAME_MAP = {});
    const raw = fs.readFileSync(p, 'utf8');
    const j = JSON.parse(raw || '{}');
    const states = Array.isArray(j.states) ? j.states : [];
    const map = {};
    for (const s of states) {
      const st = (s.state || '').toUpperCase();
      const sameObj = s.SAME || {};
      for (const [code, label] of Object.entries(sameObj)) {
        map[String(code)] = { label: String(label), state: st };
      }
    }
    SAME_MAP = map;
    return SAME_MAP;
  } catch (e) { SAME_MAP = {}; return SAME_MAP; }
}

// helper to create compact event abbreviation
function abbrevEvent(event) {
  if (!event) return 'ALRT';
  const map = {
    'Tornado Warning': 'TORN',
    'Tornado Watch': 'TOWH',
    'Severe Thunderstorm Warning': 'SVRW',
    'Flash Flood Warning': 'FFLD',
    'Flood Warning': 'FLOO',
    'Coastal Flood Warning': 'CFLD',
    'Air Quality Alert': 'AQAL'
  };
  if (map[event]) return map[event];
  // fallback: take first 4 letters of significant words
  const w = event.split(/\s+/).filter(Boolean).slice(0,2).map(s => s.replace(/[^A-Za-z]/g,'')).join(' ');
  const letters = w.replace(/\s+/g,'');
  return (letters.substring(0,4).toUpperCase() || 'ALRT');
}

// helper to build compact bulletin (option A)
function buildCompactBulletin(structured, maxLen, sameMap) {
  // use a fixed bulletin indicator 'BLN1' followed by event abbreviation
  // Map event names to fixed BLN tags (<=7 chars total)
  const tagMap = {
    'Tornado Warning': 'BLN2TOR',
    'Tornado': 'BLN2TOR',
    'Tornado Watch': 'BLN2TOR',
    'Severe Thunderstorm Warning': 'BLN3SVR',
    'Severe Thunderstorm': 'BLN3SVR',
    'Flash Flood Warning': 'BLN4FLD',
    'Flood Warning': 'BLN4FLD',
    'Coastal Flood Warning': 'BLN4FLD',
    'Air Quality Alert': 'BLN1WX',
    'General': 'BLN1WX',
    'Emergency': 'BLN9EMR'
  };
  const ev = (structured.event || structured.headline || 'General') || 'General';
  let prefix = tagMap[ev] || tagMap[structured.event] || null;
  if (!prefix) {
    // try to match known keys by substring
    const e = String(ev).toLowerCase();
    if (e.includes('tornado')) prefix = 'BLN2TOR';
    else if (e.includes('severe') && e.includes('thunder')) prefix = 'BLN3SVR';
    else if (e.includes('flood')) prefix = 'BLN4FLD';
    else if (e.includes('emergency') || e.includes('evac')) prefix = 'BLN9EMR';
    else prefix = 'BLN1WX';
  }
  const firstSame = (structured.same && structured.same.length) ? String(structured.same[0]) : null;
  const county = (sameMap && firstSame && sameMap[firstSame]) ? `${sameMap[firstSame].label} Co` : (structured.area || '');
  const state = (sameMap && firstSame && sameMap[firstSame]) ? ` ${sameMap[firstSame].state}` : '';
  // choose til time: use expires if present, else effective
  const til = structured.expires || structured.effective || null;
  let tilStr = '';
  try {
    if (til) {
      const dt = new Date(til);
      if (!isNaN(dt.getTime())) {
        // local short time like '5:30PM'
        tilStr = 'til ' + dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      }
    }
  } catch (e) { tilStr = ''; }

  // instruction or headline fragment
  const instruction = (structured.instruction || structured.headline || '').toUpperCase();

  let parts = [];
  // prefix already contains the BLN tag (e.g. BLN2TOR) and is <=7 chars
  // but the tag will be used as the APRS destination (To:), so don't include it in the payload text
  if (structured.event || structured.headline) parts.push(structured.event || structured.headline);
  if (county) parts.push(`${county}${state}`.trim());
  if (tilStr) parts.push(tilStr);
  if (instruction) parts.push(instruction);

  let text = parts.join(' ');
  if (text.length > maxLen) text = text.slice(0, maxLen - 3) + '...';
  // AX.25 destination callsign is max 6 chars for the base. Provide a safe dest variant.
  const dest = String(prefix || '').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6) || 'BLN1WX';
  return { tag: prefix, dest, text };
}

class WeatherAlertManager {
  constructor(opts) {
    this.manager = opts.manager; // ChannelManager
    this.settings = opts.settings || {};
    this.onUpdate = opts.onUpdate || (() => {});
    this.timer = null;
    this.recent = new Map(); // short-term dedupe: eventId -> ts
    // persisted sent alerts: eventId -> { hash, lastSent }
    this.persistPath = path.join(__dirname, '..', 'data', 'activeAlerts.json');
    this.sent = new Map();
    this._loadPersisted();
    // track bound listener so we can add/remove it
    this._boundFrameListener = null;
    // small cache for external bulletin hashes to avoid reprocessing the same on-air bulletin
    this._externalSeen = new Map();
  }

  _loadPersisted() {
    try {
      if (fs.existsSync(this.persistPath)) {
        const raw = fs.readFileSync(this.persistPath, 'utf8');
        const obj = JSON.parse(raw || '{}');
        Object.keys(obj).forEach(k => {
          try {
            const v = obj[k] || {};
            // Expect persisted shape: { hash, lastSent, alert }
            const alert = v.alert || {};
            this.sent.set(k, { hash: v.hash, lastSent: v.lastSent || 0, alert });
          } catch (e) {}
        });
      }
    } catch (e) {
      console.error('WeatherAlertManager: failed to load persisted alerts', e);
    }
  }

  _persist() {
    try {
      const out = {};
      for (const [k, v] of this.sent.entries()) {
        out[k] = { hash: v.hash, lastSent: v.lastSent, alert: v.alert || null };
      }
      fs.writeFileSync(this.persistPath, JSON.stringify(out, null, 2));
    } catch (e) {
      console.error('WeatherAlertManager: failed to persist alerts', e);
    }
  }

  _hashProps(p) {
    try {
      const s = JSON.stringify(p || {});
      return crypto.createHash('sha1').update(s).digest('hex');
    } catch (e) { return null; }
  }

  start() {
    if (!this.settings || !this.settings.nwsAlerts || !this.settings.nwsAlerts.enabled) return;
    const iv = (this.settings.nwsAlerts.pollIntervalSec || 900) * 1000;
    this.stop();
    this.timer = setInterval(() => this.checkAlerts().catch(e => console.error('WeatherAlertManager check failed', e)), iv);
    // run immediately
    this.checkAlerts().catch(e => console.error('WeatherAlertManager check failed', e));
  }

  stop() {
    try { if (this.timer) clearInterval(this.timer); } catch (e) {}
    this.timer = null;
  }

  updateSettings(s) {
    this.settings = s || this.settings;
    if (this.settings && this.settings.nwsAlerts && this.settings.nwsAlerts.enabled) this.start(); else this.stop();
    // Manage external bulletin repeat listener
    const repeatEnabled = !!(this.settings.nwsAlerts && this.settings.nwsAlerts.repeatExternalBulletins);
    if (repeatEnabled && !this._boundFrameListener && this.manager) {
      this._boundFrameListener = (evt) => this._onIncomingFrame(evt);
      this.manager.on('frame', this._boundFrameListener);
    } else if (!repeatEnabled && this._boundFrameListener && this.manager) {
      try { this.manager.removeListener('frame', this._boundFrameListener); } catch (e) {}
      this._boundFrameListener = null;
    }
  }

  // parse incoming frames to detect APRS weather bulletins that include SAME codes
  _onIncomingFrame(evt) {
    try {
      if (!evt || !evt.raw) return;
      // evt.raw is hex of the frame
      const buf = Buffer.from(evt.raw, 'hex');
      const parsed = require('./ax25').parseAx25Frame(buf);
      const payloadBuf = parsed.payload || Buffer.alloc(0);
      const payload = payloadBuf.toString('utf8').trim();
      if (!payload) return;
      // Look for typical SAME:... token in payload (case-insensitive)
      const m = payload.match(/SAME:([A-Z0-9,\-\s]+)/i);
      if (!m) return;
      const rawCodes = String(m[1] || '').split(',').map(s => String(s).trim()).filter(Boolean).map(s => {
        const mm = s.match(/(\d{6})/);
        return mm ? mm[1] : s.toUpperCase();
      });
      if (!rawCodes.length) return;
      const configured = (this.settings.nwsAlerts && Array.isArray(this.settings.nwsAlerts.sameCodes)) ? this.settings.nwsAlerts.sameCodes.map(s => String(s).trim().toUpperCase()) : [];
      const matched = configured.length > 0 && rawCodes.some(c => configured.includes(c));
      if (!matched) return;
      // dedupe by hash of payload (to avoid repeating same on-air bulletin)
      const h = crypto.createHash('sha1').update(payload).digest('hex');
      const now = Math.floor(Date.now()/1000);
      const extEntry = this._externalSeen.get(h);
      const extTTL = Number((this.settings.nwsAlerts && this.settings.nwsAlerts.externalSeenTTL) || 3600);
      if (extEntry && (now - extEntry.ts) < extTTL) return; // already processed recently
      this._externalSeen.set(h, { ts: now, raw: payload, codes: rawCodes });
      // If not already persisted as a captured alert (by matching same codes + payload hash), repeat it
      // Build a synthetic event id using hash
      const syntheticId = `external-${h}`;
      if (this.sent.has(syntheticId)) return;
      // Build structured alert to persist and re-broadcast
      const structured = {
        id: syntheticId,
        same: rawCodes,
        event: 'External Bulletin',
        headline: payload.split('\n')[0].slice(0,120),
        area: '',
        effective: null,
        expires: null,
        description: payload,
        instruction: '',
        url: null
      };
      // Format frames using aprsBulletin, include SAME codes so downstream stations can see them
      const { formatAprsBulletin } = require('./aprsBulletin');
      // compute til string if expires present in payload text (best-effort)
      // Support variants like: "TIL 5:30PM", "UNTIL 17:30", "TIL 1730Z", "TIL 5PM", "until 8 am"
      let extTil = null;
      try {
        const txt = String(structured.description || '');
        const mtil = txt.match(/(?:TIL|UNTIL)\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:AM|PM)?|[0-9]{3,4}Z?)/i);
        if (mtil && mtil[1]) {
          let t = mtil[1].toUpperCase().trim();
          // Normalize 4-digit military like 1730 or 0730 (optionally ending with Z)
          const m4 = t.match(/^([0-9]{3,4})(Z?)$/i);
          if (m4) {
            let digits = m4[1];
            if (digits.length === 3) digits = '0' + digits;
            const hh = digits.slice(0,2);
            const mm = digits.slice(2);
            t = `${hh}:${mm}` + (m4[2] ? 'Z' : '');
          } else {
            // Normalize single-hour tokens like '5PM' -> '5:00PM'
            const mHour = t.match(/^([0-9]{1,2})\s*(AM|PM)$/i);
            if (mHour) t = `${mHour[1]}:00${mHour[2].toUpperCase()}`;
          }
          extTil = t;
        }
      } catch (e) { extTil = null; }
      const frames = formatAprsBulletin({ sameCode: rawCodes[0], event: structured.event, area: structured.area, until: extTil, body: structured.description, options: { concise: true, includeSame: true, sameCodes: rawCodes } });
  structured.bulletin = { frames };
  structured.bulletinTag = 'ALLWX';
  structured.bulletinDest = 'ALLWX';
  structured.frames = frames;

      // send out via configured channels similar to checkAlerts send
      const path = (this.settings.nwsAlerts && this.settings.nwsAlerts.alertPath) ? String(this.settings.nwsAlerts.alertPath) : 'WIDE1-1';
      for (const [chId, ch] of this.manager.channels.entries()) {
        try {
          if (!ch.enabled) continue;
          const mode = (ch.mode || (ch.options && ch.options.mode) || '').toString().toLowerCase();
          const isDigipeat = mode.includes('digipeat') || (ch.options && ch.options.digipeat) || false;
          if (!isDigipeat) continue;
          const srcCall = (ch.options && ch.options.callsign) ? ch.options.callsign : (ch.name || ch.id);
          const tag = String(structured.bulletinTag || 'ALLWX').toUpperCase();
          const padded = tag.padEnd(9, ' ');
          for (const f of frames || []) {
            try {
              const payloadText = `:${padded}:${f.text}`;
              this.manager.sendAPRSMessage({ from: srcCall, to: 'ALLWX', payload: payloadText, channel: chId, path });
            } catch (e) {}
          }
          // secondary SAME message if needed
          try {
            if (structured.same && Array.isArray(structured.same) && structured.same.length) {
              const anyContainsSame = (frames || []).some(ff => /SAME:/i.test(ff.text) || structured.same.some(sc => ff.text.includes(sc)));
              if (!anyContainsSame) {
                const codes = structured.same.join(',');
                let codeText = `SAME:${codes}`;
                if (codeText.length > 200) codeText = codeText.slice(0, 197) + '...';
                const secondPayload = `:${padded}:${codeText}`;
                try { this.manager.sendAPRSMessage({ from: srcCall, to: 'ALLWX', payload: secondPayload, channel: chId, path }); } catch (e) {}
              }
            }
          } catch (e) {}
        } catch (e) {}
      }
      // Persist synthetic external bulletin so we don't re-capture it repeatedly
      const ahash = this._hashProps({ payload, codes: rawCodes });
      this.sent.set(syntheticId, { hash: ahash, lastSent: Math.floor(now), alert: structured });
      this._persist();
    } catch (e) {
      // ignore parse errors
    }
  }

  async checkAlerts() {
    try {
      // Query active alerts — optionally filter by state area if configured
      const area = (this.settings.nwsAlerts && this.settings.nwsAlerts.area) ? String(this.settings.nwsAlerts.area).toUpperCase() : 'ALL';
      let url = 'https://api.weather.gov/alerts/active';
      if (area && area !== 'ALL' && area.length === 2) {
        url = `${url}?area=${encodeURIComponent(area)}`;
      }
  console.log('[WeatherAlertManager] fetching alerts from', url);
  const res = await fetch(url, { headers: { 'User-Agent': 'NexDigi/1.0 (na4wx)' } });
  if (!res.ok) { console.error('[WeatherAlertManager] failed to fetch alerts:', res.status); return; }
  const j = await res.json();
  const features = Array.isArray(j.features) ? j.features : [];
  console.log(`[WeatherAlertManager] fetched ${features.length} alerts`);
      const sameCodes = (this.settings.nwsAlerts && Array.isArray(this.settings.nwsAlerts.sameCodes)) ? this.settings.nwsAlerts.sameCodes.map(s => String(s).trim().toUpperCase()).filter(Boolean) : [];
      const path = (this.settings.nwsAlerts && this.settings.nwsAlerts.alertPath) ? String(this.settings.nwsAlerts.alertPath) : 'WIDE1-1';
  const ttl = (this.settings.nwsAlerts && this.settings.nwsAlerts.recentlySentTTL) ? Number(this.settings.nwsAlerts.recentlySentTTL) : 1800;
  const maxLen = (this.settings.nwsAlerts && Number(this.settings.nwsAlerts.maxPayloadLen)) ? Number(this.settings.nwsAlerts.maxPayloadLen) : 200;

      // Clean old recent entries
      const now = Date.now()/1000;
      for (const [k, ts] of this.recent.entries()) {
        if (now - ts > ttl) this.recent.delete(k);
      }

    for (const f of features) {
        const props = f.properties || {};
        const eventId = props.id || props['@id'] || (f.id || null);
        if (!eventId) continue;
  // If we've recently sent or persisted this event and it's unchanged, skip
  if (this.recent.has(eventId) && this.sent.has(eventId)) continue; // already sent very recently

        // Collect SAME codes from multiple possible properties (geocode, parameters, top-level SAME)
        const sameCandidates = [];
        try {
          if (props.geocode && props.geocode.SAME) {
            const g = props.geocode.SAME;
            if (Array.isArray(g)) sameCandidates.push(...g);
            else sameCandidates.push(g);
          }
        } catch (e) {}
        try {
          const params = props.parameters || {};
          if (params.SAME) {
            const p = params.SAME;
            if (Array.isArray(p)) sameCandidates.push(...p);
            else sameCandidates.push(p);
          }
        } catch (e) {}
        try { if (props.SAME) { if (Array.isArray(props.SAME)) sameCandidates.push(...props.SAME); else sameCandidates.push(props.SAME); } } catch (e) {}

        // Normalize candidates to unique, trimmed strings and try to coerce to 6-digit SAME codes when present
        const SAME = Array.from(new Set((sameCandidates || []).map(s => String(s).trim()).filter(Boolean))).map(s => {
          const m = s.match(/(\d{6})/);
          return m ? m[1] : s.toUpperCase();
        });

    // Determine if any SAME code matches configured codes
    const matched = sameCodes.length > 0 && SAME.some(s => sameCodes.includes(s));
  if (!matched) continue;
  console.log('[WeatherAlertManager] matched alert', eventId, 'SAMEs:', SAME, 'against configured', sameCodes);
    // Compute hash for alert properties so we can detect updates
    const ahash = this._hashProps(props);
    const prev = this.sent.get(eventId);
    const alreadySentUnchanged = prev && prev.hash === ahash;

    // Build structured alert object (for persistence and client-friendly rendering)
    const headline = props.headline || props.event || props.eventType || (props.areaDesc || 'Weather Alert');
    const eventName = props.event || props.headline || props.eventType || '';
    const areaName = props.areaDesc || '';
    const effective = props.onset || props.effective || props.sent || null;
    const expires = props.expires || props.ends || null;
    const url = props['@id'] || props.id || props.uri || props.url || null;

    const structured = {
      id: eventId,
      same: SAME,
      event: eventName,
      headline: headline,
      area: areaName,
      effective: effective,
      expires: expires,
      description: props.description || '',
      instruction: props.instruction || '',
      url: url
    };

    // Helper: normalize date/time to ISO (UTC) or null
    const fmtDate = (d) => {
      if (!d) return null;
      try { const dt = new Date(d); if (isNaN(dt.getTime())) return null; return dt.toISOString(); } catch (e) { return null; }
    };

    // Compose an APRS-friendly single-line payload with labeled fields
    const parts = ['!WX ALERT!'];
    if (structured.same && structured.same.length) parts.push(`SAME:${structured.same.join(',')}`);
    if (structured.event) parts.push(`EVENT:${structured.event}`);
    if (structured.area) parts.push(`AREA:${structured.area}`);
    const eff = fmtDate(structured.effective); if (eff) parts.push(`EFFECTIVE:${eff}`);
    const exp = fmtDate(structured.expires); if (exp) parts.push(`EXPIRES:${exp}`);
    if (structured.headline) parts.push(`HEAD:${structured.headline}`);
    if (structured.url) parts.push(`URL:${structured.url}`);

  let payload = parts.join(' ');
  // Truncate to configured max length (safe for APRS / AX.25 UI payloads)
  if (payload.length > maxLen) payload = payload.slice(0, maxLen - 3) + '...';
  // Build compact bulletin using SAME map
  const sameMap = loadSameMap();
  const { formatAprsBulletin } = require('./aprsBulletin');
  const sameCodeGuess = (structured.same && structured.same.length) ? String(structured.same[0]) : null;
  // compute human-friendly 'til' time (e.g. '5:30PM') from expires/effective
  let tilStr = null;
  try {
    const til = structured.expires || structured.effective || null;
    if (til) {
      const dt = new Date(til);
      if (!isNaN(dt.getTime())) {
        tilStr = dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      }
    }
  } catch (e) { tilStr = null; }
  const frames = formatAprsBulletin({ sameCode: sameCodeGuess, event: structured.event || structured.headline, area: structured.area, until: tilStr, body: structured.instruction || structured.description || '', options: { maxChars: Math.max(40, Math.min(200, maxLen)), concise: true, includeSame: true, sameCodes: Array.isArray(structured.same) ? structured.same : (structured.same ? [String(structured.same)] : []) } });
  structured.bulletin = { frames };
  // For on-air sending, use APRS message destination ALLWX and persist that for UI
  structured.bulletinTag = 'ALLWX';
  structured.bulletinDest = 'ALLWX';
  structured.frames = frames;

        // Send to channels that are enabled and configured as digipeaters (avoid receive-only/disabled channels)
        // We'll prefer channels that are connected when possible.
        const candidates = [];
        for (const [chId, ch] of this.manager.channels.entries()) {
          try {
            if (!ch.enabled) continue; // skip disabled channels
            // determine if this channel is configured to act as a digipeater
            const mode = (ch.mode || (ch.options && ch.options.mode) || '').toString().toLowerCase();
            const isDigipeat = mode.includes('digipeat') || (ch.options && ch.options.digipeat) || false;
            if (!isDigipeat) continue; // skip receive-only or packet-only channels
            candidates.push({ id: chId, ch });
          } catch (e) {
            // ignore per-channel inspection errors
          }
        }
        // prefer connected channels first, then any others
        candidates.sort((a, b) => {
          const ac = (a.ch && a.ch.status && a.ch.status.connected) ? 1 : 0;
          const bc = (b.ch && b.ch.status && b.ch.status.connected) ? 1 : 0;
          return bc - ac; // connected first
        });

        if (alreadySentUnchanged) {
          // Update recent cache so we don't reprocess for TTL window
          this.recent.set(eventId, Math.floor(now));
          continue;
        }

        for (const cand of candidates) {
          const chId = cand.id; const ch = cand.ch;
          try {
            const srcCall = (ch.options && ch.options.callsign) ? ch.options.callsign : (ch.name || ch.id);
            // send each frame for this alert
            // Build padded header once per-channel
            const tag = String(structured.bulletinTag || 'ALLWX').toUpperCase();
            const padded = tag.padEnd(9, ' ');
            for (const f of structured.frames || []) {
              try {
                // Send as APRS message to ALLWX with leading ':ALLWX    :<text>' per requested format
                const payloadText = `:${padded}:${f.text}`;
                const ok = this.manager.sendAPRSMessage({ from: srcCall, to: 'ALLWX', payload: payloadText, channel: chId, path });
                console.log('[WeatherAlertManager] sent ALLWX message to', chId, 'len=', (payloadText||'').length, 'success=', !!ok);
              } catch (e) {
                console.error('WeatherAlertManager send frame failed for channel', chId, e);
              }
            }
            // If SAME codes exist but weren't included in any of the frames (or were truncated), send a compact SECONDARY message with JUST the SAME codes
            try {
              if (structured.same && Array.isArray(structured.same) && structured.same.length) {
                const anyContainsSame = (structured.frames || []).some(ff => /SAME:/i.test(ff.text) || structured.same.some(sc => ff.text.includes(sc)));
                if (!anyContainsSame) {
                  const codes = structured.same.join(',');
                  // limit codes text to maxLen so APRS payload stays reasonable
                  const maxCodesLen = Math.max(10, Math.min(200, maxLen || 67));
                  let codeText = `SAME:${codes}`;
                  if (codeText.length > maxCodesLen) codeText = codeText.slice(0, maxCodesLen - 3) + '...';
                  const secondPayload = `:${padded}:${codeText}`;
                  try {
                    const ok2 = this.manager.sendAPRSMessage({ from: srcCall, to: 'ALLWX', payload: secondPayload, channel: chId, path });
                    console.log('[WeatherAlertManager] sent ALLWX SAME-codes message to', chId, 'len=', (secondPayload||'').length, 'success=', !!ok2);
                  } catch (e) { /* ignore per-channel send errors */ }
                }
              }
            } catch (e) { /* ignore secondary send errors */ }
          } catch (e) {
            console.error('WeatherAlertManager send failed for channel', chId, e);
          }
        }
        // record that we've sent this event: persist hash & structured alert
        this.sent.set(eventId, { hash: ahash, lastSent: Math.floor(now), alert: structured });
        this._persist();
        this.recent.set(eventId, Math.floor(now));
      }

    } catch (e) {
      console.error('WeatherAlertManager.checkAlerts error', e);
    }
  }
}

// Return persisted active alerts (convenience)
WeatherAlertManager.prototype.getActiveAlerts = function() {
  const out = [];
  for (const [id, v] of this.sent.entries()) {
    const item = { id, hash: v.hash || null, lastSent: v.lastSent || null };
    if (v.alert) Object.assign(item, { alert: v.alert });
    out.push(item);
  }
  return out;
}

module.exports = WeatherAlertManager;
