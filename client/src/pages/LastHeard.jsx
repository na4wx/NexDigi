import React, { useEffect, useState } from 'react'
import { Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Button, Dialog, DialogTitle, DialogContent, DialogContentText, TextField, TableSortLabel } from '@mui/material'
import axios from 'axios'

export default function LastHeard() {
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(200)
  const [sortBy, setSortBy] = useState('ts')
  const [sortDir, setSortDir] = useState('desc')
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const backend = `http://${location.hostname}:3000`;

  const fetch = async () => {
    try {
      const params = {}
      if (q) params.q = q
      if (limit) params.limit = limit
      const resp = await axios.get(`${backend}/api/lastheard`, { params })
      setRows(Array.isArray(resp.data) ? resp.data : [])
    } catch (e) { console.error('LastHeard fetch failed', e); setRows([]) }
  }

  useEffect(() => { fetch() }, [])

  const showParsed = (r) => { setSelected(r); setOpen(true) }

  const handleSort = (col) => {
    if (sortBy === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(col)
      setSortDir('asc')
    }
  }

  const sortedRows = React.useMemo(() => {
    const copy = Array.isArray(rows) ? rows.slice() : []
    copy.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      try {
        if (sortBy === 'callsign') {
          const aa = (a.callsign || '').toUpperCase()
          const bb = (b.callsign || '').toUpperCase()
          return aa.localeCompare(bb) * dir
        }
        if (sortBy === 'ssid') {
          const na = (typeof a.ssid === 'number') ? a.ssid : (a.callsign && a.callsign.split('-')[1] ? Number(a.callsign.split('-')[1]) : -1)
          const nb = (typeof b.ssid === 'number') ? b.ssid : (b.callsign && b.callsign.split('-')[1] ? Number(b.callsign.split('-')[1]) : -1)
          return (na - nb) * dir
        }
        if (sortBy === 'mode') {
          const aa = (a.mode || '').toUpperCase()
          const bb = (b.mode || '').toUpperCase()
          return aa.localeCompare(bb) * dir
        }
        if (sortBy === 'channel') {
          const aa = (a.channel || '').toUpperCase()
          const bb = (b.channel || '').toUpperCase()
          return aa.localeCompare(bb) * dir
        }
        // default: ts
        const ta = Number(a.ts || 0)
        const tb = Number(b.ts || 0)
        return (ta - tb) * dir
      } catch (e) { return 0 }
    })
    return copy
  }, [rows, sortBy, sortDir])

  return (
    <Box>
      <Typography variant="h4">Last Heard</Typography>
      <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>Stations and frames heard in the last 48 hours</Typography>

      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <TextField size="small" label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <TextField size="small" type="number" label="Limit" value={limit} onChange={(e) => setLimit(Number(e.target.value) || 100)} />
        <Button variant="contained" onClick={() => fetch()}>Search</Button>
      </Box>

      <Paper>
        <TableContainer sx={{ maxHeight: 600 }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell sortDirection={sortBy === 'callsign' ? sortDir : false}>
                  <TableSortLabel active={sortBy === 'callsign'} direction={sortBy === 'callsign' ? sortDir : 'asc'} onClick={() => handleSort('callsign')}>Callsign</TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortBy === 'ssid' ? sortDir : false}>
                  <TableSortLabel active={sortBy === 'ssid'} direction={sortBy === 'ssid' ? sortDir : 'asc'} onClick={() => handleSort('ssid')}>SSID</TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortBy === 'mode' ? sortDir : false}>
                  <TableSortLabel active={sortBy === 'mode'} direction={sortBy === 'mode' ? sortDir : 'asc'} onClick={() => handleSort('mode')}>Mode</TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortBy === 'ts' ? sortDir : false}>
                  <TableSortLabel active={sortBy === 'ts'} direction={sortBy === 'ts' ? sortDir : 'desc'} onClick={() => handleSort('ts')}>Last Seen</TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortBy === 'channel' ? sortDir : false}>
                  <TableSortLabel active={sortBy === 'channel'} direction={sortBy === 'channel' ? sortDir : 'asc'} onClick={() => handleSort('channel')}>Channel</TableSortLabel>
                </TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedRows.map((r, i) => (
                <TableRow key={i} hover>
                  <TableCell>{r.callsign || '—'}</TableCell>
                  <TableCell>{(typeof r.ssid === 'number') ? r.ssid : (r.callsign && r.callsign.split('-')[1]) || '—'}</TableCell>
                  <TableCell>{r.mode || 'APRS'}</TableCell>
                  <TableCell>{r.ts ? new Date(r.ts).toLocaleString() : '—'}</TableCell>
                  <TableCell>{r.channel || '—'}</TableCell>
                  <TableCell><Button size="small" onClick={() => showParsed(r)}>Show Parsed</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Parsed Frame</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {selected && (
              <Box sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                <div><strong>Callsign:</strong> {selected.callsign || '—'}</div>
                <div><strong>SSID:</strong> {(typeof selected.ssid === 'number') ? selected.ssid : '—'}</div>
                <div><strong>Mode:</strong> {selected.mode || '—'}</div>
                <div><strong>Channel:</strong> {selected.channel || '—'}</div>
                <div style={{ marginTop: 8 }}><strong>Raw:</strong></div>
                <div style={{ fontFamily: 'monospace', marginTop: 8 }}>{selected.raw || ''}</div>
                <div style={{ marginTop: 8 }}><strong>Parsed info (JSON):</strong></div>
                <pre style={{ maxHeight: 300, overflow: 'auto' }}>{selected.info ? JSON.stringify(selected.info, null, 2) : '—'}</pre>
              </Box>
            )}
          </DialogContentText>
        </DialogContent>
      </Dialog>
    </Box>
  )
}
