import React, { useState } from 'react'
import { Box, Tabs, Tab } from '@mui/material'
import ChannelsPage from './Channels'
import IGatePage from './IGate'

export default function SettingsPage() {
  const [tab, setTab] = useState(0)
  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Tabs value={tab} onChange={(e, v) => setTab(v)}>
          <Tab label="Channels" />
          <Tab label="IGate" />
        </Tabs>
      </Box>

      <Box>
        {tab === 0 && <ChannelsPage />}
        {tab === 1 && <IGatePage />}
      </Box>
    </Box>
  )
}
