import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CombatProjectileSnapshot } from '../src/combat-tracker';
import type { AutoDodgeSnapshot } from '../src/predictive-auto-dodge';
import { ProdMafiaAutoDodgeController } from '../src/prodmafia-auto-dodge';

/**
 * Scoring-channel regressions for the ProdMafia dodge port: the physical/soft
 * clearance split, summed soft risk, the non-negative clearance gate in the
 * intent blend, and the hard-AoE tier.
 *
 * Geometry notes: `PLAYER_HITBOX_SCALE` is 0.92 and `PROJECTILE_CLEARANCE` is
 * 0.1, so a 0.5 collision half-size gives a 0.5 physical boundary and a
 * 0.5 + max(0, 0.1 - 0.5 * 0.08) = 0.56 soft boundary. Projectile clearance is
 * Chebyshev (L-infinity), matching the client's square collision box.
 */

test('a soft-margin breach overrides without predicting physical damage', () => {
  const controller = new ProdMafiaAutoDodgeController();
  controller.setEnabled(true);
  // 0.545 is inside the 0.56 soft boundary and outside the 0.5 physical one,
  // and no candidate can close the remaining 0.045 within the horizon.
  const state = controller.evaluate(crawlSnapshot([stationaryProjectile(0, 0.545)]));

  assert.equal(state.overrideActive, true);
  assert.equal(state.earliestImpactMs, null);
  assert.ok(
    state.decision.startsWith('gentle'),
    `expected a gentle correction, got ${state.decision}`,
  );
});

test('the physical channel still predicts damage at the literal collision boundary', () => {
  const controller = new ProdMafiaAutoDodgeController();
  controller.setEnabled(true);
  const state = controller.evaluate(crawlSnapshot([stationaryProjectile(0, 0.49)]));

  assert.equal(state.overrideActive, true);
  assert.equal(state.earliestImpactMs, 0);
});

test('soft risk sums over threats, so a crowded escape loses to a single near miss', () => {
  const controller = new ProdMafiaAutoDodgeController();
  controller.setEnabled(true);
  // A 0.15-tile-wide corridor leaves only +x and -x reachable, and an incoming
  // shot makes standing still the one route that takes damage. Both escapes
  // graze threats 0.53 tiles away: five 20-damage shots along +x against one
  // 100-damage shot along -x. Expected damage, first impact, mobility and
  // minimum clearance are all identical between the two, so only a risk channel
  // that SUMS per threat can separate them.
  const crowd = [0.6, 1, 1.4, 1.8, 2.2].map((x) => stationaryProjectile(x, 0.53, 20));
  const state = controller.evaluate({
    ...crawlSnapshot([
      ...crowd,
      stationaryProjectile(-1.44, 0.53, 100),
      incomingProjectile(),
    ]),
    moveSpeed: 0.0096,
    environment: corridorEnvironment(0.15),
  });

  assert.equal(state.overrideActive, true);
  assert.ok(state.velocity.x < 0, `expected to move away from the crowd, got ${state.velocity.x}`);
});

test('the intent blend rejects a grazing candidate instead of following intent', () => {
  const controller = new ProdMafiaAutoDodgeController();
  controller.setEnabled(true);
  // Intent points straight at a shot 0.6 tiles away. Holding intent closes to
  // 0.53 — inside the 0.56 soft boundary but outside the 0.5 physical one, so
  // it predicts no damage and only the clearance gate can reject it. Standing
  // still is safe here, so the route has to be genuinely deflected.
  const state = controller.evaluate({
    ...crawlSnapshot([stationaryProjectile(0.6, 0)]),
    moveSpeed: 0.000233,
    intentVelocity: { x: 0.000233, y: 0 },
  });

  assert.equal(state.overrideActive, true);
  assert.equal(state.earliestImpactMs, null);
  assert.ok(Math.abs(state.velocity.y) > 0, 'expected a deflected route');
  // 0.07 tiles of travel at alignment a leaves 0.6 - 0.07a of clearance, so
  // anything above 4/7 breaches the soft boundary. Intent itself is 1.0.
  const alignment = state.velocity.x / Math.hypot(state.velocity.x, state.velocity.y);
  assert.ok(alignment <= 4 / 7 + 1e-9, `expected a non-breaching route, got ${alignment}`);
});

test('an AOE with unlearned damage outranks a large known-damage hit', () => {
  const controller = new ProdMafiaAutoDodgeController();
  controller.setEnabled(true);
  // A one-tile-wide corridor leaves only +x and -x reachable. +x escapes the
  // 100-damage blast into the unlearned one; -x does the reverse. The hard tier
  // must win even though its expected damage is lower.
  const state = controller.evaluate({
    ...crawlSnapshot(),
    moveSpeed: 0.0096,
    intentVelocity: { x: 0.0096, y: 0 },
    aoes: [
      { x: 3, y: 0, radius: 3.2, landingTime: 300 },
      { x: -3, y: 0, radius: 3.2, landingTime: 300, damage: 100 },
    ],
    environment: corridorEnvironment(0.4),
  });

  assert.equal(state.overrideActive, true);
  assert.ok(
    state.velocity.x < 0,
    `expected to take the known blast rather than the unknown one, got ${state.velocity.x}`,
  );
});

/**
 * Autonomous, effectively stationary player: a 0.0001 tiles/ms move speed keeps
 * every candidate inside 0.03 tiles of the origin so clearances stay in the
 * narrow band between the physical and soft boundaries.
 */
function crawlSnapshot(
  projectiles: readonly CombatProjectileSnapshot[] = [],
): AutoDodgeSnapshot {
  return {
    time: 0,
    playerId: 1,
    position: { x: 0, y: 0 },
    autonomousIntent: true,
    moveSpeed: 0.0001,
    intentVelocity: { x: 0, y: 0 },
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

function corridorEnvironment(halfWidth: number): AutoDodgeSnapshot['environment'] {
  return {
    canOccupy: (_x: number, y: number) => Math.abs(y) < halfWidth,
    enemyClearance: () => Infinity,
    isProjectileSegmentOpen: () => true,
    getRevision: () => 1,
  };
}

let nextBulletId = 1;

/** Crosses the player's start position from below at 0.01 tiles/ms. */
function incomingProjectile(): CombatProjectileSnapshot {
  const projectile = stationaryProjectile(0, -1.5);
  projectile.angle = Math.PI / 2;
  projectile.definition.speed = 100;
  return projectile;
}

function stationaryProjectile(x: number, y: number, damage = 100): CombatProjectileSnapshot {
  return {
    side: 'enemy',
    bulletId: nextBulletId++,
    bulletType: 0,
    ownerId: 2,
    containerType: 3,
    startX: x,
    startY: y,
    angle: 0,
    startTime: 0,
    damage,
    hitObjects: new Set<number>(),
    definition: {
      speed: 0,
      lifetimeMs: 5000,
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
