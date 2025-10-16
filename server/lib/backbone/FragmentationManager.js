/**
 * FragmentationManager.js
 * Handles message fragmentation and reassembly for large packets
 * 
 * Features:
 * - Automatic fragmentation for messages exceeding MTU
 * - Fragment header with messageID, sequence, total count
 * - Reassembly buffer with timeout
 * - Selective retransmission of missing fragments
 * - Fragment tracking and statistics
 */

const EventEmitter = require('events');
const crypto = require('crypto');

class FragmentationManager extends EventEmitter {
  /**
   * Create fragmentation manager
   * @param {Object} config - Configuration
   * @param {Number} config.mtu - Maximum transmission unit (default: 200)
   * @param {Number} config.headerSize - Fragment header size (default: 32)
   * @param {Number} config.reassemblyTimeout - Reassembly timeout in ms (default: 30000)
   * @param {Number} config.cleanupInterval - Cleanup interval in ms (default: 60000)
   */
  constructor(config = {}) {
    super();
    
    this.mtu = config.mtu || 200; // 200 bytes default (conservative for RF)
    this.headerSize = config.headerSize || 32; // Fragment header overhead
    this.reassemblyTimeout = config.reassemblyTimeout || 30000; // 30 seconds
    this.cleanupInterval = config.cleanupInterval || 60000; // 1 minute
    
    // Maximum payload per fragment
    this.maxPayloadPerFragment = this.mtu - this.headerSize;
    
    // Reassembly buffers: messageId -> { fragments, totalFragments, receivedCount, startTime, lastUpdate }
    this.reassemblyBuffers = new Map();
    
    // Cleanup timer
    this.cleanupTimer = null;
    
    // Statistics
    this.stats = {
      fragmented: 0,
      reassembled: 0,
      timedOut: 0,
      fragmentsSent: 0,
      fragmentsReceived: 0
    };
  }

  /**
   * Start cleanup timer
   */
  start() {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(() => this._cleanup(), this.cleanupInterval);
    console.log('[FragmentationManager] Started');
  }

  /**
   * Stop cleanup timer
   */
  stop() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      console.log('[FragmentationManager] Stopped');
    }
  }

  /**
   * Check if message needs fragmentation
   * @param {Buffer} data - Message data
   * @returns {Boolean} True if fragmentation needed
   */
  needsFragmentation(data) {
    return data.length > this.maxPayloadPerFragment;
  }

  /**
   * Fragment a message
   * @param {String} messageId - Message ID
   * @param {Buffer} data - Message data to fragment
   * @returns {Array} Array of fragment objects
   */
  fragment(messageId, data) {
    if (!this.needsFragmentation(data)) {
      // No fragmentation needed, return as single fragment
      return [{
        messageId: messageId,
        fragmentNum: 0,
        totalFragments: 1,
        payload: data
      }];
    }

    const fragments = [];
    const totalFragments = Math.ceil(data.length / this.maxPayloadPerFragment);
    
    for (let i = 0; i < totalFragments; i++) {
      const start = i * this.maxPayloadPerFragment;
      const end = Math.min(start + this.maxPayloadPerFragment, data.length);
      const payload = data.slice(start, end);
      
      fragments.push({
        messageId: messageId,
        fragmentNum: i,
        totalFragments: totalFragments,
        payload: payload
      });
    }
    
    this.stats.fragmented++;
    this.stats.fragmentsSent += fragments.length;
    
    console.log(`[FragmentationManager] Fragmented message ${messageId} into ${totalFragments} fragments`);
    this.emit('fragmented', messageId, totalFragments);
    
    return fragments;
  }

  /**
   * Process received fragment
   * @param {Object} fragment - Fragment data
   * @param {String} fragment.messageId - Message ID
   * @param {Number} fragment.fragmentNum - Fragment number (0-based)
   * @param {Number} fragment.totalFragments - Total number of fragments
   * @param {Buffer} fragment.payload - Fragment payload
   * @returns {Buffer|null} Complete message if all fragments received, null otherwise
   */
  processFragment(fragment) {
    const { messageId, fragmentNum, totalFragments, payload } = fragment;
    
    this.stats.fragmentsReceived++;
    
    // Single fragment message
    if (totalFragments === 1) {
      return payload;
    }

    // Get or create reassembly buffer
    let buffer = this.reassemblyBuffers.get(messageId);
    
    if (!buffer) {
      buffer = {
        fragments: new Array(totalFragments).fill(null),
        totalFragments: totalFragments,
        receivedCount: 0,
        startTime: Date.now(),
        lastUpdate: Date.now()
      };
      this.reassemblyBuffers.set(messageId, buffer);
    }

    // Store fragment
    if (buffer.fragments[fragmentNum] === null) {
      buffer.fragments[fragmentNum] = payload;
      buffer.receivedCount++;
      buffer.lastUpdate = Date.now();
      
      console.log(`[FragmentationManager] Received fragment ${fragmentNum}/${totalFragments} for ${messageId} (${buffer.receivedCount}/${totalFragments})`);
    }

    // Check if all fragments received
    if (buffer.receivedCount === buffer.totalFragments) {
      // Reassemble message
      const completeMessage = Buffer.concat(buffer.fragments);
      this.reassemblyBuffers.delete(messageId);
      this.stats.reassembled++;
      
      const reassemblyTime = Date.now() - buffer.startTime;
      console.log(`[FragmentationManager] Reassembled message ${messageId} (${totalFragments} fragments, ${reassemblyTime}ms)`);
      this.emit('reassembled', messageId, totalFragments, reassemblyTime);
      
      return completeMessage;
    }

    // Not yet complete
    return null;
  }

  /**
   * Get missing fragments for a message
   * @param {String} messageId - Message ID
   * @returns {Array|null} Array of missing fragment numbers, or null if not being reassembled
   */
  getMissingFragments(messageId) {
    const buffer = this.reassemblyBuffers.get(messageId);
    
    if (!buffer) {
      return null;
    }

    const missing = [];
    for (let i = 0; i < buffer.totalFragments; i++) {
      if (buffer.fragments[i] === null) {
        missing.push(i);
      }
    }
    
    return missing;
  }

  /**
   * Cancel reassembly of a message
   * @param {String} messageId - Message ID
   * @param {String} reason - Cancellation reason
   * @returns {Boolean} True if buffer existed and was removed
   */
  cancelReassembly(messageId, reason = 'Cancelled') {
    const buffer = this.reassemblyBuffers.get(messageId);
    
    if (!buffer) {
      return false;
    }

    this.reassemblyBuffers.delete(messageId);
    console.log(`[FragmentationManager] Cancelled reassembly of ${messageId}: ${reason}`);
    this.emit('cancelled', messageId, reason);
    
    return true;
  }

  /**
   * Cleanup timed-out reassembly buffers
   * @private
   */
  _cleanup() {
    const now = Date.now();
    const timedOut = [];
    
    for (const [messageId, buffer] of this.reassemblyBuffers) {
      const age = now - buffer.lastUpdate;
      
      if (age > this.reassemblyTimeout) {
        timedOut.push(messageId);
        this.stats.timedOut++;
        
        const missing = this.getMissingFragments(messageId);
        console.warn(`[FragmentationManager] Reassembly timeout for ${messageId} (missing: ${missing.join(', ')})`);
        this.emit('timeout', messageId, missing);
      }
    }
    
    // Remove timed-out buffers
    for (const messageId of timedOut) {
      this.reassemblyBuffers.delete(messageId);
    }
    
    if (timedOut.length > 0) {
      console.log(`[FragmentationManager] Cleanup removed ${timedOut.length} timed-out reassembly buffer(s)`);
    }
  }

  /**
   * Get statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      mtu: this.mtu,
      maxPayloadPerFragment: this.maxPayloadPerFragment,
      activeReassemblies: this.reassemblyBuffers.size,
      fragmented: this.stats.fragmented,
      reassembled: this.stats.reassembled,
      timedOut: this.stats.timedOut,
      fragmentsSent: this.stats.fragmentsSent,
      fragmentsReceived: this.stats.fragmentsReceived,
      successRate: this.stats.fragmented > 0 
        ? Math.round((this.stats.reassembled / this.stats.fragmented) * 100) 
        : 0
    };
  }

  /**
   * Get active reassembly buffers for debugging
   * @returns {Array} Array of reassembly buffer info
   */
  toArray() {
    const now = Date.now();
    return Array.from(this.reassemblyBuffers.entries()).map(([messageId, buffer]) => ({
      messageId,
      totalFragments: buffer.totalFragments,
      receivedCount: buffer.receivedCount,
      missing: this.getMissingFragments(messageId),
      age: now - buffer.startTime,
      lastUpdate: now - buffer.lastUpdate
    }));
  }

  /**
   * Clear all reassembly buffers
   */
  clear() {
    const count = this.reassemblyBuffers.size;
    this.reassemblyBuffers.clear();
    console.log(`[FragmentationManager] Cleared ${count} reassembly buffer(s)`);
  }

  /**
   * Encode fragment header
   * @param {Object} fragment - Fragment info
   * @returns {Buffer} Encoded header
   */
  static encodeFragmentHeader(fragment) {
    const header = Buffer.alloc(32);
    let offset = 0;
    
    // Write message ID (16 bytes)
    header.write(fragment.messageId, offset, 16, 'utf8');
    offset += 16;
    
    // Write fragment number (4 bytes)
    header.writeUInt32BE(fragment.fragmentNum, offset);
    offset += 4;
    
    // Write total fragments (4 bytes)
    header.writeUInt32BE(fragment.totalFragments, offset);
    offset += 4;
    
    // Write payload length (4 bytes)
    header.writeUInt32BE(fragment.payload.length, offset);
    offset += 4;
    
    // Write checksum (4 bytes)
    const checksum = crypto.createHash('md5').update(fragment.payload).digest().readUInt32BE(0);
    header.writeUInt32BE(checksum, offset);
    
    return header;
  }

  /**
   * Decode fragment header
   * @param {Buffer} header - Header buffer
   * @returns {Object} Fragment info
   */
  static decodeFragmentHeader(header) {
    let offset = 0;
    
    // Read message ID (16 bytes)
    const messageId = header.toString('utf8', offset, offset + 16).trim();
    offset += 16;
    
    // Read fragment number (4 bytes)
    const fragmentNum = header.readUInt32BE(offset);
    offset += 4;
    
    // Read total fragments (4 bytes)
    const totalFragments = header.readUInt32BE(offset);
    offset += 4;
    
    // Read payload length (4 bytes)
    const payloadLength = header.readUInt32BE(offset);
    offset += 4;
    
    // Read checksum (4 bytes)
    const checksum = header.readUInt32BE(offset);
    
    return {
      messageId,
      fragmentNum,
      totalFragments,
      payloadLength,
      checksum
    };
  }
}

module.exports = FragmentationManager;
