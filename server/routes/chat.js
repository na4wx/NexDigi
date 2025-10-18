/**
 * chat.js - Chat API Routes
 * 
 * REST endpoints and WebSocket integration for real-time chat
 */

const express = require('express');
const router = express.Router();
const ChatManager = require('../lib/chatManager');
const ChatSession = require('../lib/chatSession');
const path = require('path');
const fs = require('fs').promises;

// Chat manager instance (will be injected)
let chatManager = null;
let wsServer = null;

/**
 * Initialize chat routes with dependencies
 */
function createChatRoutes(dependencies = {}) {
  chatManager = dependencies.chatManager || new ChatManager(dependencies.channelManager);
  wsServer = dependencies.wsServer;
  
  // Setup WebSocket handlers and attach them to the router for export
  const handlers = setupWebSocketHandlers();
  router.chatWebSocketHandlers = handlers;
  
  return router;
}

/**
 * Setup WebSocket handlers for real-time chat
 * This function returns handlers to be used by the main WebSocket connection handler
 */
function setupWebSocketHandlers() {
  console.log('Chat WebSocket handlers initialized');
  // Return handler functions that can be called from the main WebSocket handler
  return {
    handleChatMessage: (ws, message) => {
      try {
        switch (message.type) {
          case 'chat-connect':
            handleChatConnect(ws, message);
            break;
            
          case 'chat-message':
            handleChatMessageText(ws, message);
            break;
            
          case 'chat-typing':
            handleTyping(ws, message);
            break;
            
          case 'chat-disconnect':
            handleChatDisconnect(ws);
            break;
        }
      } catch (err) {
        console.error('Error handling chat WebSocket message:', err);
      }
    },
    
    handleDisconnect: (ws) => {
      if (ws.chatSession) {
        ws.chatSession.disconnect();
      }
    }
  };
  
  function handleChatConnect(ws, message) {
    const { callsign } = message;
    if (!callsign) return;
    
    // Create chat session
    const session = new ChatSession(callsign, chatManager, {
      connectionType: 'websocket',
      autoJoin: true
    });
    
    ws.chatSession = session;
    
    // Forward session events to WebSocket
    session.on('message', (data) => {
      ws.send(JSON.stringify({
        type: 'chat-message',
        ...data
      }));
    });
    
    session.on('broadcast', (data) => {
      ws.send(JSON.stringify({
        type: 'chat-broadcast',
        ...data
      }));
    });
    
    session.on('private-message', (message) => {
      ws.send(JSON.stringify({
        type: 'chat-private-message',
        message
      }));
    });
    
    session.on('disconnect', () => {
      ws.send(JSON.stringify({
        type: 'chat-disconnected'
      }));
    });
    
    // Send welcome
    ws.send(JSON.stringify({
      type: 'chat-connected',
      callsign,
      defaultRoom: chatManager.settings.defaultRoom
    }));
  }
  
  function handleChatMessageText(ws, message) {
    const session = ws.chatSession;
    if (!session) return;
    
    const { text } = message;
    if (!text) return;
    
    session.handleMessage(text);
  }
  
  function handleTyping(ws, message) {
    const session = ws.chatSession;
    if (!session) return;
    
    const { typing } = message;
    if (typing) {
      session.setTyping();
    } else {
      session.clearTyping();
    }
  }
  
  function handleChatDisconnect(ws) {
    const session = ws.chatSession;
    if (session) {
      session.disconnect();
      delete ws.chatSession;
    }
  }
}

// ============================================================================
// REST API Routes
// ============================================================================

/**
 * GET /api/chat/rooms
 * List all available chat rooms
 */
router.get('/rooms', (req, res) => {
  try {
    const includePrivate = req.query.includePrivate === 'true';
    const rooms = chatManager.listRooms(includePrivate);
    
    res.json({
      success: true,
      rooms,
      count: rooms.length
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/chat/rooms
 * Create a new chat room
 */
router.post('/rooms', (req, res) => {
  try {
    const { name, description, password, maxUsers, public: isPublic } = req.body;
    const creator = req.body.creator || 'SYSTEM';
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Room name is required'
      });
    }
    
    const room = chatManager.createRoom(name.toUpperCase(), {
      description,
      password,
      maxUsers: maxUsers || chatManager.settings.maxUsersPerRoom,
      public: isPublic !== false,
      creator,
      moderators: [creator]
    });
    
    res.json({
      success: true,
      room: {
        name: room.name,
        description: room.description,
        userCount: room.users.size,
        maxUsers: room.maxUsers,
        hasPassword: !!room.password,
        created: room.created
      }
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /api/chat/rooms/:name
 * Get room information
 */
router.get('/rooms/:name', (req, res) => {
  try {
    const roomName = req.params.name.toUpperCase();
    const info = chatManager.getRoomInfo(roomName);
    
    res.json({
      success: true,
      room: info
    });
  } catch (err) {
    res.status(404).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * DELETE /api/chat/rooms/:name
 * Delete a chat room
 */
router.delete('/rooms/:name', (req, res) => {
  try {
    const roomName = req.params.name.toUpperCase();
    const byCallsign = req.body.callsign || req.query.callsign;
    
    chatManager.deleteRoom(roomName, byCallsign);
    
    res.json({
      success: true,
      message: `Room ${roomName} deleted`
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /api/chat/rooms/:name/users
 * List users in a room
 */
router.get('/rooms/:name/users', (req, res) => {
  try {
    const roomName = req.params.name.toUpperCase();
    const users = chatManager.getUsersInRoom(roomName);
    
    res.json({
      success: true,
      users,
      count: users.length
    });
  } catch (err) {
    res.status(404).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/chat/rooms/:name/join
 * Join a chat room
 */
router.post('/rooms/:name/join', (req, res) => {
  try {
    const roomName = req.params.name.toUpperCase();
    const { callsign, password } = req.body;
    
    if (!callsign) {
      return res.status(400).json({
        success: false,
        error: 'Callsign is required'
      });
    }
    
    const room = chatManager.joinRoom(callsign.toUpperCase(), roomName, password);
    
    res.json({
      success: true,
      room: {
        name: room.name,
        description: room.description,
        userCount: room.users.size,
        topic: room.topic
      }
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/chat/rooms/:name/leave
 * Leave a chat room
 */
router.post('/rooms/:name/leave', (req, res) => {
  try {
    const roomName = req.params.name.toUpperCase();
    const { callsign } = req.body;
    
    if (!callsign) {
      return res.status(400).json({
        success: false,
        error: 'Callsign is required'
      });
    }
    
    chatManager.leaveRoom(callsign.toUpperCase(), roomName);
    
    res.json({
      success: true,
      message: `Left room ${roomName}`
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /api/chat/rooms/:name/messages
 * Get message history for a room
 */
router.get('/rooms/:name/messages', (req, res) => {
  try {
    const roomName = req.params.name.toUpperCase();
    const limit = parseInt(req.query.limit) || 50;
    
    const messages = chatManager.getRoomHistory(roomName, limit);
    
    res.json({
      success: true,
      messages,
      count: messages.length
    });
  } catch (err) {
    res.status(404).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/chat/rooms/:name/messages
 * Send a message to a room
 */
router.post('/rooms/:name/messages', (req, res) => {
  try {
    const roomName = req.params.name.toUpperCase();
    const { callsign, text } = req.body;
    
    if (!callsign || !text) {
      return res.status(400).json({
        success: false,
        error: 'Callsign and text are required'
      });
    }
    
    const message = chatManager.sendMessage(callsign.toUpperCase(), roomName, text);
    
    res.json({
      success: true,
      message
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/chat/rooms/:name/topic
 * Set room topic
 */
router.post('/rooms/:name/topic', (req, res) => {
  try {
    const roomName = req.params.name.toUpperCase();
    const { callsign, topic } = req.body;
    
    if (!callsign) {
      return res.status(400).json({
        success: false,
        error: 'Callsign is required'
      });
    }
    
    chatManager.setTopic(roomName, topic || '', callsign.toUpperCase());
    
    res.json({
      success: true,
      topic
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/chat/rooms/:name/kick
 * Kick a user from a room
 */
router.post('/rooms/:name/kick', (req, res) => {
  try {
    const roomName = req.params.name.toUpperCase();
    const { callsign, target } = req.body;
    
    if (!callsign || !target) {
      return res.status(400).json({
        success: false,
        error: 'Callsign and target are required'
      });
    }
    
    // Check permissions (simplified - should verify moderator status)
    chatManager.leaveRoom(target.toUpperCase(), roomName);
    
    res.json({
      success: true,
      message: `Kicked ${target} from ${roomName}`
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/chat/rooms/:name/ban
 * Ban a user from a room
 */
router.post('/rooms/:name/ban', (req, res) => {
  try {
    const roomName = req.params.name.toUpperCase();
    const { callsign, target, reason } = req.body;
    
    if (!callsign || !target) {
      return res.status(400).json({
        success: false,
        error: 'Callsign and target are required'
      });
    }
    
    chatManager.banUser(roomName, target.toUpperCase(), callsign.toUpperCase(), reason);
    
    res.json({
      success: true,
      message: `Banned ${target} from ${roomName}`
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/chat/rooms/:name/mute
 * Mute a user in a room
 */
router.post('/rooms/:name/mute', (req, res) => {
  try {
    const roomName = req.params.name.toUpperCase();
    const { callsign, target } = req.body;
    
    if (!callsign || !target) {
      return res.status(400).json({
        success: false,
        error: 'Callsign and target are required'
      });
    }
    
    chatManager.muteUser(roomName, target.toUpperCase(), callsign.toUpperCase());
    
    res.json({
      success: true,
      message: `Muted ${target} in ${roomName}`
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * DELETE /api/chat/rooms/:name/mute/:target
 * Unmute a user in a room
 */
router.delete('/rooms/:name/mute/:target', (req, res) => {
  try {
    const roomName = req.params.name.toUpperCase();
    const target = req.params.target.toUpperCase();
    const { callsign } = req.body;
    
    if (!callsign) {
      return res.status(400).json({
        success: false,
        error: 'Callsign is required'
      });
    }
    
    chatManager.unmuteUser(roomName, target, callsign.toUpperCase());
    
    res.json({
      success: true,
      message: `Unmuted ${target} in ${roomName}`
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/chat/rooms/:name/moderator
 * Add a moderator to a room
 */
router.post('/rooms/:name/moderator', (req, res) => {
  try {
    const roomName = req.params.name.toUpperCase();
    const { callsign, target } = req.body;
    
    if (!callsign || !target) {
      return res.status(400).json({
        success: false,
        error: 'Callsign and target are required'
      });
    }
    
    chatManager.addModerator(roomName, target.toUpperCase(), callsign.toUpperCase());
    
    res.json({
      success: true,
      message: `Added ${target} as moderator in ${roomName}`
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/chat/private
 * Send a private message
 */
router.post('/private', (req, res) => {
  try {
    const { from, to, text } = req.body;
    
    if (!from || !to || !text) {
      return res.status(400).json({
        success: false,
        error: 'From, to, and text are required'
      });
    }
    
    const message = chatManager.sendPrivateMessage(
      from.toUpperCase(),
      to.toUpperCase(),
      text
    );
    
    res.json({
      success: true,
      message
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /api/chat/stats
 * Get chat system statistics
 */
router.get('/stats', (req, res) => {
  try {
    const stats = chatManager.getStats();
    
    res.json({
      success: true,
      stats
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /api/chat/history/:room
 * Get persistent message history for a room (web UI only)
 */
router.get('/history/:room', (req, res) => {
  try {
    const roomName = req.params.room.toUpperCase();
    const limit = parseInt(req.query.limit) || 100;
    const connectionType = req.query.connectionType || 'websocket';
    
    // RF users should not receive history
    if (connectionType === 'ax25') {
      return res.json({
        success: true,
        messages: [],
        count: 0,
        note: 'History not available for RF connections'
      });
    }
    
    const messages = chatManager.getHistory(roomName, limit, connectionType);
    
    res.json({
      success: true,
      messages,
      count: messages.length
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /api/chat/history/:room/search
 * Search message history for a room
 */
router.get('/history/:room/search', (req, res) => {
  try {
    const roomName = req.params.room.toUpperCase();
    const query = req.query.q || '';
    const callsign = req.query.callsign;
    const before = req.query.before ? new Date(req.query.before) : undefined;
    const after = req.query.after ? new Date(req.query.after) : undefined;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Search query (q) is required'
      });
    }
    
    // Only available if history manager exists
    if (!chatManager.historyManager) {
      return res.status(503).json({
        success: false,
        error: 'Chat history not available'
      });
    }
    
    const messages = chatManager.historyManager.searchMessages(query, {
      roomName,
      callsign,
      before,
      after
    });
    
    res.json({
      success: true,
      messages,
      count: messages.length,
      query
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /api/chat/history/:room/export
 * Export message history for a room
 */
router.get('/history/:room/export', (req, res) => {
  try {
    const roomName = req.params.room.toUpperCase();
    const format = req.query.format || 'json';
    
    if (!['json', 'csv'].includes(format)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid format. Use json or csv'
      });
    }
    
    // Only available if history manager exists
    if (!chatManager.historyManager) {
      return res.status(503).json({
        success: false,
        error: 'Chat history not available'
      });
    }
    
    const data = chatManager.historyManager.exportMessages(roomName, format);
    
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${roomName}_messages.csv"`);
      res.send(data);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${roomName}_messages.json"`);
      res.send(data);
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * DELETE /api/chat/history/:room
 * Clear message history for a room (moderator/admin only)
 */
router.delete('/history/:room', (req, res) => {
  try {
    const roomName = req.params.room.toUpperCase();
    const callsign = req.body.callsign || req.query.callsign;
    
    if (!callsign) {
      return res.status(400).json({
        success: false,
        error: 'Callsign is required'
      });
    }
    
    // Only available if history manager exists
    if (!chatManager.historyManager) {
      return res.status(503).json({
        success: false,
        error: 'Chat history not available'
      });
    }
    
    // TODO: Check if callsign is moderator/admin
    
    chatManager.historyManager.clearRoom(roomName);
    
    res.json({
      success: true,
      message: `History cleared for room ${roomName}`
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /api/chat/history/stats
 * Get chat history statistics
 */
router.get('/history/stats', (req, res) => {
  try {
    // Only available if history manager exists
    if (!chatManager.historyManager) {
      return res.status(503).json({
        success: false,
        error: 'Chat history not available'
      });
    }
    
    const stats = chatManager.historyManager.getStats();
    
    res.json({
      success: true,
      stats
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /api/chat/settings
 * Get chat settings
 */
router.get('/settings', async (req, res) => {
  try {
    const settingsPath = path.join(__dirname, '../data/chatSettings.json');
    let settings = {};
    
    try {
      const data = await fs.readFile(settingsPath, 'utf8');
      settings = JSON.parse(data);
    } catch (err) {
      // Use defaults if file doesn't exist
      settings = {
        defaultRoom: 'LOBBY',
        maxUsersPerRoom: 50,
        maxMessageHistory: 100,
        messageRateLimit: 10,
        typingIndicators: true,
        notificationSounds: true,
        showJoinLeave: true,
        messageRetentionDays: 7
      };
    }
    
    res.json({
      success: true,
      settings
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/chat/settings
 * Update chat settings
 */
router.post('/settings', async (req, res) => {
  try {
    const settings = req.body;
    const settingsPath = path.join(__dirname, '../data/chatSettings.json');
    
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
    
    // Update chat manager settings
    if (chatManager) {
      chatManager.updateSettings(settings);
    }
    
    res.json({
      success: true,
      settings
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = createChatRoutes;
