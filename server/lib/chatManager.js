/**
 * chatManager.js
 * 
 * Real-time keyboard-to-keyboard chat system with multi-room support
 * Similar to BPQ's chat functionality
 */

const EventEmitter = require('events');
const crypto = require('crypto');

class ChatManager extends EventEmitter {
  constructor(channelManager, options = {}) {
    super();
    
    this.channelManager = channelManager;
    this.rooms = new Map(); // roomName -> Room object
    this.sessions = new Map(); // callsign -> ChatSession
    this.userToRoom = new Map(); // callsign -> roomName
    this.historyManager = options.historyManager || null; // Optional history manager
    
    // Settings
    this.settings = {
      defaultRoom: options.defaultRoom || 'LOBBY',
      maxRooms: options.maxRooms || 50,
      maxUsersPerRoom: options.maxUsersPerRoom || 50,
      maxMessageHistory: options.maxMessageHistory || 100,
      allowPrivateRooms: options.allowPrivateRooms !== false,
      allowRoomCreation: options.allowRoomCreation !== false,
      messageRateLimit: options.messageRateLimit || 10, // messages per minute
      ...options
    };
    
    // Create default lobby
    this.createRoom(this.settings.defaultRoom, {
      description: 'Default chat lobby',
      persistent: true,
      public: true
    });
    
    console.log(`ChatManager initialized (default room: ${this.settings.defaultRoom}, history: ${this.historyManager ? 'enabled' : 'disabled'})`);
  }
  
  /**
   * Create a new chat room
   */
  createRoom(name, options = {}) {
    if (this.rooms.has(name)) {
      throw new Error(`Room ${name} already exists`);
    }
    
    if (this.rooms.size >= this.settings.maxRooms && !options.persistent) {
      throw new Error('Maximum number of rooms reached');
    }
    
    const room = {
      name,
      description: options.description || '',
      users: new Set(),
      messages: [],
      created: Date.now(),
      creator: options.creator || 'SYSTEM',
      persistent: options.persistent || false,
      public: options.public !== false,
      password: options.password || null,
      maxUsers: options.maxUsers || this.settings.maxUsersPerRoom,
      moderators: new Set(options.moderators || []),
      banned: new Set(),
      muted: new Set(),
      topic: options.topic || ''
    };
    
    this.rooms.set(name, room);
    this.emit('room-created', { name, creator: room.creator });
    
    console.log(`Chat room created: ${name} by ${room.creator}`);
    return room;
  }
  
  /**
   * Delete a chat room
   */
  deleteRoom(name, byCallsign) {
    const room = this.rooms.get(name);
    if (!room) {
      throw new Error(`Room ${name} does not exist`);
    }
    
    if (room.persistent) {
      throw new Error(`Cannot delete persistent room ${name}`);
    }
    
    // Check permissions
    if (byCallsign && !room.moderators.has(byCallsign) && room.creator !== byCallsign) {
      throw new Error('Only room creator or moderators can delete the room');
    }
    
    // Kick all users
    for (const callsign of room.users) {
      this.leaveRoom(callsign, name);
    }
    
    this.rooms.delete(name);
    this.emit('room-deleted', { name, by: byCallsign });
    
    console.log(`Chat room deleted: ${name} by ${byCallsign || 'SYSTEM'}`);
  }
  
  /**
   * Join a chat room
   */
  joinRoom(callsign, roomName, password = null) {
    const room = this.rooms.get(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} does not exist`);
    }
    
    // Check if banned
    if (room.banned.has(callsign)) {
      throw new Error(`You are banned from ${roomName}`);
    }
    
    // Check password for private rooms
    if (room.password && room.password !== password) {
      throw new Error(`Incorrect password for ${roomName}`);
    }
    
    // Check max users
    if (room.users.size >= room.maxUsers && !room.moderators.has(callsign)) {
      throw new Error(`Room ${roomName} is full`);
    }
    
    // Leave current room if in one
    const currentRoom = this.userToRoom.get(callsign);
    if (currentRoom && currentRoom !== roomName) {
      this.leaveRoom(callsign, currentRoom);
    }
    
    // Add user to room
    room.users.add(callsign);
    this.userToRoom.set(callsign, roomName);
    
    // Add join message
    const joinMsg = {
      type: 'system',
      text: `${callsign} joined the room`,
      timestamp: Date.now()
    };
    this.addMessage(roomName, joinMsg);
    
    // Broadcast to room
    this.broadcastToRoom(roomName, {
      type: 'user-joined',
      callsign,
      userCount: room.users.size
    }, callsign);
    
    this.emit('user-joined', { callsign, roomName });
    
    console.log(`${callsign} joined room ${roomName}`);
    return room;
  }
  
  /**
   * Leave a chat room
   */
  leaveRoom(callsign, roomName) {
    const room = this.rooms.get(roomName);
    if (!room) {
      return; // Room doesn't exist, nothing to do
    }
    
    if (!room.users.has(callsign)) {
      return; // User not in room
    }
    
    // Remove user
    room.users.delete(callsign);
    this.userToRoom.delete(callsign);
    
    // Add leave message
    const leaveMsg = {
      type: 'system',
      text: `${callsign} left the room`,
      timestamp: Date.now()
    };
    this.addMessage(roomName, leaveMsg);
    
    // Broadcast to room
    this.broadcastToRoom(roomName, {
      type: 'user-left',
      callsign,
      userCount: room.users.size
    });
    
    // Delete non-persistent empty rooms
    if (!room.persistent && room.users.size === 0) {
      this.deleteRoom(roomName);
    }
    
    this.emit('user-left', { callsign, roomName });
    
    console.log(`${callsign} left room ${roomName}`);
  }
  
  /**
   * Send a message to a room
   */
  sendMessage(fromCallsign, roomName, text) {
    const room = this.rooms.get(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} does not exist`);
    }
    
    if (!room.users.has(fromCallsign)) {
      throw new Error(`You are not in room ${roomName}`);
    }
    
    // Check if muted
    if (room.muted.has(fromCallsign)) {
      throw new Error('You are muted in this room');
    }
    
    // Check rate limit
    const now = Date.now();
    const session = this.sessions.get(fromCallsign);
    if (session) {
      const recentMessages = session.messageTimestamps.filter(ts => now - ts < 60000);
      if (recentMessages.length >= this.settings.messageRateLimit) {
        throw new Error('Rate limit exceeded. Please slow down.');
      }
      session.messageTimestamps = [...recentMessages, now];
    }
    
    const message = {
      type: 'message',
      from: fromCallsign,
      text,
      timestamp: now,
      id: crypto.randomBytes(8).toString('hex')
    };
    
    this.addMessage(roomName, message);
    
    // Store in persistent history (if enabled)
    if (this.historyManager) {
      const session = this.sessions.get(fromCallsign);
      this.historyManager.addMessage(roomName, fromCallsign, text, {
        connectionType: session?.connectionType || 'websocket',
        messageId: message.id
      });
    }
    
    // Broadcast to all users in room
    this.broadcastToRoom(roomName, {
      type: 'chat-message',
      message
    });
    
    this.emit('message-sent', { callsign: fromCallsign, roomName, message });
    
    return message;
  }
  
  /**
   * Send a private message to another user
   */
  sendPrivateMessage(fromCallsign, toCallsign, text) {
    // Check if both users exist
    if (!this.sessions.has(toCallsign)) {
      throw new Error(`User ${toCallsign} is not online`);
    }
    
    const message = {
      type: 'private',
      from: fromCallsign,
      to: toCallsign,
      text,
      timestamp: Date.now(),
      id: crypto.randomBytes(8).toString('hex')
    };
    
    // Send to recipient
    const toSession = this.sessions.get(toCallsign);
    if (toSession) {
      toSession.emit('private-message', message);
    }
    
    // Send copy to sender
    const fromSession = this.sessions.get(fromCallsign);
    if (fromSession) {
      fromSession.emit('private-message-sent', message);
    }
    
    this.emit('private-message-sent', { from: fromCallsign, to: toCallsign, message });
    
    return message;
  }
  
  /**
   * Add a message to room history
   */
  addMessage(roomName, message) {
    const room = this.rooms.get(roomName);
    if (!room) return;
    
    room.messages.push(message);
    
    // Trim history to max size
    if (room.messages.length > this.settings.maxMessageHistory) {
      room.messages = room.messages.slice(-this.settings.maxMessageHistory);
    }
  }
  
  /**
   * Broadcast a message to all users in a room
   */
  broadcastToRoom(roomName, data, exceptCallsign = null) {
    const room = this.rooms.get(roomName);
    if (!room) return;
    
    for (const callsign of room.users) {
      if (callsign === exceptCallsign) continue;
      
      const session = this.sessions.get(callsign);
      if (session) {
        session.emit('broadcast', { roomName, ...data });
      }
    }
  }
  
  /**
   * Set room topic
   */
  setTopic(roomName, topic, byCallsign) {
    const room = this.rooms.get(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} does not exist`);
    }
    
    // Check permissions
    if (!room.moderators.has(byCallsign) && room.creator !== byCallsign) {
      throw new Error('Only room creator or moderators can set the topic');
    }
    
    room.topic = topic;
    
    const topicMsg = {
      type: 'system',
      text: `${byCallsign} changed the topic to: ${topic}`,
      timestamp: Date.now()
    };
    this.addMessage(roomName, topicMsg);
    
    this.broadcastToRoom(roomName, {
      type: 'topic-changed',
      topic,
      by: byCallsign
    });
  }
  
  /**
   * Add a moderator to a room
   */
  addModerator(roomName, callsign, byCallsign) {
    const room = this.rooms.get(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} does not exist`);
    }
    
    if (room.creator !== byCallsign) {
      throw new Error('Only room creator can add moderators');
    }
    
    room.moderators.add(callsign);
    
    const msg = {
      type: 'system',
      text: `${callsign} is now a moderator`,
      timestamp: Date.now()
    };
    this.addMessage(roomName, msg);
    
    this.broadcastToRoom(roomName, {
      type: 'moderator-added',
      callsign
    });
  }
  
  /**
   * Ban a user from a room
   */
  banUser(roomName, callsign, byCallsign, reason = '') {
    const room = this.rooms.get(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} does not exist`);
    }
    
    if (!room.moderators.has(byCallsign) && room.creator !== byCallsign) {
      throw new Error('Only moderators can ban users');
    }
    
    room.banned.add(callsign);
    
    // Kick user if in room
    if (room.users.has(callsign)) {
      this.leaveRoom(callsign, roomName);
    }
    
    const msg = {
      type: 'system',
      text: `${callsign} was banned${reason ? ': ' + reason : ''}`,
      timestamp: Date.now()
    };
    this.addMessage(roomName, msg);
  }
  
  /**
   * Mute a user in a room
   */
  muteUser(roomName, callsign, byCallsign) {
    const room = this.rooms.get(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} does not exist`);
    }
    
    if (!room.moderators.has(byCallsign) && room.creator !== byCallsign) {
      throw new Error('Only moderators can mute users');
    }
    
    room.muted.add(callsign);
    
    const msg = {
      type: 'system',
      text: `${callsign} was muted`,
      timestamp: Date.now()
    };
    this.addMessage(roomName, msg);
    
    this.broadcastToRoom(roomName, {
      type: 'user-muted',
      callsign
    });
  }
  
  /**
   * Unmute a user in a room
   */
  unmuteUser(roomName, callsign, byCallsign) {
    const room = this.rooms.get(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} does not exist`);
    }
    
    if (!room.moderators.has(byCallsign) && room.creator !== byCallsign) {
      throw new Error('Only moderators can unmute users');
    }
    
    room.muted.delete(callsign);
    
    const msg = {
      type: 'system',
      text: `${callsign} was unmuted`,
      timestamp: Date.now()
    };
    this.addMessage(roomName, msg);
  }
  
  /**
   * Get list of all rooms
   */
  listRooms(includePrivate = false) {
    const rooms = [];
    
    for (const [name, room] of this.rooms) {
      if (!includePrivate && !room.public) continue;
      
      rooms.push({
        name,
        description: room.description,
        userCount: room.users.size,
        maxUsers: room.maxUsers,
        created: room.created,
        creator: room.creator,
        hasPassword: !!room.password,
        topic: room.topic,
        persistent: room.persistent
      });
    }
    
    return rooms;
  }
  
  /**
   * Get users in a room
   */
  getUsersInRoom(roomName) {
    const room = this.rooms.get(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} does not exist`);
    }
    
    return Array.from(room.users).map(callsign => {
      const session = this.sessions.get(callsign);
      return {
        callsign,
        status: session ? session.status : 'offline',
        joinedAt: session ? session.joinedAt : null,
        isModerator: room.moderators.has(callsign),
        isCreator: room.creator === callsign,
        isMuted: room.muted.has(callsign)
      };
    });
  }
  
  /**
   * Get room history
   */
  getRoomHistory(roomName, limit = 50) {
    const room = this.rooms.get(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} does not exist`);
    }
    
    return room.messages.slice(-limit);
  }
  
  /**
   * Get room info
   */
  getRoomInfo(roomName) {
    const room = this.rooms.get(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} does not exist`);
    }
    
    return {
      name: room.name,
      description: room.description,
      userCount: room.users.size,
      maxUsers: room.maxUsers,
      created: room.created,
      creator: room.creator,
      hasPassword: !!room.password,
      topic: room.topic,
      persistent: room.persistent,
      public: room.public,
      moderators: Array.from(room.moderators)
    };
  }
  
  /**
   * Get current room for a user
   */
  getUserRoom(callsign) {
    return this.userToRoom.get(callsign) || null;
  }
  
  /**
   * Register a chat session
   */
  registerSession(session) {
    this.sessions.set(session.callsign, session);
    console.log(`Chat session registered: ${session.callsign}`);
  }
  
  /**
   * Unregister a chat session
   */
  unregisterSession(callsign) {
    const session = this.sessions.get(callsign);
    if (!session) return;
    
    // Leave current room
    const roomName = this.userToRoom.get(callsign);
    if (roomName) {
      this.leaveRoom(callsign, roomName);
    }
    
    this.sessions.delete(callsign);
    console.log(`Chat session unregistered: ${callsign}`);
  }
  
  /**
   * Update settings
   */
  updateSettings(newSettings) {
    Object.assign(this.settings, newSettings);
    this.emit('settings-updated', this.settings);
  }
  
  /**
   * Get message history (transforms history format to chat message format)
   */
  getHistory(roomName, limit = 100, connectionType = null) {
    if (!this.historyManager) {
      return [];
    }
    
    // Only return history for websocket connections (web UI)
    if (connectionType === 'ax25') {
      return []; // RF users don't get history
    }
    
    const historyMessages = this.historyManager.getHistoryForWebUI(roomName, limit);
    
    // Transform history format {callsign, text, timestamp, ...} 
    // to chat message format {from, text, timestamp, type, id, ...}
    return historyMessages.map(msg => ({
      type: 'message',
      from: msg.callsign,
      text: msg.text,
      timestamp: msg.timestamp,
      id: msg.messageId || msg.id
    }));
  }
  
  /**
   * Get statistics
   */
  getStats() {
    let totalUsers = 0;
    let totalMessages = 0;
    
    for (const room of this.rooms.values()) {
      totalUsers += room.users.size;
      totalMessages += room.messages.length;
    }
    
    const stats = {
      roomCount: this.rooms.size,
      activeUsers: this.sessions.size,
      totalUsers,
      totalMessages,
      settings: this.settings
    };
    
    // Add history stats if available
    if (this.historyManager) {
      stats.history = this.historyManager.getStats();
    }
    
    return stats;
  }
}

module.exports = ChatManager;
