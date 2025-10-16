/**
 * LoadBalancer.js
 * 
 * Load balancing for multi-path routing:
 * - Multiple route selection
 * - Weighted distribution based on route quality
 * - Round-robin and least-loaded algorithms
 * - Route health tracking
 * - Automatic failover on route failure
 */

const EventEmitter = require('events');

class LoadBalancer extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.localCallsign = options.localCallsign || 'NOCALL';
    this.routingTable = options.routingTable; // Reference to BackboneManager routing table
    
    // Load balancing algorithm
    this.algorithm = options.algorithm || 'weighted'; // weighted, round-robin, least-loaded
    
    // Route health tracking
    this.routeHealth = new Map(); // routeKey -> { successCount, failureCount, latency, lastUsed }
    
    // Round-robin state
    this.roundRobinIndex = new Map(); // destination -> index
    
    // Statistics
    this.stats = {
      routeSelections: 0,
      failovers: 0,
      routesByAlgorithm: {
        weighted: 0,
        roundRobin: 0,
        leastLoaded: 0
      }
    };
    
    // Failover threshold
    this.failureThreshold = options.failureThreshold || 3;
  }
  
  /**
   * Select best route to destination
   */
  selectRoute(destination, availableRoutes) {
    if (!availableRoutes || availableRoutes.length === 0) {
      return null;
    }
    
    // Single route - no need for selection
    if (availableRoutes.length === 1) {
      return availableRoutes[0];
    }
    
    this.stats.routeSelections++;
    
    let selectedRoute;
    
    switch (this.algorithm) {
      case 'weighted':
        selectedRoute = this.selectWeightedRoute(destination, availableRoutes);
        this.stats.routesByAlgorithm.weighted++;
        break;
        
      case 'round-robin':
        selectedRoute = this.selectRoundRobinRoute(destination, availableRoutes);
        this.stats.routesByAlgorithm.roundRobin++;
        break;
        
      case 'least-loaded':
        selectedRoute = this.selectLeastLoadedRoute(destination, availableRoutes);
        this.stats.routesByAlgorithm.leastLoaded++;
        break;
        
      default:
        selectedRoute = this.selectWeightedRoute(destination, availableRoutes);
        this.stats.routesByAlgorithm.weighted++;
    }
    
    // Update route usage
    if (selectedRoute) {
      this.updateRouteUsage(selectedRoute);
    }
    
    this.emit('route-selected', {
      destination,
      route: selectedRoute,
      algorithm: this.algorithm,
      availableCount: availableRoutes.length
    });
    
    return selectedRoute;
  }
  
  /**
   * Select route using weighted distribution
   */
  selectWeightedRoute(destination, routes) {
    // Calculate weights based on route quality
    const weights = routes.map(route => this.calculateRouteWeight(route));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    
    if (totalWeight === 0) {
      // All routes have zero weight, fall back to first route
      return routes[0];
    }
    
    // Weighted random selection
    let random = Math.random() * totalWeight;
    
    for (let i = 0; i < routes.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return routes[i];
      }
    }
    
    // Fallback to last route
    return routes[routes.length - 1];
  }
  
  /**
   * Calculate route weight based on quality metrics
   */
  calculateRouteWeight(route) {
    const routeKey = this.getRouteKey(route);
    const health = this.routeHealth.get(routeKey);
    
    if (!health) {
      // New route, give it a chance
      return 1.0;
    }
    
    // Base weight from success rate
    const totalAttempts = health.successCount + health.failureCount;
    const successRate = totalAttempts > 0 ? health.successCount / totalAttempts : 0.5;
    
    // Penalize high latency
    const latencyFactor = health.latency > 0 ? 1000 / health.latency : 1.0;
    
    // Penalize recent failures
    const failurePenalty = Math.max(0, 1 - (health.failureCount * 0.2));
    
    // Combined weight
    const weight = successRate * latencyFactor * failurePenalty;
    
    return Math.max(0.01, weight); // Minimum weight of 0.01
  }
  
  /**
   * Select route using round-robin
   */
  selectRoundRobinRoute(destination, routes) {
    // Get current index for destination
    let index = this.roundRobinIndex.get(destination) || 0;
    
    // Select route
    const route = routes[index];
    
    // Update index
    index = (index + 1) % routes.length;
    this.roundRobinIndex.set(destination, index);
    
    return route;
  }
  
  /**
   * Select least loaded route
   */
  selectLeastLoadedRoute(destination, routes) {
    let bestRoute = routes[0];
    let leastLoad = Infinity;
    
    for (const route of routes) {
      const routeKey = this.getRouteKey(route);
      const health = this.routeHealth.get(routeKey);
      
      // Calculate load (recent usage frequency)
      const load = health ? this.calculateRouteLoad(health) : 0;
      
      if (load < leastLoad) {
        leastLoad = load;
        bestRoute = route;
      }
    }
    
    return bestRoute;
  }
  
  /**
   * Calculate current load on a route
   */
  calculateRouteLoad(health) {
    const now = Date.now();
    const timeSinceLastUse = now - (health.lastUsed || now);
    
    // Load decreases over time
    const baseLoad = health.successCount + health.failureCount;
    const timeDecay = Math.exp(-timeSinceLastUse / 60000); // Decay over 1 minute
    
    return baseLoad * timeDecay;
  }
  
  /**
   * Update route usage statistics
   */
  updateRouteUsage(route) {
    const routeKey = this.getRouteKey(route);
    
    if (!this.routeHealth.has(routeKey)) {
      this.routeHealth.set(routeKey, {
        successCount: 0,
        failureCount: 0,
        latency: 0,
        lastUsed: Date.now()
      });
    }
    
    const health = this.routeHealth.get(routeKey);
    health.lastUsed = Date.now();
  }
  
  /**
   * Record successful transmission on route
   */
  recordSuccess(route, latency = 0) {
    const routeKey = this.getRouteKey(route);
    
    if (!this.routeHealth.has(routeKey)) {
      this.routeHealth.set(routeKey, {
        successCount: 0,
        failureCount: 0,
        latency: 0,
        lastUsed: Date.now()
      });
    }
    
    const health = this.routeHealth.get(routeKey);
    health.successCount++;
    
    // Update average latency
    if (latency > 0) {
      if (health.latency === 0) {
        health.latency = latency;
      } else {
        // Exponential moving average
        health.latency = health.latency * 0.8 + latency * 0.2;
      }
    }
    
    this.emit('route-success', {
      route: routeKey,
      successCount: health.successCount,
      latency: health.latency
    });
  }
  
  /**
   * Record failed transmission on route
   */
  recordFailure(route, reason = 'unknown') {
    const routeKey = this.getRouteKey(route);
    
    if (!this.routeHealth.has(routeKey)) {
      this.routeHealth.set(routeKey, {
        successCount: 0,
        failureCount: 0,
        latency: 0,
        lastUsed: Date.now()
      });
    }
    
    const health = this.routeHealth.get(routeKey);
    health.failureCount++;
    
    // Check if route should be marked as failed
    if (health.failureCount >= this.failureThreshold) {
      this.emit('route-failed', {
        route: routeKey,
        failureCount: health.failureCount,
        reason
      });
    }
    
    this.emit('route-failure', {
      route: routeKey,
      failureCount: health.failureCount,
      reason
    });
  }
  
  /**
   * Attempt failover to alternate route
   */
  failover(destination, failedRoute, availableRoutes) {
    // Remove failed route from available routes
    const alternateRoutes = availableRoutes.filter(r => 
      this.getRouteKey(r) !== this.getRouteKey(failedRoute)
    );
    
    if (alternateRoutes.length === 0) {
      this.emit('failover-failed', {
        destination,
        failedRoute: this.getRouteKey(failedRoute),
        reason: 'no-alternate-routes'
      });
      return null;
    }
    
    // Select alternate route
    const alternateRoute = this.selectRoute(destination, alternateRoutes);
    
    this.stats.failovers++;
    
    this.emit('failover-success', {
      destination,
      failedRoute: this.getRouteKey(failedRoute),
      alternateRoute: this.getRouteKey(alternateRoute)
    });
    
    return alternateRoute;
  }
  
  /**
   * Get route key for tracking
   */
  getRouteKey(route) {
    if (typeof route === 'string') {
      return route;
    }
    
    if (route.nextHop) {
      return `${route.destination}-via-${route.nextHop}`;
    }
    
    return route.destination || JSON.stringify(route);
  }
  
  /**
   * Get route health information
   */
  getRouteHealth(route) {
    const routeKey = this.getRouteKey(route);
    const health = this.routeHealth.get(routeKey);
    
    if (!health) {
      return null;
    }
    
    const totalAttempts = health.successCount + health.failureCount;
    const successRate = totalAttempts > 0 ? 
      (health.successCount / totalAttempts) * 100 : 0;
    
    return {
      route: routeKey,
      successCount: health.successCount,
      failureCount: health.failureCount,
      successRate: successRate.toFixed(2),
      averageLatency: Math.round(health.latency),
      lastUsed: health.lastUsed,
      weight: this.calculateRouteWeight(route)
    };
  }
  
  /**
   * Get all route health information
   */
  getAllRouteHealth() {
    const health = [];
    
    for (const [routeKey, routeHealth] of this.routeHealth.entries()) {
      const totalAttempts = routeHealth.successCount + routeHealth.failureCount;
      const successRate = totalAttempts > 0 ?
        (routeHealth.successCount / totalAttempts) * 100 : 0;
      
      health.push({
        route: routeKey,
        successCount: routeHealth.successCount,
        failureCount: routeHealth.failureCount,
        successRate: successRate.toFixed(2),
        averageLatency: Math.round(routeHealth.latency),
        lastUsed: routeHealth.lastUsed
      });
    }
    
    return health;
  }
  
  /**
   * Set load balancing algorithm
   */
  setAlgorithm(algorithm) {
    const validAlgorithms = ['weighted', 'round-robin', 'least-loaded'];
    
    if (!validAlgorithms.includes(algorithm)) {
      throw new Error(`Invalid algorithm: ${algorithm}`);
    }
    
    this.algorithm = algorithm;
    this.emit('algorithm-changed', { algorithm });
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      algorithm: this.algorithm,
      routesTracked: this.routeHealth.size,
      routeHealth: this.getAllRouteHealth()
    };
  }
  
  /**
   * Reset route health tracking
   */
  resetRouteHealth() {
    this.routeHealth.clear();
    this.roundRobinIndex.clear();
    this.emit('route-health-reset');
  }
  
  /**
   * Shutdown
   */
  shutdown() {
    this.resetRouteHealth();
    this.emit('shutdown');
  }
}

module.exports = LoadBalancer;
