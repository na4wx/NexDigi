const express = require('express');
const path = require('path');

module.exports = function(deps) {
  const router = express.Router();
  const settingsPath = path.join(__dirname, '..', 'data', 'winlinkSettings.json');

  router.get('/winlink/settings', (req, res) => {
    try {
      if (deps && deps.winlinkManager) return res.json(deps.winlinkManager.getSettings());
      const raw = require('fs').readFileSync(settingsPath, 'utf8') || '{}';
      const j = JSON.parse(raw || '{}');
      res.json(j);
    } catch (e) {
      console.error('winlink settings read failed', e);
      res.status(500).json({ error: 'failed to read settings' });
    }
  });

  router.post('/winlink/settings', express.json(), (req, res) => {
    try {
      const newSettings = req.body || {};
      require('fs').writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2), 'utf8');
      // If Winlink manager is present, update it
      try {
        if (deps && deps.winlinkManager) deps.winlinkManager.saveSettings(newSettings);
      } catch (e) { console.error('winlink settings saved but manager update failed', e); }
      res.json({ ok: true });
    } catch (e) {
      console.error('winlink settings write failed', e);
      res.status(500).json({ error: 'failed to save settings' });
    }
  });

  router.get('/winlink/status', (req, res) => {
    try {
      if (deps && deps.winlinkManager) return res.json(deps.winlinkManager.getStatus());
      return res.json({ enabled: false, connected: false, lastError: null });
    } catch (e) {
      res.status(500).json({ error: 'failed to get status' });
    }
  });

  router.post('/winlink/start', express.json(), async (req, res) => {
    try {
      if (deps && deps.winlinkManager) {
        const ok = await deps.winlinkManager.start();
        return res.json({ ok });
      }
      res.status(500).json({ error: 'winlink manager not available' });
    } catch (e) {
      console.error('winlink start failed', e);
      res.status(500).json({ error: 'start failed' });
    }
  });

  router.post('/winlink/stop', express.json(), async (req, res) => {
    try {
      if (deps && deps.winlinkManager) {
        const ok = await deps.winlinkManager.stop();
        return res.json({ ok });
      }
      res.status(500).json({ error: 'winlink manager not available' });
    } catch (e) {
      console.error('winlink stop failed', e);
      res.status(500).json({ error: 'stop failed' });
    }
  });

  // list active sessions
  router.get('/winlink/sessions', (req, res) => {
    try {
      if (deps && deps.winlinkManager) return res.json({ sessions: deps.winlinkManager.listSessions() });
      return res.json({ sessions: [] });
    } catch (e) { console.error('winlink sessions failed', e); res.status(500).json({ error: 'failed to list sessions' }); }
  });

  // terminate a session by key
  router.post('/winlink/sessions/terminate', express.json(), (req, res) => {
    try {
      const key = req.body && req.body.key;
      if (!key) return res.status(400).json({ error: 'missing key' });
      if (deps && deps.winlinkManager) {
        const ok = deps.winlinkManager.terminateSession(key);
        return res.json({ ok });
      }
      res.status(500).json({ error: 'winlink manager not available' });
    } catch (e) { console.error('winlink terminate failed', e); res.status(500).json({ error: 'terminate failed' }); }
  });

  return router;
};
