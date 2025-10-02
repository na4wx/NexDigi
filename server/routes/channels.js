const express = require('express');
const router = express.Router();

// Channels routes
module.exports = (dependencies) => {
  const { manager, cfg, saveConfig, createAdapterForChannel } = dependencies;

  // Return channels with runtime status from manager when available
  router.get('/', (req, res) => {
    try {
      // Return all persisted channels, merging runtime status from manager when available.
      const persisted = Array.isArray(cfg.channels) ? cfg.channels : [];
      const runtime = new Map(manager.listChannels().map(c => [c.id, c]));
      const merged = persisted.map((p) => {
        const r = runtime.get(p.id) || {};
        const mergedObj = Object.assign({}, p, r);
        // Never let runtime overlay override persisted enabled state
        mergedObj.enabled = (p.enabled !== false);
        // attach a runtimeStatus object to indicate adapter state when available
        mergedObj.status = (r && r.status) ? r.status : (p.status || { connected: false });
        mergedObj.mode = p.mode || (p.options && p.options.mode) || (r && r.mode) || 'digipeat';
        // indicate whether this channel has a runtime adapter
        mergedObj.runtime = !!r && !!r.adapter;
        return mergedObj;
      });
      res.json(merged);
    } catch (e) {
      res.json(cfg.channels || []);
    }
  });

  router.post('/', (req, res) => {
    // sanitize payload
    const { id, name, type } = req.body || {};
    const options = (req.body && req.body.options && typeof req.body.options === 'object') ? req.body.options : {};
    if (!id || !name || !type) return res.status(400).json({ error: 'id,name,type required' });
    const existing = cfg.channels.find((c) => c.id === id);
    if (existing) return res.status(409).json({ error: 'channel exists' });
    const ch = { id: String(id), name: String(name), type: String(type), enabled: true, options };
    cfg.channels.push(ch);
    saveConfig(cfg);
    const adapter = createAdapterForChannel(ch);
    if (adapter) {
      manager.addChannel({ id, name, adapter, options: ch.options, enabled: ch.enabled });
      if (ch.options && Array.isArray(ch.options.targets)) ch.options.targets.forEach(t => manager.addRoute(id, t));
    }
    res.status(201).json(ch);
  });

  router.put('/:id', (req, res) => {
    const id = req.params.id;
    // sanitize payload for update
    const body = req.body || {};
    const safe = {
      // id is path param, ignore body.id
      name: (typeof body.name === 'string') ? body.name : undefined,
      type: (typeof body.type === 'string') ? body.type : undefined,
      enabled: (typeof body.enabled === 'boolean') ? body.enabled : undefined,
      options: (body.options && typeof body.options === 'object') ? body.options : undefined
    };
    const idx = cfg.channels.findIndex((c) => c.id === id);
    if (idx === -1) {
      console.log(`[CHANNELS] Channel ${id} not found`);
      return res.status(404).json({ error: 'not found' });
    }
    const old = cfg.channels[idx];
    // apply only defined fields
    const updated = Object.assign({}, old);
    if (safe.name !== undefined) updated.name = safe.name;
    if (safe.type !== undefined) updated.type = safe.type;
    if (safe.enabled !== undefined) updated.enabled = safe.enabled;
    if (safe.options !== undefined) updated.options = safe.options;
    cfg.channels[idx] = updated;
    try {
      saveConfig(cfg);
    } catch (err) {
      console.error(`[CHANNELS] saveConfig failed for channel ${id}:`, err);
      return res.status(500).json({ error: 'Failed to save config' });
    }

    // if type, options, or enabled state changed, recreate adapter
    const changedType = old.type !== updated.type;
    const changedOptions = JSON.stringify(old.options || {}) !== JSON.stringify(updated.options || {});
    const changedEnabled = old.enabled !== updated.enabled;
    
    if (changedType || changedOptions || changedEnabled) {
      // remove old from manager and add new
      manager.removeChannel(id);
      const adapter = createAdapterForChannel(updated);
      if (adapter && updated.enabled !== false) {
        manager.addChannel({ id: updated.id, name: updated.name, adapter, options: updated.options || {}, enabled: updated.enabled !== false });
        // re-apply targets/routes for this channel
        if (updated.options && Array.isArray(updated.options.targets)) {
          // remove existing runtime routes from this channel and apply new targets
          try {
            // We treat routes as operational data; runtime-only here
            manager.routes.delete(updated.id);
          } catch (e) { /* ignore */ }
          updated.options.targets.forEach(t => manager.addRoute(updated.id, t));
        }
      }
    }

    res.json(updated);
  });

  router.delete('/:id', (req, res) => {
    const id = req.params.id;
    const idx = cfg.channels.findIndex((c) => c.id === id);
    if (idx === -1) return res.status(404).json({ error: 'not found' });
    cfg.channels.splice(idx, 1);
    saveConfig(cfg);
    // remove from manager and close adapter
    manager.removeChannel(id);
    res.status(204).end();
  });

  // Force reconnect / recreate adapter for a channel from current config
  router.post('/:id/reconnect', (req, res) => {
    const id = req.params.id;
    const ch = (cfg.channels || []).find(c => c.id === id);
    if (!ch) return res.status(404).json({ error: 'not found' });
    try {
      manager.removeChannel(id);
      console.log(`Reconnecting channel ${id} using config port=${(ch.options && ch.options.port) || ''}`);
      const adapter = createAdapterForChannel(ch);
      if (!adapter) {
        console.error(`Reconnect: createAdapterForChannel returned null for ${id}`);
        return res.status(500).json({ error: 'failed to create adapter (check server logs)' });
      }
      // Attach listeners to expose lifecycle events
      try {
        adapter.on && adapter.on('error', (err) => console.error(`Adapter error for ${id}:`, err && err.message));
        adapter.on && adapter.on('open', () => console.log(`Adapter open for ${id}`));
        adapter.on && adapter.on('close', () => console.log(`Adapter close for ${id}`));
      } catch (e) { /* ignore */ }
      manager.addChannel({ id: ch.id, name: ch.name, adapter, options: ch.options || {}, enabled: ch.enabled !== false });
      
      // Reload ALL routes from digipeaterSettings (authoritative operational routes)
      try {
        const allRoutes = (req.app && req.app.locals && req.app.locals.digipeaterSettings && Array.isArray(req.app.locals.digipeaterSettings.routes))
          ? req.app.locals.digipeaterSettings.routes : [];
        allRoutes.forEach((r) => {
          console.log(`Reconnect: reloading route: ${r.from} -> ${r.to}`);
          try { manager.addRoute(r.from, r.to); } catch (e) { console.error('Reconnect route add failed:', e.message); }
        });
        console.log(`Reconnect: ${allRoutes.length} total routes reloaded after ${id} reconnection`);
      } catch (e) { /* ignore */ }
      
      console.log(`Reconnect: adapter created and manager.addChannel called for ${id}`);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Debug: return last written bytes for a channel's adapter (if supported)
  router.get('/:id/last-written', (req, res) => {
    const id = req.params.id;
    const ch = manager.channels.get(id);
    if (!ch) return res.status(404).json({ error: 'channel not active' });
    const adapter = ch.adapter;
    if (!adapter) return res.status(404).json({ error: 'adapter not present' });
    if (typeof adapter.getLastWrite === 'function') {
      return res.json({ last: adapter.getLastWrite() });
    }
    return res.status(404).json({ error: 'adapter does not expose last-write' });
  });

  // Debug: return last raw bytes received for a channel (hex) if available
  router.get('/:id/last-received', (req, res) => {
    const id = req.params.id;
    const ch = manager.channels.get(id);
    if (!ch) return res.status(404).json({ error: 'channel not active' });
    const last = ch._lastRawRx || null;
    return res.json({ last });
  });

  // Debug: return adapter internals for a channel
  router.get('/:id/debug', (req, res) => {
    const id = req.params.id;
    const ch = manager.channels.get(id);
    if (!ch) return res.status(404).json({ error: 'channel not active' });
    const adapter = ch.adapter;
    if (!adapter) return res.status(404).json({ error: 'adapter not present' });
    const info = {
      transport: adapter.transport || null,
      isSerial: !!adapter.isSerial,
      open: !!adapter._open,
      lastWrite: (typeof adapter.getLastWrite === 'function') ? adapter.getLastWrite() : null,
    };
    // if serial adapter, try to include portPath
    if (adapter.isSerial) {
      info.portPath = adapter.portPath || (adapter.port && adapter.port.path) || null;
      info.baud = adapter.baud || (adapter.port && adapter.port.baudRate) || null;
    }
    res.json(info);
  });

  return router;
};