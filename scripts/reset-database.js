#!/usr/bin/env node
/**
 * NexDigi Database Reset
 * Clears all data files and resets to default state
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

const dataDir = path.join(__dirname, '../server/data');

const dataFiles = [
  'bbs.json',
  'bbsSettings.json',
  'bbsUsers.json',
  'chatHistory.json',
  'digipeaterSettings.json',
  'lastHeard.json',
  'metricAlerts.json',
  'winlinkSettings.json'
];

console.log(`
╔══════════════════════════════════════════════════════════════╗
║              NexDigi Database Reset Utility                  ║
╚══════════════════════════════════════════════════════════════╝

⚠️  WARNING: This will delete all data including:
  - BBS messages
  - Chat history  
  - Last heard stations
  - User accounts
  - Settings
  
Configuration (config.json) will NOT be affected.
`);

async function resetDatabase() {
  try {
    const confirm = await question('Are you sure you want to reset all data? (yes/no): ');
    
    if (confirm.toLowerCase() !== 'yes') {
      console.log('\nReset cancelled. No changes were made.');
      rl.close();
      return;
    }
    
    const doubleConfirm = await question('Type "DELETE" to confirm: ');
    
    if (doubleConfirm !== 'DELETE') {
      console.log('\nReset cancelled. No changes were made.');
      rl.close();
      return;
    }
    
    console.log('\nResetting database...\n');
    
    // Create backup directory
    const backupDir = path.join(dataDir, `backup-${Date.now()}`);
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    let backedUp = 0;
    let deleted = 0;
    
    // Backup and delete each data file
    for (const file of dataFiles) {
      const filePath = path.join(dataDir, file);
      
      if (fs.existsSync(filePath)) {
        // Backup
        const backupPath = path.join(backupDir, file);
        fs.copyFileSync(filePath, backupPath);
        backedUp++;
        
        // Delete
        fs.unlinkSync(filePath);
        deleted++;
        
        console.log(`✓ Backed up and deleted: ${file}`);
      }
    }
    
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    Reset Complete!                           ║
╚══════════════════════════════════════════════════════════════╝

Summary:
  - Files backed up: ${backedUp}
  - Files deleted: ${deleted}
  - Backup location: ${path.relative(process.cwd(), backupDir)}

The server will recreate default data files on next start.

Next steps:
  1. Restart the server:
     npm start
     
  2. Reconfigure as needed through the web UI
`);
    
  } catch (error) {
    console.error('\n❌ Reset failed:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

resetDatabase();
