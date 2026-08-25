#!/usr/bin/env node
const assert = require('assert');
const path = require('path');
const crypto = require('crypto');

const FragmentationManager = require(path.join(__dirname, '..', 'server', 'lib', 'backbone', 'FragmentationManager.js'));
const { PacketFormat, PacketType, PacketFlags, Priority } = require(path.join(__dirname, '..', 'server', 'lib', 'backbone', 'PacketFormat.js'));
const RoutingEngine = require(path.join(__dirname, '..', 'server', 'lib', 'backbone', 'RoutingEngine.js'));
const LoadBalancer = require(path.join(__dirname, '..', 'server', 'lib', 'backbone', 'LoadBalancer.js'));
const APRSDistributor = require(path.join(__dirname, '..', 'server', 'lib', 'backbone', 'APRSDistributor.js'));
const WinlinkForwarder = require(path.join(__dirname, '..', 'server', 'lib', 'backbone', 'WinlinkForwarder.js'));

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

async function asyncTest(name, fn) {
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

// --- PacketFormat: DATA carries a caller-supplied messageId ---

test('createData forwards options.messageId instead of always generating a random one', () => {
  const mid = crypto.randomBytes(16).toString('hex');
  const packet = PacketFormat.createData('N0CALL', 'W1ABC', Buffer.from('hi'), { messageId: mid });
  const decoded = PacketFormat.decode(packet);
  assert.strictEqual(decoded.messageId, mid);
});

test('createData still auto-generates a messageId when none is supplied', () => {
  const packet = PacketFormat.createData('N0CALL', 'W1ABC', Buffer.from('hi'), {});
  const decoded = PacketFormat.decode(packet);
  assert.strictEqual(decoded.messageId.length, 32); // 16 bytes as hex
});

// --- Fragmentation: full wire round-trip, as BackboneManager wires it ---

test('fragment -> encode as flagged DATA packets -> decode -> reassemble round-trips exactly', () => {
  const fm = new FragmentationManager({ mtu: 200 });
  const original = crypto.randomBytes(1000);
  const fragMessageId = crypto.randomBytes(8).toString('hex');
  const fragments = fm.fragment(fragMessageId, original);
  assert.ok(fragments.length > 1, 'a 1000-byte payload with mtu 200 must actually fragment');

  const receiverFM = new FragmentationManager({ mtu: 200 });
  let reassembled = null;

  for (const fragment of fragments) {
    const fragPayload = Buffer.concat([FragmentationManager.encodeFragmentHeader(fragment), fragment.payload]);
    const packet = PacketFormat.encode({
      type: PacketType.DATA,
      source: 'N0CALL-10',
      destination: 'W1ABC-10',
      payload: fragPayload,
      priority: Priority.NORMAL,
      flags: PacketFlags.FRAGMENTED,
      routingInfo: {}
    });
    const decoded = PacketFormat.decode(packet);
    assert.ok(decoded.flags & PacketFlags.FRAGMENTED, 'FRAGMENTED flag must survive encode/decode');

    const header = FragmentationManager.decodeFragmentHeader(decoded.payload.slice(0, 32));
    const fp = decoded.payload.slice(32, 32 + header.payloadLength);
    const result = receiverFM.processFragment({
      messageId: header.messageId,
      fragmentNum: header.fragmentNum,
      totalFragments: header.totalFragments,
      payload: fp
    });
    if (result) reassembled = result;
  }

  assert.ok(reassembled, 'should be reassembled after the last fragment');
  assert.strictEqual(Buffer.compare(reassembled, original), 0);
});

test('a payload under the MTU does not need fragmentation', () => {
  const fm = new FragmentationManager({ mtu: 200 });
  assert.strictEqual(fm.needsFragmentation(Buffer.alloc(50)), false);
  assert.strictEqual(fm.needsFragmentation(Buffer.alloc(500)), true);
});

// --- RoutingEngine: policy-based selection ---

test('selectRoute rejects a route exceeding the maxHops policy', () => {
  const re = new RoutingEngine({ localCallsign: 'N0CALL' });
  re.routingTable.set('FAR-1', { destination: 'FAR-1', nextHop: 'X', cost: 10, path: ['N0CALL', 'X', 'FAR-1'], transport: 'rf', hopCount: 2 });

  assert.ok(re.selectRoute('FAR-1'), 'no policy should return the route');
  assert.strictEqual(re.selectRoute('FAR-1', { maxHops: 1 }), null, 'should reject a route past maxHops');
  assert.ok(re.selectRoute('FAR-1', { maxHops: 5 }), 'should allow a route within maxHops');
});

test('selectRoute reports transport preference as metadata, not a hard filter', () => {
  const re = new RoutingEngine({ localCallsign: 'N0CALL' });
  re.routingTable.set('FAR-1', { destination: 'FAR-1', nextHop: 'X', cost: 10, path: ['N0CALL', 'X', 'FAR-1'], transport: 'rf', hopCount: 2 });

  const route = re.selectRoute('FAR-1', { preferredTransport: 'internet' });
  assert.ok(route, 'should still return the only available route');
  assert.strictEqual(route.matchesPreference, false);
});

// --- LoadBalancer: round-robin across dual-homed transports ---

test('round-robin LoadBalancer alternates between two candidate routes', () => {
  const lb = new LoadBalancer({ localCallsign: 'N0CALL', algorithm: 'round-robin' });
  const candidates = [
    { destination: 'W1ABC', nextHop: 'rf' },
    { destination: 'W1ABC', nextHop: 'internet' }
  ];
  const picks = [lb.selectRoute('W1ABC', candidates), lb.selectRoute('W1ABC', candidates), lb.selectRoute('W1ABC', candidates)];
  const transports = picks.map(p => p.nextHop);
  assert.deepStrictEqual(transports, ['rf', 'internet', 'rf']);
});

test('LoadBalancer tracks per-route health independently by destination+nextHop', () => {
  const lb = new LoadBalancer({ localCallsign: 'N0CALL' });
  lb.recordSuccess({ destination: 'W1ABC', nextHop: 'rf' }, 100);
  lb.recordFailure({ destination: 'W1ABC', nextHop: 'internet' }, 'timeout');

  const rfHealth = lb.getRouteHealth({ destination: 'W1ABC', nextHop: 'rf' });
  const inetHealth = lb.getRouteHealth({ destination: 'W1ABC', nextHop: 'internet' });
  assert.strictEqual(rfHealth.successCount, 1);
  assert.strictEqual(inetHealth.failureCount, 1);
});

// --- Async tests run inside an IIFE (this file is plain CommonJS, not ESM,
// so top-level await isn't available) ---
(async () => {

// --- APRSDistributor: floods locally-heard packets to neighbors ---

await asyncTest('distributePacket floods a locally-heard packet to backbone neighbors', async () => {
  const sent = [];
  const fakeBackbone = {
    neighborTable: { getAll: () => new Map([['W1ABC-10', { callsign: 'W1ABC-10' }]]) },
    sendData: async (dest, data) => { sent.push({ dest, data }); return 'id'; },
    on: () => {}
  };
  const dist = new APRSDistributor({ backboneManager: fakeBackbone, localCallsign: 'N0CALL-10' });

  const distributed = await dist.distributePacket({ source: 'N0CALL-9', destination: 'APRS', content: '!3550.00N/08000.00W>Test' }, null);

  assert.strictEqual(distributed, true);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].dest, 'W1ABC-10');
  assert.strictEqual(sent[0].data.type, 'aprs_packet');
});

await asyncTest('handleBackbonePacket reads the "data" field (not "payload") from backbone data events', async () => {
  const fakeBackbone = { neighborTable: { getAll: () => new Map() }, sendData: async () => 'id', on: () => {} };
  const dist = new APRSDistributor({ backboneManager: fakeBackbone, localCallsign: 'N0CALL-10' });

  const aprsMessage = {
    type: 'aprs_packet',
    packet: { source: 'W2DEF', destination: 'APRS', payload: '!hello', hops: 0, timestamp: Date.now() }
  };
  let distributedCalled = false;
  dist.distributePacket = async () => { distributedCalled = true; return true; };

  await dist.handleBackbonePacket({ source: 'W1ABC-10', data: Buffer.from(JSON.stringify(aprsMessage)) });
  assert.strictEqual(distributedCalled, true);
});

// --- WinlinkForwarder: CMS gateway lookup via backbone service registry ---

await asyncTest('_determineRoute picks the lowest-cost known winlink-cms provider', async () => {
  const fakeBackbone = {
    services: new Map([['winlink-cms', new Set(['HUB-1', 'HUB-2'])]]),
    routingEngine: { getRoute: (dest) => (dest === 'HUB-2' ? { cost: 1 } : { cost: 5 }) }
  };
  const wf = new WinlinkForwarder({ backboneManager: fakeBackbone, localCallsign: 'N0CALL', cmsGateway: false });

  const route = await wf._determineRoute({ to: 'SOMEUSER', type: 'to-cms' });
  assert.deepStrictEqual(route, { type: 'remote-cms', destination: 'HUB-2' });
});

await asyncTest('_determineRoute returns null when no CMS gateway is known', async () => {
  const fakeBackbone = { services: new Map(), routingEngine: null };
  const wf = new WinlinkForwarder({ backboneManager: fakeBackbone, localCallsign: 'N0CALL', cmsGateway: false });

  const route = await wf._determineRoute({ to: 'SOMEUSER', type: 'to-cms' });
  assert.strictEqual(route, null);
});

console.log(`\nTests passed: ${testsPassed}`);
console.log(`Tests failed: ${testsFailed}`);
process.exit(testsFailed > 0 ? 1 : 0);

})();
