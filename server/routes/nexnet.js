/**
 * NexNet Settings API Routes
 * Provides endpoints for advanced backbone network configuration
 */

const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const SETTINGS_FILE = path.join(__dirname, '../data/nexnetSettings.json');

// Default settings
const DEFAULT_SETTINGS = {
  // QoS Configuration
  qos: {
    enabled: true,
    bandwidthLimit: 10000, // bytes/sec
    emergencyQueueSize: 100,
    highQueueSize: 200,
    normalQueueSize: 500,
    lowQueueSize: 1000,
    processInterval: 10 // ms
  },

  // Load Balancing
  loadBalancing: {
    enabled: true,
    algorithm: 'weighted', // weighted | round-robin | least-loaded
    failureThreshold: 3
  },

  // Mesh Self-Healing
  meshHealing: {
    enabled: true,
    lsaInterval: 60, // seconds
    linkTimeout: 120, // seconds
    discoveryTimeout: 30 // seconds
  },

  // Security & Authentication
  security: {
    enabled: true,
    sessionTimeout: 300, // seconds
    maxAuthAttempts: 5, // per minute
    trustedNodes: []
  },

  // Monitoring
  monitoring: {
    enabled: true,
    healthCheckInterval: 30, // seconds
    aggregationInterval: 300, // seconds (5 minutes)
    alertThresholds: {
      latency: 1000, // ms
      packetLoss: 10 // percent
    }
  }
};

/**
 * Load settings from file, or return defaults
 */
async function loadSettings() {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf8');
    const settings = JSON.parse(data);
    // Merge with defaults to ensure all fields exist
    return mergeDefaults(settings);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist, return defaults
      return DEFAULT_SETTINGS;
    }
    console.error('Error loading NexNet settings:', error);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Merge settings with defaults
 */
function mergeDefaults(settings) {
  return {
    qos: { ...DEFAULT_SETTINGS.qos, ...settings.qos },
    loadBalancing: { ...DEFAULT_SETTINGS.loadBalancing, ...settings.loadBalancing },
    meshHealing: { ...DEFAULT_SETTINGS.meshHealing, ...settings.meshHealing },
    security: { ...DEFAULT_SETTINGS.security, ...settings.security },
    monitoring: {
      ...DEFAULT_SETTINGS.monitoring,
      ...settings.monitoring,
      alertThresholds: {
        ...DEFAULT_SETTINGS.monitoring.alertThresholds,
        ...settings.monitoring?.alertThresholds
      }
    }
  };
}

/**
 * Save settings to file
 */
async function saveSettings(settings) {
  try {
    // Ensure data directory exists
    const dataDir = path.dirname(SETTINGS_FILE);
    await fs.mkdir(dataDir, { recursive: true });
    
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving NexNet settings:', error);
    throw error;
  }
}

/**
 * Validate settings
 */
function validateSettings(settings) {
  const errors = [];

  // Validate QoS
  if (settings.qos) {
    if (settings.qos.bandwidthLimit < 0) {
      errors.push('Bandwidth limit must be non-negative');
    }
    if (settings.qos.emergencyQueueSize < 1 || settings.qos.emergencyQueueSize > 10000) {
      errors.push('Emergency queue size must be between 1 and 10000');
    }
    if (settings.qos.highQueueSize < 1 || settings.qos.highQueueSize > 10000) {
      errors.push('High queue size must be between 1 and 10000');
    }
    if (settings.qos.normalQueueSize < 1 || settings.qos.normalQueueSize > 10000) {
      errors.push('Normal queue size must be between 1 and 10000');
    }
    if (settings.qos.lowQueueSize < 1 || settings.qos.lowQueueSize > 10000) {
      errors.push('Low queue size must be between 1 and 10000');
    }
  }

  // Validate Load Balancing
  if (settings.loadBalancing) {
    if (!['weighted', 'round-robin', 'least-loaded'].includes(settings.loadBalancing.algorithm)) {
      errors.push('Load balancing algorithm must be weighted, round-robin, or least-loaded');
    }
    if (settings.loadBalancing.failureThreshold < 1 || settings.loadBalancing.failureThreshold > 100) {
      errors.push('Failure threshold must be between 1 and 100');
    }
  }

  // Validate Mesh Healing
  if (settings.meshHealing) {
    if (settings.meshHealing.lsaInterval < 10 || settings.meshHealing.lsaInterval > 3600) {
      errors.push('LSA interval must be between 10 and 3600 seconds');
    }
    if (settings.meshHealing.linkTimeout < 30 || settings.meshHealing.linkTimeout > 3600) {
      errors.push('Link timeout must be between 30 and 3600 seconds');
    }
    if (settings.meshHealing.discoveryTimeout < 5 || settings.meshHealing.discoveryTimeout > 300) {
      errors.push('Discovery timeout must be between 5 and 300 seconds');
    }
  }

  // Validate Security
  if (settings.security) {
    if (settings.security.sessionTimeout < 60 || settings.security.sessionTimeout > 3600) {
      errors.push('Session timeout must be between 60 and 3600 seconds');
    }
    if (settings.security.maxAuthAttempts < 1 || settings.security.maxAuthAttempts > 100) {
      errors.push('Max auth attempts must be between 1 and 100');
    }
  }

  // Validate Monitoring
  if (settings.monitoring) {
    if (settings.monitoring.healthCheckInterval < 10 || settings.monitoring.healthCheckInterval > 3600) {
      errors.push('Health check interval must be between 10 and 3600 seconds');
    }
    if (settings.monitoring.aggregationInterval < 60 || settings.monitoring.aggregationInterval > 3600) {
      errors.push('Aggregation interval must be between 60 and 3600 seconds');
    }
    if (settings.monitoring.alertThresholds) {
      if (settings.monitoring.alertThresholds.latency < 100 || settings.monitoring.alertThresholds.latency > 10000) {
        errors.push('Latency threshold must be between 100 and 10000 ms');
      }
      if (settings.monitoring.alertThresholds.packetLoss < 1 || settings.monitoring.alertThresholds.packetLoss > 100) {
        errors.push('Packet loss threshold must be between 1 and 100 percent');
      }
    }
  }

  return errors;
}

/**
 * GET /api/nexnet/settings
 * Retrieve all NexNet settings
 */
router.get('/settings', async (req, res) => {
  try {
    const settings = await loadSettings();
    res.json(settings);
  } catch (error) {
    console.error('Error getting NexNet settings:', error);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

/**
 * POST /api/nexnet/settings
 * Update NexNet settings
 */
router.post('/settings', async (req, res) => {
  try {
    const newSettings = req.body;

    // Validate settings
    const errors = validateSettings(newSettings);
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', errors });
    }

    // Merge with defaults
    const mergedSettings = mergeDefaults(newSettings);

    // Save to file
    await saveSettings(mergedSettings);

    // TODO: Apply settings to running BackboneManager instances
    // This would require the BackboneManager to be accessible here
    // For now, settings will be applied on next server restart

    res.json({ 
      success: true, 
      message: 'Settings saved. Restart server to apply changes.',
      settings: mergedSettings 
    });
  } catch (error) {
    console.error('Error saving NexNet settings:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

/**
 * POST /api/nexnet/security/generate-keys
 * Generate new Ed25519 key pair
 */
router.post('/security/generate-keys', async (req, res) => {
  try {
    // Generate Ed25519 key pair
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' }
    });

    // Save to keys directory
    const keysDir = path.join(__dirname, '../data/keys');
    await fs.mkdir(keysDir, { recursive: true });

    await fs.writeFile(path.join(keysDir, 'public.key'), publicKey);
    await fs.writeFile(path.join(keysDir, 'private.key'), privateKey);

    // Return public key as hex string
    const publicKeyHex = publicKey.toString('hex');

    res.json({ 
      success: true,
      message: 'New keys generated successfully',
      publicKey: publicKeyHex
    });
  } catch (error) {
    console.error('Error generating keys:', error);
    res.status(500).json({ error: 'Failed to generate keys' });
  }
});

/**
 * GET /api/nexnet/security/public-key
 * Get current public key
 */
router.get('/security/public-key', async (req, res) => {
  try {
    const publicKeyPath = path.join(__dirname, '../data/keys/public.key');
    
    try {
      const publicKey = await fs.readFile(publicKeyPath);
      res.json({ publicKey: publicKey.toString('hex') });
    } catch (error) {
      if (error.code === 'ENOENT') {
        // No key exists yet
        res.json({ publicKey: null });
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error('Error getting public key:', error);
    res.status(500).json({ error: 'Failed to get public key' });
  }
});

/**
 * POST /api/nexnet/security/trusted-nodes
 * Add a trusted node
 */
router.post('/security/trusted-nodes', async (req, res) => {
  try {
    const { callsign, publicKey } = req.body;

    if (!callsign || !publicKey) {
      return res.status(400).json({ error: 'Callsign and public key are required' });
    }

    // Load current settings
    const settings = await loadSettings();

    // Check if node already exists
    const exists = settings.security.trustedNodes.find(n => n.callsign === callsign);
    if (exists) {
      return res.status(400).json({ error: 'Node already exists' });
    }

    // Add trusted node
    settings.security.trustedNodes.push({ callsign, publicKey });

    // Save settings
    await saveSettings(settings);

    res.json({ 
      success: true,
      message: 'Trusted node added successfully',
      node: { callsign, publicKey }
    });
  } catch (error) {
    console.error('Error adding trusted node:', error);
    res.status(500).json({ error: 'Failed to add trusted node' });
  }
});

/**
 * DELETE /api/nexnet/security/trusted-nodes/:callsign
 * Remove a trusted node
 */
router.delete('/security/trusted-nodes/:callsign', async (req, res) => {
  try {
    const { callsign } = req.params;

    // Load current settings
    const settings = await loadSettings();

    // Find and remove node
    const index = settings.security.trustedNodes.findIndex(n => n.callsign === callsign);
    if (index === -1) {
      return res.status(404).json({ error: 'Trusted node not found' });
    }

    settings.security.trustedNodes.splice(index, 1);

    // Save settings
    await saveSettings(settings);

    res.json({ 
      success: true,
      message: 'Trusted node removed successfully'
    });
  } catch (error) {
    console.error('Error removing trusted node:', error);
    res.status(500).json({ error: 'Failed to remove trusted node' });
  }
});

module.exports = router;
