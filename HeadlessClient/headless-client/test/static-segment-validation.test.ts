import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isStaticSegmentSupercoverOpen,
  segmentMidpointInTile,
  segmentOccupancySampleInTile,
  staticPassabilityOccupancyBlocked,
  staticPassabilityTileBlocked,
  traceStaticSegmentSupercover,
} from '../src/static-segment-validation';
import { createStaticPassabilityStore } from '../src/static-passability-store';

const BLOCKING_GROUND = 9;
const testData = {
  tileIsBlockingWalk: (type: number) => type === BLOCKING_GROUND,
};

function tileBlocked(blocked: ReadonlySet<string>) {
  return (tileX: number, tileY: number) => blocked.has(`${tileX},${tileY}`);
}

test('segmentMidpointInTile returns a point inside the tile for diagonal segments', () => {
  const sample = segmentMidpointInTile({ x: 0.5, y: 0.5 }, { x: 2.5, y: 2.5 }, 1, 1);
  assert.ok(sample.x >= 1 && sample.x <= 2);
  assert.ok(sample.y >= 1 && sample.y <= 2);
});

test('supercover allows axis-aligned segments through open tiles', () => {
  const blocked = tileBlocked(new Set(['2,1']));
  assert.equal(
    isStaticSegmentSupercoverOpen({ x: 0.5, y: 0.5 }, { x: 3.5, y: 0.5 }, blocked),
    true,
  );
  const trace = traceStaticSegmentSupercover({ x: 0.5, y: 0.5 }, { x: 3.5, y: 0.5 }, blocked)!;
  assert.deepEqual(trace.travelTiles, [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
  ]);
});

test('segmentOccupancySampleInTile falls back to tile center for corridor side tiles', () => {
  const from = { x: 0.5, y: 0.5 };
  const to = { x: 2.5, y: 2.5 };
  const sideSample = segmentOccupancySampleInTile(from, to, 1, 0);
  assert.equal(sideSample.x, 1.5);
  assert.equal(sideSample.y, 0.5);
  const travelSample = segmentOccupancySampleInTile(from, to, 1, 1);
  assert.equal(Math.floor(travelSample.x), 1);
  assert.equal(Math.floor(travelSample.y), 1);
});

test('occupancy supercover rejects diagonal corner-cutting through blocked corners', () => {
  const store = createStaticPassabilityStore(testData);
  store.setMapBounds(6, 6);
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 6; x++) store.observeTile(x, y, 1);
  }
  store.observeTile(1, 0, BLOCKING_GROUND);
  const isBlocked = staticPassabilityOccupancyBlocked(store, {
    consumer: 'dodge',
    safeWalk: true,
    checkFullOccupyNeighbors: true,
  });
  assert.equal(
    isStaticSegmentSupercoverOpen({ x: 0.5, y: 0.5 }, { x: 2.5, y: 2.5 }, isBlocked),
    false,
  );
});

test('supercover rejects diagonal corner-cutting through blocked corners', () => {
  const blocked = tileBlocked(new Set(['1,0']));
  assert.equal(
    isStaticSegmentSupercoverOpen({ x: 0.5, y: 1.5 }, { x: 2.5, y: 0.5 }, blocked),
    false,
  );
  assert.equal(
    isStaticSegmentSupercoverOpen({ x: 0.5, y: 0.5 }, { x: 2.5, y: 2.5 }, blocked),
    false,
  );
});

test('supercover allows diagonal movement when corner-adjacent tiles are open', () => {
  const blocked = tileBlocked(new Set(['3,3']));
  assert.equal(
    isStaticSegmentSupercoverOpen({ x: 0.5, y: 0.5 }, { x: 2.5, y: 2.5 }, blocked),
    true,
  );
  const trace = traceStaticSegmentSupercover({ x: 0.5, y: 0.5 }, { x: 2.5, y: 2.5 }, blocked)!;
  assert.ok(trace.corridorTiles.some((tile) => tile.x === 1 && tile.y === 0));
  assert.ok(trace.corridorTiles.some((tile) => tile.x === 0 && tile.y === 1));
});

test('supercover rejects segments starting on a blocked tile', () => {
  const blocked = tileBlocked(new Set(['0,0']));
  assert.equal(
    isStaticSegmentSupercoverOpen({ x: 0.5, y: 0.5 }, { x: 2.5, y: 0.5 }, blocked),
    false,
  );
});

test('staticPassabilityTileBlocked respects start-tile exemption', () => {
  const store = createStaticPassabilityStore(testData);
  store.setMapBounds(4, 4);
  store.observeTile(0, 0, BLOCKING_GROUND);
  const isBlocked = staticPassabilityTileBlocked(store, {
    consumer: 'pathfinding',
    exemptTile: { x: 0, y: 0 },
  });
  assert.equal(isBlocked(0, 0, { x: 0.5, y: 0.5 }, { x: 2.5, y: 0.5 }), false);
  assert.equal(isBlocked(1, 0, { x: 0.5, y: 0.5 }, { x: 2.5, y: 0.5 }), false);
});

test('staticPassabilityTileBlocked with inflated passability blocks dilated neighbors', () => {
  const store = createStaticPassabilityStore(testData, { useInflatedPassability: true });
  store.setMapBounds(6, 6);
  store.observeTile(3, 2, BLOCKING_GROUND);
  const isBlocked = staticPassabilityTileBlocked(store, { consumer: 'pathfinding' });
  assert.equal(isBlocked(2, 2, { x: 0.5, y: 2.5 }, { x: 4.5, y: 2.5 }), true);
  assert.equal(isBlocked(4, 2, { x: 0.5, y: 2.5 }, { x: 4.5, y: 2.5 }), true);
  assert.equal(isBlocked(1, 2, { x: 0.5, y: 2.5 }, { x: 4.5, y: 2.5 }), false);
});

test('staticPassabilityOccupancyBlocked matches canOccupyAt along the segment sample', () => {
  const store = createStaticPassabilityStore(undefined);
  store.setMapBounds(6, 6);
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 6; x++) store.observeTile(x, y, 1);
  }
  store.upsertObject(1, 0, 4, 4, { occupySquare: false, fullOccupy: true });
  const isBlocked = staticPassabilityOccupancyBlocked(store, {
    consumer: 'dodge',
    safeWalk: true,
    checkFullOccupyNeighbors: true,
  });
  const blockedFrom = { x: 3.6, y: 4.5 };
  const blockedTo = { x: 4.1, y: 4.5 };
  const openFrom = { x: 4.2, y: 4.5 };
  const openTo = { x: 4.8, y: 4.5 };
  const blockedSample = segmentMidpointInTile(blockedFrom, blockedTo, 3, 4);
  const openSample = segmentMidpointInTile(openFrom, openTo, 4, 4);
  assert.equal(
    isBlocked(3, 4, blockedFrom, blockedTo),
    !store.canOccupyAt(blockedSample.x, blockedSample.y, {
      consumer: 'dodge',
      safeWalk: true,
      checkFullOccupyNeighbors: true,
    }),
  );
  assert.equal(
    isBlocked(4, 4, openFrom, openTo),
    !store.canOccupyAt(openSample.x, openSample.y, {
      consumer: 'dodge',
      safeWalk: true,
      checkFullOccupyNeighbors: true,
    }),
  );
});

test('traceStaticSegmentSupercover returns undefined when a mid-segment tile is blocked', () => {
  const blocked = tileBlocked(new Set(['1,0']));
  assert.equal(
    traceStaticSegmentSupercover({ x: 0.5, y: 0.5 }, { x: 2.5, y: 0.5 }, blocked),
    undefined,
  );
});
