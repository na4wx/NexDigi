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
 * Routes that don't require authentication (read-only or system).
 *
 * NOTE: this middleware is mounted with `app.use('/api', authenticate)`, which
 * strips the '/api' prefix from req.path before it reaches us — so these
 * entries must NOT include the '/api' prefix, or they will never match.
 * `methods: null` means all methods are public; otherwise only the listed
 * HTTP methods are exempted (e.g. settings endpoints are GET-only public).
 */
const publicRoutes = [
  { path: '/frames', methods: null },              // Frame display (read-only)
  { path: '/channels', methods: null },             // Channel list (read-only)
  { path: '/stats', methods: null },                // Statistics (read-only)
  { path: '/lastheard', methods: null },            // Last heard stations (read-only)
  { path: '/backbone', methods: null },             // Backbone/mesh traffic (inter-node)
  { path: '/nexnet', methods: null },               // NexNet mesh traffic (inter-node)
  { path: '/digipeater/metrics', methods: null },   // Digipeater metrics (read-only)
  { path: '/bbs/settings', methods: ['GET'] },      // BBS settings (read-only)
  { path: '/digipeater/settings', methods: ['GET'] } // Digipeater settings (read-only)
];

/**
 * Check if a route is public (no auth required) for the given HTTP method.
 */
function isPublicRoute(url, method) {
  return publicRoutes.some(route => {
    const matchesPath = url === route.path || url.startsWith(route.path + '/');
    if (!matchesPath) return false;
    if (!route.methods) return true;
    return route.methods.includes((method || 'GET').toUpperCase());
  });
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
  // Skip authentication for public (read-only) routes
  if (isPublicRoute(req.path, req.method)) {
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
  isPublicRoute
};
