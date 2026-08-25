#!/usr/bin/env node
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

const BBS = require(path.join(__dirname, '..', 'server', 'lib', 'bbs.js'));

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`❌ FAIL: ${name}`);
    console.error(`   ${err.message}`);
    testsFailed++;
  }
}

function freshStoragePath() {
  return path.join(os.tmpdir(), `nexdigi-bbs-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

const tempFiles = [];
function newBBS() {
  const p = freshStoragePath();
  tempFiles.push(p);
  return new BBS(p);
}

process.on('exit', () => {
  for (const f of tempFiles) {
    try { fs.rmSync(f, { force: true }); } catch (e) { /* ignore */ }
  }
});

// --- addMessage ---

test('addMessage stores a message and assigns a messageNumber', () => {
  const bbs = newBBS();
  const msg = bbs.addMessage('N0CALL', 'W1AW', 'hello world', { subject: 'hi' });
  assert.strictEqual(msg.messageNumber, 1);
  assert.strictEqual(msg.sender, 'N0CALL');
  assert.strictEqual(msg.recipient, 'W1AW');
  assert.strictEqual(msg.content, 'hello world');
});

test('addMessage uppercases sender and recipient', () => {
  const bbs = newBBS();
  const msg = bbs.addMessage('n0call', 'w1aw', 'x');
  assert.strictEqual(msg.sender, 'N0CALL');
  assert.strictEqual(msg.recipient, 'W1AW');
});

test('addMessage assigns a stable globalId when none is provided', () => {
  const bbs = newBBS();
  const msg = bbs.addMessage('N0CALL', 'ALL', 'x');
  assert.ok(msg.globalId && msg.globalId.startsWith('N0CALL:'));
});

test('addMessage preserves a provided globalId (for synced messages)', () => {
  const bbs = newBBS();
  const msg = bbs.addMessage('N0CALL', 'ALL', 'x', { globalId: 'REMOTE-1:1000:1' });
  assert.strictEqual(msg.globalId, 'REMOTE-1:1000:1');
});

test('addMessage increments messageCounter across multiple messages', () => {
  const bbs = newBBS();
  bbs.addMessage('A', 'B', '1');
  const second = bbs.addMessage('A', 'B', '2');
  assert.strictEqual(second.messageNumber, 2);
});

test('addMessage defaults to category P (personal) with 30-day expiry', () => {
  const bbs = newBBS();
  const msg = bbs.addMessage('A', 'B', 'x');
  assert.strictEqual(msg.category, 'P');
  assert.ok(msg.expiresAt);
});

test('addMessage emits a "message-added" event', () => {
  const bbs = newBBS();
  let received = null;
  bbs.on('message-added', (m) => { received = m; });
  const msg = bbs.addMessage('A', 'B', 'x');
  assert.strictEqual(received.messageNumber, msg.messageNumber);
});

// --- getMessages / filtering ---

test('getMessages filters by recipient', () => {
  const bbs = newBBS();
  bbs.addMessage('A', 'W1AW', 'x');
  bbs.addMessage('A', 'N0CALL', 'y');
  const msgs = bbs.getMessages({ recipient: 'w1aw' });
  assert.strictEqual(msgs.length, 1);
  assert.strictEqual(msgs[0].recipient, 'W1AW');
});

test('getMessages filters by sender', () => {
  const bbs = newBBS();
  bbs.addMessage('AAA', 'ALL', 'x');
  bbs.addMessage('BBB', 'ALL', 'y');
  const msgs = bbs.getMessages({ sender: 'aaa' });
  assert.strictEqual(msgs.length, 1);
});

test('getMessages filters by category', () => {
  const bbs = newBBS();
  bbs.addMessage('A', 'ALL', 'x', { category: 'B' });
  bbs.addMessage('A', 'ALL', 'y', { category: 'P' });
  const bulletins = bbs.getMessages({ category: 'B' });
  assert.strictEqual(bulletins.length, 1);
  assert.strictEqual(bulletins[0].category, 'B');
});

test('getMessages returns newest messages first', () => {
  const bbs = newBBS();
  bbs.addMessage('A', 'ALL', 'first');
  bbs.addMessage('A', 'ALL', 'second');
  const msgs = bbs.getMessages({});
  assert.strictEqual(msgs[0].content, 'second');
});

test('getMessages unreadOnly excludes read messages', () => {
  const bbs = newBBS();
  const msg = bbs.addMessage('A', 'ALL', 'x');
  bbs.markAsRead(msg.messageNumber);
  const unread = bbs.getMessages({ unreadOnly: true });
  assert.strictEqual(unread.length, 0);
});

test('getMessages returns empty array when store is empty', () => {
  const bbs = newBBS();
  assert.deepStrictEqual(bbs.getMessages({}), []);
});

// --- markAsRead ---

test('markAsRead marks a message read and records the reader', () => {
  const bbs = newBBS();
  const msg = bbs.addMessage('A', 'B', 'x');
  const ok = bbs.markAsRead(msg.messageNumber, 'w1aw');
  assert.strictEqual(ok, true);
  const [reloaded] = bbs.getMessages({ messageNumber: msg.messageNumber });
  assert.strictEqual(reloaded.read, true);
  assert.ok(reloaded.readBy.includes('W1AW'));
});

test('markAsRead returns false for an unknown message', () => {
  const bbs = newBBS();
  assert.strictEqual(bbs.markAsRead(9999), false);
});

// --- deleteMessage / deleteMessageByGlobalId ---

test('deleteMessage removes an existing message and returns true', () => {
  const bbs = newBBS();
  const msg = bbs.addMessage('A', 'B', 'x');
  const ok = bbs.deleteMessage(msg.messageNumber);
  assert.strictEqual(ok, true);
  assert.strictEqual(bbs.getMessages({}).length, 0);
});

test('deleteMessage returns false for an unknown message', () => {
  const bbs = newBBS();
  assert.strictEqual(bbs.deleteMessage(9999), false);
});

test('deleteMessage emits "message-deleted" with the globalId', () => {
  const bbs = newBBS();
  const msg = bbs.addMessage('A', 'B', 'x');
  let deletedId = null;
  bbs.on('message-deleted', (id) => { deletedId = id; });
  bbs.deleteMessage(msg.messageNumber);
  assert.strictEqual(deletedId, msg.globalId);
});

test('getMessageByGlobalId / deleteMessageByGlobalId operate by globalId', () => {
  const bbs = newBBS();
  const msg = bbs.addMessage('A', 'B', 'x');
  assert.ok(bbs.getMessageByGlobalId(msg.globalId));
  const ok = bbs.deleteMessageByGlobalId(msg.globalId);
  assert.strictEqual(ok, true);
  assert.strictEqual(bbs.getMessageByGlobalId(msg.globalId), null);
});

// --- getBulletins / getPersonalMessages / getTrafficMessages ---

test('getBulletins returns only category B messages', () => {
  const bbs = newBBS();
  bbs.addMessage('A', 'ALL', 'x', { category: 'B' });
  bbs.addMessage('A', 'ALL', 'y', { category: 'T' });
  assert.strictEqual(bbs.getBulletins().length, 1);
});

test('getPersonalMessages returns only P messages for a recipient', () => {
  const bbs = newBBS();
  bbs.addMessage('A', 'W1AW', 'x', { category: 'P' });
  bbs.addMessage('A', 'W1AW', 'y', { category: 'T' });
  const personal = bbs.getPersonalMessages('W1AW');
  assert.strictEqual(personal.length, 1);
  assert.strictEqual(personal[0].category, 'P');
});

test('getTrafficMessages returns only category T messages', () => {
  const bbs = newBBS();
  bbs.addMessage('A', 'ALL', 'x', { category: 'T' });
  bbs.addMessage('A', 'ALL', 'y', { category: 'P' });
  assert.strictEqual(bbs.getTrafficMessages().length, 1);
});

// --- getStats ---

test('getStats tallies totals, category counts, and unread', () => {
  const bbs = newBBS();
  bbs.addMessage('A', 'ALL', 'x', { category: 'B' });
  const msg2 = bbs.addMessage('A', 'ALL', 'y', { category: 'P' });
  bbs.markAsRead(msg2.messageNumber);
  const stats = bbs.getStats();
  assert.strictEqual(stats.total, 2);
  assert.strictEqual(stats.bulletins, 1);
  assert.strictEqual(stats.personal, 1);
  assert.strictEqual(stats.unread, 1);
});

// --- persistence ---

test('messages persist across BBS instances backed by the same file', () => {
  const p = freshStoragePath();
  tempFiles.push(p);
  const bbs1 = new BBS(p);
  bbs1.addMessage('A', 'B', 'persisted');
  const bbs2 = new BBS(p);
  const msgs = bbs2.getMessages({});
  assert.strictEqual(msgs.length, 1);
  assert.strictEqual(msgs[0].content, 'persisted');
});

test('loading a legacy store without globalId backfills one', () => {
  const p = freshStoragePath();
  tempFiles.push(p);
  fs.writeFileSync(p, JSON.stringify({
    messageCounter: 2,
    messages: [{
      messageNumber: 1, sender: 'A', recipient: 'B', subject: '', content: 'legacy',
      category: 'P', priority: 'N', tags: [], replyTo: null,
      timestamp: new Date().toISOString(), expiresAt: null, read: false, readBy: [], size: 6
    }]
  }));
  const bbs = new BBS(p);
  const [msg] = bbs.getMessages({});
  assert.ok(msg.globalId, 'globalId should be backfilled on load');
});

console.log(`\nTests passed: ${testsPassed}`);
console.log(`Tests failed: ${testsFailed}`);
process.exit(testsFailed > 0 ? 1 : 0);
