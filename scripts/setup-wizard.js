#!/usr/bin/env node
/**
 * NexDigi Setup Wizard
 * Interactive setup for first-time installation
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

console.log(`
╔══════════════════════════════════════════════════════════════╗
║                  NexDigi Setup Wizard                        ║
║          Modern Packet Radio Software Suite                  ║
╚══════════════════════════════════════════════════════════════╝
`);

async function setupWizard() {
  try {
    const configPath = path.join(__dirname, '../server/config.json');
    
    // Load existing config or create default
    let config = {
      uiPassword: 'admin',
      channels: [],
      igate: {
        enabled: false,
        host: 'rotate.aprs2.net',
        port: 14580,
        call: '',
        pass: '',
        channels: []
      }
    };
    
    if (fs.existsSync(configPath)) {
      console.log('\n⚠️  Existing configuration found.');
      const overwrite = await question('Do you want to modify it? (y/n): ');
      if (overwrite.toLowerCase() !== 'y') {
        console.log('\nSetup cancelled. Your existing configuration is unchanged.');
        rl.close();
        return;
      }
      
      try {
        config = JSON.parse(await readFile(configPath, 'utf8'));
      } catch (e) {
        console.log('\n⚠️  Could not parse existing config, starting fresh.');
      }
    }
    
    console.log('\n--- Basic Settings ---\n');
    
    // UI Password
    const changePassword = await question(`Change UI password? Current: ${config.uiPassword ? '(set)' : '(not set)'} (y/n): `);
    if (changePassword.toLowerCase() === 'y') {
      const newPassword = await question('Enter new UI password: ');
      if (newPassword.trim()) {
        config.uiPassword = newPassword.trim();
        console.log('✓ Password updated');
      }
    }
    
    // Callsign
    console.log('\n--- Station Identification ---\n');
    const currentCall = config.igate?.call || '';
    const callsign = await question(`Enter your callsign [${currentCall || 'N0CALL'}]: `);
    if (callsign.trim()) {
      if (!config.igate) config.igate = {};
      config.igate.call = callsign.trim().toUpperCase();
    } else if (!currentCall) {
      config.igate.call = 'N0CALL';
    }
    
    // APRS-IS Passcode
    const currentPass = config.igate?.pass || '';
    const passcode = await question(`Enter APRS-IS passcode [${currentPass || 'leave empty for receive-only'}]: `);
    if (passcode.trim()) {
      config.igate.pass = passcode.trim();
    }
    
    // IGate
    console.log('\n--- IGate Configuration ---\n');
    const enableIgate = await question(`Enable APRS-IS IGate? (y/n): `);
    config.igate.enabled = enableIgate.toLowerCase() === 'y';
    
    if (config.igate.enabled) {
      const igateServer = await question(`APRS-IS server [${config.igate.host || 'rotate.aprs2.net'}]: `);
      if (igateServer.trim()) {
        config.igate.host = igateServer.trim();
      }
      
      const igatePort = await question(`APRS-IS port [${config.igate.port || '14580'}]: `);
      if (igatePort.trim()) {
        config.igate.port = parseInt(igatePort.trim(), 10);
      }
    }
    
    // Channels
    console.log('\n--- Channel Configuration ---\n');
    const addChannel = await question('Add a channel now? (y/n): ');
    
    if (addChannel.toLowerCase() === 'y') {
      while (true) {
        console.log('\nChannel Types:');
        console.log('  1) Serial TNC (KISS)');
        console.log('  2) KISS-TCP (Direwolf)');
        console.log('  3) Mock (for testing)');
        
        const typeChoice = await question('\nSelect channel type (1-3) or q to quit: ');
        
        if (typeChoice.toLowerCase() === 'q') break;
        
        const channelId = `channel-${Date.now()}`;
        let channel = { id: channelId, enabled: true };
        
        switch (typeChoice.trim()) {
          case '1':
            channel.type = 'serial';
            channel.name = await question('Channel name [VHF]: ') || 'VHF';
            channel.options = {
              port: await question('Serial port [/dev/ttyUSB0]: ') || '/dev/ttyUSB0',
              baud: parseInt(await question('Baud rate [9600]: ') || '9600', 10),
              callsign: await question(`Channel callsign [${config.igate.call}-1]: `) || `${config.igate.call}-1`
            };
            break;
            
          case '2':
            channel.type = 'kiss-tcp';
            channel.name = await question('Channel name [Direwolf]: ') || 'Direwolf';
            channel.options = {
              host: await question('Host [127.0.0.1]: ') || '127.0.0.1',
              port: parseInt(await question('Port [8001]: ') || '8001', 10),
              callsign: await question(`Channel callsign [${config.igate.call}-1]: `) || `${config.igate.call}-1`
            };
            break;
            
          case '3':
            channel.type = 'mock';
            channel.name = await question('Channel name [Mock]: ') || 'Mock';
            channel.options = {
              callsign: await question(`Channel callsign [${config.igate.call}-1]: `) || `${config.igate.call}-1`
            };
            break;
            
          default:
            console.log('Invalid choice, skipping.');
            continue;
        }
        
        config.channels.push(channel);
        console.log(`✓ Added channel: ${channel.name}`);
        
        const addAnother = await question('\nAdd another channel? (y/n): ');
        if (addAnother.toLowerCase() !== 'y') break;
      }
    }
    
    // Save configuration
    console.log('\n--- Saving Configuration ---\n');
    
    const configJson = JSON.stringify(config, null, 2);
    console.log('Configuration to save:');
    console.log(configJson);
    
    const confirmSave = await question('\nSave this configuration? (y/n): ');
    
    if (confirmSave.toLowerCase() === 'y') {
      // Create backup of existing config
      if (fs.existsSync(configPath)) {
        const backupPath = `${configPath}.backup.${Date.now()}`;
        fs.copyFileSync(configPath, backupPath);
        console.log(`✓ Backed up existing config to: ${path.basename(backupPath)}`);
      }
      
      // Ensure server directory exists
      const serverDir = path.join(__dirname, '../server');
      if (!fs.existsSync(serverDir)) {
        fs.mkdirSync(serverDir, { recursive: true });
      }
      
      // Ensure data directory exists
      const dataDir = path.join(__dirname, '../server/data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        console.log('✓ Created data directory');
      }
      
      await writeFile(configPath, configJson);
      console.log(`✓ Configuration saved to: ${configPath}`);
      
      console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    Setup Complete!                           ║
╚══════════════════════════════════════════════════════════════╝

Next steps:
  1. Start the server:
     npm start
     
  2. Open your browser:
     http://localhost:3000
     
  3. Login with your password: ${config.uiPassword}
  
  4. See documentation:
     docs/INSTALL.md
     docs/CONFIGURATION.md

Happy packet radio! 73
`);
    } else {
      console.log('\nSetup cancelled. No changes were saved.');
    }
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

setupWizard();
