#!/usr/bin/env node
const assert = require('assert');
const path = require('path');

const {
  parseAx25Frame,
  parseAddressField,
  formatCallsign,
  serviceAddressInBuffer,
  _callsignBase,
  buildAx25Frame
} = require(path.join(__dirname, '..', 'server', 'lib', 'ax25.js'));

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

// --- formatCallsign / parseAddressField round trip ---

test('formatCallsign encodes a 7-byte shifted address field', () => {
  const buf = formatCallsign('N0CALL', 5);
  assert.strictEqual(buf.length, 7);
  const parsed = parseAddressField(buf, 0);
  assert.strictEqual(parsed.callsign, 'N0CALL');
  assert.strictEqual(parsed.ssid, 5);
});

test('formatCallsign pads short callsigns with spaces', () => {
  const buf = formatCallsign('W1AW', 0);
  const parsed = parseAddressField(buf, 0);
  assert.strictEqual(parsed.callsign, 'W1AW');
});

test('parseAddressField reads H-bit and EA (last) bit', () => {
  const buf = formatCallsign('WIDE2', 2);
  buf[6] = buf[6] | 0x80 | 0x01; // set H-bit and EA
  const parsed = parseAddressField(buf, 0);
  assert.strictEqual(parsed.hasBeenRepeated, true);
  assert.strictEqual(parsed.last, true);
});

// --- parseAx25Frame ---

test('parseAx25Frame parses a UI frame with dest+src+payload', () => {
  const frame = buildAx25Frame({ dest: 'APRS', src: 'N0CALL-5', control: 0x03, pid: 0xF0, payload: '!hello' });
  const parsed = parseAx25Frame(frame);
  assert.strictEqual(parsed.addresses.length, 2);
  assert.strictEqual(parsed.addresses[0].callsign, 'APRS');
  assert.strictEqual(parsed.addresses[1].callsign, 'N0CALL');
  assert.strictEqual(parsed.addresses[1].ssid, 5);
  assert.strictEqual(parsed.control, 0x03);
  assert.strictEqual(parsed.pid, 0xF0);
  assert.strictEqual(parsed.payload.toString(), '!hello');
});

test('parseAx25Frame parses a multi-hop digipeater path', () => {
  const frame = buildAx25Frame({ dest: 'APRS', src: 'N0CALL', payload: 'test' });
  // Manually append two path entries (WIDE1-1, WIDE2-2) before control/pid/payload.
  const wide1 = formatCallsign('WIDE1', 1);
  const wide2 = formatCallsign('WIDE2', 2);
  wide2[6] |= 0x01; // EA on last address
  // Rebuild: dest+src (without EA on src) + path + control/pid/payload
  const destSrc = frame.slice(0, 14);
  destSrc[13] = destSrc[13] & ~0x01; // clear EA on src, it's no longer last
  const rest = frame.slice(14); // control + pid + payload
  const full = Buffer.concat([destSrc, wide1, wide2, rest]);

  const parsed = parseAx25Frame(full);
  assert.strictEqual(parsed.addresses.length, 4);
  assert.strictEqual(parsed.addresses[2].callsign, 'WIDE1');
  assert.strictEqual(parsed.addresses[2].ssid, 1);
  assert.strictEqual(parsed.addresses[3].callsign, 'WIDE2');
  assert.strictEqual(parsed.addresses[3].ssid, 2);
  assert.strictEqual(parsed.payload.toString(), 'test');
});

test('parseAx25Frame omits PID for non-UI/I frames (e.g. SABM)', () => {
  const frame = buildAx25Frame({ dest: 'N0CALL', src: 'N0CALL-1', control: 0x2F, pid: null, payload: '' });
  const parsed = parseAx25Frame(frame);
  assert.strictEqual(parsed.control, 0x2F);
  assert.strictEqual(parsed.pid, undefined);
});

// --- _callsignBase ---

test('_callsignBase strips numeric SSID suffix', () => {
  assert.strictEqual(_callsignBase('WIDE2-2'), 'WIDE2');
  assert.strictEqual(_callsignBase('N0CALL-15'), 'N0CALL');
});

test('_callsignBase handles callsigns with no suffix', () => {
  assert.strictEqual(_callsignBase('APRS'), 'APRS');
});

test('_callsignBase handles a truncated trailing dash', () => {
  assert.strictEqual(_callsignBase('WIDE2-'), 'WIDE2');
});

// --- serviceAddressInBuffer ---

test('serviceAddressInBuffer decrements a WIDEn-N SSID and sets H-bit', () => {
  const frame = buildAx25Frame({ dest: 'APRS', src: 'N0CALL', payload: 'x' });
  const destSrc = frame.slice(0, 14);
  destSrc[13] = destSrc[13] & ~0x01;
  const wide = formatCallsign('WIDE2', 2);
  wide[6] |= 0x01;
  const rest = frame.slice(14);
  const full = Buffer.concat([destSrc, wide, rest]);

  const serviced = serviceAddressInBuffer(full, 'WIDE2-2');
  const parsed = parseAddressField(serviced, 14);
  assert.strictEqual(parsed.ssid, 1, 'SSID should decrement from 2 to 1');
  assert.strictEqual(parsed.hasBeenRepeated, true, 'H-bit should be set once serviced');
});

test('serviceAddressInBuffer leaves buffer unchanged when target not found', () => {
  const frame = buildAx25Frame({ dest: 'APRS', src: 'N0CALL', payload: 'x' });
  const serviced = serviceAddressInBuffer(frame, 'WIDE7-7');
  assert.deepStrictEqual(serviced, frame);
});

// --- buildAx25Frame ---

test('buildAx25Frame requires dest and src', () => {
  assert.throws(() => buildAx25Frame({ payload: 'x' }), /requires dest and src/);
});

test('buildAx25Frame sets command bit on destination for command frames', () => {
  const frame = buildAx25Frame({ dest: 'N0CALL', src: 'N0CALL-1', commandType: 'command', payload: '' });
  const destByte = frame[6];
  assert.strictEqual((destByte & 0x80) !== 0, true);
});

test('buildAx25Frame omits PID when pid is explicitly null (U/S frames)', () => {
  const frame = buildAx25Frame({ dest: 'N0CALL', src: 'N0CALL-1', control: 0x63, pid: null, payload: '' });
  // dest(7) + src(7) + control(1) = 15 bytes total, no PID, no payload
  assert.strictEqual(frame.length, 15);
});

console.log(`\nTests passed: ${testsPassed}`);
console.log(`Tests failed: ${testsFailed}`);
process.exit(testsFailed > 0 ? 1 : 0);
