export type LootRarity =
  | 'brown'
  | 'pink'
  | 'white'
  | 'purple'
  | 'egg'
  | 'cyan'
  | 'blue'
  | 'orange'
  | 'red'
  // Legacy aliases retained for existing scripts.
  | 'green'
  | 'common'
  | 'unknown';

export interface LootEnchantment {
  type: number;
  id?: string;
  name?: string;
  description?: string;
  labels: string[];
}

export interface LootItemEnchantments {
  /** Original base64url value supplied by stat 80 for this slot. */
  raw: string;
  isEmpty: boolean;
  slotCount: number;
  typeIds: number[];
  entries: LootEnchantment[];
  /** Unparsed bytes following the declared enchantment slots. */
  suffixHex: string;
}

export interface LootBag {
  objectId: number;
  bagType: number;
  rarity: LootRarity;
  position: { x: number; y: number };
  items: LootItem[];
  droppedAt: number;
  ownerName?: string;
  ownerAccountId?: string;
}

export interface LootItem {
  objectType: number;
  slotIndex: number;
  itemName?: string;
  /** Undefined when the server did not publish stat 80 for this container. */
  enchantments?: LootItemEnchantments;
}

export interface LootDropEvent {
  bag: LootBag;
}

export interface LootItemEvent {
  bag: LootBag;
  item: LootItem;
}

/**
 * Item-filter options for `loot.shouldPickup()` and `loot.pickup()`.
 * All tier thresholds are inclusive minimums. Omitting a field uses the default shown.
 */
export interface PickupOptions {
  /** Minimum weapon tier to accept (e.g. 11). Omit = no tier floor. */
  minWeaponTier?: number;
  /** Minimum ability tier to accept (e.g. 6). Omit = no tier floor. */
  minAbilityTier?: number;
  /** Minimum armor tier to accept (e.g. 11). Omit = no tier floor. */
  minArmorTier?: number;
  /** Minimum ring tier to accept (e.g. 6). Omit = no tier floor. */
  minRingTier?: number;
  /** Accept UT-tier gear items (default: true). */
  includeUTs?: boolean;
  /** Accept ST items (default: false). */
  includeSTs?: boolean;
  /** Accept HP potions (default: false). */
  includeHpPotions?: boolean;
  /** Accept MP potions (default: false). */
  includeMpPotions?: boolean;
  /** Accept stat potions like Att/Def/Spd/Vit/Wis/Dex pots (default: true). */
  includeStatPotions?: boolean;
  /** Accept life/mana potions (default: true). */
  includeLifeManaPotions?: boolean;
  /** Accept items whose name contains "Mark of " (default: false). */
  includeMarks?: boolean;
  /** Accept items whose name ends with " Egg" (default: false). */
  includeEggs?: boolean;
  /** Object type IDs that are always accepted regardless of other filters. */
  whitelist?: number[];
  /** Object type IDs that are always rejected regardless of other filters. */
  blacklist?: number[];
}
