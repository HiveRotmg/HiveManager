import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BossPhaseTracker,
  CLOTH_BAZAAR_MAP,
  SERVER_MESSAGE_STARS,
  autoResponderReply,
  bossPhaseForText,
  getSplinterReply,
  isServerDialogue,
} from '../src/boss-dialogue';

function server(name: string, text: string) {
  return { name, text, numStars: SERVER_MESSAGE_STARS };
}

test('server dialogue is recognised from both -1 and the unsigned 65535', () => {
  assert.equal(isServerDialogue({ numStars: SERVER_MESSAGE_STARS }), true);
  assert.equal(isServerDialogue({ numStars: -1 }), true);
  assert.equal(isServerDialogue({ numStars: 0 }), false);
  assert.equal(isServerDialogue({ numStars: 5 }), false);
});

test('Thessal is answered only on the exact question', () => {
  assert.equal(
    autoResponderReply(server('#Thessal the Mermaid Goddess', 'Is King Alexander alive?')),
    'He lives and reigns and conquers the world',
  );
  assert.equal(
    autoResponderReply(server('#Thessal the Mermaid Goddess', 'Is King Alexander alive')),
    undefined,
  );
  assert.equal(
    autoResponderReply(server('#Thessal the Mermaid Goddess', 'You will drown, mortal!')),
    undefined,
  );
});

test("Skuld is answered on the quoted 'READY' substring", () => {
  assert.equal(
    autoResponderReply(server('#Ghost of Skuld', "Are you prepared? Say 'READY' when you are.")),
    'ready',
  );
  // The match is case-sensitive and quoted, exactly as in TextHandler.
  assert.equal(autoResponderReply(server('#Ghost of Skuld', 'Say ready when you are')), undefined);
  assert.equal(autoResponderReply(server('#Ghost of Skuld', "Say 'ready'")), undefined);
});

test('Craig is answered on the "say SKIP and" substring', () => {
  assert.equal(
    autoResponderReply(server('#Craig, Intern of the Mad God', 'Type say SKIP and we can move on.')),
    'skip',
  );
  assert.equal(autoResponderReply(server('#Craig, Intern of the Mad God', 'say SKIP')), undefined);
  // The sender name must match in full.
  assert.equal(autoResponderReply(server('#Craig', 'say SKIP and')), undefined);
});

test('the Computer is answered on the Password: prompt', () => {
  assert.equal(autoResponderReply(server('#Computer', 'Password: ')), 'Dr Terrible');
  assert.equal(autoResponderReply(server('#Computer', 'ACCESS DENIED')), undefined);
});

test('Master Rat replies are computed from the riddle', () => {
  assert.equal(getSplinterReply('What time is it?'), "It's pizza time!");
  assert.equal(getSplinterReply('Where is the safest place in the world?'), 'Inside my shell.');
  assert.equal(getSplinterReply('What is fast, quiet and hidden by the night?'), 'A ninja of course!');
  assert.equal(getSplinterReply('How do you like your pizza?'), 'Extra cheese, hold the anchovies.');
  assert.equal(getSplinterReply('Who did this to me?'), 'Dr. Terrible, the mad scientist.');
  assert.equal(getSplinterReply('What is your favourite colour?'), '');

  assert.equal(autoResponderReply(server('#Master Rat', 'What time is it?')), "It's pizza time!");
  // An unknown question must produce no reply rather than an empty message.
  assert.equal(autoResponderReply(server('#Master Rat', 'Nice weather today.')), undefined);
});

test('player chat is never answered', () => {
  assert.equal(
    autoResponderReply({ name: '#Master Rat', text: 'What time is it?', numStars: 12 }),
    undefined,
  );
  assert.equal(
    autoResponderReply({
      name: '#Thessal the Mermaid Goddess',
      text: 'Is King Alexander alive?',
      numStars: 0,
    }),
    undefined,
  );
});

test('phase table maps the three ProdMafia trigger lines', () => {
  assert.deepEqual(bossPhaseForText('{"k":"s.oryx_closed_realm"}'), {
    name: 'Realm Closed',
    durationMs: 120_000,
  });
  assert.deepEqual(bossPhaseForText('{"k":"s.oryx_minions_failed"}'), {
    name: 'Oryx Shake',
    durationMs: 12_000,
  });
  assert.deepEqual(bossPhaseForText('DIE! DIE! DIE!!!'), { name: 'Vulnerable', durationMs: 23_000 });
  assert.equal(bossPhaseForText('DIE! DIE! DIE!'), undefined);
});

test('phase countdown runs, expires, and reports remaining time', () => {
  const tracker = new BossPhaseTracker();
  assert.equal(tracker.snapshot(1000).active, false);

  tracker.onServerText('DIE! DIE! DIE!!!', 1000);
  const running = tracker.snapshot(6000);
  assert.equal(running.active, true);
  assert.equal(running.phaseName, 'Vulnerable');
  assert.equal(running.phaseChangeAt, 24_000);
  assert.equal(running.remainingMs, 18_000);

  const expired = tracker.snapshot(24_001);
  assert.equal(expired.active, false);
  assert.equal(expired.remainingMs, 0);
});

test('map unload keeps the realm-close and shake phases but drops the rest', () => {
  const vulnerable = new BossPhaseTracker();
  vulnerable.onServerText('DIE! DIE! DIE!!!', 0);
  vulnerable.onMapUnload();
  assert.equal(vulnerable.snapshot(1000).active, false);

  const closed = new BossPhaseTracker();
  closed.onServerText('{"k":"s.oryx_closed_realm"}', 0);
  closed.onMapUnload();
  const snapshot = closed.snapshot(1000);
  assert.equal(snapshot.active, true);
  assert.equal(snapshot.phaseName, 'Realm Closed');
  assert.equal(snapshot.remainingMs, 119_000);
});

test('entering the Cloth Bazaar starts the 30s portal-entry countdown', () => {
  const tracker = new BossPhaseTracker();
  assert.equal(tracker.onMapEnter('Nexus', 0), undefined);
  assert.deepEqual(tracker.onMapEnter(CLOTH_BAZAAR_MAP, 0), { name: 'Portal Entry', durationMs: 30_000 });
  assert.equal(tracker.snapshot(10_000).remainingMs, 20_000);
});
