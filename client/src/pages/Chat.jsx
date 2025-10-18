/**
 * Chat.jsx
 * 
 * Real-time keyboard-to-keyboard chat interface with multi-room support
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  IconButton,
  Divider,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tab,
  Tabs,
  Badge,
  Tooltip,
  InputAdornment,
  Menu,
  MenuItem,
  Alert,
  CircularProgress
} from '@mui/material';
import {
  Send as SendIcon,
  Add as AddIcon,
  Settings as SettingsIcon,
  People as PeopleIcon,
  Lock as LockIcon,
  ExitToApp as ExitIcon,
  MoreVert as MoreIcon,
  Info as InfoIcon,
  History as HistoryIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import axios from 'axios';
import { serverManager } from '../utils/serverManager';

// Configure axios base URL for API requests
const api = axios.create({
  baseURL: `http://${window.location.hostname}:3000`
});

// Add interceptor to include authentication header
api.interceptors.request.use(config => {
  const active = serverManager.getActiveServer();
  if (active && active.password) {
    config.headers['X-UI-Password'] = active.password;
  }
  return config;
});

export default function Chat({ setPage }) {
  const [ws, setWs] = useState(null);
  const [connected, setConnected] = useState(false);
  const [rooms, setRooms] = useState([]);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [messages, setMessages] = useState({});
  const [users, setUsers] = useState({});
  const [inputText, setInputText] = useState('');
  const [callsign, setCallsign] = useState('');
  const [isTyping, setIsTyping] = useState({});
  const [createRoomDialog, setCreateRoomDialog] = useState(false);
  const [joinRoomDialog, setJoinRoomDialog] = useState(false);
  const [roomInfoDialog, setRoomInfoDialog] = useState(false);
  const [selectedRoomInfo, setSelectedRoomInfo] = useState(null);
  const [newRoom, setNewRoom] = useState({ name: '', description: '', password: '', maxUsers: 50 });
  const [joinPassword, setJoinPassword] = useState('');
  const [roomToJoin, setRoomToJoin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [roomMenuAnchor, setRoomMenuAnchor] = useState(null);
  const [typingTimeout, setTypingTimeout] = useState(null);
  
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const chatInitializedRef = useRef(false);
  
  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentRoom]);
  
  // Connect to WebSocket
  useEffect(() => {
    connectWebSocket();
    
    // Timeout to stop loading if connection takes too long
    const timeout = setTimeout(() => {
      if (!chatInitializedRef.current) {
        setLoading(false);
        setError('Connection timeout. Please check if the server is running on port 3000.');
        console.error('WebSocket connection timed out after 15 seconds');
      }
    }, 15000); // Increased to 15 seconds
    
    return () => {
      clearTimeout(timeout);
      if (ws) {
        ws.close();
      }
    };
  }, []);
  
  // Load rooms periodically
  useEffect(() => {
    if (connected) {
      loadRooms();
      const interval = setInterval(loadRooms, 10000); // Refresh every 10 seconds
      return () => clearInterval(interval);
    }
  }, [connected]);
  
  // Load users when room changes
  useEffect(() => {
    if (currentRoom) {
      loadUsers(currentRoom);
      const interval = setInterval(() => loadUsers(currentRoom), 5000); // Refresh every 5 seconds
      return () => clearInterval(interval);
    }
  }, [currentRoom]);
  
  const connectWebSocket = () => {
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const port = window.location.port && window.location.port !== '5173' ? window.location.port : '3000';
      
      // Get password from active server
      const active = serverManager.getActiveServer();
      const password = active?.password || '';
      const wsUrl = `${protocol}//${window.location.hostname}:${port}${password ? `?password=${encodeURIComponent(password)}` : ''}`;
      
      const socket = new WebSocket(wsUrl);
      
      socket.onopen = () => {
        setConnected(true);
        setError('');
        
        // Request callsign or use stored one
        const storedCallsign = localStorage.getItem('chatCallsign');
        
        if (storedCallsign) {
          setCallsign(storedCallsign);
          socket.send(JSON.stringify({
            type: 'chat-connect',
            callsign: storedCallsign
          }));
        } else {
          const newCallsign = prompt('Enter your callsign:')?.toUpperCase()?.trim();
          if (newCallsign) {
            setCallsign(newCallsign);
            localStorage.setItem('chatCallsign', newCallsign);
            socket.send(JSON.stringify({
              type: 'chat-connect',
              callsign: newCallsign
            }));
          } else {
            // User cancelled or entered nothing
            setError('Callsign is required to use chat');
            setLoading(false);
            socket.close();
          }
        }
      };
      
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleWebSocketMessage(message);
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
        }
      };
      
      socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        setError('WebSocket connection error. Make sure the server is running on port 3000.');
        setLoading(false);
      };
      
      socket.onclose = () => {
        console.log('WebSocket disconnected');
        setConnected(false);
        setLoading(false);
        
        // Attempt reconnect after 3 seconds
        setTimeout(() => {
          setLoading(true);
          connectWebSocket();
        }, 3000);
      };
      
      setWs(socket);
    } catch (err) {
      console.error('Failed to connect WebSocket:', err);
      setError('Failed to connect to chat server');
      setLoading(false);
    }
  };
  
  const handleWebSocketMessage = (message) => {
    switch (message.type) {
      case 'chat-connected':
        chatInitializedRef.current = true;
        setLoading(false);
        setError('');
        if (message.defaultRoom) {
          setCurrentRoom(message.defaultRoom);
          loadMessages(message.defaultRoom);
        }
        break;
        
      case 'chat-message':
        // Check if it's a broadcast message with roomName and message object
        if (message.roomName && message.message) {
          addRoomMessage(message.roomName, message.message);
        }
        // Otherwise check if it's a direct message with text
        else if (message.text) {
          addSystemMessage(message.text);
        }
        break;
        
      case 'chat-broadcast':
        handleBroadcast(message);
        break;
        
      case 'chat-private-message':
        handlePrivateMessage(message.message);
        break;
        
      case 'chat-disconnected':
        setConnected(false);
        break;
        
      default:
        // Ignore unknown message types (like 'channels')
        break;
    }
  };
  
  const handleBroadcast = (data) => {
    const { roomName, type: eventType } = data;
    
    switch (eventType) {
      case 'chat-message':
        if (data.message && roomName) {
          addRoomMessage(roomName, data.message);
        }
        break;
        
      case 'user-joined':
        if (roomName) {
          addSystemMessage(`${data.callsign} joined ${roomName}`, roomName);
          loadUsers(roomName);
        }
        break;
        
      case 'user-left':
        if (roomName) {
          addSystemMessage(`${data.callsign} left ${roomName}`, roomName);
          loadUsers(roomName);
        }
        break;
        
      case 'topic-changed':
        if (roomName) {
          addSystemMessage(`Topic changed to: ${data.topic}`, roomName);
        }
        break;
        
      case 'user-muted':
        if (roomName) {
          addSystemMessage(`${data.callsign} was muted`, roomName);
        }
        break;
    }
  };
  
  const addRoomMessage = (roomName, message) => {
    setMessages(prev => ({
      ...prev,
      [roomName]: [...(prev[roomName] || []), message]
    }));
  };
  
  const addSystemMessage = (text, roomName = null) => {
    const message = {
      type: 'system',
      text,
      timestamp: Date.now()
    };
    
    if (roomName) {
      addRoomMessage(roomName, message);
    } else if (currentRoom) {
      addRoomMessage(currentRoom, message);
    }
  };
  
  const handlePrivateMessage = (message) => {
    // Show private message in current view
    addSystemMessage(`[Private from ${message.from}] ${message.text}`);
  };
  
  const loadRooms = async () => {
    try {
      const response = await api.get('/api/chat/rooms');
      if (response.data.success) {
        setRooms(response.data.rooms);
      }
    } catch (err) {
      console.error('Error loading rooms:', err);
    }
  };
  
  const loadMessages = async (roomName) => {
    try {
      // Load persistent message history (web UI only)
      const response = await api.get(`/api/chat/history/${roomName}?limit=100`);
      if (response.data.success) {
        setMessages(prev => ({
          ...prev,
          [roomName]: response.data.messages
        }));
      }
    } catch (err) {
      console.error('Error loading history:', err);
      // Fallback to in-memory messages if history is unavailable
      try {
        const fallbackResponse = await api.get(`/api/chat/rooms/${roomName}/messages?limit=100`);
        if (fallbackResponse.data.success) {
          setMessages(prev => ({
            ...prev,
            [roomName]: fallbackResponse.data.messages
          }));
        }
      } catch (fallbackErr) {
        console.error('Error loading fallback messages:', fallbackErr);
      }
    }
  };
  
  const loadUsers = async (roomName) => {
    try {
      const response = await api.get(`/api/chat/rooms/${roomName}/users`);
      if (response.data.success) {
        setUsers(prev => ({
          ...prev,
          [roomName]: response.data.users
        }));
      }
    } catch (err) {
      console.error('Error loading users:', err);
    }
  };
  
  const handleSendMessage = () => {
    if (!inputText.trim() || !ws || !connected) return;
    
    // Clear typing indicator
    if (typingTimeout) {
      clearTimeout(typingTimeout);
      setTypingTimeout(null);
    }
    
    // Send via WebSocket
    ws.send(JSON.stringify({
      type: 'chat-message',
      text: inputText
    }));
    
    setInputText('');
    
    // Stop typing indicator
    ws.send(JSON.stringify({
      type: 'chat-typing',
      typing: false
    }));
  };
  
  const handleInputChange = (e) => {
    setInputText(e.target.value);
    
    // Send typing indicator
    if (ws && connected) {
      ws.send(JSON.stringify({
        type: 'chat-typing',
        typing: true
      }));
      
      // Clear previous timeout
      if (typingTimeout) {
        clearTimeout(typingTimeout);
      }
      
      // Set new timeout to clear typing indicator
      const timeout = setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'chat-typing',
          typing: false
        }));
      }, 3000);
      
      setTypingTimeout(timeout);
    }
  };
  
  const handleCreateRoom = async () => {
    try {
      const response = await api.post('/api/chat/rooms', {
        ...newRoom,
        creator: callsign
      });
      
      if (response.data.success) {
        setCreateRoomDialog(false);
        setNewRoom({ name: '', description: '', password: '', maxUsers: 50 });
        loadRooms();
        
        // Join the new room
        handleJoinRoom(response.data.room.name, newRoom.password);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create room');
    }
  };
  
  const handleJoinRoom = async (roomName, password = '') => {
    try {
      const response = await api.post(`/api/chat/rooms/${roomName}/join`, {
        callsign,
        password
      });
      
      if (response.data.success) {
        setCurrentRoom(roomName);
        setJoinRoomDialog(false);
        setJoinPassword('');
        loadMessages(roomName);
        loadUsers(roomName);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to join room');
    }
  };
  
  const handleLeaveRoom = async (roomName) => {
    try {
      await api.post(`/api/chat/rooms/${roomName}/leave`, { callsign });
      
      if (currentRoom === roomName) {
        setCurrentRoom(null);
      }
      
      loadRooms();
    } catch (err) {
      console.error('Error leaving room:', err);
    }
  };
  
  const handleShowRoomInfo = async (roomName) => {
    try {
      const response = await api.get(`/api/chat/rooms/${roomName}`);
      if (response.data.success) {
        setSelectedRoomInfo(response.data.room);
        setRoomInfoDialog(true);
      }
    } catch (err) {
      setError('Failed to load room info');
    }
  };
  
  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };
  
  const getStatusIcon = (status) => {
    switch (status) {
      case 'online':
        return '🟢';
      case 'away':
        return '🟡';
      case 'typing':
        return '⌨️';
      default:
        return '⚫';
    }
  };
  
  const renderMessage = (message) => {
    if (message.type === 'system') {
      return (
        <Box sx={{ py: 0.5, px: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            *** {message.text}
          </Typography>
        </Box>
      );
    }
    
    if (message.type === 'message') {
      // Check if it's an action message (starts with *)
      const isAction = message.text.startsWith('* ');
      
      return (
        <Box sx={{ py: 0.5, px: 2 }}>
          <Typography variant="caption" color="text.secondary">
            [{formatTimestamp(message.timestamp)}]
          </Typography>
          {isAction ? (
            <Typography variant="body2" sx={{ fontStyle: 'italic', color: 'purple' }}>
              {message.text}
            </Typography>
          ) : (
            <Typography variant="body2">
              <strong style={{ color: '#1976d2' }}>{message.from}:</strong> {message.text}
            </Typography>
          )}
        </Box>
      );
    }
    
    return null;
  };
  
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
        <CircularProgress />
      </Box>
    );
  }
  
  return (
    <Box sx={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h4">💬 Chat</Typography>
          <Box>
            <Chip 
              label={connected ? `Connected: ${callsign}` : 'Disconnected'} 
              color={connected ? 'success' : 'error'}
              sx={{ mr: 1 }}
            />
            <IconButton onClick={() => setPage('chat-settings')}>
              <SettingsIcon />
            </IconButton>
          </Box>
        </Box>
      </Paper>
      
      {error && (
        <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      
      <Box sx={{ display: 'flex', flex: 1, gap: 2, overflow: 'hidden' }}>
        {/* Left Sidebar - Rooms */}
        <Paper sx={{ width: 250, display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="h6">Rooms</Typography>
            <Button 
              startIcon={<AddIcon />} 
              size="small" 
              onClick={() => setCreateRoomDialog(true)}
              sx={{ mt: 1 }}
              fullWidth
            >
              Create Room
            </Button>
            <Button 
              startIcon={<RefreshIcon />} 
              size="small" 
              onClick={loadRooms}
              sx={{ mt: 1 }}
              fullWidth
            >
              Refresh
            </Button>
          </Box>
          <List sx={{ flex: 1, overflow: 'auto' }}>
            {rooms.map((room) => (
              <ListItem
                key={room.name}
                button
                selected={currentRoom === room.name}
                onClick={() => {
                  if (currentRoom !== room.name) {
                    handleJoinRoom(room.name);
                  }
                }}
              >
                <ListItemIcon>
                  {room.hasPassword ? <LockIcon fontSize="small" /> : <PeopleIcon fontSize="small" />}
                </ListItemIcon>
                <ListItemText
                  primary={room.name}
                  secondary={`${room.userCount}/${room.maxUsers}`}
                />
                {room.persistent && <Chip label="📌" size="small" />}
              </ListItem>
            ))}
          </List>
        </Paper>
        
        {/* Main Chat Area */}
        <Paper sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {currentRoom ? (
            <>
              {/* Room Header */}
              <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6">{currentRoom}</Typography>
                <Box>
                  <IconButton size="small" onClick={() => handleShowRoomInfo(currentRoom)}>
                    <InfoIcon />
                  </IconButton>
                  <IconButton size="small" onClick={() => loadMessages(currentRoom)}>
                    <HistoryIcon />
                  </IconButton>
                  <IconButton size="small" onClick={() => handleLeaveRoom(currentRoom)}>
                    <ExitIcon />
                  </IconButton>
                </Box>
              </Box>
              
              {/* Messages */}
              <Box sx={{ flex: 1, overflow: 'auto', bgcolor: 'grey.50' }}>
                {(messages[currentRoom] || []).map((msg, index) => (
                  <React.Fragment key={msg.id || index}>
                    {renderMessage(msg)}
                  </React.Fragment>
                ))}
                <div ref={messagesEndRef} />
              </Box>
              
              {/* Input */}
              <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
                <TextField
                  ref={inputRef}
                  fullWidth
                  placeholder="Type a message or /help for commands..."
                  value={inputText}
                  onChange={handleInputChange}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  disabled={!connected}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton 
                          onClick={handleSendMessage} 
                          disabled={!connected || !inputText.trim()}
                          color="primary"
                        >
                          <SendIcon />
                        </IconButton>
                      </InputAdornment>
                    )
                  }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                  Commands: /join, /leave, /list, /users, /msg, /me, /help
                </Typography>
              </Box>
            </>
          ) : (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
              <Typography variant="h6" color="text.secondary">
                Select a room to start chatting
              </Typography>
            </Box>
          )}
        </Paper>
        
        {/* Right Sidebar - Users */}
        {currentRoom && (
          <Paper sx={{ width: 200, display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
              <Typography variant="h6">
                Users ({(users[currentRoom] || []).length})
              </Typography>
            </Box>
            <List sx={{ flex: 1, overflow: 'auto' }}>
              {(users[currentRoom] || []).map((user) => (
                <ListItem key={user.callsign}>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <span>{getStatusIcon(user.status)}</span>
                        <span>{user.callsign}</span>
                        {user.isCreator && <span>👑</span>}
                        {user.isModerator && <span>⭐</span>}
                        {user.isMuted && <span>🔇</span>}
                      </Box>
                    }
                  />
                </ListItem>
              ))}
            </List>
          </Paper>
        )}
      </Box>
      
      {/* Create Room Dialog */}
      <Dialog open={createRoomDialog} onClose={() => setCreateRoomDialog(false)}>
        <DialogTitle>Create New Room</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Room Name"
            fullWidth
            value={newRoom.name}
            onChange={(e) => setNewRoom({ ...newRoom, name: e.target.value.toUpperCase() })}
            helperText="3-20 characters, alphanumeric"
          />
          <TextField
            margin="dense"
            label="Description (optional)"
            fullWidth
            value={newRoom.description}
            onChange={(e) => setNewRoom({ ...newRoom, description: e.target.value })}
          />
          <TextField
            margin="dense"
            label="Password (optional)"
            type="password"
            fullWidth
            value={newRoom.password}
            onChange={(e) => setNewRoom({ ...newRoom, password: e.target.value })}
            helperText="Leave blank for public room"
          />
          <TextField
            margin="dense"
            label="Max Users"
            type="number"
            fullWidth
            value={newRoom.maxUsers}
            onChange={(e) => setNewRoom({ ...newRoom, maxUsers: parseInt(e.target.value) || 50 })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateRoomDialog(false)}>Cancel</Button>
          <Button onClick={handleCreateRoom} variant="contained" disabled={!newRoom.name.trim()}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Room Info Dialog */}
      <Dialog open={roomInfoDialog} onClose={() => setRoomInfoDialog(false)}>
        <DialogTitle>Room Information</DialogTitle>
        <DialogContent>
          {selectedRoomInfo && (
            <Box>
              <Typography><strong>Name:</strong> {selectedRoomInfo.name}</Typography>
              <Typography><strong>Description:</strong> {selectedRoomInfo.description || 'None'}</Typography>
              <Typography><strong>Topic:</strong> {selectedRoomInfo.topic || 'None'}</Typography>
              <Typography><strong>Creator:</strong> {selectedRoomInfo.creator}</Typography>
              <Typography><strong>Created:</strong> {new Date(selectedRoomInfo.created).toLocaleString()}</Typography>
              <Typography><strong>Users:</strong> {selectedRoomInfo.userCount}/{selectedRoomInfo.maxUsers}</Typography>
              <Typography><strong>Protected:</strong> {selectedRoomInfo.hasPassword ? 'Yes' : 'No'}</Typography>
              <Typography><strong>Type:</strong> {selectedRoomInfo.persistent ? 'Persistent' : 'Temporary'}</Typography>
              <Typography><strong>Moderators:</strong> {selectedRoomInfo.moderators?.join(', ') || 'None'}</Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRoomInfoDialog(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
