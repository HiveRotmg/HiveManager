import { ConditionEffectBits, ConditionEffectBits2, StatType } from 'realmlib';

/**
 * Oryx the Mad God 3 guard-state capture helpers.
 *
 * Attacking O3 while his guard is raised makes him counter with a 30s
 * unpurifiable Silence. ProdMafia's `Player.isO3ShieldBlocked`
 * (Player.as:2600-2628) identifies the guard by its alt-texture swap, but the
 * reference never captured which id that is, so its filter always returns false
 * and its option text asks for "a one-time capture to learn the exact sprite id".
 *
 * This module is that capture. It records O3's alt texture, both condition
 * words, HP, and whether our ENEMYHIT claims coincide with HP movement — so one
 * fight's NDJSON can populate `o3GuardAltTextureIds` by hand.
 *
 * An automatic "we're shooting and HP is flat → this is the guard" detector is
 * intentionally NOT shipped. RealmEye's O3 page documents that during guard he
 * is invulnerable for ~1s, then *vulnerable for ~2s while still guarding*, and
 * that ~1% max-HP damage during that window is exactly what triggers the
 * counter. Flat HP therefore correlates with Invulnerable bookends (and with
 * missed/rejected hit claims), not with the dangerous shield sprite. ProdMafia
 * left the same conclusion as a capture-only stub.
 */

/** Oryx the Mad God 3 (source `Player.as:2610`). */
export const ORYX3_TYPE = 0xb133;

/**
 * Non-player objects carry their alt-texture id in the BXP stat slot, which the
 * source aliases as `StatData.ALT_TEXTURE_STAT` (StatData.as:71).
 */
export const ALT_TEXTURE_STAT = StatType.BXP_STAT;

/**
 * Every condition an O3 sample carries, so a capture file records the whole
 * status rather than the handful of bits this client happens to act on.
 */
const CONDITION_NAMES: ReadonlyArray<readonly [string, number]> =
  Object.entries(ConditionEffectBits).filter(([, bit]) => typeof bit === 'number') as Array<[string, number]>;
const CONDITION2_NAMES: ReadonlyArray<readonly [string, number]> =
  Object.entries(ConditionEffectBits2).filter(([, bit]) => typeof bit === 'number') as Array<[string, number]>;

/** Names of every condition bit set in the two condition words. */
export function conditionNames(condition: number, condition2: number): string[] {
  const names: string[] = [];
  for (const [name, bit] of CONDITION_NAMES) if ((condition & bit) !== 0) names.push(name);
  for (const [name, bit] of CONDITION2_NAMES) if ((condition2 & bit) !== 0) names.push(name);
  return names;
}

/** True when the player's own status carries the counter's Silence. */
export function isSilenced(condition2: number | undefined): boolean {
  return ((condition2 ?? 0) & ConditionEffectBits2.SILENCED) !== 0;
}

/** One tick's worth of O3 state, read off the tracked object's wire stats. */
export interface O3Observation {
  objectId: number;
  hp: number;
  maxHp: number;
  /** `ALT_TEXTURE_STAT`, or -1 when the stat has never been sent. */
  altTexture: number;
  condition: number;
  condition2: number;
  x: number;
  y: number;
}

export interface O3GuardObserverOptions {
  /**
   * How long O3's HP must stay perfectly flat, while our hits land, before the
   * sample is marked `damageBlocked` for the capture log. Diagnostic only —
   * never drives Auto Aim.
   */
  stallMs: number;
  /** Verified, settled ENEMYHIT claims required inside the stall window. */
  minHits: number;
  /**
   * How long a claim needs before it counts, so a hit that simply has not been
   * applied yet is never mistaken for one that was refused.
   */
  hitSettleMs: number;
}

export const DEFAULT_O3_GUARD_OPTIONS: Readonly<O3GuardObserverOptions> = {
  stallMs: 2_000,
  minHits: 6,
  hitSettleMs: 400,
};

interface TextureStats {
  /** Samples observed with this alt texture. */
  samples: number;
  /** Our settled hit claims counted while this texture was shown. */
  hits: number;
  /** HP decreases observed across this texture, from any source. */
  drops: number;
  /** Completed stall episodes attributed to this texture (diagnostic). */
  stalls: number;
}

interface ObjectState {
  hp: number;
  maxHp: number;
  altTexture: number;
  /** Time of the last HP change of any direction. */
  hpChangedAt: number;
  /** Claim timestamps since the last HP change. */
  hits: number[];
  /** Alt texture when the current flat-HP run began, or -1 if it has varied. */
  stallTexture: number;
  /** Whether the current stall has already been counted for the texture table. */
  stallReported: boolean;
}

/** The record written to the capture log for one observation. */
export interface O3GuardSample {
  objectId: number;
  hp: number;
  maxHp: number;
  hpFraction: number;
  hpDelta: number;
  altTexture: number;
  condition: number;
  condition2: number;
  conditions: string[];
  x: number;
  y: number;
  /** Our settled hit claims since O3's HP last changed. */
  settledHits: number;
  /** All our claims since O3's HP last changed, settled or not. */
  hits: number;
  msSinceHpChange: number;
  /**
   * Whether damage we deal is reaching him: true once HP fell with our claims
   * outstanding, false once claims settled against flat HP, null while we are
   * not shooting him and so have no evidence either way.
   *
   * Diagnostic only — see module comment for why this is not a guard detector.
   */
  damageRegistering: boolean | null;
  /** True while the stall thresholds are met. Diagnostic only; never drives aim. */
  damageBlocked: boolean;
}

export interface O3GuardStatus {
  /** Whether O3 has been observed since the last `clear`. */
  seen: boolean;
  objectId: number | null;
  hp: number | null;
  hpFraction: number | null;
  altTexture: number | null;
  /** True while the current sample meets the damage-blocked thresholds. */
  damageBlocked: boolean;
  /**
   * Alt textures that coincided with a stall and never with an HP drop. Hints
   * for a human reading the capture — not trusted enough to auto-apply.
   */
  stallHintAltTextureIds: number[];
  /** Per alt-texture evidence, highest sample count first. */
  textures: Array<{ id: number; samples: number; hits: number; drops: number; stalls: number }>;
  totalSamples: number;
  totalHits: number;
}

/** Cap on retained claim timestamps; only their count and age matter. */
const MAX_TRACKED_HITS = 256;

/** Cap on distinct alt textures kept in the evidence table (O3 defines ~95). */
const MAX_TRACKED_TEXTURES = 256;

/**
 * Tracks one client's view of O3 for the capture log: HP against our own hit
 * claims, plus per-alt-texture evidence a human can review after the fight.
 */
export class O3GuardObserver {
  private options: O3GuardObserverOptions = { ...DEFAULT_O3_GUARD_OPTIONS };
  private readonly states = new Map<number, ObjectState>();
  private readonly textures = new Map<number, TextureStats>();
  private lastSample: O3GuardSample | undefined;
  private samples = 0;
  private hitCount = 0;

  constructor(options?: Partial<O3GuardObserverOptions>) {
    if (options) this.configure(options);
  }

  configure(options: Partial<O3GuardObserverOptions>): void {
    this.options = {
      stallMs: positive(options.stallMs, this.options.stallMs),
      minHits: Math.max(1, Math.trunc(positive(options.minHits, this.options.minHits))),
      hitSettleMs: Math.max(0, Number.isFinite(Number(options.hitSettleMs))
        ? Number(options.hitSettleMs)
        : this.options.hitSettleMs),
    };
  }

  getOptions(): Readonly<O3GuardObserverOptions> {
    return { ...this.options };
  }

  /** Forgets per-fight state. */
  clear(): void {
    this.states.clear();
    this.textures.clear();
    this.lastSample = undefined;
    this.samples = 0;
    this.hitCount = 0;
  }

  /**
   * Records an ENEMYHIT claim we sent. Claims against anything but the tracked
   * O3 objects are ignored, so the caller can pass every hit it sees.
   */
  onEnemyHit(now: number, targetObjectId: number): void {
    const state = this.states.get(targetObjectId);
    if (!state) return;
    this.hitCount++;
    state.hits.push(now);
    if (state.hits.length > MAX_TRACKED_HITS) state.hits.splice(0, state.hits.length - MAX_TRACKED_HITS);
    this.texture(state.altTexture).hits++;
  }

  /** Folds one tick of O3 state in and returns the record for the capture log. */
  observe(now: number, observation: O3Observation): O3GuardSample {
    const state = this.states.get(observation.objectId) ?? this.track(now, observation);
    const previousTexture = state.altTexture;
    const hpDelta = observation.hp - state.hp;

    if (hpDelta !== 0) {
      if (hpDelta < 0) {
        this.texture(previousTexture).drops++;
        if (observation.altTexture !== previousTexture) this.texture(observation.altTexture).drops++;
      }
      state.hpChangedAt = now;
      state.hits.length = 0;
      state.stallTexture = observation.altTexture;
      state.stallReported = false;
    } else if (observation.altTexture !== state.stallTexture) {
      state.stallTexture = -1;
    }

    state.hp = observation.hp;
    state.maxHp = observation.maxHp;
    state.altTexture = observation.altTexture;
    this.samples++;
    this.texture(observation.altTexture).samples++;

    const settledHits = state.hits.filter((at) => now - at >= this.options.hitSettleMs).length;
    const msSinceHpChange = now - state.hpChangedAt;
    const blocked = settledHits >= this.options.minHits && msSinceHpChange >= this.options.stallMs;
    if (blocked && !state.stallReported) {
      state.stallReported = true;
      if (state.stallTexture >= 0) this.texture(state.stallTexture).stalls++;
    }

    const sample: O3GuardSample = {
      objectId: observation.objectId,
      hp: observation.hp,
      maxHp: observation.maxHp,
      hpFraction: observation.maxHp > 0 ? observation.hp / observation.maxHp : 0,
      hpDelta,
      altTexture: observation.altTexture,
      condition: observation.condition,
      condition2: observation.condition2,
      conditions: conditionNames(observation.condition, observation.condition2),
      x: observation.x,
      y: observation.y,
      settledHits,
      hits: state.hits.length,
      msSinceHpChange,
      damageRegistering: hpDelta < 0 ? true : blocked ? false : null,
      damageBlocked: blocked,
    };
    this.lastSample = sample;
    return sample;
  }

  /** Drops an object that left view, e.g. when O3 dies. */
  removeObject(objectId: number): void {
    this.states.delete(objectId);
    if (this.lastSample?.objectId === objectId) this.lastSample = undefined;
  }

  /**
   * Ids that coincided with a stall and never with an HP drop. Diagnostic hints
   * only — correlate against silence/`o3_text` in the NDJSON before trusting.
   */
  stallHintAltTextureIds(): number[] {
    const hints: number[] = [];
    for (const [id, stats] of this.textures) {
      if (id > 0 && stats.stalls > 0 && stats.drops === 0) hints.push(id);
    }
    return hints.sort((a, b) => a - b);
  }

  status(): O3GuardStatus {
    const sample = this.lastSample;
    return {
      seen: this.samples > 0,
      objectId: sample?.objectId ?? null,
      hp: sample?.hp ?? null,
      hpFraction: sample?.hpFraction ?? null,
      altTexture: sample?.altTexture ?? null,
      damageBlocked: sample?.damageBlocked ?? false,
      stallHintAltTextureIds: this.stallHintAltTextureIds(),
      textures: [...this.textures.entries()]
        .map(([id, stats]) => ({ id, ...stats }))
        .sort((a, b) => b.samples - a.samples),
      totalSamples: this.samples,
      totalHits: this.hitCount,
    };
  }

  private track(now: number, observation: O3Observation): ObjectState {
    const state: ObjectState = {
      hp: observation.hp,
      maxHp: observation.maxHp,
      altTexture: observation.altTexture,
      hpChangedAt: now,
      hits: [],
      stallTexture: observation.altTexture,
      stallReported: false,
    };
    this.states.set(observation.objectId, state);
    return state;
  }

  private texture(id: number): TextureStats {
    let stats = this.textures.get(id);
    if (!stats) {
      stats = { samples: 0, hits: 0, drops: 0, stalls: 0 };
      if (this.textures.size >= MAX_TRACKED_TEXTURES) {
        const weakest = [...this.textures.entries()]
          .sort((a, b) => a[1].samples - b[1].samples)[0];
        if (weakest) this.textures.delete(weakest[0]);
      }
      this.textures.set(id, stats);
    }
    return stats;
  }
}

function positive(value: number | undefined, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}
