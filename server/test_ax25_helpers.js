function makeAddrBytes(name, ssid, last=false) {
  const buf = Buffer.alloc(7);
  const cs = name.toUpperCase().padEnd(6, ' ');
  for (let i = 0; i < 6; i++) buf[i] = cs.charCodeAt(i) << 1;
  let ssidByte = ((ssid & 0x0F) << 1);
  if (last) ssidByte |= 0x01;
  buf[6] = ssidByte;
  return buf;
}

function makeFrame() {
  const parts = [];
  parts.push(makeAddrBytes('DEST', 0, false));
  parts.push(makeAddrBytes('SRC', 0, false));
  parts.push(makeAddrBytes('WIDE2', 2, true));
  const header = Buffer.concat(parts);
  const control = Buffer.from([0x03]);
  const pid = Buffer.from([0xF0]);
  const payload = Buffer.from('Stress');
  return Buffer.concat([header, control, pid, payload]);
}

module.exports = { makeFrame };
