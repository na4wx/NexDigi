# NexDigi — APRS Digipeater Foundation (IN DEVELOPMENT)

⚠️ IN DEVELOPMENT — This project is actively under development. APIs, configuration, and on-disk layout will change.

Foundation for a modern APRS digipeater (Node.js backend + React + MUI frontend).

Quick start

1. Install root dependencies (backend):

   npm install

2. Install client dependencies and run both in dev:

   cd client; npm install

3. Run server and client in separate terminals:

   npm run dev:server
   cd client && npm run dev

Server runs on port 3000, client on Vite default 5173.

Current features

NexDigi is a modern APRS digipeater foundation with the following capabilities:

### Multi-channel support
- **Multiple radios/channels**: Configure and manage multiple channels, each representing a radio or connection.
- **Channel types**:
  - Serial KISS adapter: Supports direct serial connections to TNCs (e.g., hardware modems).
  - KISS-TCP adapter: Connects to networked KISS servers (e.g., SoundModem).
  - Mock adapter: Simulates channels for testing and development.

### Digipeating and routing
- **Cross-digipeating**: Define routes between channels to enable cross-digipeating (e.g., forwarding frames from one radio to another).
- **Selective digipeating**: Service WIDE paths or explicit digipeater callsigns.
- **Path modification**: Optionally append the digipeater's callsign to the path when servicing frames.
- **Loop prevention**: Implements a seen-cache with TTL and eviction to avoid frame loops.

### IGate integration
- **Global IGate client**: Forward frames to APRS-IS when enabled.
- **Per-channel IGate toggle**: Selectively enable or disable IGate forwarding for individual channels.
- **Status visibility**: View IGate connection status and activity in the UI.

### Channel management
- **Per-channel configuration**: Customize callsign, mode (e.g., digipeat), IGate settings, and adapter options (e.g., serial port, baud rate).
- **Dynamic control**: Enable, disable, or reconnect channels on the fly.
- **Periodic beacons**: Configure periodic beacon transmissions for each channel.

### Debugging and admin tools
- **API endpoints**:
  - `/api/channels`: Manage channels (list, create, update, delete).
  - `/api/routes`: Manage cross-digipeat routes.
  - `/api/serial-ports`: Discover available serial ports.
  - `/api/frames`: View recent frames.
- **Diagnostics**: Verbose logging and debug endpoints for troubleshooting.

### AX.25 utilities
- **Frame parsing**: Decode AX.25 frames and address fields.
- **SSID handling**: Supports WIDEn-N decrementing and H-bit marking for serviced entries.

### Frontend features
- **Settings UI**: Manage channels and IGate settings via a React + Material-UI interface.
- **Channel actions**: Perform actions like Edit, Beacon, Probe, Reconnect, and Delete directly from the UI.
- **Real-time updates**: View live frame activity and channel status.

These features make NexDigi a flexible and powerful foundation for building APRS digipeaters with modern tools.

What you can do today
1. Edit `server/config.json` to add or change channels and IGate settings.
2. Start the server: from project root run `npm run dev:server` (or `node server/index.js`).
3. Start the client: `cd client && npm run dev` (Vite dev server).
4. Use the Settings → Channels page to view channels, toggle IGate per-channel, and open the per-channel action menu (Edit / Beacon / Probe / Reconnect / Delete).

Planned features / roadmap (high level)
- BBS features (store messages, mailboxes, integration with APRS messages)
- Live chat UI and infra (real-time messaging between stations/users)
- Store-and-forward for APRS messages (persist messages until recipient's beacon/last-seen)
- Integration between APRS messages and BBS (route APRS messages into user mailboxes and vice‑versa)
- Authentication/ACLs for IGate and UI changes (role-based access for operators)
- Better tests, CI, and Docker/dev containers
- Optional: tighter APRS-IS filtering controls, duplicate-detection tuning, and advanced path rules

API

- GET /api/channels — list channels (includes `options` and `status`)
- POST /api/channels — create channel (body: { id, name, type, enabled, options })
- PUT /api/channels/:id — update channel
- DELETE /api/channels/:id — delete channel
- GET /api/routes — list routes
- POST /api/routes — add route { from,to }
- DELETE /api/routes — delete route { from,to }
- GET /api/serial-ports — list serial ports (if `serialport` installed)

Tests

Run test scripts in `server/` (if present):

```powershell
node server/test_ax25.js       # AX.25 parsing unit test
node server/test_integration.js # two-node integration test
node server/test_multi_hop.js   # multi-hop test
node server/test_loop_stress.js # loop stress test
```

Notes

- Per-channel digipeat targets are stored in `cfg.channels[].options.targets` and are synchronized to `cfg.routes` at runtime.
- AX.25 parsing supports WIDEn-N decrementing in SSID nibble and textual-suffix forms; serviced entries are H-bit marked.
- The ChannelManager implements a seen-cache with TTL and eviction to prevent loops.

Contributing

PRs welcome. If you'd like me to wire more UI controls (per-channel adapter status details, quick-target edit buttons in list rows), tell me which features to prioritize.

## License

Copyright (c) 2025 Jordan G Webb, NA4WX

This project is licensed under the MIT License — see the `LICENSE` file for details.
