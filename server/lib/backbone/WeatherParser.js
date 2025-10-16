/**
 * WeatherParser - Parse NWS bulletins and APRS weather data
 * Handles various weather formats and distributes via backbone
 */

const EventEmitter = require('events');

class WeatherParser extends EventEmitter {
  constructor(options = {}) {
    super();
    this.bbsSync = options.bbsSync;
    this.bbs = options.bbs;
    this.localCallsign = options.localCallsign || 'LOCAL';
    
    // Weather bulletin storage
    this.weatherBulletins = new Map(); // bulletinId -> bulletin data
    this.stationWeather = new Map(); // callsign -> latest weather
    
    // NWS product codes
    this.nwsProductCodes = new Set([
      'AFD', 'SPS', 'WSW', 'SVR', 'TOR', 'FFW', 'FLW', 'WRN',
      'HWO', 'ZFP', 'CFW', 'RFW', 'NPW', 'WSW', 'NOW'
    ]);
    
    // Statistics
    this.stats = {
      bulletinsParsed: 0,
      weatherReportsParsed: 0,
      nwsProductsDetected: 0,
      bulletinsDistributed: 0
    };
  }

  /**
   * Parse incoming APRS or BBS message for weather content
   * @param {Object} message - Message object
   * @param {String} source - Source callsign
   * @returns {Object|null} Parsed weather data or null
   */
  parseMessage(message, source) {
    const content = message.content || message.payload || '';
    
    // Check if this is an NWS bulletin
    const nwsBulletin = this.parseNWSBulletin(content, source);
    if (nwsBulletin) {
      this.stats.nwsProductsDetected++;
      this.stats.bulletinsParsed++;
      return nwsBulletin;
    }
    
    // Check if this is APRS weather data
    const aprsWeather = this.parseAPRSWeather(content, source);
    if (aprsWeather) {
      this.stats.weatherReportsParsed++;
      return aprsWeather;
    }
    
    return null;
  }

  /**
   * Parse NWS bulletin format
   * @private
   */
  parseNWSBulletin(content, source) {
    // NWS bulletins typically follow format:
    // ZCZC-Product-ID-LOCATION-TIMESTAMP
    // Or contain product codes followed by location and content
    
    const lines = content.split(/\r?\n/);
    const firstLine = lines[0] || '';
    
    // Check for ZCZC header
    const zczcMatch = firstLine.match(/^ZCZC-(\w+)-(\w+)-(\w+)-(\d+)/);
    if (zczcMatch) {
      const [, productCode, id, location, timestamp] = zczcMatch;
      
      return {
        type: 'nws_bulletin',
        productCode: productCode.toUpperCase(),
        id,
        location,
        timestamp,
        source,
        content,
        isUrgent: this.isUrgentProduct(productCode),
        parsedAt: Date.now()
      };
    }
    
    // Check for product code at start
    for (const code of this.nwsProductCodes) {
      if (firstLine.toUpperCase().startsWith(code)) {
        // Extract location if present
        const locationMatch = firstLine.match(/([A-Z]{2,3})\s*-\s*([A-Z\s]+)/);
        const location = locationMatch ? locationMatch[2].trim() : 'UNKNOWN';
        
        return {
          type: 'nws_bulletin',
          productCode: code,
          id: `${code}-${Date.now()}`,
          location,
          timestamp: new Date().toISOString(),
          source,
          content,
          isUrgent: this.isUrgentProduct(code),
          parsedAt: Date.now()
        };
      }
    }
    
    return null;
  }

  /**
   * Parse APRS weather data
   * @private
   */
  parseAPRSWeather(content, source) {
    // APRS weather format:
    // !DDMM.hhN/DDDMM.hhW_course/speedgustwind_dirtemp...
    // or @timestamp!lat/lon_...weather...
    // or position with weather: _.../...g...t...r...p...h...
    
    // Look for weather data indicators
    const hasWeatherData = content.match(/[_](\d{3})\/(\d{3})g(\d{3})t([+-]?\d{3})/) ||
                          content.match(/g(\d{3})t([+-]?\d{3})r(\d{3})p(\d{3})/) ||
                          content.match(/t([+-]?\d{3})h(\d{2})/);
    
    if (!hasWeatherData) {
      return null;
    }
    
    const weather = {
      type: 'aprs_weather',
      source,
      timestamp: Date.now()
    };
    
    // Parse wind data: _course/speedgust
    const windMatch = content.match(/_(\d{3})\/(\d{3})g(\d{3})/);
    if (windMatch) {
      weather.windDirection = parseInt(windMatch[1]);
      weather.windSpeed = parseInt(windMatch[2]); // mph
      weather.windGust = parseInt(windMatch[3]); // mph
    }
    
    // Parse temperature: t###
    const tempMatch = content.match(/t([+-]?\d{3})/);
    if (tempMatch) {
      weather.temperature = parseInt(tempMatch[1]); // Fahrenheit
    }
    
    // Parse rainfall: r### (last hour in hundredths of inch)
    const rainMatch = content.match(/r(\d{3})/);
    if (rainMatch) {
      weather.rainfall1h = parseInt(rainMatch[1]) / 100; // inches
    }
    
    // Parse rainfall (24h): p###
    const rain24Match = content.match(/p(\d{3})/);
    if (rain24Match) {
      weather.rainfall24h = parseInt(rain24Match[1]) / 100; // inches
    }
    
    // Parse humidity: h##
    const humidityMatch = content.match(/h(\d{2})/);
    if (humidityMatch) {
      weather.humidity = parseInt(humidityMatch[1]); // percent
      if (weather.humidity === 0) weather.humidity = 100; // 00 means 100%
    }
    
    // Parse barometric pressure: b##### (tenths of millibar)
    const pressureMatch = content.match(/b(\d{5})/);
    if (pressureMatch) {
      weather.pressure = parseInt(pressureMatch[1]) / 10; // millibars
    }
    
    // Parse position if present
    const posMatch = content.match(/(!|=|@)(\d{4}\.\d{2}[NS])\/(\d{5}\.\d{2}[EW])/);
    if (posMatch) {
      weather.latitude = this.parseAPRSCoord(posMatch[2]);
      weather.longitude = this.parseAPRSCoord(posMatch[3]);
    }
    
    return weather;
  }

  /**
   * Parse APRS coordinate format
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
   * Check if NWS product is urgent
   * @private
   */
  isUrgentProduct(code) {
    const urgentCodes = ['TOR', 'SVR', 'FFW', 'FLW', 'WSW', 'WRN'];
    return urgentCodes.includes(code.toUpperCase());
  }

  /**
   * Store and distribute weather bulletin
   * @param {Object} bulletin - Parsed bulletin
   */
  async distributeBulletin(bulletin) {
    const bulletinId = bulletin.id || `WEATHER-${Date.now()}`;
    
    // Store bulletin
    this.weatherBulletins.set(bulletinId, bulletin);
    
    // Add to BBS if available
    if (this.bbs) {
      const category = bulletin.isUrgent ? 'E' : 'B'; // Emergency or Bulletin
      const priority = bulletin.isUrgent ? 'H' : 'N';
      
      try {
        this.bbs.addMessage(
          bulletin.source || 'NWS',
          'ALL',
          bulletin.content,
          {
            subject: `${bulletin.productCode || 'WEATHER'} - ${bulletin.location || ''}`,
            category,
            priority,
            tags: ['weather', bulletin.productCode?.toLowerCase()]
          }
        );
        
        console.log(`[WeatherParser] Added ${bulletin.productCode} bulletin to BBS`);
      } catch (error) {
        console.error(`[WeatherParser] Error adding bulletin to BBS:`, error);
      }
    }
    
    // Distribute via backbone if sync available
    if (this.bbsSync) {
      const globalId = this.bbsSync.generateMessageId();
      
      try {
        await this.bbsSync.notifyNewMessage({
          id: globalId,
          messageNumber: Date.now(),
          area: bulletin.isUrgent ? 'emergency' : 'weather',
          from: bulletin.source || 'NWS',
          to: 'ALL',
          subject: `${bulletin.productCode} - ${bulletin.location}`,
          content: bulletin.content,
          category: bulletin.isUrgent ? 'E' : 'B',
          priority: bulletin.isUrgent ? 'H' : 'N',
          timestamp: new Date().toISOString()
        });
        
        this.stats.bulletinsDistributed++;
        console.log(`[WeatherParser] Distributed ${bulletin.productCode} via backbone`);
      } catch (error) {
        console.error(`[WeatherParser] Error distributing bulletin:`, error);
      }
    }
    
    this.emit('bulletin-distributed', bulletin);
  }

  /**
   * Store weather report from APRS station
   * @param {Object} weather - Parsed weather data
   */
  storeWeatherReport(weather) {
    if (!weather || !weather.source) return;
    
    // Update station's latest weather
    this.stationWeather.set(weather.source, weather);
    
    // Emit event for listeners
    this.emit('weather-report', weather);
    
    console.log(`[WeatherParser] Stored weather from ${weather.source}: ` +
               `${weather.temperature !== undefined ? `${weather.temperature}°F` : ''} ` +
               `${weather.humidity !== undefined ? `${weather.humidity}% RH` : ''}`);
  }

  /**
   * Get latest weather for a station
   * @param {String} callsign - Station callsign
   * @returns {Object|null} Weather data or null
   */
  getStationWeather(callsign) {
    return this.stationWeather.get(callsign.toUpperCase()) || null;
  }

  /**
   * Get recent weather bulletins
   * @param {Object} options - Filter options
   * @returns {Array} Array of bulletins
   */
  getRecentBulletins(options = {}) {
    const { productCode, isUrgent, limit = 50 } = options;
    
    let bulletins = Array.from(this.weatherBulletins.values());
    
    if (productCode) {
      bulletins = bulletins.filter(b => 
        b.productCode?.toUpperCase() === productCode.toUpperCase()
      );
    }
    
    if (isUrgent !== undefined) {
      bulletins = bulletins.filter(b => b.isUrgent === isUrgent);
    }
    
    // Sort by timestamp (newest first)
    bulletins.sort((a, b) => b.parsedAt - a.parsedAt);
    
    return bulletins.slice(0, limit);
  }

  /**
   * Clean up old bulletins and weather reports
   * @param {Number} maxAge - Maximum age in milliseconds
   */
  cleanup(maxAge = 24 * 60 * 60 * 1000) { // 24 hours default
    const now = Date.now();
    
    // Clean old bulletins
    for (const [id, bulletin] of this.weatherBulletins.entries()) {
      if (now - bulletin.parsedAt > maxAge) {
        this.weatherBulletins.delete(id);
      }
    }
    
    // Clean old weather reports
    for (const [callsign, weather] of this.stationWeather.entries()) {
      if (now - weather.timestamp > maxAge) {
        this.stationWeather.delete(callsign);
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
      bulletinsStored: this.weatherBulletins.size,
      stationsTracked: this.stationWeather.size
    };
  }
}

module.exports = WeatherParser;
