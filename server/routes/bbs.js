const express = require('express');
const router = express.Router();

// BBS routes
module.exports = (dependencies) => {
  const { bbs, manager, bbsSettings, updateBBSSettings, aprsMessageHandler } = dependencies;

  // Enhanced BBS endpoints
  router.post('/messages', (req, res) => {
    try {
      const { sender, recipient, content, subject, category, priority, tags, replyTo } = req.body;
      console.log('POST /api/bbs/messages:', { sender, recipient, subject, category, priority });
      
      const options = {
        subject: subject || '',
        category: category || 'P',
        priority: priority || 'N',
        tags: tags || [],
        replyTo: replyTo || null
      };
      
      const message = bbs.addMessage(sender, recipient, content, options);
      res.status(201).json(message);
    } catch (error) {
      console.error('Error in POST /api/bbs/messages:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  router.get('/messages', (req, res) => {
    try {
      const { 
        recipient, 
        sender, 
        category, 
        priority, 
        tags, 
        unreadOnly, 
        messageNumber 
      } = req.query;
      
      console.log('GET /api/bbs/messages:', req.query);
      
      const filter = {
        recipient,
        sender,
        category,
        priority,
        messageNumber,
        unreadOnly: unreadOnly === 'true',
        tags: tags ? tags.split(',') : undefined,
      };
      
      const messages = bbs.getMessages(filter);
      res.json(messages);
    } catch (error) {
      console.error('Error in GET /api/bbs/messages:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  router.put('/messages/:messageNumber/read', (req, res) => {
    try {
      const { messageNumber } = req.params;
      const { reader } = req.body;
      
      const success = bbs.markAsRead(messageNumber, reader);
      if (success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Message not found' });
      }
    } catch (error) {
      console.error('Error marking message as read:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  router.get('/stats', (req, res) => {
    try {
      const stats = bbs.getStats();
      res.json(stats);
    } catch (error) {
      console.error('Error getting BBS stats:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  router.get('/bulletins', (req, res) => {
    try {
      const bulletins = bbs.getBulletins();
      res.json(bulletins);
    } catch (error) {
      console.error('Error getting bulletins:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  router.delete('/messages/:messageNumber', (req, res) => {
    try {
      const { messageNumber } = req.params;
      const success = bbs.deleteMessage(messageNumber);
      if (success) {
        res.status(204).send();
      } else {
        res.status(404).json({ error: 'Message not found' });
      }
    } catch (error) {
      console.error('Error deleting message:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  router.get('/settings', (req, res) => {
    res.json(bbsSettings);
  });

  router.post('/settings', (req, res) => {
    const { enabled, callsign, channels } = req.body;
    updateBBSSettings({ 
      enabled, 
      callsign: callsign ? callsign.toUpperCase() : '',
      channels: channels || []
    });
    console.log('Updated BBS settings:', bbsSettings);
    res.status(200).send();
  });

  return router;
};