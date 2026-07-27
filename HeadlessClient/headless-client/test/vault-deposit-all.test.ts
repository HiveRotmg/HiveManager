import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VAULT_SWEEP_STAGGER_MS, planVaultDepositAll } from '../src/inventory';
import type { SlotRef } from '../src/inventory';

function slots(objectId: number, itemTypes: readonly number[], firstSlotId = 0): SlotRef[] {
  return itemTypes.map((itemType, index) => ({
    objectId,
    slotId: firstSlotId + index,
    itemType,
  }));
}

test('every carried item is paired with a free vault slot, in order', () => {
  const carried = slots(1, [100, 101, 102, 103, 200, -1, 201, 202]);
  const vault = slots(50, [-1, -1, -1, -1, -1, -1, -1, -1]);
  const plan = planVaultDepositAll(carried, vault);
  assert.deepEqual(plan.map((step) => [step.from.slotId, step.to.slotId]), [
    [4, 0], [6, 1], [7, 2],
  ]);
});

test('equipment is never deposited', () => {
  const plan = planVaultDepositAll(slots(1, [100, 101, 102, 103]), slots(50, [-1, -1, -1, -1]));
  assert.deepEqual(plan, []);
});

test('occupied vault slots are skipped and the plan stops when the vault fills', () => {
  const carried = slots(1, [-1, -1, -1, -1, 200, 201, 202]);
  const vault = slots(50, [300, -1, 301, -1]);
  const plan = planVaultDepositAll(carried, vault);
  assert.deepEqual(plan.map((step) => [step.from.slotId, step.to.slotId]), [[4, 1], [5, 3]]);
});

test('each leg is staggered by the reference delay', () => {
  const carried = slots(1, [-1, -1, -1, -1, 200, 201, 202]);
  const plan = planVaultDepositAll(carried, slots(50, [-1, -1, -1]));
  assert.deepEqual(plan.map((step) => step.delayMs), [
    0, VAULT_SWEEP_STAGGER_MS, VAULT_SWEEP_STAGGER_MS * 2,
  ]);
  assert.equal(VAULT_SWEEP_STAGGER_MS, 550);
});

test('the plan carries the item types it was built against', () => {
  const plan = planVaultDepositAll(slots(1, [-1, -1, -1, -1, 200]), slots(50, [-1]));
  assert.deepEqual(plan[0].from, { objectId: 1, slotId: 4, itemType: 200 });
  assert.deepEqual(plan[0].to, { objectId: 50, slotId: 0, itemType: -1 });
});
