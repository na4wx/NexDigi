/**
 * Bloom Filter Implementation
 * 
 * Space-efficient probabilistic data structure for testing set membership.
 * Used for efficient BBS message synchronization queries.
 * 
 * False positives are possible, but false negatives are not.
 * This means if the filter says "not present", the element is definitely not in the set.
 * If it says "maybe present", we need to check the actual data.
 */

const crypto = require('crypto');

class BloomFilter {
  /**
   * Create a Bloom filter
   * @param {number} expectedElements - Expected number of elements
   * @param {number} falsePositiveRate - Desired false positive rate (0-1)
   */
  constructor(expectedElements = 10000, falsePositiveRate = 0.01) {
    this.expectedElements = expectedElements;
    this.falsePositiveRate = falsePositiveRate;
    
    // Calculate optimal bit array size
    // m = -(n * ln(p)) / (ln(2)^2)
    this.bitSize = Math.ceil(
      -(expectedElements * Math.log(falsePositiveRate)) / (Math.log(2) ** 2)
    );
    
    // Calculate optimal number of hash functions
    // k = (m/n) * ln(2)
    this.numHashes = Math.ceil((this.bitSize / expectedElements) * Math.log(2));
    
    // Initialize bit array (using Uint8Array for efficiency)
    const arraySize = Math.ceil(this.bitSize / 8);
    this.bits = new Uint8Array(arraySize);
    
    // Track number of elements added
    this.elementCount = 0;
    
    console.log(`[BloomFilter] Created: ${this.bitSize} bits, ${this.numHashes} hashes, ${arraySize} bytes`);
  }
  
  /**
   * Add an element to the filter
   * @param {string} element - Element to add
   */
  add(element) {
    const hashes = this._getHashes(element);
    
    for (const hash of hashes) {
      const bitIndex = hash % this.bitSize;
      const byteIndex = Math.floor(bitIndex / 8);
      const bitOffset = bitIndex % 8;
      
      this.bits[byteIndex] |= (1 << bitOffset);
    }
    
    this.elementCount++;
  }
  
  /**
   * Test if an element might be in the set
   * @param {string} element - Element to test
   * @returns {boolean} True if possibly present, false if definitely not present
   */
  has(element) {
    const hashes = this._getHashes(element);
    
    for (const hash of hashes) {
      const bitIndex = hash % this.bitSize;
      const byteIndex = Math.floor(bitIndex / 8);
      const bitOffset = bitIndex % 8;
      
      if ((this.bits[byteIndex] & (1 << bitOffset)) === 0) {
        return false; // Definitely not present
      }
    }
    
    return true; // Possibly present
  }
  
  /**
   * Get multiple hash values for an element
   * @private
   * @param {string} element - Element to hash
   * @returns {number[]} Array of hash values
   */
  _getHashes(element) {
    const hashes = [];
    
    // Use double hashing technique: h_i(x) = h1(x) + i * h2(x)
    const hash1 = this._hash(element, 0);
    const hash2 = this._hash(element, 1);
    
    for (let i = 0; i < this.numHashes; i++) {
      // Combine hashes using double hashing
      const hash = Math.abs(hash1 + i * hash2);
      hashes.push(hash);
    }
    
    return hashes;
  }
  
  /**
   * Hash function using crypto
   * @private
   * @param {string} element - Element to hash
   * @param {number} seed - Hash seed
   * @returns {number} Hash value
   */
  _hash(element, seed) {
    const hash = crypto.createHash('sha256');
    hash.update(element + seed);
    const digest = hash.digest();
    
    // Convert first 4 bytes to a number
    return digest.readUInt32BE(0);
  }
  
  /**
   * Clear the filter
   */
  clear() {
    this.bits.fill(0);
    this.elementCount = 0;
  }
  
  /**
   * Get filter statistics
   * @returns {Object} Statistics
   */
  getStats() {
    const setBits = this._countSetBits();
    const fillRatio = setBits / this.bitSize;
    
    // Estimate actual false positive rate
    // p = (1 - e^(-k*n/m))^k
    const estimatedFPR = Math.pow(
      1 - Math.exp(-(this.numHashes * this.elementCount) / this.bitSize),
      this.numHashes
    );
    
    return {
      bitSize: this.bitSize,
      numHashes: this.numHashes,
      elementCount: this.elementCount,
      setBits,
      fillRatio: fillRatio.toFixed(4),
      estimatedFalsePositiveRate: estimatedFPR.toFixed(6),
      memoryBytes: this.bits.length
    };
  }
  
  /**
   * Count number of set bits
   * @private
   * @returns {number} Number of bits set to 1
   */
  _countSetBits() {
    let count = 0;
    for (const byte of this.bits) {
      // Brian Kernighan's algorithm
      let n = byte;
      while (n) {
        n &= n - 1;
        count++;
      }
    }
    return count;
  }
  
  /**
   * Serialize filter to buffer for transmission
   * @returns {Object} Serialized filter
   */
  serialize() {
    return {
      bitSize: this.bitSize,
      numHashes: this.numHashes,
      elementCount: this.elementCount,
      bits: Buffer.from(this.bits).toString('base64')
    };
  }
  
  /**
   * Deserialize filter from buffer
   * @param {Object} data - Serialized filter data
   * @returns {BloomFilter} Reconstructed filter
   */
  static deserialize(data) {
    const filter = Object.create(BloomFilter.prototype);
    filter.bitSize = data.bitSize;
    filter.numHashes = data.numHashes;
    filter.elementCount = data.elementCount;
    filter.bits = new Uint8Array(Buffer.from(data.bits, 'base64'));
    filter.expectedElements = data.elementCount;
    filter.falsePositiveRate = 0.01; // Default
    return filter;
  }
  
  /**
   * Perform bitwise OR with another filter (union)
   * @param {BloomFilter} other - Other filter
   * @throws {Error} If filters are incompatible
   */
  union(other) {
    if (this.bitSize !== other.bitSize || this.numHashes !== other.numHashes) {
      throw new Error('Cannot union incompatible Bloom filters');
    }
    
    for (let i = 0; i < this.bits.length; i++) {
      this.bits[i] |= other.bits[i];
    }
    
    // Element count is approximate after union
    this.elementCount = Math.max(this.elementCount, other.elementCount);
  }
  
  /**
   * Perform bitwise AND with another filter (intersection)
   * @param {BloomFilter} other - Other filter
   * @throws {Error} If filters are incompatible
   */
  intersection(other) {
    if (this.bitSize !== other.bitSize || this.numHashes !== other.numHashes) {
      throw new Error('Cannot intersect incompatible Bloom filters');
    }
    
    for (let i = 0; i < this.bits.length; i++) {
      this.bits[i] &= other.bits[i];
    }
    
    // Element count is approximate after intersection
    this.elementCount = Math.min(this.elementCount, other.elementCount);
  }
}

module.exports = BloomFilter;
