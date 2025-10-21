#!/usr/bin/env node
/**
 * NexDigi Test Runner
 * Runs all tests with proper environment setup
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log(`
╔══════════════════════════════════════════════════════════════╗
║              NexDigi Test Suite                              ║
╚══════════════════════════════════════════════════════════════╝
`);

const testDir = path.join(__dirname, '../test');

if (!fs.existsSync(testDir)) {
  console.log('⚠️  No test directory found.');
  console.log('\nTo create tests, see: docs/CONTRIBUTING.md');
  console.log('\nTest files should be placed in: test/');
  process.exit(0);
}

const testFiles = fs.readdirSync(testDir).filter(f => f.endsWith('.js'));

if (testFiles.length === 0) {
  console.log('⚠️  No test files found in test/ directory.');
  console.log('\nTo create tests, see: docs/CONTRIBUTING.md');
  process.exit(0);
}

console.log(`Found ${testFiles.length} test file(s):\n`);
testFiles.forEach(f => console.log(`  - ${f}`));
console.log('');

let passed = 0;
let failed = 0;

async function runTest(file) {
  return new Promise((resolve) => {
    console.log(`Running: ${file}...`);
    
    const testPath = path.join(testDir, file);
    const proc = spawn('node', [testPath], {
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'test' }
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`✓ ${file} passed\n`);
        passed++;
      } else {
        console.log(`✗ ${file} failed\n`);
        failed++;
      }
      resolve(code);
    });
  });
}

async function runAllTests() {
  for (const file of testFiles) {
    await runTest(file);
  }
  
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                   Test Results                               ║
╚══════════════════════════════════════════════════════════════╝

Total: ${testFiles.length}
Passed: ${passed} ✓
Failed: ${failed} ✗

${failed === 0 ? 'All tests passed! 🎉' : 'Some tests failed. Please review the output above.'}
`);
  
  process.exit(failed > 0 ? 1 : 0);
}

runAllTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
