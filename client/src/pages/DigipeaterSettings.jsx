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
} from '@mui/material';
import axios from 'axios';

export default function DigipeaterSettings({ setGlobalMessage }) {
  const [digipeaterEnabled, setDigipeaterEnabled] = useState(false);
  const [availableChannels, setAvailableChannels] = useState([]);
  const [channelSettings, setChannelSettings] = useState({});
  const [routes, setRoutes] = useState([]);
  const [nwsAlerts, setNwsAlerts] = useState({ enabled: false, pollIntervalSec: 900, sameCodes: [], alertPath: 'WIDE1-1', area: 'ALL', repeatExternalBulletins: false });
  const [seenCache, setSeenCache] = useState({ ttl: 5000, maxEntries: 1000 });
  const [sameCodeOptions, setSameCodeOptions] = useState([]);
  const [sameCodesLoading, setSameCodesLoading] = useState(false);
  const [sameStates, setSameStates] = useState([]);
  const [saveMessage, setSaveMessage] = useState('');
  const [validationErrors, setValidationErrors] = useState({});
  const [maxNErrors, setMaxNErrors] = useState({});
  const [seenCacheErrors, setSeenCacheErrors] = useState({ ttl: '', maxEntries: '' });

  const backend = `http://${location.hostname}:3000`;

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
                <TableCell>Role</TableCell>
                <TableCell>Max N</TableCell>
                <TableCell>Callsign</TableCell>
                <TableCell>IGate Forward</TableCell>
                <TableCell>Options</TableCell>
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
                    >
                      <MenuItem value="digipeat">Digipeat</MenuItem>
                      <MenuItem value="receive-only">Receive Only</MenuItem>
                      <MenuItem value="disabled">Disabled</MenuItem>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Tooltip title="Choose how this channel services WIDE path entries: 'Fill-in' handles WIDE1 entries (local fill-in), 'Wide' handles WIDE2+ entries (regional).">
                      <FormControl size="small">
                        <Select
                          value={getChannelSetting(channel.id, 'role', 'wide')}
                          onChange={(e) => updateChannelSetting(channel.id, 'role', e.target.value)}
                          size="small"
                        >
                          <MenuItem value="fill-in">Fill-in (WIDE1-*)</MenuItem>
                          <MenuItem value="wide">Wide (WIDE2+)</MenuItem>
                        </Select>
                      </FormControl>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Tooltip title="Maximum WIDE hop number this channel will service (1-7). Use lower numbers to limit propagation).">
                      <TextField
                        type="number"
                        value={getChannelSetting(channel.id, 'maxWideN', 2)}
                        onChange={(e) => updateChannelSetting(channel.id, 'maxWideN', e.target.value)}
                        size="small"
                        sx={{ width: '110px' }}
                        inputProps={{ min: 1, max: 7 }}
                        error={!!maxNErrors[channel.id]}
                        helperText={maxNErrors[channel.id] || '1-7 (default 2)'}
                      />
                    </Tooltip>
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
                    <Switch
                      checked={getChannelSetting(channel.id, 'igateForward', false)}
                      onChange={(e) => updateChannelSetting(channel.id, 'igateForward', e.target.checked)}
                    />
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={getChannelSetting(channel.id, 'appendCallsign', true)}
                            onChange={(e) => updateChannelSetting(channel.id, 'appendCallsign', e.target.checked)}
                            size="small"
                          />
                        }
                        label={<Typography variant="caption">Append ID</Typography>}
                      />
                      <FormControlLabel
                        control={
                          <Switch
                            checked={getChannelSetting(channel.id, 'idOnRepeat', false)}
                            onChange={(e) => updateChannelSetting(channel.id, 'idOnRepeat', e.target.checked)}
                            size="small"
                          />
                        }
                        label={<Typography variant="caption">ID on Repeat</Typography>}
                      />
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
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
    </Box>
  );
}