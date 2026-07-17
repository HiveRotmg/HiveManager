import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStaticPassabilityStore } from '../src/static-passability-store';
import {
  assertSmoothedSegmentsPassDodgeStaticValidator,
  createDodgeTestData,
  createSharedPathfindingWorld,
  dodgeStaticSegmentOpen,
  pathfinderTileSegmentOpen,
  type SmoothedSegment,
} from './helpers/pathfinder-dodge-segment-property';
import { DodgeCollisionWorld } from '../src/dodge-collision-world';
import { PATHFINDING_MAP_TERRAIN } from './helpers/pathfinding-map-generator';

interface InjectedDisagreement {
  name: string;
  useInflatedPassability: boolean;
  start: { x: number; y: number };
  segment: SmoothedSegment;
  setup: (store: ReturnType<typeof createStaticPassabilityStore>) => void;
}

/**
 * Step 5.6 — Metatest for the Commit 5.5 property assertion.
 *
 * Each case constructs a segment that pathfinder tile validation accepts while
 * dodge occupancy sampling rejects, then verifies assertSmoothedSegmentsPassDodgeStaticValidator
 * fails (throws AssertionError). If it passes, the property test has a gap.
 */
const INJECTED_DISAGREEMENTS: InjectedDisagreement[] = [
  {
    name: 'fullOccupy neighbor: pathfinder tile open, dodge occupancy blocked',
    useInflatedPassability: false,
    start: { x: 0.5, y: 0.5 },
    segment: { from: { x: 1.6, y: 1.5 }, to: { x: 2.1, y: 1.5 } },
    setup(store) {
      store.setMapBounds(6, 6);
      for (let y = 0; y < 6; y++) {
        for (let x = 0; x < 6; x++) {
          store.observeTile(x, y, 1);
        }
      }
      store.upsertObject(1, 0, 2, 1, { occupySquare: false, fullOccupy: true });
    },
  },
  {
    name: 'corner-cut diagonal: bypass pathfinder supercover corridor check',
    useInflatedPassability: false,
    start: { x: 0.5, y: 0.5 },
    segment: { from: { x: 0.5, y: 0.5 }, to: { x: 2.5, y: 2.5 } },
    setup(store) {
      store.setMapBounds(6, 6);
      for (let y = 0; y < 6; y++) {
        for (let x = 0; x < 6; x++) {
          store.observeTile(x, y, 1);
        }
      }
      // Blocks supercover corridor side (1,0) but not diagonal travel tile (1,1).
      store.observeTile(1, 0, PATHFINDING_MAP_TERRAIN.BLOCKING);
    },
  },
];

function pathfinderBypassSupercoverSegmentOpen(
  store: ReturnType<typeof createStaticPassabilityStore>,
  start: { x: number; y: number },
  from: { x: number; y: number },
  to: { x: number; y: number },
): boolean {
  const exemptTile = { x: Math.floor(start.x), y: Math.floor(start.y) };
  const isTileBlocked = (
    tileX: number,
    tileY: number,
  ): boolean => store.isTileStaticallyBlocked(tileX, tileY, {
    consumer: 'pathfinding',
    exemptTile,
  });

  let cellX = Math.floor(from.x);
  let cellY = Math.floor(from.y);
  const endX = Math.floor(to.x);
  const endY = Math.floor(to.y);
  if (isTileBlocked(cellX, cellY)) return false;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / dx);
  const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / dy);
  let tMaxX = stepX > 0
    ? (cellX + 1 - from.x) / dx
    : stepX < 0 ? (from.x - cellX) / -dx : Infinity;
  let tMaxY = stepY > 0
    ? (cellY + 1 - from.y) / dy
    : stepY < 0 ? (from.y - cellY) / -dy : Infinity;

  while (cellX !== endX || cellY !== endY) {
    if (Math.abs(tMaxX - tMaxY) <= 1e-10) {
      cellX += stepX;
      cellY += stepY;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    } else if (tMaxX < tMaxY) {
      cellX += stepX;
      tMaxX += tDeltaX;
    } else {
      cellY += stepY;
      tMaxY += tDeltaY;
    }
    if (isTileBlocked(cellX, cellY)) return false;
  }
  return true;
}

function createWorldForInjection(
  useInflatedPassability: boolean,
  setup: InjectedDisagreement['setup'],
): { dodgeWorld: DodgeCollisionWorld; store: ReturnType<typeof createStaticPassabilityStore> } {
  const pathfindingData = {
    tileIsBlockingWalk: (type: number) => type === PATHFINDING_MAP_TERRAIN.BLOCKING,
  };
  const store = createStaticPassabilityStore(pathfindingData, { useInflatedPassability });
  setup(store);
  store.setExplorativeUnknown(true);
  const dodgeWorld = new DodgeCollisionWorld(createDodgeTestData(), store);
  dodgeWorld.setExplorativeUnknown(true);
  return { dodgeWorld, store };
}

for (const disagreement of INJECTED_DISAGREEMENTS) {
  test(`metatest catches injected disagreement: ${disagreement.name}`, () => {
    const { dodgeWorld, store } = createWorldForInjection(
      disagreement.useInflatedPassability,
      disagreement.setup,
    );
    const { start, segment } = disagreement;

    const pathfinderAccepts = disagreement.name.includes('corner-cut')
      ? pathfinderBypassSupercoverSegmentOpen(store, start, segment.from, segment.to)
      : pathfinderTileSegmentOpen(store, start, segment.from, segment.to);
    const dodgeRejects = !dodgeStaticSegmentOpen(dodgeWorld, start, segment.from, segment.to);

    assert.equal(
      pathfinderAccepts,
      true,
      'injected case must be accepted by pathfinder-side validation',
    );
    assert.equal(
      dodgeRejects,
      true,
      'injected case must be rejected by dodge static validator',
    );

    assert.throws(
      () => assertSmoothedSegmentsPassDodgeStaticValidator(
        dodgeWorld,
        start,
        [segment],
        'injected-disagreement',
      ),
      assert.AssertionError,
      'property assertion must fail when pathfinder and dodge disagree',
    );
  });
}

test('metatest: shared world factory produces no false disagreement on valid segments', () => {
  const { dodgeWorld, store } = createSharedPathfindingWorld(false);
  store.setMapBounds(6, 6);
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 6; x++) {
      store.observeTile(x, y, 1);
    }
  }
  store.setExplorativeUnknown(true);
  dodgeWorld.setExplorativeUnknown(true);

  const start = { x: 0.5, y: 0.5 };
  const segment: SmoothedSegment = { from: { x: 0.5, y: 0.5 }, to: { x: 3.5, y: 0.5 } };

  assert.equal(pathfinderTileSegmentOpen(store, start, segment.from, segment.to), true);
  assert.equal(dodgeStaticSegmentOpen(dodgeWorld, start, segment.from, segment.to), true);
  assert.doesNotThrow(() => assertSmoothedSegmentsPassDodgeStaticValidator(
    dodgeWorld,
    start,
    [segment],
    'sanity-open-segment',
  ));
});
