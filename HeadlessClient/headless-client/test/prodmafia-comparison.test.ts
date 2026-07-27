import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CombatProjectileSnapshot } from '../src/combat-tracker';
import type { AutoDodgeSnapshot } from '../src/predictive-auto-dodge';
import { ProdMafiaAutoDodgeController } from '../src/prodmafia-auto-dodge';
import { ProdMafiaPathfinder } from '../src/prodmafia-pathfinder';

test('ProdMafia pathfinder uses observed-only bounded BFS and stops cardinally adjacent', () => {
  const pathfinder = new ProdMafiaPathfinder({
    getObject: () => undefined,
    tileIsBlockingWalk: () => false,
    getTileDamage: () => 0,
  });
  pathfinder.setMapBounds(6, 3);
  pathfinder.setTarget({ x: 4.5, y: 1.5 }, 0.2);
  assert.equal(pathfinder.next({ x: 0.5, y: 1.5 }).noPath, true);

  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 6; x++) pathfinder.observeTile(x, y, 0);
  }
  const step = pathfinder.next({ x: 0.5, y: 1.5 });
  assert.deepEqual(step.waypoint, { x: 1.5, y: 1.5 });
  assert.deepEqual(pathfinder.getPlannedTiles().at(-1), { x: 3.5, y: 1.5 });
});

test('ProdMafia pathfinder rejects diagonal corner cuts', () => {
  const pathfinder = new ProdMafiaPathfinder({
    getObject: () => undefined,
    tileIsBlockingWalk: (type) => type === 1,
    getTileDamage: () => 0,
  });
  pathfinder.setMapBounds(4, 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) pathfinder.observeTile(x, y, 0);
  }
  pathfinder.observeTile(1, 0, 1);
  pathfinder.observeTile(0, 1, 1);
  pathfinder.setTarget({ x: 3.5, y: 3.5 }, 0.2);

  const step = pathfinder.next({ x: 0.5, y: 0.5 });
  assert.equal(step.noPath, true);
});

test('ProdMafia path traversal can leave damaging ground but cannot re-enter it', () => {
  const pathfinder = new ProdMafiaPathfinder({
    getObject: () => undefined,
    tileIsBlockingWalk: () => false,
    getTileDamage: (type) => type === 1 ? 100 : 0,
  });
  pathfinder.setMapBounds(3, 1);
  pathfinder.observeTile(0, 0, 1);
  pathfinder.observeTile(1, 0, 0);
  pathfinder.observeTile(2, 0, 1);

  assert.equal(pathfinder.canTraverseForAutoPlay(0.5, 0.5, 1.5, 0.5), true);
  assert.equal(pathfinder.canTraverseForAutoPlay(1.5, 0.5, 2.5, 0.5), false);
});

test('ProdMafia pathfinding does not early-stop while the player remains on damaging ground', () => {
  const pathfinder = new ProdMafiaPathfinder({
    getObject: () => undefined,
    tileIsBlockingWalk: () => false,
    getTileDamage: (type) => type === 1 ? 100 : 0,
  });
  pathfinder.setMapBounds(3, 1);
  pathfinder.observeTile(0, 0, 1);
  pathfinder.observeTile(1, 0, 0);
  pathfinder.observeTile(2, 0, 0);
  pathfinder.setTarget({ x: 1.5, y: 0.5 }, 2.5, 'enemy:1', 'guarded');

  assert.deepEqual(pathfinder.next({ x: 0.5, y: 0.5 }).waypoint, { x: 1.5, y: 0.5 });
});

test('ProdMafia rejects an active waypoint immediately when new geometry blocks its segment', () => {
  const pathfinder = new ProdMafiaPathfinder({
    getObject: (type) => type === 1
      ? { isEnemy: false, occupySquare: true }
      : undefined,
    tileIsBlockingWalk: () => false,
    getTileDamage: () => 0,
  });
  pathfinder.setMapBounds(4, 1);
  for (let x = 0; x < 4; x++) pathfinder.observeTile(x, 0, 0);
  pathfinder.setTarget({ x: 3.5, y: 0.5 }, 0.2);
  assert.deepEqual(pathfinder.next({ x: 0.5, y: 0.5 }).waypoint, { x: 1.5, y: 0.5 });

  pathfinder.upsertObject(99, 1, 1.5, 0.5);
  assert.equal(pathfinder.next({ x: 0.5, y: 0.5 }).waypoint, undefined);
});

test('ProdMafia portal path takes the source-only final direct step onto the portal tile', () => {
  const pathfinder = new ProdMafiaPathfinder({
    getObject: () => undefined,
    tileIsBlockingWalk: () => false,
    getTileDamage: () => 0,
  });
  pathfinder.setMapBounds(4, 1);
  for (let x = 0; x < 4; x++) pathfinder.observeTile(x, 0, 0);
  pathfinder.setTarget({ x: 2.5, y: 0.5 }, 0.08, 'portal:1', 'portal');

  assert.deepEqual(pathfinder.next({ x: 0.5, y: 0.5 }).waypoint, { x: 1.5, y: 0.5 });
  const final = pathfinder.next({ x: 1.5, y: 0.5 });
  assert.deepEqual(final.waypoint, { x: 2.5, y: 0.5 });
  assert.equal(final.waypointThreshold, 0.08);
});

test('ProdMafia pathfinder advances past a tile-center waypoint from the live local position', () => {
  const pathfinder = new ProdMafiaPathfinder({
    getObject: () => undefined,
    tileIsBlockingWalk: () => false,
    getTileDamage: () => 0,
  });
  pathfinder.setMapBounds(6, 1);
  for (let x = 0; x < 6; x++) pathfinder.observeTile(x, 0, 0);
  pathfinder.setTarget({ x: 5.5, y: 0.5 }, 0.2);

  assert.deepEqual(pathfinder.next({ x: 0.5, y: 0.5 }).waypoint, { x: 1.5, y: 0.5 });

  // Live body already reached the first tile center; lagged server body has not.
  // Advancing from the live position must hand off to the next waypoint instead of
  // holding the same center (which freezes local prediction until NewTick).
  const fromLocal = pathfinder.next({ x: 1.5, y: 0.5 });
  assert.deepEqual(fromLocal.waypoint, { x: 2.5, y: 0.5 });
});

test('ProdMafia intermediate waypoints do not use an arrive-and-stop threshold', () => {
  const pathfinder = new ProdMafiaPathfinder({
    getObject: () => undefined,
    tileIsBlockingWalk: () => false,
    getTileDamage: () => 0,
  });
  pathfinder.setMapBounds(6, 1);
  for (let x = 0; x < 6; x++) pathfinder.observeTile(x, 0, 0);
  pathfinder.setTarget({ x: 5.5, y: 0.5 }, 0.2);

  const step = pathfinder.next({ x: 0.5, y: 0.5 });
  assert.deepEqual(step.waypoint, { x: 1.5, y: 0.5 });
  assert.equal(step.waypointThreshold, 0);
});

test('ProdMafia dodge evaluates standstill, 32 directions, and exact intent every frame', () => {
  const controller = new ProdMafiaAutoDodgeController();
  controller.setEnabled(true);
  const state = controller.evaluate(snapshot());

  assert.equal(state.overrideActive, false);
  assert.equal(state.decision, 'no_threat');
  assert.equal(state.plannerMetrics.candidatesGenerated, 34);
});

test('ProdMafia dodge overrides a direct imminent projectile', () => {
  const controller = new ProdMafiaAutoDodgeController();
  controller.setEnabled(true);
  const state = controller.evaluate(snapshot([hostileProjectile()]));

  assert.equal(state.overrideActive, true);
  assert.ok(state.threatCount > 0);
  assert.ok(Math.hypot(state.velocity.x, state.velocity.y) > 0);
  assert.notEqual(state.selectedCandidate, 33);
});

test('ProdMafia dodge preserves manual intent until the 250 ms reaction window', () => {
  const controller = new ProdMafiaAutoDodgeController();
  controller.setEnabled(true);
  const projectile = hostileProjectile();
  projectile.startX = 3.5;
  projectile.startY = 2.8;
  const state = controller.evaluate({
    ...snapshot([projectile]),
    goal: { x: 0, y: 10, threshold: 0.25 },
    intentVelocity: { x: 0, y: 0.0096 },
  });
  assert.equal(state.overrideActive, false);
  assert.equal(state.decision, 'impact_not_imminent');
});

test('ProdMafia dodge scores the acknowledged server position as a second anchor', () => {
  const controller = new ProdMafiaAutoDodgeController();
  controller.setEnabled(true);
  const projectile = hostileProjectile();
  projectile.startX = 1.2;
  projectile.definition.speed = 0;
  const upward = {
    ...snapshot([projectile]),
    goal: { x: 0, y: 10, threshold: 0.25 },
    intentVelocity: { x: 0, y: 0.0096 },
  };
  const localOnly = controller.evaluate(upward);
  assert.equal(localOnly.overrideActive, false);

  controller.reset();
  controller.setEnabled(true);
  const corridor = controller.evaluate({
    ...upward,
    serverPosition: { x: 1.2, y: 0 },
  });
  assert.equal(corridor.overrideActive, true);
});

test('ProdMafia dodge catches a projectile crossing wholly between samples', () => {
  const controller = new ProdMafiaAutoDodgeController();
  controller.setEnabled(true);
  const projectile = hostileProjectile();
  projectile.startX = 1;
  projectile.definition.speed = 1000;
  const state = controller.evaluate(snapshot([projectile]));
  assert.equal(state.overrideActive, true);
  assert.ok(state.threatCount > 0);
});

test('ProdMafia dodge escapes the 0.9-tile core of a projectile quest boss', () => {
  const controller = new ProdMafiaAutoDodgeController();
  controller.setEnabled(true);
  const state = controller.evaluate({
    ...snapshot(),
    pointBlankEmitters: [{ objectId: 99, x: 0.5, y: 0 }],
  });
  assert.equal(state.overrideActive, true);
  assert.ok(Math.hypot(state.velocity.x * 90 - 0.5, state.velocity.y * 90) >= 0.9);
});

test('ProdMafia dodge latches an AOE escape through the post-impact hold', () => {
  const controller = new ProdMafiaAutoDodgeController();
  controller.setEnabled(true);
  const aoe = { x: 0, y: 0, radius: 1, landingTime: 200, damage: 100 };
  const initial = controller.evaluate({
    ...snapshot(),
    goal: undefined,
    intentVelocity: { x: 0, y: 0 },
    aoes: [aoe],
  });
  assert.equal(initial.overrideActive, true);

  const held = controller.evaluate({
    ...snapshot(),
    time: 250,
    goal: undefined,
    intentVelocity: { x: 0, y: 0 },
    aoes: [],
  });
  assert.equal(held.decision, 'aoe_escape_latched');
  assert.equal(held.overrideActive, true);
});

test('ProdMafia dodge leaves a short-lived exclusion after unmodeled server damage', () => {
  const controller = new ProdMafiaAutoDodgeController();
  controller.setEnabled(true);
  controller.noteUnmodeledDamage({ x: 0, y: 0 }, 0, 200);
  const state = controller.evaluate({
    ...snapshot(),
    goal: undefined,
    intentVelocity: { x: 0, y: 0 },
  });
  assert.equal(state.overrideActive, true);
  assert.ok(Math.hypot(state.velocity.x, state.velocity.y) > 0);
});

test('ProdMafia dodge arms a fixed-direction escape after two stationary projectile hits', () => {
  const controller = new ProdMafiaAutoDodgeController();
  controller.setEnabled(true);
  controller.noteProjectileHit({ x: 0, y: 0 }, 0, 100);
  controller.noteProjectileHit({ x: 0.1, y: 0 }, 100, 100);
  const state = controller.evaluate({
    ...snapshot(),
    time: 100,
    goal: undefined,
    intentVelocity: { x: 0, y: 0 },
  });
  assert.equal(state.decision, 'stuck_escape');
  assert.equal(state.overrideActive, true);
  assert.ok(state.selectedCandidate >= 1 && state.selectedCandidate <= 32);
});

function snapshot(projectiles: readonly CombatProjectileSnapshot[] = []): AutoDodgeSnapshot {
  return {
    time: 0,
    playerId: 1,
    position: { x: 0, y: 0 },
    goal: { x: 10, y: 0, threshold: 0.25 },
    moveSpeed: 0.0096,
    intentVelocity: { x: 0.0096, y: 0 },
    movementLeadMs: 0,
    projectiles,
    aoes: [],
    environment: {
      canOccupy: () => true,
      enemyClearance: () => Infinity,
      isProjectileSegmentOpen: () => true,
      getRevision: () => 1,
    },
  };
}

function hostileProjectile(): CombatProjectileSnapshot {
  return {
    side: 'enemy',
    bulletId: 1,
    bulletType: 0,
    ownerId: 2,
    containerType: 3,
    startX: 3,
    startY: 0,
    angle: Math.PI,
    startTime: 0,
    damage: 100,
    hitObjects: new Set<number>(),
    definition: {
      speed: 100,
      lifetimeMs: 500,
      multiHit: false,
      passesCover: false,
      amplitude: 0,
      frequency: 1,
      magnitude: 3,
      wavy: false,
      parametric: false,
      boomerang: false,
      acceleration: 0,
      accelerationDelay: 0,
      speedClamp: 0,
      turnRate: 0,
      turnRateDelay: 0,
      turnAcceleration: 0,
      turnAccelerationDelay: 0,
      turnClamp: 0,
      turnStopTime: 0,
      circleTurnAngle: 0,
      circleTurnDelay: 0,
      collisionMult: 1,
    },
  };
}
