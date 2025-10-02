import React, { useEffect, useState } from 'react';
import { Box, Typography, Paper, List, ListItem, ListItemText, Chip } from '@mui/material';
import axios from 'axios';

export default function ActiveAlerts() {
  const [alerts, setAlerts] = useState([]);
  const backend = `http://${location.hostname}:3000`;

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const resp = await axios.get(`${backend}/api/digipeater/active-alerts`);
        const list = Array.isArray(resp.data) ? resp.data : [];
        // normalize items to a common shape for rendering
        const norm = list.map(item => {
          // new shape: { id, hash, lastSent, alert: { ... } }
          if (item && item.alert) {
            return Object.assign({ id: item.id, hash: item.hash || null, lastSent: item.lastSent || null }, item.alert);
          }
          // legacy shape: { id, headline, sent, expires, lastSent }
          return {
            id: item.id || (item.alert && item.alert.id) || 'unknown',
            headline: item.headline || (item.alert && item.alert.headline) || '',
            description: item.description || '',
            instruction: item.instruction || '',
            area: item.area || '',
            effective: item.effective || null,
            expires: item.expires || null,
            payload: item.sent || (item.alert && item.alert.payload) || null,
            lastSent: item.lastSent || null
          };
        });
        setAlerts(norm);
      } catch (e) { console.error('Failed to fetch active alerts', e); setAlerts([]); }
    };
    fetchAlerts();
  }, []);

  return (
    <Box>
      <Typography variant="h4">Active Weather Alerts</Typography>
      <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>Persisted NWS alerts matched against your SAME codes</Typography>
      <Paper sx={{ p: 2 }}>
        <List>
          {alerts.length === 0 && <ListItem><ListItemText primary="No active alerts" /></ListItem>}
          {alerts.map(a => (
            <ListItem key={a.id} divider>
              <Box sx={{ width: '100%' }}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>{a.headline || a.event || a.id}</Typography>
                  {a.expires && <Chip label={`Expires: ${new Date(a.expires).toLocaleString()}`} size="small" />}
                  {a.effective && <Chip label={`Effective: ${new Date(a.effective).toLocaleString()}`} size="small" />}
                  <Chip label={`Sent: ${a.lastSent ? new Date(a.lastSent * 1000).toLocaleString() : 'unknown'}`} size="small" />
                  {a.same && a.same.length > 0 && <Chip label={`SAME:${Array.isArray(a.same)?a.same.join(','):a.same}`} size="small" />}
                </Box>
                <Typography variant="body2" sx={{ mt: 1, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{a.payload || a.description || ''}</Typography>
                {a.url && <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>More: <a href={a.url} target="_blank" rel="noreferrer">{a.url}</a></Typography>}
              </Box>
            </ListItem>
          ))}
        </List>
      </Paper>
    </Box>
  );
}
