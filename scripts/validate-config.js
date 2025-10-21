#!/usr/bin/env node
/**
 * NexDigi Configuration Validator
 * Validates config.json for common errors
 */

const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../server/config.json');

console.log(`
╔══════════════════════════════════════════════════════════════╗
║           NexDigi Configuration Validator                    ║
╚══════════════════════════════════════════════════════════════╝
`);

let errors = [];
let warnings = [];

function error(msg) {
  errors.push(msg);
  console.log(`❌ ERROR: ${msg}`);
}

function warn(msg) {
  warnings.push(msg);
  console.log(`⚠️  WARNING: ${msg}`);
}

function info(msg) {
  console.log(`ℹ️  ${msg}`);
}

function validateConfig() {
  try {
    // Check if config exists
    if (!fs.existsSync(configPath)) {
      error(`Configuration file not found: ${configPath}`);
      console.log('\nRun "npm run setup" to create initial configuration.');
      process.exit(1);
    }
    
    info(`Reading configuration from: ${configPath}\n`);
    
    // Try to parse JSON
    let config;
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(content);
    } catch (e) {
      error(`Invalid JSON syntax: ${e.message}`);
      process.exit(1);
    }
    
    console.log('✓ JSON syntax is valid\n');
    
    // Validate UI password
    if (!config.uiPassword || config.uiPassword === '') {
      warn('UI password is not set (authentication disabled)');
    } else if (config.uiPassword === 'admin' || config.uiPassword === 'password' || config.uiPassword === 'changeme') {
      warn(`Insecure default password detected: "${config.uiPassword}"`);
      console.log('  Consider using a stronger password.\n');
    } else {
      console.log('✓ UI password is set\n');
    }
    
    // Validate channels
    if (!Array.isArray(config.channels)) {
      error('config.channels must be an array');
    } else {
      console.log(`✓ Found ${config.channels.length} channel(s)\n`);
      
      config.channels.forEach((ch, idx) => {
        console.log(`  Channel ${idx + 1}: ${ch.name || ch.id || 'unnamed'}`);
        
        if (!ch.id) {
          warn(`  Channel ${idx + 1} missing "id" field`);
        }
        
        if (!ch.type) {
          error(`  Channel ${idx + 1} missing "type" field`);
        } else if (!['serial', 'kiss-tcp', 'mock', 'soundmodem'].includes(ch.type)) {
          error(`  Channel ${idx + 1} has invalid type: "${ch.type}"`);
        }
        
        if (ch.type === 'serial') {
          if (!ch.options || !ch.options.port) {
            error(`  Serial channel ${idx + 1} missing "options.port"`);
          }
          if (!ch.options || !ch.options.baud) {
            warn(`  Serial channel ${idx + 1} missing "options.baud" (defaulting to 9600)`);
          }
        }
        
        if (ch.type === 'kiss-tcp' || ch.type === 'soundmodem') {
          if (!ch.options || !ch.options.host) {
            warn(`  TCP channel ${idx + 1} missing "options.host" (defaulting to 127.0.0.1)`);
          }
          if (!ch.options || !ch.options.port) {
            warn(`  TCP channel ${idx + 1} missing "options.port" (defaulting to 8001)`);
          }
        }
        
        console.log('');
      });
    }
    
    // Validate IGate
    if (config.igate) {
      console.log(`✓ IGate configuration found (enabled: ${config.igate.enabled})\n`);
      
      if (config.igate.enabled) {
        if (!config.igate.call) {
          error('IGate enabled but "igate.call" (callsign) not set');
        } else if (config.igate.call === 'N0CALL') {
          warn('IGate using default callsign "N0CALL" - please set your actual callsign');
        }
        
        if (!config.igate.pass) {
          warn('IGate enabled but "igate.pass" (passcode) not set (receive-only mode)');
        }
        
        if (!config.igate.host) {
          warn('IGate "host" not set (defaulting to rotate.aprs2.net)');
        }
        
        if (!config.igate.port) {
          warn('IGate "port" not set (defaulting to 14580)');
        }
      }
    } else {
      info('IGate configuration not found (will use defaults)\n');
    }
    
    // Summary
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                  Validation Summary                          ║
╚══════════════════════════════════════════════════════════════╝

Errors: ${errors.length}
Warnings: ${warnings.length}

${errors.length === 0 ? '✓ Configuration is valid!' : '❌ Configuration has errors. Please fix them before starting the server.'}
${warnings.length > 0 ? '\n⚠️  Please review warnings above.' : ''}
`);
    
    if (errors.length > 0) {
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n❌ Validation failed:', error.message);
    process.exit(1);
  }
}

validateConfig();
