import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CombatProjectileDefinition } from '../src/combat-tracker';
import { turningPositionAt, projectileDistanceAt } from '../src/projectile-motion';

const DEG = Math.PI / 180;

function base(): CombatProjectileDefinition {
  return {
    speed: 243, lifetimeMs: 250, multiHit: false, passesCover: false,
    amplitude: 0, frequency: 1, magnitude: 3, wavy: false, parametric: false,
    boomerang: false, acceleration: 0, accelerationDelay: 0, speedClamp: -1,
    laserDistance: 0,
    turnRate: 0, turnRateDelay: 0, turnAcceleration: 0, turnAccelerationDelay: 0,
    turnClamp: 0, turnStopTime: 0, circleTurnAngle: 0, circleTurnDelay: 0,
    collisionMult: 1,
  };
}

/** Ferryman's Scythe proj 0 — 90 degrees swept across its 250ms life. */
const scythe: CombatProjectileDefinition = { ...base(), turnRate: 90 * DEG };

test('a turning projectile arcs away from the straight-line path', () => {
  // Launched along +x from the origin.
  const at = (ms: number) => turningPositionAt(scythe, 0, 0, 0, ms);

  // At the end of its life it has swept the full 90 degrees, so it points +y.
  const end = at(250);
  const dist = projectileDistanceAt(scythe, 250);
  assert.ok(Math.abs(end.x - 0) < 1e-6, `expected x~0 at full sweep, got ${end.x}`);
  assert.ok(Math.abs(end.y - dist) < 1e-6, `expected y~${dist}, got ${end.y}`);
});

test('straight-line prediction error exceeds the hitbox within 58ms', () => {
  // This is the defect this whole plan exists to fix: predicting the Scythe as
  // a straight line is wrong by more than a 0.5-tile hitbox before the bot can
  // even react.
  const HITBOX = 0.5;
  let firstExceed = -1;
  for (let ms = 1; ms <= 250; ms++) {
    const actual = turningPositionAt(scythe, 0, 0, 0, ms);
    const d = projectileDistanceAt(scythe, ms);
    const straightX = d;                 // launch angle 0 => straight along +x
    const err = Math.hypot(straightX - actual.x, 0 - actual.y);
    if (err > HITBOX) { firstExceed = ms; break; }
  }
  assert.ok(firstExceed > 0, 'the arc must diverge from the straight line');
  assert.ok(
    firstExceed >= 50 && firstExceed <= 70,
    `expected divergence past the hitbox around 58ms, got ${firstExceed}ms`,
  );
});

test('after turnStopTime the projectile continues straight', () => {
  const d: CombatProjectileDefinition = {
    ...base(), lifetimeMs: 1_000, turnRate: 90 * DEG, turnStopTime: 100,
  };
  const p1 = turningPositionAt(d, 0, 0, 0, 300);
  const p2 = turningPositionAt(d, 0, 0, 0, 400);
  const p3 = turningPositionAt(d, 0, 0, 0, 500);
  // Three points on a straight line: the cross product of the two legs is ~0.
  const cross = (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
  assert.ok(Math.abs(cross) < 1e-6, `post-stop path must be straight, cross=${cross}`);
});

test('a non-turning projectile is unaffected', () => {
  const d = base();
  const p = turningPositionAt(d, 0, 0, 0, 200);
  assert.ok(Math.abs(p.x - projectileDistanceAt(d, 200)) < 1e-12);
  assert.ok(Math.abs(p.y) < 1e-12);
});

/** Jailer's Scythe proj 0: CircleTurnAngle 90, CircleTurnDelay 200, life 350ms. */
const jailer: CombatProjectileDefinition = {
  ...base(), speed: 260, lifetimeMs: 350,
  circleTurnAngle: 90 * DEG, circleTurnDelay: 200,
};

test('circle-turn freezes the radius after the delay', () => {
  const frozen = projectileDistanceAt(jailer, 200);
  for (const ms of [200, 250, 300, 350]) {
    const p = turningPositionAt(jailer, 0, 0, 0, ms);
    const radius = Math.hypot(p.x, p.y);
    assert.ok(
      Math.abs(radius - frozen) < 1e-6,
      `at ${ms}ms the projectile must stay at the frozen radius ${frozen}, got ${radius}`,
    );
  }
});

test('circle-turn travels straight before the delay', () => {
  const p = turningPositionAt(jailer, 0, 0, 0, 100);
  assert.ok(Math.abs(p.x - projectileDistanceAt(jailer, 100)) < 1e-9);
  assert.ok(Math.abs(p.y) < 1e-9);
});

test('circle-turn sweeps after the delay', () => {
  const a = turningPositionAt(jailer, 0, 0, 0, 220);
  const b = turningPositionAt(jailer, 0, 0, 0, 300);
  const angA = Math.atan2(a.y, a.x);
  const angB = Math.atan2(b.y, b.x);
  assert.ok(angB > angA, 'the orbit angle must advance with time');
});

test('circle-turn resolves the sweep to turnRate when both are set', () => {
  // Stated as authoritative in the plan's semantics table but otherwise
  // untested: with TurnRate set, the XML CircleTurnAngle is discarded.
  const both: CombatProjectileDefinition = { ...jailer, turnRate: 45 * DEG };
  const p = turningPositionAt(both, 0, 0, 0, 300);
  // The combined TurnRate+CircleTurn branch uses absolute elapsed time (unlike
  // CircleTurn-only, which subtracts the delay). At 300/200 of the 45-degree
  // sweep this is 67.5 degrees, not the XML CircleTurnAngle.
  assert.ok(
    Math.abs(Math.atan2(p.y, p.x) - 67.5 * DEG) < 1e-9,
    `expected the turnRate sweep, got ${Math.atan2(p.y, p.x) / DEG} degrees`,
  );
  assert.ok(
    Math.abs(Math.hypot(p.x, p.y) - projectileDistanceAt(both, 200)) < 1e-6,
    'the radius must still freeze at the delay',
  );
});

test('the path is continuous across turnStopTime', () => {
  // The stop branch and the turning branch must agree at the boundary, or the
  // projectile teleports at exactly the moment turning ends.
  const d: CombatProjectileDefinition = {
    ...base(), lifetimeMs: 1_000, turnRate: 90 * DEG, turnStopTime: 100,
  };
  const justBefore = turningPositionAt(d, 0, 0, 0, 100 - 1e-6);
  const atStop = turningPositionAt(d, 0, 0, 0, 100);
  assert.ok(
    Math.hypot(atStop.x - justBefore.x, atStop.y - justBefore.y) < 1e-6,
    'position must not jump at turnStopTime',
  );
});

test('turning position honours the launch angle and start offset', () => {
  // The fixtures above all launch from the origin along +x, which would hide a
  // dropped startX/startY or a launch angle applied in the wrong frame.
  const launch = 30 * DEG;
  const rotated = turningPositionAt(scythe, launch, 7, -3, 125);
  const atOrigin = turningPositionAt(scythe, 0, 0, 0, 125);
  const cos = Math.cos(launch);
  const sin = Math.sin(launch);
  assert.ok(Math.abs(rotated.x - (7 + atOrigin.x * cos - atOrigin.y * sin)) < 1e-9);
  assert.ok(Math.abs(rotated.y - (-3 + atOrigin.x * sin + atOrigin.y * cos)) < 1e-9);
});
