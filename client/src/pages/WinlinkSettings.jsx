import React, { useState, useEffect } from 'react';
import { Box, Typography, Switch, TextField, Button, FormControlLabel, Paper, Alert, Table, TableHead, TableBody, TableRow, TableCell, IconButton, Select, MenuItem, FormControl, InputLabel, FormHelperText } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import axios from 'axios';

export default function WinlinkSettings({ setGlobalMessage }) {
  const backend = `${location.protocol}//${location.hostname}:3000`;
  const [cfg, setCfg] = useState({ enabled: false, gatewayCallsign: '', host: '', port: 0, password: '', autoConnect: false, channels: {} });
  const [status, setStatus] = useState({ connected: false, enabled: false, lastError: null });
  const [channels, setChannels] = useState({});
  const [sessions, setSessions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [sessionTimeout, setSessionTimeout] = useState(300);
  const [channelErrors, setChannelErrors] = useState({});

  useEffect(() => { fetchCfg(); fetchStatus(); }, []);
  useEffect(() => { fetchChannels(); const iid = setInterval(fetchSessions, 5000); return () => clearInterval(iid); }, []);

  async function fetchCfg() {
    try {
      const r = await axios.get(`${backend}/api/winlink/settings`);
      const loaded = Object.assign({ enabled: false, gatewayCallsign: '', host: '', port: 0, password: '', autoConnect: false, channels: {} }, r.data || {});
      setCfg(loaded);
      setSessionTimeout(loaded.sessionTimeoutSec || 300);
    } catch (e) { console.error('Failed to fetch winlink settings', e); }
  }
  async function fetchStatus() {
    try {
      const r = await axios.get(`${backend}/api/winlink/status`);
      setStatus(r.data || {});
    } catch (e) { console.error('Failed to fetch winlink status', e); }
  }

  async function fetchChannels() {
    try {
      // read digipeater settings to get channel list
      const r = await axios.get(`${backend}/api/digipeater/settings`);
      const j = r.data || {};
      setChannels(j.channels || {});
    } catch (e) { console.error('Failed to fetch channels', e); }
  }

  async function fetchSessions() {
    try {
      const r = await axios.get(`${backend}/api/winlink/sessions`);
      setSessions(r.data && r.data.sessions ? r.data.sessions : []);
    } catch (e) { /* ignore */ }
  }

  async function save() {
    setSaving(true);
    try {
      // validate channel settings before saving
      const valid = validateChannels();
      if (!valid) { setSaving(false); if (typeof setGlobalMessage === 'function') setGlobalMessage('Fix channel errors before saving'); return; }

      const toSave = Object.assign({}, cfg || {});
      // include session timeout
      toSave.sessionTimeoutSec = Number(sessionTimeout || 300);
      await axios.post(`${backend}/api/winlink/settings`, toSave);
      fetchSessions();
      setSaving(false);
      if (typeof setGlobalMessage === 'function') setGlobalMessage('Winlink settings saved');
      setTimeout(() => setGlobalMessage(''), 3000);
    } catch (e) {
      setSaving(false);
      console.error('Failed to save winlink settings', e);
      if (typeof setGlobalMessage === 'function') setGlobalMessage('Error saving winlink settings');
    }
  }

  function validateChannels() {
    const errors = {};
    const channels = cfg.channels || {};
    for (const [id, ch] of Object.entries(channels)) {
      if (!ch || !ch.enabled) continue; // skip disabled channels
      if (!ch.mode || !['RMS', 'Radio'].includes(ch.mode)) {
        errors[id] = 'Mode must be RMS or Radio';
        continue;
      }
      if (!ch.callsign || String(ch.callsign).trim() === '') {
        errors[id] = ch.mode === 'RMS' ? 'Callsign-SSID required for RMS mode' : 'Destination callsign required for Radio mode';
        continue;
      }
    }
    setChannelErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function updateChannelSetting(channelId, setting, value) {
    setCfg(prev => ({
      ...prev,
      channels: {
        ...prev.channels,
        [channelId]: {
          ...prev.channels[channelId],
          [setting]: value
        }
      }
    }));
  }

  function getChannelSetting(channelId, setting, defaultValue) {
    const channel = cfg.channels && cfg.channels[channelId];
    return channel && Object.prototype.hasOwnProperty.call(channel, setting) ? channel[setting] : defaultValue;
  }  async function startStop(start) {
    try {
      if (start) await axios.post(`${backend}/api/winlink/start`);
      else await axios.post(`${backend}/api/winlink/stop`);
      fetchStatus();
      fetchSessions();
    } catch (e) { console.error('Start/Stop failed', e); }
  }

  async function terminateSession(key) {
    try {
      await axios.post(`${backend}/api/winlink/sessions/terminate`, { key });
      fetchSessions();
    } catch (e) { console.error('terminate failed', e); }
  }

  return (
    <Box>
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6">Winlink Integration</Typography>
        <FormControlLabel control={<Switch checked={cfg.enabled} onChange={(e) => setCfg(prev => ({ ...prev, enabled: e.target.checked }))} />} label="Enable Winlink" />
        <Box sx={{ display: 'flex', gap: 2, mt: 2, flexWrap: 'wrap' }}>
          <TextField 
            label="Gateway Callsign" 
            value={cfg.gatewayCallsign} 
            onChange={(e) => setCfg(prev => ({ ...prev, gatewayCallsign: e.target.value.toUpperCase() }))} 
            size="small" 
            sx={{ width: 180 }} 
          />
          <TextField 
            label="RMS Host" 
            value={cfg.host} 
            onChange={(e) => setCfg(prev => ({ ...prev, host: e.target.value }))} 
            size="small" 
            sx={{ width: 220 }} 
            placeholder="webmail.winlink.org"
          />
          <TextField 
            label="RMS Port" 
            type="number" 
            value={cfg.port || 0} 
            onChange={(e) => setCfg(prev => ({ ...prev, port: Number(e.target.value || 0) }))} 
            size="small" 
            sx={{ width: 110 }} 
          />
          <TextField 
            label="RMS Password" 
            type="password" 
            value={cfg.password || ''} 
            onChange={(e) => setCfg(prev => ({ ...prev, password: e.target.value }))} 
            size="small" 
            sx={{ width: 180 }} 
          />
          <TextField 
            label="Session Timeout (s)" 
            type="number" 
            value={sessionTimeout} 
            onChange={(e) => setSessionTimeout(Number(e.target.value||0))} 
            size="small" 
            sx={{ width: 160 }} 
          />
        </Box>
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2">Per-Channel Winlink Settings</Typography>
          <Box sx={{ mt: 1 }}>
            {Object.keys(channels).length === 0 && <Typography variant="body2">No channels found</Typography>}
            {Object.entries(channels).map(([id, c]) => {
              const enabled = getChannelSetting(id, 'enabled', false);
              const mode = getChannelSetting(id, 'mode', 'RMS');
              const callsign = getChannelSetting(id, 'callsign', '');
              const err = channelErrors[id];
              return (
                <Box key={id} sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1 }}>
                  <Typography sx={{ width: 160 }}>{id} ({c.name || c.type || 'radio'})</Typography>
                  
                  <FormControlLabel 
                    control={
                      <Switch 
                        size="small" 
                        checked={enabled} 
                        onChange={(e) => updateChannelSetting(id, 'enabled', e.target.checked)} 
                      />
                    } 
                    label="Enabled" 
                    sx={{ width: 100 }}
                  />

                  {enabled && (
                    <>
                      <FormControl size="small" sx={{ width: 120 }} error={!!err}>
                        <InputLabel id={`mode-${id}`}>Mode</InputLabel>
                        <Select 
                          labelId={`mode-${id}`} 
                          value={mode} 
                          label="Mode" 
                          onChange={(e) => updateChannelSetting(id, 'mode', e.target.value)}
                        >
                          <MenuItem value="RMS">RMS</MenuItem>
                          <MenuItem value="Radio">Radio</MenuItem>
                        </Select>
                      </FormControl>

                      <TextField 
                        placeholder={mode === 'RMS' ? 'Callsign-SSID' : 'Dest Callsign'} 
                        size="small" 
                        value={callsign} 
                        onChange={(e) => updateChannelSetting(id, 'callsign', e.target.value.toUpperCase())} 
                        sx={{ width: 160 }}
                        error={!!err}
                      />
                    </>
                  )}

                  {err && (
                    <Typography variant="caption" color="error" sx={{ ml: 1 }}>
                      {err}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
        <Box sx={{ mt: 2, display: 'flex', gap: 2 }}>
          <FormControlLabel control={<Switch checked={cfg.autoConnect} onChange={(e) => setCfg(prev => ({ ...prev, autoConnect: e.target.checked }))} />} label="Auto connect at startup" />
        </Box>
        <Box sx={{ mt: 2 }}>
          <Button variant="contained" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Settings'}</Button>
          <Button sx={{ ml: 2 }} variant="outlined" onClick={() => startStop(true)} disabled={!cfg.enabled}>Start</Button>
          <Button sx={{ ml: 1 }} variant="outlined" onClick={() => startStop(false)} disabled={!cfg.enabled}>Stop</Button>
        </Box>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6">Status</Typography>
        <Typography variant="body2">Enabled: {String(status.enabled)}</Typography>
        <Typography variant="body2">Connected: {String(status.connected)}</Typography>
        {status.lastError && <Alert severity="error" sx={{ mt: 1 }}>{status.lastError}</Alert>}
      </Paper>

      <Paper sx={{ p: 2, mt: 2 }}>
        <Typography variant="h6">Active Sessions</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Channel</TableCell>
              <TableCell>Client</TableCell>
              <TableCell>Last Activity</TableCell>
              <TableCell>Idle (s)</TableCell>
              <TableCell>In / Out (bytes)</TableCell>
              <TableCell>Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sessions.map(s => (
              <TableRow key={s.key}>
                <TableCell>{s.clientChannel}</TableCell>
                <TableCell>{s.clientCall}</TableCell>
                <TableCell>{s.lastActivity ? new Date(s.lastActivity).toLocaleString() : ''}</TableCell>
                <TableCell>{s.lastActivity ? Math.round((Date.now() - s.lastActivity) / 1000) : ''}</TableCell>
                <TableCell>{(s.bytesIn||0) + ' / ' + (s.bytesOut||0)}</TableCell>
                <TableCell><IconButton size="small" onClick={() => terminateSession(s.key)}><DeleteIcon /></IconButton></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}
