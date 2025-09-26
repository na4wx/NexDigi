const ChannelManager = require('./lib/channelManager');
const MockAdapter = require('./lib/adapters/mockAdapter');
const { formatCallsign } = require('./lib/ax25');

// Build a simple AX.25 UI frame with dest,SRC,WIDE2-2 path and payload
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
  // Put WIDE2 with ssid=2 in SSID nibble
  parts.push(makeAddrBytes('WIDE2', 2, true));
  const header = Buffer.concat(parts);
  const control = Buffer.from([0x03]);
  const pid = Buffer.from([0xF0]);
  const payload = Buffer.from('Test from A');
  return Buffer.concat([header, control, pid, payload]);
}

async function run() {
  const mgr = new ChannelManager();
  // turn on route-only behavior (default) and create mock channels
  const a = new MockAdapter('mockA');
  const b = new MockAdapter('mockB');

  mgr.addChannel({ id: 'mockA', name: 'Mock A', adapter: a, options: { callsign: 'MOCKA' } });
  mgr.addChannel({ id: 'mockB', name: 'Mock B', adapter: b, options: { callsign: 'MOCKB' } });

  // Simulate per-channel options.targets instead of manager.addRoute
  mgr.addRoute('mockA', 'mockB');

  const counts = { mockA: 0, mockB: 0 };

  mgr.on('frame', (ev) => {
    console.log('FRAME_EVENT', ev.channel, ev.raw.slice(0,40));
    if (counts.hasOwnProperty(ev.channel)) counts[ev.channel]++;
  });

  mgr.on('digipeat', (ev) => {
    console.log('DIGI', ev);
  });

  // Inject frame into adapter A as if received from the radio (use KISS-like FEND wrapper)
  const frame = makeFrame();
  const kiss = Buffer.concat([Buffer.from([0xC0]), frame, Buffer.from([0xC0])]);
  // simulate incoming data
  a.emit('data', kiss);

  // wait a short time and check state
  await new Promise(r => setTimeout(r, 400));

  console.log('counts', counts);
  const pass = counts.mockA === 1 && counts.mockB === 1;
  if (pass) console.log('TEST PASS: mockA had 1 original frame and mockB received exactly 1 digipeated frame (no loop)');
  else console.log('TEST FAIL: unexpected counts (expected 1 each)');

  // cleanup
  a.close(); b.close();
}

run().catch(e => console.error(e));
