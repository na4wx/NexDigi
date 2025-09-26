// Usage: node server/tools/serial_watch.js COM8 57600
// Opens the given serial port and logs raw incoming bytes (hex + ascii preview).

const portArg = process.argv[2];
const baudArg = Number(process.argv[3] || 57600);
if (!portArg) {
  console.error('Usage: node server/tools/serial_watch.js <PORT> [baud]');
  process.exit(1);
}

let SerialPort;
try {
  SerialPort = require('serialport');
} catch (e) {
  console.error('serialport package not installed:', e && e.message);
  process.exit(2);
}

const SerialPortClass = SerialPort && SerialPort.SerialPort ? SerialPort.SerialPort : SerialPort;

async function main() {
  console.log(`Opening ${portArg} at ${baudArg} baud`);
  let portObj;
  try {
    try {
      portObj = new SerialPortClass({ path: portArg, baudRate: baudArg, autoOpen: false });
    } catch (e) {
      portObj = new SerialPortClass(portArg, { baudRate: baudArg, autoOpen: false });
    }
  } catch (e) {
    console.error('Failed to construct SerialPort object:', e && e.message);
    process.exit(3);
  }

  portObj.on && portObj.on('error', (err) => console.error('serial error', err && err.message));
  portObj.on && portObj.on('close', () => console.log('serial port closed'));
  portObj.on && portObj.on('open', () => console.log('serial port open'));
  portObj.on && portObj.on('data', (d) => {
    try {
      const hex = Buffer.from(d).toString('hex');
      const ascii = Buffer.from(d).toString('utf8').replace(/[^\x20-\x7E]/g, '.');
      console.log(`rx ${d.length} bytes:`, hex, ascii);
    } catch (e) { console.log('rx error', e && e.message); }
  });

  try {
    const p = portObj.open();
    if (p && typeof p.then === 'function') {
      p.then(() => console.log('opened')).catch((e) => { console.error('open error', e && e.message); process.exit(4); });
    }
  } catch (e) {
    try { portObj.open(() => {}); } catch (e2) { console.error('open exception', e && e.message); process.exit(4); }
  }
}

main();
