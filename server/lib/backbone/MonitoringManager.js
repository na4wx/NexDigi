/**
 * MonitoringManager.js
 * 
 * Collects and manages metrics for backbone network monitoring:
 * - Node health tracking (uptime, status, last seen)
 * - Throughput metrics (packets sent/received, bytes transferred)
 * - Latency measurements (round-trip time, hop delays)
 * - Packet loss tracking
 * - Route quality metrics
 * - Historical data aggregation
 */

const EventEmitter = require('events');

class MonitoringManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.localCallsign = options.localCallsign || 'NOCALL';
    this.backboneManager = options.backboneManager;
    
    // Node health tracking
    this.nodeHealth = new Map(); // callsign -> { status, lastSeen, uptime, pingLatency, packetLoss }
    this.healthCheckInterval = options.healthCheckInterval || 30000; // 30 seconds
    
    // Throughput metrics
    this.throughput = {
      packets: { sent: 0, received: 0, forwarded: 0 },
      bytes: { sent: 0, received: 0, forwarded: 0 },
      perNode: new Map() // callsign -> { packets, bytes }
    };
    
    // Latency tracking
    this.latencyMeasurements = new Map(); // callsign -> [latencies]
    this.maxLatencySamples = options.maxLatencySamples || 100;
    
    // Packet loss tracking
    this.packetLoss = new Map(); // callsign -> { sent, received, lost, lossRate }
    
    // Route quality metrics
    this.routeQuality = new Map(); // route -> { reliability, avgLatency, hopCount, lastUsed }
    
    // Historical data (5-minute intervals)
    this.historicalData = [];
    this.maxHistoricalPoints = options.maxHistoricalPoints || 288; // 24 hours
    this.aggregationInterval = options.aggregationInterval || 300000; // 5 minutes
    
    // Active pings
    this.activePings = new Map(); // pingId -> { target, sentAt, timeout }
    
    // Alerts
    this.alerts = [];
    this.maxAlerts = options.maxAlerts || 100;
    
    // Statistics
    this.stats = {
      healthChecks: 0,
      latencyMeasurements: 0,
      alertsGenerated: 0,
      dataPointsAggregated: 0
    };
    
    // Start background tasks
    this.healthCheckTimer = setInterval(() => this.performHealthChecks(), this.healthCheckInterval);
    this.aggregationTimer = setInterval(() => this.aggregateData(), this.aggregationInterval);
  }
  
  /**
   * Record packet sent
   */
  recordPacketSent(destination, size) {
    this.throughput.packets.sent++;
    this.throughput.bytes.sent += size;
    
    // Per-node tracking
    if (!this.throughput.perNode.has(destination)) {
      this.throughput.perNode.set(destination, {
        packets: { sent: 0, received: 0 },
        bytes: { sent: 0, received: 0 }
      });
    }
    
    const nodeMetrics = this.throughput.perNode.get(destination);
    nodeMetrics.packets.sent++;
    nodeMetrics.bytes.sent += size;
    
    // Track for packet loss
    if (!this.packetLoss.has(destination)) {
      this.packetLoss.set(destination, { sent: 0, received: 0, lost: 0, lossRate: 0 });
    }
    this.packetLoss.get(destination).sent++;
    
    this.emit('packet-sent', { destination, size });
  }
  
  /**
   * Record packet received
   */
  recordPacketReceived(source, size) {
    this.throughput.packets.received++;
    this.throughput.bytes.received += size;
    
    // Per-node tracking
    if (!this.throughput.perNode.has(source)) {
      this.throughput.perNode.set(source, {
        packets: { sent: 0, received: 0 },
        bytes: { sent: 0, received: 0 }
      });
    }
    
    const nodeMetrics = this.throughput.perNode.get(source);
    nodeMetrics.packets.received++;
    nodeMetrics.bytes.received += size;
    
    // Update node health
    this.updateNodeHealth(source, 'active');
    
    // Track for packet loss
    if (!this.packetLoss.has(source)) {
      this.packetLoss.set(source, { sent: 0, received: 0, lost: 0, lossRate: 0 });
    }
    this.packetLoss.get(source).received++;
    
    this.emit('packet-received', { source, size });
  }
  
  /**
   * Record packet forwarded
   */
  recordPacketForwarded(size) {
    this.throughput.packets.forwarded++;
    this.throughput.bytes.forwarded += size;
    
    this.emit('packet-forwarded', { size });
  }
  
  /**
   * Update node health status
   */
  updateNodeHealth(callsign, status = 'active') {
    const now = Date.now();
    
    if (!this.nodeHealth.has(callsign)) {
      this.nodeHealth.set(callsign, {
        status,
        firstSeen: now,
        lastSeen: now,
        uptime: 0,
        pingLatency: null,
        packetLoss: 0,
        consecutiveFailures: 0
      });
    } else {
      const health = this.nodeHealth.get(callsign);
      health.status = status;
      health.lastSeen = now;
      health.uptime = now - health.firstSeen;
      
      if (status === 'active') {
        health.consecutiveFailures = 0;
      }
    }
    
    this.emit('node-health-updated', { callsign, status });
  }
  
  /**
   * Measure latency to a node
   */
  async measureLatency(callsign) {
    const pingId = `${this.localCallsign}-${callsign}-${Date.now()}`;
    const sentAt = Date.now();
    
    // Store active ping
    this.activePings.set(pingId, {
      target: callsign,
      sentAt,
      timeout: setTimeout(() => {
        this.handlePingTimeout(pingId);
      }, 5000) // 5 second timeout
    });
    
    // Send ping
    if (this.backboneManager) {
      this.backboneManager.sendData(callsign, {
        type: 'ping',
        pingId,
        timestamp: sentAt
      });
    }
    
    return pingId;
  }
  
  /**
   * Handle ping response
   */
  handlePingResponse(pingId, source) {
    const ping = this.activePings.get(pingId);
    
    if (!ping) {
      return; // Unknown or expired ping
    }
    
    const latency = Date.now() - ping.sentAt;
    
    // Clear timeout
    clearTimeout(ping.timeout);
    this.activePings.delete(pingId);
    
    // Record latency
    this.recordLatency(source, latency);
    
    // Ensure node health exists and update with latency
    this.updateNodeHealth(source, 'active');
    const health = this.nodeHealth.get(source);
    if (health) {
      health.pingLatency = latency;
    }
    
    this.emit('ping-response', { source, latency, pingId });
  }
  
  /**
   * Handle ping timeout
   */
  handlePingTimeout(pingId) {
    const ping = this.activePings.get(pingId);
    
    if (!ping) {
      return;
    }
    
    this.activePings.delete(pingId);
    
    // Update node health
    const health = this.nodeHealth.get(ping.target);
    if (health) {
      health.consecutiveFailures++;
      
      if (health.consecutiveFailures >= 3) {
        health.status = 'unreachable';
        this.generateAlert('node-unreachable', {
          node: ping.target,
          consecutiveFailures: health.consecutiveFailures
        });
      }
    }
    
    this.emit('ping-timeout', { target: ping.target, pingId });
  }
  
  /**
   * Record latency measurement
   */
  recordLatency(callsign, latency) {
    if (!this.latencyMeasurements.has(callsign)) {
      this.latencyMeasurements.set(callsign, []);
    }
    
    const measurements = this.latencyMeasurements.get(callsign);
    measurements.push({ timestamp: Date.now(), latency });
    
    // Keep only recent measurements
    if (measurements.length > this.maxLatencySamples) {
      measurements.shift();
    }
    
    this.stats.latencyMeasurements++;
    
    // Check for high latency
    if (latency > 1000) { // > 1 second
      this.generateAlert('high-latency', {
        node: callsign,
        latency,
        threshold: 1000
      });
    }
  }
  
  /**
   * Calculate average latency for a node
   */
  getAverageLatency(callsign) {
    const measurements = this.latencyMeasurements.get(callsign);
    
    if (!measurements || measurements.length === 0) {
      return null;
    }
    
    const sum = measurements.reduce((acc, m) => acc + m.latency, 0);
    return sum / measurements.length;
  }
  
  /**
   * Calculate packet loss rate for a node
   */
  calculatePacketLoss(callsign) {
    const loss = this.packetLoss.get(callsign);
    
    if (!loss || loss.sent === 0) {
      return 0;
    }
    
    // Simple calculation: lost = sent - received
    // Note: This is approximate as received counts packets from node, not acks
    loss.lost = Math.max(0, loss.sent - loss.received);
    loss.lossRate = (loss.lost / loss.sent) * 100;
    
    return loss.lossRate;
  }
  
  /**
   * Perform health checks on all nodes
   */
  async performHealthChecks() {
    const now = Date.now();
    
    for (const [callsign, health] of this.nodeHealth.entries()) {
      const timeSinceLastSeen = now - health.lastSeen;
      
      // Mark as stale if not seen for 2 minutes
      if (timeSinceLastSeen > 120000 && health.status === 'active') {
        health.status = 'stale';
        this.generateAlert('node-stale', {
          node: callsign,
          timeSinceLastSeen
        });
      }
      
      // Mark as down if not seen for 5 minutes
      if (timeSinceLastSeen > 300000 && health.status !== 'down') {
        health.status = 'down';
        this.generateAlert('node-down', {
          node: callsign,
          timeSinceLastSeen
        });
      }
      
      // Ping active nodes
      if (health.status === 'active' || health.status === 'stale') {
        await this.measureLatency(callsign);
      }
      
      // Calculate packet loss
      health.packetLoss = this.calculatePacketLoss(callsign);
      
      // Alert on high packet loss
      if (health.packetLoss > 10) { // > 10%
        this.generateAlert('high-packet-loss', {
          node: callsign,
          packetLoss: health.packetLoss,
          threshold: 10
        });
      }
    }
    
    this.stats.healthChecks++;
    this.emit('health-check-complete');
  }
  
  /**
   * Aggregate data into historical snapshot
   */
  aggregateData() {
    const snapshot = {
      timestamp: Date.now(),
      throughput: {
        packetsPerSecond: this.throughput.packets.received / (this.aggregationInterval / 1000),
        bytesPerSecond: this.throughput.bytes.received / (this.aggregationInterval / 1000)
      },
      nodes: {
        total: this.nodeHealth.size,
        active: 0,
        stale: 0,
        down: 0,
        unreachable: 0
      },
      averageLatency: 0,
      packetLoss: 0
    };
    
    // Count node statuses
    let latencySum = 0;
    let latencyCount = 0;
    let lossSum = 0;
    let lossCount = 0;
    
    for (const [callsign, health] of this.nodeHealth.entries()) {
      snapshot.nodes[health.status]++;
      
      const avgLatency = this.getAverageLatency(callsign);
      if (avgLatency !== null) {
        latencySum += avgLatency;
        latencyCount++;
      }
      
      if (health.packetLoss > 0) {
        lossSum += health.packetLoss;
        lossCount++;
      }
    }
    
    snapshot.averageLatency = latencyCount > 0 ? latencySum / latencyCount : 0;
    snapshot.packetLoss = lossCount > 0 ? lossSum / lossCount : 0;
    
    // Add to historical data
    this.historicalData.push(snapshot);
    
    // Keep only recent history
    if (this.historicalData.length > this.maxHistoricalPoints) {
      this.historicalData.shift();
    }
    
    this.stats.dataPointsAggregated++;
    this.emit('data-aggregated', snapshot);
  }
  
  /**
   * Generate an alert
   */
  generateAlert(type, data) {
    const alert = {
      id: `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      severity: this.getAlertSeverity(type),
      timestamp: Date.now(),
      data,
      acknowledged: false
    };
    
    this.alerts.unshift(alert);
    
    // Keep only recent alerts
    if (this.alerts.length > this.maxAlerts) {
      this.alerts.pop();
    }
    
    this.stats.alertsGenerated++;
    this.emit('alert', alert);
    
    return alert;
  }
  
  /**
   * Get alert severity level
   */
  getAlertSeverity(type) {
    const severityMap = {
      'node-down': 'critical',
      'node-unreachable': 'critical',
      'high-packet-loss': 'warning',
      'high-latency': 'warning',
      'node-stale': 'info'
    };
    
    return severityMap[type] || 'info';
  }
  
  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId) {
    const alert = this.alerts.find(a => a.id === alertId);
    
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedAt = Date.now();
      this.emit('alert-acknowledged', alert);
      return true;
    }
    
    return false;
  }
  
  /**
   * Get current metrics summary
   */
  getMetrics() {
    const nodes = Array.from(this.nodeHealth.entries()).map(([callsign, health]) => ({
      callsign,
      status: health.status,
      lastSeen: health.lastSeen,
      uptime: health.uptime,
      pingLatency: health.pingLatency,
      packetLoss: health.packetLoss,
      avgLatency: this.getAverageLatency(callsign)
    }));
    
    return {
      timestamp: Date.now(),
      throughput: this.throughput,
      nodes,
      nodeCount: {
        total: this.nodeHealth.size,
        active: nodes.filter(n => n.status === 'active').length,
        stale: nodes.filter(n => n.status === 'stale').length,
        down: nodes.filter(n => n.status === 'down').length,
        unreachable: nodes.filter(n => n.status === 'unreachable').length
      },
      alerts: this.alerts.filter(a => !a.acknowledged).slice(0, 10),
      stats: this.stats
    };
  }
  
  /**
   * Get historical data
   */
  getHistoricalData(startTime, endTime) {
    let data = this.historicalData;
    
    if (startTime) {
      data = data.filter(d => d.timestamp >= startTime);
    }
    
    if (endTime) {
      data = data.filter(d => d.timestamp <= endTime);
    }
    
    return data;
  }
  
  /**
   * Get node health details
   */
  getNodeHealth(callsign) {
    const health = this.nodeHealth.get(callsign);
    
    if (!health) {
      return null;
    }
    
    // Calculate current packet loss
    const currentPacketLoss = this.calculatePacketLoss(callsign);
    
    return {
      callsign,
      ...health,
      packetLoss: currentPacketLoss,
      avgLatency: this.getAverageLatency(callsign),
      latencyHistory: this.latencyMeasurements.get(callsign) || [],
      packetStats: this.throughput.perNode.get(callsign) || null
    };
  }
  
  /**
   * Get all alerts
   */
  getAlerts(filter = {}) {
    let alerts = this.alerts;
    
    if (filter.unacknowledged) {
      alerts = alerts.filter(a => !a.acknowledged);
    }
    
    if (filter.severity) {
      alerts = alerts.filter(a => a.severity === filter.severity);
    }
    
    if (filter.type) {
      alerts = alerts.filter(a => a.type === filter.type);
    }
    
    return alerts;
  }
  
  /**
   * Reset metrics
   */
  resetMetrics() {
    this.throughput = {
      packets: { sent: 0, received: 0, forwarded: 0 },
      bytes: { sent: 0, received: 0, forwarded: 0 },
      perNode: new Map()
    };
    
    this.emit('metrics-reset');
  }
  
  /**
   * Shutdown
   */
  shutdown() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    
    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer);
      this.aggregationTimer = null;
    }
    
    // Clear all active ping timeouts
    for (const [pingId, ping] of this.activePings.entries()) {
      clearTimeout(ping.timeout);
    }
    this.activePings.clear();
    
    this.emit('shutdown');
  }
}

module.exports = MonitoringManager;
