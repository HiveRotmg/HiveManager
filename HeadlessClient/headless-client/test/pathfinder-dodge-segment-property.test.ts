import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  derivePropertyCaseSeed,
  PROPERTY_CASE_COUNT,
  PROPERTY_TEST_SEED_BASE,
  runPropertyCase,
} from './helpers/pathfinder-dodge-segment-property';

test('pathfinder-dodge segment property: deterministic seed derivation', () => {
  const off = derivePropertyCaseSeed(PROPERTY_TEST_SEED_BASE, 0, false);
  const on = derivePropertyCaseSeed(PROPERTY_TEST_SEED_BASE, 0, true);
  const repeat = derivePropertyCaseSeed(PROPERTY_TEST_SEED_BASE, 0, false);

  assert.notEqual(off, on);
  assert.equal(off, repeat);
});

for (const useInflatedPassability of [false, true]) {
  test(
    `pathfinder smoothed segments pass dodge static validator (useInflatedPassability=${useInflatedPassability}, ${PROPERTY_CASE_COUNT} maps)`,
    () => {
      for (let caseIndex = 0; caseIndex < PROPERTY_CASE_COUNT; caseIndex++) {
        const seed = derivePropertyCaseSeed(
          PROPERTY_TEST_SEED_BASE,
          caseIndex,
          useInflatedPassability,
        );
        runPropertyCase(seed, useInflatedPassability);
      }
    },
  );
}
