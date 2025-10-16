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
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import axios from 'axios';

export default function NexNetSettings() {
  const [config, setConfig] = useState(null);
  const [saveMessage, setSaveMessage] = useState('');
  const [availableChannels, setAvailableChannels] = useState([]);
  const [peerDialog, setPeerDialog] = useState(false);
  const [hubDialog, setHubDialog] = useState(false);
  const [trustedNodeDialog, setTrustedNodeDialog] = useState(false);
  const [newPeer, setNewPeer] = useState({ host: '', port: 14240, callsign: '' });
  const [newHub, setNewHub] = useState({ host: '', port: 14240, callsign: '' });
  const [newTrustedNode, setNewTrustedNode] = useState({ callsign: '', publicKey: '' });
  const [publicKey, setPublicKey] = useState(null);
  const [keyGenLoading, setKeyGenLoading] = useState(false);

  const backend = `http://${location.hostname}:3000`;

  useEffect(() => {
    fetchSettings();
    fetchChannels();
    fetchPublicKey();
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
      const response = await axios.get(`${backend}/api/backbone/config`);
      setConfig(response.data);
    } catch (error) {
      console.error('Error fetching NexNet settings:', error);
    }
  };

  const fetchPublicKey = async () => {
    try {
      const response = await axios.get(`${backend}/api/nexnet/security/public-key`);
      setPublicKey(response.data.publicKey);
    } catch (error) {
      console.error('Error fetching public key:', error);
    }
  };

  const generateKeys = async () => {
    if (!confirm('Generate new security keys? This will invalidate existing trusted node connections.')) {
      return;
    }
    
    setKeyGenLoading(true);
    try {
      const response = await axios.post(`${backend}/api/nexnet/security/generate-keys`);
      setPublicKey(response.data.publicKey);
      setSaveMessage('New security keys generated successfully!');
      setTimeout(() => setSaveMessage(''), 5000);
    } catch (error) {
      console.error('Error generating keys:', error);
      setSaveMessage('Error generating keys. Please try again.');
      setTimeout(() => setSaveMessage(''), 5000);
    } finally {
      setKeyGenLoading(false);
    }
  };

  const saveSettings = async () => {
    try {
      await axios.post(`${backend}/api/backbone/config`, config);
      setSaveMessage('Settings saved successfully! Please restart the server to apply changes.');
      setTimeout(() => setSaveMessage(''), 5000);
    } catch (error) {
      console.error('Error saving backbone settings:', error);
      setSaveMessage('Error saving settings. Please try again.');
      setTimeout(() => setSaveMessage(''), 5000);
    }
  };

  const handleModeChange = (mode) => {
    setConfig({
      ...config,
      transports: {
        ...config.transports,
        internet: {
          ...config.transports.internet,
          mode: mode
        }
      }
    });
  };

  const addPeer = () => {
    if (!newPeer.host || !newPeer.callsign) {
      alert('Please fill in all peer fields');
      return;
    }

    const peers = config.transports.internet.peers || [];
    setConfig({
      ...config,
      transports: {
        ...config.transports,
        internet: {
          ...config.transports.internet,
          peers: [...peers, { ...newPeer, port: Number(newPeer.port) }]
        }
      }
    });
    
    setNewPeer({ host: '', port: 14240, callsign: '' });
    setPeerDialog(false);
  };

  const removePeer = (index) => {
    const peers = [...config.transports.internet.peers];
    peers.splice(index, 1);
    setConfig({
      ...config,
      transports: {
        ...config.transports,
        internet: {
          ...config.transports.internet,
          peers
        }
      }
    });
  };

  const addFallbackHub = () => {
    if (!newHub.host || !newHub.callsign) {
      alert('Please fill in all hub fields');
      return;
    }

    const servers = config.transports.internet.hubServers?.servers || [];
    setConfig({
      ...config,
      transports: {
        ...config.transports,
        internet: {
          ...config.transports.internet,
          hubServers: {
            servers: [...servers, { ...newHub, port: Number(newHub.port) }]
          }
        }
      }
    });
    
    setNewHub({ host: '', port: 14240, callsign: '' });
    setHubDialog(false);
  };

  const removeFallbackHub = (index) => {
    const servers = [...config.transports.internet.hubServers.servers];
    servers.splice(index, 1);
    setConfig({
      ...config,
      transports: {
        ...config.transports,
        internet: {
          ...config.transports.internet,
          hubServers: { servers }
        }
      }
    });
  };

  const addTrustedNode = () => {
    if (!newTrustedNode.callsign || !newTrustedNode.publicKey) {
      alert('Please fill in all trusted node fields');
      return;
    }

    const trustedNodes = config.security?.trustedNodes || [];
    setConfig({
      ...config,
      security: {
        ...config.security,
        trustedNodes: [...trustedNodes, { ...newTrustedNode }]
      }
    });
    
    setNewTrustedNode({ callsign: '', publicKey: '' });
    setTrustedNodeDialog(false);
  };

  const removeTrustedNode = (index) => {
    const trustedNodes = [...config.security.trustedNodes];
    trustedNodes.splice(index, 1);
    setConfig({
      ...config,
      security: {
        ...config.security,
        trustedNodes
      }
    });
  };

  if (!config) {
    return (
      <Box sx={{ padding: '2rem' }}>
        <Typography>Loading...</Typography>
      </Box>
    );
  }

  const mode = config.transports?.internet?.mode || 'mesh';

  return (
    <Box sx={{ padding: '2rem' }}>
      <Typography variant="h4" gutterBottom>
        NexNet Settings
      </Typography>

      {saveMessage && (
        <Alert severity={saveMessage.includes('Error') ? 'error' : 'success'} sx={{ mb: 2 }}>
          {saveMessage}
        </Alert>
      )}

      {/* Basic Settings */}
      <Paper sx={{ padding: '2rem', marginBottom: '2rem' }}>
        <Typography variant="h6" gutterBottom>
          Basic Configuration
        </Typography>
        
        <FormControlLabel
          control={
            <Switch
              checked={config.enabled || false}
              onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
            />
          }
          label="Enable NexNet"
          sx={{ marginBottom: '1rem' }}
        />

        <TextField
          fullWidth
          label="Local Callsign"
          value={config.localCallsign || ''}
          onChange={(e) => setConfig({ ...config, localCallsign: e.target.value.toUpperCase() })}
          sx={{ marginBottom: '1rem' }}
          helperText="Your callsign with SSID (e.g., W1ABC-10)"
        />

        <FormControl fullWidth sx={{ marginBottom: '1rem' }}>
          <InputLabel>Services to Offer</InputLabel>
          <Select
            multiple
            value={config.services?.offer || []}
            onChange={(e) => setConfig({
              ...config,
              services: { ...config.services, offer: e.target.value }
            })}
            input={<OutlinedInput label="Services to Offer" />}
            renderValue={(selected) => (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {selected.map((value) => (
                  <Chip key={value} label={value} size="small" />
                ))}
              </Box>
            )}
          >
            <MenuItem value="bbs">BBS</MenuItem>
            <MenuItem value="winlink-cms">Winlink CMS Gateway</MenuItem>
            <MenuItem value="aprs-is">APRS-IS Gateway</MenuItem>
            <MenuItem value="weather">Weather Data</MenuItem>
            <MenuItem value="time">Time Services</MenuItem>
          </Select>
        </FormControl>
      </Paper>

      {/* Internet Transport Mode */}
      <Paper sx={{ padding: '2rem', marginBottom: '2rem' }}>
        <Typography variant="h6" gutterBottom>
          Internet Transport Mode
        </Typography>

        <FormControlLabel
          control={
            <Switch
              checked={config.transports?.internet?.enabled || false}
              onChange={(e) => setConfig({
                ...config,
                transports: {
                  ...config.transports,
                  internet: { ...config.transports.internet, enabled: e.target.checked }
                }
              })}
            />
          }
          label="Enable Internet Transport"
          sx={{ marginBottom: '1rem' }}
        />

        <FormControl fullWidth sx={{ marginBottom: '1rem' }}>
          <InputLabel>Operating Mode</InputLabel>
          <Select
            value={mode}
            onChange={(e) => handleModeChange(e.target.value)}
            label="Operating Mode"
          >
            <MenuItem value="mesh">🔗 Mesh (Peer-to-Peer)</MenuItem>
            <MenuItem value="client">📡 Client (Connect to Hub)</MenuItem>
            <MenuItem value="server">🌐 Server (Hub - Host Clients)</MenuItem>
          </Select>
        </FormControl>

        <Alert severity="info" sx={{ mb: 2 }}>
          {mode === 'mesh' && '🔗 Mesh mode: Connect directly to configured peers. Best for experienced operators with public IPs.'}
          {mode === 'client' && '📡 Client mode: Connect only to a hub server. No port forwarding needed. Best for typical users.'}
          {mode === 'server' && '🌐 Server mode: Act as hub for client connections. Requires public IP or port forwarding.'}
        </Alert>

        {(mode === 'mesh' || mode === 'server') && (
          <TextField
            fullWidth
            type="number"
            label="Listen Port"
            value={config.transports?.internet?.port || 14240}
            onChange={(e) => setConfig({
              ...config,
              transports: {
                ...config.transports,
                internet: { ...config.transports.internet, port: Number(e.target.value) }
              }
            })}
            sx={{ marginBottom: '1rem' }}
            helperText="Port to listen on for incoming connections (default: 14240)"
          />
        )}

        <FormControlLabel
          control={
            <Switch
              checked={config.transports?.internet?.tls !== false}
              onChange={(e) => setConfig({
                ...config,
                transports: {
                  ...config.transports,
                  internet: { ...config.transports.internet, tls: e.target.checked }
                }
              })}
            />
          }
          label="Enable TLS Encryption"
          sx={{ marginBottom: '1rem' }}
        />
      </Paper>

      {/* Client Mode - Hub Configuration */}
      {mode === 'client' && (
        <Paper sx={{ padding: '2rem', marginBottom: '2rem' }}>
          <Typography variant="h6" gutterBottom>
            Hub Server Configuration
          </Typography>

          <TextField
            fullWidth
            label="Hub Address"
            value={config.transports?.internet?.hubServer?.host || ''}
            onChange={(e) => setConfig({
              ...config,
              transports: {
                ...config.transports,
                internet: {
                  ...config.transports.internet,
                  hubServer: {
                    ...config.transports.internet.hubServer,
                    host: e.target.value
                  }
                }
              }
            })}
            sx={{ marginBottom: '1rem' }}
            helperText="Hostname or IP address of the hub server"
          />

          <TextField
            fullWidth
            type="number"
            label="Hub Port"
            value={config.transports?.internet?.hubServer?.port || 14240}
            onChange={(e) => setConfig({
              ...config,
              transports: {
                ...config.transports,
                internet: {
                  ...config.transports.internet,
                  hubServer: {
                    ...config.transports.internet.hubServer,
                    port: Number(e.target.value)
                  }
                }
              }
            })}
            sx={{ marginBottom: '1rem' }}
          />

          <TextField
            fullWidth
            label="Hub Callsign"
            value={config.transports?.internet?.hubServer?.callsign || ''}
            onChange={(e) => setConfig({
              ...config,
              transports: {
                ...config.transports,
                internet: {
                  ...config.transports.internet,
                  hubServer: {
                    ...config.transports.internet.hubServer,
                    callsign: e.target.value.toUpperCase()
                  }
                }
              }
            })}
            sx={{ marginBottom: '1rem' }}
            helperText="Expected callsign of the hub (for verification)"
          />

          <Divider sx={{ my: 2 }} />

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="subtitle1">Fallback Hub Servers</Typography>
            <Button
              startIcon={<AddIcon />}
              onClick={() => setHubDialog(true)}
              variant="outlined"
              size="small"
            >
              Add Fallback Hub
            </Button>
          </Box>

          {config.transports?.internet?.hubServers?.servers?.length > 0 && (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Host</TableCell>
                  <TableCell>Port</TableCell>
                  <TableCell>Callsign</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {config.transports.internet.hubServers.servers.map((hub, index) => (
                  <TableRow key={index}>
                    <TableCell>{hub.host}</TableCell>
                    <TableCell>{hub.port}</TableCell>
                    <TableCell>{hub.callsign}</TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={() => removeFallbackHub(index)}>
                        <DeleteIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>
      )}

      {/* Mesh Mode - Peer Configuration */}
      {mode === 'mesh' && (
        <Paper sx={{ padding: '2rem', marginBottom: '2rem' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Peer Nodes</Typography>
            <Button
              startIcon={<AddIcon />}
              onClick={() => setPeerDialog(true)}
              variant="outlined"
            >
              Add Peer
            </Button>
          </Box>

          {config.transports?.internet?.peers?.length > 0 ? (
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Host</TableCell>
                  <TableCell>Port</TableCell>
                  <TableCell>Callsign</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {config.transports.internet.peers.map((peer, index) => (
                  <TableRow key={index}>
                    <TableCell>{peer.host}</TableCell>
                    <TableCell>{peer.port}</TableCell>
                    <TableCell>{peer.callsign}</TableCell>
                    <TableCell>
                      <IconButton onClick={() => removePeer(index)}>
                        <DeleteIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Alert severity="info">
              No peers configured. Add peers to connect to other nodes in mesh mode.
            </Alert>
          )}
        </Paper>
      )}

      {/* RF Transport */}
      <Paper sx={{ padding: '2rem', marginBottom: '2rem' }}>
        <Typography variant="h6" gutterBottom>
          RF Transport (AX.25)
        </Typography>

        <FormControlLabel
          control={
            <Switch
              checked={config.transports?.rf?.enabled || false}
              onChange={(e) => setConfig({
                ...config,
                transports: {
                  ...config.transports,
                  rf: { ...config.transports.rf, enabled: e.target.checked }
                }
              })}
            />
          }
          label="Enable RF Transport"
          sx={{ marginBottom: '1rem' }}
        />

        <FormControl fullWidth sx={{ marginBottom: '1rem' }}>
          <InputLabel>Channel</InputLabel>
          <Select
            value={config.transports?.rf?.channelId || ''}
            onChange={(e) => setConfig({
              ...config,
              transports: {
                ...config.transports,
                rf: { ...config.transports.rf, channelId: e.target.value }
              }
            })}
            label="Channel"
          >
            <MenuItem value="">None</MenuItem>
            {availableChannels.map((ch) => (
              <MenuItem key={ch.id} value={ch.id}>
                {ch.name || ch.id} ({ch.type})
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Paper>

      {/* Routing */}
      <Paper sx={{ padding: '2rem', marginBottom: '2rem' }}>
        <Typography variant="h6" gutterBottom>
          Routing Configuration
        </Typography>

        <FormControlLabel
          control={
            <Switch
              checked={config.routing?.preferInternet !== false}
              onChange={(e) => setConfig({
                ...config,
                routing: { ...config.routing, preferInternet: e.target.checked }
              })}
            />
          }
          label="Prefer Internet over RF"
          sx={{ marginBottom: '1rem' }}
        />

        <TextField
          fullWidth
          type="number"
          label="Maximum Hops"
          value={config.routing?.maxHops || 7}
          onChange={(e) => setConfig({
            ...config,
            routing: { ...config.routing, maxHops: Number(e.target.value) }
          })}
          sx={{ marginBottom: '1rem' }}
          helperText="Maximum number of hops for packet forwarding"
        />
      </Paper>

      {/* Quality of Service (QoS) */}
      <Paper sx={{ padding: '2rem', marginBottom: '2rem' }}>
        <Typography variant="h6" gutterBottom>
          Quality of Service (QoS)
        </Typography>

        <FormControlLabel
          control={
            <Switch
              checked={config.qos?.enabled !== false}
              onChange={(e) => setConfig({
                ...config,
                qos: { ...config.qos, enabled: e.target.checked }
              })}
            />
          }
          label="Enable QoS Priority Queuing"
          sx={{ marginBottom: '1rem' }}
        />

        <TextField
          fullWidth
          type="number"
          label="Bandwidth Limit (bytes/sec)"
          value={config.qos?.bandwidthLimit || 10000}
          onChange={(e) => setConfig({
            ...config,
            qos: { ...config.qos, bandwidthLimit: Number(e.target.value) }
          })}
          sx={{ marginBottom: '1rem' }}
          helperText="Maximum bandwidth for packet transmission (0 = unlimited)"
        />

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 2 }}>
          <TextField
            type="number"
            label="Emergency Queue Size"
            value={config.qos?.emergencyQueueSize || 100}
            onChange={(e) => setConfig({
              ...config,
              qos: { ...config.qos, emergencyQueueSize: Number(e.target.value) }
            })}
            helperText="Priority 0 (TOR/SVR/FFW)"
          />
          <TextField
            type="number"
            label="High Priority Queue Size"
            value={config.qos?.highQueueSize || 200}
            onChange={(e) => setConfig({
              ...config,
              qos: { ...config.qos, highQueueSize: Number(e.target.value) }
            })}
            helperText="Priority 1 (bulletins/weather)"
          />
          <TextField
            type="number"
            label="Normal Queue Size"
            value={config.qos?.normalQueueSize || 500}
            onChange={(e) => setConfig({
              ...config,
              qos: { ...config.qos, normalQueueSize: Number(e.target.value) }
            })}
            helperText="Priority 2 (standard traffic)"
          />
          <TextField
            type="number"
            label="Low Priority Queue Size"
            value={config.qos?.lowQueueSize || 1000}
            onChange={(e) => setConfig({
              ...config,
              qos: { ...config.qos, lowQueueSize: Number(e.target.value) }
            })}
            helperText="Priority 3 (routine messages)"
          />
        </Box>
      </Paper>

      {/* Load Balancing */}
      <Paper sx={{ padding: '2rem', marginBottom: '2rem' }}>
        <Typography variant="h6" gutterBottom>
          Load Balancing
        </Typography>

        <FormControlLabel
          control={
            <Switch
              checked={config.loadBalancing?.enabled !== false}
              onChange={(e) => setConfig({
                ...config,
                loadBalancing: { ...config.loadBalancing, enabled: e.target.checked }
              })}
            />
          }
          label="Enable Load Balancing"
          sx={{ marginBottom: '1rem' }}
        />

        <FormControl fullWidth sx={{ marginBottom: '1rem' }}>
          <InputLabel>Algorithm</InputLabel>
          <Select
            value={config.loadBalancing?.algorithm || 'weighted'}
            onChange={(e) => setConfig({
              ...config,
              loadBalancing: { ...config.loadBalancing, algorithm: e.target.value }
            })}
            label="Algorithm"
          >
            <MenuItem value="weighted">⚖️ Weighted (Prefer Better Routes)</MenuItem>
            <MenuItem value="round-robin">🔄 Round-Robin (Alternate Evenly)</MenuItem>
            <MenuItem value="least-loaded">📊 Least-Loaded (Choose Least Used)</MenuItem>
          </Select>
        </FormControl>

        <TextField
          fullWidth
          type="number"
          label="Failover Threshold"
          value={config.loadBalancing?.failureThreshold || 3}
          onChange={(e) => setConfig({
            ...config,
            loadBalancing: { ...config.loadBalancing, failureThreshold: Number(e.target.value) }
          })}
          helperText="Consecutive failures before automatic failover"
        />
      </Paper>

      {/* Mesh Healing */}
      <Paper sx={{ padding: '2rem', marginBottom: '2rem' }}>
        <Typography variant="h6" gutterBottom>
          Mesh Self-Healing
        </Typography>

        <FormControlLabel
          control={
            <Switch
              checked={config.meshHealing?.enabled !== false}
              onChange={(e) => setConfig({
                ...config,
                meshHealing: { ...config.meshHealing, enabled: e.target.checked }
              })}
            />
          }
          label="Enable Mesh Self-Healing"
          sx={{ marginBottom: '1rem' }}
        />

        <TextField
          fullWidth
          type="number"
          label="LSA Broadcast Interval (seconds)"
          value={config.meshHealing?.lsaInterval || 60}
          onChange={(e) => setConfig({
            ...config,
            meshHealing: { ...config.meshHealing, lsaInterval: Number(e.target.value) }
          })}
          sx={{ marginBottom: '1rem' }}
          helperText="How often to broadcast Link State Advertisements"
        />

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          <TextField
            type="number"
            label="Link Timeout (seconds)"
            value={config.meshHealing?.linkTimeout || 120}
            onChange={(e) => setConfig({
              ...config,
              meshHealing: { ...config.meshHealing, linkTimeout: Number(e.target.value) }
            })}
            helperText="Time before declaring link down"
          />
          <TextField
            type="number"
            label="Discovery Timeout (seconds)"
            value={config.meshHealing?.discoveryTimeout || 30}
            onChange={(e) => setConfig({
              ...config,
              meshHealing: { ...config.meshHealing, discoveryTimeout: Number(e.target.value) }
            })}
            helperText="Time to wait for route discovery"
          />
        </Box>
      </Paper>

      {/* Security & Authentication */}
      <Paper sx={{ padding: '2rem', marginBottom: '2rem' }}>
        <Typography variant="h6" gutterBottom>
          Security & Authentication
        </Typography>

        <FormControlLabel
          control={
            <Switch
              checked={config.security?.enabled !== false}
              onChange={(e) => setConfig({
                ...config,
                security: { ...config.security, enabled: e.target.checked }
              })}
            />
          }
          label="Enable Security"
          sx={{ marginBottom: '1rem' }}
        />

        <Alert severity="info" sx={{ mb: 2 }}>
          🔐 Ed25519 public key cryptography with challenge-response authentication
        </Alert>

        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Your Public Key:
          </Typography>
          <TextField
            fullWidth
            multiline
            rows={2}
            value={publicKey || 'No key generated'}
            InputProps={{ readOnly: true }}
            sx={{ mb: 1, fontFamily: 'monospace', fontSize: '0.85rem' }}
          />
          <Button
            variant="outlined"
            onClick={generateKeys}
            disabled={keyGenLoading}
            size="small"
          >
            {keyGenLoading ? 'Generating...' : '🔑 Generate New Keys'}
          </Button>
        </Box>

        <Divider sx={{ my: 2 }} />

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 2 }}>
          <TextField
            type="number"
            label="Session Timeout (seconds)"
            value={config.security?.sessionTimeout || 300}
            onChange={(e) => setConfig({
              ...config,
              security: { ...config.security, sessionTimeout: Number(e.target.value) }
            })}
            helperText="Authentication session duration"
          />
          <TextField
            type="number"
            label="Max Auth Attempts (per minute)"
            value={config.security?.maxAuthAttempts || 5}
            onChange={(e) => setConfig({
              ...config,
              security: { ...config.security, maxAuthAttempts: Number(e.target.value) }
            })}
            helperText="Rate limiting for auth requests"
          />
        </Box>

        <Divider sx={{ my: 2 }} />

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="subtitle1">Trusted Nodes</Typography>
          <Button
            startIcon={<AddIcon />}
            onClick={() => setTrustedNodeDialog(true)}
            variant="outlined"
            size="small"
          >
            Add Trusted Node
          </Button>
        </Box>

        {config.security?.trustedNodes?.length > 0 ? (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Callsign</TableCell>
                <TableCell>Public Key</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {config.security.trustedNodes.map((node, index) => (
                <TableRow key={index}>
                  <TableCell>{node.callsign}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {node.publicKey}
                  </TableCell>
                  <TableCell>
                    <IconButton size="small" onClick={() => removeTrustedNode(index)}>
                      <DeleteIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Alert severity="info">
            No trusted nodes configured. Add trusted nodes to enable authenticated connections.
          </Alert>
        )}
      </Paper>

      {/* Monitoring */}
      <Paper sx={{ padding: '2rem', marginBottom: '2rem' }}>
        <Typography variant="h6" gutterBottom>
          Monitoring & Administration
        </Typography>

        <FormControlLabel
          control={
            <Switch
              checked={config.monitoring?.enabled !== false}
              onChange={(e) => setConfig({
                ...config,
                monitoring: { ...config.monitoring, enabled: e.target.checked }
              })}
            />
          }
          label="Enable Monitoring"
          sx={{ marginBottom: '1rem' }}
        />

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 2 }}>
          <TextField
            type="number"
            label="Health Check Interval (seconds)"
            value={config.monitoring?.healthCheckInterval || 30}
            onChange={(e) => setConfig({
              ...config,
              monitoring: { ...config.monitoring, healthCheckInterval: Number(e.target.value) }
            })}
            helperText="How often to check node health"
          />
          <TextField
            type="number"
            label="Aggregation Interval (seconds)"
            value={config.monitoring?.aggregationInterval || 300}
            onChange={(e) => setConfig({
              ...config,
              monitoring: { ...config.monitoring, aggregationInterval: Number(e.target.value) }
            })}
            helperText="Historical data aggregation"
          />
        </Box>

        <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>
          Alert Thresholds:
        </Typography>

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          <TextField
            type="number"
            label="High Latency (ms)"
            value={config.monitoring?.alertThresholds?.latency || 1000}
            onChange={(e) => setConfig({
              ...config,
              monitoring: {
                ...config.monitoring,
                alertThresholds: {
                  ...config.monitoring?.alertThresholds,
                  latency: Number(e.target.value)
                }
              }
            })}
            helperText="Alert when latency exceeds"
          />
          <TextField
            type="number"
            label="High Packet Loss (%)"
            value={config.monitoring?.alertThresholds?.packetLoss || 10}
            onChange={(e) => setConfig({
              ...config,
              monitoring: {
                ...config.monitoring,
                alertThresholds: {
                  ...config.monitoring?.alertThresholds,
                  packetLoss: Number(e.target.value)
                }
              }
            })}
            helperText="Alert when packet loss exceeds"
          />
        </Box>
      </Paper>

      {/* Save Button */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
        <Button variant="outlined" href="#/nexnet">
          Cancel
        </Button>
        <Button variant="contained" onClick={saveSettings}>
          Save Settings
        </Button>
      </Box>

      {/* Add Peer Dialog */}
      <Dialog open={peerDialog} onClose={() => setPeerDialog(false)}>
        <DialogTitle>Add Peer Node</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Host"
            value={newPeer.host}
            onChange={(e) => setNewPeer({ ...newPeer, host: e.target.value })}
            sx={{ mt: 2, mb: 2 }}
          />
          <TextField
            fullWidth
            type="number"
            label="Port"
            value={newPeer.port}
            onChange={(e) => setNewPeer({ ...newPeer, port: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Callsign"
            value={newPeer.callsign}
            onChange={(e) => setNewPeer({ ...newPeer, callsign: e.target.value.toUpperCase() })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPeerDialog(false)}>Cancel</Button>
          <Button onClick={addPeer} variant="contained">Add</Button>
        </DialogActions>
      </Dialog>

      {/* Add Fallback Hub Dialog */}
      <Dialog open={hubDialog} onClose={() => setHubDialog(false)}>
        <DialogTitle>Add Fallback Hub</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Host"
            value={newHub.host}
            onChange={(e) => setNewHub({ ...newHub, host: e.target.value })}
            sx={{ mt: 2, mb: 2 }}
          />
          <TextField
            fullWidth
            type="number"
            label="Port"
            value={newHub.port}
            onChange={(e) => setNewHub({ ...newHub, port: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Callsign"
            value={newHub.callsign}
            onChange={(e) => setNewHub({ ...newHub, callsign: e.target.value.toUpperCase() })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHubDialog(false)}>Cancel</Button>
          <Button onClick={addFallbackHub} variant="contained">Add</Button>
        </DialogActions>
      </Dialog>

      {/* Add Trusted Node Dialog */}
      <Dialog open={trustedNodeDialog} onClose={() => setTrustedNodeDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>Add Trusted Node</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Callsign"
            value={newTrustedNode.callsign}
            onChange={(e) => setNewTrustedNode({ ...newTrustedNode, callsign: e.target.value.toUpperCase() })}
            sx={{ mt: 2, mb: 2 }}
          />
          <TextField
            fullWidth
            multiline
            rows={3}
            label="Public Key"
            value={newTrustedNode.publicKey}
            onChange={(e) => setNewTrustedNode({ ...newTrustedNode, publicKey: e.target.value })}
            helperText="Paste the Ed25519 public key from the remote node"
            sx={{ fontFamily: 'monospace' }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTrustedNodeDialog(false)}>Cancel</Button>
          <Button onClick={addTrustedNode} variant="contained">Add</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
