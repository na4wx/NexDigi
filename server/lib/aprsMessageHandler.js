const { parseAx25Frame } = require('./ax25');

class APRSMessageHandler {
  constructor(bbs, channelManager, settings = {}) {
    this.bbs = bbs;
    this.channelManager = channelManager;
    this.settings = settings;
    this.pendingAcks = new Map(); // Track pending acknowledgments
    this.advisoryCooldown = new Map(); // Rate-limit connected-mode advisories per sender
    
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

    // Always allow BBS access on digipeater channels (prefer runtime channel.mode when present)
    const mode = (channel && channel.mode) || (channel.options && channel.options.mode) || 'digipeat';
    console.log(`APRSMessageHandler: Channel ${channelId} mode: ${mode}`);
    
    if (mode === 'digipeat' || mode === 'Digipeat' || mode === 'Digipeat + Packet') {
      console.log(`APRSMessageHandler: Channel ${channelId} is a digipeater channel, allowing BBS access`);
      return true;
    }

    // Check if BBS is explicitly enabled for this channel
    if (this.settings.channels && Array.isArray(this.settings.channels)) {
      const allowed = this.settings.channels.includes(channelId);
      console.log(`APRSMessageHandler: Channel ${channelId} explicitly ${allowed ? 'allowed' : 'not allowed'} in BBS settings`);
      return allowed;
    }

    // If no channel restrictions configured, allow all channels
    const noRestrictions = !this.settings.channels || this.settings.channels.length === 0;
    console.log(`APRSMessageHandler: No channel restrictions configured, ${noRestrictions ? 'allowing' : 'denying'} channel ${channelId}`);
    return noRestrictions;
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
    const match = infoField.match(/^:([A-Z0-9\-\s]{9}):(.+?)(?:\{([A-Za-z0-9]{1,5})\})?$/);
    if (!match) return;

    const [, addressee, content, msgId] = match;
    const recipient = addressee.trim();
    
    // Check if this message is for our BBS
    if (recipient.toUpperCase() !== this.settings.callsign.toUpperCase()) {
      return;
    }

    console.log(`BBS: Received APRS message from ${sender}: "${content}"`);

    // Send acknowledgment if message ID provided
    if (msgId) {
      this.sendAck(sender, msgId, channel);
    }

    // Process BBS commands or store as message
    this.processBBSCommand(sender, content, channel);
  }

  processBBSCommand(sender, content, channel) {
    const cmd = content.trim().toUpperCase();
    
    // Handle BBS commands
    if (cmd === 'L' || cmd === 'LIST') {
      this.sendMessageList(sender, channel);
    } else if (cmd.startsWith('R ') || cmd.startsWith('READ ')) {
      const msgNum = parseInt(cmd.split(' ')[1]);
      this.sendMessage(sender, msgNum, channel);
    } else if (cmd === 'B' || cmd === 'BYE') {
      this.sendAPRSMessage(sender, 'BBS: 73!', channel);
    } else if (cmd === 'H' || cmd === 'HELP') {
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

  sendHelp(sender, channel) {
    const help = 'BBS Commands: L=List, R n=Read msg n, H=Help, B=Bye. Send text to post bulletin.';
    this.sendAPRSMessage(sender, help, channel);
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
  }
}

module.exports = APRSMessageHandler;