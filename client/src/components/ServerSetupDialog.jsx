/**
 * ServerSetupDialog.jsx
 * 
 * First-time setup dialog for adding a server connection
 */

import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Alert,
  CircularProgress,
  Box,
  Typography
} from '@mui/material';
import { serverManager } from '../utils/serverManager';

export default function ServerSetupDialog({ open, onComplete }) {
  const [formData, setFormData] = useState({
    name: '',
    host: 'localhost:3000',
    password: '',
    callsign: ''
  });
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError('');
  };

  const handleTest = async () => {
    if (!formData.host || !formData.password) {
      setError('Host and password are required');
      return;
    }

    setTesting(true);
    setError('');

    const result = await serverManager.testConnection(formData.host, formData.password);
    
    setTesting(false);

    if (!result.success) {
      setError(result.error || 'Connection test failed');
    } else {
      setError('');
      alert('✓ Connection successful!');
    }
  };

  const handleSubmit = async () => {
    if (!formData.host || !formData.password || !formData.callsign) {
      setError('Host, password, and callsign are required');
      return;
    }

    setTesting(true);
    setError('');

    // Strip any http:// or https:// prefix before saving
    const cleanHost = formData.host.replace(/^https?:\/\//, '');

    // Test connection first
    const result = await serverManager.testConnection(cleanHost, formData.password);
    
    if (!result.success) {
      setTesting(false);
      setError(result.error || 'Connection failed. Please check your settings.');
      return;
    }

    // Add server
    try {
      const server = serverManager.addServer({
        name: formData.name || cleanHost,
        host: cleanHost,
        password: formData.password,
        callsign: formData.callsign.toUpperCase()
      });
      
      setTesting(false);
      onComplete(server);
    } catch (err) {
      setTesting(false);
      setError(err.message);
    }
  };

  return (
    <Dialog 
      open={open} 
      maxWidth="sm" 
      fullWidth
      disableEscapeKeyDown
    >
      <DialogTitle>
        <Box>
          <Typography variant="h5">Welcome to NexDigi</Typography>
          <Typography variant="body2" color="text.secondary">
            Connect to your NexDigi server
          </Typography>
        </Box>
      </DialogTitle>
      
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {error && (
            <Alert severity="error">{error}</Alert>
          )}
          
          <TextField
            label="Server Name (Optional)"
            value={formData.name}
            onChange={(e) => handleChange('name', e.target.value)}
            placeholder="My Home Node"
            helperText="Friendly name for this server"
            fullWidth
          />
          
          <TextField
            label="Host"
            value={formData.host}
            onChange={(e) => handleChange('host', e.target.value)}
            placeholder="localhost:3000"
            helperText="Server address and port"
            required
            fullWidth
          />
          
          <TextField
            label="Password"
            type="password"
            value={formData.password}
            onChange={(e) => handleChange('password', e.target.value)}
            placeholder="Server UI password"
            helperText="Your server's UI password"
            required
            fullWidth
          />
          
          <TextField
            label="Callsign"
            value={formData.callsign}
            onChange={(e) => handleChange('callsign', e.target.value.toUpperCase())}
            placeholder="N0CALL"
            helperText="Your amateur radio callsign"
            required
            fullWidth
          />
          
          <Button
            variant="outlined"
            onClick={handleTest}
            disabled={testing || !formData.host || !formData.password}
            startIcon={testing && <CircularProgress size={16} />}
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </Button>
        </Box>
      </DialogContent>
      
      <DialogActions>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={testing || !formData.host || !formData.password || !formData.callsign}
        >
          {testing ? 'Connecting...' : 'Connect'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
