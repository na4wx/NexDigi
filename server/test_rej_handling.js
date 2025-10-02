const BBSSessionManager = require('./lib/bbsSession');
const { parseAx25Frame, buildAx25Frame } = require('./lib/ax25');
const EventEmitter = require('events');

// Mock channel manager that captures outgoing frames
const mockChannelManager = new EventEmitter();
mockChannelManager.frames = [];
mockChannelManager.sendFrame = function(channel, buffer) {
  const parsed = parseAx25Frame(buffer);
  this.frames.push({ channel, buffer, parsed });
  console.log(`[MOCK] Sent frame: ${parsed.src} -> ${parsed.dest}, ctl=0x${parsed.control.toString(16)}`);
};

// Mock users storage
const mockUsers = new Map();

console.log('Testing REJ handling...');

const bbs = new BBSSessionManager('NA4WX-7', mockChannelManager, mockUsers);

// Simulate the sequence:
// 1. SABM from NA4WX
// 2. UA response (automatic)
// 3. I-frame banner (automatic)
// 4. I-frame name prompt (automatic)
// 5. REJ R1 from NA4WX (rejecting our sequence 0, expecting sequence 1)
// 6. Next I-frame should have sequence 1

// 1. Send SABM
console.log('\n1. Sending SABM...');
const sabmFrame = {
  channel: 'test',
  raw: Buffer.from([
    0x9C, 0x68, 0x38, 0xAA, 0xB4, 0x40, 0xE0, // Dest: NA4WX-7
    0x9C, 0x68, 0x38, 0xAA, 0xB4, 0x40, 0x61, // Src: NA4WX
    0x2F // Control: SABM with P bit
  ]).toString('hex')
};

bbs.onFrame(sabmFrame);

console.log(`\nFrames sent: ${mockChannelManager.frames.length}`);
// Should have sent: UA, I-frame banner, I-frame name prompt

// Check the sequence numbers of the I-frames sent
const iFrames = mockChannelManager.frames.filter(f => (f.parsed.control & 0x01) === 0);
console.log(`I-frames sent: ${iFrames.length}`);
iFrames.forEach((frame, i) => {
  const ns = (frame.parsed.control >> 1) & 0x07;
  const nr = (frame.parsed.control >> 5) & 0x07;
  console.log(`I-frame ${i}: N(S)=${ns}, N(R)=${nr}`);
});

// 5. Send REJ R1 (rejecting sequence 0, expecting sequence 1)
console.log('\n2. Sending REJ R1...');
const rejFrame = {
  channel: 'test',
  raw: Buffer.from([
    0x9C, 0x68, 0x38, 0xAA, 0xB4, 0x40, 0xE0, // Dest: NA4WX-7
    0x9C, 0x68, 0x38, 0xAA, 0xB4, 0x40, 0x61, // Src: NA4WX
    0x29 // Control: REJ with N(R)=1 (bits 7-5 = 001, bits 3-2 = 10 for REJ, bit 0 = 1 for S-frame)
  ]).toString('hex')
};

bbs.onFrame(rejFrame);

// 6. Now send some input to trigger another I-frame
console.log('\n3. Sending I-frame with data to trigger response...');
const inputFrame = {
  channel: 'test',
  raw: Buffer.from([
    0x9C, 0x68, 0x38, 0xAA, 0xB4, 0x40, 0xE0, // Dest: NA4WX-7
    0x9C, 0x68, 0x38, 0xAA, 0xB4, 0x40, 0x61, // Src: NA4WX
    0x22, // Control: I-frame N(S)=1, N(R)=1
    0xF0, // PID
    ...Buffer.from('TestUser\r') // Data
  ]).toString('hex')
};

bbs.onFrame(inputFrame);

// Check if the next I-frame uses sequence 1
const newIFrames = mockChannelManager.frames.filter(f => (f.parsed.control & 0x01) === 0);
console.log(`\nTotal I-frames sent: ${newIFrames.length}`);
newIFrames.forEach((frame, i) => {
  const ns = (frame.parsed.control >> 1) & 0x07;
  const nr = (frame.parsed.control >> 5) & 0x07;
  console.log(`I-frame ${i}: N(S)=${ns}, N(R)=${nr}`);
});

// The last I-frame should have N(S)=1 if our REJ handling worked
const lastIFrame = newIFrames[newIFrames.length - 1];
if (lastIFrame) {
  const lastNs = (lastIFrame.parsed.control >> 1) & 0x07;
  if (lastNs === 1) {
    console.log('\n✓ SUCCESS: REJ handling worked! Last I-frame uses N(S)=1');
  } else {
    console.log(`\n✗ FAILED: Last I-frame uses N(S)=${lastNs}, expected 1`);
  }
} else {
  console.log('\n? No I-frames found to check');
}