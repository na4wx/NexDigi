/**
 * UserRegistry.js
 * Maintains a distributed registry of users and their home nodes
 * 
 * Responsibilities:
 * - Map callsigns to home nodes (where user's mailbox lives)
 * - Synchronize registry across backbone network
 * - Handle user registration and updates
 * - Provide fast lookup for message routing
 * - Persist registry to disk for reliability
 * 
 * Design:
 * - Each node maintains local users (users with mailboxes here)
 * - Local users are advertised via heartbeats
 * - Registry updates propagate through the network
 * - Conflicts resolved by timestamp (last-write-wins)
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

class UserRegistry extends EventEmitter {
  /**
   * Create a user registry
   * @param {Object} config - Configuration
   * @param {String} config.nodeCallsign - This node's callsign
   * @param {String} config.dataDir - Directory for persistence
   * @param {Number} config.syncInterval - Sync broadcast interval (ms, default 300000 = 5min)
   * @param {Number} config.cleanupInterval - Stale entry cleanup (ms, default 3600000 = 1hr)
   * @param {Number} config.entryTTL - Entry time-to-live (ms, default 86400000 = 24hr)
   */
  constructor(config = {}) {
    super();
    
    this.nodeCallsign = config.nodeCallsign || 'UNKNOWN';
    this.dataDir = config.dataDir || './data';
    this.syncInterval = config.syncInterval || 300000; // 5 minutes
    this.cleanupInterval = config.cleanupInterval || 3600000; // 1 hour
    this.entryTTL = config.entryTTL || 86400000; // 24 hours
    
    // Registry data structures
    this.users = new Map(); // callsign -> { homeNode, timestamp, services }
    this.localUsers = new Set(); // Users with mailboxes on this node
    this.nodeUsers = new Map(); // homeNode -> Set(callsigns)
    
    // Statistics
    this.stats = {
      totalUsers: 0,
      localUsers: 0,
      remoteUsers: 0,
      updates: 0,
      conflicts: 0,
      removals: 0,
      syncsSent: 0,
      syncsReceived: 0
    };
    
    // Timers
    this.syncTimer = null;
    this.cleanupTimer = null;
    
    this.started = false;
  }
  
  /**
   * Start the registry
   */
  async start() {
    if (this.started) return;
    
    console.log(`[UserRegistry] Starting for node ${this.nodeCallsign}`);
    
    // Load persisted registry
    await this.load();
    
    // Start periodic sync broadcasts
    this.syncTimer = setInterval(() => {
      this.emit('sync-needed', this.getLocalUsersUpdate());
    }, this.syncInterval);
    
    // Start cleanup of stale entries
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleEntries();
    }, this.cleanupInterval);
    
    this.started = true;
    console.log(`[UserRegistry] Started with ${this.users.size} users (${this.localUsers.size} local)`);
  }
  
  /**
   * Stop the registry
   */
  async stop() {
    if (!this.started) return;
    
    console.log('[UserRegistry] Stopping...');
    
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    // Save registry
    await this.save();
    
    this.started = false;
    console.log('[UserRegistry] Stopped');
  }
  
  /**
   * Register a local user (user with mailbox on this node)
   * @param {String} callsign - User callsign
   * @param {Object} options - User options
   * @param {Array} options.services - Services user supports (e.g., ['winlink', 'bbs'])
   * @returns {Boolean} True if registered
   */
  registerLocalUser(callsign, options = {}) {
    callsign = this._normalizeCallsign(callsign);
    
    if (!this._isValidCallsign(callsign)) {
      console.warn(`[UserRegistry] Invalid callsign: ${callsign}`);
      return false;
    }
    
    // Add to local users
    this.localUsers.add(callsign);
    
    // Register in main registry
    this._updateUser(callsign, {
      homeNode: this.nodeCallsign,
      timestamp: Date.now(),
      services: options.services || ['winlink'],
      local: true
    });
    
    console.log(`[UserRegistry] Registered local user: ${callsign}`);
    this.emit('user-registered', callsign, this.nodeCallsign);
    
    return true;
  }
  
  /**
   * Unregister a local user
   * @param {String} callsign - User callsign
   * @returns {Boolean} True if unregistered
   */
  unregisterLocalUser(callsign) {
    callsign = this._normalizeCallsign(callsign);
    
    if (!this.localUsers.has(callsign)) {
      return false;
    }
    
    this.localUsers.delete(callsign);
    
    // Remove from main registry
    const removed = this._removeUser(callsign);
    
    if (removed) {
      console.log(`[UserRegistry] Unregistered local user: ${callsign}`);
      this.emit('user-unregistered', callsign);
    }
    
    return removed;
  }
  
  /**
   * Look up home node for a user
   * @param {String} callsign - User callsign
   * @returns {String|null} Home node callsign or null if not found
   */
  getHomeNode(callsign) {
    callsign = this._normalizeCallsign(callsign);
    const user = this.users.get(callsign);
    return user ? user.homeNode : null;
  }
  
  /**
   * Check if a user is local to this node
   * @param {String} callsign - User callsign
   * @returns {Boolean} True if user is local
   */
  isLocalUser(callsign) {
    callsign = this._normalizeCallsign(callsign);
    return this.localUsers.has(callsign);
  }
  
  /**
   * Get all users for a specific home node
   * @param {String} nodeCallsign - Node callsign
   * @returns {Array} Array of callsigns
   */
  getUsersForNode(nodeCallsign) {
    const users = this.nodeUsers.get(nodeCallsign);
    return users ? Array.from(users) : [];
  }
  
  /**
   * Process a registry update from another node
   * @param {Object} update - Update data
   * @param {String} update.fromNode - Source node callsign
   * @param {Array} update.users - User entries [{callsign, homeNode, timestamp, services}]
   * @returns {Object} Stats about the update
   */
  processUpdate(update) {
    if (!update || !update.users || !Array.isArray(update.users)) {
      console.warn('[UserRegistry] Invalid update format');
      return { applied: 0, conflicts: 0, ignored: 0 };
    }
    
    const stats = { applied: 0, conflicts: 0, ignored: 0 };
    
    for (const entry of update.users) {
      if (!this._isValidCallsign(entry.callsign)) {
        stats.ignored++;
        continue;
      }
      
      const callsign = this._normalizeCallsign(entry.callsign);
      
      // Don't accept updates for our local users
      if (this.localUsers.has(callsign)) {
        stats.ignored++;
        continue;
      }
      
      const existing = this.users.get(callsign);
      
      if (!existing) {
        // New user
        this._updateUser(callsign, entry);
        stats.applied++;
      } else if (entry.timestamp > existing.timestamp) {
        // Newer update
        this._updateUser(callsign, entry);
        stats.applied++;
      } else if (entry.timestamp === existing.timestamp) {
        // Conflict - use lexically larger homeNode as tiebreaker
        if (entry.homeNode > existing.homeNode) {
          this._updateUser(callsign, entry);
          stats.conflicts++;
          this.stats.conflicts++;
        } else {
          stats.ignored++;
        }
      } else {
        // Older update
        stats.ignored++;
      }
    }
    
    this.stats.syncsReceived++;
    this.stats.updates += stats.applied;
    
    if (stats.applied > 0) {
      console.log(`[UserRegistry] Applied ${stats.applied} updates from ${update.fromNode}`);
      this.emit('registry-updated', stats);
    }
    
    return stats;
  }
  
  /**
   * Get local users update for broadcasting
   * @returns {Object} Update packet
   */
  getLocalUsersUpdate() {
    const users = [];
    
    for (const callsign of this.localUsers) {
      const user = this.users.get(callsign);
      if (user) {
        users.push({
          callsign,
          homeNode: user.homeNode,
          timestamp: user.timestamp,
          services: user.services
        });
      }
    }
    
    return {
      fromNode: this.nodeCallsign,
      timestamp: Date.now(),
      users
    };
  }
  
  /**
   * Get full registry snapshot
   * @returns {Array} All user entries
   */
  getSnapshot() {
    const snapshot = [];
    
    for (const [callsign, user] of this.users) {
      snapshot.push({
        callsign,
        homeNode: user.homeNode,
        timestamp: user.timestamp,
        services: user.services,
        local: this.localUsers.has(callsign)
      });
    }
    
    return snapshot;
  }
  
  /**
   * Clean up stale entries
   */
  cleanupStaleEntries() {
    const now = Date.now();
    const toRemove = [];
    
    for (const [callsign, user] of this.users) {
      // Don't remove local users
      if (this.localUsers.has(callsign)) {
        continue;
      }
      
      const age = now - user.timestamp;
      if (age > this.entryTTL) {
        toRemove.push(callsign);
      }
    }
    
    if (toRemove.length > 0) {
      console.log(`[UserRegistry] Removing ${toRemove.length} stale entries`);
      
      for (const callsign of toRemove) {
        this._removeUser(callsign);
      }
      
      this.stats.removals += toRemove.length;
      this.emit('stale-entries-removed', toRemove);
    }
  }
  
  /**
   * Get statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      ...this.stats,
      totalUsers: this.users.size,
      localUsers: this.localUsers.size,
      remoteUsers: this.users.size - this.localUsers.size,
      nodes: this.nodeUsers.size
    };
  }
  
  /**
   * Load registry from disk
   */
  async load() {
    const filePath = path.join(this.dataDir, 'user-registry.json');
    
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const saved = JSON.parse(data);
      
      if (saved.users) {
        for (const entry of saved.users) {
          if (entry.local) {
            this.localUsers.add(entry.callsign);
          }
          this._updateUser(entry.callsign, entry);
        }
      }
      
      console.log(`[UserRegistry] Loaded ${this.users.size} users from disk`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[UserRegistry] Error loading registry:', error.message);
      }
    }
  }
  
  /**
   * Save registry to disk
   */
  async save() {
    const filePath = path.join(this.dataDir, 'user-registry.json');
    
    try {
      // Ensure directory exists
      await fs.mkdir(this.dataDir, { recursive: true });
      
      const data = {
        nodeCallsign: this.nodeCallsign,
        timestamp: Date.now(),
        users: this.getSnapshot()
      };
      
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`[UserRegistry] Saved ${this.users.size} users to disk`);
    } catch (error) {
      console.error('[UserRegistry] Error saving registry:', error.message);
    }
  }
  
  // Private methods
  
  /**
   * Update user entry
   * @private
   */
  _updateUser(callsign, data) {
    const existing = this.users.get(callsign);
    const isNew = !existing;
    
    this.users.set(callsign, {
      homeNode: data.homeNode,
      timestamp: data.timestamp,
      services: data.services || ['winlink'],
      local: data.local || false
    });
    
    // Update node index
    if (!this.nodeUsers.has(data.homeNode)) {
      this.nodeUsers.set(data.homeNode, new Set());
    }
    this.nodeUsers.get(data.homeNode).add(callsign);
    
    // Clean up old node index if home node changed
    if (existing && existing.homeNode !== data.homeNode) {
      const oldUsers = this.nodeUsers.get(existing.homeNode);
      if (oldUsers) {
        oldUsers.delete(callsign);
        if (oldUsers.size === 0) {
          this.nodeUsers.delete(existing.homeNode);
        }
      }
    }
    
    if (isNew) {
      this.emit('user-added', callsign, data.homeNode);
    } else {
      this.emit('user-updated', callsign, data.homeNode);
    }
  }
  
  /**
   * Remove user entry
   * @private
   */
  _removeUser(callsign) {
    const user = this.users.get(callsign);
    if (!user) return false;
    
    this.users.delete(callsign);
    
    // Update node index
    const nodeUsers = this.nodeUsers.get(user.homeNode);
    if (nodeUsers) {
      nodeUsers.delete(callsign);
      if (nodeUsers.size === 0) {
        this.nodeUsers.delete(user.homeNode);
      }
    }
    
    this.emit('user-removed', callsign);
    return true;
  }
  
  /**
   * Normalize callsign
   * @private
   */
  _normalizeCallsign(callsign) {
    return callsign.toUpperCase().trim();
  }
  
  /**
   * Validate callsign format
   * @private
   */
  _isValidCallsign(callsign) {
    if (!callsign || typeof callsign !== 'string') {
      return false;
    }
    
    // Basic callsign validation
    // Format: [prefix][number][suffix][-SSID]
    // Must have at least one letter
    // Examples: W1ABC, KG4WXN, N5ABC-10, K1A, 2E0ABC
    // Invalid: 123, ABC (no number), W (too short)
    const pattern = /^[A-Z0-9]*[A-Z][A-Z0-9]*[0-9][A-Z0-9]*(-[0-9]{1,2})?$/i;
    
    // Also check overall length (3-9 chars before SSID)
    const baseCall = callsign.split('-')[0];
    if (baseCall.length < 3 || baseCall.length > 9) {
      return false;
    }
    
    return pattern.test(callsign);
  }
}

module.exports = UserRegistry;
