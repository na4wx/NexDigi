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

export default function DigipeaterSettings() {
  const [digipeaterEnabled, setDigipeaterEnabled] = useState(false);
  const [availableChannels, setAvailableChannels] = useState([]);
  const [channelSettings, setChannelSettings] = useState({});
  const [routes, setRoutes] = useState([]);
  const [nwsAlerts, setNwsAlerts] = useState({ enabled: false, pollIntervalSec: 900, sameCodes: [], alertPath: 'WIDE1-1', area: 'ALL', repeatExternalBulletins: false });
  const [sameCodeOptions, setSameCodeOptions] = useState([]);
  const [sameCodesLoading, setSameCodesLoading] = useState(false);
  const [sameStates, setSameStates] = useState([]);
  const [saveMessage, setSaveMessage] = useState('');
  const [validationErrors, setValidationErrors] = useState({});

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
    } catch (error) {
      console.error('Error fetching Digipeater settings:', error);
      // Set defaults if API doesn't exist yet
      setDigipeaterEnabled(false);
      setChannelSettings({});
      setRoutes([]);
    }
  };

  const updateChannelSetting = (channelId, setting, value) => {
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
      setSaveMessage('Error: Callsign is required for all channels with Digipeat mode enabled.');
      setTimeout(() => setSaveMessage(''), 5000);
      return;
    }

    try {
      const settings = {
        enabled: digipeaterEnabled,
        channels: channelSettings,
        routes: routes.filter(route => route.from && route.to)
        , nwsAlerts
      };

      await axios.post(`${backend}/api/digipeater/settings`, settings);
      setSaveMessage('Digipeater settings saved successfully!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      console.error('Error saving Digipeater settings:', error);
      setSaveMessage('Error saving settings. Please try again.');
      setTimeout(() => setSaveMessage(''), 3000);
    }
  };

  const updateNwsField = (field, value) => {
    setNwsAlerts(prev => ({ ...prev, [field]: value }));
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

      <Box sx={{ display: 'flex', gap: 2 }}>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!digipeaterEnabled}
        >
          Save Settings
        </Button>
        <Button
          variant="outlined"
          onClick={() => {
            fetchSettings();
            setSaveMessage('');
          }}
        >
          Reset
        </Button>
      </Box>

      <Paper sx={{ p: 3, mt: 3 }}>
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
    </Box>
  );
}