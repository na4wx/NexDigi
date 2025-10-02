const EventEmitter = require('events');
const net = require('net');

class SoundModemAdapter extends EventEmitter {
  // options: { protocol: 'agw'|'kiss-tcp', host, port }
  constructor(options = {}) {
    super();
    this.opts = options;
    this.socket = null;
    this._connected = false;
    this._retries = 0;
    this._maxRetries = 10;
    this._closing = false;
    this._reconnectTimer = null;
    // mark adapter transport type so ChannelManager can distinguish serial vs tcp
    this.transport = (options && options.protocol) ? options.protocol : 'kiss-tcp';

    if (options.protocol === 'agw') this._connectAGW();
    else if (options.protocol === 'kiss-tcp') this._connectKissTcp();
    else process.nextTick(() => this.emit('error', new Error('unknown protocol')));
  }

  _connectAGW() {
    // AGW protocol: simple TCP text commands then binary payloads; for now we'll connect and forward raw
    this.socket = net.createConnection({ host: this.opts.host || '127.0.0.1', port: this.opts.port || 8000 }, () => {
      this._connected = true;
      // AGW-style connections often expect a text handshake; emit 'open' to align with other adapters
      this.emit('open');
    });
    this.socket.on('data', (d) => this.emit('data', d));
    this.socket.on('error', (e) => { this.emit('error', e); if (!this._closing) this._scheduleReconnect(); });
    this.socket.on('close', () => { 
      this._connected = false; 
      this.emit('close'); 
      if (this._closing) return; 
      this._scheduleReconnect(); 
    });
  }

  _connectKissTcp() {
    const host = this.opts.host || '127.0.0.1';
    const port = this.opts.port || 8001;
    this.socket = net.createConnection({ host, port }, () => {
      this._connected = true;
      this._retries = 0;
      this.emit('open');
      console.log(`SoundModemAdapter connected to ${host}:${port}`);
    });
    this.socket.on('data', (d) => this.emit('data', d));
    this.socket.on('error', (e) => { this.emit('error', e); console.warn('SoundModemAdapter error', e.message); if (!this._closing) this._scheduleReconnect(); });
    this.socket.on('close', () => { 
      this._connected = false; 
      this.emit('close'); 
      console.log('SoundModemAdapter socket closed'); 
      if (this._closing) return; 
      this._scheduleReconnect(); 
    });
  }

  send(buf) {
    if (!this.socket || !this._connected) {
      // signal failure
      this.emit('error', new Error('socket-not-connected'));
      return;
    }
    try {
      if (this.opts && this.opts.verbose) console.log('SoundModemAdapter send:', buf.slice(0,64).toString('hex'));
      this.socket.write(buf);
    } catch (e) { this.emit('error', e); }
  }

  close() {
    this._closing = true;
    // cancel any pending reconnects
    try { if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; } } catch (e) {}
    // tear down socket aggressively
    if (this.socket) {
      try { this.socket.removeAllListeners(); } catch(e){}
      try { this.socket.end(); } catch(e){}
      try { this.socket.destroy(); } catch(e){}
    }
    this._connected = false;
    this.removeAllListeners();
  }

  _scheduleReconnect() {
    if (this._closing) return;
    if (this._retries >= this._maxRetries) return;
    this._retries++;
    const delay = Math.min(30000, 1000 * Math.pow(1.5, this._retries));
    if (this._reconnectTimer) return; // already scheduled
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (this.opts.protocol === 'agw') this._connectAGW(); else this._connectKissTcp();
    }, delay);
  }
}

module.exports = SoundModemAdapter;
