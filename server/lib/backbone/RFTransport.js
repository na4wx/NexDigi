/**
 * RFTransport.js
 * RF (Radio Frequency) transport for backbone using AX.25 packet radio
 * 
 * Integrates with existing ChannelManager for packet transmission
 * Uses connected-mode AX.25 sessions for reliable delivery
 */

const Transport = require('./Transport');
const { PacketFormat, PacketType, PacketFlags } = require('./PacketFormat');
const { parseAx25Frame, buildAx25IFrame, buildSABM, buildUA, buildDISC, buildDM } = require('../ax25');

// Default AX.25 PID for backbone traffic (0xF0 = no layer 3)
const BACKBONE_PID = 0xF0;

// RF transport cost (higher than Internet, reflects slower/less reliable medium)
const RF_COST = 500;

// AX.25 MTU (conservative, accounting for header overhead)
const RF_MTU = 200;

class RFTransport extends Transport {
  constructor(config, channelManager) {
    super(config);
    this.type = 'rf';
    this.channelManager = channelManager;
    this.channelId = config.channelId; // Which channel to use for backbone
    this.sessions = new Map(); // callsign -> { connected, nr, ns, pending }
    this.rxBuffer = new Map(); // callsign -> Buffer for reassembly

    // Bind to ChannelManager events
    this._setupChannelListeners();
  }

  /**
   * Setup listeners for channel events
   * @private
   */
  _setupChannelListeners() {
    if (!this.channelManager) {
      throw new Error('ChannelManager required for RFTransport');
    }

    // Listen for incoming frames on our backbone channel
    this.channelManager.on('frame', (frame, metadata) => {
      if (metadata.channelId === this.channelId) {
        this._handleIncomingFrame(frame, metadata);
      }
    });
  }

  /**
   * Handle incoming AX.25 frame
   * @private
   */
  _handleIncomingFrame(frameBuffer, metadata) {
    try {
      const parsed = parseAx25Frame(frameBuffer);
      
      // Only handle frames destined to us or broadcast
      if (parsed.destination.callsign !== this.localCallsign && 
          parsed.destination.callsign !== 'CQ' &&
          parsed.destination.callsign !== 'NODES') {
        return;
      }

      const sourceCallsign = `${parsed.source.callsign}-${parsed.source.ssid}`;

      // Handle connection management frames
      if (parsed.command === 'SABM') {
        this._handleSABM(sourceCallsign, parsed);
      } else if (parsed.command === 'DISC') {
        this._handleDISC(sourceCallsign);
      } else if (parsed.command === 'I') {
        this._handleIFrame(sourceCallsign, parsed);
      } else if (parsed.command === 'UI') {
        // UI frames for broadcasts (HELLO packets)
        this._handleUIFrame(sourceCallsign, parsed);
      }

    } catch (error) {
      this._recordError(error);
      console.error('[RFTransport] Error handling frame:', error.message);
    }
  }

  /**
   * Handle SABM (connection request)
   * @private
   */
  _handleSABM(callsign, parsed) {
    // Accept connection
    this.sessions.set(callsign, {
      connected: true,
      nr: 0,
      ns: 0,
      pending: []
    });

    // Send UA (unnumbered acknowledgment)
    const uaFrame = buildUA(this.localCallsign, callsign);
    this._transmitFrame(uaFrame);

    this.emit('connection', callsign);
    console.log(`[RFTransport] Accepted connection from ${callsign}`);
  }

  /**
   * Handle DISC (disconnect request)
   * @private
   */
  _handleDISC(callsign) {
    this.sessions.delete(callsign);
    this.rxBuffer.delete(callsign);

    // Send DM (disconnect mode)
    const dmFrame = buildDM(this.localCallsign, callsign);
    this._transmitFrame(dmFrame);

    this.emit('disconnect', callsign);
    console.log(`[RFTransport] Disconnected from ${callsign}`);
  }

  /**
   * Handle I-frame (information frame with data)
   * @private
   */
  _handleIFrame(callsign, parsed) {
    const session = this.sessions.get(callsign);
    if (!session) {
      console.log(`[RFTransport] Received I-frame from non-connected station: ${callsign}`);
      return;
    }

    // Update receive sequence
    session.nr = (parsed.ns + 1) % 8;

    // Check PID - should be BACKBONE_PID
    if (parsed.pid !== BACKBONE_PID) {
      console.log(`[RFTransport] Received I-frame with non-backbone PID: ${parsed.pid}`);
      return;
    }

    // Get or create receive buffer for this station
    let buffer = this.rxBuffer.get(callsign) || Buffer.alloc(0);

    // Append payload
    buffer = Buffer.concat([buffer, parsed.payload]);
    this.rxBuffer.set(callsign, buffer);

    // Try to decode complete packet
    try {
      const packet = PacketFormat.decode(buffer);
      
      // Successfully decoded - clear buffer and emit
      this.rxBuffer.delete(callsign);
      this._updateMetrics('receive', buffer.length);
      
      this.emit('packet', {
        ...packet,
        transport: 'rf',
        peer: callsign
      });

    } catch (error) {
      // Not enough data yet or corrupted
      if (error.message.includes('too small') || error.message.includes('Incomplete')) {
        // Need more data - keep buffer
        return;
      } else {
        // Corrupted packet - clear buffer and log
        console.error(`[RFTransport] Failed to decode packet from ${callsign}:`, error.message);
        this.rxBuffer.delete(callsign);
        this._recordError(error);
      }
    }

    // Send RR acknowledgment
    this._sendRR(callsign, session.nr);
  }

  /**
   * Handle UI-frame (unnumbered information, for broadcasts)
   * @private
   */
  _handleUIFrame(callsign, parsed) {
    if (parsed.pid !== BACKBONE_PID) {
      return;
    }

    try {
      const packet = PacketFormat.decode(parsed.payload);
      this._updateMetrics('receive', parsed.payload.length);

      this.emit('packet', {
        ...packet,
        transport: 'rf',
        peer: callsign,
        broadcast: true
      });

    } catch (error) {
      console.error(`[RFTransport] Failed to decode UI packet from ${callsign}:`, error.message);
      this._recordError(error);
    }
  }

  /**
   * Send RR (Receive Ready) acknowledgment
   * @private
   */
  _sendRR(callsign, nr) {
    const ax25 = require('../ax25');
    const rrFrame = ax25.buildRR(this.localCallsign, callsign, nr);
    this._transmitFrame(rrFrame);
  }

  /**
   * Transmit frame via ChannelManager
   * @private
   */
  _transmitFrame(frame) {
    if (!this.channelManager || !this.channelId) {
      throw new Error('ChannelManager or channelId not configured');
    }

    const channel = this.channelManager.channels.get(this.channelId);
    if (!channel || !channel.enabled) {
      throw new Error(`Channel ${this.channelId} not available`);
    }

    // Use ChannelManager's transmit method
    this.channelManager.transmit(this.channelId, frame);
  }

  /**
   * Connect to the RF transport
   * @param {Object} options
   * @returns {Promise<void>}
   */
  async connect(options = {}) {
    if (this.connected) {
      return;
    }

    // Verify channel exists and is enabled
    const channel = this.channelManager.channels.get(this.channelId);
    if (!channel) {
      throw new Error(`Channel ${this.channelId} does not exist`);
    }
    if (!channel.enabled) {
      throw new Error(`Channel ${this.channelId} is not enabled`);
    }

    this.connected = true;
    console.log(`[RFTransport] Connected on channel ${this.channelId}`);
    
    // Send HELLO broadcast to announce presence
    this._sendHello();
    
    this.emit('connected');
  }

  /**
   * Send HELLO broadcast
   * @private
   */
  _sendHello() {
    const helloPacket = PacketFormat.createHello(this.localCallsign, {
      version: '1.0.0',
      services: this.config.services || []
    });

    // Send as UI frame (broadcast)
    const ax25 = require('../ax25');
    const uiFrame = ax25.buildUIFrame(
      this.localCallsign,
      'CQ',
      helloPacket,
      BACKBONE_PID
    );

    this._transmitFrame(uiFrame);
    console.log('[RFTransport] Sent HELLO broadcast');
  }

  /**
   * Disconnect from RF transport
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (!this.connected) {
      return;
    }

    // Send DISC to all connected stations
    for (const [callsign, session] of this.sessions) {
      if (session.connected) {
        const discFrame = buildDISC(this.localCallsign, callsign);
        this._transmitFrame(discFrame);
      }
    }

    this.sessions.clear();
    this.rxBuffer.clear();
    this.connected = false;

    console.log('[RFTransport] Disconnected');
    this.emit('disconnected');
  }

  /**
   * Send data to a destination via RF
   * @param {String} destination - Destination callsign
   * @param {Buffer} data - Backbone packet data
   * @param {Object} options
   * @returns {Promise<Boolean>}
   */
  async send(destination, data, options = {}) {
    if (!this.connected) {
      throw new Error('RF transport not connected');
    }

    // Broadcast destinations use UI frames
    if (destination === 'CQ' || destination === 'NODES') {
      return this._sendBroadcast(destination, data);
    }

    // Connected-mode transmission
    return this._sendConnected(destination, data, options);
  }

  /**
   * Send broadcast via UI frame
   * @private
   */
  async _sendBroadcast(destination, data) {
    const ax25 = require('../ax25');
    const uiFrame = ax25.buildUIFrame(
      this.localCallsign,
      destination,
      data,
      BACKBONE_PID
    );

    this._transmitFrame(uiFrame);
    this._updateMetrics('send', data.length);
    return true;
  }

  /**
   * Send via connected-mode I-frames
   * @private
   */
  async _sendConnected(destination, data, options) {
    let session = this.sessions.get(destination);

    // Establish connection if not already connected
    if (!session || !session.connected) {
      await this._establishConnection(destination);
      session = this.sessions.get(destination);
    }

    // Fragment if data exceeds MTU
    const fragments = this._fragmentData(data, RF_MTU);

    for (const fragment of fragments) {
      const iframe = buildAx25IFrame(
        this.localCallsign,
        destination,
        fragment,
        session.ns,
        session.nr,
        BACKBONE_PID
      );

      this._transmitFrame(iframe);
      session.ns = (session.ns + 1) % 8;
      this._updateMetrics('send', fragment.length);
    }

    return true;
  }

  /**
   * Establish AX.25 connection
   * @private
   */
  async _establishConnection(destination) {
    return new Promise((resolve, reject) => {
      // Send SABM
      const sabmFrame = buildSABM(this.localCallsign, destination);
      this._transmitFrame(sabmFrame);

      // Wait for UA response (with timeout)
      const timeout = setTimeout(() => {
        reject(new Error(`Connection timeout to ${destination}`));
      }, 10000); // 10 second timeout

      const onConnection = (callsign) => {
        if (callsign === destination) {
          clearTimeout(timeout);
          this.removeListener('connection', onConnection);
          resolve();
        }
      };

      this.on('connection', onConnection);
    });
  }

  /**
   * Fragment data into MTU-sized chunks
   * @private
   */
  _fragmentData(data, mtu) {
    const fragments = [];
    let offset = 0;

    while (offset < data.length) {
      const end = Math.min(offset + mtu, data.length);
      fragments.push(data.slice(offset, end));
      offset = end;
    }

    return fragments;
  }

  /**
   * Get RF transport cost
   * @returns {Number}
   */
  getCost() {
    return RF_COST;
  }

  /**
   * Get MTU for RF transport
   * @returns {Number}
   */
  getMTU() {
    return RF_MTU;
  }

  /**
   * Check if RF transport is available
   * @returns {Boolean}
   */
  isAvailable() {
    if (!this.connected) {
      return false;
    }

    const channel = this.channelManager.channels.get(this.channelId);
    return channel && channel.enabled;
  }
}

module.exports = RFTransport;
