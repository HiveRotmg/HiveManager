import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CombatProjectileDefinition } from '../src/combat-tracker';
import { projectileDistanceAt, effectiveTurnStopTime } from '../src/projectile-motion';

/** A plain non-turning projectile: every turn field is inert. */
function straight(): CombatProjectileDefinition {
  return {
    speed: 100,
    lifetimeMs: 1_000,
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
    speedClamp: -1,
    turnRate: 0,
    turnRateDelay: 0,
    turnAcceleration: 0,
    turnAccelerationDelay: 0,
    turnClamp: 0,
    turnStopTime: 0,
    circleTurnAngle: 0,
    circleTurnDelay: 0,
    collisionMult: 1,
  };
}

test('a definition carries turn fields with inert defaults', () => {
  const d = straight();
  assert.equal(d.turnRate, 0);
  assert.equal(d.turnStopTime, 0, 'zero means "fall back to lifetime"');
  assert.equal(d.circleTurnDelay, 0);
  assert.equal(d.collisionMult, 1, 'collisionMult must default to 1, not 0');
});

test('distance is linear when there is no acceleration', () => {
  const d = straight();                    // speed 100 => 0.01 tiles/ms
  assert.equal(projectileDistanceAt(d, 0), 0);
  assert.ok(Math.abs(projectileDistanceAt(d, 500) - 5) < 1e-9);
  assert.ok(Math.abs(projectileDistanceAt(d, 1_000) - 10) < 1e-9);
});

test('distance clamps at the projectile lifetime', () => {
  const d = straight();
  assert.equal(projectileDistanceAt(d, 5_000), projectileDistanceAt(d, 1_000));
});

test('turn stop time falls back to the lifetime when unset', () => {
  const d = straight();
  assert.equal(effectiveTurnStopTime(d), 1_000, 'turnStopTime 0 => lifetime');
  assert.equal(effectiveTurnStopTime({ ...d, turnStopTime: 250 }), 250);
  assert.equal(
    effectiveTurnStopTime({ ...d, circleTurnDelay: 200 }),
    200,
    'circle-turners stop at circleTurnDelay',
  );
});

// The two call sites this module replaces had already diverged in two more ways
// than the plan's boomerang note recorded. Both are preserved behind options so
// that the extraction stays a true no-op; see the header comment in
// src/projectile-motion.ts. These tests pin the options, not the divergence -
// deciding which side is correct is deliberately left to a separate change.

test('clampElapsed:false extrapolates past end of life, as combat-tracker does', () => {
  const d = straight();
  assert.equal(
    projectileDistanceAt(d, 5_000, { clampElapsed: false }),
    50,
    'combat-tracker.positionAt never clamped elapsed',
  );
  assert.equal(
    projectileDistanceAt(d, -200, { clampElapsed: false }),
    -2,
    'nor did it floor a negative elapsed',
  );
  assert.equal(projectileDistanceAt(d, 5_000), 10, 'clamping is still the default');
});

test('floorAtZero:true stops a folded boomerang at the origin, as auto-combat does', () => {
  // trajectoryLifetime 500ms => fold at 2.5 tiles, but the projectile lives
  // 1000ms and covers 10 tiles, so the fold runs the distance negative.
  const d: CombatProjectileDefinition = {
    ...straight(),
    boomerang: true,
    trajectoryLifetimeMs: 500,
  };
  const options = { applyBoomerang: true };
  assert.equal(projectileDistanceAt(d, 1_000, options), -5, 'raw fold goes negative');
  assert.equal(
    projectileDistanceAt(d, 1_000, { ...options, floorAtZero: true }),
    0,
    'auto-combat floored the result at zero',
  );
});
