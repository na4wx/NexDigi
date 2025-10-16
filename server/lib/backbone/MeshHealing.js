/**
 * MeshHealing.js
 * 
 * Self-healing mesh network capabilities:
 * - Automatic route discovery on link failure
 * - Network topology maintenance
 * - Link state advertisements (LSA)
 * - Dijkstra shortest path calculation
 * - Automatic network reconfiguration
 */

const EventEmitter = require('events');

class MeshHealing extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.localCallsign = options.localCallsign || 'NOCALL';
    this.backboneManager = options.backboneManager;
    
    // Network topology database
    this.topology = new Map(); // nodeId -> { neighbors: Set, links: Map }
    
    // Link state sequence numbers
    this.lsaSequence = 0;
    this.nodeSequences = new Map(); // nodeId -> sequence
    
    // Link failure detection
    this.linkTimeouts = new Map(); // linkId -> timeout
    this.linkTimeout = options.linkTimeout || 120000; // 2 minutes
    
    // Route discovery
    this.discoveryInProgress = new Set(); // Set of destinations
    this.discoveryTimeout = options.discoveryTimeout || 30000; // 30 seconds
    
    // Statistics
    this.stats = {
      lsasSent: 0,
      lsasReceived: 0,
      routesDiscovered: 0,
      linksHealed: 0,
      topologyUpdates: 0
    };
    
    // Periodic LSA broadcast
    this.lsaInterval = options.lsaInterval || 60000; // 1 minute
    this.lsaTimer = setInterval(() => this.broadcastLSA(), this.lsaInterval);
  }
  
  /**
   * Initialize local node in topology
   */
  initialize() {
    if (!this.topology.has(this.localCallsign)) {
      this.topology.set(this.localCallsign, {
        neighbors: new Set(),
        links: new Map() // neighbor -> { cost, lastSeen }
      });
    }
  }
  
  /**
   * Handle link failure
   */
  handleLinkFailure(neighbor) {
    this.emit('link-failure', { neighbor });
    
    // Remove from local topology
    const localNode = this.topology.get(this.localCallsign);
    if (localNode) {
      localNode.neighbors.delete(neighbor);
      localNode.links.delete(neighbor);
    }
    
    // Broadcast updated LSA
    this.broadcastLSA();
    
    // Trigger route discovery for affected destinations
    this.discoverAlternateRoutes(neighbor);
  }
  
  /**
   * Discover alternate routes
   */
  async discoverAlternateRoutes(failedNeighbor) {
    // Find all destinations that were reachable through failed neighbor
    const affectedDestinations = this.findAffectedDestinations(failedNeighbor);
    
    for (const destination of affectedDestinations) {
      await this.discoverRoute(destination);
    }
  }
  
  /**
   * Find destinations affected by link failure
   */
  findAffectedDestinations(failedNeighbor) {
    const affected = new Set();
    
    // Simple approach: all nodes beyond the failed neighbor
    for (const [nodeId, node] of this.topology.entries()) {
      if (nodeId !== this.localCallsign && nodeId !== failedNeighbor) {
        // Check if path goes through failed neighbor
        const path = this.calculateShortestPath(this.localCallsign, nodeId);
        if (path && path.length > 1 && path[1] === failedNeighbor) {
          affected.add(nodeId);
        }
      }
    }
    
    return affected;
  }
  
  /**
   * Discover route to destination
   */
  async discoverRoute(destination) {
    if (this.discoveryInProgress.has(destination)) {
      return; // Already discovering
    }
    
    this.discoveryInProgress.add(destination);
    
    // Send route discovery request
    const discoveryRequest = {
      type: 'ROUTE_DISCOVERY',
      source: this.localCallsign,
      destination,
      path: [this.localCallsign],
      sequence: ++this.lsaSequence,
      timestamp: Date.now()
    };
    
    // Broadcast to all neighbors
    if (this.backboneManager) {
      const neighbors = this.getLocalNeighbors();
      for (const neighbor of neighbors) {
        this.backboneManager.sendData(neighbor, {
          type: 'route_discovery',
          data: discoveryRequest
        });
      }
    }
    
    this.emit('route-discovery-started', { destination });
    
    // Set timeout
    setTimeout(() => {
      this.discoveryInProgress.delete(destination);
      
      // Check if route was found
      const path = this.calculateShortestPath(this.localCallsign, destination);
      if (path) {
        this.stats.routesDiscovered++;
        this.emit('route-discovered', { destination, path });
      } else {
        this.emit('route-discovery-failed', { destination });
      }
    }, this.discoveryTimeout);
  }
  
  /**
   * Handle route discovery request
   */
  handleRouteDiscovery(request) {
    const { source, destination, path, sequence } = request;
    
    // Check if we're the destination
    if (destination === this.localCallsign) {
      // Send route reply back along path
      this.sendRouteReply(source, path);
      return;
    }
    
    // Check if already in path (loop detection)
    if (path.includes(this.localCallsign)) {
      return;
    }
    
    // Forward to neighbors
    const newPath = [...path, this.localCallsign];
    const forwardRequest = {
      ...request,
      path: newPath
    };
    
    const neighbors = this.getLocalNeighbors();
    for (const neighbor of neighbors) {
      if (!path.includes(neighbor)) {
        if (this.backboneManager) {
          this.backboneManager.sendData(neighbor, {
            type: 'route_discovery',
            data: forwardRequest
          });
        }
      }
    }
  }
  
  /**
   * Send route reply
   */
  sendRouteReply(source, path) {
    const reply = {
      type: 'ROUTE_REPLY',
      source: this.localCallsign,
      destination: source,
      path: path.reverse(),
      timestamp: Date.now()
    };
    
    // Send along reverse path
    if (path.length > 1 && this.backboneManager) {
      const nextHop = path[1]; // Next hop towards source
      this.backboneManager.sendData(nextHop, {
        type: 'route_reply',
        data: reply
      });
    }
  }
  
  /**
   * Handle route reply
   */
  handleRouteReply(reply) {
    const { destination, path } = reply;
    
    // Update topology with discovered path
    for (let i = 0; i < path.length - 1; i++) {
      this.updateLink(path[i], path[i + 1], 1); // Cost of 1
    }
    
    this.stats.routesDiscovered++;
    this.stats.linksHealed++;
    
    this.emit('route-reply-received', { destination, path });
  }
  
  /**
   * Broadcast Link State Advertisement
   */
  broadcastLSA() {
    this.initialize();
    
    const localNode = this.topology.get(this.localCallsign);
    if (!localNode) {
      return;
    }
    
    const lsa = {
      type: 'LSA',
      node: this.localCallsign,
      sequence: ++this.lsaSequence,
      neighbors: Array.from(localNode.neighbors),
      links: Array.from(localNode.links.entries()).map(([neighbor, link]) => ({
        neighbor,
        cost: link.cost
      })),
      timestamp: Date.now()
    };
    
    // Broadcast to all neighbors
    if (this.backboneManager) {
      const neighbors = this.getLocalNeighbors();
      for (const neighbor of neighbors) {
        this.backboneManager.sendData(neighbor, {
          type: 'lsa',
          data: lsa
        });
      }
    }
    
    this.stats.lsasSent++;
    this.emit('lsa-sent', { sequence: lsa.sequence, neighbors: lsa.neighbors.length });
  }
  
  /**
   * Handle received LSA
   */
  handleLSA(lsa) {
    const { node, sequence, neighbors, links } = lsa;
    
    // Check sequence number
    const lastSequence = this.nodeSequences.get(node) || 0;
    if (sequence <= lastSequence) {
      return; // Old LSA, ignore
    }
    
    this.nodeSequences.set(node, sequence);
    
    // Update topology
    if (!this.topology.has(node)) {
      this.topology.set(node, {
        neighbors: new Set(),
        links: new Map()
      });
    }
    
    const nodeData = this.topology.get(node);
    nodeData.neighbors = new Set(neighbors);
    nodeData.links.clear();
    
    for (const link of links) {
      nodeData.links.set(link.neighbor, {
        cost: link.cost,
        lastSeen: Date.now()
      });
    }
    
    this.stats.lsasReceived++;
    this.stats.topologyUpdates++;
    
    this.emit('lsa-received', { node, sequence, neighbors: neighbors.length });
    
    // Forward LSA to neighbors (flooding)
    this.forwardLSA(lsa, node);
  }
  
  /**
   * Forward LSA to neighbors
   */
  forwardLSA(lsa, originNode) {
    if (!this.backboneManager) {
      return;
    }
    
    const neighbors = this.getLocalNeighbors();
    for (const neighbor of neighbors) {
      if (neighbor !== originNode) {
        this.backboneManager.sendData(neighbor, {
          type: 'lsa',
          data: lsa
        });
      }
    }
  }
  
  /**
   * Update link in topology
   */
  updateLink(node1, node2, cost = 1) {
    // Ensure both nodes exist
    if (!this.topology.has(node1)) {
      this.topology.set(node1, { neighbors: new Set(), links: new Map() });
    }
    if (!this.topology.has(node2)) {
      this.topology.set(node2, { neighbors: new Set(), links: new Map() });
    }
    
    // Update bidirectional link
    const node1Data = this.topology.get(node1);
    const node2Data = this.topology.get(node2);
    
    node1Data.neighbors.add(node2);
    node1Data.links.set(node2, { cost, lastSeen: Date.now() });
    
    node2Data.neighbors.add(node1);
    node2Data.links.set(node1, { cost, lastSeen: Date.now() });
  }
  
  /**
   * Calculate shortest path using Dijkstra's algorithm
   */
  calculateShortestPath(source, destination) {
    if (source === destination) {
      return [source];
    }
    
    const distances = new Map();
    const previous = new Map();
    const unvisited = new Set(this.topology.keys());
    
    // Initialize
    for (const node of this.topology.keys()) {
      distances.set(node, Infinity);
    }
    distances.set(source, 0);
    
    while (unvisited.size > 0) {
      // Find unvisited node with smallest distance
      let current = null;
      let minDistance = Infinity;
      
      for (const node of unvisited) {
        const distance = distances.get(node);
        if (distance < minDistance) {
          minDistance = distance;
          current = node;
        }
      }
      
      if (current === null || minDistance === Infinity) {
        break; // No path exists
      }
      
      unvisited.delete(current);
      
      // Check if we reached destination
      if (current === destination) {
        break;
      }
      
      // Update neighbors
      const nodeData = this.topology.get(current);
      if (nodeData) {
        for (const [neighbor, link] of nodeData.links) {
          const newDistance = distances.get(current) + link.cost;
          
          if (newDistance < distances.get(neighbor)) {
            distances.set(neighbor, newDistance);
            previous.set(neighbor, current);
          }
        }
      }
    }
    
    // Reconstruct path
    if (!previous.has(destination)) {
      return null; // No path found
    }
    
    const path = [];
    let current = destination;
    
    while (current) {
      path.unshift(current);
      current = previous.get(current);
    }
    
    return path;
  }
  
  /**
   * Get local neighbors from BackboneManager
   */
  getLocalNeighbors() {
    if (this.backboneManager && this.backboneManager.getNeighbors) {
      return this.backboneManager.getNeighbors().map(n => n.callsign || n);
    }
    
    const localNode = this.topology.get(this.localCallsign);
    return localNode ? Array.from(localNode.neighbors) : [];
  }
  
  /**
   * Add neighbor to local topology
   */
  addNeighbor(neighbor, cost = 1) {
    this.initialize();
    
    const localNode = this.topology.get(this.localCallsign);
    localNode.neighbors.add(neighbor);
    localNode.links.set(neighbor, { cost, lastSeen: Date.now() });
    
    // Broadcast updated LSA
    this.broadcastLSA();
    
    this.emit('neighbor-added', { neighbor, cost });
  }
  
  /**
   * Remove neighbor from local topology
   */
  removeNeighbor(neighbor) {
    this.initialize();
    
    const localNode = this.topology.get(this.localCallsign);
    localNode.neighbors.delete(neighbor);
    localNode.links.delete(neighbor);
    
    // Broadcast updated LSA
    this.broadcastLSA();
    
    this.emit('neighbor-removed', { neighbor });
  }
  
  /**
   * Get network topology
   */
  getTopology() {
    const topology = [];
    
    for (const [node, data] of this.topology.entries()) {
      topology.push({
        node,
        neighbors: Array.from(data.neighbors),
        linkCount: data.links.size
      });
    }
    
    return topology;
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      nodesInTopology: this.topology.size,
      localNeighbors: this.getLocalNeighbors().length
    };
  }
  
  /**
   * Shutdown
   */
  shutdown() {
    if (this.lsaTimer) {
      clearInterval(this.lsaTimer);
      this.lsaTimer = null;
    }
    
    this.emit('shutdown');
  }
}

module.exports = MeshHealing;
