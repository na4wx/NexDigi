#!/usr/bin/env node
/**
 * RFTransport integration test using a simulated RF link (loopback
 * adapter) between two real ChannelManager + RFTransport instances -
 * two ChannelManagers whose adapters forward "transmitted" bytes
 * straight to each other, the way two radios on the same frequency
 * would. This exercises the full real pipeline (AX.25 framing, KISS
 * escaping over ChannelManager, connected-mode SABM/UA/I-frame/RR) end
 * to end without needing physical RF hardware - unlike a mocked
 * backboneManager, nothing here is faked below the two RFTransport
 * instances themselves.
 */
const assert = require('assert');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const ChannelManager = require(path.join(__dirname, '..', 'server', 'lib', 'channelManager.js'));
const RFTransport = require(path.join(__dirname, '..', 'server', 'lib', 'backbone', 'RFTransport.js'));
const { PacketFormat, PacketType } = require(path.join(__dirname, '..', 'server', 'lib', 'backbone', 'PacketFormat.js'));

let testsPassed = 0;
let testsFailed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ PASS: ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`❌ FAIL: ${name}`);
    console.error(`   ${err.message}`);
    testsFailed++;
  }
}

// Simulates a real RF link: whatever one adapter "transmits" is
// "received" by its peer adapter, and vice versa.
class LoopbackAdapter extends EventEmitter {
  constructor() { super(); this.peer = null; this.isSerial = false; }
  send(buf) { setTimeout(() => { if (this.peer) this.peer.emit('data', buf); }, 2); }
  close() { this.removeAllListeners(); }
}

function makeLinkedNodes(callsignA, callsignB) {
  const adapterA = new LoopbackAdapter();
  const adapterB = new LoopbackAdapter();
  adapterA.peer = adapterB;
  adapterB.peer = adapterA;

  const cmA = new ChannelManager();
  const cmB = new ChannelManager();
  cmA.addChannel({ id: 'rf1', name: 'rf1', adapter: adapterA });
  cmB.addChannel({ id: 'rf1', name: 'rf1', adapter: adapterB });

  const rfA = new RFTransport({ channelId: 'rf1', localCallsign: callsignA }, cmA);
  const rfB = new RFTransport({ channelId: 'rf1', localCallsign: callsignB }, cmB);
  return { rfA, rfB };
}

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {

  await test('HELLO broadcast is exchanged both ways on connect()', async () => {
    const { rfA, rfB } = makeLinkedNodes('N0CALL-10', 'W1ABC-10');
    const aPackets = [], bPackets = [];
    rfA.on('packet', p => aPackets.push(p));
    rfB.on('packet', p => bPackets.push(p));

    await rfA.connect();
    await rfB.connect();
    await wait(100);

    const bHello = bPackets.find(p => p.type === PacketType.HELLO);
    const aHello = aPackets.find(p => p.type === PacketType.HELLO);
    assert.ok(bHello, 'Node B should receive HELLO from Node A');
    assert.ok(aHello, 'Node A should receive HELLO from Node B');
    assert.strictEqual(bHello.source, 'N0CALL-10');

    await rfA.disconnect();
    await rfB.disconnect();
  });

  await test('connected-mode send does a real SABM/UA handshake then delivers via I-frame', async () => {
    const { rfA, rfB } = makeLinkedNodes('N0CALL-10', 'W1ABC-10');
    let bConnEvent = null;
    rfB.on('connection', cs => { bConnEvent = cs; });
    const bPackets = [];
    rfB.on('packet', p => bPackets.push(p));

    await rfA.connect();
    await rfB.connect();
    await wait(50);

    const payload = Buffer.from('Hello over a simulated AX.25 connected-mode session!');
    const packet = PacketFormat.createData('N0CALL-10', 'W1ABC-10', payload, {});
    await rfA.send('W1ABC-10', packet, {});
    await wait(200);

    assert.strictEqual(bConnEvent, 'N0CALL-10', 'Node B should accept a SABM connection from Node A');
    const dataPacket = bPackets.find(p => p.type === PacketType.DATA);
    assert.ok(dataPacket, 'Node B should receive the DATA packet via I-frame(s)');
    assert.strictEqual(Buffer.compare(dataPacket.payload, payload), 0, 'payload must survive the round trip exactly');

    await rfA.disconnect();
    await rfB.disconnect();
  });

  await test('a payload spanning multiple I-frame fragments reassembles byte-for-byte', async () => {
    const { rfA, rfB } = makeLinkedNodes('N0CALL-10', 'W1ABC-10');
    const bPackets = [];
    rfB.on('packet', p => bPackets.push(p));

    await rfA.connect();
    await rfB.connect();
    await wait(50);

    // RF_MTU is 200 bytes; this forces 3+ I-frame fragments and, being
    // random binary data, reliably contains KISS-special bytes (0xC0/0xDB)
    // - this is what catches KISS escaping bugs that ASCII text would miss.
    const bigPayload = crypto.randomBytes(500);
    const bigPacket = PacketFormat.createData('N0CALL-10', 'W1ABC-10', bigPayload, {});
    await rfA.send('W1ABC-10', bigPacket, {});
    await wait(300);

    const received = bPackets.find(p => p.type === PacketType.DATA);
    assert.ok(received, 'should have received the reassembled packet');
    assert.strictEqual(received.payload.length, bigPayload.length, 'reassembled length must match');
    assert.strictEqual(Buffer.compare(received.payload, bigPayload), 0, 'reassembled bytes must match exactly, including any 0xC0/0xDB bytes');

    await rfA.disconnect();
    await rfB.disconnect();
  });

  await test('DISC tears down the session on both ends; a later send reconnects cleanly', async () => {
    const { rfA, rfB } = makeLinkedNodes('N0CALL-10', 'W1ABC-10');
    let bDisconnected = null;
    rfB.on('disconnect', cs => { bDisconnected = cs; });
    const bPackets = [];
    rfB.on('packet', p => bPackets.push(p));

    await rfA.connect();
    await rfB.connect();
    await wait(50);

    // Establish a session, then explicitly tear it down from A's side by
    // simulating a disconnect() call (which sends DISC to all sessions).
    const packet1 = PacketFormat.createData('N0CALL-10', 'W1ABC-10', Buffer.from('first'), {});
    await rfA.send('W1ABC-10', packet1, {});
    await wait(150);
    assert.ok(rfA.sessions.has('W1ABC-10'), 'session should exist after first send');

    // Send DISC manually (rather than full disconnect()) to test just the
    // session teardown path while keeping both transports usable.
    const { buildAx25Frame } = require(path.join(__dirname, '..', 'server', 'lib', 'ax25.js'));
    const discFrame = buildAx25Frame({ dest: 'W1ABC-10', src: 'N0CALL-10', control: 0x43, pid: null, payload: Buffer.alloc(0) });
    rfA.channelManager.sendFrame('rf1', discFrame);
    rfA.sessions.delete('W1ABC-10');
    await wait(100);

    assert.strictEqual(bDisconnected, 'N0CALL-10', 'Node B should process the DISC and emit disconnect');
    assert.ok(!rfB.sessions.has('N0CALL-10'), 'Node B should have cleared the session');

    // A fresh send should re-establish via a brand new SABM/UA handshake.
    const packet2 = PacketFormat.createData('N0CALL-10', 'W1ABC-10', Buffer.from('second, after reconnect'), {});
    await rfA.send('W1ABC-10', packet2, {});
    await wait(200);

    const secondReceived = bPackets.filter(p => p.type === PacketType.DATA).pop();
    assert.strictEqual(secondReceived.payload.toString(), 'second, after reconnect');

    await rfA.disconnect();
    await rfB.disconnect();
  });

  console.log(`\nTests passed: ${testsPassed}`);
  console.log(`Tests failed: ${testsFailed}`);
  process.exit(testsFailed > 0 ? 1 : 0);

})();
