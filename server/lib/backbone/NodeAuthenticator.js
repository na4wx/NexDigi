/**
 * NodeAuthenticator.js
 * 
 * Handles node authentication using challenge-response protocol:
 * 1. Node A sends AUTH_REQUEST with its public key
 * 2. Node B validates and sends AUTH_CHALLENGE with random challenge
 * 3. Node A signs challenge and sends AUTH_RESPONSE
 * 4. Node B verifies signature and sends AUTH_SUCCESS/FAILURE
 * 
 * Features:
 * - Challenge-response authentication
 * - Mutual authentication support
 * - Session management with expiration
 * - Authentication attempt rate limiting
 */

const EventEmitter = require('events');
const crypto = require('crypto');

class NodeAuthenticator extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.securityManager = options.securityManager;
    this.localCallsign = options.localCallsign || 'NOCALL';
    this.backboneManager = options.backboneManager;
    
    if (!this.securityManager) {
      throw new Error('SecurityManager is required');
    }
    
    // Authentication sessions
    this.sessions = new Map(); // callsign -> { state, challenge, timestamp, nonce, authenticated }
    this.sessionTimeout = options.sessionTimeout || 300000; // 5 minutes
    
    // Pending challenges we've issued
    this.pendingChallenges = new Map(); // callsign -> { challenge, timestamp, nonce }
    
    // Rate limiting
    this.authAttempts = new Map(); // callsign -> { count, resetTime }
    this.maxAttemptsPerMinute = options.maxAttemptsPerMinute || 5;
    
    // Statistics
    this.stats = {
      authRequestsSent: 0,
      authRequestsReceived: 0,
      challengesSent: 0,
      challengesReceived: 0,
      authSuccesses: 0,
      authFailures: 0,
      sessionsExpired: 0,
      rateLimited: 0
    };
    
    // Cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000); // 1 minute
  }
  
  /**
   * Initiate authentication with a remote node
   */
  async authenticate(callsign) {
    // Check if already authenticated
    const session = this.sessions.get(callsign);
    if (session && session.authenticated && Date.now() - session.timestamp < this.sessionTimeout) {
      return true;
    }
    
    // Check rate limiting
    if (!this.checkRateLimit(callsign)) {
      this.stats.rateLimited++;
      this.emit('rate-limited', { callsign });
      return false;
    }
    
    // Export our public key
    const publicKeyData = this.securityManager.exportPublicKey();
    
    // Generate nonce for this request
    const nonce = this.securityManager.generateNonce();
    
    // Create auth request
    const authRequest = {
      type: 'AUTH_REQUEST',
      from: this.localCallsign,
      to: callsign,
      publicKey: publicKeyData.publicKey,
      algorithm: publicKeyData.algorithm,
      nonce: nonce,
      timestamp: Date.now()
    };
    
    // Create session
    this.sessions.set(callsign, {
      state: 'AUTH_REQUESTED',
      timestamp: Date.now(),
      nonce: nonce,
      authenticated: false
    });
    
    // Send auth request
    if (this.backboneManager) {
      this.backboneManager.sendData(callsign, {
        type: 'auth_request',
        data: authRequest
      });
    }
    
    this.stats.authRequestsSent++;
    this.emit('auth-requested', { callsign, nonce });
    
    return 'pending';
  }
  
  /**
   * Handle incoming AUTH_REQUEST
   */
  handleAuthRequest(request) {
    const { from, publicKey, algorithm, nonce, timestamp } = request;
    
    // Check rate limiting
    if (!this.checkRateLimit(from)) {
      this.stats.rateLimited++;
      this.emit('rate-limited', { callsign: from });
      return;
    }
    
    // Validate timestamp (within 5 minutes)
    const age = Date.now() - timestamp;
    if (age > 300000 || age < -60000) {
      this.emit('auth-failed', {
        callsign: from,
        reason: 'invalid-timestamp',
        age
      });
      this.stats.authFailures++;
      return;
    }
    
    // Check nonce
    if (!this.securityManager.checkNonce(nonce, from)) {
      this.emit('auth-failed', {
        callsign: from,
        reason: 'nonce-reused'
      });
      this.stats.authFailures++;
      return;
    }
    
    // Add node to trusted nodes
    this.securityManager.addTrustedNode(from, publicKey);
    
    // Generate challenge
    const challenge = crypto.randomBytes(32).toString('hex');
    const challengeNonce = this.securityManager.generateNonce();
    
    // Store pending challenge
    this.pendingChallenges.set(from, {
      challenge,
      timestamp: Date.now(),
      nonce: challengeNonce
    });
    
    // Send challenge
    const authChallenge = {
      type: 'AUTH_CHALLENGE',
      from: this.localCallsign,
      to: from,
      challenge: challenge,
      nonce: challengeNonce,
      timestamp: Date.now()
    };
    
    if (this.backboneManager) {
      this.backboneManager.sendData(from, {
        type: 'auth_challenge',
        data: authChallenge
      });
    }
    
    this.stats.authRequestsReceived++;
    this.stats.challengesSent++;
    this.emit('challenge-sent', { callsign: from, challenge });
  }
  
  /**
   * Handle incoming AUTH_CHALLENGE
   */
  handleAuthChallenge(challenge) {
    const { from, challenge: challengeData, nonce, timestamp } = challenge;
    
    // Check if we have a pending auth request
    const session = this.sessions.get(from);
    if (!session || session.state !== 'AUTH_REQUESTED') {
      this.emit('auth-failed', {
        callsign: from,
        reason: 'unexpected-challenge'
      });
      return;
    }
    
    // Validate timestamp
    const age = Date.now() - timestamp;
    if (age > 300000 || age < -60000) {
      this.emit('auth-failed', {
        callsign: from,
        reason: 'invalid-timestamp',
        age
      });
      return;
    }
    
    // Check nonce
    if (!this.securityManager.checkNonce(nonce, from)) {
      this.emit('auth-failed', {
        callsign: from,
        reason: 'nonce-reused'
      });
      return;
    }
    
    // Sign the challenge
    const signedChallenge = this.securityManager.signMessage(challengeData);
    
    // Send response
    const authResponse = {
      type: 'AUTH_RESPONSE',
      from: this.localCallsign,
      to: from,
      challenge: challengeData,
      signature: signedChallenge.signature.toString('hex'),
      nonce: this.securityManager.generateNonce(),
      timestamp: Date.now()
    };
    
    if (this.backboneManager) {
      this.backboneManager.sendData(from, {
        type: 'auth_response',
        data: authResponse
      });
    }
    
    // Update session state
    session.state = 'CHALLENGE_RESPONDED';
    session.timestamp = Date.now();
    
    this.stats.challengesReceived++;
    this.emit('challenge-responded', { callsign: from });
  }
  
  /**
   * Handle incoming AUTH_RESPONSE
   */
  handleAuthResponse(response) {
    const { from, challenge, signature, nonce, timestamp } = response;
    
    // Check if we have a pending challenge
    const pendingChallenge = this.pendingChallenges.get(from);
    if (!pendingChallenge) {
      this.emit('auth-failed', {
        callsign: from,
        reason: 'no-pending-challenge'
      });
      this.stats.authFailures++;
      return;
    }
    
    // Validate challenge matches
    if (challenge !== pendingChallenge.challenge) {
      this.emit('auth-failed', {
        callsign: from,
        reason: 'challenge-mismatch'
      });
      this.stats.authFailures++;
      this.pendingChallenges.delete(from);
      return;
    }
    
    // Validate timestamp
    const age = Date.now() - timestamp;
    if (age > 300000 || age < -60000) {
      this.emit('auth-failed', {
        callsign: from,
        reason: 'invalid-timestamp',
        age
      });
      this.stats.authFailures++;
      this.pendingChallenges.delete(from);
      return;
    }
    
    // Check nonce
    if (!this.securityManager.checkNonce(nonce, from)) {
      this.emit('auth-failed', {
        callsign: from,
        reason: 'nonce-reused'
      });
      this.stats.authFailures++;
      this.pendingChallenges.delete(from);
      return;
    }
    
    // Verify signature
    const signatureBuffer = Buffer.from(signature, 'hex');
    const verified = this.securityManager.verifySignature(challenge, signatureBuffer, from);
    
    // Clean up pending challenge
    this.pendingChallenges.delete(from);
    
    if (verified) {
      // Authentication successful
      this.sessions.set(from, {
        state: 'AUTHENTICATED',
        timestamp: Date.now(),
        authenticated: true
      });
      
      // Send success message
      const authSuccess = {
        type: 'AUTH_SUCCESS',
        from: this.localCallsign,
        to: from,
        timestamp: Date.now()
      };
      
      if (this.backboneManager) {
        this.backboneManager.sendData(from, {
          type: 'auth_success',
          data: authSuccess
        });
      }
      
      this.stats.authSuccesses++;
      this.emit('auth-success', { callsign: from });
    } else {
      // Authentication failed
      const authFailure = {
        type: 'AUTH_FAILURE',
        from: this.localCallsign,
        to: from,
        reason: 'invalid-signature',
        timestamp: Date.now()
      };
      
      if (this.backboneManager) {
        this.backboneManager.sendData(from, {
          type: 'auth_failure',
          data: authFailure
        });
      }
      
      this.stats.authFailures++;
      this.emit('auth-failed', {
        callsign: from,
        reason: 'invalid-signature'
      });
    }
  }
  
  /**
   * Handle incoming AUTH_SUCCESS
   */
  handleAuthSuccess(success) {
    const { from } = success;
    
    const session = this.sessions.get(from);
    if (!session) {
      return;
    }
    
    // Mark as authenticated
    session.state = 'AUTHENTICATED';
    session.authenticated = true;
    session.timestamp = Date.now();
    
    this.stats.authSuccesses++;
    this.emit('auth-success', { callsign: from });
  }
  
  /**
   * Handle incoming AUTH_FAILURE
   */
  handleAuthFailure(failure) {
    const { from, reason } = failure;
    
    // Remove session
    this.sessions.delete(from);
    
    this.stats.authFailures++;
    this.emit('auth-failed', { callsign: from, reason });
  }
  
  /**
   * Check if a node is authenticated
   */
  isAuthenticated(callsign) {
    const session = this.sessions.get(callsign);
    
    if (!session || !session.authenticated) {
      return false;
    }
    
    // Check if session has expired
    if (Date.now() - session.timestamp > this.sessionTimeout) {
      this.sessions.delete(callsign);
      this.stats.sessionsExpired++;
      this.emit('session-expired', { callsign });
      return false;
    }
    
    return true;
  }
  
  /**
   * Revoke authentication for a node
   */
  revokeAuthentication(callsign) {
    const removed = this.sessions.delete(callsign);
    
    if (removed) {
      this.emit('auth-revoked', { callsign });
    }
    
    return removed;
  }
  
  /**
   * Check authentication rate limiting
   */
  checkRateLimit(callsign) {
    const now = Date.now();
    const limit = this.authAttempts.get(callsign);
    
    if (!limit || now > limit.resetTime) {
      // Start new window
      this.authAttempts.set(callsign, {
        count: 1,
        resetTime: now + 60000 // 1 minute
      });
      return true;
    }
    
    if (limit.count >= this.maxAttemptsPerMinute) {
      return false;
    }
    
    limit.count++;
    return true;
  }
  
  /**
   * Clean up expired sessions and challenges
   */
  cleanup() {
    const now = Date.now();
    
    // Clean up expired sessions
    for (const [callsign, session] of this.sessions.entries()) {
      if (now - session.timestamp > this.sessionTimeout) {
        this.sessions.delete(callsign);
        this.stats.sessionsExpired++;
        this.emit('session-expired', { callsign });
      }
    }
    
    // Clean up expired challenges
    for (const [callsign, challenge] of this.pendingChallenges.entries()) {
      if (now - challenge.timestamp > 60000) { // 1 minute
        this.pendingChallenges.delete(callsign);
      }
    }
    
    // Clean up rate limit tracking
    for (const [callsign, limit] of this.authAttempts.entries()) {
      if (now > limit.resetTime) {
        this.authAttempts.delete(callsign);
      }
    }
  }
  
  /**
   * Get authentication status for all nodes
   */
  getAuthenticatedNodes() {
    const authenticated = [];
    
    for (const [callsign, session] of this.sessions.entries()) {
      if (session.authenticated && Date.now() - session.timestamp < this.sessionTimeout) {
        authenticated.push({
          callsign,
          authenticatedAt: session.timestamp,
          age: Date.now() - session.timestamp
        });
      }
    }
    
    return authenticated;
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      activeSessions: this.sessions.size,
      pendingChallenges: this.pendingChallenges.size,
      authenticatedNodes: this.getAuthenticatedNodes().length
    };
  }
  
  /**
   * Shutdown
   */
  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    this.emit('shutdown');
  }
}

module.exports = NodeAuthenticator;
