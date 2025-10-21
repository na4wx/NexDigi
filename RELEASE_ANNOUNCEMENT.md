# NexDigi v1.0.0 Release Announcement

**Release Date:** October 20, 2025  
**Author:** Jordan G Webb, NA4WX  
**License:** MIT

---

## 🎉 Introducing NexDigi v1.0.0

We're excited to announce the first stable release of **NexDigi** - a modern, full-featured APRS digipeater and mesh networking system built with Node.js and React!

## What is NexDigi?

NexDigi is a next-generation amateur radio packet system that combines:
- **APRS Digipeater** - WIDEn-N and WIDE1-1 fill-in modes
- **IGate** - Bidirectional RF ↔ APRS-IS gateway with TLS support
- **BBS** - Bulletin Board System with connected-mode sessions
- **NexNet Mesh** - Encrypted mesh networking with Ed25519 authentication
- **Chat System** - Keyboard-to-keyboard chat with cross-node synchronization
- **Weather Alerts** - NWS integration with SAME code filtering
- **Web UI** - Modern React interface with Material-UI

## 🚀 Key Features in v1.0.0

### Core Functionality
- Multi-channel support (Serial TNC, KISS-TCP, Direwolf, Soundmodem)
- AX.25 frame parsing and manipulation
- Path processing and digipeating
- Real-time frame viewer
- WebSocket real-time updates

### NexNet Mesh Networking
- Ed25519 cryptographic authentication
- Link State Routing with Dijkstra algorithm
- QoS with 4-level priority queuing
- Chat synchronization with vector clocks
- BBS synchronization across nodes
- Weather alert distribution

### Developer Experience
- Interactive setup wizard (`npm run setup`)
- Comprehensive documentation (5 guides)
- 70+ unit tests with CI/CD
- Example configurations for common scenarios
- Helper scripts for backup, reset, validation
- GitHub Actions automation

### Production Ready
- Health check endpoints for monitoring
- Prometheus-compatible metrics
- Systemd service integration
- Logging with rotation
- Configuration validation
- Error handling and recovery

## 📥 Installation

### Quick Start

```bash
# Download and extract
wget https://github.com/na4wx/NexDigi/releases/download/v1.0.0/nexdigi-1.0.0.tar.gz
tar -xzf nexdigi-1.0.0.tar.gz
cd nexdigi-1.0.0

# Run setup wizard
npm run setup

# Start server
npm run dev
```

### Platform Support
- **Linux**: Debian, Ubuntu, Raspbian (ARM/x64)
- **Windows**: Windows 10/11
- **macOS**: 10.15+

See [INSTALL.md](docs/INSTALL.md) for detailed instructions.

## 📚 Documentation

Complete documentation included:
- **[INSTALL.md](docs/INSTALL.md)** - Installation guide for all platforms
- **[CONFIGURATION.md](docs/CONFIGURATION.md)** - Channel setup, digipeater, IGate, BBS config
- **[NEXNET.md](docs/NEXNET.md)** - Mesh networking guide
- **[API.md](docs/API.md)** - REST API and WebSocket reference
- **[TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)** - Common issues and solutions
- **[CONTRIBUTING.md](docs/CONTRIBUTING.md)** - Contributor guidelines

## 🎯 Use Cases

### 1. Simple Digipeater
Fill-in coverage for weak areas with WIDE1-1 mode.

### 2. IGate Station
Bidirectional gateway between RF and APRS-IS with geographic filtering.

### 3. Emergency Communications
NexNet mesh network with BBS and chat synchronization for resilient messaging.

### 4. Multi-Band Operations
Support for VHF, UHF, and HF simultaneously with independent configuration.

### 5. Headless Server
Remote/unattended deployment with systemd integration and health monitoring.

## 🔧 Example Configurations

Five ready-to-use example configurations included in `examples/`:
- **basic-digipeater.json** - Minimal WIDE1-1 fill-in
- **mesh-node.json** - Full NexNet mesh with synchronization
- **igate-only.json** - Dedicated IGate with TLS
- **full-featured.json** - All features enabled (VHF/UHF/HF)
- **headless-server.json** - Production server deployment

## 🧪 Testing

Comprehensive test suite:
- 27+ tests for AX.25 frame parsing
- 22+ tests for channel management
- 25+ tests for BBS operations
- Automated CI/CD with GitHub Actions
- Multi-version Node.js testing (18, 20)

Run tests: `npm test`

## 🔐 Security

- Ed25519 cryptographic authentication for mesh
- Password-protected web UI
- TLS support for APRS-IS connections
- Input validation on all API endpoints
- npm audit security scanning in CI

## 🛠️ Development Tools

New helper scripts for developers:
- `npm run setup` - Interactive configuration wizard
- `npm run reset` - Reset database with backup
- `npm run backup` - Create timestamped backups
- `npm run validate` - Validate configuration
- `npm test` - Run unit tests
- `npm run lint` - ESLint with auto-fix

## 📊 Statistics

- **Lines of Code**: ~15,000
- **Documentation**: 5 guides, 2,500+ lines
- **Tests**: 70+ unit tests
- **Example Configs**: 5 ready-to-use examples
- **Supported Channels**: 4 types (Serial, KISS-TCP, Mock, Soundmodem)

## 🙏 Acknowledgments

Thanks to:
- The amateur radio community for feedback and testing
- APRS.org and Bob Bruninga, WB4APR (SK)
- Direwolf developers for excellent TNC software
- Contributors and beta testers

## 🗺️ Roadmap

Planned for future releases:
- APRS messaging improvements
- Mobile app for remote management
- Additional modem support (AGW, AGWPE)
- Advanced routing algorithms
- Performance optimizations
- Code coverage reporting

## 📞 Support

- **Documentation**: [docs/](docs/)
- **Issues**: https://github.com/na4wx/NexDigi/issues
- **Discussions**: https://github.com/na4wx/NexDigi/discussions
- **Contributing**: [CONTRIBUTING.md](docs/CONTRIBUTING.md)

## 📄 License

NexDigi is released under the MIT License. See [LICENSE](LICENSE) for details.

## 🔗 Links

- **GitHub**: https://github.com/na4wx/NexDigi
- **Releases**: https://github.com/na4wx/NexDigi/releases
- **Changelog**: [CHANGELOG.md](CHANGELOG.md)

## 📣 Spread the Word

Help us grow the project:
- ⭐ Star the repository on GitHub
- 🐛 Report bugs and request features
- 📝 Contribute documentation or code
- 💬 Share on ham radio forums
- 📻 Tell your local club

## 🎊 Getting Started

1. **Download**: Get v1.0.0 from [releases page](https://github.com/na4wx/NexDigi/releases/tag/v1.0.0)
2. **Install**: Follow [INSTALL.md](docs/INSTALL.md)
3. **Configure**: Run `npm run setup` or use example configs
4. **Connect**: Hook up your TNC and radio
5. **Enjoy**: Monitor APRS traffic, digipeat, or join the mesh!

---

**73 de NA4WX**

*Amateur Radio - Connecting the World*

---

## Version Details

**Release**: v1.0.0  
**Date**: October 20, 2025  
**Commit**: [GitHub tag](https://github.com/na4wx/NexDigi/releases/tag/v1.0.0)  
**Checksums**: SHA256SUMS.txt included in release assets  

### Downloads

- **Full Package**: `nexdigi-1.0.0.tar.gz` (12 MB)
- **Full Package (Windows)**: `nexdigi-1.0.0.zip` (12 MB)
- **Server Only**: `nexdigi-server-1.0.0.tar.gz` (8 MB)
- **Checksums**: `SHA256SUMS.txt`

### Verify Download

```bash
sha256sum -c SHA256SUMS.txt
```

### System Requirements

**Minimum:**
- Node.js 18+
- 512 MB RAM
- 100 MB disk space
- Linux/Windows/macOS

**Recommended:**
- Node.js 20+
- 2 GB RAM
- 1 GB disk space
- Multi-core CPU for mesh networking

### Hardware Compatibility

**TNCs:**
- MobilinkD (all models)
- Kantronics KPC-3+
- Byonics TinyTrak
- Any KISS-compatible TNC

**Software TNCs:**
- Direwolf 1.6+
- Soundmodem
- UZ7HO Soundmodem

**Radios:**
- Any FM VHF/UHF radio with data port
- HF radios with soundcard interface

---

**Questions?** Open an [issue](https://github.com/na4wx/NexDigi/issues) or start a [discussion](https://github.com/na4wx/NexDigi/discussions)!
