/**
 * Backbone API Routes
 * Provides REST API for backbone mesh networking status and management
 */

const express = require('express');
const router = express.Router();

module.exports = (deps) => {
  const { backboneManager } = deps;

  /**
   * GET /api/backbone/status
   * Get current backbone status including neighbors, services, and transport metrics
   */
  router.get('/backbone/status', (req, res) => {
    try {
      if (!backboneManager) {
        return res.status(503).json({ 
          error: 'Backbone manager not initialized',
          enabled: false 
        });
      }

      const status = backboneManager.getStatus();
      res.json(status);
    } catch (error) {
      console.error('[Backbone API] Error getting status:', error);
      res.status(500).json({ 
        error: 'Failed to get backbone status',
        message: error.message 
      });
    }
  });

  /**
   * GET /api/backbone/config
   * Get current backbone configuration
   */
  router.get('/backbone/config', (req, res) => {
    try {
      if (!backboneManager) {
        return res.status(503).json({ 
          error: 'Backbone manager not initialized' 
        });
      }

      res.json(backboneManager.config || {});
    } catch (error) {
      console.error('[Backbone API] Error getting config:', error);
      res.status(500).json({ 
        error: 'Failed to get backbone config',
        message: error.message 
      });
    }
  });

  /**
   * POST /api/backbone/config
   * Update backbone configuration
   */
  router.post('/backbone/config', express.json(), async (req, res) => {
    try {
      if (!backboneManager) {
        return res.status(503).json({ 
          error: 'Backbone manager not initialized' 
        });
      }

      const newConfig = req.body;
      
      // Update configuration
      Object.assign(backboneManager.config, newConfig);
      
      // Save to disk
      await backboneManager.saveConfig();
      
      res.json({ 
        success: true,
        message: 'Configuration updated. Restart server to apply changes.',
        config: backboneManager.config
      });
    } catch (error) {
      console.error('[Backbone API] Error updating config:', error);
      res.status(500).json({ 
        error: 'Failed to update backbone config',
        message: error.message 
      });
    }
  });

  /**
   * GET /api/backbone/neighbors
   * Get list of backbone neighbors
   */
  router.get('/backbone/neighbors', (req, res) => {
    try {
      if (!backboneManager || !backboneManager.enabled) {
        return res.json({ neighbors: [] });
      }

      const neighbors = Array.from(backboneManager.neighbors.entries()).map(([callsign, info]) => ({
        callsign,
        ...info,
        lastSeenAgo: Date.now() - info.lastSeen
      }));

      res.json({ neighbors });
    } catch (error) {
      console.error('[Backbone API] Error getting neighbors:', error);
      res.status(500).json({ 
        error: 'Failed to get neighbors',
        message: error.message 
      });
    }
  });

  /**
   * GET /api/backbone/services
   * Get available services on the backbone network
   */
  router.get('/backbone/services', (req, res) => {
    try {
      if (!backboneManager || !backboneManager.enabled) {
        return res.json({ services: {} });
      }

      const services = {};
      for (const [service, providers] of backboneManager.services.entries()) {
        services[service] = Array.from(providers);
      }

      res.json({ services });
    } catch (error) {
      console.error('[Backbone API] Error getting services:', error);
      res.status(500).json({ 
        error: 'Failed to get services',
        message: error.message 
      });
    }
  });

  /**
   * POST /api/backbone/send
   * Send data to a destination via backbone
   */
  router.post('/backbone/send', express.json(), async (req, res) => {
    try {
      if (!backboneManager || !backboneManager.enabled) {
        return res.status(503).json({ 
          error: 'Backbone not enabled' 
        });
      }

      const { destination, data, priority } = req.body;

      if (!destination || !data) {
        return res.status(400).json({ 
          error: 'Missing required fields: destination, data' 
        });
      }

      // Convert data to Buffer
      const dataBuffer = Buffer.from(data, typeof data === 'string' ? 'utf8' : undefined);

      // Send via backbone
      const messageId = await backboneManager.sendData(destination, dataBuffer, { priority });

      res.json({ 
        success: true,
        messageId,
        destination,
        size: dataBuffer.length
      });
    } catch (error) {
      console.error('[Backbone API] Error sending data:', error);
      res.status(500).json({ 
        error: 'Failed to send data',
        message: error.message 
      });
    }
  });

  /**
   * GET /api/backbone/transports
   * Get status of all transports
   */
  router.get('/backbone/transports', (req, res) => {
    try {
      if (!backboneManager || !backboneManager.enabled) {
        return res.json({ transports: {} });
      }

      const transports = {};
      for (const [id, transport] of backboneManager.transports.entries()) {
        transports[id] = {
          type: transport.type,
          connected: transport.connected,
          available: transport.isAvailable(),
          cost: transport.getCost(),
          mtu: transport.getMTU(),
          metrics: transport.getMetrics()
        };
      }

      res.json({ transports });
    } catch (error) {
      console.error('[Backbone API] Error getting transports:', error);
      res.status(500).json({ 
        error: 'Failed to get transports',
        message: error.message 
      });
    }
  });

  /**
   * POST /api/backbone/peer/add
   * Add an Internet peer dynamically
   */
  router.post('/backbone/peer/add', express.json(), async (req, res) => {
    try {
      if (!backboneManager || !backboneManager.enabled) {
        return res.status(503).json({ 
          error: 'Backbone not enabled' 
        });
      }

      const { host, port, callsign } = req.body;

      if (!host || !port || !callsign) {
        return res.status(400).json({ 
          error: 'Missing required fields: host, port, callsign' 
        });
      }

      const internetTransport = backboneManager.transports.get('internet');
      if (!internetTransport) {
        return res.status(400).json({ 
          error: 'Internet transport not available' 
        });
      }

      await internetTransport.addPeer({ host, port, callsign });

      res.json({ 
        success: true,
        message: `Peer ${callsign} added`,
        peer: { host, port, callsign }
      });
    } catch (error) {
      console.error('[Backbone API] Error adding peer:', error);
      res.status(500).json({ 
        error: 'Failed to add peer',
        message: error.message 
      });
    }
  });

  /**
   * POST /api/backbone/peer/remove
   * Remove an Internet peer
   */
  router.post('/backbone/peer/remove', express.json(), (req, res) => {
    try {
      if (!backboneManager || !backboneManager.enabled) {
        return res.status(503).json({ 
          error: 'Backbone not enabled' 
        });
      }

      const { callsign } = req.body;

      if (!callsign) {
        return res.status(400).json({ 
          error: 'Missing required field: callsign' 
        });
      }

      const internetTransport = backboneManager.transports.get('internet');
      if (!internetTransport) {
        return res.status(400).json({ 
          error: 'Internet transport not available' 
        });
      }

      internetTransport.removePeer(callsign);

      res.json({ 
        success: true,
        message: `Peer ${callsign} removed`
      });
    } catch (error) {
      console.error('[Backbone API] Error removing peer:', error);
      res.status(500).json({ 
        error: 'Failed to remove peer',
        message: error.message 
      });
    }
  });

  return router;
};
