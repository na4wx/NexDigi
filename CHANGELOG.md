# Changelog

All notable changes to NexDigi will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Nothing yet

### Changed
- Nothing yet

### Fixed
- Nothing yet

## [1.0.0] - 2025-10-20

### Added
- NexNet Chat Distribution with vector clock conflict resolution
- Chat synchronization across mesh nodes with ChatSyncManager
- Health check endpoints for monitoring (`/api/health`, `/api/health/liveness`, `/api/health/readiness`, `/api/health/metrics`)
- Comprehensive documentation suite (INSTALL.md, CONFIGURATION.md, NEXNET.md, API.md, TROUBLESHOOTING.md)
- Contributing guidelines (CONTRIBUTING.md) with code of conduct and style guide
- Installation scripts for Linux/Mac and Windows (full, server-only, client-only)
- Interactive setup wizard (`npm run setup`)
- Database reset utility with backup (`npm run reset`)
- Data backup utility with auto-cleanup (`npm run backup`)
- Configuration validator (`npm run validate`)
- Test runner with pass/fail reporting (`npm test`)
- Unit tests for core modules (ax25.js, channelManager.js, bbs.js)
- Example configurations (basic-digipeater, mesh-node, igate-only, full-featured, headless-server)
- GitHub Actions CI/CD workflows (automated testing, releases)
- Test suite with 70+ unit tests

### Changed
- Updated package.json with 9 helper scripts for developer experience
- Improved server startup logging with better error messages
- Enhanced error handling throughout codebase
- Version bumped to 1.0.0 for production release

### Fixed
- Various bug fixes and stability improvements
- Frame parsing edge cases
- Channel reconnection logic
- Memory leak in message deduplication

## [0.8.100225] - 2025-01-02

### Added
- Multi-server authentication with persistent sessions
- Chat history manager with retention policies
- Last heard station tracking
- Metric alerts and monitoring
- Beacon scheduler improvements
- Message alert manager for BBS notifications
- Weather alert distribution via APRS and NexNet

### Changed
- Refactored channel management
- Improved WebSocket authentication
- Enhanced BBS session handling

### Fixed
- Serial port handling on various platforms
- Memory leaks in frame processing
- APRS-IS connection stability

## [0.7.0] - 2024-12-15

### Added
- NexNet mesh networking (BackboneManager)
- Ed25519 cryptographic authentication for mesh
- Link State Routing with Dijkstra algorithm
- QoS with 4-level priority queuing
- BBS (Bulletin Board System)
- Connected-mode BBS sessions
- APRS message handling for BBS
- Winlink gateway integration
- Weather alerts from NWS API

### Changed
- Migrated to React + Material-UI for frontend
- Improved channel adapter architecture
- Enhanced frame parsing and validation

### Fixed
- KISS protocol handling
- Digipeater path processing
- IGate duplicate frame detection

## [0.6.0] - 2024-11-01

### Added
- APRS-IS IGate functionality
- Bidirectional gating (RF ↔ APRS-IS)
- APRS-IS server filtering
- TLS support for APRS-IS connections
- Live frame viewer in web UI

### Changed
- Improved channel status reporting
- Enhanced error logging

### Fixed
- Frame timestamp accuracy
- Channel disconnection handling

## [0.5.0] - 2024-10-15

### Added
- APRS digipeater functionality
- WIDEn-N path processing
- WIDE1-1 fill-in mode
- Rate limiting for digipeater
- Duplicate frame detection
- Per-channel digipeater overrides

### Changed
- Optimized frame processing pipeline
- Improved memory management

### Fixed
- AX.25 address parsing edge cases
- Path manipulation bugs

## [0.4.0] - 2024-09-20

### Added
- Multi-channel support
- Serial KISS adapter
- KISS-TCP adapter (Direwolf/SoundModem)
- Mock adapter for testing
- Channel routing and bridging
- Web-based configuration UI

### Changed
- Modular adapter architecture
- Improved configuration management

### Fixed
- Serial port permission handling on Linux
- KISS frame escaping

## [0.3.0] - 2024-08-10

### Added
- AX.25 frame parsing and building
- Basic APRS packet decoding
- Frame hex dump viewer
- WebSocket real-time updates

### Changed
- Server architecture to support multiple adapters

### Fixed
- Frame CRC calculation
- Address SSID handling

## [0.2.0] - 2024-07-05

### Added
- Web UI with React
- Express REST API
- Configuration file support (config.json)
- Basic channel management

### Changed
- Migrated from CLI to web-based interface

## [0.1.0] - 2024-06-01

### Added
- Initial release
- Basic serial TNC support
- KISS protocol implementation
- Simple frame viewer
- Command-line interface

---

## Release Process

### Versioning

We use [Semantic Versioning](https://semver.org/):
- **MAJOR** version for incompatible API changes
- **MINOR** version for backwards-compatible functionality additions
- **PATCH** version for backwards-compatible bug fixes

### Release Checklist

Before creating a new release:

1. **Update version number:**
   - [ ] `package.json`
   - [ ] `client/package.json`
   - [ ] This CHANGELOG.md

2. **Update documentation:**
   - [ ] README.md (if needed)
   - [ ] API.md (if API changed)
   - [ ] CONFIGURATION.md (if config changed)

3. **Run tests:**
   ```bash
   npm test
   npm run validate
   ```

4. **Build client:**
   ```bash
   npm run build
   ```

5. **Create git tag:**
   ```bash
   git tag -a v1.0.0 -m "Release v1.0.0"
   git push origin v1.0.0
   ```

6. **Create GitHub release:**
   - Upload built client assets
   - Include installation scripts
   - Write release notes

7. **Announce:**
   - GitHub Discussions
   - Ham radio forums
   - Reddit r/amateurradio

---

## Migration Guides

### Upgrading to 1.0.0 from 0.x

**Breaking Changes:**
- Authentication is now required by default (set `uiPassword` in config.json)
- Channel configuration structure changed (see CONFIGURATION.md)
- NexNet requires Ed25519 keypair generation

**Steps:**
1. Backup your data: `npm run backup`
2. Update configuration format (see docs/CONFIGURATION.md)
3. Generate NexNet keys if using mesh networking
4. Restart server

**New Features:**
- Chat synchronization across mesh
- Health monitoring endpoints
- Improved documentation
- Installation scripts

---

## Deprecation Warnings

### Upcoming Changes

**v2.0.0 (Future):**
- Legacy KISS protocol support may be deprecated in favor of newer standards
- AGW protocol support evaluation pending
- Configuration file format may change (migration tool will be provided)

---

## Contributors

Thank you to all contributors who have helped make NexDigi better!

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for guidelines on how to contribute.

---

## License

NexDigi is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

**For the latest updates, visit:** https://github.com/na4wx/NexDigi
