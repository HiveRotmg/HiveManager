import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cloneDodgeMovementIntent,
  normalizeDodgeMovementIntent,
} from '../src/dodge-movement-intent';

test('dodge movement intents validate and clone without sharing state', () => {
  const goal = normalizeDodgeMovementIntent({
    mode: 'goal',
    goalX: 10,
    goalY: 20,
    goalId: 'room:4',
    arriveThreshold: 0.5,
  });
  assert.deepEqual(goal, {
    mode: 'goal',
    goalX: 10,
    goalY: 20,
    goalId: 'room:4',
    arriveThreshold: 0.5,
  });
  assert.notEqual(cloneDodgeMovementIntent(goal), goal);

  assert.equal(normalizeDodgeMovementIntent({
    mode: 'combat_range',
    targetId: 42,
    targetX: 10,
    targetY: 20,
    hardMinimumRange: 1.3,
    preferredMinimumRange: 5,
    preferredMaximumRange: 4,
  }), undefined);
});
