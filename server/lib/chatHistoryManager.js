/**
 * ChatHistoryManager
 * 
 * Manages persistent storage and retrieval of chat messages.
 * Messages are stored with timestamps and automatically pruned based on retention settings.
 * Only web UI users receive history - RF users see live messages only.
 */

const fs = require('fs');
const path = require('path');

class ChatHistoryManager {
  constructor(storagePath, options = {}) {
    this.storagePath = storagePath;
    this.retentionDays = options.retentionDays || 7;
    this.maxMessagesPerRoom = options.maxMessagesPerRoom || 1000;
    
    // In-memory cache for faster access
    this.messageCache = new Map(); // roomName -> array of messages
    
    // Load existing messages from disk
    this.loadMessages();
    
    // Set up periodic cleanup (once per hour)
    this.cleanupInterval = setInterval(() => {
      this.pruneOldMessages();
    }, 60 * 60 * 1000); // 1 hour
    
    console.log(`ChatHistoryManager initialized (retention: ${this.retentionDays} days, storage: ${storagePath})`);
  }

  /**
   * Load messages from disk into memory cache
   */
  loadMessages() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const data = fs.readFileSync(this.storagePath, 'utf8');
        const parsed = JSON.parse(data);
        
        // Convert plain objects back to Map
        if (parsed.messages) {
          this.messageCache = new Map(Object.entries(parsed.messages));
          console.log(`Loaded ${this.messageCache.size} rooms from chat history`);
        }
      } else {
        console.log('No existing chat history found, starting fresh');
      }
    } catch (err) {
      console.error('Error loading chat history:', err);
      this.messageCache = new Map();
    }
  }

  /**
   * Save messages to disk
   */
  saveMessages() {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Convert Map to plain object for JSON serialization
      const data = {
        version: 1,
        savedAt: new Date().toISOString(),
        retentionDays: this.retentionDays,
        messages: Object.fromEntries(this.messageCache)
      };

      // Write atomically (write to temp file, then rename)
      const tempPath = this.storagePath + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tempPath, this.storagePath);
      
    } catch (err) {
      console.error('Error saving chat history:', err);
    }
  }

  /**
   * Store a new message
   */
  addMessage(roomName, callsign, text, metadata = {}) {
    const message = {
      id: this.generateMessageId(),
      timestamp: Date.now(),
      timestampISO: new Date().toISOString(),
      roomName,
      callsign,
      text,
      connectionType: metadata.connectionType || 'websocket',
      node: metadata.node || 'local',
      ...metadata
    };

    // Get or create room's message array
    if (!this.messageCache.has(roomName)) {
      this.messageCache.set(roomName, []);
    }

    const messages = this.messageCache.get(roomName);
    messages.push(message);

    // Enforce max messages limit
    if (messages.length > this.maxMessagesPerRoom) {
      messages.shift(); // Remove oldest message
    }

    // Save to disk (debounced in production, immediate for now)
    this.debouncedSave();

    return message;
  }

  /**
   * Get message history for a room
   * @param {string} roomName - Room to get history for
   * @param {number} limit - Maximum number of messages to return
   * @param {string} connectionType - Filter by connection type (optional)
   * @returns {Array} Array of messages
   */
  getHistory(roomName, limit = 100, connectionType = null) {
    const messages = this.messageCache.get(roomName) || [];
    
    // Filter by connection type if specified
    let filtered = messages;
    if (connectionType) {
      filtered = messages.filter(m => m.connectionType === connectionType);
    }

    // Return most recent messages up to limit
    return filtered.slice(-limit);
  }

  /**
   * Get history for web UI users only (excludes RF-only messages if needed)
   */
  getHistoryForWebUI(roomName, limit = 100) {
    return this.getHistory(roomName, limit);
  }

  /**
   * Search messages across all rooms
   */
  searchMessages(query, options = {}) {
    const results = [];
    const limit = options.limit || 100;
    const roomFilter = options.room || null;
    const callsignFilter = options.callsign || null;
    const startDate = options.startDate || null;
    const endDate = options.endDate || null;

    const queryLower = query.toLowerCase();

    for (const [roomName, messages] of this.messageCache) {
      // Skip if room filter is set and doesn't match
      if (roomFilter && roomName !== roomFilter) continue;

      for (const message of messages) {
        // Apply filters
        if (callsignFilter && message.callsign !== callsignFilter) continue;
        if (startDate && message.timestamp < startDate) continue;
        if (endDate && message.timestamp > endDate) continue;

        // Search in message text
        if (message.text.toLowerCase().includes(queryLower)) {
          results.push(message);
          if (results.length >= limit) {
            return results;
          }
        }
      }
    }

    return results;
  }

  /**
   * Export messages to JSON
   */
  exportMessages(roomName = null, format = 'json') {
    if (roomName) {
      const messages = this.messageCache.get(roomName) || [];
      return format === 'json' ? JSON.stringify(messages, null, 2) : this.formatAsCSV(messages);
    } else {
      const allMessages = {};
      for (const [room, messages] of this.messageCache) {
        allMessages[room] = messages;
      }
      return format === 'json' ? JSON.stringify(allMessages, null, 2) : this.formatAllAsCSV(allMessages);
    }
  }

  /**
   * Format messages as CSV
   */
  formatAsCSV(messages) {
    const headers = 'Timestamp,Room,Callsign,Message,ConnectionType,Node\n';
    const rows = messages.map(m => 
      `"${m.timestampISO}","${m.roomName}","${m.callsign}","${m.text.replace(/"/g, '""')}","${m.connectionType}","${m.node}"`
    ).join('\n');
    return headers + rows;
  }

  /**
   * Format all messages as CSV
   */
  formatAllAsCSV(allMessages) {
    const headers = 'Timestamp,Room,Callsign,Message,ConnectionType,Node\n';
    const rows = [];
    for (const [room, messages] of Object.entries(allMessages)) {
      for (const m of messages) {
        rows.push(`"${m.timestampISO}","${m.roomName}","${m.callsign}","${m.text.replace(/"/g, '""')}","${m.connectionType}","${m.node}"`);
      }
    }
    return headers + rows.join('\n');
  }

  /**
   * Prune messages older than retention period
   */
  pruneOldMessages() {
    const cutoffTime = Date.now() - (this.retentionDays * 24 * 60 * 60 * 1000);
    let totalPruned = 0;

    for (const [roomName, messages] of this.messageCache) {
      const originalLength = messages.length;
      const filtered = messages.filter(m => m.timestamp > cutoffTime);
      
      if (filtered.length < originalLength) {
        this.messageCache.set(roomName, filtered);
        totalPruned += (originalLength - filtered.length);
      }

      // Remove empty rooms
      if (filtered.length === 0) {
        this.messageCache.delete(roomName);
      }
    }

    if (totalPruned > 0) {
      console.log(`Pruned ${totalPruned} old messages from chat history`);
      this.saveMessages();
    }
  }

  /**
   * Get statistics about stored messages
   */
  getStats() {
    let totalMessages = 0;
    const roomStats = [];

    for (const [roomName, messages] of this.messageCache) {
      totalMessages += messages.length;
      
      const oldestTimestamp = messages.length > 0 ? messages[0].timestamp : null;
      const newestTimestamp = messages.length > 0 ? messages[messages.length - 1].timestamp : null;

      roomStats.push({
        room: roomName,
        messageCount: messages.length,
        oldestMessage: oldestTimestamp ? new Date(oldestTimestamp).toISOString() : null,
        newestMessage: newestTimestamp ? new Date(newestTimestamp).toISOString() : null
      });
    }

    return {
      totalRooms: this.messageCache.size,
      totalMessages,
      retentionDays: this.retentionDays,
      maxMessagesPerRoom: this.maxMessagesPerRoom,
      rooms: roomStats
    };
  }

  /**
   * Clear all history for a room
   */
  clearRoom(roomName) {
    this.messageCache.delete(roomName);
    this.saveMessages();
    console.log(`Cleared chat history for room: ${roomName}`);
  }

  /**
   * Clear all history
   */
  clearAll() {
    this.messageCache.clear();
    this.saveMessages();
    console.log('Cleared all chat history');
  }

  /**
   * Generate unique message ID
   */
  generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Debounced save to avoid too many disk writes
   */
  debouncedSave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveMessages();
    }, 5000); // Save after 5 seconds of inactivity
  }

  /**
   * Cleanup on shutdown
   */
  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    // Final save
    this.saveMessages();
    console.log('ChatHistoryManager shutdown complete');
  }
}

module.exports = ChatHistoryManager;
