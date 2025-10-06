const EventEmitter = require('events');
const { unescapeStream, escapeFrame } = require('./kiss');
const { parseAx25Frame, serviceAddressInBuffer, _callsignBase } = require('./ax25');

// Silence ChannelManager internal logs by default. Set to true to enable verbose debug.
const CM_VERBOSE = false;

function parseAprsPath(frameBuf) {
  // Very minimal APRS-like address/path parser. APRS frames are AX.25 UI frames; this is a heuristic.
  // We'll look for ASCII text and try to find comma-separated path entries after the destination.
  try {
    const s = frameBuf.toString('utf8');
    // naive: look for '>' (from>to,path,path2)
    const gt = s.indexOf('>');
    if (gt === -1) return [];
    const rest = s.slice(gt + 1);
    const parts = rest.split(',').map(p => p.trim()).filter(Boolean);
    return parts;
  } catch (e) { return [] }
}

class ChannelManager extends EventEmitter {
  constructor() {
    super();
    this.channels = new Map();
    this.routes = new Map(); // channelId -> Set of channelIds to cross-digipeat to
    // seen cache: map frameHex -> { ts: Date.now(), seen: Set(channelId) }
    this.seen = new Map();
    this.SEEN_TTL = 5 * 1000; // 5s for easier testing
    this.MAX_SEEN_ENTRIES = 1000; // eviction threshold
    // metrics for observability
    this.metrics = {
      servicedWideBlocked: 0,
      maxWideBlocked: 0,
      digipeats: 0,
      uniqueStations: 0
    };
    this.crossDigipeat = false; // when true, digipeat to all enabled channels (subject to seen-cache)
    this.allowSelfDigipeat = true; // allow repeating back out the same channel (typical digipeater behavior)
  }

  // Runtime setters for seen cache tuning
  setSeenTTL(ms) { if (Number.isFinite(Number(ms)) && ms > 0) this.SEEN_TTL = Number(ms); }
  setMaxSeenEntries(n) { if (Number.isFinite(Number(n)) && n > 0) this.MAX_SEEN_ENTRIES = Number(n); }
  getMetrics() { return Object.assign({}, this.metrics); }

  setCrossDigipeat(v) { this.crossDigipeat = !!v; }

  normalizeFrameHex(frame) {
    // Normalize by AX.25 addresses + payload to avoid adapter-added metadata differences
    try {
      const parsed = require('./ax25').parseAx25Frame(frame);
      const addrStr = (parsed.addresses || []).map(a => `${a.callsign}:${a.ssid}`).join('|');
      const payloadHex = (parsed.payload || Buffer.alloc(0)).toString('hex');
      return `${addrStr}|${payloadHex}`;
    } catch (e) {
      return frame.toString('hex');
    }
  }

  // Create a seen-cache key that normalizes WIDE-style path entries so that
  // 'WIDE2-2' and 'WIDE2-1' are considered the same logical frame for loop
  // prevention. Other callsigns keep their SSID information.
  _seenKey(frame) {
    try {
      const parsed = require('./ax25').parseAx25Frame(frame);
      const addrStr = (parsed.addresses || []).map(a => {
        const base = _callsignBase(a.callsign);
        if (/^WIDE/i.test(base)) {
          return base; // collapse numeric suffix for WIDE entries
        }
        return `${a.callsign}:${a.ssid}`;
      }).join('|');
      const payloadHex = (parsed.payload || Buffer.alloc(0)).toString('hex');
      return `${addrStr}|${payloadHex}`;
    } catch (e) {
      return frame.toString('hex');
    }
  }

  _evictSeenIfNeeded() {
    if (this.seen.size <= this.MAX_SEEN_ENTRIES) return;
    // remove oldest entry
    let oldestKey = null;
    let oldestTs = Infinity;
    for (const [k, v] of this.seen.entries()) {
      if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
    }
    if (oldestKey) this.seen.delete(oldestKey);
  }

  // Cleanup seen-cache by removing entries older than SEEN_TTL and ensuring size limits.
  cleanupSeen() {
    try {
      const now = Date.now();
      const toDelete = [];
      for (const [k, v] of this.seen.entries()) {
        if (!v || typeof v.ts !== 'number') { toDelete.push(k); continue; }
        if (now - v.ts > this.SEEN_TTL) toDelete.push(k);
      }
      for (const k of toDelete) this.seen.delete(k);
      // update uniqueStations metric to current seen size as approximation
      try { this.metrics.uniqueStations = this.seen.size; } catch (e) {}
      // enforce max entries after cleanup
      this._evictSeenIfNeeded();
    } catch (e) { /* best-effort cleanup */ }
  }

  addChannel({ id, name, adapter }) {
    const opts = (arguments[0] && arguments[0].options) || {};
    const mode = (arguments[0] && arguments[0].mode) || (opts && opts.mode) || 'digipeat';
    // new per-channel ID options
  // Accept either `appendDigiCallsign` (legacy internal) or `appendCallsign` (UI/persisted) from options
  const appendDigiCallsign = !!(opts && (opts.appendDigiCallsign || opts.appendCallsign));
  const idOnRepeat = !!(opts && opts.idOnRepeat);
  const periodicBeaconInterval = Number((opts && opts.periodicBeaconInterval) || 0); // seconds; 0 disables
  const periodicBeaconText = String((opts && opts.periodicBeaconText) || '') || null;
  const ch = { id, name, adapter, enabled: true, options: opts, mode, appendDigiCallsign, idOnRepeat, periodicBeaconInterval, periodicBeaconText, _periodicBeaconTimer: null, status: { connected: true, lastRx: null, lastTx: null } };
    this.channels.set(id, ch);

    adapter.on('data', (buf) => {
      try {
        const cVerbose = (this.channels.get(id) && this.channels.get(id).options && this.channels.get(id).options.verbose);
  // raw data logging suppressed
      } catch (e) {}
      // update lastRx timestamp and store last raw buffer (hex) for debugging
      const c = this.channels.get(id);
      if (c) {
        c.status = c.status || {};
        c.status.lastRx = Date.now();
        try { c._lastRawRx = (buf && buf.length) ? buf.toString('hex') : null; } catch (e) { c._lastRawRx = null; }
      }
      this.emit('channel-status', { id, status: c && c.status });
      this._onRawData(id, buf);
    });
    adapter.on('error', (err) => this.emit('adapter-error', { id, err }));
    if (typeof adapter.on === 'function') {
      adapter.on('open', () => { const c = this.channels.get(id); if (c) { c.status.connected = true; this.emit('channel-status', { id, status: c.status }); } });
      adapter.on('close', () => { const c = this.channels.get(id); if (c) { c.status.connected = false; this.emit('channel-status', { id, status: c.status }); } });
    }

    // start periodic beacon if configured
    if (ch.periodicBeaconInterval && ch.periodicBeaconInterval > 0) {
      try {
        // schedule interval
        ch._periodicBeaconTimer = setInterval(() => this._sendBeaconForChannel(ch.id), ch.periodicBeaconInterval * 1000);
        // attempt immediate send; if adapter not open, wait for adapter 'open' event
        try {
          this._sendBeaconForChannel(ch.id);
        } catch (err) {
          try {
            if (adapter && typeof adapter.once === 'function') {
              adapter.once('open', () => { try { this._sendBeaconForChannel(ch.id); } catch (e) {} });
            }
          } catch (e) { /* ignore */ }
        }
      } catch (e) { /* ignore timer errors */ }
    }

    return ch;
  }

  removeChannel(id) {
    const ch = this.channels.get(id);
    if (!ch) return false;
    try {
      if (ch.adapter && typeof ch.adapter.close === 'function') ch.adapter.close();
    } catch (e) { /* ignore */ }
    // clear any periodic timers
    try { if (ch && ch._periodicBeaconTimer) clearInterval(ch._periodicBeaconTimer); } catch (e) {}
    this.channels.delete(id);
    // remove any routes referencing this channel
    this.routes.forEach((set, from) => { if (set.has(id)) set.delete(id); });
    this.emit('channel-removed', id);
    return true;
  }

  listChannels() {
    return Array.from(this.channels.values()).map(({ id, name, enabled, options, status }) => ({ id, name, enabled, options: options || {}, status: status || {} }));
  }

  addRoute(fromId, toId) {
    if (!this.routes.has(fromId)) this.routes.set(fromId, new Set());
    this.routes.get(fromId).add(toId);
  }

  removeRoute(fromId, toId) {
    if (!this.routes.has(fromId)) return;
    this.routes.get(fromId).delete(toId);
  }

  sendFrame(channelId, buf) {
    const ch = this.channels.get(channelId);
    if (!ch) return false;
    // Decide whether to KISS-wrap before sending to serial adapters. We prefer raw AX.25
    // on serial, but some TNCs use KISS over serial — detect that automatically or allow
    // forcing via channel.options.forceKissOnSerial.
    try {
      const adapter = ch.adapter;
      const forceKiss = (ch.options && ch.options.forceKissOnSerial) || false;
      const observedKiss = adapter && !!adapter._observedKiss;
      if (adapter && adapter.isSerial && (forceKiss || observedKiss)) {
        const pkt = escapeFrame(buf);
        if (CM_VERBOSE) console.log(`sendFrame -> ${channelId} (serial-kiss):`, pkt.slice(0,256).toString('hex'));
        adapter.send(pkt);
      } else if (adapter && adapter.isSerial) {
        const hex = buf.slice(0,256).toString('hex');
        if (CM_VERBOSE) console.log(`sendFrame -> ${channelId} (raw):`, hex);
        adapter.send(buf);
      } else {
        const pkt = escapeFrame(buf);
        if (CM_VERBOSE) console.log(`sendFrame -> ${channelId} (kiss):`, pkt.slice(0,256).toString('hex'));
        ch.adapter.send(pkt);
      }
    } catch (e) {
      this.emit('adapter-error', { id: channelId, err: e });
      console.error('sendFrame adapter error', e && e.message);
      return false;
    }
    ch.status = ch.status || {}; ch.status.lastTx = Date.now();
    this.emit('channel-status', { id: channelId, status: ch.status });
    this.emit('tx', { channel: channelId, raw: buf.toString('hex') });
    return true;
  }

  _sendIdBeaconForChannel(channelId) {
    // compose a short identification UI packet (no path) with payload like "Digi <callsign> ID"
    const ch = this.channels.get(channelId);
    if (!ch) return false;
    const opts = ch.options || {};
    const callsign = (opts.callsign) ? String(opts.callsign).toUpperCase() : (ch.name || ch.id).toUpperCase();
    // build a very small AX.25 UI frame: dest APRS, src callsign, EA set on source, UI control 0x03, PID 0xF0, payload text
    const { formatCallsign } = require('./ax25');
    const destBuf = formatCallsign('APRS', 0);
    const srcParts = callsign.match(/^([A-Z0-9]{1,6})(?:-(\d+))?$/);
    const srcBase = srcParts ? srcParts[1] : callsign.slice(0,6);
    const srcSsid = srcParts && srcParts[2] ? Number(srcParts[2]) : 0;
    const srcBuf = formatCallsign(srcBase.slice(0,6), srcSsid);
    // mark EA on source as last address (no path)
    srcBuf[6] = srcBuf[6] | 0x01;
    const control = Buffer.from([0x03]);
    const pid = Buffer.from([0xF0]);
    const payload = Buffer.from(`Digi ${callsign} ID`);
    const frame = Buffer.concat([destBuf, srcBuf, control, pid, payload]);
    return this.sendFrame(channelId, frame);
  }

  _sendBeaconForChannel(channelId) {
    const ch = this.channels.get(channelId);
    if (!ch) return false;
    const opts = ch.options || {};
    const callsign = (opts.callsign) ? String(opts.callsign).toUpperCase() : (ch.name || ch.id).toUpperCase();
    const text = (ch.periodicBeaconText && String(ch.periodicBeaconText).trim()) ? ch.periodicBeaconText : ((opts && opts.periodicBeaconText) ? String(opts.periodicBeaconText) : null);
    if (!text) return false; // nothing to send
    
    // Format as proper APRS status message (starts with '>')
    const formattedText = text.startsWith('>') ? text : `>${text}`;
    
    const { formatCallsign } = require('./ax25');
    const destBuf = formatCallsign('APRS', 0);
    const srcParts = callsign.match(/^([A-Z0-9]{1,6})(?:-(\d+))?$/);
    const srcBase = srcParts ? srcParts[1] : callsign.slice(0,6);
    const srcSsid = srcParts && srcParts[2] ? Number(srcParts[2]) : 0;
    const srcBuf = formatCallsign(srcBase.slice(0,6), srcSsid);
    srcBuf[6] = srcBuf[6] | 0x01; // set EA
    const control = Buffer.from([0x03]);
    const pid = Buffer.from([0xF0]);
    const payload = Buffer.from(formattedText);
    const frame = Buffer.concat([destBuf, srcBuf, control, pid, payload]);
    return this.sendFrame(channelId, frame);
  }

  async _onRawData(channelId, buf) {
    // Buffer incoming data per channel and process complete KISS frames
    const ch = this.channels.get(channelId);
    const adapter = ch && ch.adapter;

    // Initialize channel buffer if needed
    if (!ch._rxBuffer) ch._rxBuffer = Buffer.alloc(0);
    
    // Append new data
    ch._rxBuffer = Buffer.concat([ch._rxBuffer, buf]);
    
    let frames = [];
    
    // Look for complete KISS frames (data between FEND bytes)
    if (ch._rxBuffer.indexOf(0xC0) !== -1) {
      // Mark as KISS-capable adapter
      if (adapter) adapter._observedKiss = true;
      
      // Process all complete frames
      let processed = 0;
      while (true) {
        const startFend = ch._rxBuffer.indexOf(0xC0, processed);
        if (startFend === -1) break;
        
        const endFend = ch._rxBuffer.indexOf(0xC0, startFend + 1);
        if (endFend === -1) break; // No complete frame yet
        
        // Extract frame data (skip FEND bytes)
        const frameData = ch._rxBuffer.slice(startFend + 1, endFend);
        if (frameData.length > 0) {
          try {
            // Parse KISS frame - remove command byte if present  
            let ax25Data = frameData;
            if (ax25Data[0] <= 0x1F) ax25Data = ax25Data.slice(1); // Remove KISS command
            if (ax25Data.length > 0) frames.push(ax25Data);
          } catch (e) {
            // Skip invalid frames
          }
        }
        processed = endFend + 1;
      }
      
      // Keep unprocessed data
      ch._rxBuffer = ch._rxBuffer.slice(processed);
    } else if (ch._rxBuffer.length > 1000) {
      // If buffer gets too large without KISS framing, treat as raw AX.25 and reset
      if (ch._rxBuffer.length > 0) frames.push(ch._rxBuffer);
      ch._rxBuffer = Buffer.alloc(0);
    }

    // Process all frames in parallel
    await Promise.all(frames.map(async (frame) => {
      // emit frame event
      const event = { channel: channelId, raw: frame.toString('hex'), length: frame.length };
      try {
        const verbose = (ch && ch.options && ch.options.verbose);
  // parsed frame logging suppressed
      } catch (e) {}
      this.emit('frame', event);

      // parse AX.25 addresses
      let parsed;
      try {
        parsed = parseAx25Frame(frame);
      } catch (e) {
        // fallback: don't attempt path-aware digipeat
        this.emit('parse-error', { channel: channelId, err: e });
        return;
      }

      // If this receiving channel is not configured as a digipeater, we normally don't
      // attempt to service path entries. However, if the operator has explicitly
      // configured routes from this channel to other targets (e.g., cross-channel
      // forwarding from a receive-only radio to a digipeater channel), we should
      // still forward the raw frame to those targets. This preserves the previous
      // behavior for digipeaters while enabling manual route forwarding.
      const recvCh = this.channels.get(channelId);
      const routeTargetsConfigured = this.routes.get(channelId) ? Array.from(this.routes.get(channelId)) : [];
      // If channel is not present, nothing to do
      if (!recvCh) return;
      // If channel is not configured as digipeat but has explicit routes, forward raw frames
      if (recvCh.mode && recvCh.mode !== 'digipeat' && routeTargetsConfigured.length > 0) {
        // Use seen-cache to avoid loops / duplicate sends
  const keyRaw = this._seenKey(frame);
  const nowRaw = Date.now();
  const entryRaw = this.seen.get(keyRaw) || { ts: nowRaw, seen: new Set() };
  if (nowRaw - entryRaw.ts > this.SEEN_TTL) { entryRaw.ts = nowRaw; entryRaw.seen = new Set(); }
        for (const targetId of routeTargetsConfigured) {
          if (entryRaw.seen.has(targetId)) continue;
          const target = this.channels.get(targetId);
          if (!target || !target.enabled) continue;
          // Prevent sending back to origin unless explicitly routed
          if (!this.allowSelfDigipeat && targetId === channelId) continue;
          try {
            this.sendFrame(targetId, frame);
            this.emit('digipeat', { from: channelId, to: targetId, raw: frame.toString('hex'), serviced: null, note: 'forward-raw' });
            try { this.metrics.digipeats = (this.metrics.digipeats || 0) + 1; } catch (e) {}
            entryRaw.seen.add(targetId);
          } catch (e) {
            this.emit('digipeat-error', { from: channelId, to: targetId, err: e });
          }
        }
        this.seen.set(keyRaw, entryRaw);
        return;
      }

      const addresses = parsed.addresses || [];
      // AX.25: addresses[0]=dest, [1]=source, [2...] = path
      const pathAddrs = addresses.slice(2).map(a => ({ callsign: a.callsign, ssid: a.ssid, marked: !!a.marked }));

      // Debug: log parsed addresses when verbose
      try {
        const verbose = (recvCh && recvCh.options && recvCh.options.verbose);
        // parsed addresses logging suppressed
      } catch (e) {}

      // seen-cache housekeeping
  const key = this._seenKey(frame);
      const now = Date.now();
      // preserve any existing servicedWide flag when reusing an entry
      const existingEntry = this.seen.get(key);
      const entry = existingEntry || { ts: now, seen: new Set(), servicedWide: false };
      // remove old entries if stale (reset seen and servicedWide)
      if (now - entry.ts > this.SEEN_TTL) {
        entry.ts = now;
        entry.seen = new Set();
        entry.servicedWide = false;
      }
      // If self-digipeat is disabled, mark source channel as having seen this frame
      // immediately to prevent sending back to origin. If self-digipeat is allowed,
      // we defer marking until after we send so the channel can be used as a target.
      if (!this.allowSelfDigipeat) {
        entry.seen.add(channelId);
      }
      this.seen.set(key, entry);

      // digipeat targets: by default only configured routes; if crossDigipeat enabled, include all enabled channels
      const routeTargets = this.routes.get(channelId) ? Array.from(this.routes.get(channelId)) : [];
      const allTargets = new Set(routeTargets);
      if (this.crossDigipeat) {
        this.channels.forEach((ch, id) => { if (id !== channelId && ch.enabled) allTargets.add(id); });
      }

      // Debug: log digipeat targets when verbose
      try {
        const verbose = (recvCh && recvCh.options && recvCh.options.verbose);
  // digipeat targets logging suppressed
      } catch (e) {}

      // Process all targets in parallel instead of sequentially
      const digipeatingPromises = Array.from(allTargets).map(async (targetId) => {
        // Debug: log forEach entry
        try {
          const verbose = (recvCh && recvCh.options && recvCh.options.verbose);
          // per-target iteration logging suppressed
        } catch (e) {}
        
        // If self-digipeat is disabled, never send back to originating channel unless explicitly routed to itself
        if (!this.allowSelfDigipeat && targetId === channelId) {
          try {
            const verbose = (recvCh && recvCh.options && recvCh.options.verbose);
            // skipping self-digipeat logging suppressed
          } catch (e) {}
          return;
        }
        // skip if already seen on this target
        if (entry.seen.has(targetId)) {
          try {
            const verbose = (recvCh && recvCh.options && recvCh.options.verbose);
            // already-seen skip logging suppressed
          } catch (e) {}
          return;
        }
        const target = this.channels.get(targetId);
        if (!target) return;

        // determine callsign for this channel (assumption: options.callsign or name or id)
        const targetCall = (target.options && target.options.callsign) || target.name || target.id;
        if (!targetCall) return;

        // Debug: log target evaluation when verbose
        try {
          const verbose = (target.options && target.options.verbose);
          // target evaluation logging suppressed
        } catch (e) {}

        // A digipeater should service frames if:
        // 1. Path contains its own callsign (unmarked), OR
        // 2. Path contains WIDE entries with remaining hops (subject to channel role and maxWideN)
        const callsignMatch = pathAddrs.findIndex(p => p.callsign && p.callsign.toUpperCase() === targetCall.toUpperCase() && !p.marked);
        // Apply role rules: fill-in services only WIDE1-N; wide services WIDE2-N and above
        const tgtRole = (target.role || '').toLowerCase();
        const maxWideN = Number.isFinite(target.maxWideN) ? target.maxWideN : 2;
        const isFillInOk = (p) => /^WIDE1/i.test(p.callsign || '') && (typeof p.ssid === 'number' ? p.ssid > 0 : true);
        const isWideOk   = (p) => /^WIDE(\d+)/i.test(p.callsign || '') && (function(){ const m=(p.callsign||'').match(/^WIDE(\d+)/i); const tier = m? Number(m[1]||'0'):0; return tier>=2; })() && (typeof p.ssid === 'number' ? p.ssid > 0 : true);
        // find first matching by role
        let wideIdx = -1;
        for (let i = 0; i < pathAddrs.length; i++) {
          const p = pathAddrs[i];
          if (!p || !/^WIDE/i.test(p.callsign || '')) continue;
          // enforce maxWideN: if ssid (n) exceeds allowed, skip
          const n = (typeof p.ssid === 'number') ? p.ssid : null;
          if (n !== null && n > maxWideN) {
            // record that we skipped servicing this WIDE entry because it exceeded maxWideN for this target
            try { this.metrics.maxWideBlocked = (this.metrics.maxWideBlocked || 0) + 1; } catch (e) {}
            try { console.debug && console.debug(`[digipeat] skipping ${p.callsign} for target=${targetId} (ssid ${n} > maxWideN ${maxWideN})`); } catch (e) {}
            continue;
          }
          if (tgtRole === 'fill-in') { if (isFillInOk(p)) { wideIdx = i; break; } }
          else { if (isWideOk(p)) { wideIdx = i; break; } }
        }

        let toMark = null;
        if (callsignMatch !== -1) {
          toMark = pathAddrs[callsignMatch].callsign;
        } else if (wideIdx !== -1) {
          toMark = pathAddrs[wideIdx].callsign;
        }

        if (!toMark) {
          // nothing to service for this target
          try {
            const verbose = (target.options && target.options.verbose);
            // no-serviceable entry logging suppressed
          } catch (e) {}
          return;
        }
        
        // If the matched entry is a WIDE-style path and we've already serviced a WIDE
        // variation of this frame, skip servicing it again to avoid multi-hop duplication.
        try {
          const baseToMark = _callsignBase(toMark || '');
          if (/^WIDE/i.test(baseToMark)) {
            // If another target has already claimed this frame's WIDE servicing, skip.
            if (entry.servicedWide) {
              try { this.metrics.servicedWideBlocked = (this.metrics.servicedWideBlocked || 0) + 1; } catch (e) {}
              try { console.debug && console.debug(`[digipeat] skipping ${toMark} for target=${targetId} because WIDE already serviced`); } catch (e) {}
              return;
            }
            // Mark servicedWide immediately (defensive) so other parallel targets won't also service it
            entry.servicedWide = true;
          }
        } catch (e) {}

        // Special-case: a configured route target of 'igate' forwards to an external IGate
        if (String(targetId).toLowerCase() === 'igate') {
          try {
            const verbose = (manager && manager.channels && manager.channels.get && (this.channels.get(channelId) && this.channels.get(channelId).options && this.channels.get(channelId).options.verbose));
            // service the frame as usual (decrement WIDE or set H-bit)
            let servicedBuf = serviceAddressInBuffer(frame, toMark);
            // emit an igate event so external code can forward to the IGate network
            this.emit('igate', { from: channelId, raw: frame.toString('hex'), parsed: parsed, serviced: toMark, servicedBuf });
            // explicit IGate log for visibility
            // IGate forward logged at Igate client
          } catch (e) {}
          // mark seen for this pseudo-target so we don't loop
          entry.seen.add('igate');
          this.seen.set(key, entry);
          return;
        }

        try {
          const verbose = (target.options && target.options.verbose);
          // will-service logging suppressed
        } catch (e) {}
        
        // prepare frame to send: service (decrement WIDE or mark) the matched path entry
        let servicedBuf = serviceAddressInBuffer(frame, toMark);
        // If this target channel is configured to append its own callsign into the path, do so.
        // We insert the target's callsign into the path in place of the serviced entry when appendDigiCallsign is true.
        try {
          const targetOpts = target.options || {};
          // Unconditional debug logging for diagnosing append behavior
          try { /* target append flags logging suppressed */ } catch (e) {}
           // Respect append flag stored on channel object or in options
           // Respect both runtime flag and options which may use 'appendDigiCallsign' or 'appendCallsign'
           const shouldAppendDigiCallsign = !!(target.appendDigiCallsign || targetOpts.appendDigiCallsign || targetOpts.appendCallsign);
          try { /* shouldAppendDigiCallsign logging suppressed */ } catch (e) {}
           if (shouldAppendDigiCallsign) {
             // find offset of the serviced address in the servicedBuf by scanning address fields
             const sf = Buffer.from(servicedBuf);
             const { parseAddressField } = require('./ax25');
             let off = 0;
             let found = false;
            // Dump address fields for debugging
            try { /* address fields logging suppressed */ } catch (e) {}
             while (off + 7 <= sf.length) {
               const a = parseAddressField(sf, off);
               try { /* compare logging suppressed */ } catch (e) {}
               if (a && a.callsign && _callsignBase(a.callsign) === _callsignBase(toMark)) {
                 // replace this 7-byte block with the target's callsign formatted
                 const { formatCallsign } = require('./ax25');
                 const tgtCall = (targetOpts.callsign) ? String(targetOpts.callsign).toUpperCase() : target.name || target.id;
                try { /* matched address logging suppressed */ } catch (e) {}
                 const m = String(tgtCall).toUpperCase().match(/^([A-Z0-9]{1,6})(?:-(\d+))?$/);
                 const base = m ? m[1].slice(0,6) : String(tgtCall).slice(0,6);
                 const ssid = m && m[2] ? Number(m[2]) : 0;
                 const newAddr = formatCallsign(base, ssid);
                 // preserve EA bit from original
                 newAddr[6] = (sf[off + 6] & 0x01) ? (newAddr[6] | 0x01) : (newAddr[6] & ~0x01);
                 // set H-bit on the inserted address to indicate it was used
                 newAddr[6] = newAddr[6] | 0x80;
                 // write back
                 for (let i = 0; i < 7; i++) sf[off + i] = newAddr[i];
                 found = true;
                 try { /* appended digi callsign logging suppressed */ } catch (e) {}
                 break;
               }
               off += 7;
               if (a && a.last) break;
             }
             if (found) servicedBuf = sf;
           }
        } catch (e) {
          // if anything goes wrong with append, fall back to servicedBuf
        }

        try {
          // Use sendFrame() to handle proper KISS wrapping for all adapter types
          // sending serviced frame logging suppressed
          this.sendFrame(targetId, servicedBuf);
          this.emit('digipeat', { from: channelId, to: targetId, raw: frame.toString('hex'), serviced: toMark });
          try { this.metrics.digipeats = (this.metrics.digipeats || 0) + 1; } catch (e) {}
          try { /* digipeat forwarded logging suppressed */ } catch (e) {}
          // record that target has seen this frame to prevent immediate reprocessing
          entry.seen.add(targetId);
          // if we just sent back to the originating channel, ensure the source is marked
          if (targetId === channelId) entry.seen.add(channelId);
          // (servicedWide is already set earlier for WIDE entries)
          this.seen.set(key, entry);
          try { this.metrics.uniqueStations = this.seen.size; } catch (e) {}
          // optionally emit an immediate ID beacon for this target channel
          if (target.idOnRepeat) {
            try { this._sendIdBeaconForChannel(targetId); } catch (e) { /* ignore */ }
          }
        } catch (e) {
          this.emit('digipeat-error', { from: channelId, to: targetId, err: e });
        }
      });

      // Wait for all digipeating operations to complete in parallel
      await Promise.all(digipeatingPromises);
    }));
  }

  activateChannel(channel) {
    if (channel.mode === 'Packet' || channel.mode === 'Digipeat + Packet') {
      console.log(`Activating BBS for channel ${channel.id}`);
      channel.bbs = new BBS();
    }

    if (channel.mode === 'Digipeat' || channel.mode === 'Digipeat + Packet') {
      console.log(`Activating Digipeat for channel ${channel.id}`);
      // Existing digipeat activation logic
    }
  }

  sendAPRSMessage(options) {
    const { from, to, payload, channel, path } = options;
    
    if (!from || !to || !payload || !channel) {
      console.error('sendAPRSMessage: Missing required parameters');
      return false;
    }

    const ch = this.channels.get(channel);
    if (!ch || !ch.enabled || !ch.adapter) {
      console.error(`sendAPRSMessage: Channel ${channel} not available`);
      return false;
    }

    try {
    // Build AX.25 UI frame for APRS message
  const { formatCallsign } = require('./ax25');
      
      // Parse callsigns and SSIDs
      const parseCall = (call) => {
        const match = call.match(/^([A-Z0-9]{1,6})(?:-(\d+))?$/);
        return match ? { call: match[1], ssid: parseInt(match[2] || '0') } : { call: call.slice(0, 6), ssid: 0 };
      };

  const fromParsed = parseCall(from.toUpperCase());
  const toParsed = parseCall(to.toUpperCase());

  // Build addresses: dest should be 'APRS' for APRS UI frames; source is our BBS callsign
  // destination
  const destAddr = formatCallsign((toParsed && toParsed.call) ? toParsed.call : 'APRS', (toParsed && !isNaN(toParsed.ssid)) ? toParsed.ssid : 0);
      const srcAddr = formatCallsign(fromParsed.call, fromParsed.ssid);
      // If no path specified, mark source EA (no path); otherwise build header with path entries
      const pathParts = (path && typeof path === 'string') ? path.split(',').map(p => p.trim()).filter(Boolean) : [];
      let header;
      if (pathParts.length === 0) {
        srcAddr[6] = srcAddr[6] | 0x01; // Set EA bit on source (last address)
        header = Buffer.concat([destAddr, srcAddr]);
      } else {
        // Build full address list: dest, src, path...
        const addrs = [destAddr, srcAddr];
        const { formatCallsign: fmt } = require('./ax25');
        pathParts.forEach((p, idx) => {
          // Attempt to parse SSID if provided like WIDE1-1
          const m = p.match(/^([A-Z0-9-]{1,6})(?:-(\d+))?$/i);
          const base = m ? m[1] : p.slice(0,6);
          const ssid = m && m[2] ? Number(m[2]) : 0;
          const pb = fmt(base.toUpperCase().slice(0,6), ssid);
          // For path entries, mark as not last unless final
          if (idx === pathParts.length - 1) pb[6] = pb[6] | 0x01; // mark EA on last
          addrs.push(pb);
        });
        header = Buffer.concat(addrs);
      }
      const control = Buffer.from([0x03]); // UI frame
      const pid = Buffer.from([0xF0]); // No layer 3
      const payloadBuf = Buffer.from(payload);

      const frame = Buffer.concat([header, control, pid, payloadBuf]);

      // Send the frame
  const success = this.sendFrame(channel, frame);
      if (success) {
        console.log(`sendAPRSMessage: Sent message from ${from} to ${to} via ${channel}`);
      } else {
        console.error(`sendAPRSMessage: Failed to send message via ${channel}`);
      }

      return success;
    } catch (error) {
      console.error('sendAPRSMessage: Error building/sending frame:', error);
      return false;
    }
  }
}

module.exports = ChannelManager;
