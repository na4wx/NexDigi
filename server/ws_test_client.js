const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000');
ws.on('open', () => console.log('ws open'));
ws.on('message', (m) => {
  try { console.log('MSG:', m.toString().slice(0,1000)); } catch (e) { console.log('msg err', e); }
});
ws.on('close', () => console.log('ws close'));
ws.on('error', (e) => console.log('ws err', e && e.message));
setTimeout(()=>{ console.log('exiting'); process.exit(0); }, 10000);
