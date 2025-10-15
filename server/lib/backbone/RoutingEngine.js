/**
 * RoutingEngine.js
 * Implements Dijkstra's shortest path algorithm for routing
 * 
 * Calculates optimal paths through the network based on link costs
 * and routing policies.
 */

const EventEmitter = require('events');

class RoutingEngine extends EventEmitter {
  /**
   * Create routing engine
   * @param {Object} config - Configuration
   * @param {String} config.localCallsign - Local node callsign
   * @param {Object} config.policies - Routing policies
   */
  constructor(config = {}) {
    super();
    
    this.localCallsign = config.localCallsign;
    this.policies = config.policies || {};
    
    // Routing table: destination -> { nextHop, cost, path, transport, lastUpdate }
    this.routingTable = new Map();
    
    // Last calculation time
    this.lastCalculation = null;
  }

  /**
   * Calculate routing table using Dijkstra's algorithm
   * @param {TopologyGraph} graph - Network topology graph
   * @returns {Map} Routing table
   */
  calculateRoutes(graph) {
    if (!this.localCallsign || !graph.hasNode(this.localCallsign)) {
      console.warn('[RoutingEngine] Cannot calculate routes: local node not in graph');
      return this.routingTable;
    }

    console.log(`[RoutingEngine] Calculating routes from ${this.localCallsign}...`);

    // Clear old routing table
    this.routingTable.clear();

    // Dijkstra's algorithm
    const distances = new Map(); // node -> shortest distance from source
    const previous = new Map();  // node -> previous node in shortest path
    const unvisited = new Set(graph.getNodes());

    // Initialize distances
    for (const node of graph.getNodes()) {
      distances.set(node, node === this.localCallsign ? 0 : Infinity);
      previous.set(node, null);
    }

    // Main loop
    while (unvisited.size > 0) {
      // Find unvisited node with minimum distance
      let minNode = null;
      let minDist = Infinity;
      
      for (const node of unvisited) {
        const dist = distances.get(node);
        if (dist < minDist) {
          minDist = dist;
          minNode = node;
        }
      }

      // If no reachable nodes left, break
      if (minNode === null || minDist === Infinity) {
        break;
      }

      // Remove from unvisited
      unvisited.delete(minNode);

      // Update distances to neighbors
      const neighbors = graph.getNeighbors(minNode);
      
      for (const neighbor of neighbors) {
        if (!unvisited.has(neighbor)) {
          continue;
        }

        const edge = graph.getEdge(minNode, neighbor);
        if (!edge) {
          continue;
        }

        const altDistance = distances.get(minNode) + edge.cost;
        
        if (altDistance < distances.get(neighbor)) {
          distances.set(neighbor, altDistance);
          previous.set(neighbor, minNode);
        }
      }
    }

    // Build routing table from shortest paths
    for (const [destination, distance] of distances) {
      if (destination === this.localCallsign || distance === Infinity) {
        continue;
      }

      // Reconstruct path
      const path = this._reconstructPath(previous, destination);
      
      if (path.length < 2) {
        continue; // No path or only destination
      }

      // Next hop is the second node in the path (first is local node)
      const nextHop = path[1];
      
      // Get edge to next hop to determine transport
      const edge = graph.getEdge(this.localCallsign, nextHop);
      
      this.routingTable.set(destination, {
        destination,
        nextHop,
        cost: distance,
        path: path,
        transport: edge ? edge.transport : 'unknown',
        hopCount: path.length - 1,
        lastUpdate: Date.now()
      });
    }

    this.lastCalculation = Date.now();
    
    console.log(`[RoutingEngine] Routes calculated: ${this.routingTable.size} destinations reachable`);
    this.emit('routes-updated', this.routingTable);

    return this.routingTable;
  }

  /**
   * Reconstruct path from previous node map
   * @private
   * @param {Map} previous - Previous node map from Dijkstra
   * @param {String} destination - Destination node
   * @returns {Array} Path as array of node callsigns
   */
  _reconstructPath(previous, destination) {
    const path = [];
    let current = destination;

    while (current !== null) {
      path.unshift(current);
      current = previous.get(current);
    }

    return path;
  }

  /**
   * Get route to destination
   * @param {String} destination - Destination callsign
   * @returns {Object|null} Route info or null if no route
   */
  getRoute(destination) {
    return this.routingTable.get(destination) || null;
  }

  /**
   * Get next hop for destination
   * @param {String} destination - Destination callsign
   * @returns {String|null} Next hop callsign or null
   */
  getNextHop(destination) {
    const route = this.routingTable.get(destination);
    return route ? route.nextHop : null;
  }

  /**
   * Get all routes
   * @returns {Array} Array of route objects
   */
  getAllRoutes() {
    return Array.from(this.routingTable.values());
  }

  /**
   * Get routes using specific transport
   * @param {String} transport - Transport ID ('rf' or 'internet')
   * @returns {Array} Array of routes using this transport
   */
  getRoutesByTransport(transport) {
    return this.getAllRoutes().filter(route => route.transport === transport);
  }

  /**
   * Find routes to nodes offering a specific service
   * @param {String} service - Service name
   * @param {TopologyGraph} graph - Network topology
   * @returns {Array} Array of routes to nodes offering this service
   */
  findServiceRoutes(service, graph) {
    const serviceNodes = graph.findNodesWithService(service);
    const routes = [];

    for (const node of serviceNodes) {
      const route = this.getRoute(node);
      if (route) {
        routes.push(route);
      }
    }

    // Sort by cost (closest first)
    routes.sort((a, b) => a.cost - b.cost);

    return routes;
  }

  /**
   * Apply routing policy to select best route
   * @param {String} destination - Destination callsign
   * @param {Object} options - Routing options
   * @param {String} options.messageType - Message type for policy selection
   * @param {Number} options.priority - Message priority
   * @param {String} options.preferredTransport - Preferred transport type
   * @returns {Object|null} Selected route
   */
  selectRoute(destination, options = {}) {
    const route = this.getRoute(destination);
    
    if (!route) {
      return null;
    }

    // Apply policies based on message type
    const policy = this._getPolicy(options.messageType);
    
    // For now, return the calculated route
    // TODO: Implement policy-based route selection in Phase 3.6
    return route;
  }

  /**
   * Get routing policy for message type
   * @private
   * @param {String} messageType - Message type
   * @returns {Object} Policy configuration
   */
  _getPolicy(messageType) {
    return this.policies[messageType] || {
      preferInternet: true,
      maxHops: 10
    };
  }

  /**
   * Check if destination is reachable
   * @param {String} destination - Destination callsign
   * @returns {Boolean} True if route exists
   */
  isReachable(destination) {
    return this.routingTable.has(destination);
  }

  /**
   * Get routing table statistics
   * @returns {Object} Statistics
   */
  getStats() {
    let totalCost = 0;
    let totalHops = 0;
    let minCost = Infinity;
    let maxCost = 0;
    let minHops = Infinity;
    let maxHops = 0;
    const transportCounts = {};

    for (const route of this.routingTable.values()) {
      totalCost += route.cost;
      totalHops += route.hopCount;
      minCost = Math.min(minCost, route.cost);
      maxCost = Math.max(maxCost, route.cost);
      minHops = Math.min(minHops, route.hopCount);
      maxHops = Math.max(maxHops, route.hopCount);
      transportCounts[route.transport] = (transportCounts[route.transport] || 0) + 1;
    }

    const routeCount = this.routingTable.size;

    return {
      routes: routeCount,
      avgCost: routeCount > 0 ? totalCost / routeCount : 0,
      avgHops: routeCount > 0 ? totalHops / routeCount : 0,
      minCost: minCost === Infinity ? 0 : minCost,
      maxCost,
      minHops: minHops === Infinity ? 0 : minHops,
      maxHops,
      transports: transportCounts,
      lastCalculation: this.lastCalculation
    };
  }

  /**
   * Export routing table for debugging
   * @returns {Array} Routing table as array
   */
  toArray() {
    return Array.from(this.routingTable.values()).map(route => ({
      destination: route.destination,
      nextHop: route.nextHop,
      cost: route.cost,
      hops: route.hopCount,
      transport: route.transport,
      path: route.path.join(' → ')
    }));
  }

  /**
   * Clear routing table
   */
  clear() {
    this.routingTable.clear();
    this.lastCalculation = null;
  }
}

module.exports = RoutingEngine;
