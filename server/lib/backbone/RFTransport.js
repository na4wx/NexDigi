/**
 * RFTransport.js
 * RF (Radio Frequency) transport for backbone using AX.25 packet radio
 *
 * Integrates with existing ChannelManager for packet transmission
 * Uses connected-mode AX.25 sessions for reliable delivery
 *
 * The control-byte-level frame handling here mirrors server/lib/bbsSession.js
 * (the BBS's own working connected-mode AX.25 implementation), since
 * ax25.js only exports a single generic buildAx25Frame({dest, src, control,
 * pid, payload}) - there are no dedicated buildSABM/buildUA/buildDISC/
 * buildDM/buildRR/buildAx25IFrame/buildUIFrame helpers. An earlier version
 * of this file called those non-existent functions, so RF backbone
 * transport never actually worked; see server/lib/ax25.js for the real
 * exports and server/lib/bbsSession.js for a proven reference
 * implementation of the same control-byte conventions used below.
 */

const Transport = require('./Transport');
const { PacketFormat, PacketType, PacketFlags } = require('./PacketFormat');
const { parseAx25Frame, buildAx25Frame, _callsignBase } = require('../ax25');

// Default AX.25 PID for backbone traffic (0xF0 = no layer 3)
const BACKBONE_PID = 0xF0;

// RF transport cost (higher than Internet, reflects slower/less reliable medium)
const RF_COST = 500;

// AX.25 MTU (conservative, accounting for header overhead)
const RF_MTU = 200;

// AX.25 U-frame control byte values (unnumbered frames; P/F bit is bit 4)
const CTL_UA = 0x63;   // Unnumbered Acknowledgment
const CTL_DM = 0x0F;   // Disconnect Mode
const CTL_DISC = 0x43; // Disconnect

class RFTransport extends Transport {
  constructor(config, channelManager) {
    super(config);
    this.type = 'rf';
    this.channelManager = channelManager;
    this.channelId = config.channelId; // Which channel to use for backbone
    this.sessions = new Map(); // callsign -> { connected, nr, ns, remoteNr }
    this.rxBuffer = new Map(); // callsign -> Buffer for reassembly
    this._pendingConnections = new Map(); // callsign -> array of {resolve, reject, timeout}

    // Bind to ChannelManager events
    this._setupChannelListeners();
  }

  /**
   * Format an ax25.js address ({callsign, ssid}) as a "CALL-SSID" string
   * (or bare "CALL" when SSID is 0), matching the convention used
   * throughout the rest of the backbone (BackboneManager, InternetTransport)
   * and by bbsSession.js.
   * @private
   */
  _formatAddr(addr) {
    if (!addr) return '';
    return addr.ssid ? `${addr.callsign}-${addr.ssid}` : addr.callsign;
  }

  /**
   * Setup listeners for channel events
   * @private
   */
  _setupChannelListeners() {
    if (!this.channelManager) {
      throw new Error('ChannelManager required for RFTransport');
    }

    // ChannelManager emits a single event object { channel, raw, length },
    // not (frame, metadata) - and .raw is a hex string, not a Buffer.
    this.channelManager.on('frame', (event) => {
      if (event.channel === this.channelId) {
        try {
          this._handleIncomingFrame(Buffer.from(event.raw, 'hex'));
        } catch (error) {
          this._recordError(error);
          console.error('[RFTransport] Error handling frame:', error.message);
        }
      }
    });
  }

  /**
   * Handle incoming AX.25 frame
   * @private
   */
  _handleIncomingFrame(frameBuffer) {
    const parsed = parseAx25Frame(frameBuffer);
    const destAddr = parsed.addresses && parsed.addresses[0];
    const srcAddr = parsed.addresses && parsed.addresses[1];
    if (!destAddr || !srcAddr) return;

    const dest = this._formatAddr(destAddr);
    const source = this._formatAddr(srcAddr);

    // Only handle frames destined to us or broadcast
    if (_callsignBase(dest) !== _callsignBase(this.localCallsign) &&
        dest !== 'CQ' && dest !== 'NODES') {
      return;
    }

    // Classify the frame by its control byte - ax25.js/parseAx25Frame
    // don't classify frame types themselves, this mirrors bbsSession.js.
    const ctl = parsed.control & 0xFF;
    const looksLikeSABM = (ctl === 0x2F) || (ctl === 0x6F) || (ctl === 0x3F);
    const isUA = (ctl & ~0x10) === CTL_UA; // UA with or without the P/F bit set
    const isUI = ctl === 0x03;
    const isI = (ctl & 0x01) === 0x00 && !looksLikeSABM;
    const isSupervisory = (ctl & 0x03) === 0x01;

    if (looksLikeSABM) {
      const pf = (ctl & 0x10) ? 1 : 0;
      this._handleSABM(source, pf);
    } else if (isUA) {
      this._handleUA(source);
    } else if (ctl === CTL_DISC) {
      this._handleDISC(source);
    } else if (isUI) {
      this._handleUIFrame(source, parsed);
    } else if (isI) {
      this._handleIFrame(source, ctl, parsed);
    } else if (isSupervisory) {
      this._handleSupervisory(source, ctl);
    }
  }

  /**
   * Handle UA (Unnumbered Acknowledgment) - the response to a SABM *we*
   * sent, i.e. the peer accepted our connection request.
   * @private
   */
  _handleUA(callsign) {
    if (!this.sessions.has(callsign)) {
      this.sessions.set(callsign, { connected: true, nr: 0, ns: 0, remoteNr: 0 });
    } else {
      this.sessions.get(callsign).connected = true;
    }
    console.log(`[RFTransport] Connection to ${callsign} accepted (UA received)`);
    this._resolvePending(callsign);
  }

  /**
   * Handle SABM (connection request)
   * @private
   */
  _handleSABM(callsign, pf = 0) {
    this.sessions.set(callsign, {
      connected: true,
      nr: 0,
      ns: 0,
      remoteNr: 0
    });

    this._sendUA(callsign, pf);

    this.emit('connection', callsign);
    console.log(`[RFTransport] Accepted connection from ${callsign}`);

    // Resolve any pending _establishConnection() waiting on this peer
    // (handles the case where both sides SABM each other simultaneously).
    this._resolvePending(callsign);
  }

  /**
   * Send UA (Unnumbered Acknowledgment)
   * @private
   */
  _sendUA(destination, pf = 0) {
    const ctl = (CTL_UA | ((pf & 0x01) << 4)) & 0xFF;
    const frame = buildAx25Frame({ dest: destination, src: this.localCallsign, control: ctl, pid: null, payload: Buffer.alloc(0) });
    this._transmitFrame(frame);
  }

  /**
   * Handle DISC (disconnect request)
   * @private
   */
  _handleDISC(callsign) {
    this.sessions.delete(callsign);
    this.rxBuffer.delete(callsign);

    const frame = buildAx25Frame({ dest: callsign, src: this.localCallsign, control: CTL_DM, pid: null, payload: Buffer.alloc(0) });
    this._transmitFrame(frame);

    this.emit('disconnect', callsign);
    console.log(`[RFTransport] Disconnected from ${callsign}`);
  }

  /**
   * Handle I-frame (information frame with data)
   * @private
   */
  _handleIFrame(callsign, ctl, parsed) {
    let session = this.sessions.get(callsign);
    if (!session) {
      // Tolerate receiving data from a peer we don't have an explicit
      // session for yet (e.g. we lost state but they think they're still
      // connected) rather than silently dropping backbone traffic.
      session = { connected: true, nr: 0, ns: 0, remoteNr: 0 };
      this.sessions.set(callsign, session);
    }

    // Extract N(S) and N(R) from the I-frame control byte (bits 1-3 = N(S),
    // bits 5-7 = N(R)) - parseAx25Frame doesn't decode these itself.
    const incomingNs = (ctl >> 1) & 0x07;
    const incomingNr = (ctl >> 5) & 0x07;
    session.nr = (incomingNs + 1) % 8;
    session.remoteNr = incomingNr;

    if (parsed.pid !== BACKBONE_PID) {
      console.log(`[RFTransport] Received I-frame with non-backbone PID: ${parsed.pid}`);
      return;
    }

    // Accumulate payload and try to decode a complete backbone packet.
    // AX.25 I-frames within one connected-mode session arrive in order and
    // are individually reliable (covered by RR/REJ below), so simple
    // concatenation is sufficient here - unlike the connectionless
    // DATA/broadcast path, which uses FragmentationManager's explicit
    // sequence-numbered fragments instead.
    let buffer = this.rxBuffer.get(callsign) || Buffer.alloc(0);
    buffer = Buffer.concat([buffer, parsed.payload]);

    try {
      const packet = PacketFormat.decode(buffer);
      this.rxBuffer.delete(callsign);
      this._updateMetrics('receive', buffer.length);

      this.emit('packet', {
        ...packet,
        transport: 'rf',
        peer: callsign
      });
    } catch (error) {
      if (error.message.includes('too small') || error.message.includes('Incomplete')) {
        // Need more fragments - keep buffer
        this.rxBuffer.set(callsign, buffer);
      } else {
        console.error(`[RFTransport] Failed to decode packet from ${callsign}:`, error.message);
        this.rxBuffer.delete(callsign);
        this._recordError(error);
      }
    }

    // Acknowledge receipt regardless of whether the packet is complete yet.
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
   * Handle a supervisory frame (RR/RNR/REJ/SREJ)
   * @private
   */
  _handleSupervisory(callsign, ctl) {
    const type = (ctl >> 2) & 0x03; // 0=RR, 1=RNR, 2=REJ, 3=SREJ
    const nr = (ctl >> 5) & 0x07;
    const session = this.sessions.get(callsign) || { connected: true, nr: 0, ns: 0, remoteNr: 0 };

    session.remoteNr = nr;
    if (type === 2) {
      // REJ: peer is rejecting frames and expects us to resend from N(R)
      session.ns = nr;
      console.log(`[RFTransport] REJ N(R)=${nr} from ${callsign}, resetting ns`);
    }
    this.sessions.set(callsign, session);
  }

  /**
   * Send RR (Receive Ready) acknowledgment
   * @private
   */
  _sendRR(callsign, nr) {
    // Supervisory control byte: bits 5-7 = N(R), bits 2-3 = type (0=RR), bit0=1
    const ctl = (((nr & 0x07) << 5) | (0 << 2) | 0x01) & 0xFF;
    const frame = buildAx25Frame({ dest: callsign, src: this.localCallsign, control: ctl, pid: null, payload: Buffer.alloc(0) });
    this._transmitFrame(frame);
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

    this.channelManager.sendFrame(this.channelId, frame);
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

    const uiFrame = buildAx25Frame({
      dest: 'CQ',
      src: this.localCallsign,
      pid: BACKBONE_PID,
      payload: helloPacket
    });

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
        try {
          const frame = buildAx25Frame({ dest: callsign, src: this.localCallsign, control: CTL_DISC, pid: null, payload: Buffer.alloc(0) });
          this._transmitFrame(frame);
        } catch (error) {
          console.error(`[RFTransport] Error sending DISC to ${callsign}:`, error.message);
        }
      }
    }

    // Fail any connections still being established
    for (const [callsign, pending] of this._pendingConnections) {
      for (const p of pending) {
        clearTimeout(p.timeout);
        p.reject(new Error('RF transport disconnecting'));
      }
    }
    this._pendingConnections.clear();

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
    const uiFrame = buildAx25Frame({
      dest: destination,
      src: this.localCallsign,
      pid: BACKBONE_PID,
      payload: data
    });

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
      const ns = session.ns & 0x07;
      const nr = session.nr & 0x07;
      // I-frame control byte: bits 5-7 = N(R), bit 4 = P/F, bits 1-3 = N(S), bit0 = 0
      const ctl = (((nr & 0x07) << 5) | ((ns & 0x07) << 1) | 0x00) & 0xFF;
      const iframe = buildAx25Frame({
        dest: destination,
        src: this.localCallsign,
        control: ctl,
        pid: BACKBONE_PID,
        payload: fragment
      });

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
      // SABM (control 0x2F, no P/F needed on the initial request)
      const sabmFrame = buildAx25Frame({ dest: destination, src: this.localCallsign, control: 0x2F, pid: null, payload: Buffer.alloc(0) });
      this._transmitFrame(sabmFrame);

      const timeout = setTimeout(() => {
        const pending = this._pendingConnections.get(destination) || [];
        this._pendingConnections.set(destination, pending.filter(p => p.reject !== reject));
        reject(new Error(`Connection timeout to ${destination}`));
      }, 10000); // 10 second timeout

      if (!this._pendingConnections.has(destination)) {
        this._pendingConnections.set(destination, []);
      }
      this._pendingConnections.get(destination).push({ resolve, reject, timeout });
    });
  }

  /**
   * Resolve any pending _establishConnection() calls waiting on this peer
   * @private
   */
  _resolvePending(callsign) {
    const pending = this._pendingConnections.get(callsign);
    if (!pending || pending.length === 0) return;
    for (const p of pending) {
      clearTimeout(p.timeout);
      p.resolve();
    }
    this._pendingConnections.delete(callsign);
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
