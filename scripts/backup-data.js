#!/usr/bin/env node
/**
 * NexDigi Data Backup Utility
 * Creates a timestamped backup of all data files
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const dataDir = path.join(__dirname, '../server/data');
const backupBaseDir = path.join(__dirname, '../backups');

console.log(`
╔══════════════════════════════════════════════════════════════╗
║              NexDigi Backup Utility                          ║
╚══════════════════════════════════════════════════════════════╝
`);

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function backupData() {
  try {
    // Create backup directory
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const backupDir = path.join(backupBaseDir, `backup-${timestamp}`);
    
    if (!fs.existsSync(backupBaseDir)) {
      fs.mkdirSync(backupBaseDir, { recursive: true });
    }
    
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    console.log(`Creating backup: ${path.basename(backupDir)}\n`);
    
    let totalSize = 0;
    let fileCount = 0;
    
    // Backup configuration
    const configPath = path.join(__dirname, '../server/config.json');
    if (fs.existsSync(configPath)) {
      const destPath = path.join(backupDir, 'config.json');
      fs.copyFileSync(configPath, destPath);
      const stats = fs.statSync(destPath);
      totalSize += stats.size;
      fileCount++;
      console.log(`✓ config.json (${formatBytes(stats.size)})`);
    }
    
    // Backup data directory
    if (fs.existsSync(dataDir)) {
      const dataFiles = fs.readdirSync(dataDir);
      
      const dataBackupDir = path.join(backupDir, 'data');
      if (!fs.existsSync(dataBackupDir)) {
        fs.mkdirSync(dataBackupDir, { recursive: true });
      }
      
      for (const file of dataFiles) {
        const srcPath = path.join(dataDir, file);
        const destPath = path.join(dataBackupDir, file);
        
        if (fs.statSync(srcPath).isFile()) {
          fs.copyFileSync(srcPath, destPath);
          const stats = fs.statSync(destPath);
          totalSize += stats.size;
          fileCount++;
          console.log(`✓ data/${file} (${formatBytes(stats.size)})`);
        }
      }
    }
    
    // Create backup manifest
    const manifest = {
      timestamp: new Date().toISOString(),
      version: require('../package.json').version,
      fileCount,
      totalSize,
      files: []
    };
    
    function walkDir(dir, relativeTo) {
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const fullPath = path.join(dir, file);
        const stats = fs.statSync(fullPath);
        
        if (stats.isFile()) {
          manifest.files.push({
            path: path.relative(relativeTo, fullPath),
            size: stats.size,
            modified: stats.mtime.toISOString()
          });
        } else if (stats.isDirectory()) {
          walkDir(fullPath, relativeTo);
        }
      });
    }
    
    walkDir(backupDir, backupDir);
    
    fs.writeFileSync(
      path.join(backupDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                  Backup Complete!                            ║
╚══════════════════════════════════════════════════════════════╝

Summary:
  - Files backed up: ${fileCount}
  - Total size: ${formatBytes(totalSize)}
  - Location: ${path.relative(process.cwd(), backupDir)}

To restore from this backup:
  1. Stop the server
  2. Copy files from backup directory to server/
  3. Restart the server
`);
    
    // Clean up old backups (keep last 10)
    const backups = fs.readdirSync(backupBaseDir)
      .filter(name => name.startsWith('backup-'))
      .map(name => ({
        name,
        path: path.join(backupBaseDir, name),
        time: fs.statSync(path.join(backupBaseDir, name)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time);
    
    if (backups.length > 10) {
      console.log(`\nCleaning up old backups (keeping last 10)...`);
      for (let i = 10; i < backups.length; i++) {
        fs.rmSync(backups[i].path, { recursive: true, force: true });
        console.log(`✓ Removed: ${backups[i].name}`);
      }
    }
    
  } catch (error) {
    console.error('\n❌ Backup failed:', error.message);
    process.exit(1);
  }
}

backupData();
