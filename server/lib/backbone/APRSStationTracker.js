/**
 * APRSStationTracker - Track APRS station positions and status
 * Maintains station database and distributes position updates
 */

const EventEmitter = require('events');

class APRSStationTracker extends EventEmitter {
  constructor(options = {}) {
    super();
    this.bbsSync = options.bbsSync;
    this.localCallsign = options.localCallsign || 'LOCAL';
    this.maxStations = options.maxStations || 1000;
    this.maxAge = options.maxAge || (24 * 60 * 60 * 1000); // 24 hours
    
    // Station database: callsign -> station data
    this.stations = new Map();
    
    // Statistics
    this.stats = {
      stationsTracked: 0,
      positionsReceived: 0,
      positionsDistributed: 0,
      stationsExpired: 0
    };
  }

  /**
   * Update station position from APRS packet
   * @param {Object} packet - Parsed APRS packet
   * @param {String} source - Source node (for backbone tracking)
   */
  updateStation(packet, source = null) {
    const callsign = (packet.source || packet.from || '').toUpperCase();
    if (!callsign) return;
    
    const position = this.parsePosition(packet);
    if (!position) return;
    
    this.stats.positionsReceived++;
    
    // Get or create station record
    let station = this.stations.get(callsign);
    if (!station) {
      station = {
        callsign,
        firstSeen: Date.now(),
        packetCount: 0,
        positionHistory: []
      };
      this.stations.set(callsign, station);
      this.stats.stationsTracked++;
    }
    
    // Update station data
    station.lastSeen = Date.now();
    station.lastPosition = position;
    station.lastSource = source || 'local';
    station.packetCount++;
    
    // Add to position history (keep last 10)
    station.positionHistory.push({
      ...position,
      timestamp: Date.now()
    });
    if (station.positionHistory.length > 10) {
      station.positionHistory.shift();
    }
    
    // Update symbol and status if present
    if (packet.symbol) {
      station.symbol = packet.symbol;
    }
    if (packet.status || packet.comment) {
      station.status = packet.status || packet.comment;
    }
    
    // Emit position update
    this.emit('position-update', {
      callsign,
      position,
      station
    });
    
    console.log(`[StationTracker] Updated ${callsign}: ${position.latitude.toFixed(4)}, ${position.longitude.toFixed(4)}`);
    
    // Distribute via backbone if configured
    if (this.bbsSync && this.shouldDistribute(station)) {
      this.distributePosition(station);
    }
    
    // Check if we need to expire old stations
    if (this.stations.size > this.maxStations) {
      this.cleanup(this.maxAge);
    }
  }

  /**
   * Parse position from APRS packet
   * @private
   */
  parsePosition(packet) {
    const content = packet.content || packet.payload || '';
    
    // APRS position formats:
    // !DDMM.hhN/DDDMM.hhW$ (uncompressed with symbol)
    // =DDMM.hhN/DDDMM.hhW (uncompressed without timestamp)
    // @timestamp!lat/lon (with timestamp)
    // /timestamp!lat/lon (with timestamp)
    
    // Try uncompressed format
    const uncompressedMatch = content.match(/[!=@/](\d{4}\.\d{2}[NS])[\/\\](\d{5}\.\d{2}[EW])(.)(.)/);
    if (uncompressedMatch) {
      const [, latStr, lonStr, symbolTable, symbolCode] = uncompressedMatch;
      
      return {
        latitude: this.parseAPRSCoord(latStr),
        longitude: this.parseAPRSCoord(lonStr),
        symbol: symbolTable + symbolCode,
        format: 'uncompressed'
      };
    }
    
    // Try compressed format (Base91)
    const compressedMatch = content.match(/[!=@/]([\x21-\x7B]{4})([\x21-\x7B]{4})(.)(.)([\x21-\x7B]{2})/);
    if (compressedMatch) {
      const [, latComp, lonComp, symbolTable, symbolCode, csT] = compressedMatch;
      
      try {
        const position = this.decodeCompressedPosition(latComp, lonComp, csT);
        position.symbol = symbolTable + symbolCode;
        position.format = 'compressed';
        return position;
      } catch (error) {
        console.error('[StationTracker] Error decoding compressed position:', error);
      }
    }
    
    // Try Mic-E format (requires more complex parsing)
    // For now, we'll skip Mic-E and focus on standard formats
    
    return null;
  }

  /**
   * Parse APRS coordinate (DDMM.hhN/DDDMM.hhW format)
   * @private
   */
  parseAPRSCoord(coord) {
    const match = coord.match(/(\d{2,5})\.(\d{2})([NSEW])/);
    if (!match) return null;
    
    const [, degrees, minutes, dir] = match;
    const isLat = dir === 'N' || dir === 'S';
    const degInt = parseInt(isLat ? degrees.slice(0, 2) : degrees.slice(0, 3));
    const minInt = parseInt(isLat ? degrees.slice(2) : degrees.slice(3));
    const minFrac = parseInt(minutes);
    
    let decimal = degInt + (minInt + minFrac / 100) / 60;
    if (dir === 'S' || dir === 'W') decimal = -decimal;
    
    return decimal;
  }

  /**
   * Decode compressed position (Base91 format)
   * @private
   */
  decodeCompressedPosition(latComp, lonComp, csT) {
    // Base91 decoding for compressed coordinates
    const base91ToNum = (str) => {
      let num = 0;
      for (let i = 0; i < str.length; i++) {
        num = num * 91 + (str.charCodeAt(i) - 33);
      }
      return num;
    };
    
    const latVal = base91ToNum(latComp);
    const lonVal = base91ToNum(lonComp);
    
    // Convert to decimal degrees
    const latitude = 90 - (latVal / 380926);
    const longitude = -180 + (lonVal / 190463);
    
    // Decode course/speed if present
    const cs = base91ToNum(csT);
    const course = Math.floor(cs / 91);
    const speed = (cs % 91) - 1;
    
    const result = { latitude, longitude };
    
    if (course >= 0 && course <= 360) {
      result.course = course * 4; // 4 degree resolution
    }
    if (speed >= 0) {
      result.speed = Math.pow(1.08, speed) - 1; // knots
    }
    
    return result;
  }

  /**
   * Check if station position should be distributed
   * @private
   */
  shouldDistribute(station) {
    // Don't distribute too frequently (min 5 minutes between updates)
    if (station.lastDistributed) {
      const timeSinceDistribute = Date.now() - station.lastDistributed;
      if (timeSinceDistribute < 5 * 60 * 1000) {
        return false;
      }
    }
    
    // Only distribute if position has changed significantly
    if (station.lastDistributedPosition) {
      const distance = this.calculateDistance(
        station.lastPosition,
        station.lastDistributedPosition
      );
      
      // Require at least 0.1 mile movement
      if (distance < 0.1) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Calculate distance between two positions (miles)
   * @private
   */
  calculateDistance(pos1, pos2) {
    const R = 3959; // Earth radius in miles
    const dLat = (pos2.latitude - pos1.latitude) * Math.PI / 180;
    const dLon = (pos2.longitude - pos1.longitude) * Math.PI / 180;
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(pos1.latitude * Math.PI / 180) *
              Math.cos(pos2.latitude * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Distribute station position via backbone
   * @private
   */
  async distributePosition(station) {
    if (!this.bbsSync) return;
    
    try {
      const globalId = this.bbsSync.generateMessageId();
      
      const positionMessage = {
        id: globalId,
        messageNumber: Date.now(),
        area: 'general',
        from: station.callsign,
        to: 'APRS',
        subject: 'Position Update',
        content: JSON.stringify({
          callsign: station.callsign,
          position: station.lastPosition,
          symbol: station.symbol,
          status: station.status,
          timestamp: station.lastSeen
        }),
        category: 'A', // Administrative
        priority: 'L', // Low priority
        timestamp: new Date().toISOString()
      };
      
      await this.bbsSync.notifyNewMessage(positionMessage);
      
      station.lastDistributed = Date.now();
      station.lastDistributedPosition = { ...station.lastPosition };
      
      this.stats.positionsDistributed++;
      
      console.log(`[StationTracker] Distributed position for ${station.callsign} via backbone`);
    } catch (error) {
      console.error('[StationTracker] Error distributing position:', error);
    }
  }

  /**
   * Get station information
   * @param {String} callsign - Station callsign
   * @returns {Object|null} Station data or null
   */
  getStation(callsign) {
    return this.stations.get(callsign.toUpperCase()) || null;
  }

  /**
   * Get all tracked stations
   * @param {Object} options - Filter options
   * @returns {Array} Array of stations
   */
  getStations(options = {}) {
    const { recentOnly = false, maxAge = this.maxAge } = options;
    
    let stations = Array.from(this.stations.values());
    
    if (recentOnly) {
      const cutoff = Date.now() - maxAge;
      stations = stations.filter(s => s.lastSeen > cutoff);
    }
    
    // Sort by last seen (newest first)
    stations.sort((a, b) => b.lastSeen - a.lastSeen);
    
    return stations;
  }

  /**
   * Get stations within a geographic area
   * @param {Object} bounds - { north, south, east, west } in decimal degrees
   * @returns {Array} Array of stations within bounds
   */
  getStationsInArea(bounds) {
    const { north, south, east, west } = bounds;
    
    return this.getStations().filter(station => {
      if (!station.lastPosition) return false;
      
      const lat = station.lastPosition.latitude;
      const lon = station.lastPosition.longitude;
      
      return lat <= north && lat >= south &&
             lon <= east && lon >= west;
    });
  }

  /**
   * Clean up old stations
   * @param {Number} maxAge - Maximum age in milliseconds
   */
  cleanup(maxAge = this.maxAge) {
    const cutoff = Date.now() - maxAge;
    let expired = 0;
    
    for (const [callsign, station] of this.stations.entries()) {
      if (station.lastSeen < cutoff) {
        this.stations.delete(callsign);
        expired++;
      }
    }
    
    if (expired > 0) {
      this.stats.stationsExpired += expired;
      console.log(`[StationTracker] Expired ${expired} old stations`);
    }
  }

  /**
   * Get statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      ...this.stats,
      stationsInMemory: this.stations.size
    };
  }
}

module.exports = APRSStationTracker;
