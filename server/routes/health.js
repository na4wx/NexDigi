/**
 * System health and monitoring routes
 */

const express = require('express');
const os = require('os');

module.exports = function(dependencies) {
  const router = express.Router();
  const { manager } = dependencies;
  
  // Server start time for uptime calculation
  const serverStartTime = Date.now();
  
  /**
   * GET /api/health
   * Health check endpoint for monitoring and Docker HEALTHCHECK
   */
  router.get('/health', (req, res) => {
    try {
      const channels = manager.listChannels();
      const connectedChannels = channels.filter(ch => ch.status === 'connected').length;
      const errorChannels = channels.filter(ch => ch.status === 'error').length;
      
      // Determine overall health status
      let status = 'healthy';
      let issues = [];
      
      if (errorChannels > 0) {
        status = 'degraded';
        issues.push(`${errorChannels} channel(s) in error state`);
      }
      
      if (connectedChannels === 0 && channels.length > 0) {
        status = 'unhealthy';
        issues.push('No channels connected');
      }
      
      // Memory usage
      const memUsage = process.memoryUsage();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const memPercent = ((memUsage.rss / totalMem) * 100).toFixed(2);
      
      if (parseFloat(memPercent) > 90) {
        status = 'degraded';
        issues.push('High memory usage');
      }
      
      // Uptime
      const uptime = Date.now() - serverStartTime;
      
      const health = {
        status,
        timestamp: new Date().toISOString(),
        uptime: {
          ms: uptime,
          seconds: Math.floor(uptime / 1000),
          formatted: formatUptime(uptime)
        },
        channels: {
          total: channels.length,
          connected: connectedChannels,
          error: errorChannels,
          disconnected: channels.length - connectedChannels - errorChannels
        },
        memory: {
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
          rss: memUsage.rss,
          external: memUsage.external,
          percentUsed: memPercent
        },
        system: {
          platform: os.platform(),
          arch: os.arch(),
          hostname: os.hostname(),
          totalMemory: totalMem,
          freeMemory: freeMem,
          cpus: os.cpus().length,
          loadAverage: os.loadavg()
        },
        issues: issues.length > 0 ? issues : null
      };
      
      // Return appropriate HTTP status code
      const statusCode = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503;
      
      res.status(statusCode).json(health);
      
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });
  
  /**
   * GET /api/health/liveness
   * Simple liveness probe (is the server running?)
   */
  router.get('/health/liveness', (req, res) => {
    res.status(200).json({
      status: 'alive',
      timestamp: new Date().toISOString()
    });
  });
  
  /**
   * GET /api/health/readiness
   * Readiness probe (is the server ready to accept requests?)
   */
  router.get('/health/readiness', (req, res) => {
    try {
      const channels = manager.listChannels();
      const hasChannels = channels.length > 0;
      const hasConnected = channels.some(ch => ch.status === 'connected');
      
      // Server is ready if:
      // 1. It has no channels configured (testing), OR
      // 2. It has at least one connected channel
      const ready = !hasChannels || hasConnected;
      
      if (ready) {
        res.status(200).json({
          status: 'ready',
          timestamp: new Date().toISOString(),
          channels: {
            total: channels.length,
            connected: channels.filter(ch => ch.status === 'connected').length
          }
        });
      } else {
        res.status(503).json({
          status: 'not ready',
          reason: 'No channels connected',
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      res.status(503).json({
        status: 'not ready',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });
  
  /**
   * GET /api/health/metrics
   * Detailed metrics for monitoring systems (Prometheus-style)
   */
  router.get('/health/metrics', (req, res) => {
    try {
      const channels = manager.listChannels();
      const memUsage = process.memoryUsage();
      const uptime = Date.now() - serverStartTime;
      
      // Calculate aggregate stats
      let totalRx = 0;
      let totalTx = 0;
      let totalErrors = 0;
      
      channels.forEach(ch => {
        if (ch.stats) {
          totalRx += ch.stats.received || 0;
          totalTx += ch.stats.transmitted || 0;
          totalErrors += ch.stats.errors || 0;
        }
      });
      
      const metrics = {
        // Server metrics
        nexdigi_uptime_seconds: Math.floor(uptime / 1000),
        nexdigi_channels_total: channels.length,
        nexdigi_channels_connected: channels.filter(ch => ch.status === 'connected').length,
        nexdigi_channels_error: channels.filter(ch => ch.status === 'error').length,
        
        // Traffic metrics
        nexdigi_frames_received_total: totalRx,
        nexdigi_frames_transmitted_total: totalTx,
        nexdigi_frames_errors_total: totalErrors,
        
        // Memory metrics
        nexdigi_memory_heap_used_bytes: memUsage.heapUsed,
        nexdigi_memory_heap_total_bytes: memUsage.heapTotal,
        nexdigi_memory_rss_bytes: memUsage.rss,
        nexdigi_memory_external_bytes: memUsage.external,
        
        // System metrics
        nexdigi_cpu_count: os.cpus().length,
        nexdigi_system_memory_total_bytes: os.totalmem(),
        nexdigi_system_memory_free_bytes: os.freemem(),
        nexdigi_system_load_1min: os.loadavg()[0],
        nexdigi_system_load_5min: os.loadavg()[1],
        nexdigi_system_load_15min: os.loadavg()[2]
      };
      
      // Return as Prometheus text format if requested
      if (req.accepts('text/plain')) {
        let output = '';
        Object.keys(metrics).forEach(key => {
          output += `${key} ${metrics[key]}\n`;
        });
        res.type('text/plain').send(output);
      } else {
        res.json(metrics);
      }
      
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  });
  
  /**
   * Helper function to format uptime
   */
  function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
  
  return router;
};
