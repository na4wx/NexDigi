const net = require('net');
const EventEmitter = require('events');
// No-op logger for IGate to silence logs (only keep the initial connected message)
const IGATE_LOG = () => {};

class IgateClient extends EventEmitter {
  constructor(opts = {}) {
    super();
    // Accept host strings that may include a scheme (http://) or trailing slashes
    // Normalize to a bare hostname so net.connect() won't try to resolve an invalid name
    const rawHost = opts.host || '';
    this.host = String(rawHost).trim().replace(/^https?:\/\//i, '').replace(/\/+$/g, '') || 'nohost';
    this.port = Number(opts.port || 14580);
    this.call = (opts.call || '').toUpperCase();
    this.pass = opts.pass || '';
    this.verbose = !!opts.verbose;
    this._socket = null;
    this._connected = false;
    this._authenticated = false;
    this._stopping = false;
    this._reconnectDelay = 3000;
    this._lastError = null;
    this._connectTime = null;
  }

  start() {
    this._stopping = false;
    this._connect();
  }

  stop() {
    this._stopping = true;
    this._authenticated = false;
    this._lastError = null;
    this._connectTime = null;
    try { if (this._socket) this._socket.end(); } catch (e) {}
    this._socket = null;
    this._connected = false;
  }

  _connect() {
    if (this._stopping) return;
    if (this._socket) return;
    if (this.verbose) console.log(`Igate: connecting to ${this.host}:${this.port}`);
    const s = new net.Socket();
    this._socket = s;
    s.setKeepAlive(true, 10000);
    s.on('connect', () => {
      this._connected = true;
      this._connectTime = new Date();
      this._lastError = null;
      console.log(`IgateClient: connected to ${this.host}:${this.port}`);
      // send login
      if (this.call) {
        const login = `user ${this.call} pass ${this.pass} vers NexDigi 0.1\r\n`;
        IGATE_LOG('IgateClient login:', login.trim());
        s.write(login);
      }
      this.emit('connected');
    });
    s.on('data', (d) => { 
      const response = d.toString('utf8');
      IGATE_LOG('IgateClient RX:', response.trim());

      // Check for authentication response
      if (response.includes('logresp') && response.includes('verified')) {
        this._authenticated = true;
      } else if (response.includes('logresp') && response.includes('unverified')) {
        this._authenticated = false;
      }
      
      if (this.verbose) IGATE_LOG('Igate RX (verbose):', response.trim()); 
    });
    s.on('error', (e) => {
      this._connected = false;
      this._authenticated = false;
      this._lastError = e && e.message ? e.message : 'Unknown error';
      IGATE_LOG('IgateClient error:', e && e.message);
      if (this.verbose) IGATE_LOG('Igate error (verbose)', e && e.message);
      this.emit('error', e);
    });
    s.on('close', (hadErr) => {
      this._connected = false;
      this._authenticated = false;
      this._socket = null;
      if (hadErr && !this._lastError) {
        this._lastError = 'Connection closed with error';
      }
      IGATE_LOG(`IgateClient: connection to ${this.host}:${this.port} closed${hadErr ? ' (had error)' : ''}`);
      this.emit('close', hadErr);
      if (!this._stopping) setTimeout(() => this._connect(), this._reconnectDelay);
    });
    s.connect(this.port, this.host);
  }

  sendParsed(parsed, rawHex, opts = {}) {
    if (!this._socket || !this._connected) return false;
    try {
      // Build a simple APRS-IS line: SRC>APRS,PATH:payload
      const addresses = parsed && parsed.addresses ? parsed.addresses : [];
      const src = (addresses[1] && addresses[1].callsign) ? (addresses[1].ssid ? `${addresses[1].callsign}-${addresses[1].ssid}` : addresses[1].callsign) : (opts.src || 'UNKNOWN');
      const dest = (addresses[0] && addresses[0].callsign) ? addresses[0].callsign : 'APRS';
      const path = (addresses.length > 2) ? addresses.slice(2).map(a => a.callsign + (typeof a.ssid === 'number' ? ('-' + a.ssid) : '')).join(',') : '';
      let payload = '';
      try {
        if (parsed && parsed.payload) {
          if (Buffer.isBuffer(parsed.payload)) {
            // Direct Buffer object from parseAx25Frame
            payload = parsed.payload.toString('utf8');
          } else if (parsed.payload.type === 'Buffer' && Array.isArray(parsed.payload.data)) {
            // JSON-serialized Buffer (e.g., from WebSocket transmission)
            payload = Buffer.from(parsed.payload.data).toString('utf8');
          } else if (typeof parsed.payload === 'string') {
            payload = parsed.payload;
          }
        }
      } catch (e) {}
      // sanitize newline characters
      payload = payload.replace(/\r|\n/g, ' ');
      const header = path ? `${src}>${dest},${path}` : `${src}>${dest}`;
      const line = `${header}:${payload}\r\n`;
      // APRS-IS expects the payload to begin with a data-type character, common ones include:
      // '!' '=', '@', '/', ':', '$', ';', '>', 'T', etc. If payload doesn't start with one of these,
      // some APRS-IS servers may drop or ignore the packet. Log a diagnostic warning.
      try {
        const firstChar = (payload && payload.length > 0) ? payload.charAt(0) : '';
        const okStarts = ['!', '=', '@', '/', ':', '$', ';', '>', 'T', ','];
        if (!firstChar || okStarts.indexOf(firstChar) === -1) {
          console.warn(`IgateClient: WARNING - payload from ${src} does not start with common APRS datatype char. firstChar='${firstChar}' (code=${firstChar ? firstChar.charCodeAt(0) : 'N/A'}) payload='${String(payload).slice(0,60)}'`);
        }
      } catch (e) {}
      IGATE_LOG('Igate ->', line.trim());
      IGATE_LOG(`IgateClient: sending ${line.length} bytes to APRS-IS`);
      IGATE_LOG(`IgateClient: raw bytes: ${Buffer.from(line, 'utf8').toString('hex')}`);
      if (this.verbose) IGATE_LOG('Igate -> (verbose)', line.trim());
      const result = this._socket.write(line, 'utf8');
      IGATE_LOG(`IgateClient: socket.write() returned: ${result}`);
      return true;
    } catch (e) {
      IGATE_LOG('IgateClient send failed:', e && e.message);
      if (this.verbose) IGATE_LOG('Igate send failed (verbose)', e && e.message);
      return false;
    }
  }

  getStatus() {
    return {
      connected: this._connected,
      authenticated: this._authenticated,
      host: this.host,
      port: this.port,
      callsign: this.call,
      lastError: this._lastError,
      connectTime: this._connectTime,
      uptime: this._connectTime ? Math.floor((Date.now() - this._connectTime.getTime()) / 1000) : 0
    };
  }
}

module.exports = IgateClient;
