const { unescapeStream } = require('../lib/kiss');
const { parseAx25Frame } = require('../lib/ax25');

function decode(hex) {
  const buf = Buffer.from(hex.replace(/\s+/g, ''), 'hex');
  const frames = unescapeStream(buf);
  if (!frames || frames.length === 0) {
    console.error('No frames found in KISS data');
    return;
  }
  frames.forEach((f, i) => {
    console.log(`--- Frame ${i} (len=${f.length}) ---`);
    console.log('raw:', f.toString('hex'));
    try {
      const parsed = parseAx25Frame(f);
      console.log('addresses:');
      (parsed.addresses || []).forEach((a, idx) => {
        console.log(`  [${idx}] callsign=${a.callsign} ssid=${a.ssid} marked=${!!a.marked}`);
      });
      const fmt = (v) => {
        if (v === undefined || v === null) return '(none)';
        if (Buffer.isBuffer(v)) return v.toString('hex');
        if (typeof v === 'number') return v.toString(16).padStart(2, '0');
        try { return String(v); } catch (e) { return String(v); }
      };
      console.log('control:', fmt(parsed.control));
      console.log('pid:', fmt(parsed.pid));
      console.log('payload (hex):', (parsed.payload || Buffer.alloc(0)).toString('hex'));
      console.log('payload (utf8):', (parsed.payload || Buffer.alloc(0)).toString('utf8'));
    } catch (e) {
      console.error('parseAx25Frame error:', e && e.message);
    }
  });
}

if (require.main === module) {
  const hex = process.argv[2];
  if (!hex) {
    console.error('Usage: node decode_hex.js <hex>');
    process.exit(2);
  }
  decode(hex);
}

module.exports = { decode };
