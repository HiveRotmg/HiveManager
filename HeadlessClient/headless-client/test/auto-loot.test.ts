import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ABILITY_SLOT_TYPES,
  ARMOR_SLOT_TYPES,
  AutoLootController,
  DEFAULT_AUTO_LOOT,
  RING_SLOT_TYPE,
  TIER_OPTION_OFF,
  WEAPON_SLOT_TYPES,
  autoLootBagTier,
  isDesiredLoot,
  type AutoLootAction,
  type AutoLootBag,
  type AutoLootDataProvider,
  type AutoLootItemInfo,
  type AutoLootOptions,
  type AutoLootSnapshot,
} from '../src/auto-loot';
import type { PotionStatSnapshot } from '../src/auto-consumables';
import type { SlotRef } from '../src/inventory';

const HP_POTION = 2594;
const MP_POTION = 2595;
const LIFE_POTION = 2793;
const ATTACK_POTION = 2591;
const DEFENSE_POTION = 2592;

function item(overrides: Partial<AutoLootItemInfo> = {}): AutoLootItemInfo {
  return {
    isItem: true,
    slotType: -1,
    tier: null,
    bagType: -1,
    soulbound: false,
    consumable: false,
    potion: false,
    feedPower: 0,
    xpBonus: 0,
    activate: [],
    maxQuickStack: -1,
    stackable: false,
    stackLimited: false,
    name: '',
    ...overrides,
  };
}

/** A T12 robe: armor slot type, tier 12. */
const ROBE = item({ slotType: ARMOR_SLOT_TYPES[2], tier: 12, name: 'Robe of the Grand Sorcerer' });
/** A T11 wand: weapon slot type, tier 11. */
const WAND = item({ slotType: WEAPON_SLOT_TYPES[0], tier: 11, name: 'Wand of Recompense' });

const CATALOG: Record<number, AutoLootItemInfo> = {
  [HP_POTION]: item({ potion: true, consumable: true, maxQuickStack: 6, name: 'Potion of Healing' }),
  [MP_POTION]: item({ potion: true, consumable: true, maxQuickStack: 6, name: 'Potion of Magic' }),
  [LIFE_POTION]: item({ potion: true, consumable: true, name: 'Potion of Life' }),
  [ATTACK_POTION]: item({ potion: true, consumable: true, name: 'Potion of Attack' }),
  [DEFENSE_POTION]: item({ potion: true, consumable: true, name: 'Potion of Defense' }),
  100: ROBE,
  101: WAND,
  102: item({ slotType: WEAPON_SLOT_TYPES[0], tier: 8, name: 'Golden Sword' }),
  103: item({ slotType: WEAPON_SLOT_TYPES[0], bagType: 6, name: 'Doom Bow' }),
  104: item({ slotType: ABILITY_SLOT_TYPES[0], tier: 5, name: 'Tome of Purification' }),
  105: item({ slotType: RING_SLOT_TYPE, tier: 5, name: 'Ring of Paramount Attack' }),
  106: item({ activate: ['UnlockSkin'], name: 'Nomadic Shaman Skin' }),
  107: item({ activate: ['CreatePortal'], name: 'Lost Halls Key' }),
  108: item({ name: 'Mark of the Grotto' }),
  109: item({ rarity: 'Rare', name: 'Egg' }),
  110: item({ feedPower: 900, name: 'Beehemoth Cloak' }),
  111: item({ xpBonus: 5, name: 'Tincture of Courage' }),
  112: item({ stackable: true, name: 'Shard of the Advisor' }),
  113: item({ stackLimited: true, name: 'Full Stack of Shards' }),
  114: item({ soulbound: true, name: 'Sourcestone' }),
  115: item({ isItem: false, name: 'Loot Bag' }),
};

const DATA: AutoLootDataProvider = { getItem: (itemType) => CATALOG[itemType] };

function options(overrides: Partial<AutoLootOptions> = {}): AutoLootOptions {
  return { ...DEFAULT_AUTO_LOOT, includes: [], ...overrides };
}

function stats(overrides: Partial<Record<'attack' | 'defense', number>> = {}): PotionStatSnapshot {
  const stat = (value: number) => ({ value, boost: 0 });
  return {
    attack: stat(overrides.attack ?? 30),
    defense: stat(overrides.defense ?? 25),
    speed: stat(50),
    dexterity: stat(50),
    vitality: stat(40),
    wisdom: stat(40),
    maxHp: stat(700),
    maxMp: stat(252),
    maximums: {
      attack: 50, defense: 25, speed: 50, dexterity: 50,
      vitality: 40, wisdom: 40, maxHp: 770, maxMp: 385,
    },
  };
}

function bag(slots: number[], overrides: Partial<AutoLootBag> = {}): AutoLootBag {
  return { objectId: 900, objectType: 0x050c, x: 10, y: 10, slots, ...overrides };
}

function snapshot(overrides: Partial<AutoLootSnapshot> = {}): AutoLootSnapshot {
  return {
    inWorld: true,
    inVault: false,
    playerObjectId: 1,
    position: { x: 10, y: 10 },
    // Weapon / ability / armor / ring, then eight empty carried slots.
    inventory: [102, 104, 100, 105, -1, -1, -1, -1, -1, -1, -1, -1],
    inventoryEndIndex: 12,
    quickSlots: [],
    equipSlotTypes: [WEAPON_SLOT_TYPES[0], ABILITY_SLOT_TYPES[0], ARMOR_SLOT_TYPES[2], RING_SLOT_TYPE],
    stats: stats(),
    bags: [],
    lastInvSwapAt: null,
    ...overrides,
  };
}

interface Recorder {
  swaps: { from: SlotRef; to: SlotRef }[];
  uses: SlotRef[];
  actions: {
    swap(from: SlotRef, to: SlotRef): boolean;
    useFromBag(slot: SlotRef): boolean;
  };
}

function recorder(accept = true): Recorder {
  const swaps: { from: SlotRef; to: SlotRef }[] = [];
  const uses: SlotRef[] = [];
  return {
    swaps,
    uses,
    actions: {
      swap: (from, to) => { swaps.push({ from, to }); return accept; },
      useFromBag: (slot) => { uses.push(slot); return accept; },
    },
  };
}

// ------------------------------------------------------------ filter decisions

test('per-slot tier minimums use the reference defaults', () => {
  const config = options();
  // T12 robe / T11 wand / T5 ability / T5 ring all sit exactly on the default.
  assert.equal(isDesiredLoot(100, ROBE, config), true);
  assert.equal(isDesiredLoot(101, WAND, config), true);
  assert.equal(isDesiredLoot(104, CATALOG[104], config), true);
  assert.equal(isDesiredLoot(105, CATALOG[105], config), true);
  // A T8 weapon is below the T11 minimum and has no other qualifying property.
  assert.equal(isDesiredLoot(102, CATALOG[102], config), false);
});

test('a tier option set to Off stops matching that slot only', () => {
  const config = options({ weaponTier: TIER_OPTION_OFF });
  assert.equal(isDesiredLoot(101, WAND, config), false);
  assert.equal(isDesiredLoot(100, ROBE, config), true);
});

test('potion flags gate each potion table independently', () => {
  assert.equal(isDesiredLoot(HP_POTION, CATALOG[HP_POTION], options()), true);
  assert.equal(isDesiredLoot(HP_POTION, CATALOG[HP_POTION], options({ hpPots: false })), false);
  assert.equal(isDesiredLoot(MP_POTION, CATALOG[MP_POTION], options({ mpPots: false })), false);
  assert.equal(isDesiredLoot(LIFE_POTION, CATALOG[LIFE_POTION], options({ lifeManaPots: false })), false);
  assert.equal(isDesiredLoot(ATTACK_POTION, CATALOG[ATTACK_POTION], options({ rainbowPots: false })), false);
});

test('UT loot is decided by white/orange bag membership, not tier', () => {
  const untiered = CATALOG[103];
  assert.equal(untiered.tier, null);
  assert.equal(isDesiredLoot(103, untiered, options()), true);
  assert.equal(isDesiredLoot(103, untiered, options({ uts: false })), false);
});

test('skins, keys, marks, eggs, feed power and XP bonus each honour their option', () => {
  assert.equal(isDesiredLoot(106, CATALOG[106], options()), true);
  assert.equal(isDesiredLoot(106, CATALOG[106], options({ skins: false })), false);
  assert.equal(isDesiredLoot(107, CATALOG[107], options()), true);
  assert.equal(isDesiredLoot(107, CATALOG[107], options({ keys: false })), false);
  // Marks are off by default in the reference.
  assert.equal(isDesiredLoot(108, CATALOG[108], options()), false);
  assert.equal(isDesiredLoot(108, CATALOG[108], options({ marks: true })), true);
  // Default egg level is 1 (Uncommon), so a Rare egg qualifies and a Common one does not.
  assert.equal(isDesiredLoot(109, CATALOG[109], options()), true);
  assert.equal(isDesiredLoot(109, item({ rarity: 'Common' }), options()), false);
  assert.equal(isDesiredLoot(109, CATALOG[109], options({ eggs: -1 })), false);
  // Feed power is off by default.
  assert.equal(isDesiredLoot(110, CATALOG[110], options()), false);
  assert.equal(isDesiredLoot(110, CATALOG[110], options({ feedPower: 800 })), true);
  assert.equal(isDesiredLoot(111, CATALOG[111], options()), true);
  assert.equal(isDesiredLoot(111, CATALOG[111], options({ xpBonus: 6 })), false);
});

test('soulbound and stackable rules follow the reference', () => {
  assert.equal(isDesiredLoot(114, CATALOG[114], options()), false);
  assert.equal(isDesiredLoot(114, CATALOG[114], options({ soulbound: true })), true);
  assert.equal(isDesiredLoot(112, CATALOG[112], options()), true);
  assert.equal(isDesiredLoot(112, CATALOG[112], options({ stackables: false })), false);
  // The reference's precedence bug takes a full stack regardless of the option;
  // stackLimitedAlways preserves it and can be turned off.
  assert.equal(isDesiredLoot(113, CATALOG[113], options({ stackables: false })), true);
  assert.equal(
    isDesiredLoot(113, CATALOG[113], options({ stackables: false, stackLimitedAlways: false })),
    false,
  );
});

test('includes override everything and excludes beat every ordinary rule', () => {
  assert.equal(isDesiredLoot(102, CATALOG[102], options({ includes: [102] })), true);
  assert.equal(isDesiredLoot(115, CATALOG[115], options({ includes: [115] })), true);
  assert.equal(isDesiredLoot(100, ROBE, options({ excludes: [100] })), false);
  // Includes are applied after excludes in the reference, so they win a tie.
  assert.equal(isDesiredLoot(100, ROBE, options({ excludes: [100], includes: [100] })), true);
});

test('non-items are never desirable without an explicit include', () => {
  assert.equal(isDesiredLoot(115, CATALOG[115], options()), false);
  assert.equal(isDesiredLoot(999, undefined, options()), false);
});

test('bag tier prefers the definition id and falls back to the object type', () => {
  assert.equal(autoLootBagTier({ objectType: 0, definitionId: 'Loot Bag 7' }), 7);
  assert.equal(autoLootBagTier({ objectType: 0x050b }), 5);
  assert.equal(autoLootBagTier({ objectType: 0x1234 }), -1);
});

// --------------------------------------------------------- controller behaviour

test('wantsItemType covers upgrades over equipped gear', () => {
  const controller = new AutoLootController(DATA);
  controller.configure({
    ...options(),
    weaponTier: TIER_OPTION_OFF,
    abilityTier: TIER_OPTION_OFF,
  });
  // The controller learns the equipped set from the snapshot it is driven with.
  controller.update(0, snapshot(), recorder().actions);
  assert.equal(controller.wantsItemType(101), false);
  controller.configure({ upgrades: true });
  // T11 wand beats the equipped T8 sword even with the weapon tier rule off.
  assert.equal(controller.wantsItemType(101), true);
  // The equipped T5 ability is not beaten by another T5.
  assert.equal(controller.wantsItemType(104), false);
});

test('a wanted item is swapped into the first free carried slot', () => {
  const controller = new AutoLootController(DATA);
  controller.configure(options());
  controller.setEnabled(true);
  const actions = recorder();
  const action = controller.update(1_000, snapshot({ bags: [bag([101, -1])] }), actions.actions);
  assert.deepEqual(action, {
    kind: 'pickup',
    bagObjectId: 900,
    bagSlotId: 0,
    itemType: 101,
    destinationSlotId: 4,
    replacedItemType: -1,
  } satisfies AutoLootAction);
  assert.deepEqual(actions.swaps, [{
    from: { objectId: 900, slotId: 0, itemType: 101 },
    to: { objectId: 1, slotId: 4, itemType: -1 },
  }]);
});

test('unwanted loot is left in the bag', () => {
  const controller = new AutoLootController(DATA);
  controller.configure(options());
  controller.setEnabled(true);
  const actions = recorder();
  assert.equal(controller.update(1_000, snapshot({ bags: [bag([102, 108])] }), actions.actions), null);
  assert.equal(actions.swaps.length, 0);
});

test('the 500 ms window is shared with swaps from other sources', () => {
  const controller = new AutoLootController(DATA);
  controller.configure(options());
  controller.setEnabled(true);
  const actions = recorder();
  const bags = [bag([101, 100])];
  assert.equal(controller.update(1_000, snapshot({ bags, lastInvSwapAt: 800 }), actions.actions), null);
  assert.notEqual(controller.update(1_400, snapshot({ bags, lastInvSwapAt: 800 }), actions.actions), null);
  // Its own action re-arms the window.
  assert.equal(controller.update(1_600, snapshot({ bags, lastInvSwapAt: 800 }), actions.actions), null);
  assert.equal(actions.swaps.length, 1);
});

test('vault storage containers are skipped and the vault needs its own option', () => {
  const controller = new AutoLootController(DATA);
  controller.configure(options());
  controller.setEnabled(true);
  const actions = recorder();
  assert.equal(
    controller.update(1_000, snapshot({ inVault: true, bags: [bag([101])] }), actions.actions),
    null,
  );
  controller.configure({ inVault: true });
  assert.equal(
    controller.update(2_000, snapshot({ inVault: true, bags: [bag([101], { objectType: 1284 })] }),
      actions.actions),
    null,
  );
  assert.notEqual(
    controller.update(3_000, snapshot({ inVault: true, bags: [bag([101])] }), actions.actions),
    null,
  );
});

test('bags out of reach are ignored and the highest tier within reach wins', () => {
  const controller = new AutoLootController(DATA);
  controller.configure(options());
  controller.setEnabled(true);
  const actions = recorder();
  assert.equal(
    controller.update(1_000, snapshot({ bags: [bag([101], { x: 14, y: 10 })] }), actions.actions),
    null,
  );
  const action = controller.update(2_000, snapshot({
    bags: [
      bag([101], { objectId: 901, objectType: 0x050b }),
      bag([100], { objectId: 902, objectType: 0x06c0 }),
    ],
  }), actions.actions);
  assert.equal(action?.kind === 'pickup' && action.bagObjectId, 902);
});

test('a rejected swap quarantines the slot and the item, then lapses', () => {
  const controller = new AutoLootController(DATA);
  controller.configure(options());
  controller.setEnabled(true);
  const actions = recorder();
  const bags = [bag([101, 100])];
  controller.update(1_000, snapshot({ bags }), actions.actions);
  controller.noteSwapRejected(4, 101, 1_100);
  assert.equal(controller.getState().quarantinedSlots, 1);
  assert.equal(controller.getState().quarantinedItems, 1);
  // Rejection backs off a full second, and slot 4 is out for five.
  assert.equal(controller.update(1_500, snapshot({ bags }), actions.actions), null);
  const next = controller.update(3_000, snapshot({ bags }), actions.actions);
  assert.equal(next?.kind === 'pickup' && next.destinationSlotId, 5);
  assert.equal(next?.kind === 'pickup' && next.itemType, 100);
  // The item quarantine lapses after 30 s.
  const later = controller.update(40_000, snapshot({ bags }), actions.actions);
  assert.equal(later?.kind === 'pickup' && later.itemType, 101);
});

test('a full inventory sacrifices a maxed stat potion for a white bag only', () => {
  const controller = new AutoLootController(DATA);
  controller.configure(options());
  controller.setEnabled(true);
  const actions = recorder();
  // Slot 4 holds an attack potion (stat below cap), slot 5 a defense potion (capped).
  const full = snapshot({
    inventory: [102, 104, 100, 105, ATTACK_POTION, DEFENSE_POTION,
      114, 114, 114, 114, 114, 114],
  });
  // A bag below white never displaces anything.
  assert.equal(
    controller.update(1_000, { ...full, bags: [bag([103], { objectType: 0x1234 })] }, actions.actions),
    null,
  );
  const action = controller.update(2_000, {
    ...full,
    bags: [bag([103], { objectType: 0x050b })],
  }, actions.actions);
  // The capped defense potion goes, not the attack potion still worth drinking.
  assert.equal(action?.kind === 'pickup' && action.destinationSlotId, 5);
  assert.equal(action?.kind === 'pickup' && action.replacedItemType, DEFENSE_POTION);
});

test('an incoming stat potion never displaces a carried one', () => {
  const controller = new AutoLootController(DATA);
  controller.configure(options());
  controller.setEnabled(true);
  const actions = recorder();
  const full = snapshot({
    inventory: [102, 104, 100, 105, DEFENSE_POTION, DEFENSE_POTION,
      114, 114, 114, 114, 114, 114],
  });
  const action = controller.update(1_000, {
    ...full,
    bags: [bag([ATTACK_POTION], { objectType: 0x050b })],
  }, actions.actions);
  // It is drunk in place rather than displacing either carried potion.
  assert.equal(action?.kind, 'consume');
  assert.equal(actions.swaps.length, 0);
});

test('consumeRainbowPots drinks a stat potion out of the bag while the stat is low', () => {
  const controller = new AutoLootController(DATA);
  controller.configure(options({ consumeRainbowPots: true }));
  controller.setEnabled(true);
  const actions = recorder();
  const action = controller.update(1_000, snapshot({ bags: [bag([ATTACK_POTION])] }), actions.actions);
  assert.deepEqual(action, {
    kind: 'consume',
    bagObjectId: 900,
    bagSlotId: 0,
    itemType: ATTACK_POTION,
    reason: 'rainbow',
  } satisfies AutoLootAction);
  assert.deepEqual(actions.uses, [{ objectId: 900, slotId: 0, itemType: ATTACK_POTION }]);
  // A capped stat is picked up instead of drunk.
  const capped = controller.update(2_000, snapshot({ bags: [bag([DEFENSE_POTION])] }), actions.actions);
  assert.equal(capped?.kind, 'pickup');
});

test('unknown class caps stop consumeRainbowPots from wasting potions', () => {
  const controller = new AutoLootController(DATA);
  controller.configure(options({ consumeRainbowPots: true }));
  controller.setEnabled(true);
  const actions = recorder();
  const action = controller.update(1_000, snapshot({
    stats: undefined,
    bags: [bag([ATTACK_POTION])],
  }), actions.actions);
  assert.equal(action?.kind, 'pickup');
});

test('a stat potion is drunk from the bag when there is nowhere to put it', () => {
  const controller = new AutoLootController(DATA);
  controller.configure(options({ consumeRainbowPots: false }));
  controller.setEnabled(true);
  const actions = recorder();
  const action = controller.update(1_000, {
    ...snapshot({
      inventory: [102, 104, 100, 105, 114, 114, 114, 114, 114, 114, 114, 114],
    }),
    bags: [bag([ATTACK_POTION], { objectType: 0x050b })],
  }, actions.actions);
  assert.deepEqual(action, {
    kind: 'consume',
    bagObjectId: 900,
    bagSlotId: 0,
    itemType: ATTACK_POTION,
    reason: 'inventory-full',
  } satisfies AutoLootAction);
});

test('a quick slot with room stacks the potion instead of using inventory', () => {
  const controller = new AutoLootController(DATA);
  controller.configure(options());
  controller.setEnabled(true);
  const actions = recorder();
  const action = controller.update(1_000, snapshot({
    quickSlots: [{ slotId: 1_000_000, itemType: HP_POTION, count: 2 }],
    bags: [bag([HP_POTION])],
  }), actions.actions);
  assert.equal(action?.kind === 'pickup' && action.destinationSlotId, 1_000_000);
  assert.equal(action?.kind === 'pickup' && action.replacedItemType, HP_POTION);
  // A full belt slot, or one whose count is unknown, falls back to inventory.
  const fallback = controller.update(2_000, snapshot({
    quickSlots: [{ slotId: 1_000_000, itemType: HP_POTION, count: 6 },
      { slotId: 1_000_001, itemType: HP_POTION }],
    bags: [bag([HP_POTION])],
  }), actions.actions);
  assert.equal(fallback?.kind === 'pickup' && fallback.destinationSlotId, 4);
});

test('a swap the client refuses to send is not recorded as an action', () => {
  const controller = new AutoLootController(DATA);
  controller.configure(options());
  controller.setEnabled(true);
  const actions = recorder(false);
  assert.equal(controller.update(1_000, snapshot({ bags: [bag([101])] }), actions.actions), null);
  assert.equal(actions.swaps.length, 1);
  assert.equal(controller.getState().lastActionAt, null);
});

test('block reasons distinguish a full inventory from a quarantined item', () => {
  const controller = new AutoLootController(DATA);
  controller.configure(options());
  controller.setEnabled(true);
  const full = snapshot({
    inventory: [102, 104, 100, 105, 114, 114, 114, 114, 114, 114, 114, 114],
  });
  assert.equal(controller.blockReason(1_000, full, bag([103])), 'inventory_full');
  assert.equal(controller.blockReason(1_000, snapshot(), bag([102])), 'complete');
  assert.equal(controller.blockReason(1_000, snapshot(), bag([])), 'invalid_bag');
  assert.equal(controller.blockReason(1_000, snapshot(), bag([101])), 'service_timeout');
  controller.noteSwapRejected(-1, 101, 1_000);
  assert.equal(controller.blockReason(1_100, full, bag([101])), 'item_rejected');
});

test('the backpack extends the usable range and disabling stops everything', () => {
  const controller = new AutoLootController(DATA);
  controller.configure(options());
  controller.setEnabled(true);
  const actions = recorder();
  const withBackpack = snapshot({
    inventory: [102, 104, 100, 105, ...Array<number>(8).fill(114), ...Array<number>(8).fill(-1)],
    inventoryEndIndex: 20,
    bags: [bag([101])],
  });
  const action = controller.update(1_000, withBackpack, actions.actions);
  assert.equal(action?.kind === 'pickup' && action.destinationSlotId, 12);
  controller.setEnabled(false);
  assert.equal(controller.update(5_000, withBackpack, actions.actions), null);
});

test('configure rejects junk without disturbing the previous value', () => {
  const controller = new AutoLootController(DATA);
  const configured = controller.configure({
    weaponTier: -3,
    xpBonus: Number.NaN,
    marks: 'yes' as unknown as boolean,
    includes: 'nope' as unknown as number[],
    excludes: [7, 7, -1, 9],
  });
  assert.equal(configured.weaponTier, DEFAULT_AUTO_LOOT.weaponTier);
  assert.equal(configured.xpBonus, DEFAULT_AUTO_LOOT.xpBonus);
  assert.equal(configured.marks, DEFAULT_AUTO_LOOT.marks);
  assert.deepEqual(configured.includes, DEFAULT_AUTO_LOOT.includes);
  assert.deepEqual(configured.excludes, [7, 9]);
});
