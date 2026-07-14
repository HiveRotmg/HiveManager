import type {
  LootBag,
  LootItem,
  LootDropEvent,
  LootItemEvent,
  LootRarity,
  PickupOptions,
} from './types/loot';
import type { Unsubscribe } from './types/events';
import type { Item } from './types/items/Item';

const noopUnsub: Unsubscribe = () => {};

export const loot = {
  // ─── Bag queries ────────────────────────────────────────────────────────────
  getBags(): LootBag[] {
    return [];
  },

  getNearbyBags(_radius?: number): LootBag[] {
    return [];
  },

  getBagsByRarity(_rarity: LootRarity): LootBag[] {
    return [];
  },

  getBagsContaining(_objectType: number): LootBag[] {
    return [];
  },

  // ─── Events ─────────────────────────────────────────────────────────────────
  onBagDropped(handler: (e: LootDropEvent) => void): Unsubscribe {
    void handler;
    return noopUnsub;
  },

  onRareBagDropped(_minRarity: LootRarity, handler: (e: LootDropEvent) => void): Unsubscribe {
    void handler;
    return noopUnsub;
  },

  onItemDropped(_objectType: number, handler: (e: LootItemEvent) => void): Unsubscribe {
    void handler;
    return noopUnsub;
  },

  onBagRemoved(handler: (e: LootDropEvent) => void): Unsubscribe {
    void handler;
    return noopUnsub;
  },

  // ─── Pickup actions ─────────────────────────────────────────────────────────

  /**
   * Send an INVENTORYSWAP packet to pick up the item in the given bag slot.
   * Automatically finds the first free inventory/backpack slot.
   * Returns `true` if the packet was sent, `false` if the slot is empty, full, or not connected.
   */
  pickup(_bag: LootBag, _slotIndex: number, _opts?: { useBackpack?: boolean }): boolean {
    return false;
  },

  /** Swap a bag item directly with a specific player inventory/equipment slot. */
  pickupToSlot(_bag: LootBag, _slotIndex: number, _inventorySlotIndex: number): boolean {
    return false;
  },

  /**
   * Send a USEITEM packet to use (drink/apply) the item directly from the bag slot.
   * Use this for stat potions — they are consumed in place rather than moved to inventory.
   * Returns `true` if the packet was sent.
   */
  useFromBag(_bag: LootBag, _slotIndex: number): boolean {
    return false;
  },

  /**
   * Pick up all items from the bag with the given objectId, provided the bag is
   * within `maxDistance` tiles of the player (default: 1.0).
   * Sends one INVENTORYSWAP per non-empty slot, tracking claimed destinations within
   * the call so the same inventory slot is never targeted twice.
   *
   * Returns the number of INVENTORYSWAP packets sent, or `-1` if the bag was not
   * found in the world or is outside the distance threshold.
   */
  pickupId(_bagObjectId: number, _opts?: { maxDistance?: number; useBackpack?: boolean }): number {
    return -1;
  },

  // ─── Item classification ─────────────────────────────────────────────────────

  /**
   * Check whether an item should be picked up based on the supplied filter options.
   * Uses the same tier / UT / ST / potion / whitelist / blacklist logic as the Auto Loot plugin.
   */
  shouldPickup(_objectType: number, _opts?: PickupOptions): boolean {
    return false;
  },

  /** Static item metadata for a ground/inventory object type. */
  getItemInfo(_objectType: number): Item | null { return null; },

  /** Returns `true` if the objectType is a UT-tier gear item. */
  isUT(_objectType: number): boolean { return false; },

  /** Returns `true` if the objectType is an ST item. */
  isST(_objectType: number): boolean { return false; },

  /** Returns `true` if the objectType is a stat potion (Att/Def/Spd/Vit/Wis/Dex pot). */
  isStatPot(_objectType: number): boolean { return false; },

  /** Returns `true` if the objectType is an HP potion. */
  isHpPot(_objectType: number): boolean { return false; },

  /** Returns `true` if the objectType is an MP potion. */
  isMpPot(_objectType: number): boolean { return false; },

  /** Returns `true` if the objectType is a life or mana potion (permanent stat increase). */
  isLifeManaPot(_objectType: number): boolean { return false; },
};

export type {
  LootBag,
  LootItem,
  LootEnchantment,
  LootItemEnchantments,
  LootRarity,
  LootDropEvent,
  LootItemEvent,
  PickupOptions,
} from './types/loot';
