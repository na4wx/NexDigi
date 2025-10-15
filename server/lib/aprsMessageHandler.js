const { parseAx25Frame } = require('./ax25');
const https = require('https');

class APRSMessageHandler {
  constructor(bbs, channelManager, settings = {}, messageAlertManager = null) {
    this.bbs = bbs;
    this.channelManager = channelManager;
    this.settings = settings;
    this.messageAlertManager = messageAlertManager;
    this.pendingAcks = new Map(); // Track pending acknowledgments
    this.advisoryCooldown = new Map(); // Rate-limit connected-mode advisories per sender
    this.lookupCache = new Map(); // simple in-memory cache for lookups
    this.processedMessages = new Map(); // Track recently processed messages to prevent duplicates
    
    // Listen for incoming frames that might be APRS messages
    this.channelManager.on('frame', this.handleIncomingFrame.bind(this));
  }

  updateSettings(settings) {
    this.settings = settings;
  }

  isEnabled() {
    return this.settings.enabled && this.settings.callsign;
  }

  handleIncomingFrame(event) {
    console.log(`APRSMessageHandler: Processing frame from channel ${event.channel}`);
    
    if (!this.isEnabled()) {
      console.log('APRSMessageHandler: Handler not enabled, skipping');
      return;
    }

    // Check if BBS is allowed on this channel
    if (!this.isChannelAllowed(event.channel)) {
      console.log(`APRSMessageHandler: BBS not allowed on channel ${event.channel}, skipping`);
      return;
    }

    try {
      const parsed = event.parsed || parseAx25Frame(Buffer.from(event.raw, 'hex'));
      console.log(`APRSMessageHandler: Parsed frame from ${this.formatCallsign(parsed.addresses[1])} to ${this.formatCallsign(parsed.addresses[0])}`);
      try { console.log(`APRSMessageHandler: control=0x${Number(parsed.control).toString(16)} pid=0x${Number(parsed.pid).toString(16)}`); } catch (e) {}

      // If this is not a UI frame (0x03), it's likely a connected-mode attempt we don't service.
      if (parsed && parsed.control !== 0x03) {
        try {
          const dest = this.formatCallsign(parsed.addresses && parsed.addresses[0]);
          const sender = this.formatCallsign(parsed.addresses && parsed.addresses[1]);
          const our = (this.settings && this.settings.callsign) ? String(this.settings.callsign).toUpperCase() : '';
          // If a connected-mode attempt is aimed at us on an allowed channel, do NOT send APRS advisory — the BBS session will handle it.
          const allowed = this.isChannelAllowed(event.channel);
          if (dest && our && sender && dest.toUpperCase() === our && !allowed) {
            const last = this.advisoryCooldown.get(sender) || 0;
            const now = Date.now();
            if (now - last > 5 * 60 * 1000) { // 5 minutes
              this.advisoryCooldown.set(sender, now);
              const helpCall = String(this.settings.callsign || '').toUpperCase();
              this.sendAPRSMessage(sender, `BBS is APRS-message only. Send HELP to ${helpCall}.`, event.channel);
            }
          }
        } catch (_) {}
        console.log('APRSMessageHandler: Non-UI (connected-mode) frame; ignoring for BBS.');
        return;
      }
      
      // Check if this is an APRS message frame
      if (this.isAPRSMessage(parsed)) {
        console.log('APRSMessageHandler: Frame identified as APRS message, processing...');
        this.processAPRSMessage(parsed, event.channel);
      } else {
        console.log('APRSMessageHandler: Frame not identified as APRS message');
        const payload = this.decodePayload(parsed.payload);
        console.log(`APRSMessageHandler: Payload: "${payload}"`);
      }
    } catch (error) {
      console.error('APRSMessageHandler: Error processing frame:', error);
    }
  }

  isChannelAllowed(channelId) {
    // Get channel info from channel manager
    const channel = this.channelManager.channels.get(channelId);
    console.log(`APRSMessageHandler: Checking if channel ${channelId} is allowed for BBS`);
    
    if (!channel) {
      console.log(`APRSMessageHandler: Channel ${channelId} not found in manager`);
      return false;
    }

    // BBS channel access is independent of digipeater configuration
    // Only check if BBS is explicitly configured for this channel
    if (this.settings.channels && Array.isArray(this.settings.channels)) {
      const allowed = this.settings.channels.includes(channelId);
      console.log(`APRSMessageHandler: Channel ${channelId} explicitly ${allowed ? 'allowed' : 'not allowed'} in BBS settings`);
      return allowed;
    }

    // If no channel restrictions configured, BBS is disabled on all channels
    console.log(`APRSMessageHandler: No channels configured in BBS settings, denying access to ${channelId}`);
    return false;
  }

  isAPRSMessage(parsed) {
    // APRS messages have specific format indicators
    if (!parsed || !parsed.payload) {
      console.log('APRSMessageHandler: No payload in parsed frame');
      return false;
    }
    
    const payload = this.decodePayload(parsed.payload);
    if (!payload) {
      console.log('APRSMessageHandler: Could not decode payload');
      return false;
    }

    console.log(`APRSMessageHandler: Checking payload for APRS message format: "${payload}"`);

    // APRS messages start with ':' followed by addressee (9 chars padded with spaces) and ':'
    // Format: :ADDRESSEE:message content{MSGNO}
    // If payload does not start with ':', strip one leading APRS data type identifier when present
    const infoField = payload.startsWith(':') ? payload : (payload.startsWith('=') || payload.startsWith('@') || payload.startsWith('!') || payload.startsWith('/') ? 
      payload.substring(1) : payload);
    
    const isMessage = infoField.match(/^:[A-Z0-9\-\s]{9}:/);
    console.log(`APRSMessageHandler: Info field: "${infoField}", is APRS message: ${!!isMessage}`);
    
    return !!isMessage;
  }

  processAPRSMessage(parsed, channel) {
    const payload = this.decodePayload(parsed.payload);
    const sender = this.formatCallsign(parsed.addresses[1]);
    
    // Handle APRS data type identifiers - messages can start with various identifiers
    const infoField = payload.startsWith('=') || payload.startsWith('@') || payload.startsWith('!') || payload.startsWith('/') ? 
      payload.substring(1) : payload;
    
    // Parse APRS message format: :ADDRESSEE:message content{MSGNO}
    // Handle optional trailing CR/LF characters
    const cleanInfoField = infoField.replace(/[\r\n]+$/, '');
    const match = cleanInfoField.match(/^:([A-Z0-9\-\s]{9}):(.+?)(?:\{([A-Za-z0-9]{1,5})\})?$/);
    if (!match) {
      console.log(`APRSMessageHandler: No regex match for infoField: "${infoField}" (cleaned: "${cleanInfoField}")`);
      return;
    }

    const [, addressee, rawContent, rawMsgId] = match;
    
    let content = rawContent;
    let msgId = rawMsgId;
    
    // If message ID wasn't captured by regex, try to extract it manually
    if (!msgId && content.includes('{')) {
      const msgIdMatch = content.match(/^(.+?)\{([A-Za-z0-9]{1,5})\}?$/);
      if (msgIdMatch) {
        content = msgIdMatch[1];
        msgId = msgIdMatch[2];
      }
    }
    
    const recipient = addressee.trim();
    
    // Check if this message is for our BBS system
    if (recipient.toUpperCase() === this.settings.callsign.toUpperCase()) {
      console.log(`BBS: Received APRS message from ${sender}: "${content}"`);

      // Check for duplicate message processing (same sender + message ID within 30 seconds)
      if (msgId) {
        const messageKey = `${sender.toUpperCase()}-${msgId}`;
        const now = Date.now();
        const lastProcessed = this.processedMessages.get(messageKey);
        
        if (lastProcessed && (now - lastProcessed) < 30000) { // 30 second window
          console.log(`BBS: Ignoring duplicate message ${messageKey} from ${sender}`);
          return; // Skip duplicate processing
        }
        
        // Record this message as processed
        this.processedMessages.set(messageKey, now);
        
        // Send acknowledgment
        this.sendAck(sender, msgId, channel);
      }

      // Process BBS commands or store as message
      this.processBBSCommand(sender, content, channel);
      return;
    }
    
    // Check if this is a store-and-forward message for another user
    if (this.messageAlertManager) {
      console.log(`BBS: Store-and-forward message from ${sender} to ${recipient}: "${content}"`);
      
      // Send acknowledgment if message ID provided
      if (msgId) {
        this.sendAck(sender, msgId, channel);
      }
      
      // Store the message for the recipient
      this.bbs.addMessage(sender, recipient, content, {
        category: 'P',
        subject: 'APRS Message',
        priority: 'N'
      });
      
      // Send immediate alert to recipient
      this.messageAlertManager.alertNewMessage(recipient, sender, channel);
      
      // Confirm to sender that message was stored
      this.sendAPRSMessage(sender, `Message for ${recipient} stored and ${recipient} alerted.`, channel);
    }
  }

  performLookup(recipient, call, channel) {
    console.log(`[LOOKUP DEBUG] performLookup called: recipient=${recipient}, call=${call}, channel=${channel}`);
    
    // Default settings
    const endpointTemplate = (this.settings && this.settings.lookupEndpoint) || 'https://callook.info/{CALL}/json';
    const timeoutMs = (this.settings && typeof this.settings.lookupTimeoutMs === 'number') ? this.settings.lookupTimeoutMs : 5000;
    const cacheTtl = (this.settings && typeof this.settings.lookupCacheTtlMs === 'number') ? this.settings.lookupCacheTtlMs : (10 * 60 * 1000);

    console.log(`[LOOKUP DEBUG] Settings: endpoint=${endpointTemplate}, timeout=${timeoutMs}ms, cacheTtl=${cacheTtl}ms`);

    // Check cache
    try {
      const cached = this.lookupCache.get(call);
      if (cached && (Date.now() - cached.ts) < cacheTtl) {
        console.log(`[LOOKUP DEBUG] Cache hit for ${call}, replying to ${recipient} via ${channel}: "${cached.text}"`);
        this.sendAPRSMessage(recipient, cached.text, channel);
        return;
      } else {
        console.log(`[LOOKUP DEBUG] Cache miss for ${call} (cached=${!!cached}, valid=${cached ? (Date.now() - cached.ts < cacheTtl) : 'n/a'})`);
      }
    } catch (e) {
      console.error(`[LOOKUP DEBUG] Cache check error:`, e);
    }

    const url = endpointTemplate.replace('{CALL}', encodeURIComponent(call));
    console.log(`[LOOKUP DEBUG] Fetching URL: ${url}`);

    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      console.log(`[LOOKUP DEBUG] HTTP response received: statusCode=${res.statusCode}`);
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`[LOOKUP DEBUG] HTTP response complete, data length=${data.length}`);
        try {
          const json = JSON.parse(data);
          console.log(`[LOOKUP DEBUG] Parsed JSON:`, JSON.stringify(json).substring(0, 500));
          let text = '';

          // callook.info format: { status: 'FOUND'|'NOT_FOUND', current: {callsign, grantDate, expirationDate, class, name}, name }
          if (json && (json.status === 'FOUND' || json.current)) {
            const cur = json.current || {};
            // Try multiple possible name fields
            const fullName = (json.name || cur.name || cur.trusteeName || cur.licensee || '').trim();
            const firstName = fullName ? fullName.split(/\s+/)[0] : '';
            const cls = cur.class || cur.licenseClass || '';
            const grant = cur.grantDate || cur.grant || '';
            const exp = cur.expirationDate || cur.expiration || '';

            // Try to extract city/state from several potential fields
            const city = (cur.city || cur.location || (cur.mailing && cur.mailing.city) || json.city || '').trim();
            const state = (cur.state || (cur.mailing && cur.mailing.state) || json.state || '').trim();

            const licenseStatus = (json.status || (cur.status) || '').toString();

            console.log(`[LOOKUP DEBUG] Extracted fields: name=${firstName}, city=${city}, state=${state}, class=${cls}, status=${licenseStatus}`);

            const parts = [];
            parts.push(`${call}: ${licenseStatus ? licenseStatus.toUpperCase() : 'FOUND'}`);
            if (firstName) parts.push(`Name:${firstName}`);
            if (city || state) parts.push(`Loc:${city}${city && state ? ',' : ''}${state}`);
            if (cls) parts.push(`Class:${cls}`);
            if (grant) parts.push(`Grant:${grant}`);
            if (exp) parts.push(`Exp:${exp}`);

            text = parts.join(' ');
            console.log(`[LOOKUP DEBUG] Composed reply text: "${text}"`);
          } else {
            text = `${call}: NOT FOUND`;
            console.log(`[LOOKUP DEBUG] Callsign not found, reply: "${text}"`);
          }

          // Truncate to a reasonable APRS-friendly length
          if (text.length > 200) text = text.substring(0, 197) + '...';

          // Cache and send
          try { this.lookupCache.set(call, { ts: Date.now(), text }); } catch (e) {}
          console.log(`performLookup: sending lookup reply for ${call} to ${recipient} via ${channel}: "${text}"`);
          this.sendAPRSMessage(recipient, text, channel);
        } catch (err) {
          console.log(`performLookup: error parsing response for ${call}:`, err && err.message);
          console.error(`[LOOKUP DEBUG] Full error:`, err);
          this.sendAPRSMessage(recipient, `${call}: lookup error`, channel);
        }
      });
    });

    req.on('error', (err) => {
      console.error(`[LOOKUP DEBUG] HTTP request error:`, err);
      this.sendAPRSMessage(recipient, `${call}: lookup error`, channel);
    });
    req.on('timeout', () => {
      console.error(`[LOOKUP DEBUG] HTTP request timeout`);
      req.destroy();
      this.sendAPRSMessage(recipient, `${call}: lookup timeout`, channel);
    });
  }

  processBBSCommand(sender, content, channel) {
    const cmd = content.trim().toUpperCase();
    
    // Handle BBS commands
    if (cmd === 'L' || cmd === 'LIST') {
      this.sendMessageList(sender, channel);
    } else if (cmd.startsWith('R ') || cmd.startsWith('READ ')) {
      const msgNum = parseInt(cmd.split(' ')[1]);
      this.sendMessage(sender, msgNum, channel);
    } else if (cmd === 'RM' || cmd === 'RM.' || cmd === 'RETRIEVE' || cmd === 'RETRIEVE MESSAGES') {
      this.retrievePersonalMessages(sender, channel);
    } else if (cmd === 'B' || cmd === 'BYE') {
      this.sendAPRSMessage(sender, 'BBS: 73!', channel);
    } else if (cmd === '?' || cmd === 'H' || cmd === 'HELP') {
      // Treat '?' (single-question) as a request for help/menu as well
      this.sendHelp(sender, channel);
    } else {
      // Store as bulletin message if it doesn't match commands
      this.bbs.addMessage(sender, 'ALL', content, {
        category: 'B',
        subject: 'APRS Message',
        priority: 'N'
      });
      this.sendAPRSMessage(sender, 'BBS: Message stored. Send L for list.', channel);
    }
  }

  sendMessageList(sender, channel) {
    const bulletins = this.bbs.getMessages({ category: 'B' }).slice(0, 10);
    
    if (bulletins.length === 0) {
      this.sendAPRSMessage(sender, 'BBS: No messages available.', channel);
      return;
    }

    // Send summary of messages
    let response = 'BBS Messages: ';
    bulletins.forEach((msg, idx) => {
      response += `${msg.messageNumber}:${msg.sender} `;
      if (idx < bulletins.length - 1 && response.length < 50) {
        response += '| ';
      }
    });
    
    this.sendAPRSMessage(sender, response, channel);
  }

  sendMessage(sender, messageNumber, channel) {
    const message = this.bbs.getMessages({ messageNumber }).find(m => m.messageNumber === messageNumber);
    
    if (!message) {
      this.sendAPRSMessage(sender, `BBS: Message ${messageNumber} not found.`, channel);
      return;
    }

    // Mark as read
    this.bbs.markAsRead(messageNumber, sender);

    // Send message content (truncated for APRS)
    const content = message.content.substring(0, 100);
    const truncated = message.content.length > 100 ? '...' : '';
    this.sendAPRSMessage(sender, `BBS Msg${messageNumber}: ${content}${truncated}`, channel);
  }

  retrievePersonalMessages(sender, channel) {
    const messages = this.bbs.getPersonalMessages(sender);
    const unreadMessages = messages.filter(msg => !msg.read);
    
    if (unreadMessages.length === 0) {
      this.sendAPRSMessage(sender, 'BBS: No unread messages.', channel);
      return;
    }

    // Send each unread message
    unreadMessages.forEach((msg, index) => {
      setTimeout(() => {
        const content = msg.content.substring(0, 80);
        const truncated = msg.content.length > 80 ? '...' : '';
        const messageText = `From ${msg.sender}: ${content}${truncated}`;
        
        this.sendAPRSMessage(sender, messageText, channel);
        
        // Mark as read
        this.bbs.markAsRead(msg.messageNumber, sender);
      }, index * 2000); // 2 second delay between messages
    });

    // Clear alert tracking since messages were retrieved
    if (this.messageAlertManager) {
      this.messageAlertManager.markMessagesRetrieved(sender);
    }
  }

  sendHelp(sender, channel) {
    // Send a short menu of available BBS commands in a single transmission.
    const header = 'BBS Menu:';
    const lines = [
      'L or LIST    - List recent bulletins',
      'R n          - Read message number n',
      'H or ?       - Help / this menu',
      'B or BYE     - Sign off (73)',
      'Text         - Send text to post as a bulletin'
    ];
    // Prefer a single transmission with LF-only line endings (some terminals
    // like EasyTerm handle LF better than CRLF). However allow channels to
    // opt-out and request staggered per-line APRS messages by setting
    // channel.options.bbsMenuSingleTransmission = false or providing
    // channel.options.bbsMenuDelayMs.
    const channelInfo = (this.channelManager && this.channelManager.channels) ? this.channelManager.channels.get(channel) : null;

    // Compute a menu delay if provided (channel override -> channel bbsDelay -> global frameDelay -> default 60ms)
    let menuDelayMs = 60;
    try {
      if (channelInfo && channelInfo.options) {
        if (typeof channelInfo.options.bbsMenuDelayMs === 'number') menuDelayMs = channelInfo.options.bbsMenuDelayMs;
        else if (typeof channelInfo.options.bbsDelayMs === 'number') menuDelayMs = channelInfo.options.bbsDelayMs;
      }
    } catch (e) {}
    if ((!menuDelayMs || menuDelayMs === 0) && this.settings && typeof this.settings.frameDelayMs === 'number') {
      menuDelayMs = this.settings.frameDelayMs;
    }

    const channelRequestsStagger = channelInfo && channelInfo.options && (
      channelInfo.options.bbsMenuSingleTransmission === false ||
      (typeof channelInfo.options.bbsMenuDelayMs === 'number')
    );

    if (channelRequestsStagger) {
      // Staggered sends: header first, then subsequent lines using computed delay.
      try {
        this.sendAPRSMessage(sender, header, channel);
        lines.forEach((line, idx) => {
          setTimeout(() => {
            try { this.sendAPRSMessage(sender, line, channel); } catch (e) {}
          }, menuDelayMs * (idx + 1));
        });
      } catch (e) {
        const help = 'BBS Commands: L=List, R n=Read msg n, H=?=Help, B=Bye. Send text to post bulletin.';
        this.sendAPRSMessage(sender, help, channel);
      }
      return;
    }

    // Default: send as a single APRS message using LF-only separators.
    try {
      const single = header + '\n' + lines.join('\n');
      this.sendAPRSMessage(sender, single, channel);
    } catch (e) {
      // Fallback to a compact single-line help if send fails
      const help = 'BBS Commands: L=List, R n=Read msg n, H=?=Help, B=Bye. Send text to post bulletin.';
      this.sendAPRSMessage(sender, help, channel);
    }
  }

  sendAPRSMessage(recipient, content, channel, messageId = null) {
    if (!this.isEnabled()) return;

    // Generate message ID if not provided
    if (!messageId) {
      messageId = Math.random().toString(36).substring(2, 7);
    }

    // Format APRS message: :RECIPIENT :content{msgId}
    const paddedRecipient = recipient.padEnd(9, ' ');
    const payload = `:${paddedRecipient}:${content}{${messageId}}`;

    console.log(`BBS: Sending APRS message to ${recipient}: "${content}"`);

    // Send via channel manager
    this.channelManager.sendAPRSMessage({
      from: this.settings.callsign,
      to: recipient,
      payload: payload,
      channel: channel
    });

    // Track for acknowledgment
    this.pendingAcks.set(messageId, {
      recipient,
      content,
      channel,
      timestamp: Date.now(),
      retries: 0
    });
  }

  sendAck(recipient, messageId, channel) {
    if (!this.isEnabled()) return;

    const paddedRecipient = recipient.padEnd(9, ' ');
    const payload = `:${paddedRecipient}:ack${messageId}`;

    console.log(`BBS: Sending ACK to ${recipient} for message ${messageId}`);

    this.channelManager.sendAPRSMessage({
      from: this.settings.callsign,
      to: recipient,
      payload: payload,
      channel: channel
    });
  }

  formatCallsign(address) {
    if (!address) return '';
    const call = address.callsign || '';
    const ssid = address.ssid || 0;
    return ssid > 0 ? `${call}-${ssid}` : call;
  }

  decodePayload(payload) {
    if (!payload) return '';

    try {
      // If it's already a string, return as-is
      if (typeof payload === 'string') return payload;

      // Node Buffer
      if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(payload)) {
        return payload.toString('utf8');
      }

      // Handle Buffer-like plain objects { type: 'Buffer', data: [...] }
      if (payload && payload.type === 'Buffer' && Array.isArray(payload.data)) {
        return Buffer.from(payload.data).toString('utf8');
      }

      // Handle arrays of bytes
      if (Array.isArray(payload)) {
        return Buffer.from(payload).toString('utf8');
      }

      // Fallback: stringify
      return String(payload);
    } catch (error) {
      console.error('Error decoding payload:', error);
      return '';
    }
  }

  cleanup() {
    // Clean up old pending acknowledgments (older than 5 minutes)
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    
    for (const [msgId, ack] of this.pendingAcks.entries()) {
      if (ack.timestamp < fiveMinutesAgo) {
        this.pendingAcks.delete(msgId);
      }
    }
    
    // Clean up old processed message records (older than 1 minute)
    const oneMinuteAgo = Date.now() - (60 * 1000);
    
    for (const [messageKey, timestamp] of this.processedMessages.entries()) {
      if (timestamp < oneMinuteAgo) {
        this.processedMessages.delete(messageKey);
      }
    }
  }
}

module.exports = APRSMessageHandler;