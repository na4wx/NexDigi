const EventEmitter = require('events');
// optionally use our kiss helper to wrap frames when TNC expects KISS on serial
let kiss;
try { kiss = require('../kiss'); } catch (e) { try { kiss = require('../../lib/kiss'); } catch (e2) { kiss = null; } }
let SerialPortModule;
try { SerialPortModule = require('serialport'); } catch (e) { /* optional */ }

class SerialKissAdapter extends EventEmitter {
  constructor({ port, baud = 9600, verbose = false, parity = 'none', dataBits = 8, stopBits = 1, rtscts = false, xon = false, xoff = false }) {
    super();
    this.portPath = port;
    this.baud = baud;
    this._open = false;
    this._writeQueue = [];
    this._lastWrite = null; // { hex, ts, confirmed }
    this.verbose = !!verbose;
    // mark adapter type for ChannelManager routing decisions
    this.transport = 'serial';
    this.isSerial = true;
    // SerialPortModule may be undefined if serialport isn't installed
    if (!SerialPortModule) {
      process.nextTick(() => this.emit('error', new Error('serialport package not installed')));
      return;
    }
    this.opts = { baudRate: this.baud, parity, dataBits, stopBits, rtscts, xon, xoff };
    // Create the serial port. Support different serialport package shapes (exports a class directly, or has .SerialPort)
    let SerialPortClass = null;
    try {
      // Common shapes: module is a constructor function, or has .SerialPort, or has .default
      if (typeof SerialPortModule === 'function') SerialPortClass = SerialPortModule;
      else if (SerialPortModule && typeof SerialPortModule.SerialPort === 'function') SerialPortClass = SerialPortModule.SerialPort;
      else if (SerialPortModule && typeof SerialPortModule.default === 'function') SerialPortClass = SerialPortModule.default;
    } catch (e) {
      // defensive
      SerialPortClass = null;
    }
    if (!SerialPortClass) {
      // include available keys to help debugging
      const keys = SerialPortModule ? Object.keys(SerialPortModule) : [];
      process.nextTick(() => this.emit('error', new Error('serialport package installed but unrecognized export shape: ' + JSON.stringify(keys))));
      return;
    }
    if (!SerialPortClass) {
      process.nextTick(() => this.emit('error', new Error('serialport package not installed or unrecognized')));
      return;
    }

    try {
      // Preferred modern constructor: new SerialPort({ path, baudRate, autoOpen })
      try {
        if (this.verbose) console.log(`SerialKissAdapter: creating SerialPort using detected constructor for ${this.portPath}`);
        this.port = new SerialPortClass(Object.assign({ path: this.portPath, baudRate: this.baud, autoOpen: true }, this.opts));
        console.log(`SerialKissAdapter: constructor succeeded for ${this.portPath}`);
      } catch (e) {
        // Fallback to older constructor signature: new SerialPort(path, options)
        console.log(`SerialKissAdapter: modern constructor failed (${e.message}), trying legacy constructor for ${this.portPath}`);
        this.port = new SerialPortClass(this.portPath, Object.assign({ baudRate: this.baud, autoOpen: true }, this.opts));
        console.log(`SerialKissAdapter: legacy constructor succeeded for ${this.portPath}`);
      }
    } catch (err) {
      console.error(`SerialKissAdapter: constructor completely failed for ${this.portPath}:`, err.message);
      process.nextTick(() => this.emit('error', err));
      return;
    }

    // common event handlers
    try {
      this.port.on && this.port.on('open', () => this._onOpen());
      this.port.on && this.port.on('data', (d) => {
        try {
          if (this.verbose) {
            const hex = Buffer.from(d).toString('hex');
            const asciiPreview = Buffer.from(d).toString('utf8').replace(/[^\x20-\x7E]/g, '.');
            console.log(`SerialKissAdapter (${this.portPath}) rx ${d.length} bytes:`, hex, asciiPreview);
          }
        } catch (e) {}
        this.emit('data', d);
      });
      this.port.on && this.port.on('error', (e) => {
        console.error(`SerialKissAdapter (${this.portPath}) error:`, e.message);
        this.emit('error', e);
      });
      console.log(`SerialKissAdapter: event handlers attached for ${this.portPath}`);
    } catch (e) {
      console.error(`SerialKissAdapter: failed to attach event handlers for ${this.portPath}:`, e.message);
    }
  }

  send(buf) {
    if (!this.port) return this.emit('error', new Error('serial port not available'));
    if (!this._open) {
      // queue until open
      const hex = buf.slice(0,256).toString('hex');
      if (this.verbose) console.log(`SerialKissAdapter: queuing ${buf.length} bytes for ${this.portPath}:`, hex);
      this._writeQueue.push(buf);
      // record queued write
      this._lastWrite = { hex, ts: Date.now(), confirmed: false, queued: true };
      return;
    }
    if (this.verbose) console.log(`SerialKissAdapter send to ${this.portPath}:`, buf.slice(0,256).toString('hex'));
    try {
      const hex = buf.slice(0,256).toString('hex');
      this._lastWrite = { hex, ts: Date.now(), confirmed: false, queued: false };
      const writeCb = (err) => {
        if (err) {
          this.emit('error', err);
          return;
        }
        // If serialport provides drain, use it to ensure bytes are flushed to the driver
        const onDrained = () => {
          this._lastWrite.confirmed = true;
          if (this.verbose) console.log(`SerialKissAdapter: write+drain success for ${this.portPath}`);
        };
        try {
          if (typeof this.port.drain === 'function') {
            this.port.drain((dErr) => { if (dErr) this.emit('error', dErr); else onDrained(); });
          } else {
            // No drain available; mark as confirmed at write callback
            onDrained();
          }
        } catch (e) {
          // if drain throws, still mark as confirmed but emit error
          this._lastWrite.confirmed = true;
          this.emit('error', e);
        }
      };
      this.port.write(buf, writeCb);
    } catch (e) {
      this.emit('error', e);
    }
  }

  close() {
    try {
      if (this.port && this._open && typeof this.port.close === 'function') {
        this.port.close(() => {});
      }
    } catch (e) {}
    this._open = false;
    this._writeQueue = [];
    this.removeAllListeners();
  }

  _onOpen() {
    console.log(`SerialKissAdapter: port ${this.portPath} opened successfully`);
    this._open = true;
    this.emit('open');
    // flush queued writes
    if (this._writeQueue && this._writeQueue.length && this.port && typeof this.port.write === 'function') {
      if (this.verbose) console.log(`SerialKissAdapter: flushing ${this._writeQueue.length} queued write(s) to ${this.portPath}`);
      while (this._writeQueue.length) {
        const b = this._writeQueue.shift();
        const hex = b.slice(0,256).toString('hex');
        if (this.verbose) console.log(`SerialKissAdapter: flushing ${b.length} bytes to ${this.portPath}:`, hex);
        // record lastWrite for flushed buffer
        this._lastWrite = { hex, ts: Date.now(), confirmed: false, queued: true };
          try {
          const writeCb2 = (err) => {
            if (err) { this.emit('error', err); return; }
            try {
              if (typeof this.port.drain === 'function') {
                this.port.drain((dErr) => { if (dErr) this.emit('error', dErr); else { this._lastWrite.confirmed = true; if (this.verbose) console.log(`SerialKissAdapter: flushed write+drain success for ${this.portPath}`); } });
              } else {
                this._lastWrite.confirmed = true;
                if (this.verbose) console.log(`SerialKissAdapter: flushed write callback success for ${this.portPath}`);
              }
            } catch (e) { this.emit('error', e); }
          };
          this.port.write(b, writeCb2);
        } catch (e) { this.emit('error', e); }
      }
    }
  }

  getLastWrite() {
    return this._lastWrite;
  }
}

module.exports = SerialKissAdapter;
