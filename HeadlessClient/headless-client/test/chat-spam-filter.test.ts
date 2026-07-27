import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_REPEAT_SPAM_OPTIONS,
  MIN_SPAM_PAYLOAD_LENGTH,
  RepeatSpamTracker,
  SERVER_MESSAGE_STARS,
  SPAM_SENDER_LIMIT,
  SPAM_WINDOW_MS,
  isFilterableChat,
  isServerMessage,
  isSpecialRecipientChat,
  normalizeChatPayload,
} from '../src/chat-spam-filter';

test('ProdMafia thresholds match TextHandler.as (5 min / 3 senders / min 20)', () => {
  assert.equal(SPAM_WINDOW_MS, 300_000);
  assert.equal(SPAM_SENDER_LIMIT, 3);
  assert.equal(MIN_SPAM_PAYLOAD_LENGTH, 20);
});

test('normalizeChatPayload folds homoglyphs and strips punctuation like getCustomMultiColors', () => {
  assert.equal(normalizeChatPayload('R.E.A.L.M  $H0P'), 'realmh0p');
  assert.equal(normalizeChatPayload('ŕŵţĝ'), 'rwtg');
  assert.equal(normalizeChatPayload('Hello, World!'), 'helloworld');
  assert.equal(normalizeChatPayload(''), '');
});

test('server, guild, party and tells-to-us are never filterable', () => {
  assert.equal(isServerMessage({ numStars: SERVER_MESSAGE_STARS }), true);
  assert.equal(isServerMessage({ numStars: -1 }), true);
  assert.equal(isSpecialRecipientChat('*Guild*'), true);
  assert.equal(isSpecialRecipientChat('*Party*'), true);
  assert.equal(isSpecialRecipientChat('#Thessal'), true);
  assert.equal(isSpecialRecipientChat('OtherPlayer'), false);

  const spam = {
    name: 'Bot1',
    text: 'buy realm gold cheap now at shop',
    recipient: '',
    numStars: 0,
  };
  assert.equal(isFilterableChat(spam, 'Me'), true);
  assert.equal(isFilterableChat({ ...spam, name: 'Me' }, 'Me'), false);
  assert.equal(isFilterableChat({ ...spam, recipient: '*Guild*' }, 'Me'), false);
  assert.equal(isFilterableChat({ ...spam, recipient: '*Party*' }, 'Me'), false);
  assert.equal(isFilterableChat({ ...spam, recipient: 'Me' }, 'Me'), false);
  assert.equal(isFilterableChat({ ...spam, numStars: SERVER_MESSAGE_STARS }, 'Me'), false);
});

test('isRepeatSpam drops on the third distinct sender inside the window', () => {
  const tracker = new RepeatSpamTracker();
  const payload = 'a'.repeat(MIN_SPAM_PAYLOAD_LENGTH);
  const t0 = 1_000_000;
  assert.equal(tracker.isRepeatSpam(payload, 'A', t0), false);
  assert.equal(tracker.isRepeatSpam(payload, 'B', t0 + 1), false);
  assert.equal(tracker.isRepeatSpam(payload, 'C', t0 + 2), true);
  // Same sender again after the limit still filters.
  assert.equal(tracker.isRepeatSpam(payload, 'A', t0 + 3), true);
});

test('short payloads and same-sender repeats never trip the filter', () => {
  const tracker = new RepeatSpamTracker();
  const short = 'gz'.repeat(5); // 10 chars
  assert.ok(short.length < MIN_SPAM_PAYLOAD_LENGTH);
  assert.equal(tracker.isRepeatSpam(short, 'A', 1), false);
  assert.equal(tracker.isRepeatSpam(short, 'B', 2), false);
  assert.equal(tracker.isRepeatSpam(short, 'C', 3), false);

  const long = 'buyrealmgoldcheapshopnow';
  assert.equal(tracker.isRepeatSpam(long, 'Solo', 10), false);
  assert.equal(tracker.isRepeatSpam(long, 'Solo', 11), false);
  assert.equal(tracker.isRepeatSpam(long, 'Solo', 12), false);
  assert.equal(tracker.size(), 1);
});

test('entries untouched for a full window are pruned', () => {
  const tracker = new RepeatSpamTracker();
  const payload = 'prune'.repeat(5);
  const t0 = 1_000_000;
  tracker.isRepeatSpam(payload, 'A', t0);
  tracker.isRepeatSpam(payload, 'B', t0 + 1);
  assert.equal(tracker.size(), 1);
  // More than a full window after last touch forces a prune that drops A/B.
  const later = t0 + 1 + SPAM_WINDOW_MS + 1;
  assert.equal(tracker.isRepeatSpam(payload, 'C', later), false);
  assert.equal(tracker.isRepeatSpam(payload, 'D', later + 1), false);
  assert.equal(tracker.isRepeatSpam(payload, 'E', later + 2), true);
});

test('memory caps bound distinct payloads and senders per entry', () => {
  const tracker = new RepeatSpamTracker({
    maxEntries: 4,
    maxSendersPerEntry: 4,
    maxKeyLength: 32,
  });
  const t0 = 50;
  for (let i = 0; i < 10; i++) {
    tracker.isRepeatSpam(`payload-${i}-xxxxxxxxxxxxxxxxxxxx`, `S${i}`, t0 + i);
  }
  assert.ok(tracker.size() <= 4);

  const shared = 'bounded-senders-xxxxxxxxxxxxxxxx';
  for (let i = 0; i < 20; i++) {
    tracker.isRepeatSpam(shared, `Sender${i}`, t0 + 100 + i);
  }
  // Still filters once senderLimit (3) is reached, even though senders are capped.
  assert.equal(tracker.isRepeatSpam(shared, 'Extra', t0 + 200), true);
  assert.equal(DEFAULT_REPEAT_SPAM_OPTIONS.maxEntries, 512);
});
