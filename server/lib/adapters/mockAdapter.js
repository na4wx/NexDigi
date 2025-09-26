const EventEmitter = require('events');

class MockAdapter extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this._interval = setInterval(() => {
      const now = new Date().toISOString();
      const payload = Buffer.from(`MOCK:${id}:${now}`);
      // wrap in KISS-like FEND bytes 0xC0
      const framed = Buffer.concat([Buffer.from([0xC0]), payload, Buffer.from([0xC0])]);
      this.emit('data', framed);
    }, 8000 + Math.floor(Math.random() * 4000));
  }

  send(buf) {
    // in mock, echo back after tiny delay
    setTimeout(() => this.emit('data', buf), 100);
  }

  close() {
    if (this._interval) clearInterval(this._interval);
    this.removeAllListeners();
  }
}

module.exports = MockAdapter;
