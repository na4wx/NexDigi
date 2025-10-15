const EventEmitter = require('events');

class BeaconScheduler extends EventEmitter {
  constructor(channelManager) {
    super();
    this.channelManager = channelManager;
    this.beacons = new Map(); // channelId -> beacon config & timer
    this.settings = {};
  }

  updateSettings(settings) {
    this.settings = settings;
    this.setupBeacons();
  }

  setupBeacons() {
    // Clear existing timers
    this.clearAllBeacons();

    if (!this.settings.enabled || !this.settings.channels) {
      console.log('BeaconScheduler: Digipeater disabled or no channels configured');
      return;
    }

    // Setup beacons for each channel
    Object.entries(this.settings.channels).forEach(([channelId, channelConfig]) => {
      if (channelConfig.beacon && channelConfig.beacon.enabled) {
        this.setupChannelBeacon(channelId, channelConfig);
      }
    });
  }

  setupChannelBeacon(channelId, channelConfig) {
    const beaconConfig = channelConfig.beacon;
    
    // Check if channel is disabled
    if (channelConfig.mode === 'disabled') {
      console.log(`BeaconScheduler: Channel ${channelId} is disabled, skipping beacon`);
      return;
    }
    
    const callsign = channelConfig.callsign;

    if (!callsign) {
      console.log(`BeaconScheduler: No callsign configured for channel ${channelId}, skipping beacon`);
      return;
    }

    if (!beaconConfig.intervalMinutes || beaconConfig.intervalMinutes <= 0) {
      console.log(`BeaconScheduler: Invalid interval for channel ${channelId}, skipping beacon`);
      return;
    }

    const intervalMs = beaconConfig.intervalMinutes * 60 * 1000;
    
    console.log(`BeaconScheduler: Setting up beacon for ${channelId} (${callsign}) every ${beaconConfig.intervalMinutes} minutes`);

    // Create beacon timer
    const timer = setInterval(() => {
      this.sendBeacon(channelId, callsign, beaconConfig);
    }, intervalMs);

    // Store beacon info
    this.beacons.set(channelId, {
      config: beaconConfig,
      callsign: callsign,
      timer: timer,
      intervalMs: intervalMs,
      lastSent: null
    });

    // Send initial beacon after 30 seconds
    setTimeout(() => {
      this.sendBeacon(channelId, callsign, beaconConfig);
    }, 30000);
  }

  sendBeacon(channelId, callsign, beaconConfig) {
    try {
      // Default APRS symbol for digipeater if not specified
      const symbol = beaconConfig.symbol || 'k';
      const symbolTable = beaconConfig.symbolTable || '/';
      const message = beaconConfig.message || `${callsign} Digipeater`;

      let payload;

      // Check if global coordinates are available
      const globalCoords = this.settings.coordinates;
      if (globalCoords && globalCoords.latitude && globalCoords.longitude) {
        // Create APRS position beacon with coordinates
        // Format: !DDMM.mmN/DDDMM.mmW# comment
        const lat = parseFloat(globalCoords.latitude);
        const lon = parseFloat(globalCoords.longitude);
        
        if (!isNaN(lat) && !isNaN(lon)) {
          // Convert decimal degrees to APRS format (DDMM.mm)
          const latDeg = Math.floor(Math.abs(lat));
          const latMin = (Math.abs(lat) - latDeg) * 60;
          const latHem = lat >= 0 ? 'N' : 'S';
          
          const lonDeg = Math.floor(Math.abs(lon));
          const lonMin = (Math.abs(lon) - lonDeg) * 60;
          const lonHem = lon >= 0 ? 'E' : 'W';
          
          const latStr = `${latDeg.toString().padStart(2, '0')}${latMin.toFixed(2).padStart(5, '0')}${latHem}`;
          const lonStr = `${lonDeg.toString().padStart(3, '0')}${lonMin.toFixed(2).padStart(5, '0')}${lonHem}`;
          
          // APRS position format with symbol
          payload = `!${latStr}${symbolTable}${lonStr}${symbol}${message}`;
          console.log(`BeaconScheduler: Sending position beacon for ${callsign} on ${channelId} at ${lat},${lon}: "${message}"`);
        } else {
          console.log(`BeaconScheduler: Invalid coordinates for ${callsign}, falling back to status beacon`);
          payload = `>${message}`;
        }
      } else {
        // Create APRS status beacon format (no position)
        payload = `>${message}`;
        console.log(`BeaconScheduler: Sending status beacon for ${callsign} on ${channelId}: "${message}"`);
      }

      // Send via channel manager
      this.channelManager.sendAPRSMessage({
        from: callsign,
        to: 'BEACON',
        payload: payload,
        channel: channelId
      });

      // Update last sent time
      const beaconInfo = this.beacons.get(channelId);
      if (beaconInfo) {
        beaconInfo.lastSent = new Date();
      }

      this.emit('beaconSent', {
        channelId,
        callsign,
        message,
        timestamp: new Date()
      });

    } catch (error) {
      console.error(`BeaconScheduler: Error sending beacon for ${channelId}:`, error);
    }
  }

  clearAllBeacons() {
    this.beacons.forEach((beaconInfo, channelId) => {
      if (beaconInfo.timer) {
        clearInterval(beaconInfo.timer);
        console.log(`BeaconScheduler: Cleared beacon timer for ${channelId}`);
      }
    });
    this.beacons.clear();
  }

  getBeaconStatus() {
    const status = {};
    this.beacons.forEach((beaconInfo, channelId) => {
      status[channelId] = {
        callsign: beaconInfo.callsign,
        intervalMinutes: beaconInfo.intervalMs / (60 * 1000),
        message: beaconInfo.config.message,
        lastSent: beaconInfo.lastSent,
        nextBeacon: beaconInfo.lastSent ? 
          new Date(beaconInfo.lastSent.getTime() + beaconInfo.intervalMs) : 
          new Date(Date.now() + 30000) // 30 seconds from now if never sent
      };
    });
    return status;
  }

  // Manual beacon trigger for testing
  triggerBeacon(channelId) {
    const beaconInfo = this.beacons.get(channelId);
    if (beaconInfo) {
      this.sendBeacon(channelId, beaconInfo.callsign, beaconInfo.config);
      return true;
    }
    return false;
  }

  cleanup() {
    this.clearAllBeacons();
  }
}

module.exports = BeaconScheduler;