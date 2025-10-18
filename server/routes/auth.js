/**
 * auth.js - Authentication API routes
 */

const express = require('express');
const router = express.Router();
const { verifyWebSocketAuth } = require('../middleware/auth');

/**
 * POST /api/auth/verify
 * Verify UI password
 */
router.post('/verify', (req, res) => {
  const { password } = req.body;
  
  if (!password) {
    return res.status(400).json({
      success: false,
      error: 'Password is required'
    });
  }
  
  const isValid = verifyWebSocketAuth(password);
  
  if (isValid) {
    return res.json({
      success: true,
      message: 'Authentication successful'
    });
  } else {
    return res.status(401).json({
      success: false,
      error: 'Invalid password'
    });
  }
});

module.exports = router;
