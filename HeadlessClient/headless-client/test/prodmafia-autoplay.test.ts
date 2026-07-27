import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CombatObjectDefinition } from '../src/combat-tracker';
import {
  ProdMafiaAutoPlayController,
  type ProdMafiaAutoPlayObject,
  type ProdMafiaAutoPlaySnapshot,
} from '../src/prodmafia-autoplay';

test('ProdMafia Auto Play waits for realm discovery then chooses the busiest portal', () => {
  const controller = enabled();
  const portals = [
    object(10, 0x0712, 8, 0, 'Horizon (12/85)', portalDefinition()),
    object(11, 0x0712, 14, 0, 'Meridian (47/85)', portalDefinition()),
  ];
  assert.equal(controller.tick(snapshot(100, 'Nexus', portals, { safeMap: true })).state,
    'hub_explore_north');
  const selected = controller.tick(snapshot(1600, 'Nexus', portals, { safeMap: true }));
  assert.equal(selected.state, 'hub_portal');
  assert.equal(selected.targetObjectId, 11);
});

test('ProdMafia Auto Play prioritizes quest, then blue-or-better soulbound loot', () => {
  const controller = enabled();
  const quest = object(20, 100, 20, 0, 'Quest Boss', enemyDefinition());
  const enemy = object(21, 101, 15, 0, 'Enemy', enemyDefinition());
  let decision = controller.tick(snapshot(100, 'Snake Pit', [quest, enemy], {
    questObjectId: quest.objectId,
  }));
  assert.equal(decision.state, 'quest_path');
  assert.equal(decision.targetObjectId, quest.objectId);

  const bag = {
    ...object(22, 0x0508, 5, 0, 'Loot Bag', {
      ...neutralDefinition(),
      id: 'Loot Bag 3',
      isContainer: true,
      isLoot: true,
    }),
    equipment: [9001, -1],
  };
  decision = controller.tick(snapshot(400, 'Snake Pit', [quest, enemy, bag], {
    questObjectId: quest.objectId,
  }));
  assert.equal(decision.state, 'soulbound_bag');
  assert.equal(decision.targetObjectId, bag.objectId);
});

test('ProdMafia Auto Play uses the fixed mirrored Castle route before a guardian', () => {
  const controller = enabled();
  const guardian = object(
    30,
    0x0d78,
    128.5,
    60.5,
    'Stone Guardian',
    enemyDefinition(),
  );
  const decision = controller.tick(snapshot(100, "Oryx's Castle", [guardian], {
    position: { x: 50, y: 220 },
    questObjectId: guardian.objectId,
  }));
  assert.equal(decision.state, 'quest_path');
  assert.deepEqual(decision.target, { x: 79.5, y: 170.5 });
  assert.equal(decision.arriveThreshold, 1.5);
  assert.equal(decision.allowWallEscape, false);
});

test('ProdMafia Auto Play holds position while the selected realm queue is active', () => {
  const controller = enabled();
  const decision = controller.tick(snapshot(100, 'Nexus', [], {
    safeMap: true,
    inRealmQueue: true,
  }));
  assert.equal(decision.state, 'realm_queue_wait');
  assert.equal(decision.navigationMode, 'stop');
});

test('ProdMafia Auto Play yields every movement mode for 250ms after dodge ownership', () => {
  const controller = enabled();
  assert.equal(controller.tick(snapshot(100, 'Realm of the Mad God', [], {
    dodgeOverrideActive: true,
  })).state, 'dodge_yield');
  assert.equal(controller.tick(snapshot(349, 'Realm of the Mad God', [])).state, 'dodge_yield');
  assert.equal(controller.tick(snapshot(350, 'Realm of the Mad God', [])).state, 'realm_wander');
});

test('ProdMafia Auto Play reselects the original realm after returning to Nexus', () => {
  const controller = enabled();
  const firstVisit = [
    object(10, 0x0712, 8, 0, 'Horizon (12/85)', portalDefinition()),
    object(11, 0x0712, 14, 0, 'Meridian (47/85)', portalDefinition()),
  ];
  controller.tick(snapshot(100, 'Nexus', firstVisit, { safeMap: true }));
  assert.equal(controller.tick(snapshot(1600, 'Nexus', firstVisit, {
    safeMap: true,
  })).targetObjectId, 11);
  controller.tick(snapshot(2000, 'Realm of the Mad God', []));

  const returned = [
    object(20, 0x0712, 8, 0, 'Meridian (3/85)', portalDefinition()),
    object(21, 0x0712, 14, 0, 'Horizon (80/85)', portalDefinition()),
  ];
  const decision = controller.tick(snapshot(3000, 'Nexus', returned, { safeMap: true }));
  assert.equal(decision.targetObjectId, 20);
});

test('ProdMafia Auto Play uses the 12-stall Castle guardian wait threshold', () => {
  const controller = enabled();
  const guardian = object(30, 0x0d78, 128.5, 60.5, 'Stone Guardian', enemyDefinition());
  const base = {
    position: { x: 50, y: 220 },
    questObjectId: guardian.objectId,
  };
  assert.deepEqual(controller.tick(snapshot(100, "Oryx's Castle", [guardian], {
    ...base,
    pathStuckCount: 3,
  })).target, { x: 79.5, y: 170.5 });
  assert.deepEqual(controller.tick(snapshot(200, "Oryx's Castle", [guardian], {
    ...base,
    pathStuckCount: 12,
  })).target, { x: 86.5, y: 140.5 });
});

test('ProdMafia Auto Play follows a reachable group member when a Castle macro segment is sealed', () => {
  const controller = enabled();
  const guardian = object(30, 0x0d78, 128.5, 60.5, 'Stone Guardian', enemyDefinition());
  const player = object(40, 0x0300, 75, 175, 'Runner', {
    ...neutralDefinition(),
    isPlayer: true,
  });
  const decision = controller.tick(snapshot(100, "Oryx's Castle", [guardian, player], {
    position: { x: 50, y: 220 },
    questObjectId: guardian.objectId,
    hasExactPathTo: (x, y) => x === player.x && y === player.y,
  }));
  assert.equal(decision.state, 'group_follow');
  assert.equal(decision.targetObjectId, player.objectId);
  assert.equal(decision.allowWallEscape, false);
});

function enabled(): ProdMafiaAutoPlayController {
  const controller = new ProdMafiaAutoPlayController();
  controller.setEnabled(true);
  return controller;
}

function snapshot(
  time: number,
  mapName: string,
  objects: readonly ProdMafiaAutoPlayObject[],
  patch: Partial<ProdMafiaAutoPlaySnapshot> = {},
): ProdMafiaAutoPlaySnapshot {
  return {
    time,
    mapName,
    safeMap: false,
    inRealmQueue: false,
    position: { x: 0, y: 0 },
    level: 20,
    weaponRange: 8,
    moveSpeed: 0.0096,
    questObjectId: -1,
    combatAimTargetObjectId: null,
    objects,
    hostileProjectileCount: 0,
    dodgeOverrideActive: false,
    teleportAllowed: true,
    pathStuckCount: 0,
    pathRouteEmpty: false,
    currentServerHost: 'current',
    serverHosts: ['current', 'other'],
    canOccupy: () => true,
    canTraverse: () => true,
    hasExactPathTo: () => true,
    projectile: () => undefined,
    ...patch,
  };
}

function object(
  objectId: number,
  type: number,
  x: number,
  y: number,
  name: string,
  definition: CombatObjectDefinition,
): ProdMafiaAutoPlayObject {
  return { objectId, type, x, y, name, definition };
}

function neutralDefinition(): CombatObjectDefinition {
  return { isEnemy: false, isCharacter: false, occupySquare: false };
}

function enemyDefinition(): CombatObjectDefinition {
  return { isEnemy: true, isCharacter: true, occupySquare: false };
}

function portalDefinition(): CombatObjectDefinition {
  return {
    ...neutralDefinition(),
    objectClass: 'Portal',
  };
}
