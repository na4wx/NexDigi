const fs = require('fs');
const path = require('path');

// Enhanced BBS system following amateur radio standards
class BBS {
  constructor(storagePath) {
    this.storagePath = storagePath || path.join(__dirname, '../data/bbs.json');
    this.messages = [];
    this.messageCounter = 1;

    // Create data directory if it doesn't exist
    const dataDir = path.dirname(this.storagePath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Load existing messages if storage file exists
    if (fs.existsSync(this.storagePath)) {
      const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf-8'));
      this.messages = data.messages || [];
      this.messageCounter = data.messageCounter || this.getNextMessageNumber();
    }

    // Clean up expired messages on startup
    this.cleanupExpiredMessages();
  }

  saveMessages() {
    const data = {
      messageCounter: this.messageCounter,
      messages: this.messages
    };
    fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2));
  }

  getNextMessageNumber() {
    const maxId = this.messages.reduce((max, msg) => {
      const msgNum = parseInt(msg.messageNumber) || 0;
      return msgNum > max ? msgNum : max;
    }, 0);
    return maxId + 1;
  }

  cleanupExpiredMessages() {
    const now = Date.now();
    const initialCount = this.messages.length;
    
    this.messages = this.messages.filter(msg => {
      const expiresAt = msg.expiresAt ? new Date(msg.expiresAt).getTime() : null;
      return !expiresAt || expiresAt > now;
    });

    if (this.messages.length !== initialCount) {
      console.log(`BBS: Cleaned up ${initialCount - this.messages.length} expired messages`);
      this.saveMessages();
    }
  }

  addMessage(sender, recipient, content, options = {}) {
    const {
      subject = '',
      category = 'P', // P=Personal, B=Bulletin, T=Traffic, E=Emergency, A=Administrative  
      priority = 'N', // H=High, N=Normal, L=Low
      tags = [],
      replyTo = null,
      expires = null
    } = options;

    // Calculate expiration date based on message type
    let expiresAt = null;
    if (expires) {
      expiresAt = new Date(expires).toISOString();
    } else {
      const now = new Date();
      switch (category) {
        case 'E': // Emergency - 7 days
          now.setDate(now.getDate() + 7);
          break;
        case 'T': // Traffic - 30 days
          now.setDate(now.getDate() + 30);
          break;
        case 'B': // Bulletin - 60 days
          now.setDate(now.getDate() + 60);
          break;
        case 'A': // Administrative - 90 days
          now.setDate(now.getDate() + 90);
          break;
        case 'P': // Personal - 30 days
        default:
          now.setDate(now.getDate() + 30);
          break;
      }
      expiresAt = now.toISOString();
    }

    const message = {
      messageNumber: this.messageCounter++,
      sender: sender.toUpperCase(),
      recipient: recipient.toUpperCase(),
      subject,
      content,
      category,
      priority,
      tags,
      replyTo,
      timestamp: new Date().toISOString(),
      expiresAt,
      read: false,
      readBy: [],
      size: content.length
    };

    this.messages.push(message);
    this.saveMessages();
    return message;
  }

  getMessages(filter = {}) {
    this.cleanupExpiredMessages(); // Clean up before returning messages
    
    const { 
      recipient, 
      sender,
      category,
      priority,
      tags,
      unreadOnly = false,
      messageNumber
    } = filter;

    return this.messages.filter((msg) => {
      if (messageNumber && msg.messageNumber !== parseInt(messageNumber)) return false;
      if (recipient && msg.recipient !== recipient.toUpperCase()) return false;
      if (sender && msg.sender !== sender.toUpperCase()) return false;
      if (category && msg.category !== category) return false;
      if (priority && msg.priority !== priority) return false;
      if (unreadOnly && msg.read) return false;
      if (tags && tags.length > 0) {
        const matchesTags = tags.every(tag => msg.tags.includes(tag));
        if (!matchesTags) return false;
      }
      return true;
    }).sort((a, b) => b.messageNumber - a.messageNumber); // Newest first
  }

  markAsRead(messageNumber, reader = null) {
    const message = this.messages.find(msg => msg.messageNumber === parseInt(messageNumber));
    if (message) {
      message.read = true;
      if (reader && !message.readBy.includes(reader.toUpperCase())) {
        message.readBy.push(reader.toUpperCase());
      }
      this.saveMessages();
      return true;
    }
    return false;
  }

  deleteMessage(messageNumber) {
    const initialLength = this.messages.length;
    this.messages = this.messages.filter(msg => msg.messageNumber !== parseInt(messageNumber));
    
    if (this.messages.length !== initialLength) {
      this.saveMessages();
      return true;
    }
    return false;
  }

  getBulletins(category = 'B') {
    return this.getMessages({ category });
  }

  getPersonalMessages(recipient) {
    return this.getMessages({ recipient, category: 'P' });
  }

  getTrafficMessages() {
    return this.getMessages({ category: 'T' });
  }

  getStats() {
    const stats = {
      total: this.messages.length,
      personal: 0,
      bulletins: 0,
      traffic: 0,
      emergency: 0,
      administrative: 0,
      unread: 0,
      highPriority: 0
    };

    this.messages.forEach(msg => {
      switch (msg.category) {
        case 'P': stats.personal++; break;
        case 'B': stats.bulletins++; break;
        case 'T': stats.traffic++; break;
        case 'E': stats.emergency++; break;
        case 'A': stats.administrative++; break;
      }
      
      if (!msg.read) stats.unread++;
      if (msg.priority === 'H') stats.highPriority++;
    });

    return stats;
  }
}

module.exports = BBS;