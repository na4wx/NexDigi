/**
 * auth.js - Authentication middleware for UI access
 * 
 * Protects web UI endpoints while allowing RF/mesh traffic to pass through
 */

const fs = require('fs');
const path = require('path');

// Load UI password from config
let uiPassword = 'changeme'; // default
try {
  const configPath = path.join(__dirname, '../config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  uiPassword = config.uiPassword || 'changeme';
} catch (err) {
  console.error('Failed to load UI password from config:', err.message);
}

/**
 * Routes that don't require authentication (read-only or system)
 */
const publicRoutes = [
  '/api/auth',             // Authentication endpoint itself
  '/api/frames',           // Frame display (read-only)
  '/api/channels',         // Channel list (read-only)
  '/api/stats',            // Statistics (read-only)
  '/api/lastheard',        // Last heard stations (read-only)
  '/api/backbone',         // Backbone/mesh traffic (inter-node)
  '/api/nexnet',           // NexNet mesh traffic (inter-node)
  '/api/digipeater/metrics', // Digipeater metrics (read-only)
  '/api/bbs/settings',     // BBS settings (read-only, GET only)
  '/api/digipeater/settings' // Digipeater settings (read-only, GET only)
];

/**
 * Check if a route is public (no auth required)
 */
function isPublicRoute(url) {
  // Exact match or starts with public route
  return publicRoutes.some(route => url === route || url.startsWith(route + '/'));
}

/**
 * Check if request is from a mesh/backbone node
 */
function isNodeRequest(req) {
  // Check for node-specific headers or user agents
  const userAgent = req.get('User-Agent') || '';
  const nodeHeader = req.get('X-NexDigi-Node');
  
  return userAgent.includes('NexDigi-Node') || !!nodeHeader;
}

/**
 * Extract password from request
 */
function extractPassword(req) {
  // Check Authorization header (Bearer token)
  const authHeader = req.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // Check X-UI-Password header
  const passwordHeader = req.get('X-UI-Password');
  if (passwordHeader) {
    return passwordHeader;
  }
  
  // Check query parameter (for WebSocket upgrades)
  if (req.query && req.query.password) {
    return req.query.password;
  }
  
  return null;
}

/**
 * Authentication middleware
 */
function authenticate(req, res, next) {
  // Skip authentication for public routes
  if (isPublicRoute(req.path)) {
    return next();
  }
  
  // Skip authentication for node-to-node traffic
  if (isNodeRequest(req)) {
    return next();
  }
  
  // Skip authentication for WebSocket upgrade requests (handled separately)
  if (req.headers.upgrade === 'websocket') {
    return next();
  }
  
  // Extract and verify password
  const providedPassword = extractPassword(req);
  
  if (!providedPassword) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      message: 'Please provide UI password'
    });
  }
  
  if (providedPassword !== uiPassword) {
    return res.status(401).json({
      success: false,
      error: 'Authentication failed',
      message: 'Invalid password'
    });
  }
  
  // Password is correct, proceed
  next();
}

/**
 * Verify password for WebSocket connections
 */
function verifyWebSocketAuth(password) {
  return password === uiPassword;
}

/**
 * Reload password from config (for runtime updates)
 */
function reloadPassword() {
  try {
    const configPath = path.join(__dirname, '../config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    uiPassword = config.uiPassword || 'changeme';
    console.log('UI password reloaded from config');
  } catch (err) {
    console.error('Failed to reload UI password:', err.message);
  }
}

module.exports = {
  authenticate,
  verifyWebSocketAuth,
  reloadPassword,
  isPublicRoute,
  isNodeRequest
};
