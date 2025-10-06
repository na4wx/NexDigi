import React, { useEffect, useState, useRef } from 'react'
import { Box, Container, Typography, List, ListItem, ListItemText, Paper, Button, AppBar, Toolbar, Chip, IconButton, Grid, Card, CardContent } from '@mui/material'
import AutorenewIcon from '@mui/icons-material/Autorenew'
import BugReportIcon from '@mui/icons-material/BugReport'
import RefreshIcon from '@mui/icons-material/Refresh'
import StorageIcon from '@mui/icons-material/Storage'
import VisibilityIcon from '@mui/icons-material/Visibility'
import RepeatIcon from '@mui/icons-material/Repeat'
import GroupIcon from '@mui/icons-material/Group'
import SettingsPage from './pages/Settings'
import ActiveAlerts from './pages/ActiveAlerts'
import LastHeard from './pages/LastHeard'
// Temporarily comment out BBS UI for upcoming release
// import BBS from './pages/BBS'
// import BBSSettings from './pages/BBSSettings'
import axios from 'axios'

export default function App() {
  const [frames, setFrames] = useState([])
  const [page, setPage] = useState('home')
  const [bbsEnabled, setBbsEnabled] = useState(false);
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const wsRef = useRef(null)

  // Safely decode payloads that may arrive as different shapes from the server:
  // - string (already decoded)
  // - { type: 'Buffer', data: [...] } (Node Buffer JSON)
  // - Array of byte numbers
  // - Uint8Array / ArrayBuffer
  const decodePayload = (payload) => {
    if (!payload) return ''
    try {
      if (typeof payload === 'string') return payload
      // Node Buffer serialized as { type: 'Buffer', data: [...] }
      if (payload && payload.type === 'Buffer' && Array.isArray(payload.data)) {
        return new TextDecoder().decode(new Uint8Array(payload.data))
      }
      if (Array.isArray(payload)) return new TextDecoder().decode(new Uint8Array(payload))
      if (payload instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(payload))
      if (payload && payload.buffer && payload.buffer instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(payload))
      // Fallback: try to coerce to string
      return String(payload)
    } catch (err) {
      console.warn('decodePayload failed', err, payload)
      return ''
    }
  }

  const sanitizeText = (s) => {
    if (!s) return ''
    // replace control characters with '.' and collapse long whitespace
    return s.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '.')
            .replace(/\s+/g, ' ')
            .trim()
  }

  const hexDump = (payload, maxBytes = 32) => {
    try {
      let arr
      if (!payload) return ''
      if (typeof payload === 'string') {
        arr = new TextEncoder().encode(payload)
      } else if (payload && payload.type === 'Buffer' && Array.isArray(payload.data)) {
        arr = Uint8Array.from(payload.data)
      } else if (Array.isArray(payload)) {
        arr = Uint8Array.from(payload)
      } else if (payload instanceof ArrayBuffer) {
        arr = new Uint8Array(payload)
      } else if (payload && payload.buffer && payload.buffer instanceof ArrayBuffer) {
        arr = new Uint8Array(payload)
      } else {
        // fallback stringify
        return String(payload)
      }
      const slice = arr.slice(0, maxBytes)
      return Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ')
    } catch (err) {
      return ''
    }
  }

  useEffect(() => {
    const backend = `http://${location.hostname}:3000`
    const ws = new WebSocket(backend.replace('http', 'ws'))
    wsRef.current = ws
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'frame' || msg.type === 'tx') {
          // normalize data object: attach direction and compute payload length when possible
          const d = Object.assign({}, msg.data);
          d._direction = msg.type; // 'frame' == received, 'tx' == transmitted
          // attempt to determine payload length
          const p = d.parsed && d.parsed.payload ? d.parsed.payload : null;
          if (p) {
            if (p.type === 'Buffer' && Array.isArray(p.data)) d.length = p.data.length;
            else if (Array.isArray(p)) d.length = p.length;
            else if (p instanceof ArrayBuffer) d.length = p.byteLength;
            else if (p && p.buffer && p.buffer.byteLength) d.length = p.buffer.byteLength;
            else if (typeof p === 'string') d.length = new TextEncoder().encode(p).length;
          }
          setFrames((s) => [d, ...s].slice(0, 200))
        }
      } catch (err) { console.warn(err) }
    })
    // Populate initial recent frames from REST in case WS hasn't delivered yet
    try {
      fetch(`${backend}/api/frames`).then(r => r.json()).then(j => {
        if (Array.isArray(j) && j.length) {
          // mark them as received
          const withDir = j.map(x => Object.assign({}, x, { _direction: 'R' }));
          setFrames((s) => [...withDir, ...s].slice(0, 200));
        }
      }).catch(() => {});
    } catch (e) {}
    return () => ws.close()
  }, [])

  const [showHex, setShowHex] = useState(false)

  const [channels, setChannels] = useState([])
  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const backend = `http://${location.hostname}:3000`
  const fetchChannels = () => fetch(`${backend}/api/channels`).then(r => r.json()).then(j => setChannels(j)).catch(() => setChannels([]))
  useEffect(() => { fetchChannels() }, [])

  const fetchStats = async () => {
    setStatsLoading(true)
    try {
      const resp = await fetch(`${backend}/api/digipeater/metrics`)
      const j = await resp.json()
      setStats(j)
    } catch (e) { setStats(null) }
    setStatsLoading(false)
  }
  useEffect(() => { fetchStats() }, [])

  const doReconnect = async (id) => {
    try {
  await fetch(`${backend}/api/channels/${id}/reconnect`, { method: 'POST' })
      fetchChannels()
    } catch (err) { console.warn(err) }
  }

  const doProbe = async (channel) => {
    try {
      const host = channel.options && channel.options.host
      const port = channel.options && channel.options.port
      if (!host || !port) return
  const res = await fetch(`${backend}/api/probe`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ host, port }) })
      const j = await res.json()
      alert(`Probe ${channel.id}: ${j.ok ? 'OK' : 'FAIL'} ${j.error || ''}`)
      fetchChannels()
    } catch (err) { console.warn(err); alert('Probe failed') }
  }

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await axios.get(`${backend}/api/bbs/settings`);
        setBbsEnabled(response.data.enabled);
        // fetch digipeater settings to detect if NWS alerts are enabled
        try {
          const dd = await axios.get(`${backend}/api/digipeater/settings`);
          if (dd && dd.data && dd.data.nwsAlerts && dd.data.nwsAlerts.enabled) setAlertsEnabled(true)
        } catch (e) {
          // ignore
        }
      } catch (error) {
        console.error('Error fetching BBS settings:', error);
      }
    };
    fetchSettings();
  }, []);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
      }}
    >
      {/* Main content */}
      <Box sx={{ flex: 1 }}>
  <AppBar position="sticky" sx={{ top: 0, zIndex: (theme) => theme.zIndex.appBar }}>
          <Toolbar>
            <Typography variant="h6" sx={{ flexGrow: 1 }}>NexDigi</Typography>
            <Button color="inherit" onClick={() => setPage('home')}>Home</Button>
            <Button color="inherit" onClick={() => setPage('frames')}>Frames</Button>
            <Button color="inherit" onClick={() => setPage('lastheard')}>Last Heard</Button>
            {/* BBS navigation temporarily disabled for future release */}
            {/* {bbsEnabled && <Button color="inherit" onClick={() => setPage('bbs')}>BBS</Button>} */}
            {alertsEnabled && <Button color="inherit" onClick={() => setPage('alerts')}>Alerts</Button>}
            <Button color="inherit" onClick={() => setPage('settings')}>Settings</Button>
          </Toolbar>
        </AppBar>

        <Container style={{ marginTop: 16 }}>
          {page === 'home' && (
            <Box>
              <Typography variant="h4">NexDigi — APRS Digipeater (Foundation)</Typography>
              <Box display="flex" gap={2} marginTop={2}>
                <Paper style={{ flex: 2, padding: 12, maxHeight: 400, overflow: 'auto' }}>
                  <Typography variant="h6">Channels</Typography>
                  <List>
                    {channels.map((ch) => (
                      <ListItem key={ch.id}>
                        <Box style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                          <Box>
                            <Typography variant="subtitle1">{`${ch.name} (${ch.id})`}</Typography>
                            <Typography variant="body2" color="textSecondary">{`callsign=${ch.options && ch.options.callsign ? ch.options.callsign : '—'} type=${ch.type}`}</Typography>
                          </Box>

                          <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {ch.status && ch.status.connected ? <Chip label="online" color="success" /> : <Chip label="offline" color="default" />}
                            <IconButton onClick={() => doProbe(ch)} title="Probe"><BugReportIcon/></IconButton>
                            <IconButton onClick={() => doReconnect(ch.id)} title="Reconnect"><AutorenewIcon/></IconButton>
                          </Box>
                        </Box>
                      </ListItem>
                    ))}
                  </List>
                </Paper>
              </Box>

              <Box marginTop={2}>
                <Box display="flex" alignItems="center" justifyContent="space-between" marginBottom={1}>
                  <Typography variant="h6">Stats</Typography>
                  <Button size="small" onClick={fetchStats} disabled={statsLoading} startIcon={<RefreshIcon />}>Refresh</Button>
                </Box>

                {stats ? (
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6} md={3}>
                      <Card>
                        <CardContent>
                          <Box display="flex" alignItems="center" gap={2}>
                            <StorageIcon fontSize="large" color="primary" />
                            <Box>
                              <Typography variant="subtitle2" color="textSecondary">Channels</Typography>
                              <Typography variant="h6">{`${stats.channels ? stats.channels.online : '—'} / ${stats.channels ? stats.channels.total : '—'}`}</Typography>
                            </Box>
                          </Box>
                        </CardContent>
                      </Card>
                    </Grid>

                    <Grid item xs={12} sm={6} md={3}>
                      <Card>
                        <CardContent>
                          <Box display="flex" alignItems="center" gap={2}>
                            <VisibilityIcon fontSize="large" color="primary" />
                            <Box>
                              <Typography variant="subtitle2" color="textSecondary">Seen cache</Typography>
                              <Typography variant="h6">{stats.seen ? stats.seen.size : '—'}</Typography>
                              <Typography variant="caption" color="textSecondary">TTL: {stats.seen ? stats.seen.ttl : '—'} ms · Max: {stats.seen ? stats.seen.maxEntries : '—'}</Typography>
                            </Box>
                          </Box>
                        </CardContent>
                      </Card>
                    </Grid>

                    <Grid item xs={12} sm={6} md={3}>
                      <Card>
                        <CardContent>
                          <Box display="flex" alignItems="center" gap={2}>
                            <RepeatIcon fontSize="large" color="primary" />
                            <Box>
                              <Typography variant="subtitle2" color="textSecondary">Digipeats</Typography>
                              <Typography variant="h6">{stats.metrics && typeof stats.metrics.digipeats !== 'undefined' ? stats.metrics.digipeats : '—'}</Typography>
                            </Box>
                          </Box>
                        </CardContent>
                      </Card>
                    </Grid>

                    <Grid item xs={12} sm={6} md={3}>
                      <Card>
                        <CardContent>
                          <Box display="flex" alignItems="center" gap={2}>
                            <GroupIcon fontSize="large" color="primary" />
                            <Box>
                              <Typography variant="subtitle2" color="textSecondary">Unique stations</Typography>
                              <Typography variant="h6">{stats.metrics && typeof stats.metrics.uniqueStations !== 'undefined' ? stats.metrics.uniqueStations : (stats.seen ? stats.seen.size : '—')}</Typography>
                            </Box>
                          </Box>
                        </CardContent>
                      </Card>
                    </Grid>

                    {stats.metrics && Object.keys(stats.metrics).filter(k => !['digipeats','uniqueStations'].includes(k)).map(k => (
                      <Grid item xs={12} sm={6} md={3} key={k}>
                        <Card>
                          <CardContent>
                            <Typography variant="subtitle2" color="textSecondary">{k}</Typography>
                            <Typography variant="h6">{stats.metrics[k]}</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                    ))}
                  </Grid>
                ) : (
                  <Paper style={{ padding: 12 }}>
                    <Typography variant="body2">{statsLoading ? 'Loading...' : 'No stats available'}</Typography>
                  </Paper>
                )}
              </Box>
            </Box>
          )}

          {page === 'frames' && (
            <Box>
              <Typography variant="h4">Frames — live</Typography>
              <Box display="flex" gap={2} alignItems="center" marginTop={1} marginBottom={1}>
                <Typography variant="body2">Showing {frames.length} recent frames</Typography>
                <Box display="flex" alignItems="center" gap={1}>
                  <label style={{ fontSize: 12, color: '#666' }}><input type="checkbox" checked={showHex} onChange={(e) => setShowHex(e.target.checked)} style={{ marginRight: 6 }} />Show hex</label>
                </Box>
              </Box>

              <Paper style={{ padding: 12, maxHeight: 600, overflow: 'auto' }}>
                <List>
                  {frames.map((f, i) => {
                    const ts = new Date(f.ts || Date.now()).toLocaleTimeString();
                    const parsed = f.parsed;
                    const from = parsed && parsed.addresses && parsed.addresses[1] ? `${parsed.addresses[1].callsign}${typeof parsed.addresses[1].ssid === 'number' ? ('-' + parsed.addresses[1].ssid) : ''}` : '??';
                    const to = parsed && parsed.addresses && parsed.addresses[0] ? parsed.addresses[0].callsign : '??';
                    const pathParts = parsed ? ( (parsed.addresses || []).slice(2).map(a=>`${a.callsign}${a.marked? '*' : ''}${typeof a.ssid === 'number' ? ('-' + a.ssid) : ''}`) ) : [];
                    const path = pathParts.join(', ');
                    const payloadText = parsed && parsed.payload ? decodePayload(parsed.payload) : '';
                    const dir = f._direction === 'tx' ? 'T' : 'R';
                    const len = (parsed && parsed.payload) ? (parsed.payload.type === 'Buffer' && Array.isArray(parsed.payload.data) ? parsed.payload.data.length : (Array.isArray(parsed.payload) ? parsed.payload.length : (parsed.payload && parsed.payload.buffer && parsed.payload.buffer.byteLength ? parsed.payload.buffer.byteLength : (typeof parsed.payload === 'string' ? new TextEncoder().encode(parsed.payload).length : (f.length || 0))))) : (f.length || 0);

                    return (
                      <ListItem key={i} divider>
                        <Box style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <Box style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <Chip label={`Fm ${from}`} size="small" />
                            <Chip label={`To ${to}`} size="small" />
                            {pathParts.map((p, idx) => <Chip key={idx} label={p} size="small" color={p.includes('*') ? 'primary' : 'default'} />)}
                            <Chip label={`Len=${len}`} size="small" />
                            <Typography variant="caption" style={{ marginLeft: 'auto' }}>{`${ts}${dir}`}</Typography>
                          </Box>
                          <Box style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                            {showHex ? (parsed && parsed.payload ? hexDump(parsed.payload, 512) : '') : sanitizeText(payloadText)}
                          </Box>
                        </Box>
                      </ListItem>
                    )
                  })}
                </List>
              </Paper>
            </Box>
          )}

          {page === 'lastheard' && <LastHeard />}

          {page === 'settings' && <SettingsPage />}
          {page === 'alerts' && <ActiveAlerts />}
  {/* BBS pages temporarily disabled for future release */}
  {/* {page === 'bbs' && <BBS />} */}
  {/* {page === 'bbs-settings' && <BBSSettings />} */}
        </Container>
      </Box>

      {/* Footer */}
      <footer style={{ textAlign: 'center', padding: '1rem', background: '#f5f5f5' }}>
        <Typography variant="body2" color="textSecondary">
          © 2025 Jordan G Webb, NA4WX
        </Typography>
      </footer>
    </Box>
  )
}
