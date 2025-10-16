/**
 * SecurityManager.js
 * 
 * Provides cryptographic operations for backbone network security:
 * - Ed25519 key pair generation and management
 * - Message signing and signature verification
 * - AES-256-GCM encryption and decryption
 * - Nonce generation for replay attack prevention
 * - Certificate-style node identity verification
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');

class SecurityManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.localCallsign = options.localCallsign || 'NOCALL';
    this.keyDir = options.keyDir || path.join(__dirname, '../../data/keys');
    
    // Key storage
    this.privateKey = null;  // Ed25519 private key
    this.publicKey = null;   // Ed25519 public key
    this.trustedNodes = new Map(); // callsign -> { publicKey, addedAt, lastSeen }
    
    // Nonce tracking for replay prevention
    this.usedNonces = new Map(); // nonce -> { timestamp, source }
    this.nonceMaxAge = options.nonceMaxAge || 300000; // 5 minutes
    
    // Encryption settings
    this.encryptionAlgorithm = 'aes-256-gcm';
    this.signatureAlgorithm = 'ed25519';
    
    // Statistics
    this.stats = {
      messagesEncrypted: 0,
      messagesDecrypted: 0,
      messagesSigned: 0,
      signaturesVerified: 0,
      signaturesFailed: 0,
      noncesRejected: 0,
      keysGenerated: 0
    };
    
    // Cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000); // 1 minute
  }
  
  /**
   * Initialize security manager - generate or load keys
   */
  async initialize() {
    try {
      // Ensure key directory exists
      await fs.mkdir(this.keyDir, { recursive: true });
      
      // Try to load existing keys
      const loaded = await this.loadKeys();
      
      if (!loaded) {
        // Generate new key pair
        await this.generateKeyPair();
        await this.saveKeys();
      }
      
      this.emit('initialized', {
        callsign: this.localCallsign,
        publicKey: this.publicKey.toString('hex')
      });
      
      return true;
    } catch (error) {
      this.emit('error', { context: 'initialize', error: error.message });
      throw error;
    }
  }
  
  /**
   * Generate Ed25519 key pair
   */
  async generateKeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' }
    });
    
    this.publicKey = Buffer.from(publicKey);
    this.privateKey = Buffer.from(privateKey);
    this.stats.keysGenerated++;
    
    this.emit('keys-generated', {
      callsign: this.localCallsign,
      publicKey: this.publicKey.toString('hex')
    });
    
    return {
      publicKey: this.publicKey,
      privateKey: this.privateKey
    };
  }
  
  /**
   * Load keys from disk
   */
  async loadKeys() {
    try {
      const pubPath = path.join(this.keyDir, `${this.localCallsign}_pub.key`);
      const privPath = path.join(this.keyDir, `${this.localCallsign}_priv.key`);
      
      this.publicKey = await fs.readFile(pubPath);
      this.privateKey = await fs.readFile(privPath);
      
      this.emit('keys-loaded', {
        callsign: this.localCallsign,
        publicKey: this.publicKey.toString('hex')
      });
      
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return false; // Keys don't exist yet
      }
      throw error;
    }
  }
  
  /**
   * Save keys to disk
   */
  async saveKeys() {
    if (!this.publicKey || !this.privateKey) {
      throw new Error('No keys to save');
    }
    
    const pubPath = path.join(this.keyDir, `${this.localCallsign}_pub.key`);
    const privPath = path.join(this.keyDir, `${this.localCallsign}_priv.key`);
    
    await fs.writeFile(pubPath, this.publicKey);
    await fs.writeFile(privPath, this.privateKey, { mode: 0o600 }); // Private key read-only
    
    this.emit('keys-saved', { callsign: this.localCallsign });
  }
  
  /**
   * Sign a message with our private key
   */
  signMessage(message) {
    if (!this.privateKey) {
      throw new Error('No private key available for signing');
    }
    
    const messageBuffer = Buffer.isBuffer(message) ? message : Buffer.from(JSON.stringify(message));
    
    const privateKeyObject = crypto.createPrivateKey({
      key: this.privateKey,
      format: 'der',
      type: 'pkcs8'
    });
    
    const signature = crypto.sign(null, messageBuffer, privateKeyObject);
    this.stats.messagesSigned++;
    
    return {
      message: messageBuffer,
      signature: signature,
      signer: this.localCallsign,
      signedAt: Date.now()
    };
  }
  
  /**
   * Verify a message signature
   */
  verifySignature(message, signature, callsign) {
    const trustedNode = this.trustedNodes.get(callsign);
    if (!trustedNode) {
      this.stats.signaturesFailed++;
      this.emit('signature-failed', {
        reason: 'untrusted-node',
        callsign
      });
      return false;
    }
    
    const messageBuffer = Buffer.isBuffer(message) ? message : Buffer.from(JSON.stringify(message));
    const signatureBuffer = Buffer.isBuffer(signature) ? signature : Buffer.from(signature, 'hex');
    
    const publicKeyObject = crypto.createPublicKey({
      key: trustedNode.publicKey,
      format: 'der',
      type: 'spki'
    });
    
    try {
      const verified = crypto.verify(null, messageBuffer, publicKeyObject, signatureBuffer);
      
      if (verified) {
        this.stats.signaturesVerified++;
        trustedNode.lastSeen = Date.now();
      } else {
        this.stats.signaturesFailed++;
        this.emit('signature-failed', {
          reason: 'invalid-signature',
          callsign
        });
      }
      
      return verified;
    } catch (error) {
      this.stats.signaturesFailed++;
      this.emit('signature-failed', {
        reason: 'verification-error',
        callsign,
        error: error.message
      });
      return false;
    }
  }
  
  /**
   * Encrypt a message using AES-256-GCM with a shared key
   */
  encryptMessage(message, sharedKey) {
    const messageBuffer = Buffer.isBuffer(message) ? message : Buffer.from(JSON.stringify(message));
    const keyBuffer = Buffer.isBuffer(sharedKey) ? sharedKey : Buffer.from(sharedKey, 'hex');
    
    // Generate random IV
    const iv = crypto.randomBytes(12); // 96 bits for GCM
    
    // Create cipher
    const cipher = crypto.createCipheriv(this.encryptionAlgorithm, keyBuffer, iv);
    
    // Encrypt
    const encrypted = Buffer.concat([
      cipher.update(messageBuffer),
      cipher.final()
    ]);
    
    // Get auth tag
    const authTag = cipher.getAuthTag();
    
    this.stats.messagesEncrypted++;
    
    return {
      ciphertext: encrypted,
      iv: iv,
      authTag: authTag,
      algorithm: this.encryptionAlgorithm
    };
  }
  
  /**
   * Decrypt a message using AES-256-GCM
   */
  decryptMessage(ciphertext, iv, authTag, sharedKey) {
    const ciphertextBuffer = Buffer.isBuffer(ciphertext) ? ciphertext : Buffer.from(ciphertext, 'hex');
    const ivBuffer = Buffer.isBuffer(iv) ? iv : Buffer.from(iv, 'hex');
    const authTagBuffer = Buffer.isBuffer(authTag) ? authTag : Buffer.from(authTag, 'hex');
    const keyBuffer = Buffer.isBuffer(sharedKey) ? sharedKey : Buffer.from(sharedKey, 'hex');
    
    // Create decipher
    const decipher = crypto.createDecipheriv(this.encryptionAlgorithm, keyBuffer, ivBuffer);
    decipher.setAuthTag(authTagBuffer);
    
    try {
      // Decrypt
      const decrypted = Buffer.concat([
        decipher.update(ciphertextBuffer),
        decipher.final()
      ]);
      
      this.stats.messagesDecrypted++;
      
      return decrypted;
    } catch (error) {
      this.emit('error', {
        context: 'decryptMessage',
        error: error.message
      });
      throw new Error('Decryption failed: ' + error.message);
    }
  }
  
  /**
   * Generate a nonce for replay attack prevention
   */
  generateNonce() {
    return crypto.randomBytes(16).toString('hex');
  }
  
  /**
   * Check if a nonce has been used (replay attack prevention)
   */
  checkNonce(nonce, source) {
    const existing = this.usedNonces.get(nonce);
    
    if (existing) {
      this.stats.noncesRejected++;
      this.emit('nonce-rejected', {
        nonce,
        source,
        originalSource: existing.source,
        age: Date.now() - existing.timestamp
      });
      return false;
    }
    
    // Mark nonce as used
    this.usedNonces.set(nonce, {
      timestamp: Date.now(),
      source
    });
    
    return true;
  }
  
  /**
   * Add a trusted node's public key
   */
  addTrustedNode(callsign, publicKey) {
    const publicKeyBuffer = Buffer.isBuffer(publicKey) ? publicKey : Buffer.from(publicKey, 'hex');
    
    this.trustedNodes.set(callsign, {
      publicKey: publicKeyBuffer,
      addedAt: Date.now(),
      lastSeen: Date.now()
    });
    
    this.emit('node-trusted', {
      callsign,
      publicKey: publicKeyBuffer.toString('hex')
    });
    
    return true;
  }
  
  /**
   * Remove a trusted node
   */
  removeTrustedNode(callsign) {
    const removed = this.trustedNodes.delete(callsign);
    
    if (removed) {
      this.emit('node-untrusted', { callsign });
    }
    
    return removed;
  }
  
  /**
   * Get a trusted node's public key
   */
  getTrustedNode(callsign) {
    const node = this.trustedNodes.get(callsign);
    return node ? {
      callsign,
      publicKey: node.publicKey.toString('hex'),
      addedAt: node.addedAt,
      lastSeen: node.lastSeen
    } : null;
  }
  
  /**
   * Get all trusted nodes
   */
  getTrustedNodes() {
    return Array.from(this.trustedNodes.entries()).map(([callsign, node]) => ({
      callsign,
      publicKey: node.publicKey.toString('hex'),
      addedAt: node.addedAt,
      lastSeen: node.lastSeen
    }));
  }
  
  /**
   * Derive a shared key using ECDH (for encryption)
   * Note: For production, use proper key exchange protocol
   */
  deriveSharedKey(theirPublicKey) {
    // For now, use a simple hash of both public keys
    // In production, implement proper ECDH key exchange
    const theirPublicKeyBuffer = Buffer.isBuffer(theirPublicKey) ? theirPublicKey : Buffer.from(theirPublicKey, 'hex');
    
    // Sort keys to ensure both parties derive the same shared key
    const keys = [this.publicKey, theirPublicKeyBuffer].sort(Buffer.compare);
    const combined = Buffer.concat(keys);
    const sharedKey = crypto.createHash('sha256').update(combined).digest();
    
    return sharedKey;
  }
  
  /**
   * Clean up old nonces
   */
  cleanup() {
    const now = Date.now();
    const maxAge = this.nonceMaxAge;
    
    for (const [nonce, data] of this.usedNonces.entries()) {
      if (now - data.timestamp > maxAge) {
        this.usedNonces.delete(nonce);
      }
    }
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      trustedNodes: this.trustedNodes.size,
      usedNonces: this.usedNonces.size
    };
  }
  
  /**
   * Export public key for sharing
   */
  exportPublicKey() {
    if (!this.publicKey) {
      throw new Error('No public key available');
    }
    
    return {
      callsign: this.localCallsign,
      publicKey: this.publicKey.toString('hex'),
      algorithm: this.signatureAlgorithm,
      exportedAt: Date.now()
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

module.exports = SecurityManager;
