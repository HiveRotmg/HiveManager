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
