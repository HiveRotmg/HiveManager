import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FollowController,
  anchorTeleportCommand,
  selectClosestPlayerTeleport,
  selectQuestTeleportTarget,
  type FollowPlayer,
  type FollowSnapshot,
} from '../src/follow-controller';
import type { PortalCandidate } from '../src/portal-automation';

const SELF = 100;

function player(overrides: Partial<FollowPlayer> & { objectId: number }): FollowPlayer {
  return { name: 'Someone', x: 0, y: 0, ...overrides };
}

function snapshot(overrides: Partial<FollowSnapshot> = {}): FollowSnapshot {
  return {
    time: 100_000,
    position: { x: 0, y: 0 },
    selfObjectId: SELF,
    players: [],
    teleportAllowed: true,
    ...overrides,
  };
}

test('anchor teleport sends the /teleport chat command, and nothing without an anchor', () => {
  assert.equal(anchorTeleportCommand('Deca'), '/teleport Deca');
  assert.equal(anchorTeleportCommand('  '), undefined);
  assert.equal(anchorTeleportCommand(''), undefined);
});

test('quest teleport picks the visible player closest to the quest', () => {
  const players = [
    player({ objectId: SELF, name: 'Me', x: 0, y: 0 }),
    player({ objectId: 2, name: 'Far', x: 30, y: 30 }),
    player({ objectId: 3, name: 'Near', x: 48, y: 50 }),
  ];
  const selection = selectQuestTeleportTarget({
    questObjectId: 900,
    questPosition: { x: 50, y: 50 },
    players,
    selfObjectId: SELF,
  });
  assert.deepEqual(selection, { kind: 'teleport', objectId: 3, name: 'Near' });
});

test('quest teleport reports the states that send no packet', () => {
  assert.deepEqual(
    selectQuestTeleportTarget({ questObjectId: 0, players: [], selfObjectId: SELF }),
    { kind: 'no_quest' },
  );
  assert.deepEqual(
    selectQuestTeleportTarget({ questObjectId: 900, players: [], selfObjectId: SELF }),
    { kind: 'quest_not_visible' },
  );
  assert.deepEqual(
    selectQuestTeleportTarget({
      questObjectId: 900,
      questPosition: { x: 1, y: 1 },
      players: [player({ objectId: SELF, x: 0, y: 0 })],
      selfObjectId: SELF,
    }),
    { kind: 'self_closest' },
  );
});

test('invisible players are never teleport destinations', () => {
  const selection = selectClosestPlayerTeleport(
    { x: 10, y: 10 },
    [
      player({ objectId: SELF, x: 0, y: 0 }),
      player({ objectId: 2, name: 'Rogue', x: 10, y: 10, invisible: true }),
      player({ objectId: 3, name: 'Priest', x: 4, y: 4 }),
    ],
    SELF,
  );
  assert.deepEqual(selection, { kind: 'teleport', objectId: 3, name: 'Priest' });
});

test('following walks to the target, stops on arrival, and searches when it is gone', () => {
  const controller = new FollowController();
  assert.equal(controller.follow('Beefcake'), true);
  assert.equal(controller.getFollowName(), 'BEEFCAKE');

  const target = player({ objectId: 5, name: 'BeefCake', x: 4, y: 0 });
  const following = controller.tick(snapshot({ players: [target], teleportAllowed: false }));
  assert.equal(following.state, 'following');
  assert.deepEqual(following.target, { x: 4, y: 0 });

  const close = controller.tick(snapshot({
    players: [player({ objectId: 5, name: 'BeefCake', x: 1, y: 0 })],
    teleportAllowed: false,
  }));
  assert.equal(close.state, 'arrived');
  assert.equal(close.target, null);

  const missing = controller.tick(snapshot({ players: [] }));
  assert.equal(missing.state, 'searching');
});

test('following teleports once when the target is far, then respects the cooldown', () => {
  const controller = new FollowController();
  controller.follow('Beefcake');
  const players = [
    player({ objectId: SELF, name: 'Me', x: 0, y: 0 }),
    player({ objectId: 5, name: 'BeefCake', x: 40, y: 0 }),
  ];

  const teleporting = controller.tick(snapshot({ time: 100_000, players }));
  assert.equal(teleporting.state, 'teleporting');
  assert.equal(teleporting.teleportObjectId, 5);

  const cooling = controller.tick(snapshot({ time: 102_000, players }));
  assert.equal(cooling.state, 'following');
  assert.equal(cooling.teleportObjectId, null);

  const again = controller.tick(snapshot({ time: 107_000, players }));
  assert.equal(again.teleportObjectId, 5);
});

test('following never teleports where the map forbids it', () => {
  const controller = new FollowController();
  controller.follow('Beefcake');
  const decision = controller.tick(snapshot({
    teleportAllowed: false,
    players: [player({ objectId: 5, name: 'BeefCake', x: 40, y: 0 })],
  }));
  assert.equal(decision.state, 'following');
  assert.equal(decision.teleportObjectId, null);
});

test('an empty follow name stops following', () => {
  const controller = new FollowController();
  controller.follow('Beefcake');
  assert.equal(controller.follow('   '), false);
  assert.equal(controller.isFollowing(), false);
  assert.equal(controller.tick(snapshot()).state, 'idle');
});

test('follow into portals takes the portal the followed player vanished on', () => {
  const controller = new FollowController();
  controller.configure({ followIntoPortals: true });
  controller.follow('Beefcake');
  const portals: PortalCandidate[] = [
    { objectId: 70, type: 0x0712, x: 40.5, y: 20.5, name: 'Ocean Trench Portal' },
    { objectId: 71, type: 0x0712, x: 60, y: 60, name: 'Snake Pit Portal' },
  ];
  const removed = player({ objectId: 5, name: 'BeefCake', x: 40.6, y: 20.4 });
  assert.equal(controller.portalToFollow(removed, portals)?.objectId, 70);

  // Someone else leaving, or a portal too far away, is not followed.
  assert.equal(controller.portalToFollow(player({ objectId: 6, name: 'Other', x: 40.5, y: 20.5 }), portals), undefined);
  assert.equal(controller.portalToFollow(player({ objectId: 5, name: 'BeefCake', x: 5, y: 5 }), portals), undefined);
});

test('follow into portals does nothing while the option is off', () => {
  const controller = new FollowController();
  controller.follow('Beefcake');
  const portals: PortalCandidate[] = [{ objectId: 70, type: 0x0712, x: 0, y: 0, name: 'Ocean Trench Portal' }];
  assert.equal(controller.portalToFollow(player({ objectId: 5, name: 'BeefCake', x: 0, y: 0 }), portals), undefined);
});
