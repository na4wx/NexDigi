const ChannelManager = require('./lib/channelManager');
const MockAdapter = require('./lib/adapters/mockAdapter');
const { makeFrame } = require('./test_helpers');

async function run() {
  const mgr = new ChannelManager();
  const n = 6;
  const adapters = [];
  for (let i=0;i<n;i++) adapters.push(new MockAdapter('m'+i));
  for (let i=0;i<n;i++) mgr.addChannel({ id: 'c'+i, name: 'c'+i, adapter: adapters[i], options: { callsign: 'C'+i } });

  // fully connect routes c0->c1->c2->...->c0 (loop)
  for (let i=0;i<n;i++) mgr.addRoute('c'+i, 'c'+((i+1)%n));

  const counts = {};
  for (let i=0;i<n;i++) counts['c'+i]=0;
  mgr.on('frame', ev => { if (counts.hasOwnProperty(ev.channel)) counts[ev.channel]++; });

  // inject a frame at c0 many times quickly to stress-test seen-cache
  for (let k=0;k<10;k++) adapters[0].emit('data', Buffer.concat([Buffer.from([0xC0]), makeFrame(), Buffer.from([0xC0])]));

  await new Promise(r => setTimeout(r, 1000));
  console.log('counts', counts);
  console.log('If seen-cache working, counts should be small (no exponential growth)');
}

run().catch(e=>console.error(e));
