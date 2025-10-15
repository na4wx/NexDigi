const https = require('https');
const { parseAx25Frame } = require('./ax25');

/**
 * Standalone Lookup Handler for digipeater
 * Handles lookup:CALL or lookup?CALL requests independently of BBS
 */
class LookupHandler {
  constructor(channelManager, settings = {}) {
    this.channelManager = channelManager;
    this.settings = {
      enabled: true,
      callsign: 'LOOKUP', // Default callsign to respond to
      endpointTemplate: 'https://callook.info/{CALL}/json',
      timeoutMs: 5000,
      cacheTtlMs: 10 * 60 * 1000, // 10 minutes
      ...settings
    };
    this.lookupCache = new Map();
    this.processedFrames = new Map(); // Deduplication cache
    
    // Listen for incoming frames
    this.channelManager.on('frame', this.handleIncomingFrame.bind(this));
  }

  updateSettings(settings) {
    Object.assign(this.settings, settings);
  }

  handleIncomingFrame(event) {
    console.log(`[LOOKUP] Frame received from ${event.channel}, enabled=${this.settings.enabled}, callsign=${this.settings.callsign}`);
    
    if (!this.settings.enabled) {
      console.log(`[LOOKUP] Handler disabled, skipping`);
      return;
    }

    // Deduplication: create a unique key from the frame content
    const frameKey = `${event.raw.substring(0, 50)}_${Date.now().toString().slice(-4)}`;
    if (this.processedFrames.has(frameKey)) {
      console.log(`[LOOKUP] Duplicate frame detected, skipping`);
      return;
    }
    this.processedFrames.set(frameKey, true);
    
    // Clean up old processed frames (keep only last 100)
    if (this.processedFrames.size > 100) {
      const keys = Array.from(this.processedFrames.keys());
      for (let i = 0; i < 50; i++) {
        this.processedFrames.delete(keys[i]);
      }
    }

    try {
      const parsed = event.parsed || parseAx25Frame(Buffer.from(event.raw, 'hex'));
      
      // Only process UI frames (0x03)
      if (!parsed || parsed.control !== 0x03) {
        console.log(`[LOOKUP] Not a UI frame (control=${parsed ? parsed.control : 'null'}), skipping`);
        return;
      }
      
      const payload = this.decodePayload(parsed.payload);
      if (!payload) {
        console.log(`[LOOKUP] No payload, skipping`);
        return;
      }

      console.log(`[LOOKUP] Payload: "${payload}"`);
      console.log(`[LOOKUP] Payload bytes:`, Buffer.from(payload).toString('hex'));

      // Check if this is an APRS message
      const infoField = payload.startsWith(':') ? payload : 
        (payload.startsWith('=') || payload.startsWith('@') || payload.startsWith('!') || payload.startsWith('/') ? 
          payload.substring(1) : payload);
      
      console.log(`[LOOKUP] InfoField: "${infoField}"`);
      
      // Match APRS message format - message ID is at the end before any newlines
      // Format: :CALLSIGN :content{msgid}\r\n
      const msgMatch = infoField.match(/^:([A-Z0-9\-\s]{9}):(.+?)(?:\{([A-Za-z0-9]{1,5})\})?([\r\n]*)$/);
      if (!msgMatch) {
        console.log(`[LOOKUP] Not an APRS message format, skipping`);
        console.log(`[LOOKUP] Regex test result:`, /^:([A-Z0-9\-\s]{9}):(.+?)(?:\{([A-Za-z0-9]{1,5})\})?([\r\n]*)$/.test(infoField));
        return;
      }

      let [, addressee, rawContent, rawMsgId] = msgMatch;
      
      // Split content from message ID if present
      let content = rawContent;
      let msgId = rawMsgId;
      
      if (content.includes('{')) {
        const parts = content.split('{');
        content = parts[0];
        if (parts[1] && !msgId) {
          msgId = parts[1].replace('}', '');
        }
      }
      
      const recipient = addressee.trim();
      
      console.log(`[LOOKUP] APRS message to ${recipient} (looking for ${this.settings.callsign})`);
      
      // Check if message is addressed to our lookup callsign
      if (recipient.toUpperCase() !== this.settings.callsign.toUpperCase()) {
        console.log(`[LOOKUP] Not for us (${recipient} != ${this.settings.callsign}), skipping`);
        return;
      }

      const sender = this.formatCallsign(parsed.addresses[1]);
      
      // Split content from message ID if present  
      if (content.includes('{')) {
        const parts = content.split('{');
        content = parts[0];
        if (parts[1] && !msgId) {
          msgId = parts[1].replace('}', '');
        }
      }
      
      console.log(`[LOOKUP] Received message from ${sender}: "${content}" (msgId: ${msgId})`);

      // Send ACK if message ID provided
      if (msgId) {
        this.sendAck(sender, msgId, event.channel);
      }

      // Check if this is a lookup request
      const lookupMatch = content.trim().match(/^lookup\s*(?:[:?])\s*([A-Z0-9\-]+)$/i);
      if (lookupMatch) {
        const queryCall = lookupMatch[1].toUpperCase();
        console.log(`[LOOKUP] Performing lookup for: ${queryCall}`);
        this.performLookup(sender, queryCall, event.channel);
      }
    } catch (error) {
      console.error('[LOOKUP] Error processing frame:', error);
    }
  }

  performLookup(recipient, call, channel) {
    console.log(`[LOOKUP] Looking up ${call} for ${recipient} via ${channel}`);
    
    // Check cache
    try {
      const cached = this.lookupCache.get(call);
      if (cached && (Date.now() - cached.ts) < this.settings.cacheTtlMs) {
        console.log(`[LOOKUP] Cache hit for ${call}: "${cached.text}"`);
        this.sendAPRSMessage(recipient, cached.text, channel);
        return;
      }
    } catch (e) {
      console.error(`[LOOKUP] Cache check error:`, e);
    }

    const url = this.settings.endpointTemplate.replace('{CALL}', encodeURIComponent(call));
    console.log(`[LOOKUP] Fetching ${url}`);

    const req = https.get(url, { timeout: this.settings.timeoutMs }, (res) => {
      console.log(`[LOOKUP] HTTP response: ${res.statusCode}`);
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          let text = '';

          if (json && (json.status === 'FOUND' || json.current)) {
            const cur = json.current || {};
            const fullName = (json.name || cur.name || '').trim();
            const firstName = fullName ? fullName.split(/\s+/)[0] : '';
            const cls = cur.class || '';
            const city = (cur.city || (cur.address && cur.address.city) || '').trim();
            const state = (cur.state || (cur.address && cur.address.state) || '').trim();
            const licenseStatus = (json.status || '').toString();

            const parts = [];
            parts.push(`${call}: ${licenseStatus ? licenseStatus.toUpperCase() : 'FOUND'}`);
            if (firstName) parts.push(`Name:${firstName}`);
            if (city || state) parts.push(`Loc:${city}${city && state ? ',' : ''}${state}`);
            if (cls) parts.push(`Class:${cls}`);

            text = parts.join(' ');
          } else {
            text = `${call}: NOT FOUND`;
          }

          // Truncate to APRS-friendly length
          if (text.length > 200) text = text.substring(0, 197) + '...';

          // Cache and send
          this.lookupCache.set(call, { ts: Date.now(), text });
          console.log(`[LOOKUP] Sending reply: "${text}"`);
          this.sendAPRSMessage(recipient, text, channel);
        } catch (err) {
          console.error(`[LOOKUP] Parse error:`, err);
          this.sendAPRSMessage(recipient, `${call}: lookup error`, channel);
        }
      });
    });

    req.on('error', (err) => {
      console.error(`[LOOKUP] HTTP error:`, err);
      this.sendAPRSMessage(recipient, `${call}: lookup error`, channel);
    });
    req.on('timeout', () => {
      console.error(`[LOOKUP] HTTP timeout`);
      req.destroy();
      this.sendAPRSMessage(recipient, `${call}: lookup timeout`, channel);
    });
  }

  sendAPRSMessage(recipient, content, channel, messageId = null) {
    if (!messageId) {
      messageId = Math.random().toString(36).substring(2, 7);
    }

    const paddedRecipient = recipient.padEnd(9, ' ');
    const payload = `:${paddedRecipient}:${content}{${messageId}}`;

    console.log(`[LOOKUP] Sending to ${recipient}: "${content}"`);

    this.channelManager.sendAPRSMessage({
      from: this.settings.callsign,
      to: recipient,
      payload: payload,
      channel: channel
    });
  }

  sendAck(recipient, messageId, channel) {
    const paddedRecipient = recipient.padEnd(9, ' ');
    const payload = `:${paddedRecipient}:ack${messageId}`;

    console.log(`[LOOKUP] Sending ACK to ${recipient} for message ${messageId}`);

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
      let result = '';
      if (typeof payload === 'string') result = payload;
      else if (Buffer.isBuffer(payload)) result = payload.toString('utf8');
      else if (payload && payload.type === 'Buffer' && Array.isArray(payload.data)) {
        result = Buffer.from(payload.data).toString('utf8');
      }
      else if (Array.isArray(payload)) result = Buffer.from(payload).toString('utf8');
      else result = String(payload);
      
      // Strip leading/trailing quotes that sometimes appear in decoded payloads
      result = result.replace(/^["']|["']$/g, '');
      
      return result;
    } catch (error) {
      console.error('[LOOKUP] Error decoding payload:', error);
      return '';
    }
  }
}

module.exports = LookupHandler;
