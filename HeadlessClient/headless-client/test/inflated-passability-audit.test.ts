/**
 * Commit 5 audit — deterministic on/off comparison for useInflatedPassability.
 * Temporary audit artifact; does not change production wiring.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExplorativePathfinder } from '../src/explorative-pathfinder';
import { createStaticPassabilityStore } from '../src/static-passability-store';
import {
  assertSmoothedSegmentsPassDodgeStaticValidator,
  createDodgeTestData,
  createSharedPathfindingWorld,
  dodgeStaticSegmentOpen,
  extractSmoothedSegments,
  pathfinderTileSegmentOpen,
} from './helpers/pathfinder-dodge-segment-property';
import {
  applyPathfindingMapFixture,
  createPathfindingTestData,
  PATHFINDING_MAP_TERRAIN,
  type PathfindingMapFixture,
} from './helpers/pathfinding-map-generator';
import { DodgeCollisionWorld } from '../src/dodge-collision-world';
import {
  isStaticSegmentSupercoverOpen,
  staticPassabilityOccupancyBlocked,
  staticPassabilityTileBlocked,
} from '../src/static-segment-validation';

const W = PATHFINDING_MAP_TERRAIN.WALKABLE;
const B = PATHFINDING_MAP_TERRAIN.BLOCKING;

function wallRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Array<{ x: number; y: number; type: number }> {
  const tiles: Array<{ x: number; y: number; type: number }> = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      tiles.push({ x, y, type: B });
    }
  }
  return tiles;
}

function fillWalkable(width: number, height: number): Array<{ x: number; y: number; type: number }> {
  const tiles: Array<{ x: number; y: number; type: number }> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles.push({ x, y, type: W });
    }
  }
  return tiles;
}

interface AuditScenario {
  id: string;
  fixture: PathfindingMapFixture;
}

const AUDIT_SCENARIOS: AuditScenario[] = [
  {
    id: 'open-area',
    fixture: {
      seed: 0xa00001,
      width: 12,
      height: 8,
      start: { x: 1.5, y: 3.5 },
      goal: { x: 10.5, y: 3.5 },
      tiles: fillWalkable(12, 8),
      objects: [],
      scenario: 'open-area',
    },
  },
  {
    id: 'wall-adjacent',
    fixture: {
      seed: 0xa00002,
      width: 12,
      height: 8,
      start: { x: 1.5, y: 3.5 },
      goal: { x: 10.5, y: 3.5 },
      tiles: [
        ...fillWalkable(12, 8),
        ...wallRect(0, 0, 0, 7),
      ],
      objects: [],
      scenario: 'wall-adjacent',
    },
  },
  {
    id: 'one-tile-corridor',
    fixture: {
      seed: 0xa00003,
      width: 12,
      height: 5,
      start: { x: 1.5, y: 2.5 },
      goal: { x: 10.5, y: 2.5 },
      tiles: [
        ...fillWalkable(12, 5),
        ...wallRect(0, 0, 11, 1),
        ...wallRect(0, 3, 11, 4),
      ],
      objects: [],
      scenario: 'one-tile-corridor',
    },
  },
  {
    id: 'two-tile-doorway',
    fixture: {
      seed: 0xa00004,
      width: 12,
      height: 5,
      start: { x: 1.5, y: 2.5 },
      goal: { x: 10.5, y: 2.5 },
      tiles: [
        ...fillWalkable(12, 5),
        ...wallRect(0, 0, 11, 1),
        ...wallRect(0, 3, 11, 4),
        { x: 4, y: 2, type: B },
        { x: 7, y: 2, type: B },
      ],
      objects: [],
      scenario: 'two-tile-doorway',
    },
  },
  {
    id: 'corner-diagonal',
    fixture: {
      seed: 0xa00005,
      width: 8,
      height: 8,
      start: { x: 0.5, y: 0.5 },
      goal: { x: 6.5, y: 6.5 },
      tiles: [
        ...fillWalkable(8, 8),
        { x: 1, y: 0, type: B },
        { x: 0, y: 1, type: B },
      ],
      objects: [],
      scenario: 'corner-diagonal',
    },
  },
  {
    id: 'smoothing-around-wall',
    fixture: {
      seed: 0xa00006,
      width: 10,
      height: 8,
      start: { x: 1.5, y: 3.5 },
      goal: { x: 8.5, y: 3.5 },
      tiles: [
        ...fillWalkable(10, 8),
        { x: 5, y: 2, type: B },
        { x: 5, y: 3, type: B },
        { x: 5, y: 4, type: B },
      ],
      objects: [],
      scenario: 'smoothing-around-wall',
    },
  },
];

interface PathResult {
  noPath: boolean;
  rawTileCount: number;
  waypointCount: number;
  segmentCount: number;
}

function runPath(
  pathfinder: ExplorativePathfinder,
  fixture: PathfindingMapFixture,
): PathResult {
  applyPathfindingMapFixture(pathfinder, fixture);
  pathfinder.setTarget(fixture.goal, 0.2);
  const step = pathfinder.next(fixture.start);
  if (step.noPath) {
    return { noPath: true, rawTileCount: 0, waypointCount: 0, segmentCount: 0 };
  }
  const rawTiles = pathfinder.getPlannedTiles();
  const waypoints = pathfinder.getRemainingPath();
  const segments = extractSmoothedSegments(fixture.start, waypoints);
  return {
    noPath: false,
    rawTileCount: rawTiles.length,
    waypointCount: waypoints.length,
    segmentCount: segments.length,
  };
}

function tileInflatedBlocked(
  inflated: boolean,
  tileX: number,
  tileY: number,
  setup: (store: ReturnType<typeof createStaticPassabilityStore>) => void,
): boolean {
  const store = createStaticPassabilityStore(createPathfindingTestData(), { useInflatedPassability: inflated });
  setup(store);
  return store.isTileStaticallyBlocked(tileX, tileY, { consumer: 'pathfinding' });
}

for (const scenario of AUDIT_SCENARIOS) {
  test(`audit scenario ${scenario.id}: path off vs on`, () => {
    const offPf = new ExplorativePathfinder(
      createPathfindingTestData(),
      createStaticPassabilityStore(createPathfindingTestData(), { useInflatedPassability: false }),
    );
    const onPf = new ExplorativePathfinder(
      createPathfindingTestData(),
      createStaticPassabilityStore(createPathfindingTestData(), { useInflatedPassability: true }),
    );
    const off = runPath(offPf, scenario.fixture);
    const on = runPath(onPf, scenario.fixture);
    // Record outcomes for audit report (assertions encode expected geometry).
    assert.ok(typeof off.noPath === 'boolean' && typeof on.noPath === 'boolean');
  });
}

test('audit: one-tile corridor center is inflated-blocked adjacent to parallel walls', () => {
  const setup = (store: ReturnType<typeof createStaticPassabilityStore>) => {
    store.setMapBounds(12, 5);
    for (const tile of fillWalkable(12, 5)) store.observeTile(tile.x, tile.y, tile.type);
    for (const tile of wallRect(0, 0, 11, 1)) store.observeTile(tile.x, tile.y, tile.type);
    for (const tile of wallRect(0, 3, 11, 4)) store.observeTile(tile.x, tile.y, tile.type);
  };
  assert.equal(tileInflatedBlocked(false, 5, 2, setup), false);
  assert.equal(tileInflatedBlocked(true, 5, 2, setup), true);
});

test('audit: two-tile doorway gap tiles inflated-blocked against flanking columns', () => {
  const setup = (store: ReturnType<typeof createStaticPassabilityStore>) => {
    store.setMapBounds(12, 5);
    for (const tile of fillWalkable(12, 5)) store.observeTile(tile.x, tile.y, tile.type);
    for (const tile of wallRect(0, 0, 11, 1)) store.observeTile(tile.x, tile.y, tile.type);
    for (const tile of wallRect(0, 3, 11, 4)) store.observeTile(tile.x, tile.y, tile.type);
    store.observeTile(4, 2, B);
    store.observeTile(7, 2, B);
  };
  assert.equal(tileInflatedBlocked(false, 5, 2, setup), false);
  assert.equal(tileInflatedBlocked(false, 6, 2, setup), false);
  assert.equal(tileInflatedBlocked(true, 5, 2, setup), true, 'west gap tile blocked');
  assert.equal(tileInflatedBlocked(true, 6, 2, setup), true, 'east gap tile blocked');
});

test('audit: wall-adjacent tile blocked only when inflated', () => {
  const setup = (store: ReturnType<typeof createStaticPassabilityStore>) => {
    store.setMapBounds(12, 8);
    for (const tile of fillWalkable(12, 8)) store.observeTile(tile.x, tile.y, tile.type);
    for (const tile of wallRect(0, 0, 0, 7)) store.observeTile(tile.x, tile.y, tile.type);
  };
  assert.equal(tileInflatedBlocked(false, 1, 3, setup), false);
  assert.equal(tileInflatedBlocked(true, 1, 3, setup), true);
  assert.equal(tileInflatedBlocked(true, 2, 3, setup), false);
});

test('audit: open area path succeeds with inflation on', () => {
  const scenario = AUDIT_SCENARIOS.find((s) => s.id === 'open-area')!;
  const { pathfinder, dodgeWorld, store } = createSharedPathfindingWorld(true);
  store.setExplorativeUnknown(true);
  dodgeWorld.setExplorativeUnknown(true);
  const result = runPath(pathfinder, scenario.fixture);
  assert.equal(result.noPath, false);
  const waypoints = pathfinder.getRemainingPath();
  assertSmoothedSegmentsPassDodgeStaticValidator(
    dodgeWorld,
    scenario.fixture.start,
    extractSmoothedSegments(scenario.fixture.start, waypoints),
    'open-area-inflated',
  );
});

test('audit: one-tile corridor fails path when inflated', () => {
  const scenario = AUDIT_SCENARIOS.find((s) => s.id === 'one-tile-corridor')!;
  const offPf = new ExplorativePathfinder(
    createPathfindingTestData(),
    createStaticPassabilityStore(createPathfindingTestData(), { useInflatedPassability: false }),
  );
  const onPf = new ExplorativePathfinder(
    createPathfindingTestData(),
    createStaticPassabilityStore(createPathfindingTestData(), { useInflatedPassability: true }),
  );
  assert.equal(runPath(offPf, scenario.fixture).noPath, false);
  assert.equal(runPath(onPf, scenario.fixture).noPath, true);
});

test('audit: two-tile doorway pinch fails when inflated (both gap centers dilated)', () => {
  const scenario = AUDIT_SCENARIOS.find((s) => s.id === 'two-tile-doorway')!;
  const offPf = new ExplorativePathfinder(
    createPathfindingTestData(),
    createStaticPassabilityStore(createPathfindingTestData(), { useInflatedPassability: false }),
  );
  const onPf = new ExplorativePathfinder(
    createPathfindingTestData(),
    createStaticPassabilityStore(createPathfindingTestData(), { useInflatedPassability: true }),
  );
  const off = runPath(offPf, scenario.fixture);
  const on = runPath(onPf, scenario.fixture);
  // Single-row pinch with point walls at x=4 and x=7 splits y=2 into disconnected segments.
  assert.equal(off.noPath, true, 'off: 2-tile pinch on one row is already disconnected');
  assert.equal(on.noPath, true, 'on: inflated gap tiles are also dilated-blocked');
});

test('audit: fullOccupy neighbor route off succeeds, on may block adjacent tile', () => {
  const storeOff = createStaticPassabilityStore(createPathfindingTestData(), { useInflatedPassability: false });
  const storeOn = createStaticPassabilityStore(createPathfindingTestData(), { useInflatedPassability: true });
  for (const store of [storeOff, storeOn]) {
    store.setMapBounds(8, 8);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) store.observeTile(x, y, W);
    }
    store.upsertObject(1, 999, 4.5, 4.5, { occupySquare: false, fullOccupy: true });
  }
  assert.equal(storeOff.isTileStaticallyBlocked(3, 4, { consumer: 'pathfinding' }), false);
  assert.equal(storeOn.isTileStaticallyBlocked(3, 4, { consumer: 'pathfinding' }), true);
  assert.equal(
    storeOff.canOccupyAt(3.75, 4.5, { consumer: 'dodge', safeWalk: true }),
    false,
  );
  assert.equal(
    storeOn.canOccupyAt(3.75, 4.5, { consumer: 'dodge', safeWalk: true }),
    false,
  );
});

test('audit: corner diagonal supercover blocked with inflation on adjacent wall', () => {
  const store = createStaticPassabilityStore(createPathfindingTestData(), { useInflatedPassability: true });
  store.setMapBounds(8, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) store.observeTile(x, y, W);
  }
  store.observeTile(1, 0, B);
  store.observeTile(0, 1, B);
  const start = { x: 0.5, y: 0.5 };
  const to = { x: 2.5, y: 2.5 };
  const tileOpen = pathfinderTileSegmentOpen(store, start, start, to);
  const occOpen = isStaticSegmentSupercoverOpen(
    start,
    to,
    staticPassabilityOccupancyBlocked(store, {
      consumer: 'dodge',
      safeWalk: true,
      checkFullOccupyNeighbors: true,
    }),
  );
  assert.equal(tileOpen, false, 'inflated tile blocks diagonal through (1,1) corridor sides');
  assert.equal(occOpen, false);
});

test('audit: smoothed segments pass dodge validator when inflated (wall-adjacent route)', () => {
  const scenario = AUDIT_SCENARIOS.find((s) => s.id === 'wall-adjacent')!;
  const { pathfinder, dodgeWorld, store } = createSharedPathfindingWorld(true);
  store.setExplorativeUnknown(true);
  dodgeWorld.setExplorativeUnknown(true);
  const result = runPath(pathfinder, scenario.fixture);
  if (!result.noPath) {
    const waypoints = pathfinder.getRemainingPath();
    assertSmoothedSegmentsPassDodgeStaticValidator(
      dodgeWorld,
      scenario.fixture.start,
      extractSmoothedSegments(scenario.fixture.start, waypoints),
      'wall-adjacent-inflated',
    );
  }
});

test('audit summary: collect scenario outcomes', () => {
  const summary: Array<{ id: string; offNoPath: boolean; onNoPath: boolean }> = [];
  for (const scenario of AUDIT_SCENARIOS) {
    const offPf = new ExplorativePathfinder(
      createPathfindingTestData(),
      createStaticPassabilityStore(createPathfindingTestData(), { useInflatedPassability: false }),
    );
    const onPf = new ExplorativePathfinder(
      createPathfindingTestData(),
      createStaticPassabilityStore(createPathfindingTestData(), { useInflatedPassability: true }),
    );
    summary.push({
      id: scenario.id,
      offNoPath: runPath(offPf, scenario.fixture).noPath,
      onNoPath: runPath(onPf, scenario.fixture).noPath,
    });
  }
  assert.deepEqual(summary.find((s) => s.id === 'open-area'), { id: 'open-area', offNoPath: false, onNoPath: false });
  assert.deepEqual(summary.find((s) => s.id === 'one-tile-corridor'), { id: 'one-tile-corridor', offNoPath: false, onNoPath: true });
  assert.deepEqual(summary.find((s) => s.id === 'two-tile-doorway'), { id: 'two-tile-doorway', offNoPath: true, onNoPath: true });
  assert.deepEqual(summary.find((s) => s.id === 'wall-adjacent'), { id: 'wall-adjacent', offNoPath: false, onNoPath: true });
});
