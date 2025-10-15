const fs = require('fs');
const path = require('path');
const { writeJsonAtomicSync } = require('./fileHelpers');
const { parseAx25Frame, buildAx25Frame } = require('./ax25');

class BBSSessionManager {
  constructor(channelManager, callsign, storagePath, options = {}, bbs = null, messageAlertManager = null) {
    this.channelManager = channelManager;
    this.callsign = String(callsign || '').toUpperCase();
    this.storagePath = storagePath || path.join(__dirname, '../data/bbsUsers.json');
    this.allowedChannels = new Set(Array.isArray(options.allowedChannels) ? options.allowedChannels : []);
    this.sessions = new Map(); // key: channelId -> session state
    this.users = this.loadUsers();
    this.lastPromptSent = new Map(); // debounce repeated prompts: sessionKey -> timestamp
    this.frameDelayMs = options.frameDelayMs || 0; // configurable delay between frames
    this.bbs = bbs; // BBS instance
    this.messageAlertManager = messageAlertManager; // Message alert manager

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
    try { writeJsonAtomicSync(this.storagePath, this.users); } catch (e) { console.error('Failed to save bbsUsers:', e); }
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
  // Ensure payload is a Buffer for consistent on-air encoding
  const payloadBuf = (typeof text === 'string') ? Buffer.from(text, 'utf8') : (Buffer.isBuffer(text) ? text : Buffer.from(String(text)));
  const buf = buildAx25Frame({ dest: to, src: this.callsign, control: ctl, pid: 0xF0, payload: payloadBuf });
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
    this.sendI(remoteCall, channel, 'CMD (H = Help)\r\n');
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

    // Help/menu in connected mode: accept ?, H, h, or HELP
    if (/^(\?|H|HELP)$/i.test(text.trim())) {
      const header = 'BBS Menu:';
      const lines = [
        'L or LIST    - List recent bulletins',
        'P or PERSONAL- List personal messages for you',
        'R n          - Read message number n',
        'S CALL TEXT  - Send message to callsign',
        'M CALL       - Start composing message to callsign',
        'H or ?       - Help / this menu',
        'B or BYE     - Sign off (73)',
        'Text         - Send text to post as a bulletin'
      ];

      try {
        // Build a single payload containing the whole menu separated by CRLF
        const single = header + '\r\n' + lines.join('\r\n') + '\r\n';
        this.sendI(remoteCall, channel, single);
      } catch (e) {
        // Fallback: single-line prompt
        this.sendI(remoteCall, channel, 'CMD (H = Help)\r\n');
      }
      return;
    }

    // List command - show recent bulletins
    if (/^(L|LIST)$/i.test(text.trim())) {
      this.listMessages(remoteCall, channel);
      return;
    }

    // Personal command - show personal messages for this user
    if (/^(P|PERSONAL)$/i.test(text.trim())) {
      this.listPersonalMessages(remoteCall, channel);
      return;
    }

    // Read command - read specific message
    if (/^R\s+(\d+)$/i.test(text.trim())) {
      const msgNum = parseInt(text.trim().split(/\s+/)[1]);
      this.readMessage(remoteCall, channel, msgNum);
      return;
    }

    // Send command - send message to another station
    if (/^S\s+([A-Z0-9\-]+)\s+(.+)$/i.test(text.trim())) {
      const match = text.trim().match(/^S\s+([A-Z0-9\-]+)\s+(.+)$/i);
      const recipient = match[1].toUpperCase();
      const message = match[2];
      this.sendMessageToStation(remoteCall, channel, recipient, message);
      return;
    }

    // Message command - start composing message
    if (/^M\s+([A-Z0-9\-]+)$/i.test(text.trim())) {
      const match = text.trim().match(/^M\s+([A-Z0-9\-]+)$/i);
      const recipient = match[1].toUpperCase();
      this.sessions.set(key, { 
        state: 'composing', 
        remote: remoteCall, 
        channel, 
        recipient: recipient,
        message: '' 
      });
      this.sendI(remoteCall, channel, `Composing message to ${recipient}.\r\nEnter message (end with . on new line):\r\n`);
      return;
    }

    // Handle message composition
    if (sess.state === 'composing') {
      if (text.trim() === '.') {
        // End of message
        const msg = sess.message.trim();
        if (msg) {
          this.sendMessageToStation(remoteCall, channel, sess.recipient, msg, {
            subject: sess.subject || 'BBS Message',
            replyTo: sess.replyTo || null
          });
        } else {
          this.sendI(remoteCall, channel, 'Message cancelled (empty).\r\n');
        }
        this.sessions.set(key, { state: 'connected', remote: remoteCall, channel });
        this.sendI(remoteCall, channel, 'CMD (H = Help)\r\n');
        return;
      } else {
        // Add line to message
        sess.message += (sess.message ? '\r\n' : '') + text;
        this.sessions.set(key, sess);
        return; // Don't send prompt while composing
      }
    }

    // Handle post-read options (after reading a message)
    if (sess.state === 'post-read') {
      const input = text.trim().toUpperCase();
      
      if (input === 'Y' || input === 'REPLY') {
        // Start replying to the message
        const originalMessage = sess.lastReadMessage;
        const replySubject = originalMessage.subject && !originalMessage.subject.startsWith('Re: ') 
          ? `Re: ${originalMessage.subject}` 
          : (originalMessage.subject || 'Re: Your message');
        
        this.sessions.set(key, { 
          state: 'composing', 
          remote: remoteCall, 
          channel, 
          recipient: originalMessage.sender,
          message: '',
          replyTo: sess.lastReadMessageNumber,
          subject: replySubject
        });
        this.sendI(remoteCall, channel, `Replying to ${originalMessage.sender}.\r\nSubject: ${replySubject}\r\nEnter message (end with . on new line):\r\n`);
        return;
        
      } else if (input === 'D' || input === 'DELETE') {
        // Delete the message
        try {
          this.bbs.deleteMessage(sess.lastReadMessageNumber);
          this.sendI(remoteCall, channel, `Message ${sess.lastReadMessageNumber} deleted.\r\n`);
        } catch (e) {
          this.sendI(remoteCall, channel, 'Error deleting message.\r\n');
        }
        this.sessions.set(key, { state: 'connected', remote: remoteCall, channel });
        this.sendI(remoteCall, channel, 'CMD (H = Help)\r\n');
        return;
        
      } else {
        // Any other input (including empty) returns to main menu
        this.sessions.set(key, { state: 'connected', remote: remoteCall, channel });
        this.sendI(remoteCall, channel, 'CMD (H = Help)\r\n');
        return;
      }
    }

    // Echo line as placeholder (unknown command)
    this.sendI(remoteCall, channel, `CMD (H = Help)\r\n`);
  }

  /**
   * List recent bulletin messages
   */
  listMessages(remoteCall, channel) {
    try {
      if (!this.bbs) {
        this.sendI(remoteCall, channel, 'BBS not available.\r\nCMD (H = Help)\r\n');
        return;
      }

      const messages = this.bbs.getMessages({ category: 'B' }).slice(0, 10);
      
      if (messages.length === 0) {
        this.sendI(remoteCall, channel, 'No bulletin messages available.\r\n');
        return;
      }

      let response = 'Recent Bulletins:\r\n';
      messages.forEach(msg => {
        const date = new Date(msg.timestamp).toLocaleDateString();
        response += `${msg.messageNumber}: ${msg.sender} - ${msg.subject || 'No subject'} (${date})\r\n`;
      });
      response += '\r\nCMD (H = Help)\r\n';
      
      this.sendI(remoteCall, channel, response);
    } catch (e) {
      this.sendI(remoteCall, channel, 'Error listing messages.\r\nCMD (H = Help)\r\n');
    }
  }

  /**
   * List personal messages for the connected user
   */
  listPersonalMessages(remoteCall, channel) {
    try {
      if (!this.bbs) {
        this.sendI(remoteCall, channel, 'BBS not available.\r\nCMD (H = Help)\r\n');
        return;
      }

      // Get base callsign (without SSID) to find all messages to any SSID of this callsign
      const { _callsignBase } = require('./ax25');
      const baseCallsign = _callsignBase(String(remoteCall || '').toUpperCase());
      
      // Get all personal messages and filter for this base callsign
      const allPersonalMessages = this.bbs.getMessages({ category: 'P' });
      const messages = allPersonalMessages.filter(msg => {
        const recipientBase = _callsignBase(msg.recipient);
        return recipientBase === baseCallsign;
      });
      
      if (messages.length === 0) {
        this.sendI(remoteCall, channel, `No personal messages for ${baseCallsign}*.\r\n`);
        return;
      }

      let response = `Personal Messages for ${baseCallsign}* (all SSIDs):\r\n`;
      messages.forEach(msg => {
        const date = new Date(msg.timestamp).toLocaleDateString();
        const readStatus = msg.read ? 'READ' : 'NEW';
        response += `${msg.messageNumber}: To ${msg.recipient} From ${msg.sender} - ${msg.subject || 'No subject'} (${date}) [${readStatus}]\r\n`;
      });
      response += '\r\nUse "R n" to read message number n\r\n';
      response += 'CMD (H = Help)\r\n';
      
      this.sendI(remoteCall, channel, response);
    } catch (e) {
      this.sendI(remoteCall, channel, 'Error listing personal messages.\r\nCMD (H = Help)\r\n');
    }
  }

  /**
   * Read a specific message
   */
  readMessage(remoteCall, channel, messageNumber) {
    try {
      if (!this.bbs) {
        this.sendI(remoteCall, channel, 'BBS not available.\r\nCMD (H = Help)\r\n');
        return;
      }

      const messages = this.bbs.getMessages({ messageNumber });
      const message = messages.find(m => m.messageNumber === messageNumber);
      
      if (!message) {
        this.sendI(remoteCall, channel, `Message ${messageNumber} not found.\r\nCMD (H = Help)\r\n`);
        return;
      }

      // Mark as read
      this.bbs.markAsRead(messageNumber, remoteCall);

      const date = new Date(message.timestamp).toLocaleDateString();
      let response = `Message ${messageNumber}:\r\n`;
      response += `From: ${message.sender}\r\n`;
      response += `Date: ${date}\r\n`;
      response += `Subject: ${message.subject || 'No subject'}\r\n`;
      response += `\r\n${message.content}\r\n\r\n`;
      
      // Present post-read options
      response += 'Options:\r\n';
      response += 'Y - Reply to this message\r\n';
      response += 'D - Delete this message\r\n';
      response += 'Enter - Return to main menu\r\n';
      
      this.sendI(remoteCall, channel, response);
      
      // Set session state to handle post-read options
      const rc = this._parseCallString(remoteCall);
      const key = this._makeSessionKey(channel, rc);
      const sess = this.sessions.get(key) || { state: 'connected', remote: remoteCall, channel };
      this.sessions.set(key, { 
        ...sess, 
        state: 'post-read', 
        lastReadMessage: message,
        lastReadMessageNumber: messageNumber
      });
      
    } catch (e) {
      this.sendI(remoteCall, channel, 'Error reading message.\r\nCMD (H = Help)\r\n');
    }
  }

  /**
   * Send a message to another station
   */
  sendMessageToStation(sender, channel, recipient, messageText, options = {}) {
    try {
      if (!this.bbs) {
        this.sendI(sender, channel, 'BBS not available.\r\nCMD (H = Help)\r\n');
        return;
      }
      
      // Store the message
      const message = this.bbs.addMessage(sender, recipient, messageText, {
        category: 'P',
        subject: options.subject || 'BBS Message',
        priority: 'N',
        replyTo: options.replyTo || null
      });

      this.sendI(sender, channel, `Message sent to ${recipient} (stored as #${message.messageNumber}).\r\n`);
      
      // Try to alert the recipient via the message alert manager
      if (this.messageAlertManager) {
        try {
          this.messageAlertManager.alertNewMessage(recipient, sender, channel);
          this.sendI(sender, channel, `${recipient} has been alerted.\r\n`);
        } catch (e) {
          this.sendI(sender, channel, `Message stored. ${recipient} will see it when they check messages.\r\n`);
        }
      } else {
        this.sendI(sender, channel, `Message stored. ${recipient} will see it when they check messages.\r\n`);
      }
      
      this.sendI(sender, channel, '\r\n');
    } catch (e) {
      this.sendI(sender, channel, 'Error sending message.\r\nCMD (H = Help)\r\n');
    }
  }

  /**
   * Get message alert manager (if available)
   */
  getMessageAlertManager() {
    return this.messageAlertManager;
  }
}

module.exports = BBSSessionManager;
