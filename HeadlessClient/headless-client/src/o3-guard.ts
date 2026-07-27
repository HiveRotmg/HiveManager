import { ConditionEffectBits, ConditionEffectBits2, StatType } from 'realmlib';

/**
 * Oryx the Mad God 3 guard state tracking.
 *
 * Attacking O3 while his guard is raised makes him counter with a 30s
 * unpurifiable Silence, which for an unattended client means no abilities and a
 * likely death. ProdMafia's `Player.isO3ShieldBlocked`
 * (src/com/company/assembleegameclient/objects/Player.as:2600-2628) identifies
 * the guard by its alt-texture swap, but the reference never captured which
 * alt-texture id that is, so its filter `return false`s unconditionally and its
 * option text asks for "a one-time capture to learn the exact sprite id".
 *
 * This module is that capture, plus the inference the reference left out. It
 * consumes three things a headless client already knows:
 *
 * - O3's stats each tick (alt texture, both condition words, HP);
 * - the ENEMYHIT claims we send, which is the client telling the server "this
 *   bullet of mine hit object X" — the server applies damage exactly when it
 *   accepts one, so a claim is the strongest available evidence that a shot of
 *   ours connected;
 * - the resulting HP samples.
 *
 * Verified hits landing on O3 with his HP perfectly flat means our damage is not
 * being applied. That is what a damage-absorbing guard looks like from the wire,
 * and unlike a sprite id it needs no capture. The rules below are deliberately
 * strict, because the failure mode of a false positive is a bot that refuses to
 * shoot a boss it could be damaging; see `LEARN_PRECONDITIONS`.
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
   * damage counts as blocked. Must comfortably exceed projectile flight time
   * plus the NEWTICK quantum plus latency; two seconds is several times that.
   */
  stallMs: number;
  /** Verified, settled ENEMYHIT claims required inside the stall window. */
  minHits: number;
  /**
   * How long a claim needs before it counts, so a hit that simply has not been
   * applied yet is never mistaken for one that was refused.
   */
  hitSettleMs: number;
  /**
   * Turn observed stalls into guard alt-texture ids. Off leaves the observer
   * purely diagnostic: it still reports candidates for a human to confirm.
   */
  learn: boolean;
}

export const DEFAULT_O3_GUARD_OPTIONS: Readonly<O3GuardObserverOptions> = {
  stallMs: 2_000,
  minHits: 6,
  hitSettleMs: 400,
  learn: true,
};

/**
 * Why learning an id is safe enough to act on. All six must hold, and they exist
 * because the cost of learning a wrong id is a bot that stops shooting O3:
 *
 * 1. the alt texture is not 0 — 0 is O3's base sprite, and suppressing it would
 *    mute the whole fight, so a guard that is a sprite swap can never be 0;
 * 2. that alt texture held steady for the entire stall, so the id we learn is
 *    the state we actually measured;
 * 3. the stall ran for at least `stallMs`;
 * 4. at least `minHits` of our own hit claims settled inside it;
 * 5. O3's HP has already dropped at least once this fight, which proves both
 *    that his HP updates reach us and that our damage can land at all — without
 *    it a desynced client that never really hits anything would learn the first
 *    sprite it saw;
 * 6. this alt texture has never been shown while his HP dropped. Any id that
 *    coincides with damage — including everything shown while other players are
 *    damaging him — is permanently disqualified.
 */
export const LEARN_PRECONDITIONS = 6;

interface TextureStats {
  /** Samples observed with this alt texture. */
  samples: number;
  /** Our settled hit claims counted while this texture was shown. */
  hits: number;
  /** HP decreases observed across this texture, from any source. */
  drops: number;
  /** Completed or in-progress stall episodes attributed to this texture. */
  stalls: number;
}

interface ObjectState {
  hp: number;
  maxHp: number;
  altTexture: number;
  /** Time of the last HP change of any direction. */
  hpChangedAt: number;
  /** Whether HP has ever decreased for this object (precondition 5). */
  everDropped: boolean;
  /** Claim timestamps since the last HP change. */
  hits: number[];
  /** Alt texture when the current flat-HP run began, or -1 if it has varied. */
  stallTexture: number;
  /** Whether the current stall has already been counted and learned from. */
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
   */
  damageRegistering: boolean | null;
  /** True while the stall thresholds are met — the guard signal. */
  damageBlocked: boolean;
  /** Set on the sample that first learned this alt texture as a guard id. */
  learnedAltTextureId: number | null;
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
  /** Ids the stall rules learned, in learn order. */
  learnedAltTextureIds: number[];
  /**
   * Ids that satisfy the learn rules, whether or not learning is enabled. With
   * learning off these are the ids to paste into `o3GuardAltTextureIds` (or
   * `config.o3GuardAltTextureIds`) after reviewing the capture file.
   */
  candidateAltTextureIds: number[];
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
 * Tracks one client's view of O3: HP against our own hit claims, plus the
 * per-alt-texture evidence that turns a blocked-damage episode into the guard
 * sprite id the reference never captured.
 */
export class O3GuardObserver {
  private options: O3GuardObserverOptions = { ...DEFAULT_O3_GUARD_OPTIONS };
  private readonly states = new Map<number, ObjectState>();
  private readonly textures = new Map<number, TextureStats>();
  private readonly learned: number[] = [];
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
      learn: options.learn ?? this.options.learn,
    };
  }

  getOptions(): Readonly<O3GuardObserverOptions> {
    return { ...this.options };
  }

  /** Forgets per-fight state; learned ids survive, they are the whole point. */
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
        state.everDropped = true;
        // The drop happened somewhere between the two samples, so both textures
        // are disqualified from ever being learned as the guard (rule 6).
        this.texture(previousTexture).drops++;
        if (observation.altTexture !== previousTexture) this.texture(observation.altTexture).drops++;
      }
      state.hpChangedAt = now;
      state.hits.length = 0;
      state.stallTexture = observation.altTexture;
      state.stallReported = false;
    } else if (observation.altTexture !== state.stallTexture) {
      // A texture swap mid-stall means the flat run spans more than one state,
      // so no single id can be blamed for it (rule 2).
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
    let learnedAltTextureId: number | null = null;
    if (blocked && !state.stallReported) {
      state.stallReported = true;
      if (state.stallTexture >= 0) this.texture(state.stallTexture).stalls++;
      learnedAltTextureId = this.tryLearn(state);
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
      learnedAltTextureId,
    };
    this.lastSample = sample;
    return sample;
  }

  /** Drops an object that left view, e.g. when O3 dies. */
  removeObject(objectId: number): void {
    this.states.delete(objectId);
    if (this.lastSample?.objectId === objectId) this.lastSample = undefined;
  }

  /** Alt-texture ids the stall rules learned, in learn order. */
  learnedAltTextureIds(): number[] {
    return [...this.learned];
  }

  /** Ids that satisfy every learn rule, regardless of whether learning is on. */
  candidateAltTextureIds(): number[] {
    const candidates: number[] = [];
    for (const [id, stats] of this.textures) {
      if (id > 0 && stats.stalls > 0 && stats.drops === 0) candidates.push(id);
    }
    return candidates.sort((a, b) => a - b);
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
      learnedAltTextureIds: this.learnedAltTextureIds(),
      candidateAltTextureIds: this.candidateAltTextureIds(),
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
      everDropped: false,
      hits: [],
      stallTexture: observation.altTexture,
      stallReported: false,
    };
    this.states.set(observation.objectId, state);
    return state;
  }

  /** Applies the six learn preconditions; returns the id learned, if any. */
  private tryLearn(state: ObjectState): number | null {
    if (!this.options.learn) return null;
    const id = state.stallTexture;
    if (id <= 0) return null; // rules 1 and 2
    if (!state.everDropped) return null; // rule 5
    if (this.texture(id).drops > 0) return null; // rule 6
    if (this.learned.includes(id)) return null;
    this.learned.push(id);
    return id;
  }

  private texture(id: number): TextureStats {
    let stats = this.textures.get(id);
    if (!stats) {
      stats = { samples: 0, hits: 0, drops: 0, stalls: 0 };
      // O3 defines under a hundred alt textures, so the cap is only a guard
      // against a hostile server inventing ids; evict the least-evidenced.
      if (this.textures.size >= MAX_TRACKED_TEXTURES) {
        const weakest = [...this.textures.entries()]
          .filter(([textureId]) => !this.learned.includes(textureId))
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
