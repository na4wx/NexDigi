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

- Server: Node.js + Express + WebSocket streaming for frames and events
- Client: React + Vite + Material-UI settings UI (Channels, IGate)
- Channel adapters:
  - Serial KISS adapter (serialport) with auto-detection and write-queueing
  - KISS-TCP / SoundModem adapter for networked KISS servers
  - Mock adapter for testing
- AX.25 utilities:
  - Parsing of AX.25 frames and address fields
  - Digipeat servicing (WIDE and explicit digi callsign servicing)
  - Optionally append the digi callsign into the path when servicing
- Channel management:
  - Per-channel configuration (callsign, mode, igate, targets, serial/kiss options)
  - Per-channel enable/disable and reconnect endpoint
  - Per-channel periodic beacon support
  - Per-channel IGate toggle (global IGate client can be enabled/disabled)
- IGate client:
  - TCP client that logs in to APRS-IS (user/pass/port) and forwards parsed frames when enabled
  - Status endpoint (`/api/igate/status`) for UI visibility
- Debug and admin endpoints:
  - `/api/channels`, `/api/channels/:id/debug`, `/api/serial-ports`, `/api/serial-probe`, `/api/probe`, `/api/frames`
  - Recent frame ring buffer for the UI
- Routing: lightweight per-channel routes to specify cross-digipeat targets

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
