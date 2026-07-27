import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PortalType } from 'realmlib';
import {
  PortalAutoEnterController,
  isAutoEnterCandidate,
  isDungeonWhitelisted,
  isHubPortal,
  looksLikePortal,
  normalizeDungeonName,
  parseDungeonWhitelist,
  type PortalCandidate,
} from '../src/portal-automation';

/** A dungeon portal object type, i.e. not one of the `PortalType` hub portals. */
const DUNGEON_PORTAL_TYPE = 0x0d7b;

function portal(overrides: Partial<PortalCandidate> = {}): PortalCandidate {
  return { objectId: 1, type: DUNGEON_PORTAL_TYPE, x: 10, y: 10, name: 'Ocean Trench Portal', ...overrides };
}

test('dungeon names normalize past punctuation, portal suffixes and realm counts', () => {
  assert.equal(normalizeDungeonName('Ocean Trench Portal'), 'ocean trench');
  assert.equal(normalizeDungeonName("Oryx's Castle Portal"), 'oryx s castle');
  assert.equal(normalizeDungeonName('Ocean Trench (12/85)'), 'ocean trench');
  assert.equal(normalizeDungeonName('s.nexus_portal'), 's nexus');
  assert.equal(normalizeDungeonName(undefined), '');
});

test('an empty whitelist admits every dungeon', () => {
  assert.equal(isDungeonWhitelisted('Ocean Trench Portal', []), true);
  assert.equal(isDungeonWhitelisted(undefined, []), true);
});

test('a whitelist admits listed dungeons only', () => {
  const list = parseDungeonWhitelist('Ocean Trench, the shatters');
  assert.deepEqual(list, ['Ocean Trench', 'the shatters']);
  assert.equal(isDungeonWhitelisted('Ocean Trench Portal', list), true);
  assert.equal(isDungeonWhitelisted('Portal to The Shatters', list), true);
  assert.equal(isDungeonWhitelisted('Snake Pit Portal', list), false);
  // An unnamed portal cannot be matched against a non-empty whitelist.
  assert.equal(isDungeonWhitelisted(undefined, list), false);
});

test('hub portals are identified by type and by name', () => {
  assert.equal(isHubPortal(portal({ type: PortalType.Vault, name: 'Vault' })), true);
  assert.equal(isHubPortal(portal({ type: PortalType.RealmPortal, name: 'Horizon (5/85)' })), true);
  assert.equal(isHubPortal(portal({ name: 'Nexus Portal' })), true);
  assert.equal(isHubPortal(portal({ name: 'Ocean Trench Portal' })), false);
});

test('portal detection accepts the XML Portal class and portal names', () => {
  assert.equal(looksLikePortal(PortalType.Vault), true);
  assert.equal(looksLikePortal(0x1234, undefined, 'Portal'), true);
  assert.equal(looksLikePortal(0x1234, 'Snake Pit Portal'), true);
  assert.equal(looksLikePortal(0x1234, 'Sprite God', 'Character'), false);
});

test('auto-enter candidates exclude hub portals and non-whitelisted dungeons', () => {
  const options = { dungeonWhitelist: ['Ocean Trench'], ignoreHubPortals: true };
  assert.equal(isAutoEnterCandidate(portal(), options), true);
  assert.equal(isAutoEnterCandidate(portal({ name: 'Snake Pit Portal' }), options), false);
  assert.equal(isAutoEnterCandidate(portal({ name: 'Nexus Portal' }), options), false);
});

test('a portal outside the trigger radius is ignored', () => {
  const controller = new PortalAutoEnterController();
  controller.configure({ enabled: true });
  assert.equal(controller.notice(portal({ x: 20, y: 10 }), { x: 10, y: 10 }), false);
  assert.equal(controller.notice(portal({ x: 13, y: 10 }), { x: 10, y: 10 }), true);
});

test('nothing is noticed while auto-enter is off', () => {
  const controller = new PortalAutoEnterController();
  assert.equal(controller.notice(portal({ x: 10.5, y: 10 }), { x: 10, y: 10 }), false);
});

test('a noticed portal is walked to, then entered once, then retried on cooldown', () => {
  const controller = new PortalAutoEnterController();
  controller.configure({ enabled: true });
  const target = portal({ x: 12, y: 10 });
  assert.equal(controller.notice(target, { x: 10, y: 10 }), true);

  const walking = controller.tick({ time: 1000, position: { x: 10, y: 10 }, portals: [target] });
  assert.equal(walking.state, 'walking');
  assert.deepEqual(walking.target, { x: 12, y: 10 });
  assert.equal(walking.usePortalObjectId, null);

  const entering = controller.tick({ time: 1100, position: { x: 12, y: 10 }, portals: [target] });
  assert.equal(entering.state, 'entering');
  assert.equal(entering.usePortalObjectId, 1);

  // Inside the 1500ms cooldown no second USE_PORTAL is sent.
  const holding = controller.tick({ time: 1600, position: { x: 12, y: 10 }, portals: [target] });
  assert.equal(holding.usePortalObjectId, null);

  const retry = controller.tick({ time: 2700, position: { x: 12, y: 10 }, portals: [target] });
  assert.equal(retry.usePortalObjectId, 1);
});

test('a portal that never transitions is abandoned and not re-selected', () => {
  const controller = new PortalAutoEnterController();
  controller.configure({ enabled: true, usePortalMaxAttempts: 2, usePortalCooldownMs: 0 });
  const target = portal({ x: 10, y: 10 });
  assert.equal(controller.notice(target, { x: 10, y: 10 }), true);

  for (let attempt = 0; attempt < 2; attempt++) {
    const decision = controller.tick({ time: attempt, position: { x: 10, y: 10 }, portals: [target] });
    assert.equal(decision.usePortalObjectId, 1);
  }
  const abandoned = controller.tick({ time: 3, position: { x: 10, y: 10 }, portals: [target] });
  assert.equal(abandoned.state, 'abandoned');
  assert.equal(controller.notice(target, { x: 10, y: 10 }), false);
  assert.deepEqual(controller.status().abandoned, [1]);
});

test('the approach is dropped when the portal disappears, and reset clears the blacklist', () => {
  const controller = new PortalAutoEnterController();
  controller.configure({ enabled: true, usePortalMaxAttempts: 1, usePortalCooldownMs: 0 });
  const target = portal({ x: 10, y: 10 });
  controller.notice(target, { x: 10, y: 10 });
  controller.tick({ time: 0, position: { x: 10, y: 10 }, portals: [target] });
  controller.tick({ time: 1, position: { x: 10, y: 10 }, portals: [target] });
  assert.deepEqual(controller.status().abandoned, [1]);

  controller.reset();
  assert.deepEqual(controller.status().abandoned, []);
  assert.equal(controller.status().pendingObjectId, null);

  controller.notice(target, { x: 10, y: 10 });
  const gone = controller.tick({ time: 2, position: { x: 10, y: 10 }, portals: [] });
  assert.equal(gone.state, 'idle');
  assert.equal(controller.status().pendingObjectId, null);
});
