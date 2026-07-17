import assert from 'node:assert/strict';
import type { CombatDataProvider } from '../../src/combat-tracker';
import { DodgeCollisionWorld } from '../../src/dodge-collision-world';
import { ExplorativePathfinder } from '../../src/explorative-pathfinder';
import type { StaticPassabilityStore } from '../../src/static-passability-model';
import { createStaticPassabilityStore } from '../../src/static-passability-store';
import {
  isStaticSegmentSupercoverOpen,
  segmentOccupancySampleInTile,
  staticPassabilityTileBlocked,
  type StaticSegmentPoint,
} from '../../src/static-segment-validation';
import {
  applyPathfindingMapFixture,
  createPathfindingTestData,
  generatePathfindingMap,
  PATHFINDING_MAP_OBJECTS,
  PATHFINDING_MAP_TERRAIN,
  type PathfindingMapFixture,
} from './pathfinding-map-generator';

/** Step 5.5 — deterministic cross-layer property test seed base. */
export const PROPERTY_TEST_SEED_BASE = 0x55_050001;
export const PROPERTY_CASE_COUNT = 24;
export const MAP_GENERATOR_OPTIONS = {
  width: 32,
  height: 24,
  blockDensity: 0.15,
  objectDensity: 0.04,
  damagingDensity: 0,
} as const;

export interface SmoothedSegment {
  from: StaticSegmentPoint;
  to: StaticSegmentPoint;
}

export function derivePropertyCaseSeed(
  baseSeed: number,
  caseIndex: number,
  inflatedPassability: boolean,
): number {
  const flagSalt = inflatedPassability ? 0x1n : 0x0n;
  return Number((BigInt(baseSeed)
    + BigInt(Math.imul(caseIndex + 1, 0x9e37_79b9))
    + flagSalt) & 0xffff_ffffn);
}

function hasOpenNeighbor(
  tileX: number,
  tileY: number,
  blocked: (x: number, y: number) => boolean,
): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (!blocked(tileX + dx + 0.5, tileY + dy + 0.5)) return true;
    }
  }
  return false;
}

/** Mirrors DodgeTrajectoryPlanner.createCollisionQuery blocked() without a snapshot. */
export function createDodgeStaticBlockedChecker(
  dodgeWorld: DodgeCollisionWorld,
  startPosition: StaticSegmentPoint,
): (x: number, y: number) => boolean {
  const startTileX = Math.floor(startPosition.x);
  const startTileY = Math.floor(startPosition.y);
  const isStartingTile = (x: number, y: number): boolean =>
    Math.floor(x) === startTileX && Math.floor(y) === startTileY;
  const rawBlocked = (x: number, y: number): boolean =>
    !dodgeWorld.canOccupy(x, y, true, false);
  const allowStartingTile = rawBlocked(startPosition.x, startPosition.y)
    && hasOpenNeighbor(startTileX, startTileY, rawBlocked);
  return (x, y) => rawBlocked(x, y) && !(allowStartingTile && isStartingTile(x, y));
}

export function dodgeStaticSegmentOpen(
  dodgeWorld: DodgeCollisionWorld,
  startPosition: StaticSegmentPoint,
  from: StaticSegmentPoint,
  to: StaticSegmentPoint,
): boolean {
  const blocked = createDodgeStaticBlockedChecker(dodgeWorld, startPosition);
  const isTileBlocked = (
    tileX: number,
    tileY: number,
    segmentFrom: StaticSegmentPoint,
    segmentTo: StaticSegmentPoint,
  ): boolean => {
    const sample = segmentOccupancySampleInTile(segmentFrom, segmentTo, tileX, tileY);
    return blocked(sample.x, sample.y);
  };
  return isStaticSegmentSupercoverOpen(from, to, isTileBlocked);
}

/**
 * Mirrors ExplorativePathfinder.traceSegment static blocking (tile-level predicate,
 * no segment-midpoint occupancy sampling).
 */
export function pathfinderTileSegmentOpen(
  store: StaticPassabilityStore,
  startPosition: StaticSegmentPoint,
  from: StaticSegmentPoint,
  to: StaticSegmentPoint,
): boolean {
  const exemptTile = {
    x: Math.floor(startPosition.x),
    y: Math.floor(startPosition.y),
  };
  return isStaticSegmentSupercoverOpen(
    from,
    to,
    staticPassabilityTileBlocked(store, {
      consumer: 'pathfinding',
      exemptTile,
    }),
  );
}

export function extractSmoothedSegments(
  start: StaticSegmentPoint,
  waypoints: ReadonlyArray<StaticSegmentPoint>,
): SmoothedSegment[] {
  if (waypoints.length === 0) return [];
  const points = [start, ...waypoints];
  const segments: SmoothedSegment[] = [];
  for (let index = 1; index < points.length; index++) {
    segments.push({ from: points[index - 1]!, to: points[index]! });
  }
  return segments;
}

export function createDodgeTestData(): CombatDataProvider {
  return {
    getObject: (type) => type === PATHFINDING_MAP_OBJECTS.BLOCKING
      ? { isEnemy: false, occupySquare: true }
      : type === PATHFINDING_MAP_OBJECTS.NON_BLOCKING_ENEMY
        ? { isEnemy: true, occupySquare: false, hasProjectiles: true }
        : undefined,
    getProjectile: () => undefined,
    tileIsBlockingWalk: (type) => type === PATHFINDING_MAP_TERRAIN.BLOCKING,
    getTileDamage: (type) => type === PATHFINDING_MAP_TERRAIN.DAMAGING ? 100 : undefined,
  };
}

export function createSharedPathfindingWorld(useInflatedPassability: boolean): {
  pathfinder: ExplorativePathfinder;
  dodgeWorld: DodgeCollisionWorld;
  store: StaticPassabilityStore;
} {
  const pathfindingData = createPathfindingTestData();
  const dodgeData = createDodgeTestData();
  const store = createStaticPassabilityStore(pathfindingData, { useInflatedPassability });
  const pathfinder = new ExplorativePathfinder(pathfindingData, store);
  const dodgeWorld = new DodgeCollisionWorld(dodgeData, store);
  return { pathfinder, dodgeWorld, store };
}

export function runPathfinderWithSmoothing(
  pathfinder: ExplorativePathfinder,
  store: StaticPassabilityStore,
  dodgeWorld: DodgeCollisionWorld,
  fixture: PathfindingMapFixture,
): { segments: SmoothedSegment[]; noPath: boolean } {
  applyPathfindingMapFixture(pathfinder, fixture);
  pathfinder.setTarget(fixture.goal, 0.2);
  store.setExplorativeUnknown(true);
  dodgeWorld.setExplorativeUnknown(true);

  const step = pathfinder.next(fixture.start);
  if (step.noPath) {
    return { segments: [], noPath: true };
  }

  const waypoints = pathfinder.getRemainingPath();
  return {
    segments: extractSmoothedSegments(fixture.start, waypoints),
    noPath: false,
  };
}

export function assertSmoothedSegmentsPassDodgeStaticValidator(
  dodgeWorld: DodgeCollisionWorld,
  startPosition: StaticSegmentPoint,
  segments: ReadonlyArray<SmoothedSegment>,
  label: string,
): void {
  for (const [index, segment] of segments.entries()) {
    assert.equal(
      dodgeStaticSegmentOpen(dodgeWorld, startPosition, segment.from, segment.to),
      true,
      `${label} segment ${index} (${segment.from.x},${segment.from.y})→(${segment.to.x},${segment.to.y})`,
    );
  }
}

export function runPropertyCase(seed: number, useInflatedPassability: boolean): void {
  const fixture = generatePathfindingMap({
    ...MAP_GENERATOR_OPTIONS,
    seed,
  });
  const label = `seed=${seed} inflated=${useInflatedPassability}`;
  const { pathfinder, dodgeWorld, store } = createSharedPathfindingWorld(useInflatedPassability);
  const result = runPathfinderWithSmoothing(pathfinder, store, dodgeWorld, fixture);

  if (result.noPath) return;

  assert.ok(
    result.segments.length > 0,
    `${label} found a path but produced no smoothed segments`,
  );
  assertSmoothedSegmentsPassDodgeStaticValidator(
    dodgeWorld,
    fixture.start,
    result.segments,
    label,
  );
}
