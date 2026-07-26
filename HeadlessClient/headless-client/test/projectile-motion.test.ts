import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CombatProjectileDefinition } from '../src/combat-tracker';
import { projectileDistanceAt, effectiveTurnStopTime, turnAngleAt } from '../src/projectile-motion';

const DEG = Math.PI / 180;

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

/** Ferryman's Scythe proj 0: 90 degrees of sweep across a 250ms life. */
function scythe(): CombatProjectileDefinition {
  return { ...straight(), speed: 243, lifetimeMs: 250, turnRate: 90 * DEG };
}

test('turn angle sweeps the full TurnRate across turnStopTime', () => {
  const d = scythe();                       // turnStopTime 0 => lifetime 250ms
  assert.ok(Math.abs(turnAngleAt(d, 0)) < 1e-12);
  assert.ok(Math.abs(turnAngleAt(d, 125) - 45 * DEG) < 1e-9, 'half way => half the sweep');
  assert.ok(Math.abs(turnAngleAt(d, 250) - 90 * DEG) < 1e-9, 'full sweep at turnStopTime');
});

test('turn angle is zero past turnStopTime unless ignoreStop', () => {
  const d = { ...scythe(), turnStopTime: 100 };
  assert.equal(turnAngleAt(d, 150), 0, 'past the stop, no turn offset');
  assert.ok(
    Math.abs(turnAngleAt(d, 150, true) - 135 * DEG) < 1e-9,
    'ignoreStop keeps extrapolating, used to sample the stop heading',
  );
});

test('turn delay suppresses turning until turnRateDelay seconds', () => {
  const d = { ...scythe(), turnRateDelay: 0.1 };   // 100ms, expressed in seconds
  assert.equal(turnAngleAt(d, 50), 0, 'before the delay there is no turn');
  assert.ok(turnAngleAt(d, 200) > 0, 'after the delay it turns');
});

test('turn acceleration adds a quadratic phase after its delay', () => {
  const base = { ...scythe(), turnStopTime: 1_000, lifetimeMs: 1_000 };
  const accel = { ...base, turnAcceleration: 90 * DEG, turnClamp: 180 * DEG };
  assert.equal(
    turnAngleAt({ ...accel, turnAccelerationDelay: 10 }, 100),
    turnAngleAt(base, 100),
    'before the acceleration delay it matches the un-accelerated curve',
  );
  assert.ok(
    turnAngleAt(accel, 500) > turnAngleAt(base, 500),
    'after the delay the accelerated curve has swept further',
  );
});
