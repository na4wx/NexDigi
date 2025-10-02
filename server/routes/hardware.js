const express = require('express');
const net = require('net');
const router = express.Router();

// Hardware/Serial routes
module.exports = (dependencies) => {

  // list available serial ports (if serialport installed)
  router.get('/serial-ports', async (req, res) => {
    try {
      const sp = require('serialport');
      let list = [];
      if (typeof sp.list === 'function') list = await sp.list();
      else if (sp && sp.SerialPort && typeof sp.SerialPort.list === 'function') list = await sp.SerialPort.list();
      // Normalize entries
      const out = list.map(p => ({ path: p.path || p.comName || p.device || p.locationId, manufacturer: p.manufacturer }));
      res.json(out);
    } catch (e) {
      // serialport not available or error
      res.json([]);
    }
  });

  // Simple TCP probe endpoint to test connectivity to a host:port
  router.get('/probe', async (req, res) => {
    const host = req.query.host;
    const port = Number(req.query.port || 0);
    if (!host || !port) return res.status(400).json({ error: 'host,port required' });
    const socket = new net.Socket();
    let done = false;
    const timeout = setTimeout(() => {
      if (done) return; done = true; try { socket.destroy(); } catch(e){}; res.status(504).json({ ok: false, error: 'timeout' });
    }, 3000);
    socket.once('error', (err) => { if (done) return; done = true; clearTimeout(timeout); try { socket.destroy(); } catch(e){}; res.json({ ok: false, error: err.message }); });
    socket.connect(port, host, () => { if (done) return; done = true; clearTimeout(timeout); socket.end(); res.json({ ok: true }); });
  });

  // Serial probe: attempt to open the named serial port briefly to verify availability
  router.get('/serial-probe', async (req, res) => {
    const portName = req.query.port;
    const baud = Number(req.query.baud || 9600);
    if (!portName) return res.status(400).json({ error: 'port required' });
    try {
      let sp;
      try {
        sp = require('serialport');
      } catch (e) {
        return res.json({ ok: false, error: 'serialport package not installed: ' + e.message });
      }

      // serialport v>=9 exports classes differently; support both common patterns
      const SerialPortClass = sp && sp.SerialPort ? sp.SerialPort : sp;
      let portObj;
      try {
        // Newer API: new SerialPort({ path, baudRate, autoOpen: false })
        if (typeof SerialPortClass === 'function') {
          try {
            portObj = new SerialPortClass({ path: portName, baudRate: baud, autoOpen: false });
          } catch (e) {
            // Fallback to older constructor style: new SerialPortClass(path, options)
            portObj = new SerialPortClass(portName, { baudRate: baud, autoOpen: false });
          }
        } else {
          return res.json({ ok: false, error: 'serialport API not recognized' });
        }
      } catch (e) {
        return res.json({ ok: false, error: 'failed constructing SerialPort: ' + e.message });
      }

      let done = false;
      const timer = setTimeout(() => {
        if (done) return; done = true; try { if (portObj && portObj.close) portObj.close(); } catch (e) {};
        return res.status(504).json({ ok: false, error: 'timeout' });
      }, 3000);

      const finish = (result) => { if (done) return; done = true; clearTimeout(timer); return res.json(result); };

      // attach one-time listeners for 'open' and 'error'
      const onOpen = () => {
        try {
          if (portObj && portObj.close) {
            // try close then respond
            portObj.close(() => finish({ ok: true }));
          } else {
            finish({ ok: true });
          }
        } catch (e) { finish({ ok: false, error: 'open succeeded but close failed: ' + e.message }); }
      };
      const onError = (err) => { finish({ ok: false, error: (err && err.message) ? err.message : String(err) }); };

      try {
        if (typeof portObj.open === 'function') {
          portObj.once && portObj.once('open', onOpen);
          portObj.once && portObj.once('error', onError);
          // open may return a Promise or accept a callback
          const p = portObj.open();
          if (p && typeof p.then === 'function') {
            p.catch(onError);
          }
        } else if (portObj.open && typeof portObj.open === 'undefined') {
          // older API might open on constructor; attach listeners and assume it's open
          portObj.once && portObj.once('open', onOpen);
          portObj.once && portObj.once('error', onError);
        } else {
          return finish({ ok: false, error: 'serialport open API not available' });
        }
      } catch (e) {
        return finish({ ok: false, error: 'error opening port: ' + e.message });
      }
    } catch (e) {
      return res.json({ ok: false, error: 'unexpected error: ' + e.message });
    }
  });

  return router;
};