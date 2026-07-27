import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConditionEffectBits } from 'realmlib';
import {
  AutoConsumablesController,
  DEFAULT_AUTO_CONSUMABLES,
  MP_DRINK_TYPES,
  potionStatType,
  shouldDrinkStatPotion,
  type AutoConsumablesSnapshot,
  type PotionStatSnapshot,
} from '../src/auto-consumables';
import type { SlotRef } from '../src/inventory';

const HP_POTION = 2594;
const MP_POTION = MP_DRINK_TYPES[0];
const OTHER_MP_POTION = 2634;

function snapshot(overrides: Partial<AutoConsumablesSnapshot> = {}): AutoConsumablesSnapshot {
  return {
    inWorld: true,
    safeMap: false,
    playerObjectId: 1,
    hp: 700,
    maxHp: 700,
    mp: 252,
    maxMp: 252,
    condition: 0,
    // Weapon / ability / armor / ring, then an HP and an MP potion.
    inventory: [100, 101, 102, 103, HP_POTION, MP_POTION, -1, -1, -1, -1, -1, -1],
    inventoryEndIndex: 12,
    quickSlots: [],
    abilityMpCost: 80,
    abilityHeals: false,
    bags: [],
    ...overrides,
  };
}

interface Recorder {
  used: SlotRef[];
  abilities: number;
  actions: { useItem(slot: SlotRef): boolean; useAbilityAtSelf(): boolean };
}

function recorder(accept = true): Recorder {
  const used: SlotRef[] = [];
  const state = { abilities: 0 };
  return {
    used,
    get abilities() { return state.abilities; },
    actions: {
      useItem: (slot) => { used.push(slot); return accept; },
      useAbilityAtSelf: () => { state.abilities++; return accept; },
    },
  };
}

function enabled(overrides: Partial<typeof DEFAULT_AUTO_CONSUMABLES> = {}) {
  const controller = new AutoConsumablesController();
  controller.configure(overrides);
  controller.setEnabled(true);
  return controller;
}

// ------------------------------------------------------------- HP thresholds

test('an HP potion fires at the 40% default and not above it', () => {
  const controller = enabled();
  const actions = recorder();
  assert.equal(controller.update(1_000, snapshot({ hp: 281 }), actions.actions), null);
  assert.equal(controller.update(1_000, snapshot({ hp: 280 }), actions.actions), 'hp-potion');
  assert.deepEqual(actions.used, [{ objectId: 1, slotId: 4, itemType: HP_POTION }]);
});

test('the HP threshold is read from the predicted figure the caller supplies', () => {
  const controller = enabled();
  const actions = recorder();
  // Server HP is healthy; the caller passes the lower predicted figure.
  assert.equal(controller.update(1_000, snapshot({ hp: 200 }), actions.actions), 'hp-potion');
});

test('no HP figure yet means no potion', () => {
  const controller = enabled();
  const actions = recorder();
  assert.equal(controller.update(1_000, snapshot({ hp: null }), actions.actions), null);
  assert.equal(controller.update(1_000, snapshot({ hp: 10, maxHp: null }), actions.actions), null);
});

test('a zero percentage disables the check entirely', () => {
  const controller = enabled({ hpPercent: 0, autoHealPercent: 0 });
  const actions = recorder();
  assert.equal(controller.update(1_000, snapshot({ hp: 1 }), actions.actions), null);
});

test('SICK suppresses both the HP potion and the heal ability', () => {
  const controller = enabled();
  const actions = recorder();
  const sick = snapshot({ hp: 100, condition: ConditionEffectBits.SICK, abilityHeals: true });
  assert.equal(controller.update(1_000, sick, actions.actions), null);
  assert.equal(actions.used.length, 0);
  assert.equal(actions.abilities, 0);
});

test('the HP delay is respected and is independent of the MP delay', () => {
  const controller = enabled();
  const actions = recorder();
  const hurt = snapshot({ hp: 100, mp: 0 });
  assert.equal(controller.update(1_000, hurt, actions.actions), 'hp-potion');
  // 400 ms HP delay: still on cooldown at 1_400, clear just after.
  assert.equal(controller.update(1_400, hurt, actions.actions), 'mp-potion');
  assert.equal(controller.update(1_401, hurt, actions.actions), 'hp-potion');
});

// ------------------------------------------------------------- MP thresholds

test('the default MP mode tops up as soon as the ability is unaffordable', () => {
  const controller = enabled();
  const actions = recorder();
  assert.equal(DEFAULT_AUTO_CONSUMABLES.mpPercent, -1);
  assert.equal(controller.update(1_000, snapshot({ mp: 81 }), actions.actions), null);
  assert.equal(controller.update(1_000, snapshot({ mp: 80 }), actions.actions), 'mp-potion');
  assert.deepEqual(actions.used, [{ objectId: 1, slotId: 5, itemType: MP_POTION }]);
});

test('an unknown ability cost leaves the Abil% mode inert', () => {
  const controller = enabled();
  const actions = recorder();
  assert.equal(controller.update(1_000, snapshot({ mp: 0, abilityMpCost: null }), actions.actions), null);
});

test('a percentage MP threshold replaces the Abil% mode', () => {
  const controller = enabled({ mpPercent: 25 });
  const actions = recorder();
  assert.equal(controller.update(1_000, snapshot({ mp: 64 }), actions.actions), null);
  assert.equal(controller.update(1_000, snapshot({ mp: 63 }), actions.actions), 'mp-potion');
});

test('mpPercent 0 disables MP potions and QUIET suppresses them', () => {
  const off = enabled({ mpPercent: 0 });
  assert.equal(off.update(1_000, snapshot({ mp: 0 }), recorder().actions), null);
  const quiet = enabled();
  assert.equal(
    quiet.update(1_000, snapshot({ mp: 0, condition: ConditionEffectBits.QUIET }), recorder().actions),
    null,
  );
});

test('only the two MP potions the reference drinks are consumed', () => {
  const controller = enabled();
  const actions = recorder();
  const onlyOther = snapshot({
    mp: 0,
    inventory: [100, 101, 102, 103, -1, OTHER_MP_POTION, -1, -1, -1, -1, -1, -1],
  });
  assert.equal(controller.update(1_000, onlyOther, actions.actions), null);
  assert.equal(actions.used.length, 0);
});

// ---------------------------------------------------------------- auto heal

test('the heal ability fires below 99% only when the ability actually heals', () => {
  const controller = enabled();
  const actions = recorder();
  assert.equal(controller.update(1_000, snapshot({ hp: 600 }), actions.actions), null);
  assert.equal(
    controller.update(1_000, snapshot({ hp: 600, abilityHeals: true }), actions.actions),
    'heal',
  );
  assert.equal(actions.abilities, 1);
  // Its own cooldown holds off the next attempt.
  assert.equal(
    controller.update(1_200, snapshot({ hp: 600, abilityHeals: true }), actions.actions),
    null,
  );
  assert.equal(
    controller.update(1_600, snapshot({ hp: 600, abilityHeals: true }), actions.actions),
    'heal',
  );
});

test('a potion is preferred over the heal ability when both are due', () => {
  const controller = enabled();
  const actions = recorder();
  assert.equal(
    controller.update(1_000, snapshot({ hp: 100, abilityHeals: true }), actions.actions),
    'hp-potion',
  );
});

// -------------------------------------------------------- sources and gating

test('nothing fires out of world, on a safe map, or while disabled', () => {
  const controller = enabled();
  const actions = recorder();
  assert.equal(controller.update(1_000, snapshot({ hp: 1, inWorld: false }), actions.actions), null);
  assert.equal(controller.update(1_000, snapshot({ hp: 1, safeMap: true }), actions.actions), null);
  controller.setEnabled(false);
  assert.equal(controller.update(1_000, snapshot({ hp: 1 }), actions.actions), null);
});

test('the consumable belt is used when no carried slot holds a potion', () => {
  const controller = enabled();
  const actions = recorder();
  const belt = snapshot({
    hp: 100,
    inventory: [100, 101, 102, 103, -1, -1, -1, -1, -1, -1, -1, -1],
    quickSlots: [{ slotId: 1_000_000, itemType: HP_POTION, count: 3 }],
  });
  assert.equal(controller.update(1_000, belt, actions.actions), 'hp-potion');
  assert.deepEqual(actions.used, [{ objectId: 1, slotId: 1_000_000, itemType: HP_POTION }]);
});

test('an empty belt slot is skipped', () => {
  const controller = enabled();
  const actions = recorder();
  assert.equal(controller.update(1_000, snapshot({
    hp: 100,
    inventory: [100, 101, 102, 103, -1, -1, -1, -1, -1, -1, -1, -1],
    quickSlots: [{ slotId: 1_000_000, itemType: HP_POTION, count: 0 }],
  }), actions.actions), null);
});

test('drinking from a bag is opt-in', () => {
  const bare = snapshot({
    hp: 100,
    inventory: [100, 101, 102, 103, -1, -1, -1, -1, -1, -1, -1, -1],
    bags: [{ objectId: 900, slots: [-1, HP_POTION] }],
  });
  const off = enabled();
  assert.equal(off.update(1_000, bare, recorder().actions), null);
  const on = enabled({ drinkFromBags: true });
  const actions = recorder();
  assert.equal(on.update(1_000, bare, actions.actions), 'hp-potion');
  assert.deepEqual(actions.used, [{ objectId: 900, slotId: 1, itemType: HP_POTION }]);
});

test('a USEITEM the client refuses to send leaves the cooldown unarmed', () => {
  const controller = enabled();
  const rejected = recorder(false);
  assert.equal(controller.update(1_000, snapshot({ hp: 100 }), rejected.actions), null);
  assert.equal(controller.getState().lastHpPotAt, null);
  const accepted = recorder();
  assert.equal(controller.update(1_010, snapshot({ hp: 100 }), accepted.actions), 'hp-potion');
});

test('clear drops the cooldowns for a new character', () => {
  const controller = enabled();
  const actions = recorder();
  controller.update(1_000, snapshot({ hp: 100 }), actions.actions);
  assert.notEqual(controller.getState().lastHpPotAt, null);
  controller.clear();
  assert.equal(controller.getState().lastHpPotAt, null);
  assert.equal(controller.update(1_050, snapshot({ hp: 100 }), actions.actions), 'hp-potion');
});

test('configure clamps percentages and rejects junk', () => {
  const controller = new AutoConsumablesController();
  const configured = controller.configure({
    hpPercent: 140,
    mpPotDelayMs: -5,
    autoHealPercent: Number.NaN,
    drinkFromBags: 'yes' as unknown as boolean,
  });
  assert.equal(configured.hpPercent, 100);
  assert.equal(configured.mpPotDelayMs, DEFAULT_AUTO_CONSUMABLES.mpPotDelayMs);
  assert.equal(configured.autoHealPercent, DEFAULT_AUTO_CONSUMABLES.autoHealPercent);
  assert.equal(configured.drinkFromBags, DEFAULT_AUTO_CONSUMABLES.drinkFromBags);
  // -1 stays the sentinel rather than being clamped away.
  assert.equal(controller.configure({ mpPercent: -1 }).mpPercent, -1);
});

// ------------------------------------------------------------ potion tables

test('potion stat types match the reference numbering', () => {
  assert.equal(potionStatType(2591), 0);
  assert.equal(potionStatType(2592), 1);
  assert.equal(potionStatType(2593), 2);
  // Dexterity is 3 and vitality 4 even though the ids run the other way.
  assert.equal(potionStatType(2636), 3);
  assert.equal(potionStatType(2612), 4);
  assert.equal(potionStatType(2613), 5);
  assert.equal(potionStatType(2793), 6);
  assert.equal(potionStatType(2794), 7);
  assert.equal(potionStatType(HP_POTION), -1);
});

test('shouldDrink compares the un-boosted base stat against the class cap', () => {
  const stat = (value: number, boost = 0) => ({ value, boost });
  const stats: PotionStatSnapshot = {
    attack: stat(50, 20),
    defense: stat(25),
    speed: stat(50),
    dexterity: stat(50),
    vitality: stat(40),
    wisdom: stat(40),
    maxHp: stat(770),
    maxMp: stat(380),
    maximums: {
      attack: 50, defense: 25, speed: 50, dexterity: 50,
      vitality: 40, wisdom: 40, maxHp: 770, maxMp: 385,
    },
  };
  // 50 total but 20 of it is gear, so the base 30 is still below the 50 cap.
  assert.equal(shouldDrinkStatPotion(0, stats), true);
  assert.equal(shouldDrinkStatPotion(1, stats), false);
  assert.equal(shouldDrinkStatPotion(6, stats), false);
  assert.equal(shouldDrinkStatPotion(7, stats), true);
  // An unknown class never wastes a potion.
  assert.equal(shouldDrinkStatPotion(0, undefined), false);
  assert.equal(shouldDrinkStatPotion(-1, stats), false);
});
