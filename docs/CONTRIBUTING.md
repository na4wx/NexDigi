# Contributing to NexDigi

Thank you for your interest in contributing to NexDigi! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Testing Requirements](#testing-requirements)
- [Documentation Requirements](#documentation-requirements)
- [Issue Reporting](#issue-reporting)
- [Feature Requests](#feature-requests)

---

## Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inclusive environment for all contributors, regardless of experience level, background, or identity.

### Our Standards

**Positive behaviors include:**
- Using welcoming and inclusive language
- Being respectful of differing viewpoints and experiences
- Gracefully accepting constructive criticism
- Focusing on what is best for the community
- Showing empathy towards other community members

**Unacceptable behaviors include:**
- Harassment, trolling, or derogatory comments
- Personal or political attacks
- Publishing others' private information without permission
- Other conduct which could reasonably be considered inappropriate

### Enforcement

Project maintainers have the right and responsibility to remove, edit, or reject comments, commits, code, issues, and other contributions that do not align with this Code of Conduct.

---

## Getting Started

### Prerequisites

- **Node.js** 18.x or higher
- **npm** 8.x or higher
- **Git** for version control
- Basic knowledge of JavaScript, React, and packet radio

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR-USERNAME/NexDigi.git
   cd NexDigi
   ```
3. Add upstream remote:
   ```bash
   git remote add upstream https://github.com/na4wx/NexDigi.git
   ```

### Keep Your Fork Synced

```bash
git fetch upstream
git checkout main
git merge upstream/main
git push origin main
```

---

## Development Setup

### 1. Install Dependencies

```bash
# Install all dependencies (server + client)
npm run install:all

# Or manually:
npm install              # Server dependencies
cd client && npm install # Client dependencies
```

### 2. Run Setup Wizard (Optional)

```bash
npm run setup
```

This will create an initial configuration file at `server/config.json`.

### 3. Start Development Server

```bash
npm run dev
```

This starts:
- **Backend server** on `http://localhost:3000` (with hot reload)
- **Frontend dev server** on `http://localhost:5173` (with hot reload)

The frontend will proxy API requests to the backend automatically.

### 4. Access the Application

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:3000/api
- **WebSocket:** ws://localhost:3000

---

## Project Structure

```
NexDigi/
├── client/              # React frontend (Vite + MUI)
│   ├── src/
│   │   ├── App.jsx      # Main app component
│   │   ├── main.jsx     # Entry point
│   │   └── pages/       # Page components
│   ├── package.json
│   └── vite.config.js
├── server/              # Node.js backend
│   ├── index.js         # Server entry point
│   ├── config.json      # Configuration file
│   ├── data/            # Data storage (JSON files)
│   ├── lib/             # Core libraries
│   │   ├── ax25.js      # AX.25 frame parsing/building
│   │   ├── channelManager.js  # Channel management
│   │   ├── bbs.js       # Bulletin board system
│   │   ├── chatManager.js     # Chat system
│   │   ├── ChatSyncManager.js # Chat mesh sync
│   │   ├── backbone/    # NexNet mesh networking
│   │   └── adapters/    # Hardware adapters
│   └── routes/          # Express API routes
├── scripts/             # Helper scripts
│   ├── setup-wizard.js  # Interactive setup
│   ├── backup-data.js   # Backup utility
│   ├── reset-database.js # Reset data
│   └── install.sh       # Installation scripts
├── docs/                # Documentation
│   ├── INSTALL.md
│   ├── CONFIGURATION.md
│   ├── API.md
│   ├── NEXNET.md
│   └── TROUBLESHOOTING.md
├── package.json
└── README.md
```

---

## Coding Standards

### JavaScript Style

- **Indentation:** 2 spaces (no tabs)
- **Semicolons:** Required
- **Quotes:** Single quotes for strings
- **Line length:** 120 characters max
- **Trailing commas:** Yes (for multi-line arrays/objects)

### Example

```javascript
// Good
const myFunction = (param1, param2) => {
  const result = {
    value: param1,
    name: param2,
  };
  
  return result;
};

// Bad
function myFunction(param1,param2){
  var result={value:param1,name:param2}
  return result
}
```

### Naming Conventions

- **Variables/Functions:** camelCase (`myVariable`, `calculateTotal`)
- **Classes:** PascalCase (`ChannelManager`, `BBSSession`)
- **Constants:** UPPER_SNAKE_CASE (`MAX_RETRIES`, `DEFAULT_PORT`)
- **Files:** camelCase for JS (`channelManager.js`), kebab-case for components (`chat-room.jsx`)

### Comments

- Use JSDoc for functions and classes
- Inline comments for complex logic
- TODO comments with name: `// TODO(username): Fix this`

```javascript
/**
 * Parse an AX.25 frame from a buffer
 * @param {Buffer} buffer - Raw frame buffer
 * @returns {Object} Parsed frame object
 * @throws {Error} If frame is invalid
 */
function parseAx25Frame(buffer) {
  // Implementation...
}
```

### Error Handling

- Always handle errors gracefully
- Use try/catch for async operations
- Log errors with context

```javascript
// Good
try {
  const data = await fetchData();
  return processData(data);
} catch (err) {
  console.error('Failed to fetch data:', err.message);
  throw new Error(`Data processing failed: ${err.message}`);
}

// Bad
const data = await fetchData(); // Unhandled rejection
return processData(data);
```

---

## Commit Guidelines

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- **feat:** New feature
- **fix:** Bug fix
- **docs:** Documentation changes
- **style:** Code style changes (formatting, no logic change)
- **refactor:** Code refactoring
- **perf:** Performance improvements
- **test:** Adding or updating tests
- **chore:** Build process, dependencies, tooling

### Examples

```
feat(chat): add mesh synchronization for chat messages

Implement ChatSyncManager with vector clock conflict resolution,
message deduplication, and automatic distribution via NexNet backbone.

Closes #42
```

```
fix(igate): prevent duplicate frames from being gated

Added deduplication cache with TTL to prevent the same frame
from being gated to APRS-IS multiple times.

Fixes #38
```

```
docs(api): add WebSocket protocol documentation

Document WebSocket authentication, event types, and message formats
in API.md.
```

### Commit Best Practices

- **Atomic commits:** One logical change per commit
- **Present tense:** "Add feature" not "Added feature"
- **Imperative mood:** "Fix bug" not "Fixes bug"
- **Reference issues:** Use "Closes #123" or "Fixes #456"
- **Keep it short:** Subject line under 72 characters

---

## Pull Request Process

### Before Submitting

1. **Sync with upstream:**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Run tests:**
   ```bash
   npm test
   ```

3. **Validate configuration:**
   ```bash
   npm run validate
   ```

4. **Check for lint errors:**
   ```bash
   npm run lint
   ```

5. **Test manually:** Start the dev server and test your changes

### Creating a Pull Request

1. **Push to your fork:**
   ```bash
   git push origin feature/my-new-feature
   ```

2. **Open PR on GitHub** with a clear title and description

3. **Fill out the PR template:**
   - What does this PR do?
   - Why is this change needed?
   - How has it been tested?
   - Screenshots (if UI changes)
   - Related issues

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
How has this been tested?

## Screenshots (if applicable)

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex code
- [ ] Documentation updated
- [ ] No new warnings generated
- [ ] Tests added/updated
- [ ] All tests passing
```

### Review Process

- At least one maintainer must approve
- All CI checks must pass
- No unresolved conversations
- Commits may be squashed on merge

---

## Testing Requirements

### Test Structure

Place tests in `test/` directory:

```
test/
├── ax25.test.js
├── channelManager.test.js
├── bbs.test.js
└── integration.test.js
```

### Writing Tests

```javascript
// test/example.test.js
const assert = require('assert');

function testMyFunction() {
  const result = myFunction('input');
  assert.strictEqual(result, 'expected');
  console.log('✓ myFunction works correctly');
}

try {
  testMyFunction();
  process.exit(0); // Success
} catch (err) {
  console.error('✗ Test failed:', err.message);
  process.exit(1); // Failure
}
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test
node test/ax25.test.js
```

### Coverage Goals

- **Core modules:** 80%+ coverage
- **API routes:** 70%+ coverage
- **UI components:** 60%+ coverage

---

## Documentation Requirements

### Code Documentation

- All public functions must have JSDoc comments
- Complex algorithms need explanatory comments
- API endpoints documented in `docs/API.md`

### User Documentation

When adding features, update:

- **README.md** - If user-facing feature
- **docs/CONFIGURATION.md** - If new configuration options
- **docs/API.md** - If new API endpoints
- **docs/TROUBLESHOOTING.md** - If common issues expected

### Examples

Include examples for new features:

```javascript
/**
 * Example usage:
 * ```javascript
 * const manager = new ChannelManager();
 * manager.addChannel({
 *   id: 'vhf',
 *   name: 'VHF 144.39',
 *   adapter: new SerialAdapter({ port: '/dev/ttyUSB0' })
 * });
 * ```
 */
```

---

## Issue Reporting

### Bug Reports

Use the bug report template:

**Title:** Short, descriptive title

**Description:**
- What happened?
- What did you expect?
- Steps to reproduce
- NexDigi version
- Operating system
- Node.js version

**Logs:**
```
(paste relevant logs)
```

**Screenshots:** (if applicable)

### Good Bug Report Example

```markdown
## Serial port permission denied on Ubuntu 22.04

**Expected:** Serial TNC should connect successfully

**Actual:** Error "Permission denied, cannot open /dev/ttyUSB0"

**Steps to reproduce:**
1. Install NexDigi on Ubuntu 22.04
2. Add serial channel with port /dev/ttyUSB0
3. Start server
4. See error in logs

**Environment:**
- NexDigi: v0.8.0
- OS: Ubuntu 22.04 LTS
- Node.js: v18.19.0

**Logs:**
```
[ERROR] Channel 'VHF 144.39' error: Error: Permission denied, cannot open /dev/ttyUSB0
```

**Solution:** User needs to be added to dialout group
```

---

## Feature Requests

### Before Requesting

- Check if feature already exists
- Search existing issues/PRs
- Consider if it fits project scope

### Feature Request Template

```markdown
## Feature Description
Clear description of the proposed feature

## Use Case
Why is this feature needed? What problem does it solve?

## Proposed Implementation
(optional) How might this work?

## Alternatives Considered
(optional) Other solutions you've considered

## Additional Context
Screenshots, mockups, references, etc.
```

---

## Development Tips

### Hot Reload

Development server automatically reloads on file changes:
- **Server:** Watches `server/**/*.js`
- **Client:** Watches `client/src/**/*`

### Debugging

**Server:**
```bash
node --inspect server/index.js
```
Then connect Chrome DevTools.

**Client:**
Use React DevTools browser extension.

### Environment Variables

Create `.env` file:
```bash
PORT=3000
NODE_ENV=development
NEXDIGI_DEBUG=true
```

### Useful Commands

```bash
npm run setup          # Interactive setup wizard
npm run validate       # Validate configuration
npm run backup         # Backup data files
npm run reset          # Reset database
npm run logs           # View server logs
```

---

## Getting Help

- **Documentation:** See `docs/` directory
- **Issues:** https://github.com/na4wx/NexDigi/issues
- **Discussions:** https://github.com/na4wx/NexDigi/discussions

---

## License

By contributing to NexDigi, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for contributing to NexDigi! 73**
