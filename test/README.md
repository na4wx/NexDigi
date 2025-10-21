# NexDigi Test Suite

This directory contains unit tests for the core NexDigi modules. Tests are written using Node.js's built-in `assert` module and can be run with the test runner script.

## Running Tests

### Run all tests:
```bash
npm test
```

### Run specific test file:
```bash
node test/test_ax25_unit.js
node test/test_channelManager_unit.js
node test/test_bbs_unit.js
```

### Run tests in watch mode (auto-rerun on changes):
```bash
npm run test:watch
```

## Test Files

### test_ax25_unit.js
Tests the AX.25 frame parsing and manipulation module.

**Coverage:**
- Address field parsing (callsign, SSID, H-bit, EA bit)
- Multi-hop path parsing
- Control and PID byte extraction
- Payload parsing
- Path string conversion (e.g., "W4ABC>APRS,WIDE1-1*")
- WIDE-style address servicing (decrement SSID, set H-bit)
- Edge cases (short callsigns, max SSID, empty payload, 8 digipeaters)
- Frame building (if buildAx25UIFrame exported)

**Test Count:** 27+ tests

### test_channelManager_unit.js
Tests the channel management module for CRUD operations and event emission.

**Coverage:**
- Channel initialization
- Adding channels (single, multiple, disabled)
- Duplicate ID rejection
- Getting channels (by ID, all channels)
- Updating channel configuration
- Removing channels
- Event emission (channelAdded, channelUpdated, channelRemoved)
- Channel status retrieval
- Edge cases (missing ID/type, null config)

**Test Count:** 22+ tests

### test_bbs_unit.js
Tests the BBS (Bulletin Board System) message storage and session handling.

**Coverage:**
- BBS initialization
- Message CRUD operations (add, get, delete)
- User inbox retrieval (getMessagesForUser)
- Mark messages as read
- BBS session instantiation
- Command parsing (LIST, READ, SEND, HELP, QUIT)
- Invalid/empty command handling
- Message validation (required fields)
- Message search (by subject, by callsign)

**Test Count:** 25+ tests

## Writing New Tests

### Test Structure

Each test file follows this pattern:

```javascript
#!/usr/bin/env node

const assert = require('assert');
const path = require('path');

// Import module under test
const modulePath = path.join(__dirname, '..', 'server', 'lib', 'yourModule.js');
const YourModule = require(modulePath);

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`❌ FAIL: ${name}`);
    console.error(`   ${err.message}`);
    testsFailed++;
  }
}

// Write your tests
test('Should do something', () => {
  const result = YourModule.doSomething();
  assert.strictEqual(result, expectedValue);
});

// Summary
console.log(`\nTests passed: ${testsPassed}`);
console.log(`Tests failed: ${testsFailed}`);
process.exit(testsFailed > 0 ? 1 : 0);
```

### Assertions

Common assertion patterns:

```javascript
// Equality
assert.strictEqual(actual, expected);
assert.deepStrictEqual(actualObject, expectedObject);

// Truthy/Falsy
assert.ok(value);
assert.ok(!value);

// Type checks
assert.ok(Array.isArray(value));
assert.ok(Buffer.isBuffer(value));
assert.ok(value instanceof ClassName);

// Exceptions
assert.throws(() => {
  riskyFunction();
}, /expected error message/);

// Value ranges
assert.ok(value > 0);
assert.ok(value >= min && value <= max);
```

### Async Tests

For asynchronous tests, use callbacks or promises:

```javascript
test('Async operation completes', (done) => {
  someAsyncFunction((err, result) => {
    assert.ok(!err);
    assert.strictEqual(result, 'expected');
    done();
  });
});
```

### Test Data Cleanup

For tests that create files or temporary data:

```javascript
const os = require('os');
const fs = require('fs');

const testDir = path.join(os.tmpdir(), 'test-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });

// Use testDir in your tests

process.on('exit', () => {
  fs.rmSync(testDir, { recursive: true, force: true });
});
```

## Coverage Goals

Target coverage levels for v1.0.0:
- **Core modules** (ax25, channelManager): 80%+
- **API modules** (routes, middleware): 70%+
- **UI components**: 60%+

### Checking Coverage (Manual)

While we don't have automated coverage yet, you can estimate coverage by:
1. Count the number of functions/methods in the module
2. Count how many are tested
3. Calculate percentage

Example for ax25.js:
- Functions: parseAx25Frame, parseAddressField, addressesToPathString, serviceAddressInBuffer, buildAx25UIFrame (5 total)
- Tested: All 5
- Coverage: 100%

## Continuous Integration

Tests are automatically run by GitHub Actions on:
- Every push to main
- Every pull request
- Before releases

See `.github/workflows/ci.yml` for CI configuration.

## Troubleshooting

### Tests Fail to Import Module

**Error:** `Cannot find module '../server/lib/yourModule.js'`

**Solution:** Check the path in the require statement. Use `path.join(__dirname, '..', 'relative', 'path')` for cross-platform compatibility.

### Tests Pass Locally But Fail in CI

**Common causes:**
- Timing issues (use proper async handling)
- Platform differences (path separators, line endings)
- Missing environment variables
- File permissions

**Solution:** Check CI logs, add debug output, ensure platform-agnostic code.

### Mock Adapter Not Working

**Issue:** Tests requiring channel adapters fail

**Solution:** Use the mock adapter for testing:

```javascript
const config = {
  id: 'test-channel',
  type: 'mock',
  enabled: true
};
channelManager.addChannel(config);
```

### Module Has Side Effects

**Issue:** Module executes code on import (e.g., starts servers)

**Solution:** Wrap execution in `if (require.main === module)` check:

```javascript
// In the module being tested
if (require.main === module) {
  // Only run if executed directly
  startServer();
}

module.exports = { /* exports */ };
```

## Best Practices

### 1. Test One Thing Per Test
```javascript
// Good
test('Parse destination address', () => { /* ... */ });
test('Parse source address', () => { /* ... */ });

// Bad
test('Parse all addresses', () => {
  // Tests dest, source, path, control, pid all at once
});
```

### 2. Use Descriptive Test Names
```javascript
// Good
test('Service WIDE1-1 address (decrement SSID)', () => { /* ... */ });

// Bad
test('Test service address', () => { /* ... */ });
```

### 3. Test Edge Cases
```javascript
test('Handle empty payload', () => { /* ... */ });
test('Handle maximum SSID (15)', () => { /* ... */ });
test('Handle 8 digipeater hops', () => { /* ... */ });
```

### 4. Test Error Conditions
```javascript
test('Reject duplicate channel ID', () => {
  assert.throws(() => {
    channelManager.addChannel({ id: 'duplicate', ... });
  });
});
```

### 5. Keep Tests Independent
Each test should be able to run in isolation. Don't rely on state from previous tests.

```javascript
// Good
test('Add channel', () => {
  const cm = new ChannelManager(); // Fresh instance
  cm.addChannel({ ... });
});

// Bad
let globalCM = new ChannelManager();
test('Add channel', () => {
  globalCM.addChannel({ ... }); // Shared state!
});
```

## Contributing Tests

When adding new features:
1. Write tests first (TDD approach)
2. Run tests to verify they fail
3. Implement the feature
4. Run tests to verify they pass
5. Refactor if needed
6. Submit PR with tests included

See [CONTRIBUTING.md](../docs/CONTRIBUTING.md) for more details.

## Test Output

### Successful Run
```
=== AX.25 Module Unit Tests ===

✅ PASS: Parse simple destination address
✅ PASS: Parse source address with SSID
✅ PASS: Parse frame with path (WIDE1-1)
...

==================================================
Tests passed: 27
Tests failed: 0
==================================================
```

### Failed Run
```
=== AX.25 Module Unit Tests ===

✅ PASS: Parse simple destination address
❌ FAIL: Parse source address with SSID
   Expected 5 but got 0
   at test (/path/to/test.js:45:10)
...

==================================================
Tests passed: 26
Tests failed: 1
==================================================
```

## Future Improvements

Planned enhancements to the test suite:
- [ ] Add code coverage reporting (nyc/c8)
- [ ] Add integration tests (multi-module)
- [ ] Add performance benchmarks
- [ ] Add fuzzing tests for frame parsing
- [ ] Add snapshot testing for UI components
- [ ] Add end-to-end tests with real TNCs

---

**For questions or issues, see:** [TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md)

**73 de NA4WX**
