const ChannelManager = require('./lib/channelManager');
const MockAdapter = require('./lib/adapters/mockAdapter');
const { makeFrame } = require('./test_helpers');

async function run() {
  const mgr = new ChannelManager();
  const a = new MockAdapter('A');
  const b = new MockAdapter('B');
  const c = new MockAdapter('C');

  mgr.addChannel({ id: 'A', name: 'A', adapter: a, options: { callsign: 'A' } });
  mgr.addChannel({ id: 'B', name: 'B', adapter: b, options: { callsign: 'B' } });
  mgr.addChannel({ id: 'C', name: 'C', adapter: c, options: { callsign: 'C' } });

  // chain A->B, B->C
  mgr.addRoute('A','B');
  mgr.addRoute('B','C');

  const counts = { A:0, B:0, C:0 };
  mgr.on('frame', ev => { if (counts.hasOwnProperty(ev.channel)) counts[ev.channel]++; });
  mgr.on('digipeat', ev => console.log('DIGI', ev));

  // inject frame at A
  a.emit('data', Buffer.concat([Buffer.from([0xC0]), makeFrame(), Buffer.from([0xC0])]));

  await new Promise(r => setTimeout(r, 400));
  console.log('counts', counts);
  if (counts.A===1 && counts.B===1 && counts.C===1) console.log('MULTI-HOP PASS'); else console.log('MULTI-HOP FAIL');
}

run().catch(e=>console.error(e));
