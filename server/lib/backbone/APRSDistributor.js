/**
 * APRSDistributor - Distribute APRS packets across backbone network
 * Handles flooding, filtering, and duplicate prevention
 */

const EventEmitter = require('events');

class APRSDistributor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.backboneManager = options.backboneManager;
    this.stationTracker = options.stationTracker;
    this.weatherParser = options.weatherParser;
    this.localCallsign = options.localCallsign || 'LOCAL';
    
    // Distribution settings
    this.enableFlooding = options.enableFlooding !== false; // Default true
    this.maxHops = options.maxHops || 3;
    this.floodDelay = options.floodDelay || 100; // ms delay between floods
    
    // Duplicate prevention
    this.seenPackets = new Map(); // packetId -> { timestamp, hops, sources }
    this.maxSeenAge = options.maxSeenAge || (60 * 60 * 1000); // 1 hour
    
    // Rate limiting
    this.rateLimits = new Map(); // callsign -> { count, resetTime }
    this.maxPacketsPerMinute = options.maxPacketsPerMinute || 60;
    
    // Filter settings
    this.filters = {
      minHops: options.minHops || 0,
      maxHops: options.maxHops || 7,
      allowedTypes: options.allowedTypes || ['position', 'weather', 'message', 'status', 'bulletin'],
      blockedCallsigns: new Set(options.blockedCallsigns || [])
    };
    
    // Statistics
    this.stats = {
      packetsReceived: 0,
      packetsDistributed: 0,
      packetsDuplicate: 0,
      packetsFiltered: 0,
      packetsRateLimited: 0
    };
    
    // Listen for backbone data if manager provided
    if (this.backboneManager) {
      this.backboneManager.on('data', this.handleBackbonePacket.bind(this));
    }
  }

  /**
   * Process incoming APRS packet for distribution
   * @param {Object} packet - Parsed APRS packet
   * @param {String} sourceNode - Source node (null if local RF)
   * @returns {Boolean} True if distributed
   */
  async distributePacket(packet, sourceNode = null) {
    this.stats.packetsReceived++;
    
    const packetId = this.generatePacketId(packet);
    const callsign = (packet.source || packet.from || '').toUpperCase();
    
    // Check for duplicates
    if (this.isDuplicate(packetId, sourceNode)) {
      this.stats.packetsDuplicate++;
      console.log(`[APRSDistributor] Duplicate packet ${packetId} from ${sourceNode || 'local'}`);
      return false;
    }
    
    // Check rate limits
    if (!this.checkRateLimit(callsign)) {
      this.stats.packetsRateLimited++;
      console.log(`[APRSDistributor] Rate limit exceeded for ${callsign}`);
      return false;
    }
    
    // Apply filters
    if (!this.passesFilters(packet)) {
      this.stats.packetsFiltered++;
      console.log(`[APRSDistributor] Packet filtered: ${packetId}`);
      return false;
    }
    
    // Record packet as seen
    this.markSeen(packetId, sourceNode);
    
    // Extract and process content
    await this.processPacketContent(packet, sourceNode);
    
    // Distribute if flooding enabled
    if (this.enableFlooding && this.shouldFlood(packet, sourceNode)) {
      await this.floodPacket(packet, sourceNode);
      this.stats.packetsDistributed++;
      return true;
    }
    
    return false;
  }

  /**
   * Generate unique packet ID
   * @private
   */
  generatePacketId(packet) {
    const source = (packet.source || packet.from || 'UNKNOWN').toUpperCase();
    const content = packet.content || packet.payload || '';
    const shortContent = content.substring(0, 50);
    
    // Use source + truncated content + approximate timestamp
    const timestamp = Math.floor(Date.now() / 1000); // 1-second resolution
    return `${source}:${timestamp}:${shortContent}`;
  }

  /**
   * Check if packet is a duplicate
   * @private
   */
  isDuplicate(packetId, sourceNode) {
    const seen = this.seenPackets.get(packetId);
    
    if (!seen) {
      return false;
    }
    
    // Check if packet is too old
    if (Date.now() - seen.timestamp > this.maxSeenAge) {
      this.seenPackets.delete(packetId);
      return false;
    }
    
    // Check if we've seen it from this source
    if (sourceNode && seen.sources.has(sourceNode)) {
      return true;
    }
    
    // Check if we've seen it recently from any source
    if (Date.now() - seen.timestamp < 5000) { // 5 second window
      return true;
    }
    
    return false;
  }

  /**
   * Mark packet as seen
   * @private
   */
  markSeen(packetId, sourceNode) {
    let seen = this.seenPackets.get(packetId);
    
    if (!seen) {
      seen = {
        timestamp: Date.now(),
        hops: 0,
        sources: new Set()
      };
      this.seenPackets.set(packetId, seen);
    }
    
    if (sourceNode) {
      seen.sources.add(sourceNode);
    }
  }

  /**
   * Check rate limit for callsign
   * @private
   */
  checkRateLimit(callsign) {
    const now = Date.now();
    let limit = this.rateLimits.get(callsign);
    
    if (!limit) {
      limit = {
        count: 0,
        resetTime: now + 60000 // 1 minute from now
      };
      this.rateLimits.set(callsign, limit);
    }
    
    // Reset if time expired
    if (now >= limit.resetTime) {
      limit.count = 0;
      limit.resetTime = now + 60000;
    }
    
    // Check limit
    if (limit.count >= this.maxPacketsPerMinute) {
      return false;
    }
    
    limit.count++;
    return true;
  }

  /**
   * Check if packet passes filters
   * @private
   */
  passesFilters(packet) {
    const callsign = (packet.source || packet.from || '').toUpperCase();
    
    // Check blocked callsigns
    if (this.filters.blockedCallsigns.has(callsign)) {
      return false;
    }
    
    // Check hops (if present in packet)
    if (packet.hops !== undefined) {
      if (packet.hops < this.filters.minHops || packet.hops > this.filters.maxHops) {
        return false;
      }
    }
    
    // Check packet type
    const packetType = this.detectPacketType(packet);
    if (packetType && !this.filters.allowedTypes.includes(packetType)) {
      return false;
    }
    
    return true;
  }

  /**
   * Detect APRS packet type
   * @private
   */
  detectPacketType(packet) {
    const content = packet.content || packet.payload || '';
    
    if (content.startsWith(':')) return 'message';
    if (content.match(/^[!=@/]/)) return 'position';
    if (content.match(/_\d{3}\/\d{3}g\d{3}t[+-]?\d{3}/)) return 'weather';
    if (content.startsWith('>')) return 'status';
    if (content.startsWith('$')) return 'raw';
    
    // Check for NWS bulletins or other text content
    if (content.match(/^(TOR|SVR|FFW|WSW|WRN|AFD|SPS)/i)) return 'bulletin';
    if (content.match(/^ZCZC-/)) return 'bulletin';
    
    return 'other';
  }

  /**
   * Check if packet should be flooded to backbone
   * @private
   */
  shouldFlood(packet, sourceNode) {
    // Don't flood back to source
    if (sourceNode) {
      const seen = this.seenPackets.get(this.generatePacketId(packet));
      if (seen && seen.hops >= this.maxHops) {
        return false;
      }
    }
    
    // Only flood certain packet types
    const type = this.detectPacketType(packet);
    const floodableTypes = ['position', 'weather', 'message', 'status', 'bulletin'];
    
    return floodableTypes.includes(type);
  }

  /**
   * Flood packet to all backbone neighbors except source
   * @private
   */
  async floodPacket(packet, sourceNode) {
    if (!this.backboneManager) return;
    
    const neighbors = this.backboneManager.neighborTable.getAll();
    
    for (const neighbor of neighbors) {
      // Skip source node
      if (neighbor.callsign === sourceNode) {
        continue;
      }
      
      // Add small delay to prevent congestion
      if (this.floodDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, this.floodDelay));
      }
      
      try {
        await this.backboneManager.sendData(
          neighbor.callsign,
          {
            type: 'aprs_packet',
            fromNode: this.localCallsign,
            toNode: neighbor.callsign,
            packet: {
              source: packet.source || packet.from,
              destination: packet.destination || packet.to,
              payload: packet.content || packet.payload,
              timestamp: Date.now(),
              hops: (packet.hops || 0) + 1
            }
          }
        );
        
        console.log(`[APRSDistributor] Flooded packet to ${neighbor.callsign}`);
      } catch (error) {
        console.error(`[APRSDistributor] Error flooding to ${neighbor.callsign}:`, error);
      }
    }
  }

  /**
   * Process packet content (weather, position, etc.)
   * @private
   */
  async processPacketContent(packet, sourceNode) {
    // Update station tracker
    if (this.stationTracker) {
      try {
        this.stationTracker.updateStation(packet, sourceNode);
      } catch (error) {
        console.error('[APRSDistributor] Error updating station tracker:', error);
      }
    }
    
    // Parse weather data
    if (this.weatherParser) {
      try {
        const weather = this.weatherParser.parseMessage(packet, packet.source || packet.from);
        if (weather) {
          if (weather.type === 'nws_bulletin') {
            await this.weatherParser.distributeBulletin(weather);
          } else if (weather.type === 'aprs_weather') {
            this.weatherParser.storeWeatherReport(weather);
          }
        }
      } catch (error) {
        console.error('[APRSDistributor] Error parsing weather:', error);
      }
    }
  }

  /**
   * Handle incoming backbone packet
   * @private
   */
  async handleBackbonePacket(event) {
    const { source, payload } = event;
    
    try {
      const data = JSON.parse(payload.toString());
      
      if (data.type === 'aprs_packet') {
        console.log(`[APRSDistributor] Received APRS packet from ${source} via backbone`);
        
        // Reconstruct packet
        const packet = {
          source: data.packet.source,
          destination: data.packet.destination,
          content: data.packet.payload,
          payload: data.packet.payload,
          hops: data.packet.hops || 0,
          timestamp: data.packet.timestamp
        };
        
        // Process and potentially re-flood
        await this.distributePacket(packet, source);
      }
    } catch (error) {
      console.error('[APRSDistributor] Error handling backbone packet:', error);
    }
  }

  /**
   * Clean up old seen packets and rate limits
   */
  cleanup() {
    const now = Date.now();
    
    // Clean seen packets
    for (const [packetId, seen] of this.seenPackets.entries()) {
      if (now - seen.timestamp > this.maxSeenAge) {
        this.seenPackets.delete(packetId);
      }
    }
    
    // Clean rate limits
    for (const [callsign, limit] of this.rateLimits.entries()) {
      if (now >= limit.resetTime + 60000) { // 1 minute after reset
        this.rateLimits.delete(callsign);
      }
    }
  }

  /**
   * Get statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      ...this.stats,
      seenPackets: this.seenPackets.size,
      rateLimitedStations: this.rateLimits.size
    };
  }

  /**
   * Add callsign to block list
   * @param {String} callsign - Callsign to block
   */
  blockCallsign(callsign) {
    this.filters.blockedCallsigns.add(callsign.toUpperCase());
  }

  /**
   * Remove callsign from block list
   * @param {String} callsign - Callsign to unblock
   */
  unblockCallsign(callsign) {
    this.filters.blockedCallsigns.delete(callsign.toUpperCase());
  }
}

module.exports = APRSDistributor;
