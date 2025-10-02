const fs = require('fs');
const path = require('path');
const { parseAx25Frame, buildAx25Frame } = require('./ax25');

class BBSSessionManager {
  constructor(channelManager, callsign, storagePath, options = {}) {
    this.channelManager = channelManager;
    this.callsign = String(callsign || '').toUpperCase();
    this.storagePath = storagePath || path.join(__dirname, '../data/bbsUsers.json');
    this.allowedChannels = new Set(Array.isArray(options.allowedChannels) ? options.allowedChannels : []);
    this.sessions = new Map(); // key: channelId -> session state
    this.users = this.loadUsers();
    this.lastPromptSent = new Map(); // debounce repeated prompts: sessionKey -> timestamp
    this.frameDelayMs = options.frameDelayMs || 0; // configurable delay between frames

    this.channelManager.on('frame', (event) => this.onFrame(event));
  }

  _parseCallString(callStr) {
    if (!callStr) return { callsign: '', ssid: 0 };
    const m = String(callStr || '').toUpperCase().match(/^([A-Z0-9]{1,6})(?:-(\d+))?$/);
    return m ? { callsign: m[1], ssid: Number(m[2] || '0') } : { callsign: String(callStr).slice(0,6).toUpperCase(), ssid: 0 };
  }

  _makeSessionKey(channel, addr) {
    // addr: { callsign, ssid }
    try {
      const { _callsignBase } = require('./ax25');
      const base = _callsignBase(String(addr.callsign || '').toUpperCase());
      // Use callsign base only for session identity to tolerate on-air variations
      return `${channel}:${base}`;
    } catch (e) {
      return `${channel}:${String(addr.callsign || '').toUpperCase()}`;
    }
  }

  loadUsers() {
    try {
      if (fs.existsSync(this.storagePath)) {
        return JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
      }
    } catch (e) {}
    return { users: {} };
  }

  saveUsers() {
    try { fs.writeFileSync(this.storagePath, JSON.stringify(this.users, null, 2)); } catch (e) { console.error('Failed to save bbsUsers:', e); }
  }

  getUser(call) {
    const c = String(call || '').toUpperCase();
    if (!this.users.users[c]) this.users.users[c] = { name: null, qth: null, lastSeen: null, connectCount: 0 };
    return this.users.users[c];
  }

  setUser(call, data) {
    const u = this.getUser(call);
    Object.assign(u, data || {});
    this.saveUsers();
  }

  onFrame(event) {
    // Channel allow-list: if configured, ignore frames not on allowed channels
    if (this.allowedChannels && this.allowedChannels.size > 0) {
      if (!this.allowedChannels.has(event.channel)) return;
    }
    let parsed;
    try { parsed = event.parsed || parseAx25Frame(Buffer.from(event.raw, 'hex')); } catch (e) { return; }
  const destAddr = parsed.addresses && parsed.addresses[0] ? parsed.addresses[0] : null;
  const srcAddr = parsed.addresses && parsed.addresses[1] ? parsed.addresses[1] : null;
  const dest = destAddr ? `${destAddr.callsign}${destAddr.ssid ? '-' + destAddr.ssid : ''}` : '';
  const src = srcAddr ? `${srcAddr.callsign}${srcAddr.ssid ? '-' + srcAddr.ssid : ''}` : '';
    if (!dest || !src) return;
    if (dest.toUpperCase() !== this.callsign) return; // not for BBS

    // Handle control types: we accept SABM (0x2F), UA(0x63), I-frames (bit0 even), DISC(0x43)
    const ctl = parsed.control & 0xFF;
    const chId = event.channel;
    const key = this._makeSessionKey(chId, srcAddr || { callsign: src, ssid: 0 });
    const sess = this.sessions.get(key) || { state: 'idle', remote: src, channel: chId, vS: 0, vR: 0 };
    try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] RX ctl=${ctl.toString(16)} from ${src} to ${dest} on ${chId}, session state: ${sess.state}`); } catch (e) {}

    // Treat SABM or SABME (and some TNC variants) as connect attempts.
    const isI = (ctl & 0x01) === 0x00;
    const isUI = ctl === 0x03;
    const looksLikeSABM = (ctl === 0x2F) || (ctl === 0x6F) || (ctl === 0x3F);

    if (looksLikeSABM) { // Only explicit SABM frames, not any unrecognized frame
      // Mirror P/F bit from incoming control
      const pf = (ctl & 0x10) ? 1 : 0;
      try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] Detected SABM-like frame: ctl=${ctl.toString(16)}, looksLikeSABM=${looksLikeSABM}, conditions: isI=${isI}, isUI=${isUI}, state=${sess.state}`); } catch (e) {}
      if (sess.state === 'connected' || sess.state === 'await-name' || sess.state === 'await-qth') {
        // Already connected or already awaiting input: acknowledge with UA but also check if user needs name/QTH
        try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] SABM while connected/awaiting from ${src}, sending UA and checking user info`); } catch (e) {}
        this.sendUA(src, chId, pf);
        // For existing connections, still check if user needs name/QTH setup
        this.onConnect(srcAddr, chId);
        return;
      }
      // Send UA and banner (first connect)
  this.sessions.set(key, { ...sess, state: 'connected', vS: 0, vR: 0 });
      try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] SABM from ${src}, sending UA and calling onConnect`); } catch (e) {}
      this.sendUA(src, chId, pf);
      this.onConnect(srcAddr, chId);
      return;
    }

    if (ctl === 0x43) { // DISC
      this.sendDM(src, chId);
      this.sessions.delete(key);
      return;
    }

    // I-frame (LSB 0)
    if ((ctl & 0x01) === 0x00) {
      const text = Buffer.from(parsed.payload || []).toString('utf8');
      try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] I-frame from ${src}:`, JSON.stringify(text)); } catch (e) {}
      // Update receive state: incoming Ns and Nr
      const incomingNs = (ctl >> 1) & 0x07;
      const incomingNr = (ctl >> 5) & 0x07;
      const sKey = this._makeSessionKey(chId, srcAddr || { callsign: src, ssid: 0 });
      const s = this.sessions.get(sKey) || { vS: 0, vR: 0, state: 'connected', remote: src, channel: chId };
      // Our next expected receive sequence is incomingNs + 1 (mod 8)
      s.vR = (incomingNs + 1) % 8;
      // store remote's Nr if provided
      s.remoteNr = incomingNr;
      this.sessions.set(sKey, s);

      // process input
      try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] About to call handleInput with session state: ${s.state}`); } catch (e) {}
      this.handleInput(src, chId, text.trim());

      // send an RR supervisory frame acknowledging receipt
      try {
        this.sendS(src, chId, 'RR', s.vR);
      } catch (e) {}

      return;
    }

    // Supervisory frame: RR/RNR/REJ/SREJ (control & 0x03) === 0x01
    if ((ctl & 0x03) === 0x01) {
      const type = (ctl >> 2) & 0x03; // 0=RR,1=RNR,2=REJ,3=SREJ
      const nr = (ctl >> 5) & 0x07;
      // Get existing session or create a connected one - don't default to idle
      const existing = this.sessions.get(key);
      const s2 = existing ? { ...existing } : { state: 'connected', remote: src, channel: chId, vS: 0, vR: 0 };
      s2.vR = nr;
      
      // Handle REJ: remote is rejecting frames and expects us to start from N(R)
      if (type === 2) { // REJ
        s2.vS = nr; // Set our send sequence to what remote expects
        try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] REJ N(R)=${nr} from ${src}, setting vS=${nr} (was ${existing ? existing.vS : 'undefined'})`); } catch (e) {}
      }
      
      this.sessions.set(key, s2);
      try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] S-frame ${['RR','RNR','REJ','SREJ'][type]} N(R)=${nr} from ${src}`); } catch (e) {}
      return;
    }
  }

  sendUA(to, channel, pf = 0) {
    // UA base 0x63; mirror P/F bit from request when provided
    const ctl = (0x63 | ((pf & 0x01) << 4)) & 0xFF;
    const buf = buildAx25Frame({ dest: to, src: this.callsign, control: ctl, pid: null, payload: '' });
    this.channelManager.sendFrame(channel, buf);
  }

  sendDM(to, channel, text = '') {
    const payload = text ? Buffer.from(text) : Buffer.alloc(0);
    const buf = buildAx25Frame({ dest: to, src: this.callsign, control: 0x0F, pid: null, payload });
    this.channelManager.sendFrame(channel, buf);
  }

  sendS(to, channel, type = 'RR', nr = 0) {
    // type: 'RR'|'RNR'|'REJ'|'SREJ' -> codes 0..3
    const tmap = { RR: 0, RNR: 1, REJ: 2, SREJ: 3 };
    const t = tmap[type] !== undefined ? tmap[type] : 0;
    // build supervisory control: bits 2-3 type, bits5-7 N(R)
    const ctl = ((nr & 0x07) << 5) | ((t & 0x03) << 2) | 0x01;
    const buf = buildAx25Frame({ dest: to, src: this.callsign, control: ctl & 0xFF, pid: null, payload: '' });
    this.channelManager.sendFrame(channel, buf);
  }

  sendI(to, channel, text) {
    // Get channel-specific delay configuration
    const getChannelDelay = () => {
      if (this.channelManager && this.channelManager.channels && this.channelManager.channels.has(channel)) {
        const channelInfo = this.channelManager.channels.get(channel);
        return channelInfo.options?.bbsDelayMs || 0;
      }
      return this.frameDelayMs || 0; // fallback to global setting
    };

    // Add configurable delay before sending frame if specified
    const sendFrame = () => {
      try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] Sending I-frame to ${to}: "${text.substring(0, 20)}${text.length > 20 ? '...' : ''}"`); } catch (e) {}
      // Minimal I-frame with basic modulo-8 sequencing
      const toAddr = this._parseCallString(to);
      const key = this._makeSessionKey(channel, toAddr);
      const s = this.sessions.get(key) || { vS: 0, vR: 0, state: 'connected', remote: `${toAddr.callsign}${toAddr.ssid ? '-' + toAddr.ssid : ''}`, channel };
      const ns = s.vS & 0x07;
      const nr = s.vR & 0x07;
      const pf = 0; // no poll/final
      const ctl = ((nr & 0x07) << 5) | ((pf & 0x01) << 4) | ((ns & 0x07) << 1) | 0x00;
      const buf = buildAx25Frame({ dest: to, src: this.callsign, control: ctl, pid: 0xF0, payload: text });
      this.channelManager.sendFrame(channel, buf);
      // advance Ns
      s.vS = (s.vS + 1) % 8;
      this.sessions.set(key, s);
    };

    const delayMs = getChannelDelay();
    if (delayMs > 0) {
      try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] Delaying I-frame by ${delayMs}ms (channel-specific)`); } catch (e) {}
      setTimeout(sendFrame, delayMs);
    } else {
      sendFrame();
    }
  }

  onConnect(remoteCallAddr, channel) {
    const remoteCall = `${remoteCallAddr.callsign}${remoteCallAddr.ssid ? '-' + remoteCallAddr.ssid : ''}`;
    const u = this.getUser(remoteCall);
    u.lastSeen = new Date().toISOString();
    u.connectCount = (u.connectCount || 0) + 1;
    this.saveUsers();

    try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] onConnect: user=${remoteCall}, name=${JSON.stringify(u.name)}, qth=${JSON.stringify(u.qth)}`); } catch (e) {}

    const banner = 'NA4WX-7 Packet BBS\r\n';
    // Ensure session state exists before sending any prompts to avoid race/repeat
    const sessionKey = this._makeSessionKey(channel, remoteCallAddr);
    const existing = this.sessions.get(sessionKey) || { state: 'connected', remote: remoteCall, channel };
    // persist connected state if not present
    if (!this.sessions.has(sessionKey)) {
      this.sessions.set(sessionKey, { ...existing, state: 'connected', vS: existing.vS || 0, vR: existing.vR || 0 });
    }

    if (!u.name) {
      try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] User ${remoteCall} needs name (current: ${JSON.stringify(u.name)})`); } catch (e) {}
      // mark awaiting before sending prompt to prevent duplicates
      const already = this.sessions.get(sessionKey) || {};
      if (already.state === 'await-name') return; // already awaiting input, don't resend prompt
      
      // debounce: don't resend prompt if sent recently
      const lastPrompt = this.lastPromptSent.get(sessionKey) || 0;
      const now = Date.now();
      if (now - lastPrompt < 2000) { // 2 second debounce
        try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] debounce: skipping name prompt for ${sessionKey}`); } catch (e) {}
        return;
      }
      
      this.sessions.set(sessionKey, { state: 'await-name', remote: remoteCall, channel });
      this.lastPromptSent.set(sessionKey, now);
      try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] set session ${sessionKey} -> await-name`); } catch (e) {}
      
      // Send banner and prompt together
      this.sendI(remoteCall, channel, banner + 'Enter your Name:\r\n');
      return;
    }
    if (!u.qth) {
      try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] User ${remoteCall} needs QTH (current: ${JSON.stringify(u.qth)})`); } catch (e) {}
      const already = this.sessions.get(sessionKey) || {};
      if (already.state === 'await-qth') return;
      
      // debounce: don't resend prompt if sent recently
      const lastPrompt = this.lastPromptSent.get(sessionKey) || 0;
      const now = Date.now();
      if (now - lastPrompt < 2000) { // 2 second debounce
        try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] debounce: skipping qth prompt for ${sessionKey}`); } catch (e) {}
        return;
      }
      
      this.sessions.set(sessionKey, { state: 'await-qth', remote: remoteCall, channel });
      this.lastPromptSent.set(sessionKey, now);
      try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] set session ${sessionKey} -> await-qth`); } catch (e) {}
      // Send banner and QTH prompt together
      this.sendI(remoteCall, channel, banner + 'Enter your QTH (City, ST):\r\n');
      return;
    }

    // Send banner and show status for existing users
    try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] User ${remoteCall} has both name and QTH, showing status`); } catch (e) {}
    this.sendI(remoteCall, channel, banner);
    this.showStatus(remoteCall, channel);
  }

  showStatus(remoteCall, channel) {
    // For MVP, count unread personal messages addressed to remoteCall
    try {
      const BBS = require('./bbs');
      const bbs = new BBS(path.join(__dirname, '../data/bbs.json'));
      const unread = bbs.getMessages({ recipient: remoteCall.toUpperCase(), unreadOnly: true }).length;
      this.sendI(remoteCall, channel, `You have ${unread} unread message(s).\r\n`);
    } catch (e) {
      this.sendI(remoteCall, channel, 'Welcome back.\r\n');
    }
    // Show the main BBS prompt
    this.sendI(remoteCall, channel, 'CMD? (type BYE to exit)\r\n');
  }

  handleInput(remoteCall, channel, text) {
    const rc = this._parseCallString(remoteCall);
    const key = this._makeSessionKey(channel, rc);
    const sess = this.sessions.get(key) || { state: 'connected', remote: remoteCall, channel };
    const u = this.getUser(remoteCall);

    try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] handleInput: call=${remoteCall}, text="${text}", session_state=${sess.state}`); } catch (e) {}

    // If session state is 'connected' but user has no name/QTH, they might be responding to a prompt from before server restart
    if (sess.state === 'connected' && (!u.name || !u.qth)) {
      if (!u.name) {
        try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] User ${remoteCall} in connected state but missing name, treating input as name`); } catch (e) {}
        this.setUser(remoteCall, { name: text });
        try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] After setUser, user data:`, JSON.stringify(this.getUser(remoteCall))); } catch (e) {}
        this.sendI(remoteCall, channel, `Thanks, ${text}.\r\n`);
        // clear prompt debounce when user responds
        this.lastPromptSent.delete(key);
        if (!u.qth) {
          this.sessions.set(key, { ...sess, state: 'await-qth', remote: remoteCall, channel });
          this.sendI(remoteCall, channel, 'Enter your QTH (City, ST): ');
        } else {
          this.sessions.set(key, { ...sess, state: 'connected', remote: remoteCall, channel });
          this.showStatus(remoteCall, channel);
        }
        return;
      } else if (!u.qth) {
        try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] User ${remoteCall} in connected state but missing QTH, treating input as QTH`); } catch (e) {}
        this.setUser(remoteCall, { qth: text });
        this.sendI(remoteCall, channel, `Thanks, ${text}.\r\n`);
        // clear prompt debounce when user responds  
        this.lastPromptSent.delete(key);
        this.sessions.set(key, { ...sess, state: 'connected', remote: remoteCall, channel });
        this.showStatus(remoteCall, channel);
        return;
      }
    }

    if (sess.state === 'await-name') {
      try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] Setting name for ${remoteCall} to "${text}"`); } catch (e) {}
      this.setUser(remoteCall, { name: text });
      try { if (process.env.NEXDIGI_DEBUG) console.log(`[BBS] After setUser, user data:`, JSON.stringify(this.getUser(remoteCall))); } catch (e) {}
      this.sendI(remoteCall, channel, `Thanks, ${text}.\r\n`);
      // clear prompt debounce when user responds
      this.lastPromptSent.delete(key);
      if (!u.qth) {
        this.sessions.set(key, { state: 'await-qth', remote: remoteCall, channel });
        this.sendI(remoteCall, channel, 'Enter your QTH (City, ST): ');
      } else {
        this.sessions.set(key, { state: 'connected', remote: remoteCall, channel });
        this.showStatus(remoteCall, channel);
      }
      return;
    }

    if (sess.state === 'await-qth') {
      this.setUser(remoteCall, { qth: text });
      this.sendI(remoteCall, channel, `QTH recorded: ${text}.\r\n`);
      // clear prompt debounce when user responds
      this.lastPromptSent.delete(key);
      this.sessions.set(key, { state: 'connected', remote: remoteCall, channel });
      this.showStatus(remoteCall, channel);
      return;
    }

    // Basic commands while connected (MVP): BYE to disconnect
    if (/^BYE$/i.test(text) || /^B$/i.test(text)) {
      this.sendDM(remoteCall, channel, '73');
      this.sessions.delete(key);
      return;
    }

    // Echo line as placeholder
    this.sendI(remoteCall, channel, `CMD? (type BYE to exit)\r\n`);
  }
}

module.exports = BBSSessionManager;
