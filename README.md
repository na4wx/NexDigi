# NexDigi

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

What’s included

- Minimal KISS helpers
- Channel manager with mock adapters
- WebSocket API for live frames
- Vite + React client with MUI

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

Run test scripts in `server/`:

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
