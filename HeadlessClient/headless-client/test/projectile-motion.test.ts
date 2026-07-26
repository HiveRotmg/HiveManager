import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CombatProjectileDefinition } from '../src/combat-tracker';

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
