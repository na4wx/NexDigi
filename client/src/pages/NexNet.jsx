import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Grid,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  CircularProgress,
  Alert,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  Settings as SettingsIcon,
  CloudOff as CloudOffIcon,
  Cloud as CloudIcon,
  Router as RouterIcon,
  People as PeopleIcon,
  Wifi as WifiIcon,
  Storage as StorageIcon,
  Speed as SpeedIcon,
  Refresh as RefreshIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Hub as HubIcon,
  Cast as CastIcon,
  NetworkCheck as NetworkCheckIcon
} from '@mui/icons-material';

const API_BASE = `http://${window.location.hostname}:3000`;

export default function NexNet({ setPage }) {
  const [status, setStatus] = useState(null);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchStatus();
    fetchConfig();
    const interval = setInterval(fetchStatus, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/backbone/status`);
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError('Failed to fetch backbone status');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/backbone/config`);
      const data = await res.json();
      setConfig(data);
    } catch (err) {
      console.error('Failed to fetch config:', err);
    }
  };

  const handleEnableToggle = async () => {
    if (!config) return;
    
    setSaving(true);
    try {
      const newConfig = { ...config, enabled: !config.enabled };
      const res = await fetch(`${API_BASE}/api/backbone/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
      const data = await res.json();
      if (data.success) {
        setConfig(newConfig);
        alert('Configuration updated. Please restart the server to apply changes.');
      }
    } catch (err) {
      alert('Failed to update configuration: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const formatLastSeen = (lastSeenAgo) => {
    const seconds = Math.floor(lastSeenAgo / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  const formatBytes = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatUptime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  };

  if (loading) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress size={60} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
        <Button
          variant="contained"
          startIcon={<RefreshIcon />}
          onClick={() => {
            setLoading(true);
            fetchStatus();
            fetchConfig();
          }}
        >
          Retry
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'primary.main', display: 'flex', alignItems: 'center', gap: 1 }}>
            <RouterIcon fontSize="large" />
            NexNet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Mesh networking for distributed NexDigi nodes
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Refresh Status">
            <IconButton
              onClick={() => {
                fetchStatus();
                fetchConfig();
              }}
              color="primary"
            >
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Button
            variant="outlined"
            startIcon={<SettingsIcon />}
            onClick={() => setPage && setPage('nexnet-settings')}
          >
            Settings
          </Button>
          {config && (
            <Button
              variant="contained"
              color={config.enabled ? 'error' : 'success'}
              onClick={handleEnableToggle}
              disabled={saving}
              startIcon={config.enabled ? <CloudOffIcon /> : <CloudIcon />}
            >
              {saving ? 'Saving...' : config.enabled ? 'Disable' : 'Enable'}
            </Button>
          )}
        </Box>
      </Box>

      {/* Status Overview Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={3}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 600 }}>
                  Status
                </Typography>
                {status?.enabled ? (
                  <CheckCircleIcon color="success" />
                ) : (
                  <CancelIcon color="disabled" />
                )}
              </Box>
              <Typography variant="h4" sx={{ fontWeight: 'bold', color: status?.enabled ? 'success.main' : 'text.disabled' }}>
                {status?.enabled ? 'Enabled' : 'Disabled'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={3}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 600 }}>
                  Mode
                </Typography>
                {status?.transports?.internet?.mode === 'server' ? <HubIcon color="primary" /> :
                 status?.transports?.internet?.mode === 'client' ? <CastIcon color="primary" /> :
                 <NetworkCheckIcon color="primary" />}
              </Box>
              {status?.transports?.internet?.mode ? (
                <Chip
                  label={status.transports.internet.mode === 'server' ? 'Hub' :
                         status.transports.internet.mode === 'client' ? 'Client' : 'Mesh'}
                  color={status.transports.internet.mode === 'server' ? 'success' :
                         status.transports.internet.mode === 'client' ? 'primary' : 'secondary'}
                  sx={{ fontWeight: 'bold', fontSize: '1.1rem', height: 36 }}
                />
              ) : (
                <Typography variant="h5" color="text.disabled">N/A</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={3}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 600 }}>
                  Neighbors
                </Typography>
                <PeopleIcon color="primary" />
              </Box>
              <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                {status?.neighbors?.length || 0}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {status?.neighbors?.length === 1 ? 'Connected node' : 'Connected nodes'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={3}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 600 }}>
                  Callsign
                </Typography>
                <WifiIcon color="primary" />
              </Box>
              <Typography variant="h5" sx={{ fontWeight: 'bold', fontFamily: 'monospace' }}>
                {status?.localCallsign || 'N/A'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Local node identifier
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Hub Connection Status (Client Mode) */}
      {status?.enabled && status?.transports?.internet?.mode === 'client' && (
        <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
            <CastIcon /> Hub Connection
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 600 }}>
                Hub Callsign
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 'medium', fontFamily: 'monospace' }}>
                {status.transports.internet.hubCallsign || 'Not connected'}
              </Typography>
            </Grid>
            <Grid item xs={12} md={4}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 600 }}>
                Connection Status
              </Typography>
              <Box sx={{ mt: 0.5 }}>
                <Chip
                  label={status.transports.internet.connected ? 'Connected' : 'Disconnected'}
                  color={status.transports.internet.connected ? 'success' : 'error'}
                  icon={status.transports.internet.connected ? <CheckCircleIcon /> : <CancelIcon />}
                  size="medium"
                />
              </Box>
            </Grid>
            <Grid item xs={12} md={4}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 600 }}>
                Hub Address
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', mt: 0.5 }}>
                {config?.transports?.internet?.hubServer?.host || 'N/A'}:
                {config?.transports?.internet?.hubServer?.port || 'N/A'}
              </Typography>
            </Grid>
          </Grid>
        </Paper>
      )}

      {/* Hub Statistics (Server Mode) */}
      {status?.enabled && status?.transports?.internet?.mode === 'server' && (
        <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
            <HubIcon /> Hub Statistics
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={3}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase' }}>
                    Connected Clients
                  </Typography>
                  <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                    {status.transports.internet.connectedClients || 0}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase' }}>
                    Packets Relayed
                  </Typography>
                  <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'success.main' }}>
                    {status.transports.internet.packetsRelayed || 0}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase' }}>
                    Bandwidth
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    ↑ {formatBytes(status.transports.internet.bytesSent || 0)}
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    ↓ {formatBytes(status.transports.internet.bytesReceived || 0)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase' }}>
                    Uptime
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 'medium' }}>
                    {formatUptime(status.transports.internet.uptime || 0)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Paper>
      )}

      {/* Transports */}
      {status?.enabled && (
        <Paper elevation={2} sx={{ mb: 3 }}>
          <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
              <StorageIcon /> Transports
            </Typography>
          </Box>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold' }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Cost</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>MTU</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>TX/RX</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.entries(status?.transports || {}).map(([id, transport]) => (
                  <TableRow key={id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 'medium', textTransform: 'uppercase', fontFamily: 'monospace' }}>
                        {id}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={transport.connected ? 'Connected' : 'Disconnected'}
                        color={transport.connected ? 'success' : 'default'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>{transport.metrics?.cost || 'N/A'}</TableCell>
                    <TableCell>{transport.metrics?.mtu || 'N/A'}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                      {transport.metrics?.packetsSent || 0} / {transport.metrics?.packetsReceived || 0}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Neighbors */}
      {status?.enabled && status?.neighbors && status.neighbors.length > 0 && (
        <Paper elevation={2} sx={{ mb: 3 }}>
          <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
              <PeopleIcon /> Neighbors
            </Typography>
          </Box>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold' }}>Callsign</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Transports</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Services</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Last Seen</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {status.neighbors.map((neighbor) => (
                  <TableRow key={neighbor.callsign} hover>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 'medium', fontFamily: 'monospace' }}>
                          {neighbor.callsign}
                        </Typography>
                        {neighbor.viaHub && (
                          <Chip label="via hub" size="small" color="secondary" variant="outlined" />
                        )}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {neighbor.transports.map(t => (
                          <Chip key={t} label={t.toUpperCase()} size="small" color="primary" variant="outlined" />
                        ))}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {neighbor.services.map(s => (
                          <Chip key={s} label={s} size="small" color="success" variant="outlined" />
                        ))}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {formatLastSeen(neighbor.lastSeenAgo)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Services */}
      {status?.enabled && status?.services && Object.keys(status.services).length > 0 && (
        <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
            <SpeedIcon /> Available Services
          </Typography>
          <Grid container spacing={2}>
            {Object.entries(status.services).map(([service, providers]) => (
              <Grid item xs={12} sm={6} md={4} key={service}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 1 }}>
                      {service}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {providers.length} provider{providers.length !== 1 ? 's' : ''}
                    </Typography>
                    <List dense>
                      {providers.map(p => (
                        <ListItem key={p} disablePadding>
                          <ListItemIcon sx={{ minWidth: 30 }}>
                            <CheckCircleIcon fontSize="small" color="success" />
                          </ListItemIcon>
                          <ListItemText 
                            primary={p}
                            primaryTypographyProps={{ variant: 'body2', fontFamily: 'monospace' }}
                          />
                        </ListItem>
                      ))}
                    </List>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Paper>
      )}

      {/* Getting Started (when disabled) */}
      {!status?.enabled && (
        <Paper 
          elevation={3}
          sx={{ 
            p: 4, 
            background: 'linear-gradient(135deg, #E3F2FD 0%, #BBDEFB 100%)',
            border: 2,
            borderColor: 'primary.light'
          }}
        >
          <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
            <RouterIcon sx={{ fontSize: 60, color: 'primary.main' }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'primary.dark', mb: 2 }}>
                Getting Started with NexNet
              </Typography>
              <List>
                <ListItem>
                  <ListItemIcon><CheckCircleIcon color="primary" /></ListItemIcon>
                  <ListItemText 
                    primary="Connect Multiple Nodes"
                    secondary="NexNet enables distributed NexDigi installations to communicate via RF and/or Internet"
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon><CheckCircleIcon color="primary" /></ListItemIcon>
                  <ListItemText 
                    primary="Advanced Routing"
                    secondary="Features QoS, load balancing, and automatic failover for reliable connections"
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon><CheckCircleIcon color="primary" /></ListItemIcon>
                  <ListItemText 
                    primary="Service Discovery"
                    secondary="Automatically find and connect to BBS, chat, and other services on the network"
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon><CheckCircleIcon color="primary" /></ListItemIcon>
                  <ListItemText 
                    primary="Multiple Modes"
                    secondary="Run as a Hub (server), Client, or Mesh node depending on your network topology"
                  />
                </ListItem>
              </List>
              <Paper elevation={1} sx={{ p: 2, mt: 2, bgcolor: 'rgba(255,255,255,0.8)' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <SettingsIcon fontSize="small" /> Quick Setup
                </Typography>
                <List dense>
                  <ListItem>
                    <ListItemText primary="1. Click Settings button above" />
                  </ListItem>
                  <ListItem>
                    <ListItemText primary="2. Configure your callsign and choose a mode (Hub/Client/Mesh)" />
                  </ListItem>
                  <ListItem>
                    <ListItemText primary="3. Click Enable button and restart the server" />
                  </ListItem>
                  <ListItem>
                    <ListItemText primary="4. Return here to monitor connections and status" />
                  </ListItem>
                </List>
              </Paper>
            </Box>
          </Box>
        </Paper>
      )}
    </Box>
  );
}
