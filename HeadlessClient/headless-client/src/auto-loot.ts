import {
  HP_POTION_TYPES,
  LIFE_MANA_POTION_TYPES,
  MP_POTION_TYPES,
  RAINBOW_POTION_TYPES,
  potionStatType,
  shouldDrinkStatPotion,
  type PotionStatSnapshot,
} from './auto-consumables';
import type { SlotRef } from './inventory';
import type { ItemCatalog } from './item-metadata';

/**
 * Auto Loot, ported from `Parameters.setAutolootDesireables` (the per-item
 * desirability filter) and `Player.autoLoot` / `Player.pickup` (the per-frame
 * bag servicing that drives INVSWAP).
 *
 * The reference recomputes a `desiredLoot_` flag over the whole object library
 * whenever an option changes; here desirability is evaluated on demand for the
 * handful of items actually sitting in a nearby bag. The two are equivalent
 * because the reference's include/exclude lists are applied as a final override
 * pass, which {@link isDesiredLoot} reproduces by checking them first.
 */

// ------------------------------------------------------------- slot type tables

/** `Parameters.WEAPON_SLOT_TYPES`. */
export const WEAPON_SLOT_TYPES: readonly number[] = [3, 2, 24, 17, 1, 8];
/** `Parameters.ABILITY_SLOT_TYPES`. */
export const ABILITY_SLOT_TYPES: readonly number[] = [13, 16, 21, 18, 22, 15, 23, 12, 5, 25, 19, 11, 4, 20];
/** `Parameters.ARMOR_SLOT_TYPES`. */
export const ARMOR_SLOT_TYPES: readonly number[] = [6, 7, 14];
/** Rings are matched against the bare slot type, exactly as `desiredRing` does. */
export const RING_SLOT_TYPE = 9;
/** `Parameters.PET_STONE_TYPES`. */
export const PET_STONE_TYPES: readonly number[] = [8973, 8974, 8975];

/** `Parameters.defaultInclusions`. */
export const DEFAULT_AUTO_LOOT_INCLUDES: readonly number[] = [
  600, 601, 602, 603, 2295, 2296, 2297, 2298, 2524, 2525, 2526, 2527,
  8608, 8609, 8610, 8611, 8615, 8617, 8616, 8618, 8962,
  9017, 9015, 9016, 9055, 9054, 9052, 9053, 9059, 9058, 9056, 9057,
  9063, 9062, 9060, 9061, 32697, 32698, 32699, 32700,
  3004, 3005, 3006, 3007, 3088, 3100, 3096, 3091, 3113, 3114, 3112, 3111,
  3032, 3033, 3034, 3035, 3177, 3266,
];

/** The "Off" sentinel shared by all four tier options. */
export const TIER_OPTION_OFF = 999;

/** `Player.autoLoot` skips these container types outright (vault storage). */
const EXCLUDED_CONTAINER_TYPES = new Set([1284, 1860]);

/** `desiredUT`: only white-bag and orange-bag drops count as UT loot. */
const UT_BAG_TYPES = new Set([6, 9]);

/** `desiredEgg` maps `<Rarity>` onto the 0-3 levels the option compares against. */
const EGG_RARITY_LEVELS = new Map<string, number>([
  ['common', 0], ['uncommon', 1], ['rare', 2], ['legendary', 3],
]);

// ------------------------------------------------------------------ timing

/** `Player.autoLoot` allows one loot action per 500 ms, shared with any INVSWAP. */
const ACTION_INTERVAL_MS = 500;
/** `Player.AUTO_LOOT_REJECTED_SLOT_MS`. */
const REJECTED_SLOT_MS = 5_000;
/** `Player.AUTO_LOOT_REJECTED_ITEM_MS`. */
const REJECTED_ITEM_MS = 30_000;
/** `onAutoLootSwapRejected` pushes the next action out by a full second. */
const REJECTION_BACKOFF_MS = 1_000;
/** `Player.autoLoot` requires `getDistSquared(...) <= 1`. */
const BAG_RANGE_SQUARED = 1;
/** `nextAutoLootReplacementSlot` only sacrifices a slot for a white-or-better bag. */
const REPLACEMENT_MIN_BAG_TIER = 5;

// ------------------------------------------------------------------ item data

/** The object-XML fields Auto Loot decisions depend on. */
export interface AutoLootItemInfo {
  /** XML `<Item />`. Non-items are never desirable on their own. */
  isItem: boolean;
  /** XML `<SlotType>`, or -1 when absent. */
  slotType: number;
  /** XML `<Tier>`, or null when absent. */
  tier: number | null;
  /** XML `<BagType>`, or -1 when absent. */
  bagType: number;
  soulbound: boolean;
  consumable: boolean;
  potion: boolean;
  rarity?: string;
  feedPower: number;
  xpBonus: number;
  activate: readonly string[];
  maxQuickStack: number;
  /** Stack limit exceeds this object type's quantity. */
  stackable: boolean;
  /** The object belongs to a stacking family, even at a full stack. */
  stackLimited: boolean;
  /** Object display/id name, used by the Mark / Pet Stone / Mystery Key rules. */
  name: string;
}

export interface AutoLootDataProvider {
  getItem(itemType: number): AutoLootItemInfo | undefined;
}

/** Adapts the XML-backed {@link ItemCatalog} to {@link AutoLootDataProvider}. */
export function itemCatalogLootData(catalog: ItemCatalog): AutoLootDataProvider {
  return {
    getItem(itemType) {
      const info = catalog.info(itemType);
      if (!info) return undefined;
      return {
        isItem: info.isItem,
        slotType: info.slotType,
        tier: info.tier,
        bagType: info.bagType,
        soulbound: info.soulbound,
        consumable: info.consumable,
        potion: info.potion,
        rarity: info.rarity,
        feedPower: info.feedPower,
        xpBonus: info.xpBonus,
        activate: info.activate,
        maxQuickStack: info.maxQuickStack,
        stackable: info.stackable,
        stackLimited: info.stackLimited,
        name: info.displayName ?? info.name,
      };
    },
  };
}

// -------------------------------------------------------------------- options

export interface AutoLootOptions {
  /** `autoLootInVault`: allow servicing bags while standing in the vault. */
  inVault: boolean;
  /** `autoLootUpgrades`: also take tiered gear that beats what is equipped. */
  upgrades: boolean;
  /** `autoLootWeaponTier`; {@link TIER_OPTION_OFF} disables the rule. */
  weaponTier: number;
  /** `autoLootAbilityTier`. */
  abilityTier: number;
  /** `autoLootArmorTier`. */
  armorTier: number;
  /** `autoLootRingTier`. */
  ringTier: number;
  /** `autoLootXPBonus`; -1 disables. */
  xpBonus: number;
  /** `autoLootFeedPower`; -1 disables. */
  feedPower: number;
  /** `autoLootHPPots`. */
  hpPots: boolean;
  /** `autoLootMPPots`. */
  mpPots: boolean;
  /** `autoLootLifeManaPots`. */
  lifeManaPots: boolean;
  /** `autoLootRainbowPots`. */
  rainbowPots: boolean;
  /**
   * `autoConsumeRainbowPots`: drink a stat potion straight out of the bag while
   * that base stat is below its class maximum, instead of carrying it.
   */
  consumeRainbowPots: boolean;
  /** `autoLootSkins`. */
  skins: boolean;
  /** `autoLootPetSkins`. */
  petSkins: boolean;
  /** `autoLootKeys`. */
  keys: boolean;
  /** `autoLootUTs`: white-bag (BagType 6) and orange-bag (BagType 9) items. */
  uts: boolean;
  /** `autoLootMarks`. */
  marks: boolean;
  /** `autoLootEggs`: minimum pet-egg level (0 Common - 3 Legendary); -1 disables. */
  eggs: number;
  /** `autoLootConsumables`. */
  consumables: boolean;
  /** `autoLootSoulbound`. */
  soulbound: boolean;
  /** `autoLootStackables`. */
  stackables: boolean;
  /**
   * The reference's stackable test is `autoLootStackables && stackable_ ||
   * "Quantity" in xml && ... "Stack limit"`, whose operator precedence makes the
   * second half ignore the option — so any member of a stacking family is always
   * taken, including a full stack. Kept true to preserve that behaviour; set it
   * false to make `stackables` actually authoritative.
   */
  stackLimitedAlways: boolean;
  /** `autoLootExcludes`: object types never taken. */
  excludes: readonly number[];
  /** `autoLootIncludes`: object types always taken; overrides every other rule. */
  includes: readonly number[];
}

/** ProdMafia's `Parameters` defaults for every Auto Loot option. */
export const DEFAULT_AUTO_LOOT: AutoLootOptions = {
  inVault: false,
  upgrades: false,
  weaponTier: 11,
  abilityTier: 5,
  armorTier: 12,
  ringTier: 5,
  xpBonus: 5,
  feedPower: -1,
  hpPots: true,
  mpPots: true,
  lifeManaPots: true,
  rainbowPots: true,
  consumeRainbowPots: false,
  skins: true,
  petSkins: true,
  keys: true,
  uts: true,
  marks: false,
  eggs: 1,
  consumables: false,
  soulbound: false,
  stackables: true,
  stackLimitedAlways: true,
  excludes: [],
  includes: DEFAULT_AUTO_LOOT_INCLUDES,
};

// ------------------------------------------------------------- desirability

/** `Parameters.desiredPotion`: membership in whichever potion tables are enabled. */
export function isDesiredPotion(itemType: number, options: AutoLootOptions): boolean {
  if (options.hpPots && HP_POTION_TYPES.includes(itemType)) return true;
  if (options.mpPots && MP_POTION_TYPES.includes(itemType)) return true;
  if (options.lifeManaPots && LIFE_MANA_POTION_TYPES.includes(itemType)) return true;
  return options.rainbowPots && RAINBOW_POTION_TYPES.includes(itemType);
}

/**
 * `Parameters.setAutolootDesireables` for a single object type. The rule order
 * is the reference's `if/else if` chain verbatim; only the first matching rule
 * decides, which matters because e.g. a tiered weapon below the weapon-tier
 * minimum still falls through to the feed-power and XP-bonus rules.
 */
export function isDesiredLoot(
  itemType: number,
  info: AutoLootItemInfo | undefined,
  options: AutoLootOptions,
): boolean {
  // The reference applies excludes and then includes as override passes after
  // the chain, so includes win outright and excludes beat every ordinary rule.
  if (options.includes.includes(itemType)) return true;
  if (options.excludes.includes(itemType)) return false;
  if (!info?.isItem) return false;

  if (info.potion && isDesiredPotion(itemType, options)) return true;
  if (options.weaponTier !== TIER_OPTION_OFF
    && meetsTier(info, options.weaponTier, WEAPON_SLOT_TYPES)) return true;
  if (options.abilityTier !== TIER_OPTION_OFF
    && meetsTier(info, options.abilityTier, ABILITY_SLOT_TYPES)) return true;
  if (options.armorTier !== TIER_OPTION_OFF
    && meetsTier(info, options.armorTier, ARMOR_SLOT_TYPES)) return true;
  if (options.ringTier !== TIER_OPTION_OFF
    && meetsTier(info, options.ringTier, [RING_SLOT_TYPE])) return true;
  // desiredUT ignores tier entirely: white/orange bag membership is the test.
  if (options.uts && info.slotType >= 0 && UT_BAG_TYPES.has(info.bagType)) return true;
  if (options.skins && (info.activate.includes('UnlockSkin')
    || info.name.includes('Mystery Skin'))) return true;
  if (options.petSkins && (info.name.includes('Pet Stone')
    || PET_STONE_TYPES.includes(itemType))) return true;
  if (options.keys && (info.activate.includes('CreatePortal')
    || info.name.includes('Mystery Key'))) return true;
  if (options.marks && info.name.includes('Mark of ')) return true;
  if (options.consumables && info.consumable) return true;
  if (options.soulbound && info.soulbound) return true;
  if (options.eggs !== -1 && meetsEggLevel(info, options.eggs)) return true;
  // The reference reads `"feedPower" in xml` / `"XPBonus" in xml`; a zero value
  // is indistinguishable from an absent tag here and means the same thing.
  if (options.feedPower !== -1 && info.feedPower > 0
    && info.feedPower >= options.feedPower) return true;
  if (options.xpBonus !== -1 && info.xpBonus > 0
    && info.xpBonus >= options.xpBonus) return true;
  // Verbatim precedence from the reference's final `else if`: the second half is
  // not guarded by the option, so a stacking-family item is taken either way.
  return options.stackables && info.stackable
    || options.stackLimitedAlways && info.stackLimited;
}

function meetsTier(
  info: AutoLootItemInfo,
  minTier: number,
  slotTypes: readonly number[],
): boolean {
  return info.tier !== null && info.tier >= minTier && slotTypes.includes(info.slotType);
}

function meetsEggLevel(info: AutoLootItemInfo, minLevel: number): boolean {
  const level = EGG_RARITY_LEVELS.get(String(info.rarity ?? '').toLowerCase());
  return level !== undefined && level >= minLevel;
}

/**
 * `Player.autoLootBagTier`. The server's "Loot Bag N" definition number is the
 * bag's rarity; tier 5 is white. Brown and purple bags are deliberately absent
 * from the reference's fallback switch and resolve to -1.
 */
export function autoLootBagTier(bag: { objectType: number; definitionId?: string }): number {
  const match = /^Loot Bag (\d+)/.exec(bag.definitionId ?? '');
  if (match) {
    const tier = Number(match[1]);
    if (Number.isFinite(tier)) return Math.trunc(tier);
  }
  switch (bag.objectType) {
    case 0x050b: case 0x06be: return 5;
    case 0x050c: case 0x0510: return 6;
    case 0x050e: case 0x06bc: return 7;
    case 0x050f: case 0x06bf: return 8;
    case 0x06ac: case 0x06c0: return 9;
    default: return -1;
  }
}

// ------------------------------------------------------------------- snapshot

export interface AutoLootBag {
  objectId: number;
  objectType: number;
  /** Object definition id, e.g. `Loot Bag 5`; drives {@link autoLootBagTier}. */
  definitionId?: string;
  x: number;
  y: number;
  /** Slot index -> item type, -1 for empty. Only slots 0-7 are read. */
  slots: readonly number[];
}

/** A consumable-belt slot. `count` is undefined when the caller cannot see it. */
export interface AutoLootQuickSlot {
  slotId: number;
  itemType: number;
  count?: number;
}

export interface AutoLootSnapshot {
  inWorld: boolean;
  inVault: boolean;
  playerObjectId: number;
  position: { x: number; y: number };
  /** Item type per player slot id; index 0-3 are equipment. */
  inventory: readonly number[];
  /** Exclusive end of the usable range, i.e. `Player.inventoryEndIndex`. */
  inventoryEndIndex: number;
  quickSlots: readonly AutoLootQuickSlot[];
  /** The class's four equipped slot types, from the class object `<SlotTypes>`. */
  equipSlotTypes: readonly number[];
  /** Stat values and caps for `shouldDrink`; undefined when caps are unknown. */
  stats?: PotionStatSnapshot;
  /** Every visible container. Vault storage types are filtered out internally. */
  bags: readonly AutoLootBag[];
  /**
   * Client time of the most recent INVSWAP from any source. The reference shares
   * one 500 ms window between Auto Loot and manual swaps.
   */
  lastInvSwapAt: number | null;
}

export interface AutoLootActions {
  swap(from: SlotRef, to: SlotRef): boolean;
  /** Sends USEITEM against a bag slot, consuming the item where it lies. */
  useFromBag(slot: SlotRef): boolean;
}

export type AutoLootAction =
  | {
      kind: 'pickup';
      bagObjectId: number;
      bagSlotId: number;
      itemType: number;
      destinationSlotId: number;
      /** Item type displaced back into the bag, or -1 for an empty destination. */
      replacedItemType: number;
    }
  | {
      kind: 'consume';
      bagObjectId: number;
      bagSlotId: number;
      itemType: number;
      reason: 'rainbow' | 'inventory-full';
    };

export interface AutoLootState extends AutoLootOptions {
  enabled: boolean;
  lastActionAt: number | null;
  lastAction: AutoLootAction | null;
  quarantinedSlots: number;
  quarantinedItems: number;
}

/** Why a bag still holding wanted loot produced no action; `Player.autoLootBlockReason`. */
export type AutoLootBlockReason =
  | 'invalid_bag'
  | 'complete'
  | 'unavailable'
  | 'item_rejected'
  | 'inventory_full'
  | 'service_timeout';

// ----------------------------------------------------------------- controller

/**
 * Per-client Auto Loot state. Driven from Client's local frame alongside
 * {@link AutoCombatController}: it fires whenever the player is standing on a
 * container, which is exactly what Auto Play's bag approach arranges.
 */
export class AutoLootController {
  private enabled = false;
  private options: AutoLootOptions = { ...DEFAULT_AUTO_LOOT };
  private lastActionAt: number | null = null;
  private lastAction: AutoLootAction | null = null;
  /** Player slot id -> client time the 5 s quarantine expires. */
  private readonly rejectedSlots = new Map<number, number>();
  /** Item type -> client time the 30 s quarantine expires. */
  private readonly rejectedItems = new Map<number, number>();
  private inventoryEndIndex = 12;
  private equipSlotTypes: readonly number[] = [];
  private inventory: readonly number[] = [];

  constructor(private readonly data: AutoLootDataProvider) {}

  setEnabled(enabled: boolean): void {
    this.enabled = !!enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  configure(options: Partial<AutoLootOptions>): AutoLootOptions {
    const previous = this.options;
    this.options = {
      inVault: flag(options.inVault, previous.inVault),
      upgrades: flag(options.upgrades, previous.upgrades),
      weaponTier: tierOption(options.weaponTier, previous.weaponTier),
      abilityTier: tierOption(options.abilityTier, previous.abilityTier),
      armorTier: tierOption(options.armorTier, previous.armorTier),
      ringTier: tierOption(options.ringTier, previous.ringTier),
      xpBonus: thresholdOption(options.xpBonus, previous.xpBonus),
      feedPower: thresholdOption(options.feedPower, previous.feedPower),
      hpPots: flag(options.hpPots, previous.hpPots),
      mpPots: flag(options.mpPots, previous.mpPots),
      lifeManaPots: flag(options.lifeManaPots, previous.lifeManaPots),
      rainbowPots: flag(options.rainbowPots, previous.rainbowPots),
      consumeRainbowPots: flag(options.consumeRainbowPots, previous.consumeRainbowPots),
      skins: flag(options.skins, previous.skins),
      petSkins: flag(options.petSkins, previous.petSkins),
      keys: flag(options.keys, previous.keys),
      uts: flag(options.uts, previous.uts),
      marks: flag(options.marks, previous.marks),
      eggs: thresholdOption(options.eggs, previous.eggs),
      consumables: flag(options.consumables, previous.consumables),
      soulbound: flag(options.soulbound, previous.soulbound),
      stackables: flag(options.stackables, previous.stackables),
      stackLimitedAlways: flag(options.stackLimitedAlways, previous.stackLimitedAlways),
      excludes: Array.isArray(options.excludes) ? normalizeTypes(options.excludes) : previous.excludes,
      includes: Array.isArray(options.includes) ? normalizeTypes(options.includes) : previous.includes,
    };
    return { ...this.options };
  }

  getState(): AutoLootState {
    return {
      ...this.options,
      enabled: this.enabled,
      lastActionAt: this.lastActionAt,
      lastAction: this.lastAction,
      quarantinedSlots: this.rejectedSlots.size,
      quarantinedItems: this.rejectedItems.size,
    };
  }

  /** Drops map-scoped quarantines and timing. Object ids are reissued per map. */
  clearMap(): void {
    this.rejectedSlots.clear();
    this.rejectedItems.clear();
    this.lastActionAt = null;
    this.lastAction = null;
  }

  /**
   * `Player.onAutoLootSwapRejected`. Feed every rejected INVRESULT here: a
   * failure means one stale destination or an item restriction, not that the
   * whole backpack is unusable, so only the exact slot and item are quarantined.
   */
  noteSwapRejected(slotId: number, itemType: number, now: number): void {
    this.lastActionAt = now + REJECTION_BACKOFF_MS;
    if (slotId >= 4 && slotId < this.inventoryEndIndex) {
      this.rejectedSlots.set(slotId, now + REJECTED_SLOT_MS);
    }
    if (itemType >= 0) {
      this.rejectedItems.set(itemType, now + REJECTED_ITEM_MS);
    }
  }

  /**
   * Whether Auto Loot wants this item type at all, ignoring inventory space and
   * quarantines — `Player.hasDesiredAutoLootItem` per item. Auto Play uses this
   * to decide whether a bag is worth walking to.
   */
  wantsItemType(itemType: number): boolean {
    if (itemType <= 0) return false;
    const info = this.data.getItem(itemType);
    if (isDesiredLoot(itemType, info, this.options)) return true;
    if (this.options.consumeRainbowPots && isRainbowStat(potionStatType(itemType))) return true;
    return this.options.upgrades && this.checkForUpgrade(info);
  }

  /** One frame of `Player.autoLoot`. Returns the action taken, or null. */
  update(
    now: number,
    snapshot: AutoLootSnapshot,
    actions: AutoLootActions,
  ): AutoLootAction | null {
    this.inventoryEndIndex = snapshot.inventoryEndIndex;
    this.equipSlotTypes = snapshot.equipSlotTypes;
    this.inventory = snapshot.inventory;
    if (!this.enabled || !snapshot.inWorld) return null;
    if (snapshot.inVault && !this.options.inVault) return null;
    if (now - Math.max(snapshot.lastInvSwapAt ?? -Infinity, this.lastActionAt ?? -Infinity)
      <= ACTION_INTERVAL_MS) {
      return null;
    }

    const bag = this.selectBag(now, snapshot);
    if (!bag) return null;
    return this.serviceBag(now, snapshot, bag, actions);
  }

  /**
   * `Player.autoLootBlockReason`. Auto Play logs this once when it gives up on a
   * bag; it deliberately does not drive a retry.
   */
  blockReason(now: number, snapshot: AutoLootSnapshot, bag: AutoLootBag): AutoLootBlockReason {
    if (bag.slots.length === 0) return 'invalid_bag';
    const inventoryFull = this.nextFreeSlot(now, snapshot) === -1;
    let sawDesired = false;
    let sawRejected = false;
    let sawNoDestination = false;
    for (const { itemType } of bagItems(bag)) {
      const info = this.data.getItem(itemType);
      const potType = potionStatType(itemType);
      const drinkable = isRainbowStat(potType) && shouldDrinkStatPotion(potType, snapshot.stats);
      const desired = this.options.consumeRainbowPots && drinkable
        || isDesiredLoot(itemType, info, this.options)
        || this.options.upgrades && this.checkForUpgrade(info);
      if (!desired) continue;
      sawDesired = true;
      if (this.isItemQuarantined(itemType, now)) {
        sawRejected = true;
      } else if (drinkable
        || this.quickSlotFor(itemType, info, snapshot) !== null
        || !inventoryFull
        || this.replacementSlot(now, snapshot, bag, itemType) !== -1) {
        return 'service_timeout';
      } else {
        sawNoDestination = true;
      }
    }
    if (sawNoDestination) return 'inventory_full';
    if (sawRejected) return 'item_rejected';
    return sawDesired ? 'unavailable' : 'complete';
  }

  /**
   * Highest-tier eligible container within one tile, nearest on a tie. An
   * unknown or low-rarity bag still qualifies, but a white-or-better bag always
   * gets the transaction slot first.
   */
  private selectBag(now: number, snapshot: AutoLootSnapshot): AutoLootBag | null {
    let selected: AutoLootBag | null = null;
    let selectedTier = Number.NEGATIVE_INFINITY;
    let selectedDistance = Number.POSITIVE_INFINITY;
    for (const bag of snapshot.bags) {
      if (EXCLUDED_CONTAINER_TYPES.has(bag.objectType) || bag.slots.length === 0) continue;
      const distance = (snapshot.position.x - bag.x) ** 2 + (snapshot.position.y - bag.y) ** 2;
      if (distance > BAG_RANGE_SQUARED || !this.hasCandidate(now, snapshot, bag)) continue;
      const tier = Math.max(0, autoLootBagTier(bag));
      if (selected === null || tier > selectedTier
        || tier === selectedTier && distance < selectedDistance) {
        selected = bag;
        selectedTier = tier;
        selectedDistance = distance;
      }
    }
    return selected;
  }

  /** `Player.hasAutoLootCandidate`: is there anything here we can act on now? */
  private hasCandidate(now: number, snapshot: AutoLootSnapshot, bag: AutoLootBag): boolean {
    const inventoryFull = this.nextFreeSlot(now, snapshot) === -1;
    for (const { itemType } of bagItems(bag)) {
      if (this.isItemQuarantined(itemType, now)) continue;
      const info = this.data.getItem(itemType);
      if (!info) continue;
      const potType = potionStatType(itemType);
      const drinkable = isRainbowStat(potType) && shouldDrinkStatPotion(potType, snapshot.stats);
      if (this.options.consumeRainbowPots && drinkable) return true;
      if (!isDesiredLoot(itemType, info, this.options)
        && !(this.options.upgrades && this.checkForUpgrade(info))) {
        continue;
      }
      // A wanted item needs somewhere to go — unless it can be drunk in place,
      // which serviceBag falls back to when every destination is taken.
      if (drinkable
        || this.quickSlotFor(itemType, info, snapshot) !== null
        || !inventoryFull
        || this.replacementSlot(now, snapshot, bag, itemType) !== -1) {
        return true;
      }
    }
    return false;
  }

  private serviceBag(
    now: number,
    snapshot: AutoLootSnapshot,
    bag: AutoLootBag,
    actions: AutoLootActions,
  ): AutoLootAction | null {
    for (const { slotId, itemType } of bagItems(bag)) {
      if (this.isItemQuarantined(itemType, now)) continue;
      const info = this.data.getItem(itemType);
      if (!info) continue;
      const potType = potionStatType(itemType);
      const drinkable = isRainbowStat(potType) && shouldDrinkStatPotion(potType, snapshot.stats);

      if (this.options.consumeRainbowPots && drinkable) {
        const consumed = this.consume(now, bag, slotId, itemType, 'rainbow', actions);
        if (consumed) return consumed;
      }
      if (!isDesiredLoot(itemType, info, this.options)
        && !(this.options.upgrades && this.checkForUpgrade(info))) {
        continue;
      }
      const pickup = this.pickup(now, snapshot, bag, slotId, itemType, info, actions);
      if (pickup) return pickup;
      // Nowhere to put a wanted stat potion. Drinking it out of the bag beats
      // abandoning it there, and the bag it blocks would despawn with whatever
      // else is inside. shouldDrink already ruled out a maxed stat.
      if (drinkable
        && this.nextFreeSlot(now, snapshot) === -1
        && this.quickSlotFor(itemType, info, snapshot) === null
        && this.replacementSlot(now, snapshot, bag, itemType) === -1) {
        const consumed = this.consume(now, bag, slotId, itemType, 'inventory-full', actions);
        if (consumed) return consumed;
      }
    }
    return null;
  }

  /**
   * `Player.pickup`: stack onto a matching consumable-belt slot, else take the
   * first free inventory slot, else sacrifice a stat potion for a white-or-better
   * drop. The INVSWAP is atomic, so no speculative INVDROP is needed.
   */
  private pickup(
    now: number,
    snapshot: AutoLootSnapshot,
    bag: AutoLootBag,
    bagSlotId: number,
    itemType: number,
    info: AutoLootItemInfo,
    actions: AutoLootActions,
  ): AutoLootAction | null {
    const quickSlot = this.quickSlotFor(itemType, info, snapshot);
    if (quickSlot !== null) {
      return this.sendPickup(now, snapshot, bag, bagSlotId, itemType, quickSlot, itemType, actions);
    }
    const free = this.nextFreeSlot(now, snapshot);
    if (free !== -1) {
      return this.sendPickup(now, snapshot, bag, bagSlotId, itemType, free, -1, actions);
    }
    const replacement = this.replacementSlot(now, snapshot, bag, itemType);
    if (replacement === -1) return null;
    return this.sendPickup(
      now, snapshot, bag, bagSlotId, itemType,
      replacement, snapshot.inventory[replacement] ?? -1, actions,
    );
  }

  private sendPickup(
    now: number,
    snapshot: AutoLootSnapshot,
    bag: AutoLootBag,
    bagSlotId: number,
    itemType: number,
    destinationSlotId: number,
    replacedItemType: number,
    actions: AutoLootActions,
  ): AutoLootAction | null {
    const sent = actions.swap(
      { objectId: bag.objectId, slotId: bagSlotId, itemType },
      { objectId: snapshot.playerObjectId, slotId: destinationSlotId, itemType: replacedItemType },
    );
    if (!sent) return null;
    this.lastActionAt = now;
    this.lastAction = {
      kind: 'pickup',
      bagObjectId: bag.objectId,
      bagSlotId,
      itemType,
      destinationSlotId,
      replacedItemType,
    };
    return this.lastAction;
  }

  private consume(
    now: number,
    bag: AutoLootBag,
    bagSlotId: number,
    itemType: number,
    reason: 'rainbow' | 'inventory-full',
    actions: AutoLootActions,
  ): AutoLootAction | null {
    if (!actions.useFromBag({ objectId: bag.objectId, slotId: bagSlotId, itemType })) return null;
    this.lastActionAt = now;
    this.lastAction = { kind: 'consume', bagObjectId: bag.objectId, bagSlotId, itemType, reason };
    return this.lastAction;
  }

  /** `Player.nextAutoLootInventorySlot`, honouring the 5 s slot quarantine. */
  private nextFreeSlot(now: number, snapshot: AutoLootSnapshot): number {
    for (let slotId = 4; slotId < snapshot.inventoryEndIndex; slotId++) {
      if (this.isSlotQuarantined(slotId, now)) continue;
      if ((snapshot.inventory[slotId] ?? -1) === -1) return slotId;
    }
    return -1;
  }

  /**
   * `Player.nextAutoLootReplacementSlot`. Only a white-or-better bag justifies
   * displacing something already carried, the incoming item must not itself be a
   * stat potion, and only stat potions are ever sacrificed — a potion for an
   * already-maxed stat first, then any other. Equipment, HP/MP and life/mana
   * potions are never selected.
   */
  private replacementSlot(
    now: number,
    snapshot: AutoLootSnapshot,
    bag: AutoLootBag,
    incomingItemType: number,
  ): number {
    if (autoLootBagTier(bag) < REPLACEMENT_MIN_BAG_TIER
      || RAINBOW_POTION_TYPES.includes(incomingItemType)) {
      return -1;
    }
    let fallback = -1;
    for (let slotId = 4; slotId < snapshot.inventoryEndIndex; slotId++) {
      if (this.isSlotQuarantined(slotId, now)) continue;
      const currentItemType = snapshot.inventory[slotId] ?? -1;
      if (!RAINBOW_POTION_TYPES.includes(currentItemType)) continue;
      const potType = potionStatType(currentItemType);
      if (isRainbowStat(potType) && !shouldDrinkStatPotion(potType, snapshot.stats)) {
        return slotId;
      }
      if (fallback === -1) fallback = slotId;
    }
    return fallback;
  }

  /**
   * `Player.hasQuickSlotSpace`: a belt slot already holding this item with room
   * left in the stack. Returns null when no belt slot qualifies.
   *
   * The reference tracks stack counts locally; the headless client only sees the
   * belt's item types, so a slot whose count is unknown is treated as unusable.
   * That is strictly conservative — the item goes to ordinary inventory instead,
   * which the server always accepts.
   */
  private quickSlotFor(
    itemType: number,
    info: AutoLootItemInfo | undefined,
    snapshot: AutoLootSnapshot,
  ): number | null {
    if (!info || info.maxQuickStack < 0) return null;
    for (const quickSlot of snapshot.quickSlots) {
      if (quickSlot.itemType !== itemType || quickSlot.count === undefined) continue;
      if (quickSlot.count < info.maxQuickStack) return quickSlot.slotId;
    }
    return null;
  }

  /**
   * `Player.checkForUpgrade`: the candidate fits one of the class's four equip
   * slots and either that slot is empty or the candidate outranks what is in it.
   * Untiered candidates never qualify, matching the reference's sentinel tier.
   */
  private checkForUpgrade(candidate: AutoLootItemInfo | undefined): boolean {
    if (!candidate || candidate.slotType < 0) return false;
    for (let slotIndex = 0; slotIndex < 4; slotIndex++) {
      if (this.equipSlotTypes[slotIndex] !== candidate.slotType) continue;
      const equippedType = this.inventory[slotIndex] ?? -1;
      if (equippedType === -1) return true;
      const equipped = this.data.getItem(equippedType);
      if (equipped?.tier != null && candidate.tier !== null && candidate.tier > equipped.tier) {
        return true;
      }
    }
    return false;
  }

  private isSlotQuarantined(slotId: number, now: number): boolean {
    return expired(this.rejectedSlots, slotId, now);
  }

  private isItemQuarantined(itemType: number, now: number): boolean {
    return expired(this.rejectedItems, itemType, now);
  }
}

// ------------------------------------------------------------------- helpers

function* bagItems(bag: AutoLootBag): Generator<{ slotId: number; itemType: number }> {
  const end = Math.min(bag.slots.length, 8);
  for (let slotId = 0; slotId < end; slotId++) {
    const itemType = bag.slots[slotId] ?? -1;
    if (itemType !== -1) yield { slotId, itemType };
  }
}

/** Pot types 0-5 are the six rainbow stats; 6 and 7 are life and mana. */
function isRainbowStat(potType: number): boolean {
  return potType >= 0 && potType <= 5;
}

/** Reads a quarantine map, dropping the entry once it has lapsed. */
function expired(quarantine: Map<number, number>, key: number, now: number): boolean {
  const until = quarantine.get(key);
  if (until === undefined) return false;
  if (until <= now) {
    quarantine.delete(key);
    return false;
  }
  return true;
}

/**
 * Options arrive from JSON (the web panel), so a non-boolean must not be taken
 * for its truthiness — it leaves the previous setting alone instead.
 */
function flag(value: boolean | undefined, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function tierOption(value: number | undefined, fallback: number): number {
  const tier = Number(value);
  if (!Number.isInteger(tier) || tier < 0) return fallback;
  return tier;
}

/** Threshold options accept -1 as their explicit "Off" value. */
function thresholdOption(value: number | undefined, fallback: number): number {
  const threshold = Number(value);
  if (!Number.isInteger(threshold) || threshold < -1) return fallback;
  return threshold;
}

function normalizeTypes(values: readonly number[]): number[] {
  return [...new Set(values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0))];
}
