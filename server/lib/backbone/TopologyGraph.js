/**
 * TopologyGraph.js
 * Network topology graph for routing calculations
 * 
 * Represents the network as a directed graph where:
 * - Nodes (vertices) = Backbone nodes (callsigns)
 * - Edges = Links between nodes with properties (cost, quality, transport)
 */

class TopologyGraph {
  constructor() {
    // Nodes: Map of callsign -> node data
    this.nodes = new Map();
    
    // Edges: Map of "source:destination" -> edge data
    this.edges = new Map();
    
    // Adjacency list for efficient path finding
    // Map of callsign -> Set of neighbor callsigns
    this.adjacency = new Map();
  }

  /**
   * Add a node to the graph
   * @param {String} callsign - Node callsign
   * @param {Object} data - Node data (services, capabilities, etc.)
   */
  addNode(callsign, data = {}) {
    if (!this.nodes.has(callsign)) {
      this.nodes.set(callsign, {
        callsign,
        ...data,
        addedAt: Date.now()
      });
      this.adjacency.set(callsign, new Set());
    } else {
      // Update existing node data
      const node = this.nodes.get(callsign);
      Object.assign(node, data);
    }
  }

  /**
   * Remove a node from the graph
   * @param {String} callsign - Node callsign
   */
  removeNode(callsign) {
    if (!this.nodes.has(callsign)) {
      return;
    }

    // Remove all edges involving this node
    for (const neighbor of this.adjacency.get(callsign)) {
      this.removeEdge(callsign, neighbor);
      this.removeEdge(neighbor, callsign);
    }

    this.nodes.delete(callsign);
    this.adjacency.delete(callsign);
  }

  /**
   * Add a directed edge between nodes
   * @param {String} source - Source node callsign
   * @param {String} destination - Destination node callsign
   * @param {Object} properties - Edge properties
   * @param {String} properties.transport - Transport type ('rf' or 'internet')
   * @param {Number} properties.cost - Link cost (lower is better)
   * @param {Number} properties.quality - Link quality (0-100, higher is better)
   * @param {Number} properties.bandwidth - Estimated bandwidth (bytes/sec)
   * @param {Number} properties.latency - Estimated latency (ms)
   */
  addEdge(source, destination, properties = {}) {
    // Ensure nodes exist
    if (!this.nodes.has(source)) {
      this.addNode(source);
    }
    if (!this.nodes.has(destination)) {
      this.addNode(destination);
    }

    const edgeKey = `${source}:${destination}`;
    const edge = {
      source,
      destination,
      transport: properties.transport || 'unknown',
      cost: properties.cost || 10,
      quality: properties.quality || 50,
      bandwidth: properties.bandwidth || 1000,
      latency: properties.latency || 100,
      lastUpdate: Date.now()
    };

    this.edges.set(edgeKey, edge);
    this.adjacency.get(source).add(destination);
  }

  /**
   * Remove an edge
   * @param {String} source - Source node callsign
   * @param {String} destination - Destination node callsign
   */
  removeEdge(source, destination) {
    const edgeKey = `${source}:${destination}`;
    this.edges.delete(edgeKey);
    
    if (this.adjacency.has(source)) {
      this.adjacency.get(source).delete(destination);
    }
  }

  /**
   * Get edge between two nodes
   * @param {String} source - Source node callsign
   * @param {String} destination - Destination node callsign
   * @returns {Object|null} Edge data or null
   */
  getEdge(source, destination) {
    const edgeKey = `${source}:${destination}`;
    return this.edges.get(edgeKey) || null;
  }

  /**
   * Get all neighbors of a node
   * @param {String} callsign - Node callsign
   * @returns {Array} Array of neighbor callsigns
   */
  getNeighbors(callsign) {
    if (!this.adjacency.has(callsign)) {
      return [];
    }
    return Array.from(this.adjacency.get(callsign));
  }

  /**
   * Get all nodes
   * @returns {Array} Array of node callsigns
   */
  getNodes() {
    return Array.from(this.nodes.keys());
  }

  /**
   * Get node count
   * @returns {Number} Number of nodes
   */
  getNodeCount() {
    return this.nodes.size;
  }

  /**
   * Get edge count
   * @returns {Number} Number of edges
   */
  getEdgeCount() {
    return this.edges.size;
  }

  /**
   * Check if node exists
   * @param {String} callsign - Node callsign
   * @returns {Boolean} True if node exists
   */
  hasNode(callsign) {
    return this.nodes.has(callsign);
  }

  /**
   * Check if edge exists
   * @param {String} source - Source node callsign
   * @param {String} destination - Destination node callsign
   * @returns {Boolean} True if edge exists
   */
  hasEdge(source, destination) {
    const edgeKey = `${source}:${destination}`;
    return this.edges.has(edgeKey);
  }

  /**
   * Update topology from neighbor table
   * @param {String} localCallsign - Local node callsign
   * @param {NeighborTable} neighborTable - Neighbor table instance
   */
  updateFromNeighborTable(localCallsign, neighborTable) {
    // Ensure local node exists
    this.addNode(localCallsign);

    // Get all neighbors
    const neighbors = neighborTable.getAll();

    // Add/update edges from local node to each neighbor
    for (const [callsign, neighbor] of neighbors) {
      this.addNode(callsign, {
        services: neighbor.services,
        capabilities: neighbor.capabilities
      });

      // Create edge for each transport
      for (const [transportId, transportData] of neighbor.transports) {
        this.addEdge(localCallsign, callsign, {
          transport: transportId,
          cost: transportData.cost,
          quality: this._calculateQuality(transportData.metrics),
          bandwidth: transportData.metrics.bandwidth || 1000,
          latency: transportData.metrics.latency || 100
        });
      }
    }

    // Remove nodes that are no longer neighbors
    const currentNeighbors = new Set(neighbors.keys());
    const graphNeighbors = this.getNeighbors(localCallsign);
    
    for (const neighbor of graphNeighbors) {
      if (!currentNeighbors.has(neighbor)) {
        this.removeEdge(localCallsign, neighbor);
      }
    }
  }

  /**
   * Calculate link quality from metrics
   * @private
   * @param {Object} metrics - Link metrics
   * @returns {Number} Quality score (0-100)
   */
  _calculateQuality(metrics) {
    let quality = 100;

    // Reduce quality based on packet loss
    if (metrics.packetLoss) {
      quality -= metrics.packetLoss * 100; // 100% loss = 0 quality
    }

    // Reduce quality based on SNR (for RF)
    if (metrics.snr !== undefined) {
      if (metrics.snr < 10) {
        quality -= (10 - metrics.snr) * 5; // Poor SNR reduces quality
      }
    }

    // Reduce quality based on latency
    if (metrics.latency > 1000) {
      quality -= (metrics.latency - 1000) / 100; // High latency reduces quality
    }

    return Math.max(0, Math.min(100, quality));
  }

  /**
   * Build topology from link-state advertisements
   * @param {Map} linkStateDB - Link-state database (callsign -> LSA)
   */
  buildFromLinkState(linkStateDB) {
    // Clear current graph
    this.clear();

    // Add all nodes and edges from LSAs
    for (const [callsign, lsa] of linkStateDB) {
      this.addNode(callsign, {
        services: lsa.services || [],
        capabilities: lsa.capabilities || {}
      });

      // Add edges from this node to its neighbors
      if (lsa.links) {
        for (const link of lsa.links) {
          this.addEdge(callsign, link.neighbor, {
            transport: link.transport,
            cost: link.cost,
            quality: link.quality || 50,
            bandwidth: link.bandwidth || 1000,
            latency: link.latency || 100
          });
        }
      }
    }
  }

  /**
   * Clear the graph
   */
  clear() {
    this.nodes.clear();
    this.edges.clear();
    this.adjacency.clear();
  }

  /**
   * Export graph to JSON for debugging/visualization
   * @returns {Object} Graph data
   */
  toJSON() {
    return {
      nodes: Array.from(this.nodes.entries()).map(([callsign, data]) => ({
        id: callsign,
        ...data
      })),
      edges: Array.from(this.edges.values()),
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size
    };
  }

  /**
   * Get graph statistics
   * @returns {Object} Statistics
   */
  getStats() {
    let totalCost = 0;
    let minCost = Infinity;
    let maxCost = 0;
    const transportCounts = {};

    for (const edge of this.edges.values()) {
      totalCost += edge.cost;
      minCost = Math.min(minCost, edge.cost);
      maxCost = Math.max(maxCost, edge.cost);
      transportCounts[edge.transport] = (transportCounts[edge.transport] || 0) + 1;
    }

    return {
      nodes: this.nodes.size,
      edges: this.edges.size,
      avgCost: this.edges.size > 0 ? totalCost / this.edges.size : 0,
      minCost: minCost === Infinity ? 0 : minCost,
      maxCost,
      transports: transportCounts
    };
  }

  /**
   * Find all nodes offering a specific service
   * @param {String} service - Service name
   * @returns {Array} Array of node callsigns
   */
  findNodesWithService(service) {
    const result = [];
    for (const [callsign, node] of this.nodes) {
      if (node.services && node.services.includes(service)) {
        result.push(callsign);
      }
    }
    return result;
  }

  /**
   * Check if there's a path between two nodes (simple reachability)
   * @param {String} source - Source node
   * @param {String} destination - Destination node
   * @returns {Boolean} True if path exists
   */
  hasPath(source, destination) {
    if (!this.hasNode(source) || !this.hasNode(destination)) {
      return false;
    }

    if (source === destination) {
      return true;
    }

    // BFS to check reachability
    const visited = new Set();
    const queue = [source];
    visited.add(source);

    while (queue.length > 0) {
      const current = queue.shift();
      
      if (current === destination) {
        return true;
      }

      for (const neighbor of this.getNeighbors(current)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    return false;
  }
}

module.exports = TopologyGraph;
