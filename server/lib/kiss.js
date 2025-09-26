// Minimal KISS helpers: frame wrapping/unwrapping
const FEND = 0xC0;
const FESC = 0xDB;
const TFEND = 0xDC;
const TFESC = 0xDD;

function escapeFrame(buf) {
  const out = [];
  out.push(FEND);
  // KISS command byte: data frame on port 0
  out.push(0x00);
  for (const b of buf) {
    if (b === FEND) { out.push(FESC, TFEND); }
    else if (b === FESC) { out.push(FESC, TFESC); }
    else out.push(b);
  }
  out.push(FEND);
  return Buffer.from(out);
}

function unescapeStream(buf) {
  // returns array of frames (Buffers) found between FEND
  const frames = [];
  let cur = [];
  let inFrame = false;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === FEND) {
      if (inFrame && cur.length) {
        // strip KISS command byte if present as first byte
        let frameBuf = Buffer.from(cur);
        if (frameBuf.length > 0) {
          // Common KISS implementations use 0x00 as the DATA command byte, but some TNCs
          // set a port nibble or different low values. Heuristic: if the first byte is a
          // small control value (<= 0x1F) treat it as a KISS command and strip it.
          if (frameBuf[0] === 0x00 || frameBuf[0] <= 0x1F) {
            if (process.env.DEBUG_KISS) console.log('kiss: stripped leading command byte', frameBuf[0].toString(16));
            frameBuf = frameBuf.slice(1);
          }
        }
        frames.push(frameBuf);
      }
      cur = [];
      inFrame = true;
      continue;
    }
    if (!inFrame) continue;
    if (b === FESC) {
      const next = buf[++i];
      if (next === TFEND) cur.push(FEND);
      else if (next === TFESC) cur.push(FESC);
      else cur.push(next);
      continue;
    }
    cur.push(b);
  }
  return frames;
}

module.exports = { escapeFrame, unescapeStream };
