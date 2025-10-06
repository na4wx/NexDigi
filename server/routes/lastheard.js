const express = require('express');
const router = express.Router();

module.exports = (dependencies) => {
  const { lastHeard } = dependencies;

  // GET /api/lastheard?q=CALL&mode=APRS&since=ts&limit=100
  router.get('/', (req, res) => {
    try {
      const q = req.query.q || null;
      const mode = req.query.mode || null;
      const since = req.query.since ? Number(req.query.since) : null;
      const limit = req.query.limit ? Number(req.query.limit) : 200;
      const out = lastHeard.query({ q, mode, since, limit });
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: e && e.message });
    }
  });

  // GET /api/lastheard/:callsign - exact callsign lookup
  router.get('/:callsign', (req, res) => {
    try {
      const cs = String(req.params.callsign || '').toUpperCase();
      const out = lastHeard.query({ q: cs, limit: 1000 });
      res.json(out.filter(e => String(e.callsign || '').toUpperCase() === cs));
    } catch (e) { res.status(500).json({ error: e && e.message }); }
  });

  return router;
};
