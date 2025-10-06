import React, { useEffect, useState } from 'react'
import { Box, Typography, List, ListItem, ListItemText, Paper, Button, TextField, Dialog, DialogTitle, DialogContent, DialogActions, IconButton, Select, MenuItem, FormControl, InputLabel, Switch, Menu } from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import RefreshIcon from '@mui/icons-material/Refresh'
import MoreVertIcon from '@mui/icons-material/MoreVert'

export default function ChannelsPage({ setGlobalMessage, children }) {
  const API_BASE = `${location.protocol}//${location.hostname}:3000`
  const [channels, setChannels] = useState([])
  const [ports, setPorts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ id: '', name: '', type: 'mock', options: {} })
  const [beaconOpen, setBeaconOpen] = useState(false)
  const [beaconChannel, setBeaconChannel] = useState(null)
  const [beaconForm, setBeaconForm] = useState({ dest: 'APRS', payload: 'Hello from NexDigi', path: ['WIDE2-2'] })
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [menuChannel, setMenuChannel] = useState(null)

  useEffect(() => { fetchChannels() }, [])

  useEffect(() => { fetchPorts() }, [])

  async function fetchPorts() {
    try {
      const res = await fetch(`${API_BASE}/api/serial-ports`)
      const json = await res.json()
      console.log('ports', json)
      setPorts(json)
    } catch (err) {
      console.error('fetchPorts error', err)
      setPorts([])
    }
  }

  async function fetchChannels() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/channels`)
      if (!res.ok) throw new Error(`status ${res.status}`)
      const json = await res.json()
      console.log('channels', json)
      setChannels(json)
    } catch (err) {
      console.error('fetchChannels error', err)
      setError(err.message)
      setChannels([])
    } finally {
      setLoading(false)
    }
  }

  function openNew() { 
    setEditing(null); 
    setForm({ 
      id: '', 
      name: '', 
      type: 'mock', 
      options: {}, 
      enabled: true 
    }); 
    setOpen(true) 
  }
  
  function openEdit(c) {
    const baseOpts = c.options || {};
    // ensure defaults for host/port and serial settings so displayed defaults are persisted on save
    const opts = Object.assign({
      host: '127.0.0.1',
      port: c.type === 'kiss-tcp' ? 8001 : (c.type === 'serial' ? '' : undefined),
      baud: c.type === 'serial' ? 9600 : undefined,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      rtscts: false,
      xon: false,
      xoff: false,
      verbose: false
    }, baseOpts);
    setEditing(c.id);
    setForm({ 
      id: c.id, 
      name: c.name, 
      type: c.type || 'mock', 
      options: opts, 
      enabled: c.enabled !== false 
    });
    setOpen(true);
  }

  async function save() {
    // ensure defaults are present for kiss-tcp so host/port persist even if the user didn't edit fields
    const opts = Object.assign({}, form.options || {});
    if (form.type === 'kiss-tcp') {
      if (!opts.host) opts.host = '127.0.0.1';
      if (!Object.prototype.hasOwnProperty.call(opts, 'port')) opts.port = 8001;
    }
    if (form.type === 'serial') {
      // ensure serial defaults are always persisted even if user didn't change UI controls
      if (!opts.port) opts.port = opts.port || '';
      if (!opts.baud) opts.baud = opts.baud || 9600;
      if (!Object.prototype.hasOwnProperty.call(opts, 'dataBits')) opts.dataBits = 8;
      if (!Object.prototype.hasOwnProperty.call(opts, 'stopBits')) opts.stopBits = 1;
      if (!Object.prototype.hasOwnProperty.call(opts, 'parity')) opts.parity = 'none';
      if (!Object.prototype.hasOwnProperty.call(opts, 'rtscts')) opts.rtscts = !!opts.rtscts;
      if (!Object.prototype.hasOwnProperty.call(opts, 'xon')) opts.xon = !!opts.xon;
      if (!Object.prototype.hasOwnProperty.call(opts, 'xoff')) opts.xoff = !!opts.xoff;
      if (!Object.prototype.hasOwnProperty.call(opts, 'verbose')) opts.verbose = !!opts.verbose;
    }
    const payload = { id: form.id, name: form.name, type: form.type, enabled: form.enabled, options: opts };
    if (editing) {
      await fetch(`${API_BASE}/api/channels/${editing}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    } else {
      await fetch(`${API_BASE}/api/channels`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    }
    // If we changed serial or kiss-tcp options, offer to reconnect now so changes take effect
    setOpen(false)
    fetchChannels()
    if (payload.type === 'serial' || payload.type === 'kiss-tcp') {
      if (confirm('Reconnect channel now to apply new settings? This may briefly close/open the port.')) {
        try {
          await fetch(`${API_BASE}/api/channels/${payload.id}/reconnect`, { method: 'POST' });
          if (typeof setGlobalMessage === 'function') setGlobalMessage('Reconnect requested'); else alert('Reconnect requested');
        } catch (e) {
          if (typeof setGlobalMessage === 'function') setGlobalMessage('Reconnect failed: ' + e.message); else alert('Reconnect failed: ' + e.message);
        }
      }
    }
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h5">Channels</Typography>
        <Box>
          <IconButton aria-label="refresh" onClick={() => { fetchPorts(); fetchChannels(); }} style={{ marginRight: 8 }}>
            <RefreshIcon />
          </IconButton>
          <Button variant="contained" onClick={openNew}>Add Channel</Button>
        </Box>
      </Box>

      {loading && <Typography>Loading...</Typography>}
      {error && <Typography color="error">Error: {error}</Typography>}

      <Paper style={{ padding: 12 }}>
        {channels.length === 0 && !loading ? (
          <Typography>No channels configured — use Add Channel or Refresh</Typography>
        ) : (
          <Box>
            <Box display="flex" fontWeight={600} mb={1} px={1} columnGap={2}>
              <Box width={280}>Name</Box>
              <Box width={180}>ID</Box>
              <Box width={120}>Type</Box>
              <Box width={220}>Status</Box>
              <Box flex={1}>Connection Info</Box>
              <Box width={100}>Enabled</Box>
              <Box width={80}></Box>
            </Box>
            {channels.map((c) => (
              <Box key={c.id} display="flex" alignItems="center" py={1.5} px={1} borderTop="1px solid #eee" columnGap={2}>
                <Box width={280}>{c.name}</Box>
                <Box width={180}>
                  <Typography variant="body2">{c.id}</Typography>
                </Box>
                <Box width={120}>
                  <Typography variant="body2">{c.type || 'mock'}</Typography>
                </Box>
                <Box width={220}>
                  <Typography variant="body1" style={{ fontWeight: 600 }}>{c.status && c.status.connected ? 'connected' : 'closed'}</Typography>
                  <Typography variant="caption" color="textSecondary" display="block">
                    {c.status && c.status.lastRx ? `rx ${new Date(c.status.lastRx).toLocaleTimeString()}` : ''}
                  </Typography>
                  <Typography variant="caption" color="textSecondary" display="block">
                    {c.status && c.status.lastTx ? `tx ${new Date(c.status.lastTx).toLocaleTimeString()}` : ''}
                  </Typography>
                </Box>
                <Box flex={1}>
                  <Typography variant="body2">
                    {c.type === 'serial' && c.options && c.options.port ? 
                      `${c.options.port} @ ${c.options.baud || 9600}` : 
                      c.type === 'kiss-tcp' && c.options ? 
                        `${c.options.host || '127.0.0.1'}:${c.options.port || 8001}` : 
                        '-'}
                  </Typography>
                </Box>
                <Box width={100}>
                      <Switch checked={c.enabled !== false} onChange={async (e) => {
                    const newVal = e.target.checked;
                    try {
                      console.log('Channel toggle clicked:', { id: c.id, type: c.type, newVal, channel: c });
                      const payload = { 
                        id: c.id, 
                        name: c.name, 
                        type: c.type, 
                        enabled: newVal, 
                        options: c.options || {} 
                      };
                      console.log('Sending payload:', payload);
                      const response = await fetch(`${API_BASE}/api/channels/${c.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
                      console.log('Response status:', response.status);
                      if (!response.ok) {
                        const errorText = await response.text();
                        console.error('Server error:', errorText);
                        alert('Server error: ' + errorText);
                        return;
                      }
                      fetchChannels();
                    } catch (err) { 
                      console.error('Toggle error:', err);
                      alert('Failed to update channel enabled state: ' + err.message);
                    }
                      }} />
                </Box>
                <Box width={80} display="flex" justifyContent="flex-end">
                  <IconButton size="small" onClick={(ev) => { setMenuAnchor(ev.currentTarget); setMenuChannel(c); }}>
                    <MoreVertIcon />
                  </IconButton>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Paper>

      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>{editing ? 'Edit Channel' : 'Add Channel'}</DialogTitle>
        <DialogContent>
          <Box display="flex" flexDirection="column" gap={2} mt={1}>
            <TextField label="ID" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} disabled={!!editing} />
            <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />

            <FormControl>
              <InputLabel id="type-label">Type</InputLabel>
              <Select labelId="type-label" value={form.type} label="Type" onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <MenuItem value="mock">mock</MenuItem>
                <MenuItem value="serial">serial</MenuItem>
                <MenuItem value="kiss-tcp">kiss-tcp</MenuItem>
              </Select>
            </FormControl>

            <Box display="flex" alignItems="center" gap={1}>
              <Typography>Enabled</Typography>
              <Switch checked={form.enabled !== false} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            </Box>

            {(form.type === 'serial' || form.type === 'kiss-tcp' || form.type === 'mock') && (
              <>
                <TextField 
                  label="BBS Response Delay (ms)" 
                  type="number" 
                  value={form.options.bbsDelayMs || 0} 
                  onChange={(e) => setForm({ ...form, options: { ...(form.options||{}), bbsDelayMs: Number(e.target.value) } })} 
                  helperText="Delay in milliseconds before BBS sends response frames (0 = no delay)"
                />
              </>
            )}

            {form.type === 'serial' && (
              <>
                <FormControl>
                  <InputLabel id="port-label">COM Port</InputLabel>
                  <Select labelId="port-label" value={form.options.port || ''} label="COM Port" onChange={(e) => setForm({ ...form, options: { ...(form.options||{}), port: e.target.value } })}>
                    {ports.map(p => <MenuItem key={p.path} value={p.path}>{p.path}{p.manufacturer?` — ${p.manufacturer}`:''}</MenuItem>)}
                  </Select>
                </FormControl>
                <TextField label="Baud" type="number" value={form.options.baud || 9600} onChange={(e) => setForm({ ...form, options: { ...(form.options||{}), baud: Number(e.target.value) } })} />
                <FormControl>
                  <InputLabel id="parity-label">Parity</InputLabel>
                  <Select labelId="parity-label" value={form.options.parity || 'none'} label="Parity" onChange={(e) => setForm({ ...form, options: { ...(form.options||{}), parity: e.target.value } })}>
                    <MenuItem value="none">None</MenuItem>
                    <MenuItem value="even">Even</MenuItem>
                    <MenuItem value="odd">Odd</MenuItem>
                  </Select>
                </FormControl>
                <FormControl>
                  <InputLabel id="databits-label">Data bits</InputLabel>
                  <Select labelId="databits-label" value={form.options.dataBits || 8} label="Data bits" onChange={(e) => setForm({ ...form, options: { ...(form.options||{}), dataBits: Number(e.target.value) } })}>
                    <MenuItem value={7}>7</MenuItem>
                    <MenuItem value={8}>8</MenuItem>
                  </Select>
                </FormControl>
                <FormControl>
                  <InputLabel id="stopbits-label">Stop bits</InputLabel>
                  <Select labelId="stopbits-label" value={form.options.stopBits || 1} label="Stop bits" onChange={(e) => setForm({ ...form, options: { ...(form.options||{}), stopBits: Number(e.target.value) } })}>
                    <MenuItem value={1}>1</MenuItem>
                    <MenuItem value={2}>2</MenuItem>
                  </Select>
                </FormControl>
                <Box display="flex" alignItems="center" gap={2}>
                  <Box>
                    <Typography variant="caption">RTS/CTS</Typography>
                    <Switch checked={!!(form.options && form.options.rtscts)} onChange={(e) => setForm({ ...form, options: { ...(form.options||{}), rtscts: e.target.checked } })} />
                  </Box>
                  <Box>
                    <Typography variant="caption">XON/XOFF</Typography>
                    <Switch checked={!!(form.options && form.options.xon)} onChange={(e) => setForm({ ...form, options: { ...(form.options||{}), xon: e.target.checked } })} />
                  </Box>
                </Box>
                <Box>
                  <Typography variant="caption">Verbose</Typography>
                  <Switch checked={!!(form.options && form.options.verbose)} onChange={(e) => setForm({ ...form, options: { ...(form.options||{}), verbose: e.target.checked } })} />
                </Box>
              </>
            )}

            {form.type === 'kiss-tcp' && (
              <>
                <TextField label="Host" value={form.options.host || '127.0.0.1'} onChange={(e) => setForm({ ...form, options: { ...(form.options||{}), host: e.target.value } })} />
                <TextField label="Port" type="number" value={form.options.port || 8001} onChange={(e) => setForm({ ...form, options: { ...(form.options||{}), port: Number(e.target.value) } })} />
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} variant="contained">Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={beaconOpen} onClose={() => setBeaconOpen(false)}>
        <DialogTitle>Send Beacon</DialogTitle>
        <DialogContent>
          <Box display="flex" flexDirection="column" gap={2} mt={1}>
            <TextField label="Channel" value={beaconChannel ? `${beaconChannel.name} (${beaconChannel.id})` : ''} disabled />
            <TextField label="Destination" value={beaconForm.dest} onChange={(e) => setBeaconForm({ ...beaconForm, dest: e.target.value })} helperText="Destination callsign (e.g. APRS)" />
            <TextField label="Payload" value={beaconForm.payload} onChange={(e) => setBeaconForm({ ...beaconForm, payload: e.target.value })} multiline />
            <TextField label="Path (comma-separated)" value={(beaconForm.path || []).join(',')} onChange={(e) => setBeaconForm({ ...beaconForm, path: e.target.value.split(',').map(s=>s.trim()).filter(Boolean) })} helperText="e.g. WIDE2-2" />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBeaconOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={async () => {
            if (!beaconChannel) return;
            const body = { channel: beaconChannel.id, dest: beaconForm.dest, source: beaconChannel.id, path: beaconForm.path, payload: beaconForm.payload };
            try {
              const res = await fetch(`${API_BASE}/api/beacon`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
              const j = await res.json();
              if (!res.ok) {
                alert('Beacon failed: ' + (j && j.error ? j.error : res.statusText));
                return;
              }
              setBeaconOpen(false);
            } catch (e) { alert('send failed: '+e.message) }
          }}>Send</Button>
        </DialogActions>
      </Dialog>
      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => { setMenuAnchor(null); setMenuChannel(null); }}>
        <MenuItem onClick={() => { if (menuChannel) openEdit(menuChannel); setMenuAnchor(null); setMenuChannel(null); }}>Edit</MenuItem>
        <MenuItem onClick={() => { if (menuChannel) { setBeaconChannel(menuChannel); setBeaconForm({ dest: 'APRS', payload: `Beacon from ${menuChannel.id}`, path: ['WIDE2-2'] }); setBeaconOpen(true); } setMenuAnchor(null); setMenuChannel(null); }}>Beacon</MenuItem>
        <MenuItem onClick={async () => {
          if (!menuChannel) return;
          try {
            const c = menuChannel;
            if (c.type === 'serial') {
              if (!c.options || !c.options.port) { alert('no COM port configured'); return; }
              const res = await fetch(`${API_BASE}/api/serial-probe?port=${encodeURIComponent(c.options.port)}&baud=${encodeURIComponent(c.options.baud||9600)}`);
              const j = await res.json();
              if (j.ok) alert('serial port available'); else alert('serial probe failed: '+(j.error||'unknown'));
            } else {
              if (!c.options || !c.options.host || !c.options.port) { alert('no host/port configured'); return; }
              const res = await fetch(`${API_BASE}/api/probe?host=${encodeURIComponent(c.options.host)}&port=${encodeURIComponent(c.options.port)}`);
              const j = await res.json();
              if (j.ok) alert('connectivity OK'); else alert('connectivity failed: '+(j.error||'unknown'));
            }
          } catch (e) { alert('probe failed: '+e.message) }
          setMenuAnchor(null); setMenuChannel(null);
        }}>Probe</MenuItem>
        <MenuItem onClick={async () => { if (!menuChannel) return; try { await fetch(`${API_BASE}/api/channels/${menuChannel.id}/reconnect`, { method: 'POST' }); alert('Reconnect requested'); fetchChannels(); } catch (e) { alert('reconnect failed: ' + e.message) } setMenuAnchor(null); setMenuChannel(null); }}>Reconnect</MenuItem>
        <MenuItem onClick={async () => { if (!menuChannel) return; if (!confirm(`Delete channel ${menuChannel.id}?`)) { setMenuAnchor(null); setMenuChannel(null); return; } await fetch(`${API_BASE}/api/channels/${menuChannel.id}`, { method: 'DELETE' }); fetchChannels(); setMenuAnchor(null); setMenuChannel(null); }}>
          <Typography color="error">Delete</Typography>
        </MenuItem>
      </Menu>
    </Box>
  )
}
