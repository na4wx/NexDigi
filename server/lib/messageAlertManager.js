const { EventEmitter } = require('events');

/**
 * Manages store-and-forward message alerts for APRS users
 * - Sends immediate alerts when messages are received
 * - Sends periodic reminders when users beacon
 * - Tracks alert history to prevent spam
 */
class MessageAlertManager extends EventEmitter {
  constructor(bbs, channelManager, settings = {}) {
    super();
    this.bbs = bbs;
    this.channelManager = channelManager;
    this.settings = {
      enabled: true,
      alertCallsign: 'MSG-SYS',
      reminderIntervalHours: 4,
      maxReminders: 10,
      ...settings
    };
    
    // Track when users were last alerted
    this.lastAlerts = new Map(); // callsign -> { timestamp, count }
    this.userBeacons = new Map(); // callsign -> last beacon timestamp
    
    // Listen for incoming frames to detect user beacons
    this.channelManager.on('frame', this.handleIncomingFrame.bind(this));
    
    console.log('MessageAlertManager initialized');
  }

  updateSettings(settings) {
    this.settings = { ...this.settings, ...settings };
    console.log('MessageAlertManager settings updated:', this.settings);
  }

  isEnabled() {
    return this.settings.enabled && this.settings.alertCallsign;
  }

  /**
   * Alert user immediately when they receive a new message
   */
  alertNewMessage(recipient, sender, channel) {
    if (!this.isEnabled()) return;

    const alertText = `New message from ${sender}! Send "RM" to ${this.settings.alertCallsign} to retrieve messages.`;
    
    console.log(`MessageAlert: Sending immediate alert to ${recipient} about message from ${sender}`);
    
    this.sendAlert(recipient, alertText, channel);
    
    // Track this alert
    this.lastAlerts.set(recipient.toUpperCase(), {
      timestamp: Date.now(),
      count: 1,
      reason: 'new_message'
    });
  }

  /**
   * Handle incoming frames to detect user beacons and send reminders
   */
  handleIncomingFrame(event) {
    if (!this.isEnabled()) return;

    try {
      const { parseAx25Frame } = require('./ax25');
      const parsed = event.parsed || parseAx25Frame(Buffer.from(event.raw, 'hex'));
      
      if (!parsed || !parsed.addresses || parsed.addresses.length < 2) return;
      
      const sender = this.formatCallsign(parsed.addresses[1]);
      if (!sender) return;
      
      // Update user beacon timestamp
      this.userBeacons.set(sender.toUpperCase(), Date.now());
      
      // Check if this user has unread messages and needs reminders
      this.checkForReminders(sender, event.channel);
      
    } catch (error) {
      // Silently ignore frame parsing errors for alert system
    }
  }

  /**
   * Check if user needs reminder about unread messages
   */
  checkForReminders(callsign, channel) {
    const unreadMessages = this.getUnreadMessagesForUser(callsign);
    if (unreadMessages.length === 0) return;

    const now = Date.now();
    const reminderIntervalMs = this.settings.reminderIntervalHours * 60 * 60 * 1000;
    
    const lastAlert = this.lastAlerts.get(callsign.toUpperCase());
    
    // Check if enough time has passed since last alert
    if (lastAlert && (now - lastAlert.timestamp) < reminderIntervalMs) {
      return; // Too soon for reminder
    }
    
    // Check if we've exceeded max reminders
    if (lastAlert && lastAlert.count >= this.settings.maxReminders) {
      return; // Stop sending reminders
    }
    
    const count = unreadMessages.length;
    const plural = count === 1 ? '' : 's';
    const alertText = `You have ${count} unread message${plural}! Send "RM" to ${this.settings.alertCallsign} to retrieve.`;
    
    console.log(`MessageAlert: Sending reminder to ${callsign} (${count} unread messages)`);
    
    this.sendAlert(callsign, alertText, channel);
    
    // Update alert tracking
    this.lastAlerts.set(callsign.toUpperCase(), {
      timestamp: now,
      count: (lastAlert ? lastAlert.count : 0) + 1,
      reason: 'reminder'
    });
  }

  /**
   * Get unread messages for a specific user
   */
  getUnreadMessagesForUser(callsign) {
    const messages = this.bbs.getPersonalMessages(callsign);
    return messages.filter(msg => !msg.read);
  }

  /**
   * Mark user as having retrieved messages (stop alerts)
   */
  markMessagesRetrieved(callsign) {
    // Set a suppression timestamp to prevent immediate reminders
    this.lastAlerts.set(callsign.toUpperCase(), {
      timestamp: Date.now(),
      count: 0,
      reason: 'retrieved'
    });
    console.log(`MessageAlert: Messages retrieved by ${callsign} - suppressing reminders`);
  }

  /**
   * Send APRS alert message to user
   */
  sendAlert(recipient, content, channel) {
    try {
      // Send via channel manager as APRS message
      this.channelManager.sendAPRSMessage({
        from: this.settings.alertCallsign,
        to: recipient,
        payload: `:${recipient.padEnd(9, ' ')}:${content}`,
        channel: channel
      });
      
      this.emit('alertSent', {
        recipient,
        content,
        channel,
        timestamp: new Date()
      });
      
    } catch (error) {
      console.error('MessageAlert: Error sending alert:', error);
    }
  }

  /**
   * Format callsign from address object
   */
  formatCallsign(address) {
    if (!address) return '';
    const call = address.callsign || '';
    const ssid = address.ssid || 0;
    return ssid > 0 ? `${call}-${ssid}` : call;
  }

  /**
   * Get alert statistics for monitoring
   */
  getAlertStats() {
    const stats = {
      totalTrackedUsers: this.lastAlerts.size,
      totalActiveBeacons: this.userBeacons.size,
      alertHistory: []
    };
    
    for (const [callsign, alert] of this.lastAlerts.entries()) {
      stats.alertHistory.push({
        callsign,
        lastAlert: new Date(alert.timestamp),
        alertCount: alert.count,
        reason: alert.reason
      });
    }
    
    return stats;
  }

  /**
   * Clear old tracking data (housekeeping)
   */
  cleanup() {
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    
    // Clean up old alerts
    for (const [callsign, alert] of this.lastAlerts.entries()) {
      if (now - alert.timestamp > maxAge) {
        this.lastAlerts.delete(callsign);
      }
    }
    
    // Clean up old beacon timestamps
    for (const [callsign, timestamp] of this.userBeacons.entries()) {
      if (now - timestamp > maxAge) {
        this.userBeacons.delete(callsign);
      }
    }
  }
}

module.exports = MessageAlertManager;