/**
 * All projectile position math lives here.
 *
 * Every function is pure — a function of (definition, elapsed) only. No clock,
 * no module state, no iteration-order-dependent float sums — the dodge planner
 * replays these results and asserts byte-identical output.
 *
 * This module exists because the distance math was previously duplicated in
 * combat-tracker.ts and auto-combat.ts, and the copies drifted: an
 * acceleration-clamp bug was fixed in one and not the other. One home only.
 *
 * The two copies had drifted in three ways, not one. All three are preserved
 * here behind options, defaulted so that each original call site keeps its
 * exact behaviour — extracting the math must not change it. Each divergence is
 * very likely a bug on one side; which side is a separate question with its own
 * failing test, deliberately not settled here.
 *
 *   applyBoomerang  combat-tracker folds only in its default branch, so
 *                   boomerang+wavy is NOT folded there; auto-combat folds
 *                   unconditionally.
 *   clampElapsed    auto-combat clamps elapsed to [0, lifetime]; combat-tracker
 *                   does not, so its exported predictProjectilePosition
 *                   extrapolates past end of life and before spawn.
 *   floorAtZero     auto-combat floors the result at 0; combat-tracker does not,
 *                   so a boomerang past its return leg reads as negative
 *                   distance — travelling backwards through its own origin.
 */
import type { CombatProjectileDefinition } from './combat-tracker';

function validMultiplier(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * Milliseconds at which turning stops. `turnStopTime === 0` in the XML means
 * "not authored", and the client falls back to the projectile lifetime — or to
 * circleTurnDelay for circle-turners. This default is why short-lived turners
 * sweep so violently: a 90-degree sweep across a 250ms life is 360 deg/sec.
 */
export function effectiveTurnStopTime(definition: CombatProjectileDefinition): number {
  if (definition.turnStopTime !== 0) return definition.turnStopTime;
  return definition.circleTurnDelay !== 0
    ? definition.circleTurnDelay
    : (definition.trajectoryLifetimeMs ?? definition.lifetimeMs);
}

export interface ProjectileDistanceOptions {
  speedMultiplier?: number;
  lifetimeMultiplier?: number;
  /**
   * Fold the path back at the halfway point for boomerangs.
   *
   * OFF by default, because the two original call sites disagree and this
   * module must not change either. `combat-tracker.positionAt` folds only in
   * its default branch (so boomerang+wavy is NOT folded there);
   * `auto-combat` folds unconditionally. Preserved as-is; the disagreement is
   * tracked separately.
   */
  applyBoomerang?: boolean;
  /**
   * Constrain elapsed to [0, lifetime × lifetimeMultiplier] before integrating.
   *
   * ON by default, matching `auto-combat`. `combat-tracker.positionAt` passes
   * false: it never clamped, and its exported `predictProjectilePosition` is
   * sampled by the dodge planner at offsets that outlive short-lived
   * projectiles. Clamping there would freeze those samples at the end-of-life
   * position instead of extrapolating — a real change to what the planner sees,
   * and not this module's call to make.
   */
  clampElapsed?: boolean;
  /**
   * Floor the returned distance at 0.
   *
   * OFF by default, matching `combat-tracker`. `auto-combat` passes true.
   * Only observable for boomerangs whose trajectory lifetime is shorter than
   * their total lifetime, where the fold drives distance below zero.
   */
  floorAtZero?: boolean;
}

/** Distance travelled along the projectile's path, in tiles. */
export function projectileDistanceAt(
  definition: CombatProjectileDefinition,
  elapsedMs: number,
  options: ProjectileDistanceOptions = {},
): number {
  const {
    speedMultiplier = 1,
    lifetimeMultiplier = 1,
    applyBoomerang = false,
    clampElapsed = true,
    floorAtZero = false,
  } = options;
  const elapsed = clampElapsed
    ? Math.max(0, Math.min(
      definition.lifetimeMs * validMultiplier(lifetimeMultiplier),
      elapsedMs,
    ))
    : elapsedMs;
  const scaledSpeed = definition.speed * validMultiplier(speedMultiplier);
  const baseSpeed = scaledSpeed / 10_000;

  let distance: number;
  if (definition.acceleration === 0 || elapsed < definition.accelerationDelay) {
    distance = elapsed * baseSpeed;
  } else {
    const accelerationElapsed = elapsed - definition.accelerationDelay;
    let accelerationTime = accelerationElapsed;
    let clampedTime = 0;
    let clampedSpeed = 0;
    if (definition.speedClamp !== -1) {
      clampedSpeed = definition.speedClamp / 10_000;
      const speedNeeded = Math.abs(definition.speedClamp - scaledSpeed);
      const timeToClamp = speedNeeded / Math.abs(definition.acceleration) * 1000;
      accelerationTime = Math.min(accelerationElapsed, timeToClamp);
      clampedTime = Math.max(0, accelerationElapsed - accelerationTime);
    }
    distance = definition.accelerationDelay * baseSpeed
      + accelerationTime * baseSpeed
      + (accelerationTime * accelerationTime / 1000) * 0.5 * (definition.acceleration / 10_000)
      + clampedTime * clampedSpeed;
  }

  if (applyBoomerang && definition.boomerang) {
    const trajectoryLifetime = definition.trajectoryLifetimeMs ?? definition.lifetimeMs;
    const halfway = trajectoryLifetime * baseSpeed * 0.5;
    if (distance > halfway) distance = halfway - (distance - halfway);
  }
  return floorAtZero ? Math.max(0, distance) : distance;
}
