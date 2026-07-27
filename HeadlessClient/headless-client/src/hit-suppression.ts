/**
 * Hit-suppression safety layer ported from ProdMafia.
 *
 * Sources:
 * - `Player.playerHitSuppressionReason` / `damageIsLethal` / `strategicAckSuppresses`
 * - `AutoDodgeController.shouldSuppressStrategicHit` / `updateStrategicThresholds`
 * - `Projectile.update` debuff-ignore PLAYERHIT gate (`ssdebuffBitmask` / `ssdebuffBitmask2`)
 * - `Options.calculateIgnoreBitmask` + `Parameters` defaults
 * - `GameServerConnectionConcrete` AutoSync ClientHP + Strategic AoE Suppression
 */

/** Why a projectile hit is dropped entirely (no local HP, no PLAYERHIT). */
export type PlayerHitSuppressionReason =
  | 'partial_godmode'
  | 'buddha'
  | 'strategic_ack';

/** ProdMafia `Parameters` / Options defaults for ignore-* toggles. */
export interface IgnoreDebuffOptions {
  ignoreQuiet: boolean;
  ignoreWeak: boolean;
  ignoreSlowed: boolean;
  ignoreSick: boolean;
  ignoreDazed: boolean;
  ignoreStunned: boolean;
  ignoreParalyzed: boolean;
  ignoreBleeding: boolean;
  ignoreArmorBroken: boolean;
  ignorePetStasis: boolean;
  ignorePetrified: boolean;
  ignoreSilenced: boolean;
  /** Client-sided visual ignore (`ccdebuffBitmask`); does not suppress PLAYERHIT. */
  ignoreBlind: boolean;
  ignoreHallucinating: boolean;
  ignoreDrunk: boolean;
  ignoreConfused: boolean;
  ignoreUnstable: boolean;
  ignoreDarkness: boolean;
}

/** Runtime bitmasks produced by `Options.calculateIgnoreBitmask`. */
export interface IgnoreDebuffBitmasks {
  /** Server-sided ack-suppression mask for condition indices ≤ 32. */
  ssdebuffBitmask: number;
  /** Server-sided ack-suppression mask for condition indices > 32. */
  ssdebuffBitmask2: number;
  /**
   * Client-sided visual ignore mask (`GameObject.isBlind_` etc.). Stored for
   * parity; a headless client has no render path that reads it.
   */
  ccdebuffBitmask: number;
}

/** Tunables for Buddha / strategic ack / AutoSync. */
export interface HitSuppressionOptions {
  /** `Parameters.data.buddhaMode` — default false. */
  buddhaMode: boolean;
  /**
   * `Parameters.data.autoDodgeStrategicAckSuppression` — default true
   * (setDefault value; Options comment historically said OFF).
   */
  strategicAckSuppression: boolean;
  /** `Parameters.data.autoDodgeSuppressAoeAck` — default false. */
  strategicAoeSuppression: boolean;
  /** `Parameters.data.autoDodgeSuppressThreshold` — percent of max HP, default 10. */
  suppressThresholdPercent: number;
  /**
   * `Parameters.data.AutoSyncClientHP` — force predicted HP to server HP when
   * they diverge by more than 60 for several consecutive NEWTICK samples.
   * Default false.
   */
  autoSyncClientHp: boolean;
  ignoreDebuffs: IgnoreDebuffOptions;
}

export const DEFAULT_IGNORE_DEBUFF_OPTIONS: IgnoreDebuffOptions = {
  ignoreQuiet: false,
  ignoreWeak: false,
  ignoreSlowed: false,
  ignoreSick: false,
  ignoreDazed: false,
  ignoreStunned: false,
  ignoreParalyzed: false,
  ignoreBleeding: false,
  ignoreArmorBroken: false,
  ignorePetStasis: false,
  ignorePetrified: false,
  ignoreSilenced: false,
  ignoreBlind: true,
  ignoreHallucinating: true,
  ignoreDrunk: true,
  ignoreConfused: true,
  ignoreUnstable: false,
  ignoreDarkness: true,
};

export const DEFAULT_HIT_SUPPRESSION_OPTIONS: HitSuppressionOptions = {
  buddhaMode: false,
  strategicAckSuppression: true,
  strategicAoeSuppression: false,
  suppressThresholdPercent: 10,
  autoSyncClientHp: false,
  ignoreDebuffs: { ...DEFAULT_IGNORE_DEBUFF_OPTIONS },
};

/** `|clientHp - serverHp| > 60` gate from GSCC AutoSync ClientHP. */
export const AUTO_SYNC_CLIENT_HP_DELTA = 60;

/**
 * Consecutive diverged NEWTICK samples required before sync (`ticksOff > 3`).
 * Options text says "600ms"; the code counts four prior ticks then syncs on the
 * fifth, which is what we port.
 */
export const AUTO_SYNC_CLIENT_HP_TICKS = 3;

/**
 * `Options.calculateIgnoreBitmask` — bit values are `1 << conditionIndex` for
 * the first word and `1 << (conditionIndex - 32)` for the second, matching the
 * Quiet=2 → bit 4 layout (not `ConditionEffectBits`, which uses `1 << (index-1)`).
 */
export function calculateIgnoreBitmasks(
  options: Partial<IgnoreDebuffOptions> = {},
): IgnoreDebuffBitmasks {
  const opts = { ...DEFAULT_IGNORE_DEBUFF_OPTIONS, ...options };
  let ss = 0;
  let ss2 = 0;
  let cc = 0;
  if (opts.ignoreQuiet) ss |= 4;
  if (opts.ignoreWeak) ss |= 8;
  if (opts.ignoreSlowed) ss |= 16;
  if (opts.ignoreSick) ss |= 32;
  if (opts.ignoreDazed) ss |= 64;
  if (opts.ignoreStunned) ss |= 128;
  if (opts.ignoreParalyzed) ss |= 16384;
  if (opts.ignoreBleeding) ss |= 65536;
  if (opts.ignoreArmorBroken) ss |= 134217728;
  // Pet Disable ("Pet Stasis") is condition index 37 → second word bit 1<<(37-32)=32.
  if (opts.ignorePetStasis) ss2 |= 32;
  if (opts.ignorePetrified) ss2 |= 8;
  if (opts.ignoreSilenced) ss2 |= 65536;
  if (opts.ignoreBlind) cc |= 256;
  if (opts.ignoreHallucinating) cc |= 512;
  if (opts.ignoreDrunk) cc |= 1024;
  if (opts.ignoreConfused) cc |= 2048;
  if (opts.ignoreUnstable) cc |= 1073741824;
  // AS3 `-2147483648` signed; JS needs the unsigned equivalent for bit 31.
  if (opts.ignoreDarkness) cc |= 0x80000000;
  return {
    ssdebuffBitmask: ss >>> 0,
    ssdebuffBitmask2: ss2 >>> 0,
    ccdebuffBitmask: cc >>> 0,
  };
}

/**
 * `Player.damageIsLethal` — pessimistic across predicted / server / synced HP.
 * Unset (≤0) figures are ignored so an unpopulated 0 cannot turn Buddha into
 * full godmode on map entry.
 */
export function damageIsLethal(
  effectiveDamage: number,
  figures: { predictedHp?: number | null; serverHp?: number | null; syncedHp?: number | null },
): boolean {
  const damage = Math.trunc(Number(effectiveDamage) || 0);
  let lowest = Number.POSITIVE_INFINITY;
  for (const value of [figures.predictedHp, figures.serverHp, figures.syncedHp]) {
    if (typeof value === 'number' && value > 0 && value < lowest) lowest = value;
  }
  if (!Number.isFinite(lowest)) return true;
  return damage >= lowest;
}

/**
 * `AutoDodgeController.shouldSuppressStrategicHit` magnitude test.
 * Connecting hits that are lethal to survival HP or ≥ threshold% of max HP.
 */
export function shouldSuppressStrategicHit(
  effectiveDamage: number,
  survivalHp: number,
  maxHp: number,
  thresholdPercent: number,
): boolean {
  const damage = Math.trunc(Number(effectiveDamage) || 0);
  if (damage <= 0) return false;
  const percent = clampSuppressThreshold(thresholdPercent);
  const bigHit = Math.max(1, Math.trunc(Math.max(1, maxHp) * percent / 100));
  const lethal = survivalHp > 0 && damage >= survivalHp;
  return lethal || damage >= bigHit;
}

/** Survival HP = min of positive predicted / server / synced figures. */
export function strategicSurvivalHp(figures: {
  predictedHp?: number | null;
  serverHp?: number | null;
  syncedHp?: number | null;
}): number {
  let survival = 0;
  for (const value of [figures.serverHp, figures.predictedHp, figures.syncedHp]) {
    if (typeof value !== 'number' || value <= 0) continue;
    survival = survival > 0 ? Math.min(survival, value) : value;
  }
  return survival;
}

export function clampSuppressThreshold(percent: number): number {
  const value = Number(percent);
  if (!Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(100, value));
}

/**
 * `Player.playerHitSuppressionReason` — symmetric drop (no HP, no PLAYERHIT).
 * Debuff-ignore is a separate asymmetric path and is not returned here.
 */
export function playerHitSuppressionReason(input: {
  effectiveDamage: number;
  partialGodMode: boolean;
  buddhaMode: boolean;
  strategicAckSuppression: boolean;
  /** ProdMafia also requires autoDodge + autoDodgePredictive. */
  autoDodgeActive: boolean;
  suppressThresholdPercent: number;
  maxHp: number;
  predictedHp?: number | null;
  serverHp?: number | null;
  syncedHp?: number | null;
}): PlayerHitSuppressionReason | null {
  if (input.partialGodMode) return 'partial_godmode';
  const figures = {
    predictedHp: input.predictedHp,
    serverHp: input.serverHp,
    syncedHp: input.syncedHp,
  };
  if (input.buddhaMode && damageIsLethal(input.effectiveDamage, figures)) {
    return 'buddha';
  }
  if (
    input.strategicAckSuppression
    && input.autoDodgeActive
    && shouldSuppressStrategicHit(
      input.effectiveDamage,
      strategicSurvivalHp(figures),
      input.maxHp,
      input.suppressThresholdPercent,
    )
  ) {
    return 'strategic_ack';
  }
  return null;
}

/**
 * True when any non-pet projectile condition matches the server-sided ignore
 * masks (`Projectile.update` hasClientDebuff loop). Uses the intentional form
 * of the AS3 bit test: `(1 << id) & ss` / `(1 << (id - 32)) & ss2`.
 */
export function projectileMatchesIgnoredDebuff(
  effects: readonly number[] | undefined,
  bitmasks: IgnoreDebuffBitmasks,
): boolean {
  if (!effects || effects.length === 0) return false;
  for (const raw of effects) {
    const effectId = Math.trunc(Number(raw) || 0);
    if (effectId <= 0) continue;
    const matched = effectId > 32
      ? ((1 << (effectId - 32)) & bitmasks.ssdebuffBitmask2) !== 0
      : ((1 << effectId) & bitmasks.ssdebuffBitmask) !== 0;
    if (matched) return true;
  }
  return false;
}

/**
 * Pull numeric condition effect ids from a projectile definition. Game data
 * carries `conditionEffects` structurally even when `CombatProjectileDefinition`
 * does not name the field (same approach as `projectileConditionRisk`).
 */
export function projectileConditionEffectIds(
  definition: { conditionEffects?: readonly { effect?: number | string; targetPet?: boolean }[] } | null | undefined,
): number[] {
  const entries = definition?.conditionEffects;
  if (!entries?.length) return [];
  const ids: number[] = [];
  for (const entry of entries) {
    if (!entry || entry.targetPet) continue;
    const effect = entry.effect;
    if (typeof effect === 'number' && Number.isFinite(effect)) {
      ids.push(Math.trunc(effect));
      continue;
    }
    if (typeof effect === 'string') {
      const named = CONDITION_NAME_TO_ID.get(effect.trim().toLowerCase());
      if (named !== undefined) ids.push(named);
    }
  }
  return ids;
}

/** AutoSync ClientHP tick counter helper. */
export class AutoSyncClientHpTracker {
  private ticksOff = 0;

  reset(): void {
    this.ticksOff = 0;
  }

  /**
   * Returns true when predicted HP should be forced to `serverHp`.
   * Mirrors GSCC: only advances while `|predicted - server| > 60`; syncs when
   * the pre-increment counter is already past {@link AUTO_SYNC_CLIENT_HP_TICKS}.
   */
  noteSample(predictedHp: number | null, serverHp: number | null, enabled: boolean): boolean {
    if (!enabled || predictedHp === null || serverHp === null) {
      this.ticksOff = 0;
      return false;
    }
    if (Math.abs(predictedHp - serverHp) <= AUTO_SYNC_CLIENT_HP_DELTA) {
      return false;
    }
    const ticksOff = this.ticksOff;
    this.ticksOff = ticksOff + 1;
    if (ticksOff > AUTO_SYNC_CLIENT_HP_TICKS) {
      this.ticksOff = 0;
      return true;
    }
    return false;
  }
}

const CONDITION_NAME_TO_ID = new Map<string, number>([
  ['quiet', 2],
  ['weak', 3],
  ['slowed', 4],
  ['sick', 5],
  ['dazed', 6],
  ['stunned', 7],
  ['blind', 8],
  ['hallucinating', 9],
  ['drunk', 10],
  ['confused', 11],
  ['paralyzed', 14],
  ['bleeding', 16],
  ['armor broken', 27],
  ['armorbroken', 27],
  ['unstable', 30],
  ['darkness', 31],
  ['petrified', 35],
  ['pet disable', 37],
  ['pet stasis', 37],
  ['petstasis', 37],
  ['silenced', 48],
]);
