const { parseAx25Frame, serviceAddressInBuffer } = require('./lib/ax25');

// Construct a fake AX.25 frame bytes: dest, src, path entries (each 7 bytes), control, pid, payload
// We'll create: DEST, SRC, WIDE2-2 (ssid=2), control=0x03 (UI), pid=0xf0, payload='hello'

function makeAddr(name, ssid, last=false) {
  const buf = Buffer.alloc(7);
  const cs = name.toUpperCase().padEnd(6, ' ');
  for (let i = 0; i < 6; i++) buf[i] = cs.charCodeAt(i) << 1;
  let ssidByte = ((ssid & 0x0F) << 1);
  if (last) ssidByte |= 0x01; // EA bit
  buf[6] = ssidByte;
  return buf;
}

const parts = [];
parts.push(makeAddr('DEST', 0, false));
parts.push(makeAddr('SRC', 0, false));
parts.push(makeAddr('WIDE2', 2, true));
const header = Buffer.concat(parts);
const control = Buffer.from([0x03]);
const pid = Buffer.from([0xF0]);
const payload = Buffer.from('Hello APRS');
const frame = Buffer.concat([header, control, pid, payload]);

console.log('Before parse:');
const p1 = parseAx25Frame(frame);
console.log(JSON.stringify(p1.addresses, null, 2));

const serviced = serviceAddressInBuffer(frame, 'WIDE2');
console.log('After service (WIDE2->decrement/mark):');
const p2 = parseAx25Frame(serviced);
console.log(JSON.stringify(p2.addresses, null, 2));

// Show raw SSID bytes for inspection
console.log('Raw SSID bytes (before):', header.slice(6, 7).toString('hex'), header.slice(13,14).toString('hex'), header.slice(20,21).toString('hex'));
console.log('Raw SSID bytes (after):', serviced.slice(6,7).toString('hex'), serviced.slice(13,14).toString('hex'), serviced.slice(20,21).toString('hex'));

// Now test textual-suffix form: make a frame with WIDE2-2 in the 6-byte callsign field
const parts2 = [];
parts2.push(makeAddr('DEST', 0, false));
parts2.push(makeAddr('SRC', 0, false));
// We'll write 'WIDE2-2' into the 6-byte callsign (truncated to 6 chars -> 'WIDE2-') and expect decrement
const wideText = Buffer.alloc(7);
const txt = 'WIDE2-2'.toUpperCase().padEnd(6, ' ').slice(0,6);
for (let i = 0; i < 6; i++) wideText[i] = txt.charCodeAt(i) << 1;
wideText[6] = 0x01; // EA bit
parts2.push(wideText);
const header2 = Buffer.concat(parts2);
const frame2 = Buffer.concat([header2, control, pid, payload]);
console.log('\nText-suffix test before:');
console.log(JSON.stringify(parseAx25Frame(frame2).addresses, null, 2));
const serviced2 = serviceAddressInBuffer(frame2, 'WIDE2-2');
console.log('Text-suffix test after:');
console.log(JSON.stringify(parseAx25Frame(serviced2).addresses, null, 2));
console.log('Raw SSID bytes (text before):', header2.slice(20,21).toString('hex'));
console.log('Raw SSID bytes (text after):', serviced2.slice(20,21).toString('hex'));
