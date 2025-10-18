/**
 * ChatSettings.jsx
 * 
 * Configuration interface for chat system
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  FormControlLabel,
  Switch,
  Divider,
  Alert,
  CircularProgress,
  Grid,
  Card,
  CardContent
} from '@mui/material';
import { Save as SaveIcon, History as HistoryIcon, Storage as StorageIcon } from '@mui/icons-material';
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

export default function ChatSettings({ setGlobalMessage }) {
  const [settings, setSettings] = useState({
    defaultRoom: 'LOBBY',
    maxUsersPerRoom: 50,
    maxMessageHistory: 100,
    messageRateLimit: 10,
    typingIndicators: true,
    notificationSounds: true,
    showJoinLeave: true,
    messageRetentionDays: 7
  });
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [historyStats, setHistoryStats] = useState(null);
  
  useEffect(() => {
    loadSettings();
    loadHistoryStats();
  }, []);
  
  const loadSettings = async () => {
    try {
      const response = await api.get('/api/chat/settings');
      if (response.data.success) {
        setSettings(response.data.settings);
      }
      setLoading(false);
    } catch (err) {
      setError('Failed to load chat settings');
      setLoading(false);
    }
  };
  
  const loadHistoryStats = async () => {
    try {
      const response = await api.get('/api/chat/history/stats');
      if (response.data.success) {
        setHistoryStats(response.data.stats);
      }
    } catch (err) {
      // History might not be available, ignore error
      console.log('Chat history not available');
    }
  };
  
  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    
    try {
      const response = await api.post('/api/chat/settings', settings);
      
      if (response.data.success) {
        setSuccess('Chat settings saved successfully');
        if (setGlobalMessage) {
          setGlobalMessage({ type: 'success', text: 'Chat settings saved' });
        }
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save chat settings');
    } finally {
      setSaving(false);
    }
  };
  
  const handleChange = (field, value) => {
    setSettings(prev => ({
      ...prev,
      [field]: value
    }));
  };
  
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }
  
  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        💬 Chat Settings
      </Typography>
      
      {error && (
        <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      
      {success && (
        <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>
          {success}
        </Alert>
      )}
      
      {/* General Settings */}
      <Paper sx={{ p: 3, mb: 2 }}>
        <Typography variant="h6" gutterBottom>
          General Settings
        </Typography>
        
        <TextField
          fullWidth
          label="Default Room"
          value={settings.defaultRoom}
          onChange={(e) => handleChange('defaultRoom', e.target.value.toUpperCase())}
          helperText="Room that users join automatically on connect"
          margin="normal"
        />
        
        <TextField
          fullWidth
          type="number"
          label="Max Users Per Room"
          value={settings.maxUsersPerRoom}
          onChange={(e) => handleChange('maxUsersPerRoom', parseInt(e.target.value) || 50)}
          helperText="Maximum number of users allowed in a room (1-500)"
          margin="normal"
          inputProps={{ min: 1, max: 500 }}
        />
        
        <TextField
          fullWidth
          type="number"
          label="Message History Limit"
          value={settings.maxMessageHistory}
          onChange={(e) => handleChange('maxMessageHistory', parseInt(e.target.value) || 100)}
          helperText="Number of messages to keep in memory per room (10-1000)"
          margin="normal"
          inputProps={{ min: 10, max: 1000 }}
        />
        
        <TextField
          fullWidth
          type="number"
          label="Message Rate Limit"
          value={settings.messageRateLimit}
          onChange={(e) => handleChange('messageRateLimit', parseInt(e.target.value) || 10)}
          helperText="Maximum messages per minute per user (1-60)"
          margin="normal"
          inputProps={{ min: 1, max: 60 }}
        />
      </Paper>
      
      {/* UI Features */}
      <Paper sx={{ p: 3, mb: 2 }}>
        <Typography variant="h6" gutterBottom>
          User Interface
        </Typography>
        
        <FormControlLabel
          control={
            <Switch
              checked={settings.typingIndicators}
              onChange={(e) => handleChange('typingIndicators', e.target.checked)}
            />
          }
          label="Enable Typing Indicators"
        />
        <Typography variant="caption" display="block" color="text.secondary" sx={{ mb: 2 }}>
          Show when users are typing in a room
        </Typography>
        
        <FormControlLabel
          control={
            <Switch
              checked={settings.notificationSounds}
              onChange={(e) => handleChange('notificationSounds', e.target.checked)}
            />
          }
          label="Enable Notification Sounds"
        />
        <Typography variant="caption" display="block" color="text.secondary" sx={{ mb: 2 }}>
          Play sound when new messages arrive
        </Typography>
        
        <FormControlLabel
          control={
            <Switch
              checked={settings.showJoinLeave}
              onChange={(e) => handleChange('showJoinLeave', e.target.checked)}
            />
          }
          label="Show Join/Leave Messages"
        />
        <Typography variant="caption" display="block" color="text.secondary">
          Display system messages when users join or leave rooms
        </Typography>
      </Paper>
      
      {/* Persistence */}
      <Paper sx={{ p: 3, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <StorageIcon color="primary" />
          <Typography variant="h6">
            Message Persistence
          </Typography>
        </Box>
        
        <TextField
          fullWidth
          type="number"
          label="Message Retention Days"
          value={settings.messageRetentionDays}
          onChange={(e) => handleChange('messageRetentionDays', parseInt(e.target.value) || 7)}
          helperText="Number of days to keep message history on disk (1-365)"
          margin="normal"
          inputProps={{ min: 1, max: 365 }}
        />
        
        <Alert severity="success" sx={{ mt: 2 }}>
          <strong>✓ Persistent Storage Enabled</strong><br/>
          Messages are automatically saved to disk and persist across server restarts.
          RF users (AX.25 connections) only see live messages, not history.
        </Alert>
        
        {/* History Statistics */}
        {historyStats && (
          <Box sx={{ mt: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <HistoryIcon color="primary" />
              <Typography variant="h6">
                History Statistics
              </Typography>
            </Box>
            
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6} md={3}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="h4" color="primary" gutterBottom>
                      {historyStats.totalMessages || 0}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Total Messages
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              
              <Grid item xs={12} sm={6} md={3}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="h4" color="primary" gutterBottom>
                      {historyStats.totalRooms || 0}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Rooms with History
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              
              <Grid item xs={12} sm={6} md={3}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="h4" color="primary" gutterBottom>
                      {historyStats.oldestMessage 
                        ? new Date(historyStats.oldestMessage).toLocaleDateString()
                        : 'N/A'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Oldest Message
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              
              <Grid item xs={12} sm={6} md={3}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="h4" color="primary" gutterBottom>
                      {historyStats.newestMessage 
                        ? new Date(historyStats.newestMessage).toLocaleDateString()
                        : 'N/A'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Newest Message
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
            
            {/* Per-room breakdown */}
            {historyStats.rooms && Object.keys(historyStats.rooms).length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Messages per Room:
                </Typography>
                <Grid container spacing={1}>
                  {Object.entries(historyStats.rooms).map(([room, count]) => (
                    <Grid item xs={12} sm={6} md={4} key={room}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                        <Typography variant="body2">{room}</Typography>
                        <Typography variant="body2" fontWeight="bold">{count}</Typography>
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              </Box>
            )}
            
            <Button 
              variant="outlined" 
              size="small" 
              onClick={loadHistoryStats}
              sx={{ mt: 2 }}
            >
              Refresh Statistics
            </Button>
          </Box>
        )}
      </Paper>
      
      {/* Command Reference */}
      <Paper sx={{ p: 3, mb: 2 }}>
        <Typography variant="h6" gutterBottom>
          Chat Commands Reference
        </Typography>
        
        <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>
          Room Management:
        </Typography>
        <Box component="ul" sx={{ mt: 0 }}>
          <li><code>/join &lt;room&gt; [password]</code> - Join a room</li>
          <li><code>/leave</code> - Leave current room</li>
          <li><code>/create &lt;room&gt; [password]</code> - Create a new room</li>
          <li><code>/delete &lt;room&gt;</code> - Delete a room (creator/mod only)</li>
          <li><code>/list</code> - List all rooms</li>
        </Box>
        
        <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>
          Communication:
        </Typography>
        <Box component="ul" sx={{ mt: 0 }}>
          <li><code>/msg &lt;callsign&gt; &lt;text&gt;</code> - Send private message</li>
          <li><code>/me &lt;action&gt;</code> - Send action message</li>
          <li><code>/users</code> - List users in current room</li>
        </Box>
        
        <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>
          Moderation (Moderators only):
        </Typography>
        <Box component="ul" sx={{ mt: 0 }}>
          <li><code>/topic &lt;text&gt;</code> - Set room topic</li>
          <li><code>/kick &lt;callsign&gt;</code> - Kick user from room</li>
          <li><code>/ban &lt;callsign&gt;</code> - Ban user from room</li>
          <li><code>/mute &lt;callsign&gt;</code> - Mute user</li>
          <li><code>/unmute &lt;callsign&gt;</code> - Unmute user</li>
          <li><code>/mod &lt;callsign&gt;</code> - Make user a moderator</li>
        </Box>
        
        <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>
          Information:
        </Typography>
        <Box component="ul" sx={{ mt: 0 }}>
          <li><code>/info [room]</code> - Show room information</li>
          <li><code>/history [count]</code> - Show message history</li>
          <li><code>/help</code> - Show all commands</li>
        </Box>
        
        <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>
          Status:
        </Typography>
        <Box component="ul" sx={{ mt: 0 }}>
          <li><code>/away [message]</code> - Set status to away</li>
          <li><code>/back</code> - Set status to online</li>
          <li><code>/quit</code> - Exit chat</li>
        </Box>
      </Paper>
      
      {/* Save Button */}
      <Box sx={{ display: 'flex', gap: 2 }}>
        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={20} /> : <SaveIcon />}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
        
        <Button
          variant="outlined"
          onClick={loadSettings}
          disabled={saving}
        >
          Reset
        </Button>
      </Box>
    </Box>
  );
}
