const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const net = require('net');
const { writeJsonAtomicSync } = require('./fileHelpers');
const { parseAx25Frame, buildAx25Frame } = require('./ax25');

// Sessions map a client (callsign+channel) to an upstream connection
class WinlinkManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.settingsPath = options.settingsPath || path.join(__dirname, '..', 'data', 'winlinkSettings.json');
    this.manager = options.manager || null; // ChannelManager
    console.log('[WinlinkManager] Constructor: manager type:', this.manager?.constructor?.name, 'manager exists:', !!this.manager);
    // Reference to runtime digipeater settings so we can honor per-channel flags
    this.digipeaterSettings = options.digipeaterSettings || null;
    this.settings = { enabled: false, gatewayCallsign: '', host: '', port: 0, password: '', autoConnect: false, channels: {} };
  this.status = { running: false, sessions: 0, lastError: null };
  this.sessions = new Map(); // key -> { clientCall, clientChannel, upstreamSocket or mode, lastActivity, bytesIn, bytesOut }
  this.ax25Sessions = new Map(); // key -> { sendSeq: 0, recvSeq: 0, connected: true } for connected-mode tracking
  this.messageStore = new Map(); // key -> { messages: [...] } for pending messages per callsign
  this._cleanupInterval = null;
  this.sessionTimeoutSec = (options.sessionTimeoutSec && Number(options.sessionTimeoutSec)) || 300; // default 5 minutes
    this._loadSettings();
    this._onFrame = this._onFrame.bind(this);
  }

  _loadSettings() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const raw = fs.readFileSync(this.settingsPath, 'utf8') || '{}';
        const j = JSON.parse(raw || '{}');
        this.settings = Object.assign(this.settings, j || {});
        // Clean up any legacy upstream structure
        if (this.settings.upstream) {
          delete this.settings.upstream;
        }
      }
    } catch (e) {
      console.error('WinlinkManager: failed to load settings', e);
    }
    this.status.running = !!this.settings.enabled;
  }

  saveSettings(newSettings) {
    try {
      Object.assign(this.settings, newSettings || {});
      try {
        writeJsonAtomicSync(this.settingsPath, this.settings);
      } catch (atomicError) {
        // Fallback to simple write on Windows EPERM issues
        console.warn('WinlinkManager: atomic write failed, falling back to simple write:', atomicError.message);
        require('fs').writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf8');
      }
      // apply configured session timeout if provided
      if (this.settings.sessionTimeoutSec) this.sessionTimeoutSec = Number(this.settings.sessionTimeoutSec) || this.sessionTimeoutSec;
      this.status.running = !!this.settings.enabled;
      return this.settings;
    } catch (e) {
      console.error('WinlinkManager: failed to save settings', e);
      throw e;
    }
  }

  getSettings() { return this.settings; }
  getStatus() { return Object.assign({}, this.status); }

  async start() {
    console.log('[WinlinkManager] start() called, enabled:', this.settings.enabled, 'current running status:', this.status.running);
    if (!this.settings.enabled) {
      console.log('[WinlinkManager] Winlink is disabled');
      this.status.lastError = 'disabled';
      return false;
    }
    if (!this.manager) {
      console.log('[WinlinkManager] No channel manager available');
      this.status.lastError = 'no channel manager';
      return false;
    }
    if (this.status.running) {
      console.log('[WinlinkManager] Already running - resetting and continuing...');
      // Force reset the running status and continue - this might be a restart
      this.status.running = false;
    }
    console.log('[WinlinkManager] Attaching frame listener and starting...');
    // Attach frame listener
    this.manager.on('frame', this._onFrame);
    console.log('[WinlinkManager] Frame listener attached to manager, listener count:', this.manager.listenerCount('frame'));
    
    // Debug: Removed verbose frame event logging to reduce terminal clutter
    // this.manager.on('frame', (evt) => {
    //   console.log('[WinlinkManager] DEBUG: Frame event received by test listener, channel:', evt?.channel);
    // });
    
    // start cleanup timer
    if (!this._cleanupInterval) {
      this._cleanupInterval = setInterval(() => this._cleanupSessions(), 10 * 1000);
    }
    this.status.running = true;
    this.emit('started');
    return true;
  }

  async stop() {
    if (!this.manager) return false;
    this.manager.off('frame', this._onFrame);
    // cleanup sessions
    for (const [k, s] of this.sessions.entries()) {
      try { if (s.upstreamSocket && typeof s.upstreamSocket.destroy === 'function') s.upstreamSocket.destroy(); } catch (e) {}
    }
    this.sessions.clear();
    if (this._cleanupInterval) { clearInterval(this._cleanupInterval); this._cleanupInterval = null; }
    this.status.sessions = 0;
    this.status.running = false;
    this.emit('stopped');
    return true;
  }

  // Return array of session metadata for UI
  listSessions() {
    const out = [];
    for (const [k, s] of this.sessions.entries()) {
      out.push({ key: k, clientCall: s.clientCall, clientChannel: s.clientChannel, lastActivity: s.lastActivity, bytesIn: s.bytesIn || 0, bytesOut: s.bytesOut || 0, upstreamMode: s.upstreamMode || (s.upstreamSocket ? 'tcp' : 'radio') });
    }
    return out;
  }

  // Terminate a session by key
  terminateSession(key) {
    const s = this.sessions.get(key);
    if (!s) return false;
    try {
      if (s.upstreamSocket && typeof s.upstreamSocket.destroy === 'function') s.upstreamSocket.destroy();
    } catch (e) {}
    this.sessions.delete(key);
    this.status.sessions = this.sessions.size;
    return true;
  }

  // Periodic cleanup based on lastActivity
  _cleanupSessions() {
    try {
      const now = Date.now();
      const timeoutMs = (this.sessionTimeoutSec || 300) * 1000;
      
      // Clean up regular sessions
      for (const [k, s] of this.sessions.entries()) {
        const last = s.lastActivity || s.createdAt || 0;
        if (now - last > timeoutMs) {
          try { if (s.upstreamSocket && typeof s.upstreamSocket.destroy === 'function') s.upstreamSocket.destroy(); } catch (e) {}
          this.sessions.delete(k);
        }
      }
      
      // Handle pending RR acknowledgments for AX.25 sessions
      for (const [axKey, axSession] of this.ax25Sessions.entries()) {
        if (axSession.needsAck && axSession.connected && 
            now - axSession.lastPollTime > 5000) { // Send delayed ack after 5 seconds
          try {
            const [channel, remoteCall] = axKey.split('::');
            const rrControl = 0x01 | (axSession.recvSeq << 5); // RR with current recvSeq as Nr
            console.log(`[WinlinkManager] 📤 Sending delayed RR acknowledgment: control=0x${rrControl.toString(16)}, Nr=${axSession.recvSeq}`);
            this._sendAx25Frame(channel, remoteCall, axSession.localCall, rrControl, null, '', 'response');
            axSession.needsAck = false;
            axSession.lastRRSent = now;
          } catch (e) {
            console.error(`[WinlinkManager] Error sending delayed RR for ${axKey}:`, e);
          }
        }
      }
      
      this.status.sessions = this.sessions.size;
    } catch (e) { console.error('WinlinkManager: cleanup error', e); }
  }

  // Helper method to send raw AX.25 frames
  _sendAx25Frame(channel, dest, src, control, pid, payload, commandType) {
    try {
      const frame = buildAx25Frame({ 
        dest, 
        src, 
        control, 
        pid: pid, 
        payload: payload || '',
        commandType
      });
      if (this.manager && this.manager.sendFrame) {
        this.manager.sendFrame(channel, frame);
        console.log(`[WinlinkManager] 📡 Sent AX.25 frame: ${src} -> ${dest}, control=0x${control.toString(16)}`);
        // Debug: special trace when sending UA frames to find duplicates
        if ((control & 0xFF) === 0x63) {
          console.log(`[WinlinkManager] 🔍 UA sent on channel: ${channel}`);
        }
      }
    } catch (e) {
      console.error('WinlinkManager: failed sending AX.25 frame', e);
    }
  }

  // Helper method to send I-frame with sequence numbers
  _sendIFrame(channel, dest, src, payload, ax25Session, pfFinal=false) {
    const control = (ax25Session.sendSeq << 1) | (ax25Session.recvSeq << 5); // I-frame with Ns/Nr
    // Optionally set Poll/Final (P/F) bit (bit 4) on first outbound frame to prompt acknowledgement
    const ctl = pfFinal ? (control | 0x10) : control;
    this._sendAx25Frame(channel, dest, src, ctl, 0xF0, payload, 'command'); // RMS sends COMMAND frames to client
    ax25Session.sendSeq = (ax25Session.sendSeq + 1) % 8; // Increment send sequence
  }

  // Initialize B2F session immediately after AX.25 connection
  async _initializeB2FSession(channel, clientCall, listenCall) {
    const clientKey = `${channel}::${clientCall}`;
    
    // Initialize session data
    const sessionData = { 
      createdAt: Date.now(),
      lastActivity: Date.now(),
      b2fState: {
        phase: 'initial_connect',
        authenticated: false,
        pendingChallenge: null,
        awaitingClientResponse: false
      }
    };
    this.sessions.set(clientKey, sessionData);
    
    // Send SID (System Identification) string immediately
    // Match the exact sequence from real Winlink RMS: connection msg, CMS connected, SID, challenge, prompt
    console.log(`[WinlinkManager] 📋 Starting RMS protocol sequence`);
    
    // Frame 1: Connection attempt message (with Poll bit to request RR)
    const connMsg = `*** Connected to WL2K-5.0.17.0\r\n`;
    await this._sendB2FResponse(channel, clientCall, listenCall, connMsg);
    
    // Frame 2: CMS connection confirmation (exact format from real RMS)
    setTimeout(async () => {
      const cmsMsg = `*** ${clientCall} Connected to CMS\r\n`;
      console.log(`[WinlinkManager] 🔗 Sending CMS connection: ${cmsMsg.trim()}`);
      await this._sendB2FResponse(channel, clientCall, listenCall, cmsMsg);
      
      // Frame 3: Send SID (with Poll bit to request RR - match WB4GBI pattern)
      setTimeout(async () => {
        // Try the exact SID format that Winlink Express might expect
        const sid = `[WL2K-5.0.17.0-B2FWIHJM$]\r\n`;
        console.log(`[WinlinkManager] 📋 Sending RMS SID: ${sid.trim()}`);
        await this._sendB2FResponseWithPoll(channel, clientCall, listenCall, sid, true); // Force Poll bit
        
        // Frame 4: Send challenge (without Poll initially)
        setTimeout(async () => {
          const challenge = this._generateAuthChallenge();
          sessionData.b2fState.pendingChallenge = challenge;
          sessionData.b2fState.awaitingClientResponse = true;
          sessionData.b2fState.phase = 'awaiting_auth';
          const challengeMsg = `;PQ: ${challenge}\r\n`;
          console.log(`[WinlinkManager] 🔐 Sending auth challenge: ${challenge}`);
          await this._sendB2FResponse(channel, clientCall, listenCall, challengeMsg);
          
          // Frame 5: Send prompt with Poll bit to complete sequence and request response
          setTimeout(async () => {
            const prompt = `CMS via NexDigi >\r\n`;
            console.log(`[WinlinkManager] 💬 Sending RMS prompt - waiting for client response`);
            await this._sendB2FResponseWithPoll(channel, clientCall, listenCall, prompt, true); // Force Poll bit
            
            // Now we wait for client to respond with ;FW: command
            console.log(`[WinlinkManager] ⏳ RMS sequence complete, waiting for client response...`);
          }, 200);
        }, 200);
      }, 200);
    }, 200);
  }

  // Handle B2F (FBB) protocol for local RMS mode
  async _handleB2FProtocol(channel, clientCall, listenCall, payload) {
    const clientKey = `${channel}::${clientCall}`;
    const sessionData = this.sessions.get(clientKey);
    
    const payloadStr = payload.toString('ascii').trim();
    console.log(`[WinlinkManager] 🔄 B2F Protocol: Received from ${clientCall}: "${payloadStr.substring(0, 100)}${payloadStr.length > 100 ? '...' : ''}"`);
    
    // Debug session state
    console.log(`[WinlinkManager] 🔍 Session debug - clientKey: ${clientKey}`);
    console.log(`[WinlinkManager] 🔍 Session exists: ${!!sessionData}`);
    if (sessionData) {
      console.log(`[WinlinkManager] 🔍 Session has b2fState: ${!!sessionData.b2fState}`);
      if (sessionData.b2fState) {
        console.log(`[WinlinkManager] 🔍 B2F phase: ${sessionData.b2fState.phase}`);
      }
    }
    
    // Check if we have session data and B2F state
    if (!sessionData || !sessionData.b2fState) {
      console.log(`[WinlinkManager] ⚠️ No B2F session found for ${clientCall}`);
      
      // If client is sending us data before we initiated, they might be trying to start the protocol
      // Let's check what they're sending
      if (payloadStr.trim().length > 0) {
        console.log(`[WinlinkManager] 📨 Client ${clientCall} sent initial data: "${payloadStr}"`);
        
        // Check if this looks like a client trying to initiate Winlink protocol
        if (payloadStr.startsWith(';FW:') || payloadStr.includes('[') && payloadStr.includes('Express')) {
          console.log(`[WinlinkManager] 🚀 Client is initiating Winlink protocol, handling...`);
          
          // Create session to handle client-initiated protocol
          const sessionData = { 
            createdAt: Date.now(),
            lastActivity: Date.now(),
            b2fState: {
              phase: 'client_initiated',
              authenticated: false,
              pendingChallenge: null,
              awaitingClientResponse: false
            }
          };
          this.sessions.set(clientKey, sessionData);
          
          // Handle this message in the client_initiated phase
          // Continue processing instead of returning
        } else {
          console.log(`[WinlinkManager] ❓ Unknown client message during session init: "${payloadStr}"`);
          console.log(`[WinlinkManager] ❓ Ignoring - not reinitializing`);
          return;
        }
      } else {
        console.log(`[WinlinkManager] 📭 Empty message, no existing session - ignoring`);
        return;
      }
    }

    // Get the session data (either existing or newly created above)
    const currentSessionData = this.sessions.get(clientKey);
    if (!currentSessionData || !currentSessionData.b2fState) {
      console.log(`[WinlinkManager] ❌ Failed to create or retrieve B2F session for ${clientCall}`);
      return;
    }
    
    // Update lastActivity
    currentSessionData.lastActivity = Date.now();
    
    const state = currentSessionData.b2fState;
    console.log(`[WinlinkManager] 🔍 Current session phase: ${state.phase}, payload: "${payloadStr}"`);
    
    // Handle different B2F protocol phases
    switch (state.phase) {
      case 'client_initiated':
        // Client started the protocol - respond appropriately
        if (payloadStr.startsWith(';FW:')) {
          console.log(`[WinlinkManager] ✅ Client initiated with FW command: ${payloadStr}`);
          
          // Don't send SID again - we already sent it in the RMS sequence
          // Just transition to the SID exchange phase to handle subsequent client messages
          state.phase = 'sid_exchange';
        } else if (payloadStr.includes('[') && payloadStr.includes('Express')) {
          console.log(`[WinlinkManager] ✅ Client sent SID: ${payloadStr}`);
          state.phase = 'client_sid_exchange';
        } else if (payloadStr.startsWith(';') && payloadStr.includes('DE')) {
          console.log(`[WinlinkManager] ✅ Client sent location info: ${payloadStr}`);
          // Transition to message_exchange phase to handle subsequent FC commands
          state.phase = 'message_exchange';
          console.log(`[WinlinkManager] 🔄 Transitioned to message_exchange phase after location info`);
        } else if (payloadStr.trim() === 'FF') {
          console.log(`[WinlinkManager] ✅ Client finished proposals`);
          // Send our proposals now
          await this._sendPendingMessages(channel, clientCall, listenCall);
        } else if (payloadStr.startsWith('FC') || payloadStr.startsWith('F>')) {
          console.log(`[WinlinkManager] 📨 Client sending message proposal in client_initiated phase`);
          // Transition to message_exchange phase first
          state.phase = 'message_exchange';
          console.log(`[WinlinkManager] 🔄 Transitioned to message_exchange phase for FC command`);
          // Then handle the message proposal
          await this._handleMessageProposal(channel, clientCall, listenCall, payloadStr);
        } else if (payloadStr.startsWith('FC ')) {
          console.log(`[WinlinkManager] 📋 FC command in client_initiated phase: ${payloadStr}`);
          // Transition to message_exchange phase first
          state.phase = 'message_exchange';
          console.log(`[WinlinkManager] 🔄 Transitioned to message_exchange for FC handling`);
          // Then handle the message proposal
          await this._handleMessageProposal(channel, clientCall, listenCall, payloadStr);
        } else {
          console.log(`[WinlinkManager] ❓ Unexpected client-initiated message: ${payloadStr}`);
        }
        break;
        
      case 'sid_exchange':
        // Handle client SID exchange sequence after FW command
        if (payloadStr.includes('[') && payloadStr.includes('Express')) {
          console.log(`[WinlinkManager] ✅ Received client SID: ${payloadStr}`);
          state.phase = 'client_sid_exchange';
        } else if (payloadStr.startsWith(';') && payloadStr.includes('DE')) {
          console.log(`[WinlinkManager] ✅ Client sent location info: ${payloadStr}`);
          // Continue in sid_exchange phase to handle FF or message proposals
        } else if (payloadStr.trim() === 'FF') {
          console.log(`[WinlinkManager] ✅ Client finished proposals`);
          await this._sendPendingMessages(channel, clientCall, listenCall);
        } else if (payloadStr.startsWith('FC') || payloadStr.startsWith('F>')) {
          console.log(`[WinlinkManager] 📨 Client sending message proposal in sid_exchange phase`);
          // Transition to message_exchange phase first
          state.phase = 'message_exchange';
          // Then handle the message proposal
          await this._handleMessageProposal(channel, clientCall, listenCall, payloadStr);
        } else {
          console.log(`[WinlinkManager] 📝 Received other data during SID exchange: ${payloadStr}`);
        }
        break;
        
      case 'initial_connect':
        console.log(`[WinlinkManager] 🔄 In initial_connect phase, unexpected client data: ${payloadStr}`);
        break;
        
      case 'awaiting_auth':
        // Handle client responses during authentication sequence
        if (payloadStr.startsWith(';FW:')) {
          console.log(`[WinlinkManager] ✅ Received FW command: ${payloadStr}`);
          state.phase = 'client_sid_exchange';
          state.awaitingClientResponse = false;
        } else if (payloadStr.includes('[') && payloadStr.includes('Express')) {
          console.log(`[WinlinkManager] ✅ Received client SID: ${payloadStr}`);
          // Client sent their SID, continue to expect auth response
        } else if (payloadStr.startsWith(';PR:')) {
          console.log(`[WinlinkManager] ✅ Received auth response: ${payloadStr}`);
          state.authenticated = true;
          state.phase = 'message_exchange';
        } else if (payloadStr.trim() === 'FF') {
          console.log(`[WinlinkManager] ✅ Client finished proposals`);
          // Send our proposals now
          await this._sendPendingMessages(channel, clientCall, listenCall);
        } else {
          console.log(`[WinlinkManager] 📝 Received other data during SID exchange: ${payloadStr}`);
        }
        break;
        
      case 'client_sid_exchange':
        // Continue handling client SID exchange sequence
        if (payloadStr.includes('[') && payloadStr.includes('Express')) {
          console.log(`[WinlinkManager] ✅ Received client SID: ${payloadStr}`);
        } else if (payloadStr.startsWith(';PR:')) {
          console.log(`[WinlinkManager] ✅ Received auth response: ${payloadStr}`);
          state.authenticated = true;
          state.phase = 'message_exchange';
        } else if (payloadStr.includes(' DE ') && payloadStr.includes('(')) {
          console.log(`[WinlinkManager] 📍 Received location info: ${payloadStr}`);
          // Update session phase after receiving location info
          state.phase = 'message_exchange';
          console.log(`[WinlinkManager] 🔄 Session phase updated to: ${state.phase}`);
        } else if (payloadStr.startsWith('FC ')) {
          console.log(`[WinlinkManager] 📋 FC command received in client_sid_exchange: ${payloadStr}`);
          // Update session phase for message proposal handling
          state.phase = 'message_exchange';
          console.log(`[WinlinkManager] 🔄 Session phase updated to: ${state.phase} for FC handling`);
          await this._handleMessageProposal(channel, clientCall, listenCall, payloadStr);
        } else if (payloadStr.trim() === 'FF') {
          console.log(`[WinlinkManager] ✅ Client finished proposals`);
          await this._sendPendingMessages(channel, clientCall, listenCall);
        }
        break;
        
      case 'auth_challenge':
        // Handle authentication response
        if (payloadStr.startsWith(';PR:')) {
          const response = payloadStr.substring(4).trim();
          console.log(`[WinlinkManager] 🔑 Received auth response: ${response}`);
          
          // For now, accept any response (in production, validate against user database)
          state.authenticated = true;
          state.phase = 'message_exchange';
          
          // Send pending message proposal
          await this._sendPendingMessages(channel, clientCall, listenCall);
        }
        break;
        
      case 'message_exchange':
        // Handle message proposals and transfers
        console.log(`[WinlinkManager] 📋 Processing in message_exchange phase: "${payloadStr}"`);
        
        // Check if payload contains both FC and F> (proposal block)
        if (payloadStr.includes('F>') && payloadStr.includes('FC ')) {
          console.log(`[WinlinkManager] 📨 Proposal block contains FC and F>, processing`);
          
          // Split payload into lines and process proposals
          const lines = payloadStr.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
          console.log(`[WinlinkManager] 📋 Proposal block has ${lines.length} lines:`, lines);
          
          // Find FC proposals (everything before F>)
          const proposals = [];
          for (const line of lines) {
            if (line === 'F>' || line.startsWith('F>')) {
              break; // Stop at F>
            }
            if (line.startsWith('FC ')) {
              proposals.push(line);
            }
          }
          
          console.log(`[WinlinkManager] 📨 Found ${proposals.length} FC proposals`);
          
          // Store all proposals
          for (const fcProposal of proposals) {
            const parts = fcProposal.trim().split(/\s+/);
            if (parts.length >= 5) {
              const messageId = parts[2];
              const offset = parts.length > 5 ? parseInt(parts[5]) : 0;
              
              const messageType = parts[1];
              const clientKey = `${channel}::${clientCall}`;
              const sessionData = this.sessions.get(clientKey);
              if (sessionData?.b2fState) {
                sessionData.b2fState.pendingMessageProposal = {
                  messageType,
                  messageId,
                  uncompressedSize: parseInt(parts[3]),
                  compressedSize: parseInt(parts[4]),
                  offset
                };
                console.log(`[WinlinkManager] 📨 Stored FC proposal: ${messageId}`);
              }
            }
          }
          
          // Now send FS response (one + per proposal)
          const fsResponse = 'FS ' + '+'.repeat(Math.max(1, proposals.length)) + '\r\n';
          console.log(`[WinlinkManager] ✓ F> received with FC, sending: "${fsResponse.trim()}"`);
          await this._sendB2FResponse(channel, clientCall, listenCall, fsResponse);
          
          // Update phase
          const clientKey = `${channel}::${clientCall}`;
          const sessionData = this.sessions.get(clientKey);
          if (sessionData?.b2fState) {
            sessionData.b2fState.phase = 'receiving_message';
          }
        } else if (payloadStr.startsWith('FC ')) {
          // FC proposal alone - respond immediately with FS
          console.log(`[WinlinkManager] 📨 FC proposal received alone, responding immediately`);
          
          const parts = payloadStr.trim().split(/\s+/);
          if (parts.length >= 5) {
            const messageId = parts[2];
            const offset = parts.length > 5 ? parseInt(parts[5]) : 0;
            
            // Store FC details
            const messageType = parts[1];
            const clientKey = `${channel}::${clientCall}`;
            const sessionData = this.sessions.get(clientKey);
            if (sessionData?.b2fState) {
              sessionData.b2fState.pendingMessageProposal = {
                messageType,
                messageId,
                uncompressedSize: parseInt(parts[3]),
                compressedSize: parseInt(parts[4]),
                offset
              };
              console.log(`[WinlinkManager] 📨 Stored FC proposal: ${messageId}`);
            }
            
            // Send FS + immediately
            console.log(`[WinlinkManager] ✓ Sending FS + to accept FC proposal`);
            await this._sendB2FResponse(channel, clientCall, listenCall, 'FS +\r\n');
            
            // Wait for F> in next frame
            if (sessionData?.b2fState) {
              sessionData.b2fState.phase = 'awaiting_f_prompt';
            }
          }
        } else if (payloadStr.startsWith('F>')) {
          // F> received - transition to receiving message
          console.log(`[WinlinkManager] ✓ F> received, ready for message content`);
          const clientKey = `${channel}::${clientCall}`;
          const sessionData = this.sessions.get(clientKey);
          if (sessionData?.b2fState) {
            sessionData.b2fState.phase = 'receiving_message';
          }
        } else if (payloadStr.startsWith('F')) {
          console.log(`[WinlinkManager] 📨 Calling _handleMessageProposal for: "${payloadStr}"`);
          await this._handleMessageProposal(channel, clientCall, listenCall, payloadStr);
        } else {
          // This might be message content
          console.log(`[WinlinkManager] 📝 Received potential message content (${payloadStr.length} bytes)`);
          console.log(`[WinlinkManager] 📄 Content preview: "${payloadStr.substring(0, 100)}${payloadStr.length > 100 ? '...' : ''}"`);
          
          // Store the incoming message
          await this._storeIncomingMessage(channel, clientCall, payloadStr);
          
          // Send acknowledgment that we received the message
          await this._sendB2FResponse(channel, clientCall, listenCall, 'FF\r\n');
        }
        break;
        
      case 'awaiting_f_prompt':
        // Waiting for F> after sending FS response
        console.log(`[WinlinkManager] 📋 In awaiting_f_prompt phase, received: "${payloadStr}"`);
        if (payloadStr.startsWith('F>')) {
          console.log(`[WinlinkManager] ✓ F> received, ready for message content`);
          const clientKey = `${channel}::${clientCall}`;
          const sessionData = this.sessions.get(clientKey);
          if (sessionData?.b2fState) {
            sessionData.b2fState.phase = 'receiving_message';
          }
        } else {
          // Might be message content directly (client skipped F>)
          console.log(`[WinlinkManager] 📝 Received content without F> (${payloadStr.length} bytes)`);
          await this._storeIncomingMessage(channel, clientCall, payloadStr);
          await this._sendB2FResponse(channel, clientCall, listenCall, 'FF\r\n');
          
          const clientKey = `${channel}::${clientCall}`;
          const sessionData = this.sessions.get(clientKey);
          if (sessionData?.b2fState) {
            sessionData.b2fState.phase = 'message_exchange';
          }
        }
        break;
        
      case 'receiving_message':
        // Handle incoming message content
        console.log(`[WinlinkManager] 📨 Receiving message content from ${clientCall} (${payloadStr.length} bytes)`);
        console.log(`[WinlinkManager] 📄 Message content: "${payloadStr.substring(0, 200)}${payloadStr.length > 200 ? '...' : ''}"`);
        
        // Store the incoming message
        await this._storeIncomingMessage(channel, clientCall, payloadStr);
        
        // Send acknowledgment and return to message exchange
        state.phase = 'message_exchange';
        await this._sendB2FResponse(channel, clientCall, listenCall, 'FF\r\n');
        break;
    }
  }
  
  // Send B2F protocol response
  async _sendB2FResponse(channel, clientCall, listenCall, message) {
    const ax25Key = `${channel}::${clientCall}`;
    const ax25Session = this.ax25Sessions.get(ax25Key);
    
    if (ax25Session && ax25Session.connected) {
      // Set Poll bit occasionally (like real RMS) - every 3rd frame or so
      const setPoll = (ax25Session.sendSeq % 3) === 0;
      console.log(`[WinlinkManager] 📤 Sending B2F I-frame (Ns=${ax25Session.sendSeq}, Nr=${ax25Session.recvSeq}, Poll=${setPoll}): ${message.trim()}`);
      this._sendIFrame(channel, clientCall, listenCall, message, ax25Session, setPoll);
    } else {
      console.log(`[WinlinkManager] ⚠️ No connected AX.25 session for B2F response`);
    }
  }

  // Send B2F protocol response with explicit Poll bit control
  async _sendB2FResponseWithPoll(channel, clientCall, listenCall, message, forcePoll = false) {
    const ax25Key = `${channel}::${clientCall}`;
    const ax25Session = this.ax25Sessions.get(ax25Key);
    
    if (ax25Session && ax25Session.connected) {
      console.log(`[WinlinkManager] 📤 Sending B2F I-frame (Ns=${ax25Session.sendSeq}, Nr=${ax25Session.recvSeq}, Poll=${forcePoll}): ${message.trim()}`);
      this._sendIFrame(channel, clientCall, listenCall, message, ax25Session, forcePoll);
    } else {
      console.log(`[WinlinkManager] ⚠️ No connected AX.25 session for B2F response`);
    }
  }
  
  // Generate authentication challenge
  _generateAuthChallenge() {
    // Generate 8-character hex challenge
    return Math.random().toString(16).substring(2, 10).toUpperCase();
  }
  
  // Send pending messages proposal
  async _sendPendingMessages(channel, clientCall, listenCall) {
    // Check for pending messages for this callsign
    const userMessages = this.messageStore.get(clientCall) || { messages: [] };
    const pendingCount = userMessages.messages.length;
    
    if (pendingCount > 0) {
      console.log(`[WinlinkManager] 📬 Proposing ${pendingCount} pending messages for ${clientCall}`);
      
      // Build FC proposals for each pending message
      let proposals = '';
      for (let i = 0; i < userMessages.messages.length; i++) {
        const msg = userMessages.messages[i];
        const compressedSize = Buffer.byteLength(msg.content, 'utf8'); // Simplified - should use LZH compression
        const uncompressedSize = compressedSize; // For now, no compression
        
        proposals += `FC EM ${msg.id} ${uncompressedSize} ${compressedSize}\r\n`;
      }
      proposals += 'FF\r\n';
      
      await this._sendB2FResponse(channel, clientCall, listenCall, proposals);
    } else {
      console.log(`[WinlinkManager] 📭 No pending messages for ${clientCall}`);
      // Send FQ (no messages) response per Winlink B2F protocol
      console.log(`[WinlinkManager] � Sending FQ (no messages) response`);
      await this._sendB2FResponse(channel, clientCall, listenCall, 'FQ\r\n');
    }
    
    // Transition to message exchange phase to handle client proposals
    const clientKey = `${channel}::${clientCall}`;
    const sessionData = this.sessions.get(clientKey);
    if (sessionData && sessionData.b2fState) {
      sessionData.b2fState.phase = 'message_exchange';
      console.log(`[WinlinkManager] 🔄 Transitioned to message_exchange phase`);
    }
  }
  
  // Create demo messages for testing
  async _createDemoMessages(callsign) {
    const now = new Date();
    const messages = [
      {
        id: `${Date.now()}_DEMO1`,
        content: this._createWinlinkMessage({
          from: 'SYSOP@WINLINK.ORG',
          to: callsign,
          subject: 'Welcome to NexDigi Winlink Gateway',
          body: 'This is a test message from your local NexDigi Winlink gateway. The system is working correctly!\n\n73,\nNexDigi Team'
        }),
        timestamp: now
      },
      {
        id: `${Date.now()}_DEMO2`,
        content: this._createWinlinkMessage({
          from: 'TEST@WINLINK.ORG',
          to: callsign,
          subject: 'System Status Report',
          body: 'Local RMS gateway is operational.\nMessage handling: ACTIVE\nAX.25 protocol: CONNECTED\n\nYour gateway is ready for message traffic.'
        }),
        timestamp: new Date(now.getTime() + 1000)
      }
    ];
    
    this.messageStore.set(callsign, { messages });
    console.log(`[WinlinkManager] ✅ Created ${messages.length} demo messages for ${callsign}`);
  }
  
  // Create Winlink B2F message format
  _createWinlinkMessage(opts) {
    const { from, to, subject, body, cc = [] } = opts;
    const now = new Date();
    const dateStr = now.toISOString().replace(/T/, ' ').replace(/\..+/, '').replace(/-/g, '/');
    const mid = `${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    
    let header = `Mid: ${mid}\r\n`;
    header += `Date: ${dateStr}\r\n`;
    header += `Type: Private\r\n`;
    header += `From: ${from}\r\n`;
    header += `To: ${to}\r\n`;
    if (cc.length > 0) {
      cc.forEach(addr => header += `Cc: ${addr}\r\n`);
    }
    header += `Subject: ${subject}\r\n`;
    header += `Mbo: NEXDIGI\r\n`;
    header += `Body: ${Buffer.byteLength(body, 'utf8')}\r\n`;
    header += '\r\n'; // Blank line separates header from body
    
    return header + body + '\r\n';
  }
  
  // Handle message proposals (FA, FB, FC)
  async _handleMessageProposal(channel, clientCall, listenCall, proposal) {
    console.log(`[WinlinkManager] 📨 *** ENTERING _handleMessageProposal *** with: "${proposal}"`);
    console.log(`[WinlinkManager] 📨 Processing message proposal: ${proposal}`);
    
    if (proposal.startsWith('FF')) {
      // Client finished - send our quit
      console.log(`[WinlinkManager] ✅ Client finished session, sending FQ`);
      await this._sendB2FResponse(channel, clientCall, listenCall, 'FQ\r\n');
    } else if (proposal.startsWith('FS')) {
      // Client accepted messages - send them
      console.log(`[WinlinkManager] 📤 Client accepted messages, starting transfer`);
      await this._transferAcceptedMessages(channel, clientCall, listenCall, proposal);
    } else if (proposal.startsWith('FC')) {
      // Client proposing message upload
      const parts = proposal.trim().split(/\s+/);
      if (parts.length >= 5) {
        const messageId = parts[2];
        const offset = parts.length > 5 ? parseInt(parts[5]) : 0;
        
        // Store FC details - DON'T send FS yet!
        // Wait for F> before sending FS (per FBB protocol)
        const messageType = parts[1];
        const clientKey = `${channel}::${clientCall}`;
        const sessionData = this.sessions.get(clientKey);
        if (sessionData?.b2fState) {
          sessionData.b2fState.pendingMessageProposal = {
            messageType,
            messageId,
            uncompressedSize: parseInt(parts[3]),
            compressedSize: parseInt(parts[4]),
            offset
          };
          console.log(`[WinlinkManager] 📨 Stored FC proposal: ${messageId}, waiting for F>`);
        }
      } else {
        console.log(`[WinlinkManager] ⚠️ Invalid FC command format: ${proposal}`);
        // Send error or ignore
        await this._sendB2FResponse(channel, clientCall, listenCall, 'FQ\r\n');
      }
    } else if (proposal.startsWith('F>')) {
      // Client ready to send message content
      // NOW we send FS response (per FBB protocol: FC → F> → FS → data)
      const clientKey = `${channel}::${clientCall}`;
      const sessionData = this.sessions.get(clientKey);
      
      // Check if we have pending FC proposal
      if (sessionData?.b2fState?.pendingMessageProposal) {
        // Send FS + to accept the proposal
        console.log(`[WinlinkManager] ✓ F> received, sending FS + to accept proposal`);
        await this._sendB2FResponse(channel, clientCall, listenCall, 'FS +\r\n');
        
        // Update phase to receiving
        sessionData.b2fState.phase = 'receiving_message';
      } else {
        // No pending FC - shouldn't happen, but send acceptance anyway
        console.log(`[WinlinkManager] ⚠ F> without prior FC - sending FS + anyway`);
        await this._sendB2FResponse(channel, clientCall, listenCall, 'FS +\r\n');
        if (sessionData?.b2fState) {
          sessionData.b2fState.phase = 'receiving_message';
        }
      }
    } else {
      // Send empty proposal for now (no outgoing messages)
      console.log(`[WinlinkManager] 📤 Sending empty proposal response`);
      await this._sendB2FResponse(channel, clientCall, listenCall, 'FF\r\n');
    }
  }
  
  // Transfer accepted messages to client
  async _transferAcceptedMessages(channel, clientCall, listenCall, fsProposal) {
    const userMessages = this.messageStore.get(clientCall) || { messages: [] };
    
    if (userMessages.messages.length === 0) {
      console.log(`[WinlinkManager] ⚠️ No messages to transfer for ${clientCall}`);
      await this._sendB2FResponse(channel, clientCall, listenCall, 'FF\r\n');
      return;
    }
    
    // Send each message
    for (let i = 0; i < userMessages.messages.length; i++) {
      const msg = userMessages.messages[i];
      console.log(`[WinlinkManager] 📬 Sending message ${i + 1}/${userMessages.messages.length}: ${msg.id}`);
      
      // In real implementation, this should be LZH compressed
      // For now, send raw content
      await this._sendB2FResponse(channel, clientCall, listenCall, msg.content);
    }
    
    // Clear delivered messages
    userMessages.messages = [];
    this.messageStore.set(clientCall, userMessages);
    
    console.log(`[WinlinkManager] ✅ All messages delivered to ${clientCall}`);
    await this._sendB2FResponse(channel, clientCall, listenCall, 'FF\r\n');
  }

  // Store incoming message from client
  async _storeIncomingMessage(channel, clientCall, messageContent) {
    try {
      console.log(`[WinlinkManager] 💾 Storing incoming message from ${clientCall}`);
      
      // For now, just log the message content
      // In a real implementation, you would:
      // 1. Decompress if LZH compressed
      // 2. Parse the RFC-2822 message format
      // 3. Store in a proper message store/database
      // 4. Forward to local email system or store for pickup
      
      console.log(`[WinlinkManager] 📧 Received message from ${clientCall}:`);
      console.log(`[WinlinkManager] 📄 Content (${messageContent.length} bytes):`);
      console.log(messageContent);
      
      // You could save to file, database, or forward to email here
      const timestamp = new Date().toISOString();
      const filename = `received_${clientCall}_${timestamp.replace(/[:.]/g, '-')}.txt`;
      
      console.log(`[WinlinkManager] ✅ Message from ${clientCall} processed successfully`);
      
    } catch (error) {
      console.error(`[WinlinkManager] ❌ Error storing incoming message:`, error);
    }
  }

  // frame handler: detect frames addressed to gateway callsign and forward
  async _onFrame(evt) {
    try {
      console.log(`[WinlinkManager] _onFrame called with channel=${evt?.channel}, enabled=${this.settings?.enabled}`);
      if (!evt || !evt.raw || !evt.channel) {
        console.log(`[WinlinkManager] Missing evt/raw/channel`);
        return;
      }
      const buf = Buffer.from(evt.raw, 'hex');
      const parsed = (() => { try { return parseAx25Frame(buf); } catch (e) { return null; } })();
      console.log(`[WinlinkManager] Parsed frame: ${parsed ? 'success' : 'failed'}, control=${parsed?.control?.toString(16)}`);
      if (!parsed || !Array.isArray(parsed.addresses) || !parsed.addresses[1]) {
        console.log(`[WinlinkManager] Invalid parsed frame or addresses`);
        return;
      }
      const dest = parsed.addresses[0] && parsed.addresses[0].callsign ? 
        (parsed.addresses[0].callsign + (parsed.addresses[0].ssid > 0 ? `-${parsed.addresses[0].ssid}` : '')) : null;
      const src = parsed.addresses[1] && parsed.addresses[1].callsign ? 
        (parsed.addresses[1].callsign + (parsed.addresses[1].ssid > 0 ? `-${parsed.addresses[1].ssid}` : '')) : null;
      console.log(`[WinlinkManager] Frame from ${src} to ${dest}`);
      console.log(`[WinlinkManager] Address 0 (dest):`, parsed.addresses[0]);
      console.log(`[WinlinkManager] Address 1 (src):`, parsed.addresses[1]);
      try {
        // Reconstruct raw address bytes to inspect C bit (bit7) of SSID bytes
        const raw = Buffer.from(evt.raw, 'hex');
        // Each address is 7 bytes sequentially until EA bit set
        let off=0; const addrInfo=[]; let idx=0;
        while (off + 7 <= raw.length) {
          const csBytes = raw.slice(off, off+7);
          const ssidByte = csBytes[6];
            const ea = (ssidByte & 0x01) !== 0;
            const cBit = (ssidByte & 0x80) !== 0; // we are overloading H bit for C semantics when sending
            addrInfo.push({index: idx, cBit, ssidByte: '0x'+ssidByte.toString(16)});
            off += 7; idx++; if (ea) break;
        }
        // Suppressed verbose address logging: console.log('[WinlinkManager] Address SSID bytes (C bit interpretation):', addrInfo);
      } catch (e) {}
      if (!dest || !src) {
        console.log(`[WinlinkManager] Missing dest or src callsign`);
        return;
      }
      
      // Check if this channel is enabled for Winlink
      const channelConfig = (this.settings.channels && this.settings.channels[evt.channel]) || {};
      // Suppressed verbose channel config logging: console.log(`[WinlinkManager] Channel ${evt.channel} config:`, channelConfig);
      if (!channelConfig.enabled) {
        // Suppressed to reduce noise: console.log(`[WinlinkManager] Channel ${evt.channel} not enabled for Winlink`);
        // Check legacy digipeater settings for backward compatibility
        if (this.digipeaterSettings && this.digipeaterSettings.channels) {
          const chcfg = this.digipeaterSettings.channels[evt.channel];
          if (!chcfg || chcfg.winlinkEnabled === false) {
            return; // Winlink disabled for this channel
          }
        } else {
          return; // No config and not enabled
        }
      }

      // Additional check: if we have an active session on a different channel,
      // ignore frames from other channels to prevent feedback loops
      // (e.g., radio1=SoundModem and radio2=COM9 both connected to same radio)
      const activeChannels = new Set();
      for (const [sessionKey, session] of this.sessions.entries()) {
        if (session && (session.lastActivity || session.createdAt)) {
          const lastTime = session.lastActivity || session.createdAt || 0;
          if (Date.now() - lastTime < 30000) { // 30 second window
            // Extract channel from session key (format: "channel::callsign")
            const [sessionChannel] = sessionKey.split('::');
            activeChannels.add(sessionChannel);
          }
        }
      }
      // Also check AX.25 sessions for active channels
      for (const [ax25Key, ax25Session] of this.ax25Sessions.entries()) {
        if (ax25Session && ax25Session.connected) {
          const [sessionChannel] = ax25Key.split('::');
          activeChannels.add(sessionChannel);
        }
      }
      
      if (activeChannels.size > 0 && !activeChannels.has(evt.channel)) {
        // Suppressed to reduce noise: console.log(`[WinlinkManager] Ignoring frame on ${evt.channel} - active session exists on ${Array.from(activeChannels).join(', ')}`);
        return;
      }

      // The per-channel callsign is what we listen for (destination address)
      const listenCallsign = channelConfig.callsign;
      console.log(`[WinlinkManager] Channel listen callsign: ${listenCallsign}, frame dest: ${dest}`);
      if (!listenCallsign) {
        console.log(`[WinlinkManager] No listen callsign configured for channel ${evt.channel}`);
        return; // no listen callsign configured for this channel
      }
      
      // Match the destination against the channel's listen callsign (exact match including SSID)
      if (dest.toUpperCase() !== listenCallsign.toUpperCase()) {
        console.log(`[WinlinkManager] Frame dest ${dest} doesn't match listen callsign ${listenCallsign}`);
        return; // not for us
      }

      // Handle SABM frames to establish connected-mode sessions
      if (parsed.control === 0x3f || parsed.control === 0x2f) { // SABM or SABM+P
        console.log(`[WinlinkManager] 📞 SABM received from ${src}, checking existing session`);
        // Initialize AX.25 session state only if not already connected
        const ax25Key = `${evt.channel}::${src}`;
        const existing = this.ax25Sessions.get(ax25Key);
        if (existing && existing.connected) {
          console.log(`[WinlinkManager] ℹ️ Existing connected session for ${src} on ${evt.channel}; ignoring duplicate SABM`);
        } else {
          console.log(`[WinlinkManager] 📞 Establishing new connected-mode session for ${src}`);
          // Send UA response to establish connection
          // If SABM has Poll bit set (0x3F), UA response must have Final bit set (0x73)
          const hasPollBit = (parsed.control & 0x10) !== 0;
          const uaControl = hasPollBit ? 0x73 : 0x63; // UA+F if Poll bit set, otherwise UA
          console.log(`[WinlinkManager] 📡 SABM control=0x${parsed.control.toString(16)}, Poll=${hasPollBit}, sending UA control=0x${uaControl.toString(16)}`);
          this._sendAx25Frame(evt.channel, src, dest, uaControl, null, '', 'response'); // UA frame (response)

          // Initialize AX.25 session state
          this.ax25Sessions.set(ax25Key, {
            sendSeq: 0,
            recvSeq: 0,
            connected: true,
            channel: evt.channel,
            remoteCall: src,
            localCall: dest,
            needsAck: false,
            lastRRSent: 0,
            lastPollTime: 0
          });

          console.log(`[WinlinkManager] ✅ UA sent, connected-mode session established with ${src}`);
          
          // Log that we're now waiting and monitoring for any client data
          console.log(`[WinlinkManager] ⏳ Waiting for potential client initiation... (5 second timeout)`);
          console.log(`[WinlinkManager] 🎧 Monitoring for any I-frames from client before starting RMS sequence`);
          
          // For RMS mode, wait a bit longer before starting B2F protocol
          // This gives the client time to send its initial data if it wants to
          if (channelConfig.mode === 'RMS') {
            console.log(`[WinlinkManager] ⏳ Waiting for potential client initiation...`);
            
            // First wait to see if client sends anything
            setTimeout(async () => {
              const ax25Key = `${evt.channel}::${src}`;
              const currentSession = this.ax25Sessions.get(ax25Key);
              
              // Check if we already have a B2F session (client initiated)
              const clientKey = `${evt.channel}::${src}`;
              const existingSession = this.sessions.get(clientKey);
              
              if (currentSession && currentSession.connected && !existingSession) {
                console.log(`[WinlinkManager] 🚀 Starting B2F protocol for RMS mode`);
                await this._initializeB2FSession(evt.channel, src, dest);
              } else if (existingSession) {
                console.log(`[WinlinkManager] ✅ B2F session already exists, client initiated protocol`);
              } else {
                console.log(`[WinlinkManager] ⚠️ Session no longer active, skipping B2F initialization`);
              }
            }, 5000); // Increase wait to 5 seconds to see if client sends anything first
          }
        }
      }

      // Accept both UI frames (0x03) and I-frames for Winlink connections
      // Winlink can use connected-mode frames, not just UI frames
      console.log(`[WINLINK] Frame from ${src} to ${dest} on ${evt.channel}, control=0x${parsed.control?.toString(16) || 'unknown'}, mode=${channelConfig.mode}`);

      // Handle I-frame sequence numbers for connected-mode sessions
      if ((parsed.control & 0x01) === 0) {
        // This is an I-frame (bit 0 = 0)
        const ax25Key = `${evt.channel}::${src}`;
        const ax25Session = this.ax25Sessions.get(ax25Key);
        
        if (ax25Session && ax25Session.connected) {
          // Extract sequence numbers from control field
          const clientSendSeq = (parsed.control >> 1) & 0x07; // Ns (bits 1-3)
          const clientRecvSeq = (parsed.control >> 5) & 0x07; // Nr (bits 5-7)
          
          // Reduced I-frame logging - only log errors, not every successful frame
          // console.log(`[WinlinkManager] 📋 I-frame received: client Ns=${clientSendSeq}, Nr=${clientRecvSeq}, our recv=${ax25Session.recvSeq}, send=${ax25Session.sendSeq}`);
          
          // Validate the sequence numbers
          if (clientSendSeq === ax25Session.recvSeq) {
            // This is the expected frame - update our receive sequence
            ax25Session.recvSeq = (ax25Session.recvSeq + 1) % 8;
            // Reduced logging: console.log(`[WinlinkManager] ✅ I-frame accepted, updated our recvSeq to ${ax25Session.recvSeq}`);
            
            // Track acknowledgment needs but don't send immediately (batched acknowledgments)
            ax25Session.needsAck = true;
            ax25Session.lastPollTime = Date.now();
            
            // Only send immediate RR acknowledgment if Poll bit is set AND it's been a while
            // This implements batched acknowledgments like real RMS stations
            const pollBit = (parsed.control & 0x10) !== 0;
            if (pollBit && (!ax25Session.lastRRSent || Date.now() - ax25Session.lastRRSent > 2000)) {
              // Send RR (Receive Ready) frame to acknowledge the I-frame
              // RR control = 0x01 (S-frame) with Nr in bits 5-7
              const rrControl = 0x01 | (ax25Session.recvSeq << 5); // RR with our current recvSeq as Nr
              console.log(`[WinlinkManager] 📤 Sending batched RR acknowledgment: control=0x${rrControl.toString(16)}, Nr=${ax25Session.recvSeq}`);
              this._sendAx25Frame(evt.channel, src, dest, rrControl, null, '', 'response');
              ax25Session.needsAck = false;
              ax25Session.lastRRSent = Date.now();
            }
          } else {
            console.log(`[WinlinkManager] ⚠️ I-frame sequence error: expected ${ax25Session.recvSeq}, got ${clientSendSeq}`);
            // Could send REJ frame here, but for now we'll be lenient
          }
          
          // The client's Nr should match our current send sequence (they're acknowledging our frames)
          if (clientRecvSeq !== ax25Session.sendSeq) {
            console.log(`[WinlinkManager] ⚠️ Client Nr=${clientRecvSeq} doesn't match our sendSeq=${ax25Session.sendSeq}`);
          }
        }
      }

      // Handle RR (Receive Ready) frames - these acknowledge our I-frames
      if ((parsed.control & 0x03) === 0x01) { // RR frame (S-frame with bits 0-1 = 01)
        const ax25Key = `${evt.channel}::${src}`;
        const ax25Session = this.ax25Sessions.get(ax25Key);
        
        if (ax25Session && ax25Session.connected) {
          const clientRecvSeq = (parsed.control >> 5) & 0x07; // Nr field from RR frame
          console.log(`[WinlinkManager] ✅ RR received from ${src} on ${evt.channel}: client Nr=${clientRecvSeq}, control=0x${parsed.control.toString(16)}`);
          console.log(`[WinlinkManager] 📊 RR acknowledges our frames up to ${clientRecvSeq}`);
          
          // The client is acknowledging our frames up to clientRecvSeq
          // This is normal protocol flow - no action needed, just log for debugging
        } else {
          console.log(`[WinlinkManager] ⚠️ RR received from ${src} but no AX.25 session found`);
        }
        return; // RR frames don't carry payload data
      }

      // Handle DISC (disconnect) frames
      if (parsed.control === 0x43 || parsed.control === 0x53) { // DISC or DISC+P
        console.log(`[WinlinkManager] 🔌 DISC received from ${src}, disconnecting session`);
        const ax25Key = `${evt.channel}::${src}`;
        const ax25Session = this.ax25Sessions.get(ax25Key);
        
        if (ax25Session && ax25Session.connected) {
          // Send DM (Disconnect Mode) response
          const hasPollBit = (parsed.control & 0x10) !== 0;
          const dmControl = hasPollBit ? 0x1F : 0x0F; // DM+F if Poll bit set, otherwise DM
          console.log(`[WinlinkManager] 📤 Sending DM response: control=0x${dmControl.toString(16)}`);
          this._sendAx25Frame(evt.channel, src, dest, dmControl, null, '', 'response');
          
          // Clean up the AX.25 session
          this.ax25Sessions.delete(ax25Key);
          console.log(`[WinlinkManager] 🗑️ Cleaned up AX.25 session for ${src} on ${evt.channel}`);
          
          // Also clean up the B2F session (Winlink protocol session)
          const sessionKey = `${evt.channel}::${src}`;
          if (this.sessions.has(sessionKey)) {
            console.log(`[WinlinkManager] 🗑️ Cleaning up B2F session for ${src} on ${evt.channel}`);
            const session = this.sessions.get(sessionKey);
            // Clean up any upstream socket if this was TCP mode
            if (session && session.upstreamSocket) {
              try { session.upstreamSocket.destroy(); } catch (e) {}
            }
            this.sessions.delete(sessionKey);
            this.status.sessions = this.sessions.size;
            console.log(`[WinlinkManager] ✅ B2F session cleaned up, total sessions: ${this.sessions.size}`);
          }
        }
        return;
      }

      // Skip control frames (SABM, UA, etc.) - these are not Winlink data
      if (parsed.control === 0x3f || parsed.control === 0x2f || // SABM, SABM+P
          parsed.control === 0x63 || parsed.control === 0x73) { // UA, UA+F
        console.log(`[WinlinkManager] 🚫 Skipping control frame (control=0x${parsed.control.toString(16)}) - not Winlink data`);
        return;
      }

      const payloadBuf = parsed.payload || Buffer.alloc(0);
      const clientKey = `${evt.channel}::${src}`;

      // Determine upstream mode and configuration
      const mode = channelConfig.mode || 'RMS';
      let upstreamConfig;
      
      if (mode === 'RMS') {
        // Implement local RMS gateway mode - handle B2F protocol directly
        console.log(`[WinlinkManager] 🏠 Local RMS mode: received ${payloadBuf.length} bytes from ${src}`);
        if (payloadBuf.length > 0) {
          console.log(`[WinlinkManager] 📨 Client sent data: "${payloadBuf.toString('ascii').trim()}"`);
        }
        await this._handleB2FProtocol(evt.channel, src, dest, payloadBuf);
        return;
      } else if (mode === 'Radio') {
        // Use radio upstream - forward to another radio callsign
        upstreamConfig = {
          mode: 'radio',
          channel: evt.channel,
          destCallsign: channelConfig.callsign, // Forward to this callsign
          fromCallsign: listenCallsign // Reply from the listen callsign
        };
      } else {
        return; // Unknown mode
      }

      // For Radio mode only - RMS mode is handled above
      if (mode !== 'Radio') {
        return;
      }

      // Ensure session exists (Radio mode only)
      let session = this.sessions.get(clientKey);
      if (!session) {
        console.log(`[WinlinkManager] 🆕 Creating new Radio mode session for ${src} on ${evt.channel}`);
        
        // Send immediate acknowledgment to the remote user (with small delay for connection establishment)
        setTimeout(() => {
          try {
            const listenCallsign = channelConfig.callsign;
            const statusMessage = `Attempting connection to Winlink RMS server...`;
            console.log(`[WinlinkManager] 📡 Sending status message to ${src}: ${statusMessage}`);
            
            // Check if we have a connected-mode session
            const ax25Key = `${evt.channel}::${src}`;
            const ax25Session = this.ax25Sessions.get(ax25Key);
            
            if (ax25Session && ax25Session.connected) {
              // Send as I-frame in connected mode with P/F bit to elicit ack
              this._sendIFrame(evt.channel, src, listenCallsign, statusMessage, ax25Session, true);
            } else {
              // Fallback to UI frame
              if (this.manager) {
                this.manager.sendAPRSMessage({ 
                  from: listenCallsign, 
                  to: src, 
                  payload: statusMessage, 
                  channel: evt.channel 
                });
              }
            }
          } catch (e) { 
            console.error('WinlinkManager: failed sending status message', e); 
          }
        }, 1500); // 1.5 second delay to allow connection establishment
        
        session = await this._createSession(evt.channel, src, upstreamConfig);
        if (!session) {
          console.log(`[WinlinkManager] ❌ Failed to create session for ${src}`);
          // Send failure message to remote user
          try {
            const listenCallsign = channelConfig.callsign;
            const errorMessage = `Winlink RMS connection failed. Please try again later.`;
            console.log(`[WinlinkManager] ❌ Sending error message to ${src}: ${errorMessage}`);
            if (this.manager) {
              this.manager.sendAPRSMessage({ 
                from: listenCallsign, 
                to: src, 
                payload: errorMessage, 
                channel: evt.channel 
              });
            }
          } catch (e) { 
            console.error('WinlinkManager: failed sending error message', e); 
          }
          return; // couldn't create
        }
        this.sessions.set(clientKey, session);
        this.status.sessions = this.sessions.size;
        console.log(`[WinlinkManager] ✅ Session stored, total sessions: ${this.sessions.size}`);
      } else {
        console.log(`[WinlinkManager] 🔄 Using existing session for ${src} on ${evt.channel}`);
      }

      // update activity
      try { session.lastActivity = Date.now(); } catch (e) {}

      // Forward payload to upstream depending on mode
      const upstream = session.upstreamConfig || upstreamConfig;
      if (upstream.mode === 'tcp') {
        if (session.upstreamSocket && session.upstreamSocket.writable) {
          console.log(`[WinlinkManager] ➡️ Sending ${payloadBuf.length} bytes to RMS: ${payloadBuf.toString().substring(0, 100)}${payloadBuf.length > 100 ? '...' : ''}`);
          session.upstreamSocket.write(payloadBuf);
          try { session.bytesOut = (session.bytesOut || 0) + (payloadBuf ? payloadBuf.length : 0); } catch (e) {}
        } else {
          console.log(`[WinlinkManager] ⚠️ Cannot send to RMS - socket not writable for ${src}`);
        }
      } else if (upstream.mode === 'radio') {
        // Forward as AX.25 UI frame to configured destination
        const destCall = upstream.destCallsign;
        const ch = upstream.channel;
        if (destCall && ch && this.manager) {
          try {
            // sendAPRSMessage will construct a UI frame with PID 0xF0; use the fromCallsign from config
            this.manager.sendAPRSMessage({ from: upstream.fromCallsign, to: destCall, payload: payloadBuf, channel: ch });
            try { session.bytesOut = (session.bytesOut || 0) + (payloadBuf ? payloadBuf.length : 0); } catch (e) {}
          } catch (e) { console.error('WinlinkManager: radio forward failed', e); }
        }
      }
    } catch (e) { console.error('WinlinkManager._onFrame error', e); }
  }

  async _createSession(channel, clientCall, upstreamConfig) {
    const upstream = upstreamConfig || {};
    const key = `${channel}::${clientCall}`;
    console.log(`[WinlinkManager] Creating session for ${clientCall} on ${channel}, mode: ${upstream.mode}`);
    
    if (upstream.mode === 'tcp') {
      try {
        console.log(`[WinlinkManager] TCP mode - connecting to ${upstream.host}:${upstream.port}`);
        const sock = new net.Socket();
        const host = upstream.host || '';
        const port = Number(upstream.port) || 0;
        if (!host || !port) {
          console.log(`[WinlinkManager] Invalid host/port: ${host}:${port}`);
          return null;
        }
        
        console.log(`[WinlinkManager] Attempting TCP connection to ${host}:${port}...`);
        sock.connect(port, host, () => {
          console.log(`[WinlinkManager] ✅ TCP connection established to ${host}:${port}`);
          console.log(`[WinlinkManager] Sending Winlink authentication for gateway callsign: ${upstream.gatewayCallsign}`);
          
          // Send success message to remote user
          try {
            const successMessage = `Connected to Winlink RMS. You may now send your messages.`;
            console.log(`[WinlinkManager] ✅ Sending success message to ${clientCall}: ${successMessage}`);
            if (this.manager) {
              // Check if we have a connected-mode session
              const ax25Key = `${channel}::${clientCall}`;
              const ax25Session = this.ax25Sessions.get(ax25Key);
              
              if (ax25Session && ax25Session.connected) {
                // Send as I-frame in connected mode
                setTimeout(() => {
                  this._sendIFrame(channel, clientCall, upstream.listenCallsign || this.settings.gatewayCallsign, successMessage, ax25Session);
                }, 2000); // 2 second delay to ensure connection is fully established and RMS ready
              } else {
                // Fallback to UI frame
                const manager = this.manager;
                setTimeout(() => {
                  manager.sendAPRSMessage({ 
                    from: upstream.listenCallsign || this.settings.gatewayCallsign, 
                    to: clientCall, 
                    payload: successMessage, 
                    channel: channel 
                  });
                }, 2000); // 2 second delay to ensure connection is fully established and RMS ready
              }
            }
          } catch (e) { 
            console.error('WinlinkManager: failed sending success message', e); 
          }
          
          // Send Winlink authentication if we have credentials
          if (upstream.gatewayCallsign && upstream.password) {
            const authCommand = `//WL2K ${upstream.gatewayCallsign} ${upstream.password}\r\n`;
            console.log(`[WinlinkManager] Sending auth command: ${authCommand.trim()}`);
            sock.write(authCommand);
          }
        });
        
        sock.on('data', (data) => {
          // send upstream data back to client as AX.25 UI frame
          console.log(`[WinlinkManager] ⬅️ Received ${data.length} bytes from RMS: ${data.toString().substring(0, 100)}${data.length > 100 ? '...' : ''}`);
          try {
            // For RMS mode, respond using the listen callsign from the channel config
            const from = upstream.listenCallsign || this.settings.gatewayCallsign || 'WLNK';
            const chId = channel;
            if (this.manager) {
              console.log(`[WinlinkManager] ➡️ Forwarding to radio: from=${from}, to=${clientCall}, channel=${chId}`);
              
              // Check if we have a connected-mode session
              const ax25Key = `${channel}::${clientCall}`;
              const ax25Session = this.ax25Sessions.get(ax25Key);
              
              if (ax25Session && ax25Session.connected) {
                // Send as I-frame in connected mode
                this._sendIFrame(chId, clientCall, from, data.toString(), ax25Session);
              } else {
                // Fallback to UI frame
                this.manager.sendAPRSMessage({ from, to: clientCall, payload: data, channel: chId });
              }
              
              // account bytes in
              try {
                const sk = key;
                const s = this.sessions.get(sk);
                if (s) { s.bytesIn = (s.bytesIn || 0) + (data ? data.length : 0); s.lastActivity = Date.now(); }
              } catch (e) {}
            }
          } catch (e) { console.error('WinlinkManager: failed sending upstream->client', e); }
        });
        
        sock.on('error', (err) => { 
          console.error(`[WinlinkManager] ❌ RMS connection error for ${clientCall}:`, err.message); 
          
          // Send error message to remote user
          try {
            const errorMessage = `Winlink RMS connection failed: ${err.message}. Please try again later.`;
            console.log(`[WinlinkManager] ❌ Sending error message to ${clientCall}: ${errorMessage}`);
            if (this.manager) {
              // Check if we have a connected-mode session
              const ax25Key = `${channel}::${clientCall}`;
              const ax25Session = this.ax25Sessions.get(ax25Key);
              
              if (ax25Session && ax25Session.connected) {
                // Send as I-frame in connected mode
                this._sendIFrame(channel, clientCall, upstream.listenCallsign || this.settings.gatewayCallsign, errorMessage, ax25Session);
              } else {
                // Fallback to UI frame
                this.manager.sendAPRSMessage({ 
                  from: upstream.listenCallsign || this.settings.gatewayCallsign, 
                  to: clientCall, 
                  payload: errorMessage, 
                  channel: channel 
                });
              }
              
              // Send disconnect message after error
              setTimeout(() => {
                try {
                  const disconnectMessage = `Winlink session terminated. 73.`;
                  console.log(`[WinlinkManager] 🔌 Sending disconnect message to ${clientCall}: ${disconnectMessage}`);
                  
                  // Again check for connected-mode session for disconnect message
                  const ax25Session = this.ax25Sessions.get(ax25Key);
                  if (ax25Session && ax25Session.connected) {
                    // Send as I-frame in connected mode
                    this._sendIFrame(channel, clientCall, upstream.listenCallsign || this.settings.gatewayCallsign, disconnectMessage, ax25Session);
                  } else {
                    // Fallback to UI frame
                    this.manager.sendAPRSMessage({ 
                      from: upstream.listenCallsign || this.settings.gatewayCallsign, 
                      to: clientCall, 
                      payload: disconnectMessage, 
                      channel: channel 
                    });
                  }
                } catch (e) { 
                  console.error('WinlinkManager: failed sending disconnect message', e); 
                }
              }, 2000); // 2 second delay to ensure error message is sent first
            }
          } catch (e) { 
            console.error('WinlinkManager: failed sending error message', e); 
          }
          
          // Clean up the failed session
          try {
            const sessionKey = `${channel}::${clientCall}`;
            if (this.sessions.has(sessionKey)) {
              console.log(`[WinlinkManager] 🧹 Cleaning up failed session for ${clientCall}`);
              this.sessions.delete(sessionKey);
              this.status.sessions = this.sessions.size;
            }
          } catch (e) {
            console.error('WinlinkManager: failed cleaning up session', e);
          }
          
          try { sock.destroy(); } catch (e) {} 
        });
        sock.on('close', () => { 
          console.log(`[WinlinkManager] 🔌 RMS connection closed for ${clientCall}`);
          
          // Send disconnect message to remote user
          try {
            const disconnectMessage = `Winlink session ended. 73.`;
            console.log(`[WinlinkManager] 📡 Sending disconnect message to ${clientCall}: ${disconnectMessage}`);
            if (this.manager) {
              // Check if we have a connected-mode session
              const ax25Key = `${channel}::${clientCall}`;
              const ax25Session = this.ax25Sessions.get(ax25Key);
              
              if (ax25Session && ax25Session.connected) {
                // Send as I-frame in connected mode
                this._sendIFrame(channel, clientCall, upstream.listenCallsign || this.settings.gatewayCallsign, disconnectMessage, ax25Session);
              } else {
                // Fallback to UI frame
                this.manager.sendAPRSMessage({ 
                  from: upstream.listenCallsign || this.settings.gatewayCallsign, 
                  to: clientCall, 
                  payload: disconnectMessage, 
                  channel: channel 
                });
              }
            }
          } catch (e) { 
            console.error('WinlinkManager: failed sending disconnect message', e); 
          }
          
          // Clean up the session
          try {
            const sessionKey = `${channel}::${clientCall}`;
            if (this.sessions.has(sessionKey)) {
              console.log(`[WinlinkManager] 🧹 Cleaning up closed session for ${clientCall}`);
              this.sessions.delete(sessionKey);
              this.status.sessions = this.sessions.size;
            }
          } catch (e) {
            console.error('WinlinkManager: failed cleaning up session', e);
          }
        });
        
        // Set connection timeout
        sock.setTimeout(30000, () => {
          console.log(`[WinlinkManager] ⏰ Connection timeout for ${clientCall}`);
          
          // Send timeout message to remote user
          try {
            const timeoutMessage = `Winlink RMS connection timed out. Please try again later.`;
            console.log(`[WinlinkManager] ⏰ Sending timeout message to ${clientCall}: ${timeoutMessage}`);
            if (this.manager) {
              this.manager.sendAPRSMessage({ 
                from: upstream.listenCallsign || this.settings.gatewayCallsign, 
                to: clientCall, 
                payload: timeoutMessage, 
                channel: channel 
              });
            }
          } catch (e) { 
            console.error('WinlinkManager: failed sending timeout message', e); 
          }
          
          // Clean up the timed out session
          try {
            const sessionKey = `${channel}::${clientCall}`;
            if (this.sessions.has(sessionKey)) {
              console.log(`[WinlinkManager] 🧹 Cleaning up timed out session for ${clientCall}`);
              this.sessions.delete(sessionKey);
              this.status.sessions = this.sessions.size;
            }
          } catch (e) {
            console.error('WinlinkManager: failed cleaning up session', e);
          }
          
          sock.destroy();
        });
        
        const sessionObj = { 
          clientCall, 
          clientChannel: channel, 
          upstreamSocket: sock, 
          upstreamConfig: upstream, 
          createdAt: Date.now(), 
          lastActivity: Date.now(), 
          bytesIn: 0, 
          bytesOut: 0 
        };
        console.log(`[WinlinkManager] 📝 Session created for ${clientCall} on ${channel}, key: ${key}`);
        return sessionObj;
      } catch (e) { 
        console.error('WinlinkManager: createSession tcp failed', e); 
        return null; 
      }
    } else if (upstream.mode === 'radio') {
      // Radio sessions don't need a persistent upstream socket; session record still useful
      return { 
        clientCall, 
        clientChannel: channel, 
        upstreamMode: 'radio', 
        upstreamConfig: upstream, 
        createdAt: Date.now(), 
        lastActivity: Date.now(), 
        bytesIn: 0, 
        bytesOut: 0 
      };
    }
    return null;
  }
}

module.exports = WinlinkManager;
