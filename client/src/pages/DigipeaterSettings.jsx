import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Switch,
  TextField,
  Button,
  FormControlLabel,
  Tooltip,
  Paper,
  Divider,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  OutlinedInput,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Autocomplete,
  CircularProgress,
  Card,
  CardContent,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
} from '@mui/material';
import { Settings as SettingsIcon, Close as CloseIcon } from '@mui/icons-material';
import axios from 'axios';

// Channel Configuration Modal
function ChannelConfigModal({ open, onClose, channel, channelSettings, updateChannelSetting, maxNErrors }) {
  if (!channel) return null;

  const getChannelSetting = (setting, defaultValue) => {
    const ch = channelSettings[channel.id];
    if (!ch) return defaultValue;
    
    if (setting.startsWith('beacon.')) {
      const beaconField = setting.replace('beacon.', '');
      const beacon = ch.beacon || {};
      return Object.prototype.hasOwnProperty.call(beacon, beaconField) ? beacon[beaconField] : defaultValue;
    }
    
    return Object.prototype.hasOwnProperty.call(ch, setting) ? ch[setting] : defaultValue;
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">
            Configure {channel.name} ({channel.id})
          </Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      
      <DialogContent dividers>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          
          {/* Basic Settings */}
          <Paper sx={{ p: 2 }} variant="outlined">
            <Typography variant="subtitle1" gutterBottom>Basic Settings</Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel>Mode</InputLabel>
                <Select
                  value={getChannelSetting('mode', 'digipeat')}
                  onChange={(e) => updateChannelSetting(channel.id, 'mode', e.target.value)}
                  label="Mode"
                >
                  <MenuItem value="digipeat">Digipeat</MenuItem>
                  <MenuItem value="receive-only">Receive Only</MenuItem>
                  <MenuItem value="disabled">Disabled</MenuItem>
                </Select>
              </FormControl>

              <TextField
                label="Callsign"
                value={getChannelSetting('callsign', '')}
                onChange={(e) => updateChannelSetting(channel.id, 'callsign', e.target.value)}
                size="small"
                sx={{ width: 140 }}
                required={getChannelSetting('mode', 'digipeat') === 'digipeat'}
              />

              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel>Role</InputLabel>
                <Select
                  value={getChannelSetting('role', 'wide')}
                  onChange={(e) => updateChannelSetting(channel.id, 'role', e.target.value)}
                  label="Role"
                >
                  <MenuItem value="fill-in">Fill-in (WIDE1-*)</MenuItem>
                  <MenuItem value="wide">Wide (WIDE2+)</MenuItem>
                </Select>
              </FormControl>

              <TextField
                label="Max N"
                type="number"
                value={getChannelSetting('maxWideN', 2)}
                onChange={(e) => updateChannelSetting(channel.id, 'maxWideN', e.target.value)}
                size="small"
                sx={{ width: 100 }}
                inputProps={{ min: 1, max: 7 }}
                error={!!maxNErrors[channel.id]}
                helperText={maxNErrors[channel.id] || '1-7'}
              />
            </Box>
          </Paper>

          {/* Beacon Settings */}
          <Paper sx={{ p: 2 }} variant="outlined">
            <Typography variant="subtitle1" gutterBottom>Scheduled Beacon</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={getChannelSetting('beacon.enabled', false)}
                    onChange={(e) => updateChannelSetting(channel.id, 'beacon.enabled', e.target.checked)}
                  />
                }
                label="Enable Scheduled Beacon"
              />
              
              {getChannelSetting('beacon.enabled', false) && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, ml: 4 }}>
                  <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    <TextField
                      label="Interval (minutes)"
                      type="number"
                      value={getChannelSetting('beacon.intervalMinutes', 15)}
                      onChange={(e) => updateChannelSetting(channel.id, 'beacon.intervalMinutes', Number(e.target.value))}
                      size="small"
                      sx={{ width: 150 }}
                      inputProps={{ min: 1, max: 1440 }}
                      helperText="1-1440 minutes"
                    />
                    <FormControl size="small" sx={{ width: 200 }}>
                      <InputLabel>APRS Symbol</InputLabel>
                      <Select
                        value={`${getChannelSetting('beacon.symbolTable', '/')}${getChannelSetting('beacon.symbol', 'k')}`}
                        onChange={(e) => {
                          const value = e.target.value;
                          const symbolTable = value.charAt(0);
                          const symbol = value.charAt(1);
                          updateChannelSetting(channel.id, 'beacon.symbolTable', symbolTable);
                          updateChannelSetting(channel.id, 'beacon.symbol', symbol);
                        }}
                        label="APRS Symbol"
                      >
                        <MenuItem value="/k">🏢 Digipeater (/k)</MenuItem>
                        <MenuItem value="/r">📻 Repeater (/r)</MenuItem>
                        <MenuItem value="/#">⭐ Star (/#)</MenuItem>
                        <MenuItem value="/&">🏠 House (/&)</MenuItem>
                        <MenuItem value="/-">📍 House (/-)</MenuItem>
                        <MenuItem value="/j">⛽ Gas Station (/j)</MenuItem>
                        <MenuItem value="/u">🚛 Truck (/u)</MenuItem>
                        <MenuItem value="/s">⛵ Ship (/s)</MenuItem>
                        <MenuItem value="/Y">⛵ Yacht (/Y)</MenuItem>
                        <MenuItem value="/c">🚗 Car (/c)</MenuItem>
                        <MenuItem value="/v">🚐 Van (/v)</MenuItem>
                        <MenuItem value="/m">🏍️ Motorcycle (/m)</MenuItem>
                        <MenuItem value="/b">🚲 Bicycle (/b)</MenuItem>
                        <MenuItem value="/[">👤 Person (/[)</MenuItem>
                        <MenuItem value="/I">🏬 Building (/I)</MenuItem>
                        <MenuItem value="/P">🅿️ Parking (/P)</MenuItem>
                        <MenuItem value="/h">🏥 Hospital (/h)</MenuItem>
                        <MenuItem value="/f">🚒 Fire Station (/f)</MenuItem>
                        <MenuItem value="/p">👮 Police (/p)</MenuItem>
                        <MenuItem value="/w">🌊 Water (/w)</MenuItem>
                        <MenuItem value="/W">💧 Water Station (/W)</MenuItem>
                        <MenuItem value="/X">✖️ X (/X)</MenuItem>
                        <MenuItem value="/O">⭕ Circle (/O)</MenuItem>
                        <MenuItem value="/n">📡 Node (\\n)</MenuItem>
                        <MenuItem value="\\k">📶 Node (\k)</MenuItem>
                        <MenuItem value="\\r">📻 Alt Repeater (\r)</MenuItem>
                        <MenuItem value="\\&">💎 Diamond (\&)</MenuItem>
                        <MenuItem value="\\#">💫 Alt Star (\#)</MenuItem>
                      </Select>
                    </FormControl>
                  </Box>
                  <TextField
                    label="Beacon Message"
                    value={getChannelSetting('beacon.message', '')}
                    onChange={(e) => updateChannelSetting(channel.id, 'beacon.message', e.target.value)}
                    multiline
                    rows={3}
                    fullWidth
                    placeholder="Status message to broadcast (e.g., 'Durham County Digipeater - 146.52 MHz')"
                    helperText="This message will be sent as an APRS status beacon"
                  />
                </Box>
              )}
            </Box>
          </Paper>

          {/* Advanced Options */}
          <Paper sx={{ p: 2 }} variant="outlined">
            <Typography variant="subtitle1" gutterBottom>Advanced Options</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={getChannelSetting('igateForward', false)}
                    onChange={(e) => updateChannelSetting(channel.id, 'igateForward', e.target.checked)}
                  />
                }
                label="IGate Forward"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={getChannelSetting('appendCallsign', true)}
                    onChange={(e) => updateChannelSetting(channel.id, 'appendCallsign', e.target.checked)}
                  />
                }
                label="Append Callsign to Digipeated Frames"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={getChannelSetting('idOnRepeat', false)}
                    onChange={(e) => updateChannelSetting(channel.id, 'idOnRepeat', e.target.checked)}
                  />
                }
                label="ID on Repeat"
              />
              {/* Winlink per-channel enablement moved to Winlink settings UI */}
            </Box>
          </Paper>
        </Box>
      </DialogContent>
      
      <DialogActions>
        <Button onClick={onClose} variant="contained">
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
function BeaconStatus({ backend }) {
  const [beaconStatus, setBeaconStatus] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchBeaconStatus = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.get(`${backend}/api/digipeater/beacons/status`);
      setBeaconStatus(response.data || {});
    } catch (err) {
      console.error('Error fetching beacon status:', err);
      setError('Failed to fetch beacon status');
      setBeaconStatus({});
    } finally {
      setLoading(false);
    }
  };

  const triggerBeacon = async (channelId) => {
    try {
      await axios.post(`${backend}/api/digipeater/beacons/trigger/${channelId}`);
      // Refresh status after triggering
      setTimeout(fetchBeaconStatus, 1000);
    } catch (err) {
      console.error('Error triggering beacon:', err);
    }
  };

  useEffect(() => {
    fetchBeaconStatus();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchBeaconStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatTimeAgo = (timestamp) => {
    if (!timestamp) return 'Never';
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMin / 60);
    
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ${diffMin % 60}m ago`;
    return then.toLocaleDateString();
  };

  const formatNextBeacon = (timestamp) => {
    if (!timestamp) return 'Unknown';
    const now = new Date();
    const next = new Date(timestamp);
    const diffMs = next - now;
    const diffMin = Math.floor(diffMs / 60000);
    
    if (diffMs < 0) return 'Overdue';
    if (diffMin < 1) return 'Any moment';
    if (diffMin < 60) return `${diffMin}m`;
    return `${Math.floor(diffMin / 60)}h ${diffMin % 60}m`;
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <CircularProgress size={20} />
        <Typography variant="body2">Loading beacon status...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
        <Button size="small" onClick={fetchBeaconStatus} sx={{ ml: 1 }}>
          Retry
        </Button>
      </Alert>
    );
  }

  const beaconChannels = Object.keys(beaconStatus);

  if (beaconChannels.length === 0) {
    return (
      <Typography variant="body2" color="textSecondary">
        No beacons configured. Enable beacons in the per-channel settings above.
      </Typography>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="body2" color="textSecondary">
          Active beacon schedules ({beaconChannels.length} configured)
        </Typography>
        <Button size="small" onClick={fetchBeaconStatus}>
          Refresh
        </Button>
      </Box>
      
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {beaconChannels.map((channelId) => {
          const beacon = beaconStatus[channelId];
          return (
            <Card key={channelId} sx={{ minWidth: 280 }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="subtitle2" fontWeight="bold">
                    {channelId}
                  </Typography>
                  <Chip 
                    label={beacon.callsign} 
                    size="small" 
                    color="primary" 
                    variant="outlined"
                  />
                </Box>
                
                <Typography variant="body2" sx={{ mb: 1 }}>
                  <strong>Interval:</strong> {beacon.intervalMinutes} minutes
                </Typography>
                
                <Typography variant="body2" sx={{ mb: 1 }}>
                  <strong>Message:</strong> {beacon.message || 'No message set'}
                </Typography>
                
                <Typography variant="body2" sx={{ mb: 1 }}>
                  <strong>Last sent:</strong> {formatTimeAgo(beacon.lastSent)}
                </Typography>
                
                <Typography variant="body2" sx={{ mb: 2 }}>
                  <strong>Next beacon:</strong> {formatNextBeacon(beacon.nextBeacon)}
                </Typography>
                
                <Button 
                  size="small" 
                  variant="outlined" 
                  onClick={() => triggerBeacon(channelId)}
                  fullWidth
                >
                  Send Now
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </Box>
    </Box>
  );
}

export default function DigipeaterSettings({ setGlobalMessage }) {
  const [digipeaterEnabled, setDigipeaterEnabled] = useState(false);
  const [availableChannels, setAvailableChannels] = useState([]);
  const [channelSettings, setChannelSettings] = useState({});
  const [routes, setRoutes] = useState([]);
  const [nwsAlerts, setNwsAlerts] = useState({ enabled: false, pollIntervalSec: 900, sameCodes: [], alertPath: 'WIDE1-1', area: 'ALL', repeatExternalBulletins: false });
  const [seenCache, setSeenCache] = useState({ ttl: 5000, maxEntries: 1000 });
  const [digipeaterSettings, setDigipeaterSettings] = useState({ coordinates: { latitude: '', longitude: '' } });
  const [sameCodeOptions, setSameCodeOptions] = useState([]);
  const [sameCodesLoading, setSameCodesLoading] = useState(false);
  const [sameStates, setSameStates] = useState([]);
  const [saveMessage, setSaveMessage] = useState('');
  const [validationErrors, setValidationErrors] = useState({});
  const [maxNErrors, setMaxNErrors] = useState({});
  const [seenCacheErrors, setSeenCacheErrors] = useState({ ttl: '', maxEntries: '' });
  
  // Modal state
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState(null);

  const backend = `http://${location.hostname}:3000`;

  const openChannelConfig = (channel) => {
    setSelectedChannel(channel);
    setConfigModalOpen(true);
  };

  const closeChannelConfig = () => {
    setConfigModalOpen(false);
    setSelectedChannel(null);
  };

  useEffect(() => {
    fetchSettings();
    fetchChannels();
  }, []);

  useEffect(() => {
    const fetchStates = async () => {
      try {
        const resp = await axios.get(`${backend}/api/digipeater/same-states`);
        setSameStates(Array.isArray(resp.data) ? resp.data : []);
      } catch (e) {
        console.error('Failed to fetch SAME states:', e);
        setSameStates([]);
      }
    };
    fetchStates();
  }, []);

  useEffect(() => {
    // fetch SAME codes when area changes
    const area = (nwsAlerts && nwsAlerts.area) ? nwsAlerts.area : '';
    const fetchCodes = async () => {
      setSameCodesLoading(true);
      try {
        const url = `${backend}/api/digipeater/same-codes?area=${encodeURIComponent(area || '')}`;
        const resp = await axios.get(url);
        setSameCodeOptions(Array.isArray(resp.data) ? resp.data : []);
      } catch (e) {
        console.error('Failed to load SAME codes:', e);
        setSameCodeOptions([]);
      } finally {
        setSameCodesLoading(false);
      }
    };
    fetchCodes();
  }, [nwsAlerts.area]);

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
      const response = await axios.get(`${backend}/api/digipeater/settings`);
      setDigipeaterEnabled(response.data.enabled || false);
      setChannelSettings(response.data.channels || {});
      setRoutes(response.data.routes || []);
      setNwsAlerts(response.data.nwsAlerts || { enabled: false, pollIntervalSec: 900, sameCodes: [], alertPath: 'WIDE1-1', area: 'ALL' });
      
      // Load coordinates
      setDigipeaterSettings(prev => ({
        ...prev,
        coordinates: response.data.coordinates || { latitude: '', longitude: '' }
      }));
      
      // load seenCache defaults from backend if present
      if (response.data && response.data.seenCache && typeof response.data.seenCache === 'object') {
        const sc = response.data.seenCache;
        const ttl = Number.isFinite(Number(sc.ttl)) ? Number(sc.ttl) : 5000;
        const maxEntries = Number.isFinite(Number(sc.maxEntries)) ? Number(sc.maxEntries) : 1000;
        setSeenCache({ ttl: Math.max(1, ttl), maxEntries: Math.max(1, maxEntries) });
      }
    } catch (error) {
      console.error('Error fetching Digipeater settings:', error);
      // Set defaults if API doesn't exist yet
      setDigipeaterEnabled(false);
      setChannelSettings({});
      setRoutes([]);
    }
  };

  const updateChannelSetting = (channelId, setting, value) => {
    // For Max N ensure numeric normalization in UI state and update validation state
    if (setting === 'maxWideN') {
      let n = Number(value);
      if (!Number.isFinite(n) || isNaN(n)) {
        // store raw value to allow user editing but set an error
        setMaxNErrors(prev => ({ ...prev, [channelId]: 'Must be a number' }));
      } else if (n < 1 || n > 7) {
        setMaxNErrors(prev => ({ ...prev, [channelId]: 'Must be between 1 and 7' }));
      } else {
        // valid
        setMaxNErrors(prev => { const c = { ...prev }; delete c[channelId]; return c; });
      }
    }

    // Handle beacon settings with nested object structure
    if (setting.startsWith('beacon.')) {
      const beaconField = setting.replace('beacon.', '');
      setChannelSettings(prev => ({
        ...prev,
        [channelId]: {
          ...prev[channelId],
          beacon: {
            ...(prev[channelId]?.beacon || {}),
            [beaconField]: value
          }
        }
      }));
      return;
    }

    setChannelSettings(prev => ({
      ...prev,
      [channelId]: {
        ...prev[channelId],
        [setting]: value
      }
    }));
    
    // Clear validation error when user starts typing
    if (setting === 'callsign' && value.trim()) {
      setValidationErrors(prev => ({
        ...prev,
        [channelId]: { ...prev[channelId], callsign: false }
      }));
    }
  };

  const getChannelSetting = (channelId, setting, defaultValue) => {
    const ch = channelSettings[channelId];
    if (!ch) return defaultValue;
    
    // Handle beacon settings with nested object structure
    if (setting.startsWith('beacon.')) {
      const beaconField = setting.replace('beacon.', '');
      const beacon = ch.beacon || {};
      return Object.prototype.hasOwnProperty.call(beacon, beaconField) ? beacon[beaconField] : defaultValue;
    }
    
    // Return the stored value even if it's falsy (false should be honored)
    if (Object.prototype.hasOwnProperty.call(ch, setting)) return ch[setting];
    return defaultValue;
  };

  const addRoute = () => {
    setRoutes(prev => [...prev, { from: '', to: '' }]);
  };

  const updateRoute = (index, field, value) => {
    setRoutes(prev => prev.map((route, i) => 
      i === index ? { ...route, [field]: value } : route
    ));
  };

  const removeRoute = (index) => {
    setRoutes(prev => prev.filter((_, i) => i !== index));
  };

  const validateSettings = () => {
    const errors = {};
    let hasErrors = false;

    // Check each channel that has digipeater mode enabled
    availableChannels.forEach(channel => {
      const mode = getChannelSetting(channel.id, 'mode', 'digipeat');
      const callsign = getChannelSetting(channel.id, 'callsign', '').trim();
      
      if (mode === 'digipeat' && !callsign) {
        if (!errors[channel.id]) errors[channel.id] = {};
        errors[channel.id].callsign = true;
        hasErrors = true;
      }
    });

    setValidationErrors(errors);
    return !hasErrors;
  };

  const handleSave = async () => {
    if (!validateSettings()) {
      const err = 'Error: Callsign is required for all channels with Digipeat mode enabled.';
      setSaveMessage(err);
      if (typeof setGlobalMessage === 'function') setGlobalMessage(err);
      setTimeout(() => { setSaveMessage(''); if (typeof setGlobalMessage === 'function') setGlobalMessage(''); }, 5000);
      return;
    }

    try {
      // Normalize per-channel settings before sending to backend.
      // Ensure role defaults and maxWideN is a finite number clamped to [1,7].
      const normalizedChannels = {};
      Object.keys(channelSettings || {}).forEach((chid) => {
        const src = channelSettings[chid] || {};
        const mode = src.mode || 'digipeat';
        const role = (typeof src.role === 'string' && src.role) ? String(src.role) : 'wide';
        let maxWideN = Number.isFinite(Number(src.maxWideN)) ? Number(src.maxWideN) : 2;
        if (!Number.isFinite(maxWideN) || isNaN(maxWideN)) maxWideN = 2;
        // clamp to sensible bounds
        if (maxWideN < 1) maxWideN = 1;
        if (maxWideN > 7) maxWideN = 7;
        // keep other known flags through
        normalizedChannels[chid] = Object.assign({}, src, { role, maxWideN });
      });

      const settings = {
        enabled: digipeaterEnabled,
        coordinates: digipeaterSettings.coordinates,
        channels: normalizedChannels,
        routes: routes.filter(route => route.from && route.to),
        nwsAlerts,
        seenCache,
        metricsThresholds,
        metricsCheckIntervalSec
      };

  await axios.post(`${backend}/api/digipeater/settings`, settings);
  const msg = 'Digipeater settings saved successfully!';
  setSaveMessage(msg);
  if (typeof setGlobalMessage === 'function') setGlobalMessage(msg);
  setTimeout(() => { setSaveMessage(''); if (typeof setGlobalMessage === 'function') setGlobalMessage(''); }, 3000);
    } catch (error) {
  console.error('Error saving Digipeater settings:', error);
  const em = 'Error saving settings. Please try again.';
  setSaveMessage(em);
  if (typeof setGlobalMessage === 'function') setGlobalMessage(em);
  setTimeout(() => { setSaveMessage(''); if (typeof setGlobalMessage === 'function') setGlobalMessage(''); }, 3000);
    }
  };

  const updateNwsField = (field, value) => {
    setNwsAlerts(prev => ({ ...prev, [field]: value }));
  };

  const updateSeenCacheField = (field, value) => {
    // allow raw input but coerce for validation
    setSeenCache(prev => ({ ...prev, [field]: value }));

    // validate quickly
    if (field === 'ttl') {
      const n = Number(value);
      if (!Number.isFinite(n) || isNaN(n) || n < 1) {
        setSeenCacheErrors(prev => ({ ...prev, ttl: 'Must be a positive integer (ms)' }));
      } else if (n > 600000) {
        setSeenCacheErrors(prev => ({ ...prev, ttl: 'Unusually large value; max 600000ms recommended' }));
      } else {
        setSeenCacheErrors(prev => ({ ...prev, ttl: '' }));
      }
    }
    if (field === 'maxEntries') {
      const n = Number(value);
      if (!Number.isFinite(n) || isNaN(n) || n < 1) {
        setSeenCacheErrors(prev => ({ ...prev, maxEntries: 'Must be a positive integer' }));
      } else if (n > 1000000) {
        setSeenCacheErrors(prev => ({ ...prev, maxEntries: 'Too large; keep under 1,000,000' }));
      } else {
        setSeenCacheErrors(prev => ({ ...prev, maxEntries: '' }));
      }
    }
  };

  // Metrics UI state & fetch
  const [metrics, setMetrics] = useState(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [autoRefreshMetrics, setAutoRefreshMetrics] = useState(false);
  const [metricAlerts, setMetricAlerts] = useState([]);
  const [metricsThresholds, setMetricsThresholds] = useState({ servicedWideBlocked: 10, maxWideBlocked: 10 });
  const [metricsCheckIntervalSec, setMetricsCheckIntervalSec] = useState(60);
  const [alertsLoading, setAlertsLoading] = useState(false);

  const fetchMetrics = async () => {
    setMetricsLoading(true);
    try {
      const resp = await axios.get(`${backend}/api/digipeater/metrics`);
      setMetrics(resp.data || null);
    } catch (e) {
      console.error('Failed to fetch metrics', e);
      setMetrics(null);
    } finally {
      setMetricsLoading(false);
    }
  };

  useEffect(() => {
    let t;
    if (autoRefreshMetrics) {
      fetchMetrics();
      t = setInterval(fetchMetrics, 5000);
    }
    return () => { if (t) clearInterval(t); };
  }, [autoRefreshMetrics]);

  const metricStatus = (metricName, value) => {
    const thresh = metricsThresholds && metricsThresholds[metricName] ? Number(metricsThresholds[metricName]) : null;
    if (thresh === null || thresh === undefined || isNaN(thresh)) return 'default';
    if (value >= thresh) return 'error';
    if (value >= Math.floor(thresh / 2)) return 'warning';
    return 'success';
  };

  const metricTooltip = (metricName, value) => {
    const thresh = metricsThresholds && metricsThresholds[metricName] ? Number(metricsThresholds[metricName]) : null;
    if (thresh === null || thresh === undefined || isNaN(thresh)) return `${value}`;
    const pct = Math.round((Number(value) / thresh) * 100);
    return `${value} / ${thresh} (${pct}% of threshold)`;
  };

  const seenStatus = (size, maxEntries) => {
    const max = Number(maxEntries) || null;
    if (!max) return 'default';
    if (size >= max) return 'error';
    if (size >= Math.floor(max * 0.8)) return 'warning';
    return 'success';
  };

  const fetchMetricAlerts = async () => {
    setAlertsLoading(true);
    try {
      const resp = await axios.get(`${backend}/api/digipeater/metric-alerts`);
      setMetricAlerts(Array.isArray(resp.data) ? resp.data : []);
    } catch (e) {
      console.error('Failed to fetch metric alerts', e);
      setMetricAlerts([]);
    } finally {
      setAlertsLoading(false);
    }
  };

  const clearMetricAlerts = async () => {
    try {
      await axios.post(`${backend}/api/digipeater/metric-alerts/clear`);
      setMetricAlerts([]);
    } catch (e) {
      console.error('Failed to clear metric alerts', e);
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5" gutterBottom>
        Digipeater Settings
      </Typography>
      
      {saveMessage && (
        <Alert severity={saveMessage.includes('Error') ? 'error' : 'success'} sx={{ mb: 2 }}>
          {saveMessage}
        </Alert>
      )}

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Global Settings
        </Typography>
        
        <Box sx={{ mb: 3 }}>
          <FormControlLabel
            control={
              <Switch
                checked={digipeaterEnabled}
                onChange={(e) => setDigipeaterEnabled(e.target.checked)}
              />
            }
            label="Enable Digipeater"
          />
          <Typography variant="body2" color="textSecondary" sx={{ ml: 4, mt: 1 }}>
            Master switch for all digipeating operations
          </Typography>
        </Box>
        {/* Seen-cache tuning moved into Global Settings */}
        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle1" gutterBottom>Seen-cache tuning</Typography>
        <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
          Tune how long AX.25 frames are remembered (ms) and maximum number of entries kept in the seen-cache. Adjusting these can help control duplicate digipeating behavior and memory usage.
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 1 }}>
          <TextField
            label="Seen Cache TTL (ms)"
            type="number"
            size="small"
            value={seenCache.ttl}
            onChange={(e) => updateSeenCacheField('ttl', Number(e.target.value))}
            sx={{ width: 180 }}
            inputProps={{ min: 1 }}
            error={!!seenCacheErrors.ttl}
            helperText={seenCacheErrors.ttl || 'Milliseconds to remember frames (default 5000)'}
          />

          <TextField
            label="Seen Cache Max Entries"
            type="number"
            size="small"
            value={seenCache.maxEntries}
            onChange={(e) => updateSeenCacheField('maxEntries', Number(e.target.value))}
            sx={{ width: 220 }}
            inputProps={{ min: 1 }}
            error={!!seenCacheErrors.maxEntries}
            helperText={seenCacheErrors.maxEntries || 'Max entries kept in-memory (default 1000)'}
          />
        </Box>

        {/* Coordinates Section */}
        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle1" gutterBottom>Position Coordinates</Typography>
        <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
          Set the digipeater's coordinates for position beacons. Leave empty for status-only beacons.
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 1 }}>
          <TextField
            label="Latitude (decimal degrees)"
            size="small"
            value={digipeaterSettings.coordinates?.latitude || ''}
            onChange={(e) => setDigipeaterSettings(prev => ({
              ...prev,
              coordinates: {
                ...prev.coordinates,
                latitude: e.target.value
              }
            }))}
            placeholder="e.g., 35.7796"
            sx={{ width: 200 }}
            helperText="Positive for North, negative for South"
          />

          <TextField
            label="Longitude (decimal degrees)"
            size="small"
            value={digipeaterSettings.coordinates?.longitude || ''}
            onChange={(e) => setDigipeaterSettings(prev => ({
              ...prev,
              coordinates: {
                ...prev.coordinates,
                longitude: e.target.value
              }
            }))}
            placeholder="e.g., -78.6382"
            sx={{ width: 200 }}
            helperText="Positive for East, negative for West"
          />
        </Box>
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Per-Channel Settings
        </Typography>
        
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Channel</TableCell>
                <TableCell>Mode</TableCell>
                <TableCell>Callsign</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Beacon</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {availableChannels.map((channel) => (
                <TableRow key={channel.id}>
                  <TableCell>
                    <Typography variant="body2" fontWeight="bold">
                      {channel.name}
                    </Typography>
                    <Typography variant="caption" color="textSecondary">
                      {channel.id}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={getChannelSetting(channel.id, 'mode', 'digipeat')}
                      onChange={(e) => updateChannelSetting(channel.id, 'mode', e.target.value)}
                      size="small"
                      sx={{ minWidth: 120 }}
                    >
                      <MenuItem value="digipeat">Digipeat</MenuItem>
                      <MenuItem value="receive-only">Receive Only</MenuItem>
                      <MenuItem value="disabled">Disabled</MenuItem>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <TextField
                      value={getChannelSetting(channel.id, 'callsign', '')}
                      onChange={(e) => updateChannelSetting(channel.id, 'callsign', e.target.value)}
                      placeholder="Required for digipeat"
                      size="small"
                      sx={{ width: '140px' }}
                      error={!!(validationErrors[channel.id] && validationErrors[channel.id].callsign)}
                      helperText={validationErrors[channel.id] && validationErrors[channel.id].callsign ? "Required" : ""}
                      required={getChannelSetting(channel.id, 'mode', 'digipeat') === 'digipeat'}
                    />
                  </TableCell>
                  <TableCell>
                    <Chip 
                      label={getChannelSetting(channel.id, 'role', 'wide') === 'fill-in' ? 'Fill-in' : 'Wide'} 
                      size="small" 
                      color={getChannelSetting(channel.id, 'role', 'wide') === 'fill-in' ? 'secondary' : 'primary'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    {getChannelSetting(channel.id, 'beacon.enabled', false) ? (
                      <Chip 
                        label={`${getChannelSetting(channel.id, 'beacon.intervalMinutes', 15)}min`} 
                        size="small" 
                        color="success"
                      />
                    ) : (
                      <Chip 
                        label="Disabled" 
                        size="small" 
                        variant="outlined"
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<SettingsIcon />}
                      onClick={() => openChannelConfig(channel)}
                    >
                      Configure
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Beacon Status
        </Typography>
        <BeaconStatus backend={backend} />
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Digipeating Routes
        </Typography>
        <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
          Configure which channels should forward packets to other channels
        </Typography>
        
        {routes.map((route, index) => (
          <Box key={index} sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
            <FormControl sx={{ minWidth: 200 }}>
              <InputLabel>From Channel</InputLabel>
              <Select
                value={route.from}
                onChange={(e) => updateRoute(index, 'from', e.target.value)}
                label="From Channel"
              >
                {availableChannels.map(channel => (
                  <MenuItem key={channel.id} value={channel.id}>
                    {channel.name} ({channel.id})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            
            <Typography variant="body1">→</Typography>
            
            <FormControl sx={{ minWidth: 200 }}>
              <InputLabel>To Channel</InputLabel>
              <Select
                value={route.to}
                onChange={(e) => updateRoute(index, 'to', e.target.value)}
                label="To Channel"
              >
                {availableChannels.map(channel => (
                  <MenuItem key={channel.id} value={channel.id}>
                    {channel.name} ({channel.id})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            
            <Button 
              variant="outlined" 
              color="error" 
              onClick={() => removeRoute(index)}
              size="small"
            >
              Remove
            </Button>
          </Box>
        ))}
        
        <Button variant="outlined" onClick={addRoute} sx={{ mt: 1 }}>
          Add Route
        </Button>
      </Paper>

      {/* Save button moved below Weather Alerts */}

  <Paper sx={{ p: 3, mb: 0 }} elevation={2}>
        <Typography variant="h6" gutterBottom>Digipeater Metrics & Alerts</Typography>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Box>
            <FormControlLabel
              control={<Switch checked={autoRefreshMetrics} onChange={(e) => setAutoRefreshMetrics(e.target.checked)} />}
              label="Auto-refresh"
            />
            <Button size="small" onClick={fetchMetrics} disabled={metricsLoading} sx={{ ml: 1 }}>Refresh</Button>
          </Box>
          <Box>
            <Button size="small" onClick={fetchMetricAlerts} sx={{ mr: 1 }}>Refresh Alerts</Button>
            <Button size="small" color="error" onClick={clearMetricAlerts}>Clear Alerts</Button>
          </Box>
        </Box>
        <Divider sx={{ mb: 2 }} />
        {!metrics && !metricsLoading && (
          <Typography variant="body2" color="textSecondary">No metrics available. Click Refresh to fetch.</Typography>
        )}
        {metricsLoading && <Typography variant="body2">Loading metrics...</Typography>}
        {metrics && (
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mt: 1 }}>
            <Box sx={{ display: 'flex', gap: 2, flexDirection: 'column' }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Typography variant="body2">servicedWideBlocked:</Typography>
                <Typography variant="body2"><strong>{metrics.metrics && metrics.metrics.servicedWideBlocked ? metrics.metrics.servicedWideBlocked : 0}</strong></Typography>
                <Tooltip title={metricTooltip('servicedWideBlocked', metrics.metrics && metrics.metrics.servicedWideBlocked ? metrics.metrics.servicedWideBlocked : 0)}>
                  <Chip size="small" color={metricStatus('servicedWideBlocked', metrics.metrics && metrics.metrics.servicedWideBlocked ? metrics.metrics.servicedWideBlocked : 0)} label="" sx={{ width: 12, height: 12, borderRadius: '50%' }} />
                </Tooltip>
              </Box>

              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Typography variant="body2">maxWideBlocked:</Typography>
                <Typography variant="body2"><strong>{metrics.metrics && metrics.metrics.maxWideBlocked ? metrics.metrics.maxWideBlocked : 0}</strong></Typography>
                <Tooltip title={metricTooltip('maxWideBlocked', metrics.metrics && metrics.metrics.maxWideBlocked ? metrics.metrics.maxWideBlocked : 0)}>
                  <Chip size="small" color={metricStatus('maxWideBlocked', metrics.metrics && metrics.metrics.maxWideBlocked ? metrics.metrics.maxWideBlocked : 0)} label="" sx={{ width: 12, height: 12, borderRadius: '50%' }} />
                </Tooltip>
              </Box>

              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Typography variant="body2">seen.size:</Typography>
                <Typography variant="body2"><strong>{metrics.seen && metrics.seen.size ? metrics.seen.size : 0}</strong></Typography>
                <Tooltip title={`Seen entries: ${metrics.seen && metrics.seen.size ? metrics.seen.size : 0} — limit: ${metrics.seen && metrics.seen.maxEntries ? metrics.seen.maxEntries : seenCache.maxEntries}`}>
                  <Chip size="small" color={seenStatus(metrics.seen && metrics.seen.size ? metrics.seen.size : 0, metrics.seen && metrics.seen.maxEntries ? metrics.seen.maxEntries : seenCache.maxEntries)} label="" sx={{ width: 12, height: 12, borderRadius: '50%' }} />
                </Tooltip>
              </Box>

              <Typography variant="body2">SEEN_TTL: <strong>{metrics.seen && metrics.seen.ttl ? metrics.seen.ttl : '-'}</strong></Typography>
              <Typography variant="body2">MAX_SEEN_ENTRIES: <strong>{metrics.seen && metrics.seen.maxEntries ? metrics.seen.maxEntries : (seenCache && seenCache.maxEntries ? seenCache.maxEntries : '-')}</strong></Typography>

              <Box sx={{ mt: 1, display: 'flex', gap: 1, alignItems: 'center' }}>
                <Chip size="small" label="OK" color="success" />
                <Typography variant="caption" color="textSecondary">&nbsp; &nbsp;</Typography>
                <Chip size="small" label="Warn" color="warning" />
                <Typography variant="caption" color="textSecondary">&nbsp; &nbsp;</Typography>
                <Chip size="small" label="Alert" color="error" />
              </Box>
            </Box>
          </Box>
        )}

        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle1">Metric thresholds</Typography>
        <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>Set thresholds (when exceeded an alert will be recorded). Values are per-check and an alert is created when the value increases past the threshold.</Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
          <TextField label="servicedWideBlocked" type="number" size="small" value={metricsThresholds.servicedWideBlocked} onChange={(e) => setMetricsThresholds(prev => ({ ...prev, servicedWideBlocked: Number(e.target.value) }))} sx={{ width: 180 }} />
          <TextField label="maxWideBlocked" type="number" size="small" value={metricsThresholds.maxWideBlocked} onChange={(e) => setMetricsThresholds(prev => ({ ...prev, maxWideBlocked: Number(e.target.value) }))} sx={{ width: 180 }} />
          <TextField label="Check Interval (sec)" type="number" size="small" value={metricsCheckIntervalSec} onChange={(e) => setMetricsCheckIntervalSec(Number(e.target.value))} sx={{ width: 180 }} />
        </Box>

        <Divider sx={{ my: 2 }} />
        {alertsLoading && <Typography variant="body2">Loading alerts...</Typography>}
        {!alertsLoading && metricAlerts.length === 0 && <Typography variant="body2" color="textSecondary">No recent metric alerts.</Typography>}
        {metricAlerts.map((a, idx) => (
          <Paper key={idx} sx={{ p: 1, mb: 1, backgroundColor: '#fff6f6' }}>
            <Typography variant="body2"><strong>{a.metric}</strong> = {a.value} (threshold {a.threshold})</Typography>
            <Typography variant="caption" color="textSecondary">{new Date(a.ts).toLocaleString()} — {a.message}</Typography>
          </Paper>
        ))}
      </Paper>

  <Paper sx={{ p: 3, mt: 4 }} elevation={1}>
        <Typography variant="h6" gutterBottom>
          Weather Alerts (NWS)
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
          <FormControlLabel
            control={<Switch checked={nwsAlerts.enabled} onChange={(e) => updateNwsField('enabled', e.target.checked)} />}
            label="Enable NWS Alerts"
          />
          <FormControlLabel
            control={<Switch checked={nwsAlerts.repeatExternalBulletins} onChange={(e) => updateNwsField('repeatExternalBulletins', e.target.checked)} />}
            label="Repeat External Bulletins"
          />
          <TextField label="Poll Interval (sec)" type="number" size="small" value={nwsAlerts.pollIntervalSec} onChange={(e) => updateNwsField('pollIntervalSec', Number(e.target.value))} sx={{ width: 140 }} />
          <TextField label="Alert Path" size="small" value={nwsAlerts.alertPath} onChange={(e) => updateNwsField('alertPath', e.target.value)} sx={{ width: 160 }} />
          <FormControl sx={{ minWidth: 120 }} size="small">
            <InputLabel>Area</InputLabel>
            <Select value={nwsAlerts.area || 'ALL'} label="Area" onChange={(e) => updateNwsField('area', e.target.value)}>
              <MenuItem value="ALL">All</MenuItem>
              {sameStates.map(s => (
                <MenuItem key={s} value={s}>{s}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
        <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>SAME Codes:</Typography>
        <Autocomplete
          multiple
          freeSolo
          options={sameCodeOptions}
          getOptionLabel={(option) => (typeof option === 'string' ? option : `${option.code} — ${option.label}`)}
          value={(nwsAlerts.sameCodes || []).map(code => {
            const match = sameCodeOptions.find(o => o.code === code);
            return match ? match : code;
          })}
          onChange={(event, newValue) => {
            // newValue may contain strings (freeSolo) or option objects
            const codes = [];
            for (const v of newValue) {
              if (!v) continue;
              if (typeof v === 'string') {
                const m = String(v).match(/(\d{6})/);
                if (m) codes.push(m[1]);
              } else if (v.code) {
                codes.push(String(v.code));
              }
            }
            // dedupe
            const uniq = Array.from(new Set(codes));
            updateNwsField('sameCodes', uniq);
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              size="small"
              placeholder="Select SAME codes or type code(s)"
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {sameCodesLoading ? <CircularProgress color="inherit" size={16} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          )}
        />
        
      </Paper>

      <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!digipeaterEnabled || !!seenCacheErrors.ttl || !!seenCacheErrors.maxEntries}
        >
          Save Settings
        </Button>
      </Box>

      {/* Channel Configuration Modal */}
      <ChannelConfigModal
        open={configModalOpen}
        onClose={closeChannelConfig}
        channel={selectedChannel}
        channelSettings={channelSettings}
        updateChannelSetting={updateChannelSetting}
        maxNErrors={maxNErrors}
      />
    </Box>
  );
}