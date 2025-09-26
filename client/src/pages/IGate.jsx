import React, { useEffect, useState } from 'react'
import { Box, Typography, Paper, TextField, Button, Switch, FormControlLabel, Alert, Chip, Divider } from '@mui/material'

export default function IGatePage() {
  const API_BASE = `${location.protocol}//${location.hostname}:3000`
  const [cfg, setCfg] = useState({ enabled: false, host: '', port: 14580, call: '', pass: '', channels: [] })
  const [status, setStatus] = useState({ connected: false, authenticated: false, enabled: false })
  const [saving, setSaving] = useState(false)

  useEffect(() => { 
    fetchCfg()
    fetchStatus()
    // Poll status every 5 seconds
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [])

  async function fetchCfg() {
    try {
      const res = await fetch(`${API_BASE}/api/igate`)
      const j = await res.json()
      setCfg(Object.assign({}, { enabled: false, host: '', port: 14580, call: '', pass: '', channels: [] }, j))
    } catch (e) {}
  }

  async function fetchStatus() {
    try {
      const res = await fetch(`${API_BASE}/api/igate/status`)
      const j = await res.json()
      setStatus(j)
    } catch (e) {
      setStatus({ connected: false, authenticated: false, enabled: false })
    }
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`${API_BASE}/api/igate`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cfg) })
      const j = await res.json()
      setCfg(Object.assign({}, cfg, j))
      // Refresh status after save
      setTimeout(fetchStatus, 1000)
    } catch (e) { console.warn(e) }
    setSaving(false)
  }

  const getStatusDisplay = () => {
    if (!status.enabled) return <Chip label="Disabled" color="default" size="small" />
    if (!status.connected) return <Chip label="Disconnected" color="error" size="small" />
    if (!status.authenticated) return <Chip label="Connected (Unverified)" color="warning" size="small" />
    return <Chip label="Connected & Authenticated" color="success" size="small" />
  }

  const formatUptime = (seconds) => {
    if (!seconds) return 'N/A'
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60
    if (hours > 0) return `${hours}h ${minutes}m ${secs}s`
    if (minutes > 0) return `${minutes}m ${secs}s`
    return `${secs}s`
  }

  return (
    <Box>
      <Typography variant="h5">IGate</Typography>
      
      {/* Status Section */}
      <Paper style={{ padding: 12, marginTop: 12 }}>
        <Typography variant="h6" gutterBottom>Connection Status</Typography>
        <Box display="flex" alignItems="center" gap={2} mb={2}>
          <Typography variant="body2">Status:</Typography>
          {getStatusDisplay()}
        </Box>
        
        {status.connected && (
          <Box display="flex" flexDirection="column" gap={1} mb={2}>
            <Typography variant="body2">
              <strong>Connected to:</strong> {status.host}:{status.port}
            </Typography>
            {status.callsign && (
              <Typography variant="body2">
                <strong>Callsign:</strong> {status.callsign}
              </Typography>
            )}
            <Typography variant="body2">
              <strong>Uptime:</strong> {formatUptime(status.uptime)}
            </Typography>
            {status.connectTime && (
              <Typography variant="body2">
                <strong>Connected since:</strong> {new Date(status.connectTime).toLocaleString()}
              </Typography>
            )}
          </Box>
        )}

        {status.lastError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            <strong>Last Error:</strong> {status.lastError}
          </Alert>
        )}

        {status.enabled && !status.authenticated && status.connected && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Connected but not authenticated. Check your callsign and password. Unverified connections cannot send data to the APRS network.
          </Alert>
        )}
      </Paper>

      {/* Configuration Section */}
      <Paper style={{ padding: 12, marginTop: 12 }}>
        <Typography variant="h6" gutterBottom>Configuration</Typography>
        <FormControlLabel control={<Switch checked={!!cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />} label="Enable IGate" />
        <Box display="flex" flexDirection="column" gap={2} mt={2}>
          <TextField label="Host" value={cfg.host} onChange={(e) => setCfg({ ...cfg, host: e.target.value })} />
          <TextField label="Port" type="number" value={cfg.port} onChange={(e) => setCfg({ ...cfg, port: Number(e.target.value) })} />
          <TextField label="Callsign" value={cfg.call} onChange={(e) => setCfg({ ...cfg, call: e.target.value })} />
          <TextField label="Password" value={cfg.pass} onChange={(e) => setCfg({ ...cfg, pass: e.target.value })} />
          <Typography variant="caption">Note: Per-channel IGate forwarding is controlled on the Channels tab via each channel's options (option name: <code>igate</code>).</Typography>
          <Box display="flex" gap={2}>
            <Button variant="contained" onClick={save} disabled={saving}>Save</Button>
            <Button variant="outlined" onClick={fetchCfg}>Refresh</Button>
          </Box>
        </Box>
      </Paper>
    </Box>
  )
}
