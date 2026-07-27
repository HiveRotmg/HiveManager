import { ConditionEffectBits } from 'realmlib';
import type { SlotRef } from './inventory';

/**
 * Auto HP/MP potion drinking and the Priest-style auto heal, ported from
 * `Player.checkHealth` / `Player.checkMana` / `Player.priestHeal`.
 *
 * Two things matter for parity. First, the reference tests **three** health
 * figures (server hp, locally predicted client hp, and the synced baseline) and
 * drinks when any of them crosses the threshold — the same model
 * {@link AutoNexusMonitor} already maintains, so the caller supplies its lowest
 * figure rather than raw server HP. Second, HP and MP have independent delays.
 */

// -------------------------------------------------------------- potion tables

/** `Parameters.hpPotions`. */
export const HP_POTION_TYPES: readonly number[] = [
  2736, 16874, 1799, 2594, 2868, 2870, 2872, 2874, 2876, 2836, 2837, 2838, 2839,
  2689, 2632, 2633, 2795, 3105, 3090, 3164, 3163, 3265, 9077, 10244, 10243, 28901,
];

/** `Parameters.mpPotions`. */
export const MP_POTION_TYPES: readonly number[] = [
  2595, 2634, 2797, 2798, 2840, 2841, 2842, 2843, 2796, 2869, 2871, 2873, 2875,
  2877, 3098,
];

/** `Parameters.lmPotions` — Life and Mana (permanent max HP/MP) potions. */
export const LIFE_MANA_POTION_TYPES: readonly number[] = [
  2793, 9070, 5471, 9730, 2794, 9071, 5472, 9731,
];

/** `Parameters.raPotions` — the six "rainbow" stat potions in all four grades. */
export const RAINBOW_POTION_TYPES: readonly number[] = [
  2591, 5465, 9064, 9729,
  2592, 5466, 9065, 9727,
  2593, 5467, 9066, 9726,
  2612, 5468, 9067, 9724,
  2613, 5469, 9068, 9725,
  2636, 5470, 9069, 9728,
];

/**
 * The only ids `Player.lookForMpPotAndDrink` scans for. This is deliberately
 * narrower than {@link MP_POTION_TYPES}: the reference looting filter accepts
 * every MP potion but its drinking path only ever consumes these two.
 */
export const MP_DRINK_TYPES: readonly number[] = [2595, 3098];

/**
 * `Player.getPotType`: 0 attack, 1 defense, 2 speed, 3 dexterity, 4 vitality,
 * 5 wisdom, 6 life, 7 mana, -1 for anything else. Note that the reference maps
 * dexterity to 3 and vitality to 4 even though the item ids run in the other
 * order, so the numbering is preserved verbatim rather than re-derived.
 */
export function potionStatType(itemType: number): number {
  switch (itemType) {
    case 2591: case 5465: case 9064: case 9729: return 0;
    case 2592: case 5466: case 9065: case 9727: return 1;
    case 2593: case 5467: case 9066: case 9726: return 2;
    case 2636: case 5470: case 9069: case 9728: return 3;
    case 2612: case 5468: case 9067: case 9724: return 4;
    case 2613: case 5469: case 9068: case 9725: return 5;
    case 2793: case 5471: case 9070: return 6;
    case 2794: case 5472: case 9071: return 7;
    default: return -1;
  }
}

/** Current value and the boost portion of one drinkable stat. */
export interface PotionStat {
  value: number;
  boost: number;
}

/** The eight stats {@link potionStatType} can address, plus their 8/8 caps. */
export interface PotionStatSnapshot {
  attack: PotionStat;
  defense: PotionStat;
  speed: PotionStat;
  dexterity: PotionStat;
  vitality: PotionStat;
  wisdom: PotionStat;
  maxHp: PotionStat;
  maxMp: PotionStat;
  maximums: {
    attack: number;
    defense: number;
    speed: number;
    dexterity: number;
    vitality: number;
    wisdom: number;
    maxHp: number;
    maxMp: number;
  };
}

/**
 * `Player.shouldDrink`: whether the un-boosted base stat is still below its
 * class maximum. Life/mana use the reference's `ceil(remaining * 0.2) > 0`
 * form, which is equivalent to `remaining > 0` but kept verbatim.
 *
 * Returns false when the caller could not resolve the class caps, so an unknown
 * class never wastes a sellable potion.
 */
export function shouldDrinkStatPotion(potType: number, stats: PotionStatSnapshot | undefined): boolean {
  if (!stats) return false;
  const { maximums } = stats;
  switch (potType) {
    case 0: return maximums.attack - (stats.attack.value - stats.attack.boost) > 0;
    case 1: return maximums.defense - (stats.defense.value - stats.defense.boost) > 0;
    case 2: return maximums.speed - (stats.speed.value - stats.speed.boost) > 0;
    case 3: return maximums.dexterity - (stats.dexterity.value - stats.dexterity.boost) > 0;
    case 4: return maximums.vitality - (stats.vitality.value - stats.vitality.boost) > 0;
    case 5: return maximums.wisdom - (stats.wisdom.value - stats.wisdom.boost) > 0;
    case 6: return Math.ceil((maximums.maxHp - (stats.maxHp.value - stats.maxHp.boost)) * 0.2) > 0;
    case 7: return Math.ceil((maximums.maxMp - (stats.maxMp.value - stats.maxMp.boost)) * 0.2) > 0;
    default: return false;
  }
}

// ------------------------------------------------------------------- controller

export interface AutoConsumablesOptions {
  /** `autoHPPercent`: drink an HP potion at or below this percent. 0 disables. */
  hpPercent: number;
  /** `autohpPotDelay`, in milliseconds. */
  hpPotDelayMs: number;
  /**
   * `autoMPPercent`: drink an MP potion at or below this percent. 0 disables;
   * -1 is the reference's "Abil %" mode — drink whenever current MP has fallen
   * to the equipped ability's MP cost.
   */
  mpPercent: number;
  /** `autompPotDelay`, in milliseconds. */
  mpPotDelayMs: number;
  /**
   * `AutoHealPercentage`: use a self-healing ability at or below this percent.
   * 0 disables. The reference gates this on the Priest class; here it is gated
   * on the equipped ability actually having a heal effect.
   */
  autoHealPercent: number;
  /**
   * `autoDrinkFromBags`. The reference declares this option but never reads it,
   * so the behaviour here is a deliberate extension: when no HP/MP potion is
   * carried, drink one straight out of an adjacent loot bag. Off by default,
   * matching the reference default.
   */
  drinkFromBags: boolean;
}

/** A consumable-belt slot. `count` is undefined when the caller cannot see it. */
export interface AutoConsumablesQuickSlot {
  slotId: number;
  itemType: number;
  count?: number;
}

/** An adjacent container whose slots {@link AutoConsumablesOptions.drinkFromBags} may use. */
export interface AutoConsumablesBag {
  objectId: number;
  /** Slot index -> item type, -1 for empty. */
  slots: readonly number[];
}

export interface AutoConsumablesSnapshot {
  inWorld: boolean;
  /** `GameSprite.isSafeMap`; the reference skips every check on a safe map. */
  safeMap: boolean;
  playerObjectId: number;
  /**
   * The lowest of server HP, predicted client HP and the synced baseline —
   * `AutoNexusMonitor.getState()` exposes all three. Null before the first
   * authoritative sample.
   */
  hp: number | null;
  maxHp: number | null;
  mp: number;
  maxMp: number;
  condition: number;
  /** Item type per player slot id; index 0-3 are equipment. */
  inventory: readonly number[];
  /**
   * Exclusive end of the usable inventory range, i.e. `Player.inventoryEndIndex`
   * (12 without a backpack, 20 with one).
   */
  inventoryEndIndex: number;
  quickSlots: readonly AutoConsumablesQuickSlot[];
  /** MP cost of the equipped ability, for the `mpPercent = -1` mode. */
  abilityMpCost: number | null;
  /** Whether the equipped ability heals the player. */
  abilityHeals: boolean;
  /** Containers within reach, nearest first. */
  bags: readonly AutoConsumablesBag[];
}

export interface AutoConsumablesActions {
  useItem(slot: SlotRef): boolean;
  useAbilityAtSelf(): boolean;
}

export interface AutoConsumablesState extends AutoConsumablesOptions {
  enabled: boolean;
  lastHpPotAt: number | null;
  lastMpPotAt: number | null;
  lastHealAt: number | null;
}

/** ProdMafia's `Parameters` defaults for every option above. */
export const DEFAULT_AUTO_CONSUMABLES: AutoConsumablesOptions = {
  hpPercent: 40,
  hpPotDelayMs: 400,
  mpPercent: -1,
  mpPotDelayMs: 200,
  autoHealPercent: 99,
  drinkFromBags: false,
};

/**
 * The reference has no explicit cooldown on the heal ability — `priestHeal` is
 * called from the auto-ability path, which already paces itself. This controller
 * drives the ability directly, so it needs its own floor; the value matches
 * `DEFAULT_ABILITY_COOLDOWN_MS` in auto-combat.
 */
const AUTO_HEAL_COOLDOWN_MS = 550;

export class AutoConsumablesController {
  private enabled = false;
  private options: AutoConsumablesOptions = { ...DEFAULT_AUTO_CONSUMABLES };
  private lastHpPotAt: number | null = null;
  private lastMpPotAt: number | null = null;
  private lastHealAt: number | null = null;

  setEnabled(enabled: boolean): void {
    this.enabled = !!enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  configure(options: Partial<AutoConsumablesOptions>): AutoConsumablesOptions {
    this.options = {
      // -1 is meaningful for mpPercent only; every other field is non-negative.
      hpPercent: clampPercent(options.hpPercent, this.options.hpPercent),
      hpPotDelayMs: nonNegative(options.hpPotDelayMs, this.options.hpPotDelayMs),
      mpPercent: options.mpPercent === -1
        ? -1
        : clampPercent(options.mpPercent, this.options.mpPercent),
      mpPotDelayMs: nonNegative(options.mpPotDelayMs, this.options.mpPotDelayMs),
      autoHealPercent: clampPercent(options.autoHealPercent, this.options.autoHealPercent),
      drinkFromBags: typeof options.drinkFromBags === 'boolean'
        ? options.drinkFromBags
        : this.options.drinkFromBags,
    };
    return { ...this.options };
  }

  getState(): AutoConsumablesState {
    return {
      ...this.options,
      enabled: this.enabled,
      lastHpPotAt: this.lastHpPotAt,
      lastMpPotAt: this.lastMpPotAt,
      lastHealAt: this.lastHealAt,
    };
  }

  /** Drops per-character timing state. Call on map change / reconnect. */
  clear(): void {
    this.lastHpPotAt = null;
    this.lastMpPotAt = null;
    this.lastHealAt = null;
  }

  /**
   * One frame of `checkHealth` + `checkMana`. Returns the action taken, or null.
   * At most one action fires per call, matching the reference's early returns.
   */
  update(
    now: number,
    snapshot: AutoConsumablesSnapshot,
    actions: AutoConsumablesActions,
  ): 'hp-potion' | 'mp-potion' | 'heal' | null {
    if (!this.enabled || !snapshot.inWorld || snapshot.safeMap) return null;
    if (this.drinkHpPotion(now, snapshot, actions)) return 'hp-potion';
    if (this.useHealAbility(now, snapshot, actions)) return 'heal';
    if (this.drinkMpPotion(now, snapshot, actions)) return 'mp-potion';
    return null;
  }

  private drinkHpPotion(
    now: number,
    snapshot: AutoConsumablesSnapshot,
    actions: AutoConsumablesActions,
  ): boolean {
    const threshold = hpThreshold(this.options.hpPercent, snapshot.maxHp);
    if (threshold === null || snapshot.hp === null || snapshot.hp > threshold) return false;
    // SICK suppresses healing entirely, so a potion would be wasted.
    if ((snapshot.condition & ConditionEffectBits.SICK) !== 0) return false;
    if (this.lastHpPotAt !== null && now - this.lastHpPotAt <= this.options.hpPotDelayMs) {
      return false;
    }
    if (!this.drink(snapshot, actions, HP_POTION_TYPES)) return false;
    this.lastHpPotAt = now;
    return true;
  }

  private drinkMpPotion(
    now: number,
    snapshot: AutoConsumablesSnapshot,
    actions: AutoConsumablesActions,
  ): boolean {
    if (this.options.mpPercent === 0) return false;
    if ((snapshot.condition & ConditionEffectBits.QUIET) !== 0) return false;
    if (this.lastMpPotAt !== null && now - this.lastMpPotAt < this.options.mpPotDelayMs) {
      return false;
    }
    if (this.options.mpPercent < 0) {
      // "Abil %": top up as soon as MP can no longer pay for the ability.
      if (snapshot.abilityMpCost === null || snapshot.mp > snapshot.abilityMpCost) return false;
    } else {
      if (snapshot.maxMp <= 0) return false;
      if (snapshot.mp > this.options.mpPercent * 0.01 * snapshot.maxMp) return false;
    }
    if (!this.drink(snapshot, actions, MP_DRINK_TYPES)) return false;
    this.lastMpPotAt = now;
    return true;
  }

  private useHealAbility(
    now: number,
    snapshot: AutoConsumablesSnapshot,
    actions: AutoConsumablesActions,
  ): boolean {
    const threshold = hpThreshold(this.options.autoHealPercent, snapshot.maxHp);
    if (threshold === null || !snapshot.abilityHeals) return false;
    if (snapshot.hp === null || snapshot.hp > threshold) return false;
    if ((snapshot.condition & ConditionEffectBits.SICK) !== 0) return false;
    if (this.lastHealAt !== null && now - this.lastHealAt < AUTO_HEAL_COOLDOWN_MS) return false;
    if (!actions.useAbilityAtSelf()) return false;
    this.lastHealAt = now;
    return true;
  }

  /**
   * Reference order: inventory slots 4..end first, then the consumable belt,
   * then (as an extension) an adjacent bag.
   *
   * The reference only scans the belt for HP, not MP — an asymmetry that looks
   * accidental, so the belt is searched for both here. It makes no difference
   * today because Client cannot see belt contents and passes an empty list.
   */
  private drink(
    snapshot: AutoConsumablesSnapshot,
    actions: AutoConsumablesActions,
    types: readonly number[],
  ): boolean {
    for (let slotId = 4; slotId < snapshot.inventoryEndIndex; slotId++) {
      const itemType = snapshot.inventory[slotId] ?? -1;
      if (!types.includes(itemType)) continue;
      if (actions.useItem({ objectId: snapshot.playerObjectId, slotId, itemType })) return true;
    }
    for (const quickSlot of snapshot.quickSlots) {
      if (!types.includes(quickSlot.itemType)) continue;
      if (quickSlot.count !== undefined && quickSlot.count <= 0) continue;
      if (actions.useItem({
        objectId: snapshot.playerObjectId,
        slotId: quickSlot.slotId,
        itemType: quickSlot.itemType,
      })) {
        return true;
      }
    }
    if (!this.options.drinkFromBags) return false;
    for (const bag of snapshot.bags) {
      for (let slotId = 0; slotId < bag.slots.length; slotId++) {
        const itemType = bag.slots[slotId] ?? -1;
        if (!types.includes(itemType)) continue;
        if (actions.useItem({ objectId: bag.objectId, slotId, itemType })) return true;
      }
    }
    return false;
  }
}

/** The reference treats a zero percentage as "off" rather than "at 0 HP". */
function hpThreshold(percent: number, maxHp: number | null): number | null {
  if (percent <= 0 || maxHp === null || maxHp <= 0) return null;
  return percent * 0.01 * maxHp;
}

function clampPercent(value: number | undefined, fallback: number): number {
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent < 0) return fallback;
  return Math.min(100, percent);
}

function nonNegative(value: number | undefined, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}
