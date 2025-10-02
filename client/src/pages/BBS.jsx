import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Tabs,
  Tab,
  Badge,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import axios from 'axios';

export default function BBS() {
  const [messages, setMessages] = useState([]);
  const [stats, setStats] = useState({});
  const [tab, setTab] = useState(0);
  const [filter, setFilter] = useState({ category: '', priority: '', unreadOnly: false });
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [replyDialog, setReplyDialog] = useState(false);
  const [newMessage, setNewMessage] = useState({
    sender: '',
    recipient: '',
    subject: '',
    content: '',
    category: 'P',
    priority: 'N',
    tags: '',
    replyTo: null
  });

  const backend = `http://${location.hostname}:3000`;

  const messageCategories = {
    'P': 'Personal',
    'B': 'Bulletin',
    'T': 'Traffic',
    'E': 'Emergency',
    'A': 'Administrative'
  };

  const priorityLevels = {
    'H': 'High',
    'N': 'Normal',
    'L': 'Low'
  };

  useEffect(() => {
    fetchMessages();
    fetchStats();
  }, [filter]);

  const fetchMessages = async () => {
    try {
      const params = new URLSearchParams();
      if (filter.category) params.append('category', filter.category);
      if (filter.priority) params.append('priority', filter.priority);
      if (filter.unreadOnly) params.append('unreadOnly', 'true');
      
      const response = await axios.get(`${backend}/api/bbs/messages?${params}`);
      setMessages(response.data);
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await axios.get(`${backend}/api/bbs/stats`);
      setStats(response.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const handleSendMessage = async () => {
    try {
      const tagsArray = newMessage.tags.split(',').map((tag) => tag.trim()).filter(t => t);
      const response = await axios.post(`${backend}/api/bbs/messages`, {
        ...newMessage,
        tags: tagsArray,
      });
      setMessages((prev) => [response.data, ...prev]);
      setNewMessage({
        sender: '',
        recipient: '',
        subject: '',
        content: '',
        category: 'P',
        priority: 'N',
        tags: '',
        replyTo: null
      });
      setReplyDialog(false);
      fetchStats();
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  const handleDeleteMessage = async (messageNumber) => {
    try {
      await axios.delete(`${backend}/api/bbs/messages/${messageNumber}`);
      setMessages((prev) => prev.filter((msg) => msg.messageNumber !== messageNumber));
      fetchStats();
    } catch (error) {
      console.error('Error deleting message:', error);
    }
  };

  const handleMarkAsRead = async (messageNumber, reader = 'SYSOP') => {
    try {
      await axios.put(`${backend}/api/bbs/messages/${messageNumber}/read`, { reader });
      setMessages(prev => prev.map(msg => 
        msg.messageNumber === messageNumber ? { ...msg, read: true } : msg
      ));
      fetchStats();
    } catch (error) {
      console.error('Error marking message as read:', error);
    }
  };

  const handleReply = (message) => {
    setNewMessage({
      sender: '',
      recipient: message.sender,
      subject: message.subject.startsWith('Re: ') ? message.subject : `Re: ${message.subject}`,
      content: '',
      category: 'P',
      priority: 'N',
      tags: '',
      replyTo: message.messageNumber
    });
    setReplyDialog(true);
  };

  const getFilteredMessages = () => {
    switch (tab) {
      case 0: return messages.filter(m => m.category === 'P'); // Personal
      case 1: return messages.filter(m => m.category === 'B'); // Bulletins
      case 2: return messages.filter(m => m.category === 'T'); // Traffic
      case 3: return messages.filter(m => m.category === 'E'); // Emergency
      default: return messages;
    }
  };

  return (
    <Box sx={{ padding: '2rem' }}>
      <Typography variant="h4" gutterBottom>
        BBS Messages
      </Typography>

      {/* Stats */}
      <Box sx={{ display: 'flex', gap: 2, marginBottom: 2 }}>
        <Chip label={`Total: ${stats.total || 0}`} />
        <Chip label={`Unread: ${stats.unread || 0}`} color="primary" />
        <Chip label={`High Priority: ${stats.highPriority || 0}`} color="error" />
        <Chip label={`Personal: ${stats.personal || 0}`} />
        <Chip label={`Bulletins: ${stats.bulletins || 0}`} />
      </Box>

      {/* Message Tabs */}
      <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ marginBottom: 2 }}>
        <Tab label={<Badge badgeContent={stats.personal} color="primary">Personal</Badge>} />
        <Tab label={<Badge badgeContent={stats.bulletins} color="primary">Bulletins</Badge>} />
        <Tab label={<Badge badgeContent={stats.traffic} color="primary">Traffic</Badge>} />
        <Tab label={<Badge badgeContent={stats.emergency} color="error">Emergency</Badge>} />
      </Tabs>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 2, marginBottom: 2 }}>
        <FormControl size="small">
          <InputLabel>Category</InputLabel>
          <Select
            value={filter.category}
            label="Category"
            onChange={(e) => setFilter({...filter, category: e.target.value})}
          >
            <MenuItem value="">All</MenuItem>
            {Object.entries(messageCategories).map(([key, value]) => (
              <MenuItem key={key} value={key}>{value}</MenuItem>
            ))}
          </Select>
        </FormControl>
        
        <FormControl size="small">
          <InputLabel>Priority</InputLabel>
          <Select
            value={filter.priority}
            label="Priority"
            onChange={(e) => setFilter({...filter, priority: e.target.value})}
          >
            <MenuItem value="">All</MenuItem>
            {Object.entries(priorityLevels).map(([key, value]) => (
              <MenuItem key={key} value={key}>{value}</MenuItem>
            ))}
          </Select>
        </FormControl>
        
        <Button 
          variant={filter.unreadOnly ? "contained" : "outlined"}
          onClick={() => setFilter({...filter, unreadOnly: !filter.unreadOnly})}
        >
          Unread Only
        </Button>
        
        <Button variant="contained" onClick={() => setReplyDialog(true)}>
          Compose Message
        </Button>
      </Box>

      {/* Messages Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>#</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Priority</TableCell>
              <TableCell>From</TableCell>
              <TableCell>To</TableCell>
              <TableCell>Subject</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Size</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {getFilteredMessages().map((msg) => (
              <TableRow 
                key={msg.messageNumber} 
                sx={{ 
                  backgroundColor: !msg.read ? '#f3f4f6' : 'inherit',
                  fontWeight: !msg.read ? 'bold' : 'normal'
                }}
              >
                <TableCell>{msg.messageNumber}</TableCell>
                <TableCell>
                  <Chip 
                    label={messageCategories[msg.category]} 
                    size="small"
                    color={msg.category === 'E' ? 'error' : msg.category === 'B' ? 'primary' : 'default'}
                  />
                </TableCell>
                <TableCell>
                  <Chip 
                    label={priorityLevels[msg.priority]} 
                    size="small"
                    color={msg.priority === 'H' ? 'error' : 'default'}
                  />
                </TableCell>
                <TableCell>{msg.sender}</TableCell>
                <TableCell>{msg.recipient}</TableCell>
                <TableCell>{msg.subject || '(no subject)'}</TableCell>
                <TableCell>{new Date(msg.timestamp).toLocaleDateString()}</TableCell>
                <TableCell>{msg.size} bytes</TableCell>
                <TableCell>{msg.read ? 'Read' : 'Unread'}</TableCell>
                <TableCell>
                  <Button size="small" onClick={() => setSelectedMessage(msg)}>
                    View
                  </Button>
                  <Button size="small" onClick={() => handleReply(msg)}>
                    Reply
                  </Button>
                  <Button size="small" color="error" onClick={() => handleDeleteMessage(msg.messageNumber)}>
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Message View Dialog */}
      <Dialog open={!!selectedMessage} onClose={() => setSelectedMessage(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          Message #{selectedMessage?.messageNumber} - {selectedMessage?.subject || '(no subject)'}
        </DialogTitle>
        <DialogContent>
          {selectedMessage && (
            <Box>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                From: {selectedMessage.sender} | To: {selectedMessage.recipient} | 
                Date: {new Date(selectedMessage.timestamp).toLocaleString()} |
                Category: {messageCategories[selectedMessage.category]} |
                Priority: {priorityLevels[selectedMessage.priority]}
              </Typography>
              <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', marginTop: 2 }}>
                {selectedMessage.content}
              </Typography>
              {selectedMessage.tags.length > 0 && (
                <Box sx={{ marginTop: 2 }}>
                  <Typography variant="body2">Tags: </Typography>
                  {selectedMessage.tags.map(tag => (
                    <Chip key={tag} label={tag} size="small" sx={{ marginRight: 1 }} />
                  ))}
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedMessage(null)}>Close</Button>
          {selectedMessage && !selectedMessage.read && (
            <Button onClick={() => {
              handleMarkAsRead(selectedMessage.messageNumber);
              setSelectedMessage(null);
            }}>
              Mark as Read
            </Button>
          )}
          {selectedMessage && (
            <Button onClick={() => {
              handleReply(selectedMessage);
              setSelectedMessage(null);
            }}>
              Reply
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Compose/Reply Dialog */}
      <Dialog open={replyDialog} onClose={() => setReplyDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>{newMessage.replyTo ? 'Reply to Message' : 'Compose New Message'}</DialogTitle>
        <DialogContent>
          <TextField
            label="From (Your Callsign)"
            value={newMessage.sender}
            onChange={(e) => setNewMessage({ ...newMessage, sender: e.target.value.toUpperCase() })}
            fullWidth
            margin="normal"
            required
          />
          <TextField
            label="To (Recipient Callsign)"
            value={newMessage.recipient}
            onChange={(e) => setNewMessage({ ...newMessage, recipient: e.target.value.toUpperCase() })}
            fullWidth
            margin="normal"
            required
          />
          <TextField
            label="Subject"
            value={newMessage.subject}
            onChange={(e) => setNewMessage({ ...newMessage, subject: e.target.value })}
            fullWidth
            margin="normal"
          />
          <Box sx={{ display: 'flex', gap: 2, marginTop: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Category</InputLabel>
              <Select
                value={newMessage.category}
                label="Category"
                onChange={(e) => setNewMessage({...newMessage, category: e.target.value})}
              >
                {Object.entries(messageCategories).map(([key, value]) => (
                  <MenuItem key={key} value={key}>{value}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Priority</InputLabel>
              <Select
                value={newMessage.priority}
                label="Priority"
                onChange={(e) => setNewMessage({...newMessage, priority: e.target.value})}
              >
                {Object.entries(priorityLevels).map(([key, value]) => (
                  <MenuItem key={key} value={key}>{value}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
          <TextField
            label="Message Content"
            value={newMessage.content}
            onChange={(e) => setNewMessage({ ...newMessage, content: e.target.value })}
            fullWidth
            multiline
            rows={6}
            margin="normal"
            required
          />
          <TextField
            label="Tags (comma-separated)"
            value={newMessage.tags}
            onChange={(e) => setNewMessage({ ...newMessage, tags: e.target.value })}
            fullWidth
            margin="normal"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReplyDialog(false)}>Cancel</Button>
          <Button 
            onClick={handleSendMessage}
            variant="contained"
            disabled={!newMessage.sender || !newMessage.recipient || !newMessage.content}
          >
            Send Message
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}