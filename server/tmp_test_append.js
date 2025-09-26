const { parseAx25Frame, serviceAddressInBuffer, parseAddressField, formatCallsign, _callsignBase } = require('./lib/ax25');

// frame hex observed in logs (AX.25 payload)
const hex = 'a66aa8a262a6609c8268aeb040e6ae92888a62408103f0606f57696c21605b2f6022374c7d4d6f62696c65203134362e3532305f300d';
const buf = Buffer.from(hex, 'hex');
console.log('orig hex:', buf.toString('hex'));
const parsed = parseAx25Frame(buf);
console.log('orig addresses:', parsed.addresses);

const serviced = serviceAddressInBuffer(buf, 'WIDE1');
console.log('serviced hex:', serviced.toString('hex'));
const parsed2 = parseAx25Frame(serviced);
console.log('serviced addresses:', parsed2.addresses);

// Try to locate toMark in serviced buffer and insert digi callsign
let sf = Buffer.from(serviced);
let off = 0; let found = false;
while (off + 7 <= sf.length) {
  const a = parseAddressField(sf, off);
  console.log('field at', off, a);
  if (a && a.callsign && _callsignBase(a.callsign) === _callsignBase('WIDE1')) {
    console.log('matched at', off, a.callsign);
    const tgtCall = 'NA4WX-9';
    const m = String(tgtCall).toUpperCase().match(/^([A-Z0-9]{1,6})(?:-(\d+))?$/);
    const base = m ? m[1].slice(0,6) : String(tgtCall).slice(0,6);
    const ssid = m && m[2] ? Number(m[2]) : 0;
    const newAddr = formatCallsign(base, ssid);
    newAddr[6] = (sf[off + 6] & 0x01) ? (newAddr[6] | 0x01) : (newAddr[6] & ~0x01);
    newAddr[6] = newAddr[6] | 0x80;
    for (let i = 0; i < 7; i++) sf[off + i] = newAddr[i];
    found = true; break;
  }
  off += 7;
  if (a && a.last) break;
}
console.log('found?', found);
console.log('final hex:', sf.toString('hex'));
console.log('final addresses:', parseAx25Frame(sf).addresses);
