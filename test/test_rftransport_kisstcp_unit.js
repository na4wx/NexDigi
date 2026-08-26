#!/usr/bin/env node
/**
 * Same coverage as test_rftransport_unit.js, but through the REAL
 * SoundModemAdapter (KISS-TCP) class and real net.Socket TCP connections
 * instead of an in-memory loopback adapter - this is the actual code path
 * a real deployment uses (each station's NexDigi connects to its own local
 * TNC/soundmodem via KISS-TCP). The in-memory loopback test proves the
 * AX.25/KISS protocol logic is correct; this one additionally proves the
 * real adapter's TCP connection handling, event wiring, and raw byte
 * pass-through are correct too.
 */
const assert = require('assert');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const ChannelManager = require(path.join(__dirname, '..', 'server', 'lib', 'channelManager.js'));
const SoundModemAdapter = require(path.join(__dirname, '..', 'server', 'lib', 'adapters', 'soundmodemAdapter.js'));
const RFTransport = require(path.join(__dirname, '..', 'server', 'lib', 'backbone', 'RFTransport.js'));
const { PacketFormat, PacketType } = require(path.join(__dirname, '..', 'server', 'lib', 'backbone', 'PacketFormat.js'));

// A minimal "virtual TNC bridge": a real TCP server that two real
// SoundModemAdapter (KISS-TCP) clients connect to independently, exactly
// like two stations each connecting to their own local TNC/soundmodem over
// a shared RF channel. Whatever bytes arrive from one connected client are
// relayed verbatim to the other - this is the actual net.Socket / KISS-TCP
// code path (SoundModemAdapter, real TCP sockets), not an in-memory bypass.
function startBridge(port) {
  return new Promise((resolve) => {
    const clients = [];
    const server = net.createServer((socket) => {
      clients.push(socket);
      socket.on('data', (data) => {
        for (const other of clients) {
          if (other !== socket && !other.destroyed) other.write(data);
        }
      });
      socket.on('error', () => {});
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const bridgePort = 19100 + Math.floor(Math.random() * 1000);
  const bridge = await startBridge(bridgePort);
  console.log(`Virtual TNC bridge listening on 127.0.0.1:${bridgePort}`);

  const cmA = new ChannelManager();
  const cmB = new ChannelManager();

  const adapterA = new SoundModemAdapter({ protocol: 'kiss-tcp', host: '127.0.0.1', port: bridgePort });
  const adapterB = new SoundModemAdapter({ protocol: 'kiss-tcp', host: '127.0.0.1', port: bridgePort });

  await Promise.all([
    new Promise((resolve, reject) => { adapterA.on('open', resolve); adapterA.on('error', reject); }),
    new Promise((resolve, reject) => { adapterB.on('open', resolve); adapterB.on('error', reject); })
  ]);
  console.log('Both SoundModemAdapter (KISS-TCP) clients connected to the bridge');

  cmA.addChannel({ id: 'rf1', name: 'rf1', adapter: adapterA });
  cmB.addChannel({ id: 'rf1', name: 'rf1', adapter: adapterB });

  const rfA = new RFTransport({ channelId: 'rf1', localCallsign: 'N0CALL-10' }, cmA);
  const rfB = new RFTransport({ channelId: 'rf1', localCallsign: 'W1ABC-10' }, cmB);

  let testsPassed = 0, testsFailed = 0;
  async function test(name, fn) {
    try { await fn(); console.log(`✅ PASS: ${name}`); testsPassed++; }
    catch (e) { console.error(`❌ FAIL: ${name}\n   ${e.message}`); testsFailed++; }
  }

  const aPackets = [], bPackets = [];
  rfA.on('packet', p => aPackets.push(p));
  rfB.on('packet', p => bPackets.push(p));
  let bConnEvent = null;
  rfB.on('connection', cs => { bConnEvent = cs; });

  await test('HELLO broadcast exchanged over real KISS-TCP sockets', async () => {
    await rfA.connect();
    await rfB.connect();
    await wait(150);
    const bHello = bPackets.find(p => p.type === PacketType.HELLO);
    const aHello = aPackets.find(p => p.type === PacketType.HELLO);
    assert.ok(bHello, 'Node B should receive HELLO from Node A over the KISS-TCP bridge');
    assert.ok(aHello, 'Node A should receive HELLO from Node B over the KISS-TCP bridge');
  });

  await test('SABM/UA handshake + I-frame delivery over real KISS-TCP sockets', async () => {
    const payload = Buffer.from('Hello via a real net.Socket KISS-TCP connection to a virtual TNC bridge!');
    const packet = PacketFormat.createData('N0CALL-10', 'W1ABC-10', payload, {});
    await rfA.send('W1ABC-10', packet, {});
    await wait(250);
    assert.strictEqual(bConnEvent, 'N0CALL-10', 'Node B should accept the SABM connection from Node A');
    const dataPacket = bPackets.find(p => p.type === PacketType.DATA);
    assert.ok(dataPacket, 'Node B should receive the DATA packet');
    assert.strictEqual(Buffer.compare(dataPacket.payload, payload), 0, 'payload must match exactly');
  });

  await test('a multi-fragment payload with random binary bytes survives real KISS-TCP encoding/decoding', async () => {
    const bigPayload = crypto.randomBytes(500);
    const bigPacket = PacketFormat.createData('N0CALL-10', 'W1ABC-10', bigPayload, {});
    await rfA.send('W1ABC-10', bigPacket, {});
    await wait(400);
    const received = bPackets.filter(p => p.type === PacketType.DATA).pop();
    assert.ok(received, 'should receive the reassembled packet');
    assert.strictEqual(Buffer.compare(received.payload, bigPayload), 0, 'reassembled bytes must match exactly over the real KISS-TCP socket path');
  });

  console.log(`\nTests passed: ${testsPassed}`);
  console.log(`Tests failed: ${testsFailed}`);

  await rfA.disconnect();
  await rfB.disconnect();
  adapterA.close();
  adapterB.close();
  bridge.close();
  process.exit(testsFailed > 0 ? 1 : 0);
}

main().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
