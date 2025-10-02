import React, { useState } from 'react'
import { Box, Tabs, Tab, TextField } from '@mui/material'
import ChannelsPage from './Channels'
import IGatePage from './IGate'
// Temporarily hide BBS Settings tab for upcoming release
// import BBSSettings from './BBSSettings'
import DigipeaterSettings from './DigipeaterSettings'

export default function SettingsPage() {
  const [tab, setTab] = useState(0)
  const [channel, setChannel] = useState({ mode: 'None' })
  const modes = ['None', 'Digipeat', 'Packet', 'Digipeat + Packet']

  const handleModeChange = (newMode) => {
    setChannel((prev) => ({ ...prev, mode: newMode }))
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Tabs value={tab} onChange={(e, v) => setTab(v)}>
          <Tab label="Channels" />
          <Tab label="Digipeater" />
          <Tab label="IGate" />
          {/* BBS Settings tab temporarily hidden for future release */}
          {/* <Tab label="BBS Settings" /> */}
        </Tabs>
      </Box>

      <Box>
        {tab === 0 && (
          <ChannelsPage>
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
        {tab === 1 && <DigipeaterSettings />}
        {tab === 2 && <IGatePage />}
  {/* BBS Settings content temporarily hidden for future release */}
  {/* {tab === 3 && <BBSSettings />} */}
      </Box>
    </Box>
  )
}
