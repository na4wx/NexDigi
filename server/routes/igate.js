const express = require('express');
const router = express.Router();

// IGate routes
module.exports = (dependencies) => {
  const { cfg, saveConfig, ensureIgate, igate } = dependencies;

  router.get('/', (req, res) => {
    res.json(cfg.igate || { enabled: false, host: '', port: 14580, call: '', pass: '', channels: [] });
  });

  // GET /api/igate/status - return current igate connection status
  router.get('/status', (req, res) => {
    if (!igate) {
      res.json({ connected: false, authenticated: false, enabled: false });
      return;
    }
    const status = igate.getStatus();
    status.enabled = !!(cfg && cfg.igate && cfg.igate.enabled);
    res.json(status);
  });

  router.put('/', (req, res) => {
    const body = req.body || {};
    cfg.igate = Object.assign({}, cfg.igate || {}, body);
    saveConfig(cfg);
    try { ensureIgate(); } catch (e) {}
    res.json(cfg.igate);
  });

  return router;
};