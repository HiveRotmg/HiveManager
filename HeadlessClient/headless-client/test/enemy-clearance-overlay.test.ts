import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ENEMY_AVOID_RADIUS,
  EnemyClearanceOverlay,
  pointViolatesCircularExclusion,
  segmentClearsCircle,
} from '../src/enemy-clearance-overlay';

test('enemy overlay bumps revision on membership and position changes only', () => {
  const overlay = new EnemyClearanceOverlay();
  assert.equal(overlay.getRevision(), 0);

  overlay.set(1, { x: 5.5, y: 5.5 });
  assert.equal(overlay.getRevision(), 1);
  overlay.set(1, { x: 5.5, y: 5.5 });
  assert.equal(overlay.getRevision(), 1);

  overlay.set(1, { x: 6.5, y: 5.5 });
  assert.equal(overlay.getRevision(), 2);

  overlay.delete(1);
  assert.equal(overlay.getRevision(), 3);

  overlay.reset();
  assert.equal(overlay.getRevision(), 3);
  assert.equal(overlay.has(1), false);
});

test('hard clearance uses Euclidean ENEMY_AVOID_RADIUS at tile centers', () => {
  const overlay = new EnemyClearanceOverlay();
  overlay.set(1, { x: 5.5, y: 5.5 });

  assert.equal(overlay.satisfiesHardClearance(5.5 + ENEMY_AVOID_RADIUS, 5.5), true);
  assert.equal(overlay.satisfiesHardClearance(5.5 + ENEMY_AVOID_RADIUS - 0.01, 5.5), false);
  assert.equal(overlay.tileCenterViolatesHardClearance(6, 5), false);
  assert.equal(overlay.tileCenterViolatesHardClearance(5, 5), true);
});

test('segment hard clearance rejects chords through enemy discs', () => {
  const enemy = { x: 5.5, y: 5.5 };
  assert.equal(
    segmentClearsCircle({ x: 4.5, y: 5.5 }, { x: 6.5, y: 5.5 }, enemy, ENEMY_AVOID_RADIUS),
    false,
  );
  assert.equal(
    segmentClearsCircle({ x: 3.5, y: 5.5 }, { x: 7.5, y: 5.5 }, enemy, ENEMY_AVOID_RADIUS),
    false,
  );
  assert.equal(
    segmentClearsCircle({ x: 3.5, y: 8.5 }, { x: 7.5, y: 8.5 }, enemy, ENEMY_AVOID_RADIUS),
    true,
  );
});

test('circular exclusion allows retreating outward from an interior start', () => {
  const center = { x: 5.5, y: 5.5 };
  const inside = { x: 5.6, y: 5.5 };
  assert.equal(
    pointViolatesCircularExclusion({ x: 6.6, y: 5.5 }, center, ENEMY_AVOID_RADIUS, inside),
    false,
  );
  assert.equal(
    pointViolatesCircularExclusion(inside, center, ENEMY_AVOID_RADIUS, undefined),
    true,
  );
});
