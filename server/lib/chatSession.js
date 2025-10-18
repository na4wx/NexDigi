/**
 * chatSession.js
 * 
 * Per-user chat session handling commands, messaging, and state
 */

const EventEmitter = require('events');

class ChatSession extends EventEmitter {
  constructor(callsign, chatManager, options = {}) {
    super();
    
    this.callsign = callsign;
    this.chatManager = chatManager;
    this.commandPrefix = options.commandPrefix || '/';
    
    // Session state
    this.joinedAt = Date.now();
    this.lastActivity = Date.now();
    this.status = 'online'; // online, away, typing
    this.typingTimeout = null;
    this.messageTimestamps = [];
    
    // Connection info
    this.channelId = options.channelId || null;
    this.connectionType = options.connectionType || 'websocket'; // websocket, ax25, tcp
    
    // Register with chat manager
    this.chatManager.registerSession(this);
    
    // Auto-join default room if enabled
    if (options.autoJoin !== false) {
      const defaultRoom = this.chatManager.settings.defaultRoom;
      try {
        this.chatManager.joinRoom(this.callsign, defaultRoom);
        this.sendToUser(`Welcome to ${defaultRoom}!`);
        this.sendToUser(`Type ${this.commandPrefix}help for available commands`);
      } catch (err) {
        this.sendToUser(`Error joining default room: ${err.message}`);
      }
    }
    
    console.log(`ChatSession created for ${callsign} via ${this.connectionType}`);
  }
  
  /**
   * Handle incoming message (either command or chat message)
   */
  handleMessage(text) {
    this.lastActivity = Date.now();
    this.clearTyping();
    
    // Check if it's a command
    if (text.startsWith(this.commandPrefix)) {
      const parts = text.slice(1).trim().split(/\s+/);
      const command = parts[0].toLowerCase();
      const args = parts.slice(1);
      
      return this.handleCommand(command, args);
    }
    
    // Regular message - send to current room
    const roomName = this.chatManager.getUserRoom(this.callsign);
    if (!roomName) {
      this.sendToUser('You are not in a room. Use /join <room> to join one.');
      return;
    }
    
    try {
      this.chatManager.sendMessage(this.callsign, roomName, text);
    } catch (err) {
      this.sendToUser(`Error: ${err.message}`);
    }
  }
  
  /**
   * Handle a chat command
   */
  handleCommand(command, args) {
    try {
      switch (command) {
        case 'help':
        case 'h':
        case '?':
          this.cmdHelp();
          break;
          
        case 'join':
        case 'j':
          this.cmdJoin(args);
          break;
          
        case 'leave':
        case 'part':
        case 'l':
          this.cmdLeave();
          break;
          
        case 'create':
        case 'new':
          this.cmdCreate(args);
          break;
          
        case 'delete':
        case 'del':
          this.cmdDelete(args);
          break;
          
        case 'list':
        case 'rooms':
          this.cmdList();
          break;
          
        case 'users':
        case 'who':
        case 'names':
          this.cmdUsers();
          break;
          
        case 'msg':
        case 'tell':
        case 'whisper':
          this.cmdPrivateMessage(args);
          break;
          
        case 'me':
        case 'action':
          this.cmdAction(args);
          break;
          
        case 'topic':
          this.cmdTopic(args);
          break;
          
        case 'kick':
          this.cmdKick(args);
          break;
          
        case 'ban':
          this.cmdBan(args);
          break;
          
        case 'unban':
          this.cmdUnban(args);
          break;
          
        case 'mute':
          this.cmdMute(args);
          break;
          
        case 'unmute':
          this.cmdUnmute(args);
          break;
          
        case 'mod':
        case 'moderator':
          this.cmdModerator(args);
          break;
          
        case 'info':
          this.cmdInfo(args);
          break;
          
        case 'history':
        case 'hist':
          this.cmdHistory(args);
          break;
          
        case 'away':
          this.cmdAway(args);
          break;
          
        case 'back':
          this.cmdBack();
          break;
          
        case 'quit':
        case 'exit':
        case 'bye':
          this.cmdQuit();
          break;
          
        default:
          this.sendToUser(`Unknown command: ${command}. Type ${this.commandPrefix}help for available commands.`);
      }
    } catch (err) {
      this.sendToUser(`Error: ${err.message}`);
    }
  }
  
  /**
   * Command: help - Show available commands
   */
  cmdHelp() {
    const help = [
      '=== Chat Commands ===',
      '',
      'Room Management:',
      `  ${this.commandPrefix}join <room> [password] - Join a room`,
      `  ${this.commandPrefix}leave - Leave current room`,
      `  ${this.commandPrefix}create <room> [password] - Create a new room`,
      `  ${this.commandPrefix}delete <room> - Delete a room (creator/mod only)`,
      `  ${this.commandPrefix}list - List all rooms`,
      '',
      'Communication:',
      `  ${this.commandPrefix}msg <callsign> <text> - Send private message`,
      `  ${this.commandPrefix}me <action> - Send action message`,
      `  ${this.commandPrefix}users - List users in current room`,
      '',
      'Room Control (Moderators):',
      `  ${this.commandPrefix}topic <text> - Set room topic`,
      `  ${this.commandPrefix}kick <callsign> - Kick user from room`,
      `  ${this.commandPrefix}ban <callsign> - Ban user from room`,
      `  ${this.commandPrefix}unban <callsign> - Unban user`,
      `  ${this.commandPrefix}mute <callsign> - Mute user`,
      `  ${this.commandPrefix}unmute <callsign> - Unmute user`,
      `  ${this.commandPrefix}mod <callsign> - Make user a moderator`,
      '',
      'Information:',
      `  ${this.commandPrefix}info [room] - Show room information`,
      `  ${this.commandPrefix}history [count] - Show message history`,
      '',
      'Status:',
      `  ${this.commandPrefix}away [message] - Set status to away`,
      `  ${this.commandPrefix}back - Set status to online`,
      '',
      'Other:',
      `  ${this.commandPrefix}quit - Exit chat`,
      `  ${this.commandPrefix}help - Show this help`
    ];
    
    help.forEach(line => this.sendToUser(line));
  }
  
  /**
   * Command: join - Join a room
   */
  cmdJoin(args) {
    if (args.length === 0) {
      this.sendToUser('Usage: /join <room> [password]');
      return;
    }
    
    const roomName = args[0].toUpperCase();
    const password = args[1] || null;
    
    try {
      const room = this.chatManager.joinRoom(this.callsign, roomName, password);
      this.sendToUser(`Joined room: ${roomName}`);
      
      // Show topic if set
      if (room.topic) {
        this.sendToUser(`Topic: ${room.topic}`);
      }
      
      // Show user count
      this.sendToUser(`Users in room: ${room.users.size}`);
      
      // Show recent history
      const history = this.chatManager.getRoomHistory(roomName, 10);
      if (history.length > 0) {
        this.sendToUser('--- Recent messages ---');
        history.forEach(msg => {
          if (msg.type === 'message') {
            this.sendToUser(`[${new Date(msg.timestamp).toLocaleTimeString()}] ${msg.from}: ${msg.text}`);
          } else if (msg.type === 'system') {
            this.sendToUser(`*** ${msg.text}`);
          }
        });
      }
    } catch (err) {
      this.sendToUser(`Error: ${err.message}`);
    }
  }
  
  /**
   * Command: leave - Leave current room
   */
  cmdLeave() {
    const roomName = this.chatManager.getUserRoom(this.callsign);
    if (!roomName) {
      this.sendToUser('You are not in a room.');
      return;
    }
    
    this.chatManager.leaveRoom(this.callsign, roomName);
    this.sendToUser(`Left room: ${roomName}`);
  }
  
  /**
   * Command: create - Create a new room
   */
  cmdCreate(args) {
    if (args.length === 0) {
      this.sendToUser('Usage: /create <room> [password]');
      return;
    }
    
    const roomName = args[0].toUpperCase();
    const password = args[1] || null;
    
    try {
      this.chatManager.createRoom(roomName, {
        creator: this.callsign,
        password,
        moderators: [this.callsign]
      });
      this.sendToUser(`Created room: ${roomName}`);
      
      // Auto-join the new room
      this.chatManager.joinRoom(this.callsign, roomName, password);
      this.sendToUser(`Joined ${roomName}`);
    } catch (err) {
      this.sendToUser(`Error: ${err.message}`);
    }
  }
  
  /**
   * Command: delete - Delete a room
   */
  cmdDelete(args) {
    if (args.length === 0) {
      this.sendToUser('Usage: /delete <room>');
      return;
    }
    
    const roomName = args[0].toUpperCase();
    
    try {
      this.chatManager.deleteRoom(roomName, this.callsign);
      this.sendToUser(`Deleted room: ${roomName}`);
    } catch (err) {
      this.sendToUser(`Error: ${err.message}`);
    }
  }
  
  /**
   * Command: list - List all rooms
   */
  cmdList() {
    const rooms = this.chatManager.listRooms();
    
    if (rooms.length === 0) {
      this.sendToUser('No rooms available.');
      return;
    }
    
    this.sendToUser('=== Available Rooms ===');
    rooms.forEach(room => {
      const lock = room.hasPassword ? '🔒' : '';
      const persistent = room.persistent ? '📌' : '';
      this.sendToUser(`${lock}${persistent} ${room.name} (${room.userCount}/${room.maxUsers}) - ${room.description || 'No description'}`);
    });
  }
  
  /**
   * Command: users - List users in current room
   */
  cmdUsers() {
    const roomName = this.chatManager.getUserRoom(this.callsign);
    if (!roomName) {
      this.sendToUser('You are not in a room.');
      return;
    }
    
    try {
      const users = this.chatManager.getUsersInRoom(roomName);
      this.sendToUser(`=== Users in ${roomName} ===`);
      
      users.forEach(user => {
        const badges = [];
        if (user.isCreator) badges.push('👑');
        if (user.isModerator) badges.push('⭐');
        if (user.isMuted) badges.push('🔇');
        
        const statusIcon = user.status === 'away' ? '🟡' : '🟢';
        this.sendToUser(`${statusIcon} ${user.callsign} ${badges.join(' ')}`);
      });
      
      this.sendToUser(`Total: ${users.length} users`);
    } catch (err) {
      this.sendToUser(`Error: ${err.message}`);
    }
  }
  
  /**
   * Command: msg - Send private message
   */
  cmdPrivateMessage(args) {
    if (args.length < 2) {
      this.sendToUser('Usage: /msg <callsign> <message>');
      return;
    }
    
    const toCallsign = args[0].toUpperCase();
    const text = args.slice(1).join(' ');
    
    try {
      this.chatManager.sendPrivateMessage(this.callsign, toCallsign, text);
      this.sendToUser(`[Private to ${toCallsign}] ${text}`);
    } catch (err) {
      this.sendToUser(`Error: ${err.message}`);
    }
  }
  
  /**
   * Command: me - Send action message
   */
  cmdAction(args) {
    if (args.length === 0) {
      this.sendToUser('Usage: /me <action>');
      return;
    }
    
    const roomName = this.chatManager.getUserRoom(this.callsign);
    if (!roomName) {
      this.sendToUser('You are not in a room.');
      return;
    }
    
    const action = args.join(' ');
    const text = `* ${this.callsign} ${action}`;
    
    try {
      this.chatManager.sendMessage(this.callsign, roomName, text);
    } catch (err) {
      this.sendToUser(`Error: ${err.message}`);
    }
  }
  
  /**
   * Command: topic - Set room topic
   */
  cmdTopic(args) {
    const roomName = this.chatManager.getUserRoom(this.callsign);
    if (!roomName) {
      this.sendToUser('You are not in a room.');
      return;
    }
    
    if (args.length === 0) {
      try {
        const room = this.chatManager.getRoomInfo(roomName);
        this.sendToUser(room.topic ? `Topic: ${room.topic}` : 'No topic set.');
      } catch (err) {
        this.sendToUser(`Error: ${err.message}`);
      }
      return;
    }
    
    const topic = args.join(' ');
    
    try {
      this.chatManager.setTopic(roomName, topic, this.callsign);
      this.sendToUser(`Topic set to: ${topic}`);
    } catch (err) {
      this.sendToUser(`Error: ${err.message}`);
    }
  }
  
  /**
   * Command: kick - Kick user from room
   */
  cmdKick(args) {
    if (args.length === 0) {
      this.sendToUser('Usage: /kick <callsign>');
      return;
    }
    
    const roomName = this.chatManager.getUserRoom(this.callsign);
    if (!roomName) {
      this.sendToUser('You are not in a room.');
      return;
    }
    
    const callsign = args[0].toUpperCase();
    
    try {
      this.chatManager.leaveRoom(callsign, roomName);
      this.sendToUser(`Kicked ${callsign} from ${roomName}`);
    } catch (err) {
      this.sendToUser(`Error: ${err.message}`);
    }
  }
  
  /**
   * Command: ban - Ban user from room
   */
  cmdBan(args) {
    if (args.length === 0) {
      this.sendToUser('Usage: /ban <callsign> [reason]');
      return;
    }
    
    const roomName = this.chatManager.getUserRoom(this.callsign);
    if (!roomName) {
      this.sendToUser('You are not in a room.');
      return;
    }
    
    const callsign = args[0].toUpperCase();
    const reason = args.slice(1).join(' ');
    
    try {
      this.chatManager.banUser(roomName, callsign, this.callsign, reason);
      this.sendToUser(`Banned ${callsign} from ${roomName}`);
    } catch (err) {
      this.sendToUser(`Error: ${err.message}`);
    }
  }
  
  /**
   * Command: unban - Unban user from room
   */
  cmdUnban(args) {
    if (args.length === 0) {
      this.sendToUser('Usage: /unban <callsign>');
      return;
    }
    
    const roomName = this.chatManager.getUserRoom(this.callsign);
    if (!roomName) {
      this.sendToUser('You are not in a room.');
      return;
    }
    
    const callsign = args[0].toUpperCase();
    
    try {
      const room = this.chatManager.rooms.get(roomName);
      if (room) {
        room.banned.delete(callsign);
        this.sendToUser(`Unbanned ${callsign} from ${roomName}`);
      }
    } catch (err) {
      this.sendToUser(`Error: ${err.message}`);
    }
  }
  
  /**
   * Command: mute - Mute user in room
   */
  cmdMute(args) {
    if (args.length === 0) {
      this.sendToUser('Usage: /mute <callsign>');
      return;
    }
    
    const roomName = this.chatManager.getUserRoom(this.callsign);
    if (!roomName) {
      this.sendToUser('You are not in a room.');
      return;
    }
    
    const callsign = args[0].toUpperCase();
    
    try {
      this.chatManager.muteUser(roomName, callsign, this.callsign);
      this.sendToUser(`Muted ${callsign} in ${roomName}`);
    } catch (err) {
      this.sendToUser(`Error: ${err.message}`);
    }
  }
  
  /**
   * Command: unmute - Unmute user in room
   */
  cmdUnmute(args) {
    if (args.length === 0) {
      this.sendToUser('Usage: /unmute <callsign>');
      return;
    }
    
    const roomName = this.chatManager.getUserRoom(this.callsign);
    if (!roomName) {
      this.sendToUser('You are not in a room.');
      return;
    }
    
    const callsign = args[0].toUpperCase();
    
    try {
      this.chatManager.unmuteUser(roomName, callsign, this.callsign);
      this.sendToUser(`Unmuted ${callsign} in ${roomName}`);
    } catch (err) {
      this.sendToUser(`Error: ${err.message}`);
    }
  }
  
  /**
   * Command: mod - Add moderator
   */
  cmdModerator(args) {
    if (args.length === 0) {
      this.sendToUser('Usage: /mod <callsign>');
      return;
    }
    
    const roomName = this.chatManager.getUserRoom(this.callsign);
    if (!roomName) {
      this.sendToUser('You are not in a room.');
      return;
    }
    
    const callsign = args[0].toUpperCase();
    
    try {
      this.chatManager.addModerator(roomName, callsign, this.callsign);
      this.sendToUser(`Added ${callsign} as moderator in ${roomName}`);
    } catch (err) {
      this.sendToUser(`Error: ${err.message}`);
    }
  }
  
  /**
   * Command: info - Show room information
   */
  cmdInfo(args) {
    let roomName;
    
    if (args.length > 0) {
      roomName = args[0].toUpperCase();
    } else {
      roomName = this.chatManager.getUserRoom(this.callsign);
      if (!roomName) {
        this.sendToUser('You are not in a room. Usage: /info <room>');
        return;
      }
    }
    
    try {
      const info = this.chatManager.getRoomInfo(roomName);
      const users = this.chatManager.getUsersInRoom(roomName);
      
      this.sendToUser(`=== Room Information: ${roomName} ===`);
      this.sendToUser(`Description: ${info.description || 'None'}`);
      this.sendToUser(`Topic: ${info.topic || 'None'}`);
      this.sendToUser(`Creator: ${info.creator}`);
      this.sendToUser(`Created: ${new Date(info.created).toLocaleString()}`);
      this.sendToUser(`Users: ${info.userCount}/${info.maxUsers}`);
      this.sendToUser(`Protected: ${info.hasPassword ? 'Yes' : 'No'}`);
      this.sendToUser(`Type: ${info.persistent ? 'Persistent' : 'Temporary'}`);
      this.sendToUser(`Moderators: ${info.moderators.join(', ') || 'None'}`);
    } catch (err) {
      this.sendToUser(`Error: ${err.message}`);
    }
  }
  
  /**
   * Command: history - Show message history
   */
  cmdHistory(args) {
    const roomName = this.chatManager.getUserRoom(this.callsign);
    if (!roomName) {
      this.sendToUser('You are not in a room.');
      return;
    }
    
    const count = parseInt(args[0]) || 20;
    
    try {
      const history = this.chatManager.getRoomHistory(roomName, count);
      
      this.sendToUser(`=== Last ${history.length} messages in ${roomName} ===`);
      history.forEach(msg => {
        if (msg.type === 'message') {
          const time = new Date(msg.timestamp).toLocaleTimeString();
          this.sendToUser(`[${time}] ${msg.from}: ${msg.text}`);
        } else if (msg.type === 'system') {
          this.sendToUser(`*** ${msg.text}`);
        }
      });
    } catch (err) {
      this.sendToUser(`Error: ${err.message}`);
    }
  }
  
  /**
   * Command: away - Set away status
   */
  cmdAway(args) {
    this.status = 'away';
    const message = args.length > 0 ? args.join(' ') : 'Away';
    this.sendToUser(`Status set to away: ${message}`);
  }
  
  /**
   * Command: back - Set back to online
   */
  cmdBack() {
    this.status = 'online';
    this.sendToUser('Status set to online');
  }
  
  /**
   * Command: quit - Exit chat
   */
  cmdQuit() {
    this.sendToUser('Goodbye!');
    this.disconnect();
  }
  
  /**
   * Set typing indicator
   */
  setTyping() {
    if (this.status === 'online') {
      this.status = 'typing';
    }
    
    // Clear existing timeout
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }
    
    // Set timeout to clear typing status
    this.typingTimeout = setTimeout(() => {
      this.clearTyping();
    }, 5000);
    
    this.emit('typing', { callsign: this.callsign, typing: true });
  }
  
  /**
   * Clear typing indicator
   */
  clearTyping() {
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
      this.typingTimeout = null;
    }
    
    if (this.status === 'typing') {
      this.status = 'online';
      this.emit('typing', { callsign: this.callsign, typing: false });
    }
  }
  
  /**
   * Send a message to this user
   */
  sendToUser(text) {
    this.emit('message', { text });
  }
  
  /**
   * Disconnect and cleanup
   */
  disconnect() {
    this.clearTyping();
    this.chatManager.unregisterSession(this.callsign);
    this.emit('disconnect');
  }
}

module.exports = ChatSession;
