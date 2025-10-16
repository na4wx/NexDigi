import React, { useState } from 'react'
import { Box, Tabs, Tab, TextField, Alert } from '@mui/material'
import ChannelsPage from './Channels'
import IGatePage from './IGate'
import WinlinkSettings from './WinlinkSettings'
import BBSSettings from './BBSSettings'
import DigipeaterSettings from './DigipeaterSettings'
import NexNetSettings from './NexNetSettings'

export default function SettingsPage() {
  const [tab, setTab] = useState(0)
  const [channel, setChannel] = useState({ mode: 'None' })
  const [globalMessage, setGlobalMessage] = useState('')
  const modes = ['None', 'Digipeat', 'Packet', 'Digipeat + Packet']

  const handleModeChange = (newMode) => {
    setChannel((prev) => ({ ...prev, mode: newMode }))
  }

  return (
    <Box>
      {globalMessage && (
        <Box sx={{ mb: 1, position: 'sticky', top: 64, zIndex: 1400 }}>
          <Alert severity={globalMessage.includes('Error') ? 'error' : 'success'} sx={{ position: 'relative' }}>
            {globalMessage}
          </Alert>
        </Box>
      )}

      <Box sx={{ position: 'sticky', top: 64, zIndex: 1200, backgroundColor: 'background.paper', borderBottom: '1px solid rgba(0,0,0,0.08)' }} display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Tabs value={tab} onChange={(e, v) => setTab(v)}>
          <Tab label="Channels" />
          <Tab label="Digipeater" />
          <Tab label="IGate" />
          <Tab label="BBS Settings" />
          <Tab label="Winlink" />
          <Tab label="NexNet" />
        </Tabs>
      </Box>

      <Box>
        {tab === 0 && (
          <ChannelsPage setGlobalMessage={setGlobalMessage}>
            <TextField
              select
              label="Mode"
              value={channel.mode}
              onChange={(e) => handleModeChange(e.target.value)}
              SelectProps={{ native: true }}
              fullWidth
            >
              {modes.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </TextField>
          </ChannelsPage>
        )}
  {tab === 1 && <DigipeaterSettings setGlobalMessage={setGlobalMessage} />}
    {tab === 2 && <IGatePage setGlobalMessage={setGlobalMessage} />}
    {tab === 3 && <BBSSettings setGlobalMessage={setGlobalMessage} />}
    {tab === 4 && <WinlinkSettings setGlobalMessage={setGlobalMessage} />}
    {tab === 5 && <NexNetSettings setGlobalMessage={setGlobalMessage} />}
      </Box>
    </Box>
  )
}
