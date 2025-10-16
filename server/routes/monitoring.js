/**
 * monitoring.js
 * 
 * API routes for backbone network monitoring and administration
 */

const express = require('express');
const router = express.Router();

// This will be set by the main server
let monitoringManager = null;
let backboneManager = null;
let bbsSync = null;
let weatherParser = null;
let stationTracker = null;
let aprsDistributor = null;
let securityManager = null;
let nodeAuthenticator = null;

/**
 * Initialize monitoring routes with managers
 */
function initialize(managers) {
  monitoringManager = managers.monitoringManager;
  backboneManager = managers.backboneManager;
  bbsSync = managers.bbsSync;
  weatherParser = managers.weatherParser;
  stationTracker = managers.stationTracker;
  aprsDistributor = managers.aprsDistributor;
  securityManager = managers.securityManager;
  nodeAuthenticator = managers.nodeAuthenticator;
}

/**
 * GET /api/monitoring/metrics
 * Get current metrics summary
 */
router.get('/metrics', (req, res) => {
  if (!monitoringManager) {
    return res.status(503).json({ error: 'Monitoring not initialized' });
  }
  
  try {
    const metrics = monitoringManager.getMetrics();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/monitoring/nodes
 * Get all node health status
 */
router.get('/nodes', (req, res) => {
  if (!monitoringManager) {
    return res.status(503).json({ error: 'Monitoring not initialized' });
  }
  
  try {
    const metrics = monitoringManager.getMetrics();
    res.json({
      nodes: metrics.nodes,
      nodeCount: metrics.nodeCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/monitoring/nodes/:callsign
 * Get detailed health info for a specific node
 */
router.get('/nodes/:callsign', (req, res) => {
  if (!monitoringManager) {
    return res.status(503).json({ error: 'Monitoring not initialized' });
  }
  
  try {
    const health = monitoringManager.getNodeHealth(req.params.callsign);
    
    if (!health) {
      return res.status(404).json({ error: 'Node not found' });
    }
    
    res.json(health);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/monitoring/nodes/:callsign/ping
 * Manually trigger a ping to a node
 */
router.post('/nodes/:callsign/ping', async (req, res) => {
  if (!monitoringManager) {
    return res.status(503).json({ error: 'Monitoring not initialized' });
  }
  
  try {
    const pingId = await monitoringManager.measureLatency(req.params.callsign);
    res.json({ pingId, status: 'sent' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/monitoring/historical
 * Get historical metrics data
 */
router.get('/historical', (req, res) => {
  if (!monitoringManager) {
    return res.status(503).json({ error: 'Monitoring not initialized' });
  }
  
  try {
    const startTime = req.query.start ? parseInt(req.query.start) : null;
    const endTime = req.query.end ? parseInt(req.query.end) : null;
    
    const data = monitoringManager.getHistoricalData(startTime, endTime);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/monitoring/alerts
 * Get alerts
 */
router.get('/alerts', (req, res) => {
  if (!monitoringManager) {
    return res.status(503).json({ error: 'Monitoring not initialized' });
  }
  
  try {
    const filter = {
      unacknowledged: req.query.unacknowledged === 'true',
      severity: req.query.severity,
      type: req.query.type
    };
    
    const alerts = monitoringManager.getAlerts(filter);
    res.json(alerts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/monitoring/alerts/:alertId/acknowledge
 * Acknowledge an alert
 */
router.post('/alerts/:alertId/acknowledge', (req, res) => {
  if (!monitoringManager) {
    return res.status(503).json({ error: 'Monitoring not initialized' });
  }
  
  try {
    const acknowledged = monitoringManager.acknowledgeAlert(req.params.alertId);
    
    if (!acknowledged) {
      return res.status(404).json({ error: 'Alert not found' });
    }
    
    res.json({ status: 'acknowledged' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/monitoring/backbone
 * Get backbone network status
 */
router.get('/backbone', (req, res) => {
  if (!backboneManager) {
    return res.status(503).json({ error: 'Backbone not initialized' });
  }
  
  try {
    const neighbors = backboneManager.getNeighbors();
    const routes = backboneManager.getRoutes ? backboneManager.getRoutes() : [];
    const stats = backboneManager.getStats();
    
    res.json({
      localCallsign: backboneManager.localCallsign,
      neighbors,
      routes,
      stats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/monitoring/bbs
 * Get BBS sync status
 */
router.get('/bbs', (req, res) => {
  if (!bbsSync) {
    return res.status(503).json({ error: 'BBS sync not initialized' });
  }
  
  try {
    const stats = bbsSync.getStats();
    const syncStatus = bbsSync.getSyncStatus ? bbsSync.getSyncStatus() : {};
    
    res.json({
      stats,
      syncStatus
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/monitoring/weather
 * Get weather system status
 */
router.get('/weather', (req, res) => {
  if (!weatherParser || !stationTracker) {
    return res.status(503).json({ error: 'Weather system not initialized' });
  }
  
  try {
    const weatherStats = weatherParser.getStats();
    const trackerStats = stationTracker.getStats();
    const recentBulletins = weatherParser.getRecentBulletins({ limit: 10 });
    
    res.json({
      weatherStats,
      trackerStats,
      recentBulletins
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/monitoring/aprs
 * Get APRS distribution status
 */
router.get('/aprs', (req, res) => {
  if (!aprsDistributor) {
    return res.status(503).json({ error: 'APRS distributor not initialized' });
  }
  
  try {
    const stats = aprsDistributor.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/monitoring/security
 * Get security status
 */
router.get('/security', (req, res) => {
  if (!securityManager || !nodeAuthenticator) {
    return res.status(503).json({ error: 'Security not initialized' });
  }
  
  try {
    const securityStats = securityManager.getStats();
    const authStats = nodeAuthenticator.getStats();
    const trustedNodes = securityManager.getTrustedNodes();
    const authenticatedNodes = nodeAuthenticator.getAuthenticatedNodes();
    
    res.json({
      securityStats,
      authStats,
      trustedNodes: trustedNodes.length,
      authenticatedNodes: authenticatedNodes.length,
      nodes: authenticatedNodes
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/monitoring/system
 * Get system-wide status
 */
router.get('/system', (req, res) => {
  try {
    const status = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      platform: process.platform,
      nodeVersion: process.version,
      components: {
        monitoring: !!monitoringManager,
        backbone: !!backboneManager,
        bbs: !!bbsSync,
        weather: !!weatherParser,
        aprs: !!aprsDistributor,
        security: !!securityManager
      }
    };
    
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/monitoring/reset
 * Reset metrics counters
 */
router.post('/reset', (req, res) => {
  if (!monitoringManager) {
    return res.status(503).json({ error: 'Monitoring not initialized' });
  }
  
  try {
    monitoringManager.resetMetrics();
    res.json({ status: 'reset' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = {
  router,
  initialize
};
