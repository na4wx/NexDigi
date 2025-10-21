# NexDigi API Reference

Complete REST API and WebSocket protocol documentation for NexDigi.

## Table of Contents

- [Authentication](#authentication)
- [REST API](#rest-api)
  - [System](#system)
  - [Channels](#channels)
  - [Frames](#frames)
  - [BBS](#bbs)
  - [Chat](#chat)
  - [NexNet](#nexnet)
  - [Digipeater](#digipeater)
  - [IGate](#igate)
  - [Hardware](#hardware)
- [WebSocket Protocol](#websocket-protocol)
- [Error Codes](#error-codes)
- [Rate Limiting](#rate-limiting)
- [Client Examples](#client-examples)

---

## Authentication

NexDigi uses password-based authentication for the web UI and API access.

### Headers

All API requests must include authentication:

```
X-UI-Password: your-password-here
```

Or using Bearer token:

```
Authorization: Bearer your-password-here
```

### Default Credentials

**Default Password:** `admin` (change immediately after first login)

### Change Password

```http
POST /api/system/password
Content-Type: application/json
X-UI-Password: current-password

{
  "currentPassword": "admin",
  "newPassword": "your-secure-password"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Password changed successfully"
}
```

### Disable Authentication (Development Only)

Set `"uiPassword": null` in `server/config.json` to disable authentication.

**Warning:** Never disable authentication in production environments.

---

## REST API

Base URL: `http://localhost:3000/api`

### System

#### Get System Status

```http
GET /api/system/status
```

**Response:**
```json
{
  "version": "1.0.0",
  "uptime": 3600,
  "channels": {
    "total": 3,
    "connected": 2,
    "errors": 1
  },
  "nexnet": {
    "enabled": true,
    "peers": 5,
    "routes": 12
  },
  "memory": {
    "heapUsed": 45678912,
    "heapTotal": 67108864,
    "rss": 89456123
  }
}
```

#### Get Configuration

```http
GET /api/system/config
```

**Response:**
```json
{
  "callsign": "N0CALL",
  "passcode": "12345",
  "channels": [...],
  "digipeater": {...},
  "igate": {...},
  "bbs": {...},
  "nexnet": {...}
}
```

#### Update Configuration

```http
PUT /api/system/config
Content-Type: application/json

{
  "callsign": "KB3ACZ",
  "passcode": "12345"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Configuration updated",
  "needsRestart": false
}
```

#### Restart Server

```http
POST /api/system/restart
```

**Response:**
```json
{
  "success": true,
  "message": "Server restarting in 3 seconds"
}
```

---

### Channels

#### List Channels

```http
GET /api/channels
```

**Response:**
```json
[
  {
    "id": "channel-1",
    "name": "VHF 144.39",
    "type": "serial",
    "port": "/dev/ttyUSB0",
    "baudRate": 9600,
    "enabled": true,
    "status": "connected",
    "stats": {
      "received": 1234,
      "transmitted": 567,
      "errors": 2
    }
  },
  {
    "id": "channel-2",
    "name": "Direwolf KISS",
    "type": "kiss-tcp",
    "host": "localhost",
    "port": 8001,
    "enabled": true,
    "status": "connected"
  }
]
```

#### Get Channel by ID

```http
GET /api/channels/:id
```

**Response:**
```json
{
  "id": "channel-1",
  "name": "VHF 144.39",
  "type": "serial",
  "port": "/dev/ttyUSB0",
  "baudRate": 9600,
  "enabled": true,
  "status": "connected",
  "stats": {
    "received": 1234,
    "transmitted": 567,
    "errors": 2,
    "lastReceived": "2024-01-15T12:34:56.789Z",
    "lastTransmitted": "2024-01-15T12:30:12.345Z"
  }
}
```

#### Create Channel

```http
POST /api/channels
Content-Type: application/json

{
  "name": "UHF 440.0",
  "type": "serial",
  "port": "/dev/ttyUSB1",
  "baudRate": 9600,
  "txDelay": 300,
  "persistence": 63,
  "slotTime": 100,
  "enabled": true
}
```

**Response:**
```json
{
  "id": "channel-3",
  "name": "UHF 440.0",
  "type": "serial",
  "port": "/dev/ttyUSB1",
  "baudRate": 9600,
  "txDelay": 300,
  "persistence": 63,
  "slotTime": 100,
  "enabled": true,
  "status": "connecting"
}
```

#### Update Channel

```http
PUT /api/channels/:id
Content-Type: application/json

{
  "name": "VHF APRS",
  "enabled": false
}
```

**Response:**
```json
{
  "id": "channel-1",
  "name": "VHF APRS",
  "enabled": false,
  "status": "disconnected"
}
```

#### Delete Channel

```http
DELETE /api/channels/:id
```

**Response:**
```json
{
  "success": true,
  "message": "Channel deleted"
}
```

#### Test Channel Connection

```http
POST /api/channels/:id/test
```

**Response:**
```json
{
  "success": true,
  "latency": 23,
  "message": "Connection successful"
}
```

---

### Frames

#### Get Recent Frames

```http
GET /api/frames?limit=100&channelId=channel-1&type=aprs
```

**Query Parameters:**
- `limit` (optional): Number of frames to return (default: 100, max: 1000)
- `channelId` (optional): Filter by channel ID
- `type` (optional): Filter by frame type (`aprs`, `ax25`, `digipeated`)
- `since` (optional): ISO timestamp for frames since this time

**Response:**
```json
[
  {
    "id": "frame-12345",
    "timestamp": "2024-01-15T12:34:56.789Z",
    "channelId": "channel-1",
    "channelName": "VHF 144.39",
    "source": "KB3ACZ-1",
    "destination": "APRS",
    "path": ["WIDE1-1", "WIDE2-1"],
    "type": "aprs",
    "payload": "!3845.12N/07623.45W>Hello World",
    "digipeated": false,
    "raw": "82a0a4..."
  }
]
```

#### Transmit Frame

```http
POST /api/frames/transmit
Content-Type: application/json

{
  "channelId": "channel-1",
  "destination": "APRS",
  "source": "KB3ACZ-1",
  "path": ["WIDE1-1", "WIDE2-1"],
  "payload": "!3845.12N/07623.45W>Test Beacon"
}
```

**Response:**
```json
{
  "success": true,
  "frameId": "frame-12346",
  "transmitted": "2024-01-15T12:35:00.123Z"
}
```

---

### BBS

#### List Messages

```http
GET /api/bbs/messages?type=bulletin&unreadOnly=false&limit=50
```

**Query Parameters:**
- `type` (optional): Filter by message type (`bulletin`, `personal`, `nts`)
- `unreadOnly` (optional): Only return unread messages
- `limit` (optional): Number of messages to return (default: 50)

**Response:**
```json
[
  {
    "id": "msg-1",
    "type": "bulletin",
    "from": "KB3ACZ",
    "to": "ALL",
    "subject": "Net Tonight",
    "body": "Weekly net tonight at 8pm local on 146.52",
    "timestamp": "2024-01-15T12:00:00.000Z",
    "read": false
  }
]
```

#### Get Message by ID

```http
GET /api/bbs/messages/:id
```

**Response:**
```json
{
  "id": "msg-1",
  "type": "bulletin",
  "from": "KB3ACZ",
  "to": "ALL",
  "subject": "Net Tonight",
  "body": "Weekly net tonight at 8pm local on 146.52",
  "timestamp": "2024-01-15T12:00:00.000Z",
  "read": true,
  "readTimestamp": "2024-01-15T12:34:56.789Z"
}
```

#### Post Message

```http
POST /api/bbs/messages
Content-Type: application/json

{
  "type": "bulletin",
  "to": "ALL",
  "subject": "Test Message",
  "body": "This is a test bulletin message"
}
```

**Response:**
```json
{
  "id": "msg-2",
  "type": "bulletin",
  "from": "KB3ACZ",
  "to": "ALL",
  "subject": "Test Message",
  "body": "This is a test bulletin message",
  "timestamp": "2024-01-15T12:35:00.000Z"
}
```

#### Delete Message

```http
DELETE /api/bbs/messages/:id
```

**Response:**
```json
{
  "success": true,
  "message": "Message deleted"
}
```

#### Mark Message as Read

```http
POST /api/bbs/messages/:id/read
```

**Response:**
```json
{
  "success": true,
  "id": "msg-1",
  "readTimestamp": "2024-01-15T12:34:56.789Z"
}
```

---

### Chat

#### List Chat Rooms

```http
GET /api/chat/rooms
```

**Response:**
```json
[
  {
    "id": "general",
    "name": "General",
    "description": "General discussion",
    "userCount": 5,
    "lastActivity": "2024-01-15T12:34:56.789Z"
  }
]
```

#### Get Chat Room Messages

```http
GET /api/chat/rooms/:roomId/messages?limit=100&since=2024-01-15T12:00:00.000Z
```

**Query Parameters:**
- `limit` (optional): Number of messages to return (default: 100)
- `since` (optional): ISO timestamp for messages since this time

**Response:**
```json
[
  {
    "id": "chat-msg-1",
    "roomId": "general",
    "serverId": "server-1",
    "username": "KB3ACZ",
    "message": "Hello everyone!",
    "timestamp": "2024-01-15T12:34:56.789Z"
  }
]
```

#### Send Chat Message (Use WebSocket instead)

```http
POST /api/chat/rooms/:roomId/messages
Content-Type: application/json

{
  "message": "Hello from REST API"
}
```

**Response:**
```json
{
  "id": "chat-msg-2",
  "roomId": "general",
  "serverId": "server-1",
  "username": "KB3ACZ",
  "message": "Hello from REST API",
  "timestamp": "2024-01-15T12:35:00.000Z"
}
```

**Note:** For real-time chat, use the WebSocket protocol instead (see below).

---

### NexNet

#### Get NexNet Status

```http
GET /api/nexnet/status
```

**Response:**
```json
{
  "enabled": true,
  "mode": "mesh",
  "publicKey": "ed25519:ABC123...",
  "peers": 5,
  "routes": 12,
  "stats": {
    "messagesRouted": 1234,
    "bytesTransferred": 567890,
    "queueDepth": 2
  }
}
```

#### List Peers

```http
GET /api/nexnet/peers
```

**Response:**
```json
[
  {
    "id": "peer-1",
    "callsign": "KB3ACZ-10",
    "address": "192.168.1.100:3001",
    "type": "internet",
    "status": "connected",
    "authenticated": true,
    "publicKey": "ed25519:DEF456...",
    "latency": 23,
    "lastSeen": "2024-01-15T12:34:56.789Z",
    "stats": {
      "messagesReceived": 500,
      "messagesSent": 450,
      "bytesReceived": 123456,
      "bytesSent": 112345
    }
  }
]
```

#### Add Peer

```http
POST /api/nexnet/peers
Content-Type: application/json

{
  "callsign": "W3XYZ-10",
  "address": "192.168.1.200:3001",
  "type": "internet",
  "publicKey": "ed25519:GHI789..."
}
```

**Response:**
```json
{
  "id": "peer-2",
  "callsign": "W3XYZ-10",
  "address": "192.168.1.200:3001",
  "type": "internet",
  "status": "connecting",
  "publicKey": "ed25519:GHI789..."
}
```

#### Remove Peer

```http
DELETE /api/nexnet/peers/:id
```

**Response:**
```json
{
  "success": true,
  "message": "Peer removed"
}
```

#### Get Routing Table

```http
GET /api/nexnet/routes
```

**Response:**
```json
[
  {
    "destination": "KB3ACZ-10",
    "nextHop": "W3XYZ-10",
    "metric": 2,
    "path": ["W3XYZ-10", "KB3ACZ-10"]
  }
]
```

#### Send NexNet Message

```http
POST /api/nexnet/send
Content-Type: application/json

{
  "destination": "KB3ACZ-10",
  "type": "chat",
  "priority": "normal",
  "payload": {
    "message": "Hello via NexNet"
  }
}
```

**Response:**
```json
{
  "success": true,
  "messageId": "nexnet-msg-1",
  "routedVia": ["W3XYZ-10", "KB3ACZ-10"]
}
```

---

### Digipeater

#### Get Digipeater Settings

```http
GET /api/digipeater/settings
```

**Response:**
```json
{
  "enabled": true,
  "maxHops": 7,
  "wideSettings": {
    "enabled": true,
    "fillIn": true,
    "maxN": 2
  },
  "rateLimit": {
    "enabled": true,
    "maxPerMinute": 60
  },
  "perChannelOverrides": {
    "channel-1": {
      "fillIn": false
    }
  }
}
```

#### Update Digipeater Settings

```http
PUT /api/digipeater/settings
Content-Type: application/json

{
  "enabled": true,
  "maxHops": 7,
  "wideSettings": {
    "enabled": true,
    "fillIn": true,
    "maxN": 2
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Digipeater settings updated"
}
```

#### Get Digipeater Statistics

```http
GET /api/digipeater/stats
```

**Response:**
```json
{
  "totalDigipeated": 1234,
  "dropped": {
    "maxHops": 45,
    "rateLimit": 12,
    "duplicate": 89
  },
  "byChannel": {
    "channel-1": {
      "digipeated": 567,
      "dropped": 23
    }
  }
}
```

---

### IGate

#### Get IGate Settings

```http
GET /api/igate/settings
```

**Response:**
```json
{
  "enabled": true,
  "server": "rotate.aprs2.net",
  "port": 14580,
  "filter": "r/38.45/-76.23/50",
  "txEnabled": false,
  "beacon": {
    "enabled": true,
    "interval": 600,
    "comment": "NexDigi IGate"
  }
}
```

#### Update IGate Settings

```http
PUT /api/igate/settings
Content-Type: application/json

{
  "enabled": true,
  "server": "rotate.aprs2.net",
  "port": 14580,
  "filter": "r/38.45/-76.23/100"
}
```

**Response:**
```json
{
  "success": true,
  "message": "IGate settings updated",
  "needsReconnect": true
}
```

#### Get IGate Statistics

```http
GET /api/igate/stats
```

**Response:**
```json
{
  "connected": true,
  "uptime": 3600,
  "rfToIs": 234,
  "isToRf": 0,
  "gated": 234,
  "filtered": 45,
  "duplicate": 12
}
```

---

### Hardware

#### List Serial Ports

```http
GET /api/hardware/serial-ports
```

**Response:**
```json
[
  {
    "path": "/dev/ttyUSB0",
    "manufacturer": "Prolific",
    "serialNumber": "12345",
    "pnpId": "usb-Prolific_USB-Serial_Controller",
    "vendorId": "067b",
    "productId": "2303"
  },
  {
    "path": "/dev/ttyUSB1",
    "manufacturer": "FTDI",
    "serialNumber": "A1B2C3D4"
  }
]
```

#### Test Serial Port

```http
POST /api/hardware/serial-ports/test
Content-Type: application/json

{
  "port": "/dev/ttyUSB0",
  "baudRate": 9600
}
```

**Response:**
```json
{
  "success": true,
  "message": "Port opened successfully",
  "readable": true,
  "writable": true
}
```

---

## WebSocket Protocol

Connect to: `ws://localhost:3000` or `wss://your-domain.com`

### Authentication

Send authentication immediately after connecting:

```json
{
  "type": "auth",
  "password": "your-password-here"
}
```

**Success Response:**
```json
{
  "type": "auth",
  "success": true,
  "message": "Authenticated"
}
```

**Failure Response:**
```json
{
  "type": "auth",
  "success": false,
  "message": "Invalid password"
}
```

### Subscribe to Events

```json
{
  "type": "subscribe",
  "events": ["frames", "chat", "nexnet", "channels"]
}
```

**Response:**
```json
{
  "type": "subscribe",
  "success": true,
  "subscriptions": ["frames", "chat", "nexnet", "channels"]
}
```

### Event Types

#### Frame Received

```json
{
  "type": "frame",
  "event": "received",
  "data": {
    "id": "frame-12345",
    "timestamp": "2024-01-15T12:34:56.789Z",
    "channelId": "channel-1",
    "source": "KB3ACZ-1",
    "destination": "APRS",
    "payload": "!3845.12N/07623.45W>Hello"
  }
}
```

#### Chat Message

```json
{
  "type": "chat",
  "event": "message",
  "data": {
    "id": "chat-msg-1",
    "roomId": "general",
    "serverId": "server-1",
    "username": "KB3ACZ",
    "message": "Hello!",
    "timestamp": "2024-01-15T12:34:56.789Z"
  }
}
```

#### Send Chat Message

```json
{
  "type": "chat",
  "action": "send",
  "roomId": "general",
  "message": "Hello from WebSocket!"
}
```

#### Channel Status Change

```json
{
  "type": "channel",
  "event": "status",
  "data": {
    "id": "channel-1",
    "status": "connected",
    "message": "Connection established"
  }
}
```

#### NexNet Peer Event

```json
{
  "type": "nexnet",
  "event": "peer_connected",
  "data": {
    "id": "peer-1",
    "callsign": "KB3ACZ-10",
    "authenticated": true
  }
}
```

#### NexNet Message Routed

```json
{
  "type": "nexnet",
  "event": "message_routed",
  "data": {
    "messageId": "nexnet-msg-1",
    "from": "W3XYZ-10",
    "to": "KB3ACZ-10",
    "hops": 2,
    "path": ["W3XYZ-10", "N3ABC-10", "KB3ACZ-10"]
  }
}
```

### Heartbeat

Server sends heartbeat every 30 seconds:

```json
{
  "type": "heartbeat",
  "timestamp": "2024-01-15T12:34:56.789Z"
}
```

Client should respond with:

```json
{
  "type": "pong"
}
```

---

## Error Codes

### HTTP Status Codes

- `200 OK` - Request successful
- `201 Created` - Resource created successfully
- `400 Bad Request` - Invalid request parameters
- `401 Unauthorized` - Missing or invalid authentication
- `403 Forbidden` - Authenticated but not authorized for this action
- `404 Not Found` - Resource not found
- `409 Conflict` - Resource already exists or conflict with current state
- `422 Unprocessable Entity` - Validation error
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error
- `503 Service Unavailable` - Service temporarily unavailable

### Error Response Format

```json
{
  "error": true,
  "code": "INVALID_CHANNEL",
  "message": "Channel with ID 'channel-99' not found",
  "details": {
    "field": "channelId",
    "value": "channel-99"
  }
}
```

### Common Error Codes

- `AUTH_REQUIRED` - Authentication required
- `INVALID_PASSWORD` - Invalid password
- `INVALID_CHANNEL` - Channel not found or invalid
- `CHANNEL_EXISTS` - Channel with this ID already exists
- `INVALID_PORT` - Serial port not found or invalid
- `PORT_IN_USE` - Serial port already in use
- `VALIDATION_ERROR` - Request validation failed
- `RATE_LIMIT_EXCEEDED` - Too many requests
- `NEXNET_DISABLED` - NexNet is not enabled
- `PEER_NOT_FOUND` - NexNet peer not found
- `ROUTE_NOT_FOUND` - No route to destination
- `MESSAGE_TOO_LARGE` - Message exceeds size limit

---

## Rate Limiting

API endpoints are rate-limited to prevent abuse.

### Limits

- **Authentication:** 5 attempts per 5 minutes per IP
- **Frame transmission:** 60 frames per minute per channel
- **Chat messages:** 20 messages per minute per user
- **NexNet messages:** 100 messages per minute
- **Configuration changes:** 10 changes per minute
- **General API:** 300 requests per minute per IP

### Rate Limit Headers

```
X-RateLimit-Limit: 300
X-RateLimit-Remaining: 295
X-RateLimit-Reset: 1705329600
```

### Rate Limit Exceeded Response

```json
{
  "error": true,
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Rate limit exceeded. Please try again in 45 seconds.",
  "retryAfter": 45
}
```

---

## Client Examples

### JavaScript (Fetch API)

```javascript
const API_BASE = 'http://localhost:3000/api';
const PASSWORD = 'your-password';

// Get channels
async function getChannels() {
  const response = await fetch(`${API_BASE}/channels`, {
    headers: {
      'X-UI-Password': PASSWORD
    }
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  return await response.json();
}

// Create channel
async function createChannel(config) {
  const response = await fetch(`${API_BASE}/channels`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-UI-Password': PASSWORD
    },
    body: JSON.stringify(config)
  });
  
  return await response.json();
}

// Transmit frame
async function transmitFrame(channelId, destination, payload) {
  const response = await fetch(`${API_BASE}/frames/transmit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-UI-Password': PASSWORD
    },
    body: JSON.stringify({
      channelId,
      destination,
      source: 'KB3ACZ-1',
      path: ['WIDE1-1', 'WIDE2-1'],
      payload
    })
  });
  
  return await response.json();
}
```

### JavaScript (WebSocket)

```javascript
const ws = new WebSocket('ws://localhost:3000');

ws.onopen = () => {
  // Authenticate
  ws.send(JSON.stringify({
    type: 'auth',
    password: 'your-password'
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  switch (msg.type) {
    case 'auth':
      if (msg.success) {
        // Subscribe to events
        ws.send(JSON.stringify({
          type: 'subscribe',
          events: ['frames', 'chat']
        }));
      }
      break;
      
    case 'frame':
      console.log('Frame received:', msg.data);
      break;
      
    case 'chat':
      console.log('Chat message:', msg.data);
      break;
      
    case 'heartbeat':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;
  }
};

// Send chat message
function sendChatMessage(roomId, message) {
  ws.send(JSON.stringify({
    type: 'chat',
    action: 'send',
    roomId,
    message
  }));
}
```

### Python (requests)

```python
import requests

API_BASE = 'http://localhost:3000/api'
PASSWORD = 'your-password'

headers = {
    'X-UI-Password': PASSWORD
}

# Get channels
response = requests.get(f'{API_BASE}/channels', headers=headers)
channels = response.json()

# Create channel
new_channel = {
    'name': 'VHF APRS',
    'type': 'serial',
    'port': '/dev/ttyUSB0',
    'baudRate': 9600,
    'enabled': True
}

response = requests.post(
    f'{API_BASE}/channels',
    json=new_channel,
    headers=headers
)
channel = response.json()

# Transmit frame
frame = {
    'channelId': channel['id'],
    'destination': 'APRS',
    'source': 'KB3ACZ-1',
    'path': ['WIDE1-1', 'WIDE2-1'],
    'payload': '!3845.12N/07623.45W>Test Beacon'
}

response = requests.post(
    f'{API_BASE}/frames/transmit',
    json=frame,
    headers=headers
)
result = response.json()
```

### curl

```bash
# Get system status
curl -H "X-UI-Password: your-password" \
  http://localhost:3000/api/system/status

# List channels
curl -H "X-UI-Password: your-password" \
  http://localhost:3000/api/channels

# Create channel
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-UI-Password: your-password" \
  -d '{
    "name": "VHF APRS",
    "type": "serial",
    "port": "/dev/ttyUSB0",
    "baudRate": 9600,
    "enabled": true
  }' \
  http://localhost:3000/api/channels

# Transmit frame
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-UI-Password: your-password" \
  -d '{
    "channelId": "channel-1",
    "destination": "APRS",
    "source": "KB3ACZ-1",
    "path": ["WIDE1-1", "WIDE2-1"],
    "payload": "!3845.12N/07623.45W>Test"
  }' \
  http://localhost:3000/api/frames/transmit

# Get NexNet peers
curl -H "X-UI-Password: your-password" \
  http://localhost:3000/api/nexnet/peers

# Post BBS message
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-UI-Password: your-password" \
  -d '{
    "type": "bulletin",
    "to": "ALL",
    "subject": "Test",
    "body": "This is a test message"
  }' \
  http://localhost:3000/api/bbs/messages
```

---

## Additional Resources

- [Installation Guide](INSTALL.md)
- [Configuration Reference](CONFIGURATION.md)
- [NexNet Mesh Networking](NEXNET.md)
- [Troubleshooting](TROUBLESHOOTING.md)

---

**Last Updated:** January 2024  
**API Version:** 1.0.0
