#!/usr/bin/env node
const assert = require('assert');
const path = require('path');
const EventEmitter = require('events');

const ChannelManager = require(path.join(__dirname, '..', 'server', 'lib', 'channelManager.js'));
const { buildAx25Frame } = require(path.join(__dirname, '..', 'server', 'lib', 'ax25.js'));

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`❌ FAIL: ${name}`);
    console.error(`   ${err.message}`);
    testsFailed++;
  }
}

// A minimal fake adapter: no background timers, records what's sent.
class FakeAdapter extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.isSerial = false;
  }
  send(buf) { this.sent.push(buf); }
  close() { this.removeAllListeners(); }
}

// --- addChannel ---

test('addChannel registers a channel and returns it', () => {
  const cm = new ChannelManager();
  const adapter = new FakeAdapter();
  const ch = cm.addChannel({ id: 'radio1', name: 'Radio 1', adapter });
  assert.strictEqual(ch.id, 'radio1');
  assert.strictEqual(ch.enabled, true);
  assert.strictEqual(cm.channels.size, 1);
});

test('addChannel defaults mode to "digipeat"', () => {
  const cm = new ChannelManager();
  const ch = cm.addChannel({ id: 'radio1', name: 'r', adapter: new FakeAdapter() });
  assert.strictEqual(ch.mode, 'digipeat');
});

test('addChannel honors an explicit mode', () => {
  const cm = new ChannelManager();
  const ch = cm.addChannel({ id: 'radio1', name: 'r', adapter: new FakeAdapter(), mode: 'disabled' });
  assert.strictEqual(ch.mode, 'disabled');
});

test('addChannel supports adding multiple distinct channels', () => {
  const cm = new ChannelManager();
  cm.addChannel({ id: 'radio1', name: 'r1', adapter: new FakeAdapter() });
  cm.addChannel({ id: 'radio2', name: 'r2', adapter: new FakeAdapter() });
  assert.strictEqual(cm.channels.size, 2);
  assert.ok(cm.channels.has('radio1'));
  assert.ok(cm.channels.has('radio2'));
});

test('addChannel with duplicate id overwrites the previous entry', () => {
  const cm = new ChannelManager();
  cm.addChannel({ id: 'radio1', name: 'first', adapter: new FakeAdapter() });
  cm.addChannel({ id: 'radio1', name: 'second', adapter: new FakeAdapter() });
  assert.strictEqual(cm.channels.size, 1);
  assert.strictEqual(cm.channels.get('radio1').name, 'second');
});

test('addChannel forwards adapter "data" events into the manager', () => {
  const cm = new ChannelManager();
  const adapter = new FakeAdapter();
  cm.addChannel({ id: 'radio1', name: 'r', adapter });
  let statusEvents = 0;
  cm.on('channel-status', () => statusEvents++);
  adapter.emit('data', Buffer.from('C0C0', 'hex'));
  assert.ok(statusEvents >= 1);
  assert.ok(cm.channels.get('radio1').status.lastRx);
});

// --- removeChannel ---

test('removeChannel removes an existing channel and returns true', () => {
  const cm = new ChannelManager();
  cm.addChannel({ id: 'radio1', name: 'r', adapter: new FakeAdapter() });
  const removed = cm.removeChannel('radio1');
  assert.strictEqual(removed, true);
  assert.strictEqual(cm.channels.has('radio1'), false);
});

test('removeChannel returns false for an unknown channel', () => {
  const cm = new ChannelManager();
  assert.strictEqual(cm.removeChannel('nope'), false);
});

test('removeChannel closes the adapter', () => {
  const cm = new ChannelManager();
  const adapter = new FakeAdapter();
  let closed = false;
  adapter.close = () => { closed = true; };
  cm.addChannel({ id: 'radio1', name: 'r', adapter });
  cm.removeChannel('radio1');
  assert.strictEqual(closed, true);
});

test('removeChannel emits "channel-removed"', () => {
  const cm = new ChannelManager();
  cm.addChannel({ id: 'radio1', name: 'r', adapter: new FakeAdapter() });
  let emittedId = null;
  cm.on('channel-removed', (id) => { emittedId = id; });
  cm.removeChannel('radio1');
  assert.strictEqual(emittedId, 'radio1');
});

// --- listChannels ---

test('listChannels returns all channels with id/name/enabled/options/status', () => {
  const cm = new ChannelManager();
  cm.addChannel({ id: 'radio1', name: 'r1', adapter: new FakeAdapter() });
  const list = cm.listChannels();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, 'radio1');
  assert.ok('enabled' in list[0]);
  assert.ok('options' in list[0]);
  assert.ok('status' in list[0]);
});

test('listChannels returns an empty array when no channels exist', () => {
  const cm = new ChannelManager();
  assert.deepStrictEqual(cm.listChannels(), []);
});

// --- routes ---

test('addRoute + sendFrame cross-digipeats to a routed channel', () => {
  const cm = new ChannelManager();
  const a1 = new FakeAdapter();
  const a2 = new FakeAdapter();
  cm.addChannel({ id: 'radio1', name: 'r1', adapter: a1 });
  cm.addChannel({ id: 'radio2', name: 'r2', adapter: a2 });
  cm.addRoute('radio1', 'radio2');
  assert.ok(cm.routes.get('radio1').has('radio2'));
});

test('removeRoute removes a previously added route', () => {
  const cm = new ChannelManager();
  cm.addRoute('radio1', 'radio2');
  cm.removeRoute('radio1', 'radio2');
  assert.strictEqual(cm.routes.get('radio1').has('radio2'), false);
});

test('removeChannel drops routes that referenced it', () => {
  const cm = new ChannelManager();
  cm.addChannel({ id: 'radio1', name: 'r1', adapter: new FakeAdapter() });
  cm.addChannel({ id: 'radio2', name: 'r2', adapter: new FakeAdapter() });
  cm.addRoute('radio1', 'radio2');
  cm.removeChannel('radio2');
  assert.strictEqual(cm.routes.get('radio1').has('radio2'), false);
});

// --- sendFrame ---

test('sendFrame returns false for an unknown channel', () => {
  const cm = new ChannelManager();
  assert.strictEqual(cm.sendFrame('nope', Buffer.from('x')), false);
});

test('sendFrame returns false and does not transmit on a disabled channel', () => {
  const cm = new ChannelManager();
  const adapter = new FakeAdapter();
  cm.addChannel({ id: 'radio1', name: 'r', adapter, mode: 'disabled' });
  const frame = buildAx25Frame({ dest: 'APRS', src: 'N0CALL', payload: 'hi' });
  const ok = cm.sendFrame('radio1', frame);
  assert.strictEqual(ok, false);
  assert.strictEqual(adapter.sent.length, 0);
});

test('sendFrame transmits via the adapter and updates lastTx', () => {
  const cm = new ChannelManager();
  const adapter = new FakeAdapter();
  cm.addChannel({ id: 'radio1', name: 'r', adapter });
  const frame = buildAx25Frame({ dest: 'APRS', src: 'N0CALL', payload: 'hi' });
  const ok = cm.sendFrame('radio1', frame);
  assert.strictEqual(ok, true);
  assert.strictEqual(adapter.sent.length, 1);
  assert.ok(cm.channels.get('radio1').status.lastTx);
});

// --- metrics / seen cache tuning ---

test('setSeenTTL only accepts positive finite numbers', () => {
  const cm = new ChannelManager();
  const original = cm.SEEN_TTL;
  cm.setSeenTTL(-5);
  assert.strictEqual(cm.SEEN_TTL, original);
  cm.setSeenTTL(1234);
  assert.strictEqual(cm.SEEN_TTL, 1234);
});

test('getMetrics returns a copy, not the live object', () => {
  const cm = new ChannelManager();
  const m = cm.getMetrics();
  m.digipeats = 999;
  assert.notStrictEqual(cm.metrics.digipeats, 999);
});

console.log(`\nTests passed: ${testsPassed}`);
console.log(`Tests failed: ${testsFailed}`);
process.exit(testsFailed > 0 ? 1 : 0);
