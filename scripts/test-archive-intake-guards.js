/**
 * Unit tests for archive→links intake guards (no Telegram required).
 * Run: node scripts/test-archive-intake-guards.js
 */
const assert = require('assert');
const { ChannelIntakeGuards } = require('../src/utils/channelIntakeGuards');

function testPendingPrivateCopySkipsOnce() {
  const g = new ChannelIntakeGuards(5_000);
  g.markPendingPrivateCopy(42);
  assert.strictEqual(g.shouldSkipPrivateIntake(42), true, 'first intake should skip');
  assert.strictEqual(g.shouldSkipPrivateIntake(42), false, 'second intake should not skip');
}

function testPendingPrivateCopyIgnoresUnknown() {
  const g = new ChannelIntakeGuards(5_000);
  assert.strictEqual(g.shouldSkipPrivateIntake(99), false);
}

function testPendingPrivateCopyExpires() {
  const g = new ChannelIntakeGuards(1);
  g.markPendingPrivateCopy(7);
  const start = Date.now();
  while (Date.now() - start < 5) {
    /* spin */
  }
  assert.strictEqual(g.shouldSkipPrivateIntake(7), false, 'expired pending should not skip');
}

function testBotCaptionEditSkipsOnce() {
  const g = new ChannelIntakeGuards(5_000);
  g.markBotCaptionEdit('-1001', 55);
  assert.strictEqual(g.shouldSkipBotCaptionEdit('-1001', 55), true);
  assert.strictEqual(g.shouldSkipBotCaptionEdit('-1001', 55), false);
}

function testBotCaptionEditDifferentMessageNotSkipped() {
  const g = new ChannelIntakeGuards(5_000);
  g.markBotCaptionEdit('-1001', 55);
  assert.strictEqual(g.shouldSkipBotCaptionEdit('-1001', 56), false);
}

function testInvalidIdsAreIgnored() {
  const g = new ChannelIntakeGuards(5_000);
  g.markPendingPrivateCopy('nope');
  assert.strictEqual(g.shouldSkipPrivateIntake('nope'), false);
}

function main() {
  testPendingPrivateCopySkipsOnce();
  testPendingPrivateCopyIgnoresUnknown();
  testPendingPrivateCopyExpires();
  testBotCaptionEditSkipsOnce();
  testBotCaptionEditDifferentMessageNotSkipped();
  testInvalidIdsAreIgnored();
  console.log('✅ channelIntakeGuards tests passed');
}

main();
