/**
 * ServerManagerDialog.jsx
 * 
 * Dialog for managing multiple server connections
 */

import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemSecondaryAction,
  IconButton,
  TextField,
  Alert,
  Box,
  Typography,
  Chip,
  Divider
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Edit as EditIcon,
  CheckCircle as CheckCircleIcon,
  Add as AddIcon,
  RadioButtonUnchecked as RadioButtonUncheckedIcon
} from '@mui/icons-material';
import { serverManager } from '../utils/serverManager';

export default function ServerManagerDialog({ open, onClose, onServerChange }) {
  const [servers, setServers] = useState(serverManager.getAllServers());
  const [activeServerId, setActiveServerId] = useState(serverManager.activeServerId);
  const [editingServer, setEditingServer] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    host: '',
    password: '',
    callsign: ''
  });
  const [error, setError] = useState('');

  const refreshServers = () => {
    setServers(serverManager.getAllServers());
    setActiveServerId(serverManager.activeServerId);
  };

  const handleSelectServer = (serverId) => {
    try {
      serverManager.setActiveServer(serverId);
      refreshServers();
      onServerChange(serverManager.getActiveServer());
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteServer = (serverId) => {
    if (!confirm('Are you sure you want to delete this server?')) {
      return;
    }

    try {
      serverManager.deleteServer(serverId);
      refreshServers();
      
      // If we deleted the active server, notify parent
      if (serverId === activeServerId) {
        const newActive = serverManager.getActiveServer();
        if (newActive) {
          onServerChange(newActive);
        }
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleStartEdit = (server) => {
    setEditingServer(server.id);
    setFormData({
      name: server.name,
      host: server.host,
      password: server.password,
      callsign: server.callsign
    });
    setError('');
  };

  const handleCancelEdit = () => {
    setEditingServer(null);
    setFormData({ name: '', host: '', password: '', callsign: '' });
    setError('');
  };

  const handleSaveEdit = () => {
    if (!formData.host || !formData.password || !formData.callsign) {
      setError('Host, password, and callsign are required');
      return;
    }

    try {
      serverManager.updateServer(editingServer, {
        name: formData.name || formData.host,
        host: formData.host,
        password: formData.password,
        callsign: formData.callsign.toUpperCase()
      });
      
      refreshServers();
      setEditingServer(null);
      setFormData({ name: '', host: '', password: '', callsign: '' });
      setError('');
      
      // If we edited the active server, notify parent
      if (editingServer === activeServerId) {
        onServerChange(serverManager.getActiveServer());
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleStartAdd = () => {
    setEditingServer('new');
    setFormData({ name: '', host: 'localhost:3000', password: '', callsign: '' });
    setError('');
  };

  const handleAddServer = () => {
    if (!formData.host || !formData.password || !formData.callsign) {
      setError('Host, password, and callsign are required');
      return;
    }

    try {
      const newServer = serverManager.addServer({
        name: formData.name || formData.host,
        host: formData.host,
        password: formData.password,
        callsign: formData.callsign.toUpperCase()
      });
      
      refreshServers();
      setEditingServer(null);
      setFormData({ name: '', host: '', password: '', callsign: '' });
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Manage Servers
      </DialogTitle>
      
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}
        
        {editingServer ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="h6">
              {editingServer === 'new' ? 'Add New Server' : 'Edit Server'}
            </Typography>
            
            <TextField
              label="Server Name (Optional)"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="My Home Node"
              fullWidth
            />
            
            <TextField
              label="Host"
              value={formData.host}
              onChange={(e) => setFormData(prev => ({ ...prev, host: e.target.value }))}
              placeholder="localhost:3000"
              required
              fullWidth
            />
            
            <TextField
              label="Password"
              type="password"
              value={formData.password}
              onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
              required
              fullWidth
            />
            
            <TextField
              label="Callsign"
              value={formData.callsign}
              onChange={(e) => setFormData(prev => ({ ...prev, callsign: e.target.value.toUpperCase() }))}
              required
              fullWidth
            />
            
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <Button onClick={handleCancelEdit}>
                Cancel
              </Button>
              <Button 
                variant="contained" 
                onClick={editingServer === 'new' ? handleAddServer : handleSaveEdit}
              >
                {editingServer === 'new' ? 'Add' : 'Save'}
              </Button>
            </Box>
          </Box>
        ) : (
          <>
            <List>
              {servers.map((server) => (
                <React.Fragment key={server.id}>
                  <ListItem
                    button
                    onClick={() => handleSelectServer(server.id)}
                    selected={server.id === activeServerId}
                  >
                    <ListItemIcon>
                      {server.id === activeServerId ? (
                        <CheckCircleIcon color="primary" />
                      ) : (
                        <RadioButtonUncheckedIcon />
                      )}
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {server.name}
                          {server.id === activeServerId && (
                            <Chip label="Active" size="small" color="primary" />
                          )}
                        </Box>
                      }
                      secondary={
                        <>
                          <Typography variant="body2" component="span">
                            {server.host} • {server.callsign}
                          </Typography>
                        </>
                      }
                    />
                    <ListItemSecondaryAction>
                      <IconButton
                        edge="end"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartEdit(server);
                        }}
                        sx={{ mr: 1 }}
                      >
                        <EditIcon />
                      </IconButton>
                      <IconButton
                        edge="end"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteServer(server.id);
                        }}
                        disabled={servers.length === 1}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                  <Divider />
                </React.Fragment>
              ))}
            </List>
            
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={handleStartAdd}
              fullWidth
              sx={{ mt: 2 }}
            >
              Add Server
            </Button>
          </>
        )}
      </DialogContent>
      
      <DialogActions>
        <Button onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
