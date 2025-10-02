import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Switch,
  TextField,
  Button,
  FormControlLabel,
  Paper,
  Divider,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  OutlinedInput,
} from '@mui/material';
import axios from 'axios';

export default function BBSSettings() {
  const [bbsEnabled, setBbsEnabled] = useState(false);
  const [callsign, setCallsign] = useState('');
  const [selectedChannels, setSelectedChannels] = useState([]);
  const [availableChannels, setAvailableChannels] = useState([]);
  const [saveMessage, setSaveMessage] = useState('');

  const backend = `http://${location.hostname}:3000`;

  useEffect(() => {
    fetchSettings();
    fetchChannels();
  }, []);

  const fetchChannels = async () => {
    try {
      const response = await axios.get(`${backend}/api/channels`);
      setAvailableChannels(response.data || []);
    } catch (error) {
      console.error('Error fetching channels:', error);
    }
  };

  const fetchSettings = async () => {
    try {
      const response = await axios.get(`${backend}/api/bbs/settings`);
      setBbsEnabled(response.data.enabled);
      setCallsign(response.data.callsign);
      setSelectedChannels(response.data.channels || []);
    } catch (error) {
      console.error('Error fetching BBS settings:', error);
    }
  };

  const saveSettings = async () => {
    try {
      await axios.post(`${backend}/api/bbs/settings`, { 
        enabled: bbsEnabled, 
        callsign: callsign.toUpperCase(),
        channels: selectedChannels
      });
      setSaveMessage('Settings saved successfully!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      console.error('Error saving BBS settings:', error);
      setSaveMessage('Error saving settings. Please try again.');
      setTimeout(() => setSaveMessage(''), 5000);
    }
  };

  const handleChannelChange = (event) => {
    const value = event.target.value;
    setSelectedChannels(typeof value === 'string' ? value.split(',') : value);
  };

  // Filter channels by type for display
  const digipeaterChannels = availableChannels.filter(ch => {
    const mode = ch.mode || (ch.options && ch.options.mode) || 'digipeat';
    return mode === 'digipeat' || mode === 'Digipeat' || mode === 'Digipeat + Packet';
  });

  const otherChannels = availableChannels.filter(ch => {
    const mode = ch.mode || (ch.options && ch.options.mode) || 'digipeat';
    return !(mode === 'digipeat' || mode === 'Digipeat' || mode === 'Digipeat + Packet');
  });

  return (
    <Box sx={{ padding: '2rem' }}>
      <Typography variant="h4" gutterBottom>
        BBS Settings
      </Typography>

      <Paper sx={{ padding: '2rem', marginBottom: '2rem' }}>
        <Typography variant="h6" gutterBottom>
          Basic Configuration
        </Typography>
        
        <FormControlLabel
          control={
            <Switch
              checked={bbsEnabled}
              onChange={(e) => setBbsEnabled(e.target.checked)}
            />
          }
          label="Enable BBS System"
        />
        
        <TextField
          label="BBS Callsign"
          value={callsign}
          onChange={(e) => setCallsign(e.target.value.toUpperCase())}
          fullWidth
          margin="normal"
          helperText="The callsign that will respond to APRS messages"
          disabled={!bbsEnabled}
          placeholder="ex: W1BBS"
        />

        <FormControl fullWidth margin="normal" disabled={!bbsEnabled}>
          <InputLabel>Additional BBS Channels</InputLabel>
          <Select
            multiple
            value={selectedChannels}
            onChange={handleChannelChange}
            input={<OutlinedInput label="Additional BBS Channels" />}
            renderValue={(selected) => (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {selected.map((value) => {
                  const channel = availableChannels.find(ch => ch.id === value);
                  return <Chip key={value} label={channel ? `${channel.name} (${channel.id})` : value} />;
                })}
              </Box>
            )}
          >
            {otherChannels.map((channel) => (
              <MenuItem key={channel.id} value={channel.id}>
                {channel.name} ({channel.id}) - {channel.type}
              </MenuItem>
            ))}
          </Select>
          <Typography variant="caption" color="textSecondary" sx={{ mt: 1 }}>
            Select additional channels that can access the BBS. Digipeater channels always have BBS access.
          </Typography>
        </FormControl>

        {digipeaterChannels.length > 0 && (
          <Box sx={{ marginTop: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Digipeater Channels (Always Enabled):
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {digipeaterChannels.map((channel) => (
                <Chip 
                  key={channel.id} 
                  label={`${channel.name} (${channel.id})`} 
                  color="primary" 
                  size="small"
                />
              ))}
            </Box>
            <Typography variant="caption" color="textSecondary">
              These channels automatically have BBS access when enabled.
            </Typography>
          </Box>
        )}

        {saveMessage && (
          <Alert 
            severity={saveMessage.includes('Error') ? 'error' : 'success'} 
            sx={{ marginTop: 2 }}
          >
            {saveMessage}
          </Alert>
        )}

        <Box sx={{ marginTop: '1rem' }}>
          <Button 
            variant="contained" 
            color="primary" 
            onClick={saveSettings}
            disabled={bbsEnabled && !callsign.trim()}
          >
            Save Settings
          </Button>
        </Box>
      </Paper>

      <Paper sx={{ padding: '2rem' }}>
        <Typography variant="h6" gutterBottom>
          BBS Information
        </Typography>
        
        <Typography variant="body1" paragraph>
          The BBS (Bulletin Board System) allows users to send and receive messages via APRS.
        </Typography>
        
        <Typography variant="h6" gutterBottom>
          APRS Commands:
        </Typography>
        
        <Box component="pre" sx={{ fontFamily: 'monospace', fontSize: '0.875rem', marginLeft: 2 }}>
          {`L or LIST    - List available messages
R n          - Read message number n
H or HELP    - Show help information
B or BYE     - Sign off
<message>    - Post a bulletin message`}
        </Box>

        <Typography variant="body2" color="textSecondary" sx={{ marginTop: 2 }}>
          Users can send messages to your BBS callsign via APRS to interact with the system.
          All bulletin messages are stored and can be viewed in the BBS web interface.
        </Typography>
      </Paper>
    </Box>
  );
}