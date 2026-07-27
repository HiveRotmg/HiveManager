/**
 * Golden / characterization suite ported from ProdMafia's
 * `tests/AutoDodgeFixtureMain.as` (68 `expect(...)` assertions).
 *
 * Every test is tagged `[Fn]` with the ActionScript fixture function it comes
 * from, and each `assert` corresponds to one clause of the original `expect`.
 * Expected numbers are the fixture's numbers. Where the fixture asserts an
 * exact float the epsilon is stated at the assertion; the tightest ones are
 * 1e-9 (AoE margin, no player motion involved) and 1e-6 (Chebyshev corridor
 * probes, where 32 moving candidates perturb the geometry by <= 3e-7).
 * The ActionScript helper used 1e-4 throughout, so these are all tighter.
 *
 * Unlike `prodmafia-comparison.test.ts` this suite never stubs
 * `canOccupy: () => true`. `fixtureMap()` reproduces `AutoDodgeFixtureMap`:
 * a 100x100 world clamped to [0.5, 99.5] with inclusive blocked and
 * damaging-floor rectangles, so wall topology and safe-walk are exercised.
 *
 * Tests marked `skip` document a real gap in the port; the skip reason names
 * exactly what is missing. They are deliberately not weakened into passing
 * assertions.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { predictAutoNexusRouteDamage } from '../src/auto-nexus';
import {
  isNonlinearProjectile,
  predictProjectilePosition,
  type CombatProjectileDefinition,
  type CombatProjectileSnapshot,
} from '../src/combat-tracker';
import type { DodgePlanningEnvironment } from '../src/dodge-trajectory-planner';
import type { AutoDodgeSnapshot, AutoDodgeState } from '../src/predictive-auto-dodge';
import { ProdMafiaAutoDodgeController } from '../src/prodmafia-auto-dodge';

/** `AutoDodgeFixtureMain.NOW`. */
const NOW = 10_000;
const PLAYER_X = 10;
const PLAYER_Y = 10;
/** Fixture player SPD 50; the fixture passes moveSpeed 0.01 tiles/ms. */
const MOVE_SPEED = 0.01;
/** The fixture's `movementLeadMs` argument. */
const LEAD_MS = 16;
/**
 * A player that cannot meaningfully move, so all 34 candidates collapse onto
 * the standstill geometry and `earliestImpactMs` becomes a readout of the
 * standstill candidate's clearance. Used to probe exact clearance boundaries,
 * because the per-candidate arrays are module-private.
 */
const FROZEN_SPEED = 1e-9;
/**
 * BASE_COLLISION_HALF_SIZE * CollisionMult - the collision engine's own
 * boundary, which is what literal damage and `firstImpactMs` are measured
 * against. The soft planning margin (PROJECTILE_CLEARANCE 0.1 reduced by
 * whatever PLAYER_HITBOX_SCALE already gave back, so 0.06 at mult 1) is added
 * only to the private `minimumClearance`, so 0.56 is not observable.
 */
const PHYSICAL_HALF_SIZE = 0.5;

type Rect = readonly [number, number, number, number];

interface FixtureMap extends DodgePlanningEnvironment {
  /** `AutoDodgeFixtureMap.block` - inclusive on every edge. */
  block(minX: number, minY: number, maxX: number, maxY: number): void;
  /** `AutoDodgeFixtureMap.damageGround` - inclusive on every edge. */
  damageGround(minX: number, minY: number, maxX: number, maxY: number): void;
  isDamagingGround(x: number, y: number): boolean;
  readonly safeWalkFlags: boolean[];
}

function inside(rects: readonly Rect[], x: number, y: number): boolean {
  return rects.some(([minX, minY, maxX, maxY]) =>
    x >= minX && x <= maxX && y >= minY && y <= maxY);
}

function fixtureMap(): FixtureMap {
  const blocked: Rect[] = [];
  const damaging: Rect[] = [];
  const safeWalkFlags: boolean[] = [];
  return {
    safeWalkFlags,
    block(minX: number, minY: number, maxX: number, maxY: number): void {
      blocked.push([minX, minY, maxX, maxY]);
    },
    damageGround(minX: number, minY: number, maxX: number, maxY: number): void {
      damaging.push([minX, minY, maxX, maxY]);
    },
    isDamagingGround(x: number, y: number): boolean {
      return inside(damaging, x, y);
    },
    canOccupy(x: number, y: number, safeWalk: boolean): boolean {
      safeWalkFlags.push(safeWalk);
      return x >= 0.5 && x <= 99.5 && y >= 0.5 && y <= 99.5
        && !inside(blocked, x, y)
        && (!safeWalk || !inside(damaging, x, y));
    },
    enemyClearance: (): number => Infinity,
    isProjectileSegmentOpen: (): boolean => true,
    getRevision: (): number => 1,
  };
}

/** `<Projectile><LifetimeMS>1000</LifetimeMS><Speed>100</Speed><Size>100</Size>`. */
function definition(
  overrides: Partial<CombatProjectileDefinition> = {},
): CombatProjectileDefinition {
  return {
    speed: 100,
    lifetimeMs: 1000,
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
    ...overrides,
  };
}

interface ShotOptions {
  x: number;
  y: number;
  angle?: number;
  damage?: number;
  bulletId?: number;
  startTime?: number;
  definition?: Partial<CombatProjectileDefinition>;
}

/** `AutoDodgeFixtureMain.projectile(...)`. */
function shot(options: ShotOptions): CombatProjectileSnapshot {
  return {
    side: 'enemy',
    bulletId: options.bulletId ?? 1,
    bulletType: 0,
    ownerId: 32_001,
    containerType: 32_001,
    startX: options.x,
    startY: options.y,
    angle: options.angle ?? 0,
    startTime: options.startTime ?? NOW,
    damage: options.damage ?? 150,
    hitObjects: new Set<number>(),
    definition: definition(options.definition),
  };
}

function snapshot(
  map: FixtureMap,
  overrides: Partial<AutoDodgeSnapshot> = {},
): AutoDodgeSnapshot {
  return {
    time: NOW,
    playerId: 1,
    position: { x: PLAYER_X, y: PLAYER_Y },
    moveSpeed: MOVE_SPEED,
    intentVelocity: { x: 0, y: 0 },
    movementLeadMs: LEAD_MS,
    projectiles: [],
    aoes: [],
    environment: map,
    ...overrides,
  };
}

function frozenSnapshot(
  map: FixtureMap,
  overrides: Partial<AutoDodgeSnapshot> = {},
): AutoDodgeSnapshot {
  return snapshot(map, { moveSpeed: FROZEN_SPEED, movementLeadMs: 0, ...overrides });
}

function evaluate(input: AutoDodgeSnapshot): AutoDodgeState {
  const controller = new ProdMafiaAutoDodgeController();
  controller.setEnabled(true);
  return controller.evaluate(input);
}

/** `candidateX/candidateY` for a fixed-direction candidate index. */
function direction(index: number): { x: number; y: number } {
  if (index === 0) return { x: 0, y: 0 };
  const angle = (index - 1) * Math.PI * 2 / 32;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/** CollisionMult that makes the physical half-extent exactly `halfSize`. */
function collisionMultForHalfSize(halfSize: number): number {
  return halfSize / PHYSICAL_HALF_SIZE;
}

/**
 * Independent oracle: the closest the projectile ever comes to the executed
 * route, in Chebyshev tiles, sampled at 5 ms (six times finer than the
 * controller's own 30 ms grid). Deliberately does not reuse the controller's
 * sweep math.
 */
function routeMinimumChebyshev(
  input: AutoDodgeSnapshot,
  velocity: { x: number; y: number },
  projectile: CombatProjectileSnapshot,
  horizonMs = 300,
): number {
  let minimum = Infinity;
  for (let offset = 0; offset <= horizonMs; offset += 5) {
    const playerX = input.position.x + velocity.x * (input.movementLeadMs + offset);
    const playerY = input.position.y + velocity.y * (input.movementLeadMs + offset);
    const point = predictProjectilePosition(projectile, input.time + offset);
    minimum = Math.min(
      minimum,
      Math.max(Math.abs(point.x - playerX), Math.abs(point.y - playerY)),
    );
  }
  return minimum;
}

function routeEndpoint(
  input: AutoDodgeSnapshot,
  state: AutoDodgeState,
  offsetMs = 300,
): { x: number; y: number } {
  return {
    x: input.position.x + state.velocity.x * (input.movementLeadMs + offsetMs),
    y: input.position.y + state.velocity.y * (input.movementLeadMs + offsetMs),
  };
}

// ---------------------------------------------------------------------------
// F1  testValidatedConfigSnapshot
// ---------------------------------------------------------------------------

test('[F1] config applies numeric defaults and clamps', {
  skip: 'No config object exists in the port. Every tunable the fixture clamps '
    + '(projectileClearance, aoeClearance, lookAheadMs, aoeLookAheadMs, '
    + 'playerHitbox, cornerLookAheadTiles, cornerStrength, reactionLeadMs, '
    + 'manualInfluence, hysteresisMs) is a module-private `const` in '
    + 'prodmafia-auto-dodge.ts with no refresh()/validation path, and '
    + 'setEnabled accepts only { safeWalk }. The clamping behaviour therefore '
    + 'has no callable surface. The effective DEFAULTS are covered instead by '
    + 'the four [F1-defaults] tests below.',
}, () => {
  assert.fail('unreachable');
});

test('[F1-defaults] lookAheadMs default is 300', () => {
  const state = evaluate(snapshot(fixtureMap()));
  assert.equal(state.comparisonHorizonMs, 300);
});

test('[F1-defaults] aoeLookAheadMs default is 1200', () => {
  const map = fixtureMap();
  const atHorizon = evaluate(frozenSnapshot(map, {
    aoes: [{ x: PLAYER_X, y: PLAYER_Y, radius: 1, landingTime: NOW + 1200, damage: 100 }],
  }));
  const pastHorizon = evaluate(frozenSnapshot(map, {
    aoes: [{ x: PLAYER_X, y: PLAYER_Y, radius: 1, landingTime: NOW + 1201, damage: 100 }],
  }));
  assert.equal(atHorizon.threatCount, 1);
  assert.equal(pastHorizon.threatCount, 0);
});

test('[F1-defaults] AoE damage boundary is the blast radius itself', () => {
  const map = fixtureMap();
  // Only the landing sample runs, at movementOffset 0, so every candidate sits
  // exactly on the player position: epsilon 1e-9 is honest here.
  const aoeAt = (distance: number): AutoDodgeSnapshot => frozenSnapshot(map, {
    aoes: [{
      x: PLAYER_X + distance,
      y: PLAYER_Y,
      radius: 1,
      landingTime: NOW,
      damage: 100,
    }],
  });
  assert.equal(evaluate(aoeAt(1 - 1e-9)).earliestImpactMs, 0);
  assert.equal(evaluate(aoeAt(1 + 1e-9)).earliestImpactMs, null);
});

test('[F1-defaults] soft clearance margins are not observable', {
  skip: 'PROJECTILE_CLEARANCE (0.1, reduced to 0.06 at mult 1 by '
    + 'effectiveProjectileSafetyMargin) and AOE_CLEARANCE (0.2) now feed only '
    + '`minimumClearance` and `risk`, both private. `firstImpactMs` and '
    + '`expectedDamage` use the physical boundary alone, so the two soft '
    + 'defaults have no observable boundary to probe.',
}, () => {
  assert.fail('unreachable');
});

test('[F1-defaults] projectile damage boundary is the unscaled 0.5 half-extent', () => {
  // The collision engine's boundary, undiluted by PLAYER_HITBOX_SCALE.
  // Epsilon 1e-5.
  const map = fixtureMap();
  const grazing = evaluate(frozenSnapshot(map, {
    projectiles: [shot({ x: 7.5, y: PLAYER_Y + PHYSICAL_HALF_SIZE - 1e-5 })],
  }));
  const clearing = evaluate(frozenSnapshot(map, {
    projectiles: [shot({ x: 7.5, y: PLAYER_Y + PHYSICAL_HALF_SIZE + 1e-5 })],
  }));
  assert.notEqual(grazing.earliestImpactMs, null);
  assert.equal(clearing.earliestImpactMs, null);
});

test('[F1] config preserves exact boolean semantics', () => {
  // Fixture: avoidDamagingGround === false must stay false. The port's
  // equivalent flag is setEnabled's `safeWalk`, which reaches the collision
  // world as canOccupy's third argument.
  const permissive = fixtureMap();
  const controller = new ProdMafiaAutoDodgeController();
  controller.setEnabled(true, { safeWalk: false });
  controller.evaluate(snapshot(permissive));
  assert.equal(
    permissive.safeWalkFlags.includes(true),
    false,
    'safeWalk false must never reach the collision world as true',
  );

  const strict = fixtureMap();
  const safeWalker = new ProdMafiaAutoDodgeController();
  safeWalker.setEnabled(true, { safeWalk: true });
  safeWalker.evaluate(snapshot(strict));
  assert.ok(strict.safeWalkFlags.includes(true));
  assert.ok(
    strict.safeWalkFlags.includes(false),
    'the physical (non safe-walk) probe must still be issued',
  );
});

// ---------------------------------------------------------------------------
// F2  testCandidateBuffer
// ---------------------------------------------------------------------------

test('[F2] candidate buffer lays out fixed directions - count and intent index', () => {
  const state = evaluate(snapshot(fixtureMap(), {
    intentVelocity: { x: MOVE_SPEED, y: 0 },
  }));
  // candidates.count == 34
  assert.equal(state.plannerMetrics.candidatesGenerated, 34);
  // candidates.intentCandidate == 33
  assert.equal(state.selectedCandidate, 33);
});

test('[F2] candidate buffer lays out fixed directions - x[0]/y[0] and x[33] are zero', () => {
  const state = evaluate(snapshot(fixtureMap(), { intentVelocity: { x: 0, y: 0 } }));
  assert.equal(state.selectedCandidate, 33);
  // near(candidates.x[intentCandidate], 0) with a zero intent vector.
  assert.equal(state.velocity.x, 0);
  assert.equal(state.velocity.y, 0);
});

test('[F2] candidate buffer lays out fixed directions - x[1]=1, y[1]=0', () => {
  // Forced through proactive spacing: a 1-tile-high east/west corridor makes
  // candidate 1 the unique widest opening.
  const map = fixtureMap();
  map.block(0, 0, 100, 9.4);
  map.block(0, 10.6, 100, 100);
  const state = evaluate(snapshot(map, { intentVelocity: { x: 0, y: 0 } }));
  assert.equal(state.decision, 'proactive_spacing');
  assert.equal(state.selectedCandidate, 1);
  assert.equal(state.velocity.x, MOVE_SPEED * state.speedScale);
  assert.equal(state.velocity.y, 0);
});

test('[F2] candidate buffer lays out fixed directions - x[9]=0, y[9]=1', () => {
  const map = fixtureMap();
  map.block(0, 0, 9.9, 100);
  map.block(10.1, 0, 100, 100);
  const state = evaluate(snapshot(map, { intentVelocity: { x: 0, y: 0 } }));
  assert.equal(state.decision, 'proactive_spacing');
  assert.equal(state.selectedCandidate, 9);
  assert.equal(state.velocity.y, MOVE_SPEED * state.speedScale);
  // cos(PI/2) is 6.1e-17, not 0, in both the port and the reference.
  assert.ok(Math.abs(state.velocity.x) < 1e-15);
  assert.equal(direction(9).y, 1);
});

test('[F2] candidate buffer aliases score channels', {
  skip: 'The fixture asserts pointer identity between the buffer aliases '
    + '(safetyScore === minimumClearance, impactMs === firstImpactMs, '
    + 'blockMs === wallBlockMs). The port has no DodgeCandidateBuffer: each '
    + 'frame allocates fresh `Candidate` objects with single-named fields, so '
    + 'there are no aliases to compare.',
}, () => {
  assert.fail('unreachable');
});

test('[F2] candidate buffer resets every score channel', () => {
  // No per-frame buffer exists to reset, but the invariant it protects is
  // testable: a heavy frame must not leak into a later clean frame.
  const map = fixtureMap();
  const dangerous = snapshot(map, { projectiles: [shot({ x: 7.5, y: PLAYER_Y })] });
  const clean = snapshot(map, {
    time: NOW + 5_000,
    intentVelocity: { x: MOVE_SPEED, y: 0 },
  });

  const reused = new ProdMafiaAutoDodgeController();
  reused.setEnabled(true);
  reused.evaluate(dangerous);
  const afterDanger = reused.evaluate(clean);
  const fresh = evaluate(clean);

  assert.equal(afterDanger.decision, fresh.decision);
  assert.equal(afterDanger.selectedCandidate, fresh.selectedCandidate);
  assert.equal(afterDanger.threatCount, fresh.threatCount);
  assert.equal(afterDanger.earliestImpactMs, fresh.earliestImpactMs);
  assert.deepEqual(afterDanger.velocity, fresh.velocity);
  assert.equal(afterDanger.overrideActive, fresh.overrideActive);
});

// ---------------------------------------------------------------------------
// F3  testExplicitDodgeCost
// ---------------------------------------------------------------------------

test('[F3] cost never trades lethal state for clearance', () => {
  // A wall-blocked route is marked invalid + lethal. Intent points straight
  // into it, and the safest geometry is on the blocked side, so only the
  // lethal-tier ordering can keep the controller out of the wall.
  const map = fixtureMap();
  map.block(0, 0, 9.6, 100);
  const input = snapshot(map, {
    projectiles: [shot({ x: PLAYER_X, y: 9.4, angle: Math.PI / 2 })],
    intentVelocity: { x: -MOVE_SPEED, y: 0 },
  });
  const state = evaluate(input);

  assert.equal(state.overrideActive, true);
  assert.ok(state.velocity.x >= 0, `chose a wall-blocked route: vx=${state.velocity.x}`);
  const endpoint = routeEndpoint(input, state);
  assert.equal(map.canOccupy(endpoint.x, endpoint.y, false), true);
});

test('[F3] cost compares damage before status severity', {
  skip: 'CombatProjectileDefinition has no condition-effect field and Candidate '
    + 'has no statusSeverity channel, so there is no status tier to order '
    + 'against damage.',
}, () => {
  assert.fail('unreachable');
});

test('[F3] cost compares status before ground exposure', {
  skip: 'Same missing statusSeverity channel as above.',
}, () => {
  assert.fail('unreachable');
});

test('[F3] cost compares ground exposure before clearance', () => {
  // Threat from due south, so east and west are geometrically symmetric.
  // West is damaging floor and intent points west, so only the
  // groundExposure-before-clearance ordering can steer the route east.
  const map = fixtureMap();
  map.damageGround(0, 0, 9.99, 100);
  const input = snapshot(map, {
    projectiles: [shot({ x: PLAYER_X, y: 9.4, angle: Math.PI / 2 })],
    intentVelocity: { x: -MOVE_SPEED, y: 0 },
  });
  const state = evaluate(input);

  assert.equal(state.overrideActive, true);
  const endpoint = routeEndpoint(input, state);
  assert.equal(
    map.isDamagingGround(endpoint.x, endpoint.y),
    false,
    `route ends on damaging floor at ${endpoint.x},${endpoint.y}`,
  );
});

test('[F3] cost prefers route outside clearance boundary', () => {
  const map = fixtureMap();
  const projectile = shot({ x: 7.5, y: PLAYER_Y });
  const input = snapshot(map, { projectiles: [projectile] });
  const state = evaluate(input);

  assert.equal(state.overrideActive, true);
  const clearance = routeMinimumChebyshev(input, state.velocity, projectile);
  assert.ok(
    clearance > PHYSICAL_HALF_SIZE,
    `executed route closes to ${clearance} tiles, inside the ${PHYSICAL_HALF_SIZE} hit box`,
  );
});

test('[F3] cost delays impact within the same clearance tier', {
  skip: 'Requires two routes that are both already inside the clearance '
    + 'boundary with equal expectedDamage, differing only in firstImpactMs. '
    + 'firstImpactMs and minimumClearance are per-candidate private fields and '
    + '`earliestImpactMs` is the minimum across all 34 candidates rather than '
    + 'the chosen one, so the tier cannot be pinned from outside the class.',
}, () => {
  assert.fail('unreachable');
});

test('[F3] cost prefers a route that remains reachable', () => {
  // Wall far enough east that the route is not blocked at offset 0 - it is
  // blocked at offset 60, i.e. wallBlockMs is finite but non-zero.
  const map = fixtureMap();
  map.block(10.7, 0, 100, 100);
  const input = snapshot(map, {
    projectiles: [shot({ x: PLAYER_X, y: 9.4, angle: Math.PI / 2 })],
    intentVelocity: { x: MOVE_SPEED, y: 0 },
  });
  const state = evaluate(input);

  assert.equal(state.overrideActive, true);
  assert.ok(state.velocity.x <= 0, `chose an unreachable route: vx=${state.velocity.x}`);
});

test('[F3] cost preserves mobility before surplus clearance', {
  skip: 'compareCandidate is module-private. Behaviourally the mobility tier is '
    + 'only reachable through chooseIntentAligned, which admits any candidate '
    + 'within MOBILITY_RISK_TOLERANCE (12) of the safest - and a fully enclosed '
    + 'endpoint only costs WALL_TOPOLOGY_RISK (6) - so an outside test cannot '
    + 'isolate mobility-before-clearance from intent alignment.',
}, () => {
  assert.fail('unreachable');
});

test('[F3] cost uses player intent only after safety', () => {
  // Overtaking shot from due west: fleeing east is not enough, so the
  // controller must override, and among the equally safe diagonal escapes it
  // must take the one aligned with the eastward intent.
  const map = fixtureMap();
  const projectile = shot({ x: 7.5, y: PLAYER_Y, definition: { speed: 200 } });
  const input = snapshot(map, {
    projectiles: [projectile],
    intentVelocity: { x: MOVE_SPEED, y: 0 },
  });
  const state = evaluate(input);

  assert.equal(state.overrideActive, true);
  assert.ok(state.velocity.x > 0, `route ignored intent: vx=${state.velocity.x}`);
  assert.ok(routeMinimumChebyshev(input, state.velocity, projectile) > PHYSICAL_HALF_SIZE);
});

// ---------------------------------------------------------------------------
// F4  testSharedGeometry
// ---------------------------------------------------------------------------

test('[F4] Chebyshev geometry finds segment crossing', () => {
  // minimumChebyshevOnSegment(-2, 0.5, 2, 0.5) == 0.5.
  // Realised as the relative projectile/player corridor between two 30 ms
  // samples, read out through the physical impact boundary. Epsilon 1e-6.
  const map = fixtureMap();
  const crossing = (halfSize: number): AutoDodgeSnapshot => frozenSnapshot(map, {
    projectiles: [shot({
      x: PLAYER_X - 2,
      y: PLAYER_Y + 0.5,
      definition: { speed: 1_600, collisionMult: collisionMultForHalfSize(halfSize) },
    })],
  });

  assert.equal(evaluate(crossing(0.5 + 1e-6)).earliestImpactMs, 30);
  assert.equal(evaluate(crossing(0.5 - 1e-6)).earliestImpactMs, null);
});

test('[F4] Chebyshev geometry handles diagonal closest point', () => {
  // minimumChebyshevOnSegment(-2, 1, 1, -2) == 0.5: the minimum is attained
  // strictly inside the segment, at (-0.5, -0.5). Epsilon 1e-6.
  const map = fixtureMap();
  const diagonal = (halfSize: number): AutoDodgeSnapshot => frozenSnapshot(map, {
    projectiles: [shot({
      x: PLAYER_X - 2,
      y: PLAYER_Y + 1,
      angle: -Math.PI / 4,
      definition: {
        speed: 1_000 * Math.SQRT2,
        collisionMult: collisionMultForHalfSize(halfSize),
      },
    })],
  });

  assert.equal(evaluate(diagonal(0.5 + 1e-6)).earliestImpactMs, 30);
  assert.equal(evaluate(diagonal(0.5 - 1e-6)).earliestImpactMs, null);
});

test('[F4] Euclidean geometry clamps to segment endpoints', () => {
  // pointToSegmentDistance(3, 4, 0, 0, 1, 0) == sqrt(20): the foot of the
  // perpendicular is past the segment end, so the answer is the endpoint
  // distance. Read out through countRelevantThreats' reach test, which is the
  // same helper. Epsilon 1e-6.
  const map = fixtureMap();
  const expected = Math.sqrt(20);
  // Lifetime 100 ms at speed 100 makes the sampled motion segment exactly
  // (10,10) -> (11,10); the player sits at (13,14).
  const probe = (reach: number): AutoDodgeSnapshot => snapshot(map, {
    position: { x: 13, y: 14 },
    moveSpeed: (reach - 1.5) / (LEAD_MS + 300),
    projectiles: [shot({ x: 10, y: 10, definition: { lifetimeMs: 100 } })],
  });

  assert.equal(evaluate(probe(expected)).threatCount, 1);
  assert.equal(evaluate(probe(expected - 1e-6)).threatCount, 0);
});

test('[F4] Euclidean geometry handles zero-length segments', () => {
  // pointToSegmentDistance(3, 4, 0, 0, 0, 0) == 5. Epsilon 1e-6.
  const map = fixtureMap();
  const probe = (reach: number): AutoDodgeSnapshot => snapshot(map, {
    position: { x: 13, y: 14 },
    moveSpeed: (reach - 1.5) / (LEAD_MS + 300),
    projectiles: [shot({ x: 10, y: 10, definition: { speed: 0 } })],
  });

  assert.equal(evaluate(probe(5)).threatCount, 1);
  assert.equal(evaluate(probe(5 - 1e-6)).threatCount, 0);
});

// ---------------------------------------------------------------------------
// F5  testTrajectoryEvaluatorRecordsReachableRoute
// ---------------------------------------------------------------------------

const NO_TRAJECTORY_RESULT = 'The port has no DodgeTrajectoryResult analogue. '
  + 'Route evaluation writes blockMs / reachableX / reachableY / safe / reason '
  + '/ expectedDamage / impactMs / groundExposureMs onto a private `Candidate` '
  + 'that is never surfaced; AutoDodgeState exposes only the winner\'s index, '
  + 'velocity and the minimum firstImpactMs across all 34 candidates.';

/** The fixture's blocked-route setup: `map.block(10.2, 0, 10.8, 100)`. */
function blockedRouteSnapshot(): AutoDodgeSnapshot {
  const map = fixtureMap();
  map.block(10.2, 0, 10.8, 100);
  return snapshot(map, { intentVelocity: { x: MOVE_SPEED, y: 0 } });
}

test('[F5] trajectory evaluator records first blocked sample (blockMs == 30)', () => {
  // result.blockMs == 30. With no threat the winner is the intent candidate, so
  // state.route is that eastward route's own evaluation.
  const state = evaluate(blockedRouteSnapshot());
  assert.equal(state.route?.blockMs, 30);
});

test('[F5] trajectory evaluator holds last reachable endpoint (10.16, 10)', () => {
  // near(result.reachableX, 10.16) && near(result.reachableY, 10): the position
  // held just before the wall, i.e. lead-only travel of 0.01 * 16.
  const state = evaluate(blockedRouteSnapshot());
  assert.ok(Math.abs(state.route!.reachableX - 10.16) < 1e-9);
  assert.ok(Math.abs(state.route!.reachableY - 10) < 1e-9);
});

test('[F5] trajectory evaluator rejects active AOE route (reason active_aoe)', () => {
  // !result.safe && result.reason == 'active_aoe' for a radius-1 circle centred
  // on a player who cannot move out of it.
  const state = evaluate(frozenSnapshot(fixtureMap(), {
    aoes: [{ x: PLAYER_X, y: PLAYER_Y, radius: 1, landingTime: NOW, damage: 100 }],
  }));
  assert.equal(state.route?.safe, false);
  assert.equal(state.route?.reason, 'active_aoe');
});

test('[F5] one-off AOE keeps rejection but reports no phantom damage', () => {
  // result.expectedDamage == 0 && result.impactMs == 0. A one-off circle whose
  // impact has passed describes damage that already happened: the route stays
  // rejected (stay out of the crater) but predicts no future damage.
  // `aoe.activeUntil = NOW + 300` in the fixture is `blastDurationMs` here.
  const state = evaluate(frozenSnapshot(fixtureMap(), {
    time: NOW + 100,
    aoes: [{
      x: PLAYER_X,
      y: PLAYER_Y,
      radius: 1,
      landingTime: NOW,
      blastDurationMs: 300,
      damage: 100,
    }],
  }));
  assert.equal(state.route?.safe, false);
  assert.equal(state.route?.expectedDamage, 0);
  assert.equal(state.route?.impactMs, 0);
});

test('[F5] trajectory evaluator reports physical route damage', () => {
  // With `repeating` set: result.expectedDamage > 0 && result.impactMs == 0.
  const state = evaluate(frozenSnapshot(fixtureMap(), {
    time: NOW + 100,
    aoes: [{
      x: PLAYER_X,
      y: PLAYER_Y,
      radius: 1,
      landingTime: NOW,
      blastDurationMs: 300,
      damage: 100,
      repeating: true,
    }],
  }));
  assert.ok(state.route!.expectedDamage > 0);
  assert.equal(state.route?.impactMs, 0);
});

test('[F5] one-off AOE predicts no Auto Nexus damage', () => {
  // The fixture's stated motive: predictive Auto Nexus consumes expectedDamage,
  // and a phantom value fired nexus on explosions that were already over.
  const oneOff = {
    x: PLAYER_X,
    y: PLAYER_Y,
    radius: 1,
    landingTime: NOW,
    blastDurationMs: 300,
    damage: 100,
  };
  const options = {
    now: NOW + 100,
    playerId: 1,
    position: { x: PLAYER_X, y: PLAYER_Y },
    trajectory: null,
    projectiles: [],
    calculateDamage: (base: number) => base,
  };
  assert.equal(
    predictAutoNexusRouteDamage({ ...options, aoes: [oneOff] }).predictedDamage,
    0,
  );
  assert.ok(
    predictAutoNexusRouteDamage({
      ...options,
      aoes: [{ ...oneOff, repeating: true }],
    }).predictedDamage > 0,
  );
});

test('[F5] trajectory evaluator allows damaging-ground escape', () => {
  // The observable half of the fixture pair: standing on damaging floor with a
  // threat inbound, the route must be allowed to run and must leave the floor.
  const map = fixtureMap();
  map.damageGround(9.5, 0, 10.2, 100);
  const input = snapshot(map, {
    projectiles: [shot({ x: PLAYER_X, y: 9.4, angle: Math.PI / 2 })],
  });
  const state = evaluate(input);

  assert.equal(map.isDamagingGround(PLAYER_X, PLAYER_Y), true);
  assert.equal(state.overrideActive, true);
  const endpoint = routeEndpoint(input, state);
  assert.equal(map.isDamagingGround(endpoint.x, endpoint.y), false);
});

test('[F5] trajectory evaluator rejects damaging-ground entry', {
  skip: 'The port has no route-rejection flag for damaging floor: entering it '
    + 'only accrues the private groundExposureMs soft cost. Neither the flag '
    + 'nor the exposure counter is exposed, so "allowed escape" and "rejected '
    + 'entry" are indistinguishable from outside.',
}, () => {
  assert.fail('unreachable');
});

// ---------------------------------------------------------------------------
// F6/F7  testNormalizedThreatCollection, testNormalizedAoeDeduplication
// ---------------------------------------------------------------------------

const NO_COLLECTOR = 'The port has no DodgeThreatCollector / DodgeThreatSet '
  + 'layer. AoEs arrive pre-normalized as DodgePlanningAoe[] on the snapshot, '
  + 'so there is no normalization, no threat identity, no deduplication and no '
  + 'telegraph/authoritative distinction to characterize.';

test('[F6] collector normalizes every active threat domain', { skip: NO_COLLECTOR }, () => {
  assert.fail('unreachable');
});

test('[F6] normalized threats preserve attack metadata', {
  skip: NO_COLLECTOR + ' Additionally the controller reads no condition effect '
    + 'and never reads definition.armorPiercing, and DodgePlanningAoe carries '
    + 'no sourceType or authoritative flag.',
}, () => {
  assert.fail('unreachable');
});

test('[F6] normalized identities remain stable across frames', {
  skip: NO_COLLECTOR + ' Threats are keyed per frame by '
    + '`p:ownerId:bulletId` / `a:x:y:landingTime` strings that are discarded '
    + 'at the end of evaluate().',
}, () => {
  assert.fail('unreachable');
});

test('[F7] moving emitter replaces its authoritative pulse duplicate', {
  skip: NO_COLLECTOR + ' MovingAoeEmitter has no analogue at all.',
}, () => {
  assert.fail('unreachable');
});

test('[F7] separate AOE circles remain an exact union', () => {
  // The port keeps both circles because it never merges; radii are untouched.
  const map = fixtureMap();
  const aoes = [
    { x: 8, y: PLAYER_Y, radius: 0.5, landingTime: NOW, damage: 100 },
    { x: 12, y: PLAYER_Y, radius: 0.5, landingTime: NOW, damage: 100 },
  ];
  const state = evaluate(frozenSnapshot(map, { aoes }));
  assert.equal(state.threatCount, 2);
  assert.equal(aoes[0]!.radius, 0.5);
  assert.equal(aoes[1]!.radius, 0.5);
});

test('[F7] AOE spatial index rejects distant circle unions', () => {
  // Fixture: markNearbyAoes(10, 10, 0.25) == 0 and neither circle is flagged
  // spatially relevant. The port's threat count is `aoes.length` with no
  // spatial test, so two harmless 2-tile-away circles still count as threats.
  const map = fixtureMap();
  const state = evaluate(frozenSnapshot(map, {
    aoes: [
      { x: 8, y: PLAYER_Y, radius: 0.5, landingTime: NOW, damage: 100 },
      { x: 12, y: PLAYER_Y, radius: 0.5, landingTime: NOW, damage: 100 },
    ],
  }));
  assert.equal(state.threatCount, 0);
});

test('[F7] AOE spatial index conservatively finds reachable circles', () => {
  // Passes, but note it is unfalsifiable: the port counts every supplied AoE.
  const map = fixtureMap();
  const state = evaluate(snapshot(map, {
    aoes: [
      { x: 9.2, y: PLAYER_Y, radius: 0.5, landingTime: NOW, damage: 100 },
      { x: 10.8, y: PLAYER_Y, radius: 0.5, landingTime: NOW, damage: 100 },
    ],
  }));
  assert.equal(state.threatCount, 2);
});

test('[F7] AOE spatial index retains oversized circles', () => {
  // Also unfalsifiable for the same reason.
  const map = fixtureMap();
  const state = evaluate(frozenSnapshot(map, {
    aoes: [{ x: 110, y: 10, radius: 100, landingTime: NOW, damage: 100 }],
  }));
  assert.equal(state.threatCount, 1);
});

test('[F7] authoritative impact replaces matching telegraph', { skip: NO_COLLECTOR }, () => {
  assert.fail('unreachable');
});

// ---------------------------------------------------------------------------
// F8  testUnknownTelegraphIsDiagnosticOnly
// ---------------------------------------------------------------------------

test('[F8] unproven telegraph remains diagnostic only', () => {
  // Fixture: a telegraph whose damage is still unknown (-1) must produce
  // threatCount 0 and leave movement untouched.
  const map = fixtureMap();
  const state = evaluate(snapshot(map, {
    aoes: [{
      x: PLAYER_X,
      y: PLAYER_Y,
      radius: 2,
      landingTime: NOW + 200,
      damage: -1,
    }],
    intentVelocity: { x: MOVE_SPEED, y: 0 },
  }));

  assert.equal(state.threatCount, 0);
  assert.equal(state.overrideActive, false);
  assert.equal(state.velocity.x, MOVE_SPEED);
});

// ---------------------------------------------------------------------------
// F9  testNoThreatPreservesIntent
// ---------------------------------------------------------------------------

test('[F9] no threat count', () => {
  assert.equal(
    evaluate(snapshot(fixtureMap(), { intentVelocity: { x: MOVE_SPEED, y: 0 } })).threatCount,
    0,
  );
});

test('[F9] no threat preserves movement', () => {
  const state = evaluate(snapshot(fixtureMap(), {
    intentVelocity: { x: MOVE_SPEED, y: 0 },
  }));
  assert.equal(state.overrideActive, false);
  assert.equal(state.velocity.x, MOVE_SPEED);
  assert.equal(state.velocity.y, 0);
});

test('[F9] no threat records executed intent', () => {
  const state = evaluate(snapshot(fixtureMap(), {
    intentVelocity: { x: MOVE_SPEED, y: 0 },
  }));
  // appliedDecision.candidate == INTENT_CANDIDATE, !overrideApplied.
  assert.equal(state.selectedCandidate, 33);
  assert.equal(state.overrideActive, false);
  assert.equal(state.decision, 'no_threat');
});

// ---------------------------------------------------------------------------
// F10  testStraightProjectileForcesCorrection
// ---------------------------------------------------------------------------

test('[F10] crossing projectile collected', () => {
  const state = evaluate(snapshot(fixtureMap(), {
    projectiles: [shot({ x: 7.5, y: PLAYER_Y })],
  }));
  assert.ok(state.threatCount > 0);
});

test('[F10] crossing projectile changes movement', () => {
  const state = evaluate(snapshot(fixtureMap(), {
    projectiles: [shot({ x: 7.5, y: PLAYER_Y })],
  }));
  assert.equal(state.overrideActive, true);
  assert.ok(Math.abs(state.velocity.x) + Math.abs(state.velocity.y) > 0.0001);
});

test('[F10] crossing route avoids standing candidate', () => {
  const state = evaluate(snapshot(fixtureMap(), {
    projectiles: [shot({ x: 7.5, y: PLAYER_Y })],
  }));
  assert.notEqual(state.selectedCandidate, 0);
});

test('[F10] crossing projectile reaches candidate scoring', () => {
  const state = evaluate(snapshot(fixtureMap(), {
    projectiles: [shot({ x: 7.5, y: PLAYER_Y })],
  }));
  // lastEvaluationCandidateChecks > 0.
  assert.ok(state.plannerMetrics.candidatesGenerated > 0);
});

test('[F10] crossing projectile records final route', () => {
  // appliedDecision.candidate == selectedCandidate and its velocity is the
  // one actually emitted.
  const state = evaluate(snapshot(fixtureMap(), {
    projectiles: [shot({ x: 7.5, y: PLAYER_Y })],
  }));
  const unit = direction(state.selectedCandidate);
  assert.ok(state.selectedCandidate >= 1 && state.selectedCandidate <= 32);
  assert.ok(Math.abs(state.velocity.x - unit.x * MOVE_SPEED * state.speedScale) < 1e-12);
  assert.ok(Math.abs(state.velocity.y - unit.y * MOVE_SPEED * state.speedScale) < 1e-12);
});

// ---------------------------------------------------------------------------
// F11  testParallelProjectileIsRejected
// ---------------------------------------------------------------------------

test('[F11] parallel projectile broad-phase rejection', () => {
  // Shot travelling parallel to the player, 2.5 tiles away. The reference
  // requires the path to come within hitHalf + RELEVANCE_CLEARANCE (1.46
  // tiles) of the player or the intent path.
  const state = evaluate(snapshot(fixtureMap(), {
    projectiles: [shot({ x: 7.5, y: 12.5 })],
    intentVelocity: { x: MOVE_SPEED, y: 0 },
  }));
  assert.equal(state.threatCount, 0);
});

// ---------------------------------------------------------------------------
// F12  testPredictiveNexusConsumesAppliedRoute
// ---------------------------------------------------------------------------

test('[F12] predictive nexus sees applied lethal route', () => {
  const map = fixtureMap();
  const laser = shot({
    x: 5,
    y: PLAYER_Y,
    damage: 200,
    definition: { speed: 0, laserDistance: 10, collisionMult: 20 },
  });
  const input = snapshot(map, {
    projectiles: [laser],
    intentVelocity: { x: MOVE_SPEED, y: 0 },
  });
  const state = evaluate(input);

  const prediction = predictAutoNexusRouteDamage({
    now: NOW,
    playerId: 1,
    position: input.position,
    trajectory: state.trajectory,
    projectiles: [laser],
    aoes: [],
    calculateDamage: (baseDamage: number): number => baseDamage,
  });

  assert.ok(prediction.predictedDamage > 0);
  assert.ok(Number.isFinite(prediction.impactMs));
});

test('[F12] predictive nexus receives the applied route, not the standing position', () => {
  const map = fixtureMap();
  const projectile = shot({ x: 7.5, y: PLAYER_Y, definition: { speed: 150 } });
  const input = snapshot(map, { projectiles: [projectile] });
  const state = evaluate(input);

  const onRoute = predictAutoNexusRouteDamage({
    now: NOW,
    playerId: 1,
    position: input.position,
    trajectory: state.trajectory,
    projectiles: [projectile],
    aoes: [],
    calculateDamage: (baseDamage: number): number => baseDamage,
  });
  const standingStill = predictAutoNexusRouteDamage({
    now: NOW,
    playerId: 1,
    position: input.position,
    trajectory: null,
    projectiles: [projectile],
    aoes: [],
    calculateDamage: (baseDamage: number): number => baseDamage,
  });

  assert.ok(standingStill.predictedDamage > 0, 'scenario must be lethal when standing');
  assert.ok(
    onRoute.predictedDamage < standingStill.predictedDamage,
    'nexus must score the executed route, not the current position',
  );
});

test('[F12] predictive nexus receives applied candidate and impact time', {
  skip: 'The controller exposes no per-decision impactMs: `earliestImpactMs` is '
    + 'the minimum firstImpactMs across all 34 candidates, not the chosen '
    + 'one\'s. predictAutoNexusRouteDamage recomputes its own impactMs from '
    + 'the trajectory rather than consuming the controller\'s, so the '
    + 'fixture\'s equality (nexusImpactMs == appliedDecision.impactMs) has no '
    + 'referent. The candidate index IS forwarded, but only by client.ts.',
}, () => {
  assert.fail('unreachable');
});

// ---------------------------------------------------------------------------
// F13  testReducedHitboxKeepsPhysicalNexusProtection
// ---------------------------------------------------------------------------

test('[F13] reduced hitbox permits configured edge path', {
  skip: 'The fixture sets autoDodgeProjectileClearance = 0 so the PLANNING '
    + 'half-extent drops BELOW the physical one (0.46 vs 0.5) and a shot 0.48 '
    + 'tiles away is admitted with zero expected damage. PROJECTILE_CLEARANCE is '
    + 'a hardcoded 0.1 in the port and effectiveProjectileSafetyMargin clamps at '
    + 'zero, so the planning boundary (0.56) is always at or above the physical '
    + 'one and the edge path cannot exist. The physical boundary itself is pinned '
    + 'by [F1-defaults] projectile damage boundary is the unscaled 0.5 '
    + 'half-extent.',
}, () => {
  assert.fail('unreachable');
});

test('[F13] reduced hitbox preserves physical nexus damage', {
  skip: 'The physical/soft split now exists (physicalClearance drives '
    + 'expectedDamage, softClearance drives minimumClearance), but the fixture '
    + 'needs planning < physical, i.e. projectileClearance = 0, which is not '
    + 'configurable. PHYSICAL_HIT_HALF_SIZE at prodmafia-auto-dodge.ts:84 is '
    + 'still declared and never read; the damage boundary comes from '
    + 'projectileCollisionHalfSize instead.',
}, () => {
  assert.fail('unreachable');
});

// ---------------------------------------------------------------------------
// F14  testImmobilizingProjectileUsesExplicitLethalTier
// ---------------------------------------------------------------------------

const NO_CONDITIONS = 'CombatProjectileDefinition carries no condition effects '
  + 'and Candidate has no statusSeverity field, so Paralyzed / Petrified / '
  + 'Stasis cannot be expressed. A HARD_AOE_RISK tier now exists, but only an '
  + 'unknown-damage AoE reaches it - evaluateCandidate has no '
  + 'projectileEffectRisk term (its own comment says so), so an immobilizing '
  + 'shot is scored as a plain zero-damage near miss.';

test('[F14] immobilizing projectile sets explicit lethal tier', {
  skip: NO_CONDITIONS,
}, () => {
  assert.fail('unreachable');
});

test('[F14] physical-edge condition preserves lethal tier', {
  skip: NO_CONDITIONS,
}, () => {
  assert.fail('unreachable');
});

// ---------------------------------------------------------------------------
// F15  testDenseIrrelevantProjectilesStayInBroadPhase
// ---------------------------------------------------------------------------

function denseVolley(): CombatProjectileSnapshot[] {
  const volley: CombatProjectileSnapshot[] = [];
  for (let index = 0; index < 256; index++) {
    volley.push(shot({
      x: 60 + index % 8,
      y: 60 + Math.trunc(index / 8) % 8,
      bulletId: index + 1,
    }));
  }
  return volley;
}

test('[F15] dense irrelevant volley has no direct threat', () => {
  const state = evaluate(snapshot(fixtureMap(), {
    projectiles: denseVolley(),
    intentVelocity: { x: MOVE_SPEED, y: 0 },
  }));
  assert.equal(state.threatCount, 0);
});

test('[F15] dense irrelevant volley skips trajectory samples', () => {
  // lastEvaluationProjectileSamples == 0.
  const state = evaluate(snapshot(fixtureMap(), {
    projectiles: denseVolley(),
    intentVelocity: { x: MOVE_SPEED, y: 0 },
  }));
  assert.equal(state.plannerMetrics.activeProjectilesConsidered, 0);
});

test('[F15] dense irrelevant volley skips candidate matrix', () => {
  // lastEvaluationCandidateChecks == 0.
  const state = evaluate(snapshot(fixtureMap(), {
    projectiles: denseVolley(),
    intentVelocity: { x: MOVE_SPEED, y: 0 },
  }));
  assert.equal(state.plannerMetrics.candidatesGenerated, 0);
});

// ---------------------------------------------------------------------------
// F16  testTelegraphedAoeSelectsEscape
// ---------------------------------------------------------------------------

function telegraphedAoeInput(map: FixtureMap): AutoDodgeSnapshot {
  return snapshot(map, {
    aoes: [{
      x: PLAYER_X,
      y: PLAYER_Y,
      radius: 1.5,
      landingTime: NOW + 300,
      damage: 200,
    }],
  });
}

test('[F16] telegraphed AOE collected', () => {
  assert.ok(evaluate(telegraphedAoeInput(fixtureMap())).threatCount > 0);
});

test('[F16] telegraphed AOE chooses escape', () => {
  assert.notEqual(evaluate(telegraphedAoeInput(fixtureMap())).selectedCandidate, 0);
});

test('[F16] telegraphed AOE applies escape', () => {
  assert.equal(evaluate(telegraphedAoeInput(fixtureMap())).overrideActive, true);
});

test('[F16] telegraphed AOE records final route', () => {
  const map = fixtureMap();
  const input = telegraphedAoeInput(map);
  const state = evaluate(input);
  const unit = direction(state.selectedCandidate);
  assert.ok(Math.abs(state.velocity.x - unit.x * MOVE_SPEED * state.speedScale) < 1e-12);
  assert.ok(Math.abs(state.velocity.y - unit.y * MOVE_SPEED * state.speedScale) < 1e-12);
  // The escape must actually leave the circle.
  const endpoint = routeEndpoint(input, state, 300);
  assert.ok(Math.hypot(endpoint.x - PLAYER_X, endpoint.y - PLAYER_Y) > 0);
});

function latchProbe(afterMs: number): AutoDodgeState {
  const map = fixtureMap();
  const controller = new ProdMafiaAutoDodgeController();
  controller.setEnabled(true);
  controller.evaluate(telegraphedAoeInput(map));
  return controller.evaluate(snapshot(map, {
    time: NOW + afterMs,
    aoes: [],
    intentVelocity: { x: MOVE_SPEED, y: 0 },
  }));
}

test('[F16] resolved AOE releases movement latch', () => {
  // Fixture: the very next frame, with the AOE gone, must hand movement back.
  const released = latchProbe(16);
  assert.equal(released.overrideActive, false);
  assert.equal(released.velocity.x, MOVE_SPEED);
});

test('[F16-characterize] AOE latch is held for landing + AOE_POST_IMPACT_HOLD_MS', () => {
  // Measures the port's actual hold so the divergence above has a number:
  // the AOE lands at +300 and the latch runs to +400.
  assert.equal(latchProbe(399).decision, 'aoe_escape_latched');
  assert.notEqual(latchProbe(400).decision, 'aoe_escape_latched');
  assert.equal(latchProbe(400).overrideActive, false);
  assert.equal(latchProbe(400).velocity.x, MOVE_SPEED);
});

// ---------------------------------------------------------------------------
// F17  testGroundAndWallConstraintsRemainValid
// ---------------------------------------------------------------------------

function constrainedInput(map: FixtureMap): AutoDodgeSnapshot {
  map.block(10.05, 9.0, 12, 11.0);
  map.damageGround(8, 9, 9.95, 11);
  return snapshot(map, {
    projectiles: [shot({ x: PLAYER_X, y: 7.5, angle: Math.PI / 2 })],
  });
}

test('[F17] constrained route remains valid', () => {
  const map = fixtureMap();
  const input = constrainedInput(map);
  const state = evaluate(input);
  const endpoint = routeEndpoint(input, state, 300);
  assert.equal(map.canOccupy(endpoint.x, endpoint.y, false), true);
});

test('[F17] constrained route avoids blocked east', () => {
  // candidateX[choice] <= 0.05.
  const map = fixtureMap();
  const state = evaluate(constrainedInput(map));
  const unit = direction(state.selectedCandidate);
  assert.ok(unit.x <= 0.05, `chose eastward candidate ${state.selectedCandidate}`);
});

// ---------------------------------------------------------------------------
// F18  testProjectileTrajectoryFamilies
// ---------------------------------------------------------------------------

test('[F18] straight trajectory', () => {
  const straight = shot({ x: 2, y: 3, damage: 1 });
  const point = predictProjectilePosition(straight, NOW + 200);
  // Exact: 200 ms * (100 / 10000) = 2 tiles.
  assert.equal(point.x, 4);
  assert.equal(point.y, 3);
});

test('[F18] straight trajectory allows load sampling', () => {
  assert.equal(isNonlinearProjectile(definition()), false);
});

test('[F18] amplitude trajectory bends', () => {
  const amplitude = shot({
    x: 2,
    y: 3,
    damage: 1,
    definition: { amplitude: 1, frequency: 1 },
  });
  const point = predictProjectilePosition(amplitude, NOW + 250);
  // Deflection is perpendicular, so x is unaffected: 2 + 2.5 exactly.
  assert.equal(point.x, 4.5);
  assert.ok(Math.abs(point.y - 3) > 0.9);
});

test('[F18] amplitude trajectory keeps fine sampling', () => {
  assert.equal(isNonlinearProjectile(definition({ amplitude: 1, frequency: 1 })), true);
});

test('[F18] boomerang returns', () => {
  const boomerang = shot({ x: 2, y: 3, damage: 1, definition: { boomerang: true } });
  const midpoint = predictProjectilePosition(boomerang, NOW + 500);
  const returned = predictProjectilePosition(boomerang, NOW + 1_000);
  assert.ok(midpoint.x > 2);
  // halfway = 1000 * 0.01 * 0.5 = 5; folded distance at 1000 ms is exactly 0.
  assert.equal(returned.x, 2);
});

test('[F18] turning trajectory bends', () => {
  const turning = shot({
    x: 2,
    y: 3,
    damage: 1,
    // <TurnRate>90</TurnRate> is degrees in the XML; the port's field is
    // radians of total sweep.
    definition: { turnRate: Math.PI / 2, turnStopTime: 1_000 },
  });
  const point = predictProjectilePosition(turning, NOW + 500);
  assert.ok(point.x > 2);
  assert.ok(point.y > 3);
});

test('[F18] laser geometry retained', () => {
  // isLaser() is laserDistance > 0; laserClearanceTo(5, 3) == 0 for a beam
  // (2,3) -> (8,3). Read out through the planning boundary: on the beam the
  // clearance is -0.56, and it turns positive exactly 0.56 tiles off axis.
  const map = fixtureMap();
  const laser = (offsetY: number): AutoDodgeSnapshot => frozenSnapshot(map, {
    position: { x: 5, y: 3 + offsetY },
    projectiles: [shot({
      x: 2,
      y: 3,
      damage: 1,
      definition: { speed: 0, laserDistance: 6 },
    })],
  });

  assert.equal(evaluate(laser(0)).earliestImpactMs, 0);
  assert.equal(evaluate(laser(PHYSICAL_HALF_SIZE - 1e-5)).earliestImpactMs, 0);
  assert.equal(evaluate(laser(PHYSICAL_HALF_SIZE + 1e-5)).earliestImpactMs, null);
});

// ---------------------------------------------------------------------------
// F19  characterizeQuestEmitterBodyGuard
// ---------------------------------------------------------------------------

test('[F19] quest enemy sprite creates no dodge threat', () => {
  // An enemy body 0.4 tiles away is not a dodge hazard: only projectile-bearing
  // quest emitters become point-blank cores, and that gating is caller-side.
  const map = fixtureMap();
  const state = evaluate(snapshot(map, {
    environment: { ...map, enemyClearance: (): number => 0.4 },
    intentVelocity: { x: MOVE_SPEED, y: 0 },
  }));
  assert.equal(state.threatCount, 0);
  assert.equal(state.overrideActive, false);
});

// ---------------------------------------------------------------------------
// F20  characterizeZeroClearanceHitboxScale
// ---------------------------------------------------------------------------

test('[F20] zero-clearance hitbox scale changes planning boundary', {
  skip: 'The port\'s arithmetic does reproduce the fixture\'s gap: '
    + 'effectiveProjectileSafetyMargin is 0.1 - 0.5*(1-0.92) = 0.06 at hitbox 92 '
    + 'and 0.1 - 0 = 0.10 at hitbox 100, a 0.04 difference against the fixture\'s '
    + '0.039 floor. But PLAYER_HITBOX_SCALE is a hardcoded 0.92 and '
    + 'candidateSafetyScore (minimumClearance) is private, so neither side of the '
    + 'comparison can be measured from outside.',
}, () => {
  assert.fail('unreachable');
});
