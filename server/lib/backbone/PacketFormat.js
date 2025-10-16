/**
 * PacketFormat.js
 * Backbone packet format encoder/decoder
 * 
 * Packet Structure:
 * - Header (fixed size, 64 bytes)
 *   - Version (1 byte)
 *   - Type (1 byte)
 *   - Flags (1 byte)
 *   - Reserved (1 byte)
 *   - Source callsign (10 bytes, null-padded)
 *   - Destination callsign (10 bytes, null-padded)
 *   - Message ID (16 bytes)
 *   - TTL (1 byte)
 *   - Priority (1 byte)
 *   - Payload length (4 bytes, uint32)
 *   - Checksum (2 bytes, CRC16)
 *   - Reserved (16 bytes)
 * - Routing Info (variable, TLV format)
 * - Payload (variable)
 */

const crypto = require('crypto');

// Packet types
const PacketType = {
  HELLO: 0x01,        // Node announcement
  LSA: 0x02,          // Link State Advertisement (routing update)
  DATA: 0x03,         // User data packet
  ACK: 0x04,          // Acknowledgment
  SERVICE_QUERY: 0x05,// Service discovery query
  SERVICE_REPLY: 0x06,// Service discovery reply
  KEEPALIVE: 0x07,    // Keep connection alive
  ERROR: 0x08,        // Error notification
  NEIGHBOR_LIST: 0x09,// Hub-provided neighbor list (hub-and-spoke mode)
  REGISTRY_UPDATE: 0x0A // User registry update
};

// Packet flags
const PacketFlags = {
  NONE: 0x00,
  COMPRESSED: 0x01,   // Payload is compressed
  ENCRYPTED: 0x02,    // Payload is encrypted (Internet only)
  FRAGMENTED: 0x04,   // Part of fragmented message
  URGENT: 0x08        // Emergency/priority traffic
};

// Priority levels
const Priority = {
  EMERGENCY: 0,       // Life/death, highest priority
  URGENT: 1,          // Time-sensitive operational
  HIGH: 2,            // Important but not urgent
  NORMAL: 3,          // Regular traffic
  LOW: 4,             // Bulk/background
  LOWEST: 5           // Opportunistic forwarding
};

// Header constants
const HEADER_SIZE = 64;
const VERSION = 1;

class PacketFormat {
  /**
   * Encode a backbone packet
   * @param {Object} packet - Packet object
   * @returns {Buffer} - Encoded packet
   */
  static encode(packet) {
    const {
      type,
      source,
      destination,
      messageId,
      ttl = 16,
      priority = Priority.NORMAL,
      flags = PacketFlags.NONE,
      routingInfo = {},
      payload = Buffer.alloc(0)
    } = packet;

    // Validate required fields
    if (!type || !source || !destination) {
      throw new Error('Missing required packet fields: type, source, destination');
    }

    // Create header buffer
    const header = Buffer.alloc(HEADER_SIZE);
    let offset = 0;

    // Version (1 byte)
    header.writeUInt8(VERSION, offset);
    offset += 1;

    // Type (1 byte)
    header.writeUInt8(type, offset);
    offset += 1;

    // Flags (1 byte)
    header.writeUInt8(flags, offset);
    offset += 1;

    // Reserved (1 byte)
    offset += 1;

    // Source callsign (10 bytes)
    header.write(source.substring(0, 10).toUpperCase(), offset, 10, 'ascii');
    offset += 10;

    // Destination callsign (10 bytes)
    header.write(destination.substring(0, 10).toUpperCase(), offset, 10, 'ascii');
    offset += 10;

    // Message ID (16 bytes)
    const msgId = messageId || crypto.randomBytes(16);
    const msgIdBuf = Buffer.isBuffer(msgId) ? msgId : Buffer.from(msgId, 'hex');
    msgIdBuf.copy(header, offset, 0, 16);
    offset += 16;

    // TTL (1 byte)
    header.writeUInt8(ttl, offset);
    offset += 1;

    // Priority (1 byte)
    header.writeUInt8(priority, offset);
    offset += 1;

    // Encode routing info (TLV format)
    const routingInfoBuf = this._encodeRoutingInfo(routingInfo);

    // Total payload length = routing info + user payload
    const totalPayloadLength = routingInfoBuf.length + payload.length;

    // Payload length (4 bytes, uint32)
    header.writeUInt32BE(totalPayloadLength, offset);
    offset += 4;

    // Calculate CRC16 for header (excluding checksum field itself)
    const checksum = this._calculateCRC16(header.slice(0, offset));
    header.writeUInt16BE(checksum, offset);
    offset += 2;

    // Reserved (16 bytes) - already zeroed
    // offset += 16;

    // Combine all parts
    return Buffer.concat([header, routingInfoBuf, payload]);
  }

  /**
   * Decode a backbone packet
   * @param {Buffer} buffer - Encoded packet
   * @returns {Object} - Decoded packet object
   */
  static decode(buffer) {
    if (buffer.length < HEADER_SIZE) {
      throw new Error(`Packet too small: ${buffer.length} bytes (minimum ${HEADER_SIZE})`);
    }

    let offset = 0;

    // Version (1 byte)
    const version = buffer.readUInt8(offset);
    offset += 1;

    if (version !== VERSION) {
      throw new Error(`Unsupported packet version: ${version}`);
    }

    // Type (1 byte)
    const type = buffer.readUInt8(offset);
    offset += 1;

    // Flags (1 byte)
    const flags = buffer.readUInt8(offset);
    offset += 1;

    // Reserved (1 byte)
    offset += 1;

    // Source callsign (10 bytes)
    const source = buffer.toString('ascii', offset, offset + 10).replace(/\0/g, '').trim();
    offset += 10;

    // Destination callsign (10 bytes)
    const destination = buffer.toString('ascii', offset, offset + 10).replace(/\0/g, '').trim();
    offset += 10;

    // Message ID (16 bytes)
    const messageId = buffer.slice(offset, offset + 16).toString('hex');
    offset += 16;

    // TTL (1 byte)
    const ttl = buffer.readUInt8(offset);
    offset += 1;

    // Priority (1 byte)
    const priority = buffer.readUInt8(offset);
    offset += 1;

    // Payload length (4 bytes)
    const payloadLength = buffer.readUInt32BE(offset);
    offset += 4;

    // Checksum (2 bytes)
    const storedChecksum = buffer.readUInt16BE(offset);
    offset += 2;

    // Verify checksum
    const calculatedChecksum = this._calculateCRC16(buffer.slice(0, offset - 2));
    if (storedChecksum !== calculatedChecksum) {
      throw new Error(`Checksum mismatch: expected ${storedChecksum}, got ${calculatedChecksum}`);
    }

    // Reserved (16 bytes)
    offset += 16;

    // Extract payload (routing info + user data)
    const payloadBuffer = buffer.slice(offset, offset + payloadLength);
    
    if (payloadBuffer.length !== payloadLength) {
      throw new Error(`Incomplete packet: expected ${payloadLength} payload bytes, got ${payloadBuffer.length}`);
    }

    // Decode routing info (TLV format)
    const { routingInfo, dataOffset } = this._decodeRoutingInfo(payloadBuffer);

    // Extract user payload
    const payload = payloadBuffer.slice(dataOffset);

    return {
      version,
      type,
      flags,
      source,
      destination,
      messageId,
      ttl,
      priority,
      routingInfo,
      payload,
      rawHeader: buffer.slice(0, HEADER_SIZE)
    };
  }

  /**
   * Encode routing info in TLV (Type-Length-Value) format
   * @param {Object} routingInfo
   * @returns {Buffer}
   */
  static _encodeRoutingInfo(routingInfo) {
    const tlvs = [];

    // Via path (type 0x01)
    if (routingInfo.viaPath && routingInfo.viaPath.length > 0) {
      const pathStr = routingInfo.viaPath.join(',');
      const pathBuf = Buffer.from(pathStr, 'ascii');
      const tlv = Buffer.alloc(3 + pathBuf.length);
      tlv.writeUInt8(0x01, 0);
      tlv.writeUInt16BE(pathBuf.length, 1);
      pathBuf.copy(tlv, 3);
      tlvs.push(tlv);
    }

    // Service type (type 0x02)
    if (routingInfo.service) {
      const serviceBuf = Buffer.from(routingInfo.service, 'ascii');
      const tlv = Buffer.alloc(3 + serviceBuf.length);
      tlv.writeUInt8(0x02, 0);
      tlv.writeUInt16BE(serviceBuf.length, 1);
      serviceBuf.copy(tlv, 3);
      tlvs.push(tlv);
    }

    // Cost metric (type 0x03)
    if (routingInfo.cost !== undefined) {
      const tlv = Buffer.alloc(5);
      tlv.writeUInt8(0x03, 0);
      tlv.writeUInt16BE(2, 1);
      tlv.writeUInt16BE(routingInfo.cost, 3);
      tlvs.push(tlv);
    }

    // Add end-of-routing-info marker (type 0x00, length 0)
    const endMarker = Buffer.alloc(3);
    endMarker.writeUInt8(0x00, 0);
    endMarker.writeUInt16BE(0, 1);
    tlvs.push(endMarker);

    return Buffer.concat(tlvs);
  }

  /**
   * Decode routing info from TLV format
   * @param {Buffer} buffer
   * @returns {Object} - { routingInfo, dataOffset }
   */
  static _decodeRoutingInfo(buffer) {
    const routingInfo = {};
    let offset = 0;

    while (offset < buffer.length) {
      const type = buffer.readUInt8(offset);
      const length = buffer.readUInt16BE(offset + 1);
      offset += 3;

      // End of routing info
      if (type === 0x00) {
        break;
      }

      const value = buffer.slice(offset, offset + length);
      offset += length;

      switch (type) {
        case 0x01: // Via path
          routingInfo.viaPath = value.toString('ascii').split(',');
          break;
        case 0x02: // Service type
          routingInfo.service = value.toString('ascii');
          break;
        case 0x03: // Cost metric
          routingInfo.cost = value.readUInt16BE(0);
          break;
        default:
          // Unknown TLV, skip
          break;
      }
    }

    return { routingInfo, dataOffset: offset };
  }

  /**
   * Calculate CRC16 checksum
   * @param {Buffer} buffer
   * @returns {Number}
   */
  static _calculateCRC16(buffer) {
    let crc = 0xFFFF;
    for (let i = 0; i < buffer.length; i++) {
      crc ^= buffer[i];
      for (let j = 0; j < 8; j++) {
        if (crc & 0x0001) {
          crc = (crc >> 1) ^ 0xA001;
        } else {
          crc >>= 1;
        }
      }
    }
    return crc;
  }

  /**
   * Create a HELLO packet
   * @param {String} source - Source callsign
   * @param {Object} info - Node information
   * @returns {Buffer}
   */
  static createHello(source, info = {}) {
    const payload = Buffer.from(JSON.stringify({
      version: info.version || '1.0.0',
      services: info.services || [],
      timestamp: Date.now()
    }));

    return this.encode({
      type: PacketType.HELLO,
      source,
      destination: 'CQ',
      priority: Priority.HIGH,
      payload
    });
  }

  /**
   * Create a DATA packet
   * @param {String} source
   * @param {String} destination
   * @param {Buffer} data
   * @param {Object} options
   * @returns {Buffer}
   */
  static createData(source, destination, data, options = {}) {
    return this.encode({
      type: PacketType.DATA,
      source,
      destination,
      payload: data,
      priority: options.priority || Priority.NORMAL,
      flags: options.flags || PacketFlags.NONE,
      routingInfo: options.routingInfo || {},
      ttl: options.ttl
    });
  }

  /**
   * Create an ACK packet
   * @param {String} source
   * @param {String} destination
   * @param {String} messageId - Original message ID being acknowledged
   * @returns {Buffer}
   */
  static createAck(source, destination, messageId) {
    return this.encode({
      type: PacketType.ACK,
      source,
      destination,
      messageId,
      priority: Priority.HIGH,
      payload: Buffer.alloc(0)
    });
  }
}

module.exports = {
  PacketFormat,
  PacketType,
  PacketFlags,
  Priority
};
