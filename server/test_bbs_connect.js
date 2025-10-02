// Simulate an incoming SABM to the BBS and observe UA response
const ChannelManager = require('./lib/channelManager');
const MockAdapter = require('./lib/adapters/mockAdapter');
const { escapeFrame } = require('./lib/kiss');
const { buildAx25Frame, parseAx25Frame } = require('./lib/ax25');
const BBSSessionManager = require('./lib/bbsSession');

async function main() {
  const manager = new ChannelManager();
  const adapter = new MockAdapter('test');
  // Mark mock as KISS-capable by sending/receiving KISS frames
  manager.addChannel({ id: 'radioX', name: 'test', adapter, options: { callsign: 'TEST-1' } });

  // Initialize BBS session manager with target callsign
  const bbsCall = 'NA4WX-7';
  new BBSSessionManager(manager, bbsCall);

  let gotUA = false;
  manager.on('tx', (evt) => {
    const buf = Buffer.from(evt.raw, 'hex');
    try {
      const p = parseAx25Frame(buf);
      const ctl = p.control & 0xff;
      if (ctl === 0x63) {
        console.log('Got UA in response to SABM. OK');
        gotUA = true;
      }
    } catch (e) {}
  });

  // Build SABM from remote to BBS
  const sabm = buildAx25Frame({ dest: bbsCall, src: 'N0CALL-1', control: 0x2f, pid: null, payload: '' });
  // Send as KISS frame into adapter
  const kiss = escapeFrame(sabm);
  adapter.emit('data', kiss);

  // Allow some time for async handling
  await new Promise((res) => setTimeout(res, 300));

  if (!gotUA) {
    console.error('Did not observe UA in response to SABM');
    // try variant control sometimes seen (0x3F)
    const sabmVar = buildAx25Frame({ dest: bbsCall, src: 'N0CALL-1', control: 0x3f, pid: null, payload: '' });
    adapter.emit('data', escapeFrame(sabmVar));
    await new Promise((res) => setTimeout(res, 300));
    if (!gotUA) process.exitCode = 1;
  } else {
    console.log('Test passed');
  }
  if (gotUA) process.exit(0);
}

main();
