import {
  isProjectileAliveAt,
  predictProjectilePosition,
  type CombatProjectileSnapshot,
} from './combat-tracker';
import type {
  AutoDodgeOptions,
  AutoDodgeRoute,
  AutoDodgeSnapshot,
  AutoDodgeState,
} from './predictive-auto-dodge';
import type {
  DeterministicDodgePlannerMetrics,
  DodgePlannerMetrics,
  DodgePlanningAoe,
  DodgePlanningEnvironment,
  DodgeTrajectory,
} from './dodge-trajectory-planner';
import { projectileCollisionHalfSize, projectileDistanceAt } from './projectile-motion';

const DIRECTION_COUNT = 32;
const INTENT_CANDIDATE = DIRECTION_COUNT + 1;
const CANDIDATE_COUNT = DIRECTION_COUNT + 2;
const TWO_PI = Math.PI * 2;
const SAMPLE_MS = 30;
const DENSE_SAMPLE_MS = 45;
const EXTREME_SAMPLE_MS = 60;
const DENSE_HOSTILE_COUNT = 80;
const EXTREME_HOSTILE_COUNT = 160;
const EMERGENCY_OVERRIDE_MS = 100;
const EMERGENCY_INTENT_BAND = 0.14;
const HYSTERESIS_SCORE_GAIN = 0.25;
const LOCAL_MOBILITY_HORIZON_MS = 90;
const SHOOTER_CORE_RISK = 20;
/**
 * `AutoDodgeController.as:55`. A projectile must approach within
 * `collisionHalfSize + RELEVANCE_CLEARANCE` of the standing position or the
 * intent path before it is treated as a threat at all (`:603-608`, `:1439`).
 */
const RELEVANCE_CLEARANCE = 1.0;
/** AutoDodgeController.as:58-59 — `unavoidable_manual_blend` acceptance bands. */
const UNAVOIDABLE_IMPACT_BAND_MS = 60;
const UNAVOIDABLE_CLEARANCE_BAND = 0.05;
/**
 * Sentinel tier for an AoE whose damage has not been learned yet
 * (AutoDodgeController.as:53). It outranks every other soft-risk contribution
 * and is compared before expected damage, so a route into an unknown blast can
 * never win on a lower projectile-damage estimate.
 */
const HARD_AOE_RISK = 100000;
/** AutoDodgeController.as:75 — damage weight inside the soft risk channel. */
const PROJECTILE_DAMAGE_RISK = 0.04;
/** AutoDodgeController.as:2408-2413 — Auto Play never inherits manual priority. */
const AUTONOMOUS_MANUAL_INFLUENCE = 0.25;
const PATH_SURVIVAL_MIN_MS = 120;
const PATH_SURVIVAL_AFTER_BREACH_MS = 90;
const WALL_ESCAPE_PROBE_DISTANCE = 1.1;
const WALL_APPROACH_RISK = 4;
const WALL_TOPOLOGY_RISK = 6;
const MOBILITY_RISK_TOLERANCE = 12;
const REACTIVE_DAMAGE_ESCAPE_MS = 700;
const REACTIVE_DAMAGE_RADIUS = 1.25;
const STATIONARY_HIT_WINDOW_MS = 1500;
const STATIONARY_HIT_DISTANCE = 0.2;
const STUCK_ESCAPE_DURATION_MS = 1500;
const STUCK_ESCAPE_CLEAR_DISTANCE = 0.75;
const BLOCKED_OVERRIDE_LIMIT = 3;
const STUCK_ESCAPE_MIN_PROBE = 0.08;
const STUCK_ESCAPE_MAX_PROBE = 0.2;
const STUCK_ESCAPE_MIN_PROGRESS = 0.015;
const AOE_REACTION_MARGIN_MS = 340;
const AOE_ESCAPE_SPEED_FACTOR = 0.7;
const AOE_POST_IMPACT_HOLD_MS = 100;
const SERVER_PATH_MAX_OFFSET = 1.75;
const SERVER_PATH_MIN_OFFSET = 0.04;
const SERVER_PATH_CATCHUP_MS = 350;
const SPACING_PROBE_TILES = 2.25;
const SPACING_STEP_TILES = 0.45;
const SPACING_MIN_GAIN_TILES = 0.7;
const SPACING_SPEED_FACTOR = 0.45;
/**
 * `AutoDodgeController.as:68` — the unscaled player collision half-extent, and
 * the base the configurable hitbox percentage scales (`:406`). It is also the
 * fallback physical half-size when no projectile is in hand (`:4262`).
 */
const PHYSICAL_HIT_HALF_SIZE = 0.5;
const VELOCITY_SPEED_SCALES = [1, 0.8, 0.6, 0.4, 0.25, 0.15] as const;
const AOE_SPEED_PROBES = [0.05, 0.1, 0.15, 0.25, 0.4, 0.6, 0.8, 1] as const;
const COMMAND_LOOKAHEAD_MS = 60;
const EPSILON = 0.001;
/**
 * `AutoDodgeController.as:1854`/`:1937` — a retained recent-AoE circle enters
 * risk one half-point above a fresh landing effect, because the location has
 * already proven it damages.
 */
const RECENT_AOE_BASE_RISK = 1.5;
/** `AutoDodgeController.as:2006` — persistent barrage base risk. */
const PERSISTENT_CLUSTER_BASE_RISK = 2;
/** `AutoDodgeController.as:1938` — recent-burst exposure weight. */
const RECENT_BURST_EXPOSURE_RISK = 4;
/** `AutoDodgeController.as:2007` — persistent-cluster exposure weight. */
const PERSISTENT_CLUSTER_EXPOSURE_RISK = 6;
/** `AutoDodgeController.as:1913`/`:1971` — cluster and burst sweep cadence. */
const CLUSTER_SAMPLE_MS = 60;
/** `AutoDodgeController.as:54` — four simultaneous circles make a footprint. */
const PERSISTENT_CLUSTER_MIN = 4;
/**
 * `AutoDodgeController.as:911-913`, `:973-974`. A bounding circle only replaces
 * its members when the pattern is genuinely solid: the centre must be covered
 * and the members' area must fill at least 55% of the envelope. Ring and cross
 * attacks deliberately contain safe gaps, and erasing them made the player flee
 * absurdly far.
 */
const CLUSTER_SOLID_FILL_RATIO = 0.55;
/** `AutoDodgeController.as:944`/`:959` — one server update's expiry spread. */
const RECENT_BURST_UPDATE_WINDOW_MS = 50;
/** `Map.as:225-227` — the AoE repeat-observation cadence bands. */
const AOE_REPEAT_MIN_INTERVAL_MS = 80;
const AOE_REPEAT_MAX_INTERVAL_MS = 1500;
/** `Map.as:230` — a quiet period abandons every learned repeat observation. */
const AOE_OBSERVATION_RESET_MS = 30_000;

// ---------------------------------------------------------------------------
// Condition / status risk. LIVE controller only.
//
// The dead `autododge` package models status as its own `statusSeverity` cost
// channel plus a `lethal` boolean (`DodgeCost.as:50-51`, `:95-104`,
// `:106-153`). The live controller has NEITHER field — see the audit note in
// `dodgeConditionRisk` below for the one place the two models disagree.
// ---------------------------------------------------------------------------

/**
 * A condition effect, either as a numeric `ConditionEffect` id (realmlib
 * `effects.ts`) or as the raw objects.xml name that game data carries in
 * `ProjectileDef.conditionEffects[].effect`.
 *
 * `realmlib`'s `ConditionEffect` is an ambient `declare enum`, so it has no
 * runtime value to switch on. The ids below are transcribed from it.
 */
export type DodgeConditionEffect = number | string;

export interface DodgeConditionEffectSpec {
  effect: DodgeConditionEffect;
  /** Seconds, matching `<ConditionEffect duration="...">`. */
  durationSec?: number;
}

/** Numeric `ConditionEffect` ids used by the severity switch. */
const CONDITION_ID = {
  QUIET: 2,
  WEAK: 3,
  SLOWED: 4,
  SICK: 5,
  DAZED: 6,
  STUNNED: 7,
  BLIND: 8,
  HALLUCINATING: 9,
  DRUNK: 10,
  CONFUSED: 11,
  PARALYZED: 14,
  BLEEDING: 16,
  STASIS: 22,
  ARMOR_BROKEN: 27,
  HEXED: 28,
  UNSTABLE: 30,
  DARKNESS: 31,
  PETRIFIED: 35,
  CURSE: 38,
  SILENCED: 48,
  EXPOSED: 49,
  HP_DEBUFF: 51,
  MP_DEBUFF: 52,
  ATT_DEBUFF: 53,
  DEF_DEBUFF: 54,
  SPD_DEBUFF: 55,
  VIT_DEBUFF: 56,
  WIS_DEBUFF: 57,
  DEX_DEBUFF: 58,
} as const;

/**
 * `AutoDodgeController.as:3252` — "a verified harmful status whose exact modern
 * id was not present in the ProdMafia diagnostic". Kept as a first-class input
 * so a caller that only knows "this hurt" can still express it.
 */
export const UNKNOWN_HARMFUL_CONDITION = -1;

/** objects.xml `<ConditionEffect>` names, normalised to their numeric ids. */
const CONDITION_NAME_TO_ID = new Map<string, number>([
  ['quiet', CONDITION_ID.QUIET],
  ['weak', CONDITION_ID.WEAK],
  ['slowed', CONDITION_ID.SLOWED],
  ['sick', CONDITION_ID.SICK],
  ['dazed', CONDITION_ID.DAZED],
  ['stunned', CONDITION_ID.STUNNED],
  ['blind', CONDITION_ID.BLIND],
  ['hallucinating', CONDITION_ID.HALLUCINATING],
  ['drunk', CONDITION_ID.DRUNK],
  ['confused', CONDITION_ID.CONFUSED],
  ['paralyzed', CONDITION_ID.PARALYZED],
  ['bleeding', CONDITION_ID.BLEEDING],
  ['stasis', CONDITION_ID.STASIS],
  // objects.xml writes this one with a space; the enum name has an underscore
  // and one historical spelling has neither.
  ['armor broken', CONDITION_ID.ARMOR_BROKEN],
  ['armorbroken', CONDITION_ID.ARMOR_BROKEN],
  ['hexed', CONDITION_ID.HEXED],
  ['unstable', CONDITION_ID.UNSTABLE],
  ['darkness', CONDITION_ID.DARKNESS],
  ['petrified', CONDITION_ID.PETRIFIED],
  ['curse', CONDITION_ID.CURSE],
  ['silenced', CONDITION_ID.SILENCED],
  ['exposed', CONDITION_ID.EXPOSED],
  ['hp debuff', CONDITION_ID.HP_DEBUFF],
  ['mp debuff', CONDITION_ID.MP_DEBUFF],
  ['att debuff', CONDITION_ID.ATT_DEBUFF],
  ['def debuff', CONDITION_ID.DEF_DEBUFF],
  ['spd debuff', CONDITION_ID.SPD_DEBUFF],
  ['vit debuff', CONDITION_ID.VIT_DEBUFF],
  ['wis debuff', CONDITION_ID.WIS_DEBUFF],
  ['dex debuff', CONDITION_ID.DEX_DEBUFF],
]);

/**
 * `int(effect)` in `aoeConditionRisk`. An unrecognised name scores 0 rather
 * than guessing: handoff rule 9 keeps unproven effects diagnostic-only.
 */
function conditionEffectId(effect: DodgeConditionEffect): number {
  if (typeof effect === 'number') return Number.isFinite(effect) ? Math.trunc(effect) : 0;
  return CONDITION_NAME_TO_ID.get(effect.trim().toLowerCase().replace(/[_-]+/g, ' ')) ?? 0;
}

/** `AutoDodgeController.as:3254-3257` — the immobilising tier. */
export function isLethalDodgeCondition(effect: DodgeConditionEffect): boolean {
  const id = conditionEffectId(effect);
  return id === CONDITION_ID.PARALYZED
    || id === CONDITION_ID.PETRIFIED
    || id === CONDITION_ID.STASIS;
}

/**
 * `aoeConditionRisk` (`AutoDodgeController.as:3249-3288`). Soft risk for one
 * condition effect, in the same units as every other `candidateRisk`
 * contribution.
 *
 * AUDIT — live versus the rolled-back `autododge` package. `DodgeCost.
 * conditionSeverity` (`DodgeCost.as:106-147`) is byte-identical to this switch
 * for the unknown-harmful sentinel (30), the mobility band (`35 + duration * 5`
 * for Slowed/Confused/Stunned) and the 24-member debuff band
 * (`15 + duration * 3`) — same effects, same coefficients, same
 * `min(10, max(0, duration))` clamp.
 *
 * They disagree on exactly one case, and it is the important one:
 * Paralyzed/Petrified/Stasis score **100** in the dead package
 * (`DodgeCost.as:116`) and **`HARD_AOE_RISK` = 100000** here
 * (`AutoDodgeController.as:3257`). That is not a scale difference. The dead
 * package ranks `statusSeverity` *after* expected damage
 * (`DodgeCost.as:45-54`), so its 100 loses to any route with one less point of
 * predicted HP loss; the live value crosses `HARD_AOE_RISK`, which
 * `isCandidateBetter` compares FIRST, ahead of expected damage
 * (`AutoDodgeController.as:3291-3295`). Immobilisation therefore outranks
 * damage in the live model and is outranked by it in the dead one. This port
 * follows the live model.
 */
export function dodgeConditionRisk(
  effect: DodgeConditionEffect,
  durationSec: number,
): number {
  // `:3250` — the duration term saturates at ten seconds and never goes
  // negative. A non-finite duration contributes nothing.
  const durationRisk = Number.isFinite(durationSec)
    ? Math.min(10, Math.max(0, durationSec))
    : 0;
  const id = conditionEffectId(effect);
  if (id === UNKNOWN_HARMFUL_CONDITION) return 30;
  if (id === CONDITION_ID.PARALYZED
    || id === CONDITION_ID.PETRIFIED
    || id === CONDITION_ID.STASIS) {
    return HARD_AOE_RISK;
  }
  if (id === CONDITION_ID.SLOWED
    || id === CONDITION_ID.CONFUSED
    || id === CONDITION_ID.STUNNED) {
    return 35 + durationRisk * 5;
  }
  switch (id) {
    case CONDITION_ID.DAZED:
    case CONDITION_ID.SICK:
    case CONDITION_ID.QUIET:
    case CONDITION_ID.SILENCED:
    case CONDITION_ID.ARMOR_BROKEN:
    case CONDITION_ID.BLEEDING:
    case CONDITION_ID.CURSE:
    case CONDITION_ID.EXPOSED:
    case CONDITION_ID.UNSTABLE:
    case CONDITION_ID.DARKNESS:
    case CONDITION_ID.BLIND:
    case CONDITION_ID.WEAK:
    case CONDITION_ID.HALLUCINATING:
    case CONDITION_ID.DRUNK:
    case CONDITION_ID.HEXED:
    case CONDITION_ID.HP_DEBUFF:
    case CONDITION_ID.MP_DEBUFF:
    case CONDITION_ID.ATT_DEBUFF:
    case CONDITION_ID.DEF_DEBUFF:
    case CONDITION_ID.SPD_DEBUFF:
    case CONDITION_ID.VIT_DEBUFF:
    case CONDITION_ID.WIS_DEBUFF:
    case CONDITION_ID.DEX_DEBUFF:
      return 15 + durationRisk * 3;
    default:
      return 0;
  }
}

/**
 * The worst risk over a set of effects.
 *
 * The live AoE families each pass ProdMafia a SINGLE effect id and duration
 * (`scoredEmitter.effect_`/`effectDuration_` at `:1733-1734`,
 * `map.getRecentAoeEffect`/`...EffectDuration` at `:1813-1815`), because the
 * server's AOE packet carries one. Our AoE sources can carry the whole
 * objects.xml list, so this reduces with `max` — the same reduction
 * `projectileConditionRisk` uses over its effects vector (`:3130-3133`). With a
 * one-element list it is identical to the live call.
 *
 * Unlike the projectile path, the parsed duration IS used here: the live AoE
 * callers pass a real duration, and only `projectileConditionRisk` hardcodes 1.
 */
function conditionSetRisk(
  effects: readonly DodgeConditionEffectSpec[] | undefined,
): number {
  let risk = 0;
  for (const spec of effects ?? []) {
    risk = Math.max(risk, dodgeConditionRisk(spec.effect, spec.durationSec ?? 0));
  }
  return risk;
}

/** Whether any effect in the set is in the immobilising tier (`:3254-3257`). */
function conditionSetIsLethal(
  effects: readonly DodgeConditionEffectSpec[] | undefined,
): boolean {
  for (const spec of effects ?? []) {
    if (isLethalDodgeCondition(spec.effect)) return true;
  }
  return false;
}

/**
 * The condition effects a projectile definition carries. `CombatProjectileDefinition`
 * is declared in `combat-tracker.ts` and does not name this field, but the game
 * data behind it does: `GameDataLoader.ProjectileDef.conditionEffects` is
 * `{ effect, durationSec, targetPet }[]` parsed straight from
 * `<ConditionEffect>` (`GameDataLoader.ts:26`, `:622-640`), and
 * `CombatDataProvider.getProjectile` hands that object through unchanged
 * (`GameDataLoader.ts:876-881`). Read structurally so the shared combat
 * interface does not have to change.
 */
interface ProjectileConditionSource {
  conditionEffects?: readonly {
    effect?: DodgeConditionEffect;
    durationSec?: number;
    /** `<ConditionEffect target="1">` applies to the pet, never the player. */
    targetPet?: boolean;
  }[];
}

/**
 * `projectileConditionRisk` (`AutoDodgeController.as:3125-3135`): the maximum
 * `aoeConditionRisk` over the projectile's effects.
 *
 * The duration passed at `:3132` is the literal constant `1`, NOT the XML
 * duration — a projectile's effects vector carries no duration in the reference
 * client, so every projectile condition is priced at one second. Reproduced
 * exactly; using the parsed `durationSec` here would silently inflate every
 * mobility-band shot.
 */
export function projectileConditionRisk(
  definition: CombatProjectileSnapshot['definition'],
): number {
  const effects = (definition as ProjectileConditionSource).conditionEffects;
  if (!effects) return 0;
  let risk = 0;
  for (const entry of effects) {
    if (entry?.effect === undefined || entry.targetPet) continue;
    risk = Math.max(risk, dodgeConditionRisk(entry.effect, 1));
  }
  return risk;
}

/**
 * True when contact with this projectile immobilises. ProdMafia expresses the
 * same fact through `aoeConditionRisk` crossing `HARD_AOE_RISK`
 * (`AutoDodgeController.as:3257`); `lethal` is this port's explicit signal for
 * the identical tier, so the comparator does not have to infer it from a
 * magnitude.
 */
export function projectileConditionIsLethal(
  definition: CombatProjectileSnapshot['definition'],
): boolean {
  const effects = (definition as ProjectileConditionSource).conditionEffects;
  if (!effects) return false;
  return effects.some((entry) =>
    entry?.effect !== undefined
    && !entry.targetPet
    && isLethalDodgeCondition(entry.effect));
}

/**
 * Validated planner settings. Every field is one `optionNumber(...)` call in
 * `AutoDodgeController.evaluateThreats` (`AutoDodgeController.as:381-405`),
 * with that call's exact default and clamp range.
 *
 * `projectileClearance` may legitimately be zero (handoff rule 7): at hitbox
 * 92% that puts the PLANNING boundary strictly inside the physical collision
 * box, which is the whole point of the option. No hidden floor is added.
 */
export interface ProdMafiaDodgeConfig {
  /** `autoDodgeProjectileClearance` — default 0.1, clamped to [0, 1.5] (`:382`). */
  projectileClearance: number;
  /** `autoDodgeAoeClearance` — default 0.2, clamped to [0, 1.5] (`:397`). */
  aoeClearance: number;
  /** `autoDodgeLookAheadMs` — default 300, clamped to [100, 1000] (`:403`). */
  lookAheadMs: number;
  /** `autoDodgeAoeLookAheadMs` — default 1200, clamped to [300, 2500] (`:404`). */
  aoeLookAheadMs: number;
  /** `autoDodgePlayerHitbox` percent — default 92, clamped to [0, 100] (`:405`). */
  playerHitbox: number;
  /** `autoDodgeCornerLookAheadTiles` — default 1.5, clamped to [0, 4] (`:383`). */
  cornerLookAheadTiles: number;
  /** `autoDodgeCornerStrength` — default 1, clamped to [0, 2] (`:385`). */
  cornerStrength: number;
  /** `autoDodgeShooterBackoffTiles` — default 0.9, clamped to [0, 2] (`:386`). */
  shooterBackoffTiles: number;
  /** `autoDodgeReactionLeadMs` — default 250, clamped to [100, 500] (`:388`). */
  reactionLeadMs: number;
  /** `autoDodgeManualInfluence` — default AND maximum 0.75, clamped to [0, 0.75] (`:2407`). */
  manualInfluence: number;
  /** `autoDodgeHysteresisMs` — default 100, clamped to [0, 500] (`:2570`). */
  hysteresisMs: number;
}

export const PRODMAFIA_DODGE_CONFIG_DEFAULTS: Readonly<ProdMafiaDodgeConfig> = {
  projectileClearance: 0.1,
  aoeClearance: 0.2,
  lookAheadMs: 300,
  aoeLookAheadMs: 1200,
  playerHitbox: 92,
  cornerLookAheadTiles: 1.5,
  cornerStrength: 1,
  shooterBackoffTiles: 0.9,
  reactionLeadMs: 250,
  manualInfluence: 0.75,
  hysteresisMs: 100,
};

/** `AutoDodgeController.as:4458` — a non-finite option falls back to the default. */
function optionNumber(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

/** `AutoDodgeController.as:388/403/404/2570` truncate their millisecond options. */
function optionInt(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return Math.trunc(optionNumber(value, fallback, minimum, maximum));
}

export function resolveProdMafiaDodgeConfig(
  overrides: Partial<ProdMafiaDodgeConfig> = {},
): ProdMafiaDodgeConfig {
  const defaults = PRODMAFIA_DODGE_CONFIG_DEFAULTS;
  return {
    projectileClearance: optionNumber(overrides.projectileClearance, defaults.projectileClearance, 0, 1.5),
    aoeClearance: optionNumber(overrides.aoeClearance, defaults.aoeClearance, 0, 1.5),
    lookAheadMs: optionInt(overrides.lookAheadMs, defaults.lookAheadMs, 100, 1000),
    aoeLookAheadMs: optionInt(overrides.aoeLookAheadMs, defaults.aoeLookAheadMs, 300, 2500),
    playerHitbox: optionNumber(overrides.playerHitbox, defaults.playerHitbox, 0, 100),
    cornerLookAheadTiles: optionNumber(overrides.cornerLookAheadTiles, defaults.cornerLookAheadTiles, 0, 4),
    cornerStrength: optionNumber(overrides.cornerStrength, defaults.cornerStrength, 0, 2),
    shooterBackoffTiles: optionNumber(overrides.shooterBackoffTiles, defaults.shooterBackoffTiles, 0, 2),
    reactionLeadMs: optionInt(overrides.reactionLeadMs, defaults.reactionLeadMs, 100, 500),
    manualInfluence: optionNumber(overrides.manualInfluence, defaults.manualInfluence, 0, 0.75),
    hysteresisMs: optionInt(overrides.hysteresisMs, defaults.hysteresisMs, 0, 500),
  };
}

/** `AutoDodgeController.as:406` — the configured planning half-extent. */
export function dodgePlanningHitHalfSize(config: ProdMafiaDodgeConfig): number {
  return PHYSICAL_HIT_HALF_SIZE * (config.playerHitbox / 100);
}

/** `AutoDodgeController.as:408` — AoE spatial relevance never drops below 0.15. */
function aoeRelevanceClearance(config: ProdMafiaDodgeConfig): number {
  return Math.max(0.15, config.aoeClearance);
}

// ---------------------------------------------------------------------------
// Threat families the shared `AutoDodgeSnapshot` does not model.
//
// ProdMafia keeps each of these in its own `Map` collection with its own
// broad-phase pass and its own risk arithmetic, so they are separate snapshot
// channels here rather than variants of `DodgePlanningAoe`. Every field is
// optional, which makes `AutoDodgeSnapshot` assignable to
// {@link ProdMafiaDodgeSnapshot}: an existing caller keeps compiling and simply
// supplies no threats of the new kinds.
// ---------------------------------------------------------------------------

/**
 * A `SHOW_EFFECT` circle telegraph (`map.getTelegraphedAoe*`, scored at
 * `AutoDodgeController.as:1549-1633`). Holy/Chaos beams announce a fixed strike
 * target and delay without being `THROW` effects, so they are NOT thrown AoEs
 * (`:719-722`).
 *
 * Distinct from `DodgePlanningAoe` for one substantive reason: an unproven
 * telegraph is treated strictly HARSHER than an unproven throw. A throw with
 * unknown damage adds `HARD_AOE_RISK` alone (`:1517`); a telegraph adds
 * `HARD_AOE_RISK` *and* `max(1, maxHP)` of expected damage (`:1603-1612`,
 * "Unknown beam sources remain in the hard tier").
 */
export interface DodgeTelegraphedAoe {
  x: number;
  y: number;
  radius: number;
  /** Absolute strike time (`map.getTelegraphedAoeImpact`, `:1552`). */
  impactTime: number;
  /**
   * Learned strike damage. Negative or absent means "not yet proven", which is
   * the hard tier plus a full-health damage charge, NOT a free pass.
   */
  damage?: number;
}

/**
 * The telegraph half of a laser telegraph/beam pair: hostile, zero damage, no
 * effects, excluded from live steering by `Projectile.isThreatTo`
 * (`isTelegraphLaser`, `AutoDodgeController.as:3163-3169`). Scored against its
 * LINE at its own expiry, exactly as a circle telegraph is scored at its
 * landing (`:1635-1714`).
 *
 * This is the family the 07-24 logs justify: 68 of 69 laser hits landed within
 * 50 ms of the damaging twin spawning (`:3158-3162`), so the line has to be
 * vacated before the telegraph expires. No reactive dodge can beat it.
 */
export interface DodgeTelegraphLaser {
  /** Beam origin (`projectile.startX/startY`). */
  x: number;
  y: number;
  angle: number;
  /** `projProps.laserDistance_` — the beam's fixed world-space length. */
  length: number;
  /**
   * Absolute time the telegraph expires, which is when the damaging twin spawns
   * and connects on its first frame (`:1644-1645`).
   */
  impactTime: number;
  /**
   * Half-width of the line the twin will strike along:
   * `PHYSICAL_HIT_HALF_SIZE * twin.collisionMult_`, matching `getLaserHit`'s own
   * boundary (`telegraphLaserDangerRadius`, `:3195-3199`).
   */
  dangerRadius: number;
  /**
   * The damaging sibling's damage, from the container's projectile table
   * (`telegraphLaserTwin`, `:3171-3193`). Negative or absent is the hard tier
   * (`:1692-1694`) — but unlike a circle telegraph it adds NO max-HP damage
   * charge, which is the live controller's own distinction between the two.
   *
   * A container with no damaging laser sibling is a purely cosmetic beam and is
   * never collected at all (`:516`), so it should not reach this interface.
   */
  twinDamage?: number;
}

/**
 * A live `MovingAoeEmitter` (`AutoDodgeController.as:1716-1802`). Source-specific
 * AoE objects are not `SHOW_EFFECT` throws: their current position plus a proven
 * pulse cadence is the only pre-impact geometry available (`:804-807`).
 *
 * `x`/`y` are the position already projected to the pulse
 * (`predictedX(impactOffset)`, `:1728-1729`); ProdMafia resolves that point once
 * per emitter and reuses it for all 34 candidates, so the projection belongs to
 * the producer, not to the scorer.
 *
 * Server AoE collision compares the player centre directly against the packet
 * radius, so this radius is NOT a projectile hitbox and must not be inflated by
 * one (`:806-807`).
 */
export interface DodgeMovingAoeEmitter {
  x: number;
  y: number;
  radius: number;
  /** `impactOffset(time)` — ms until the next pulse; 0 means "pulsing now". */
  impactOffsetMs: number;
  /** Learned pulse damage; negative or absent is the hard tier (`:1773-1775`). */
  damage?: number;
  conditionEffects?: readonly DodgeConditionEffectSpec[];
  /** Stable identity for the AoE escape latch, when the producer has one. */
  objectId?: number;
}

/**
 * A retained authoritative AOE packet (`map.getRecentAoe*`, scored at
 * `AutoDodgeController.as:1804-1886`). A raw AOE packet is already an impact,
 * but many attacks pulse or reuse the same area, so recent circles are held
 * briefly and the first untelegraphed hit causes an evacuation before the next
 * pulse (`:927-929`).
 */
export interface DodgeRecentAoe {
  x: number;
  y: number;
  radius: number;
  /** Absolute time the retained circle stops mattering (`getRecentAoeUntil`). */
  until: number;
  /** Damage the AOE packet reported. */
  damage: number;
  /**
   * Set by {@link AoeRepeatObserver}. A one-off packet describes damage that
   * ALREADY happened and charges none; only an observed repeating location
   * predicts future damage (`:1860-1870`).
   */
  repeating?: boolean;
  conditionEffects?: readonly DodgeConditionEffectSpec[];
}

/**
 * `DodgePlanningAoe` plus the two fields the ProdMafia controller reads that the
 * shared planner interface does not declare. Both optional, so a plain
 * `DodgePlanningAoe[]` is still assignable.
 */
export interface ProdMafiaDodgeAoe extends DodgePlanningAoe {
  /**
   * `ThrownProjectile.persistentAoeWarning_`, set by
   * `Map.promoteDenseLegacyThrowCluster` (`Map.as:2024-2025`) for the wide
   * warning rings of a delayed Sanctuary barrage. Four or more of these
   * aggregate into a persistent exclusion zone (`AutoDodgeController.as:884`).
   */
  persistentWarning?: boolean;
  /** Learned landing effects (`map.getThrownAoeEffect`, `:1459-1463`). */
  conditionEffects?: readonly DodgeConditionEffectSpec[];
}

/**
 * The snapshot the ProdMafia controller actually consumes: every field of
 * `AutoDodgeSnapshot` plus the threat families and the player statistics the
 * shared interface has no place for. All additions are optional.
 */
export interface ProdMafiaDodgeSnapshot extends AutoDodgeSnapshot {
  aoes: readonly ProdMafiaDodgeAoe[];
  telegraphedAoes?: readonly DodgeTelegraphedAoe[];
  telegraphLasers?: readonly DodgeTelegraphLaser[];
  movingAoeEmitters?: readonly DodgeMovingAoeEmitter[];
  recentAoes?: readonly DodgeRecentAoe[];
  /**
   * `player.maxHP_`. Used only by the unproven-telegraph charge at
   * `AutoDodgeController.as:1607-1608`; the floor of 1 there means an absent
   * value still produces a non-zero charge.
   */
  maxHp?: number;
}

interface Candidate {
  index: number;
  x: number;
  y: number;
  speedScale: number;
  valid: boolean;
  lethal: boolean;
  expectedDamage: number;
  groundExposureMs: number;
  minimumClearance: number;
  firstImpactMs: number;
  wallBlockMs: number;
  escapeOptions: number;
  risk: number;
  wallPenalty: number;
  intentError: number;
  /** Furthest point the route actually reaches before a wall stops it (`:1488-1490`). */
  reachableX: number;
  reachableY: number;
  /** Why the route was rejected, or `null` while it is still viable. */
  reason: string | null;
}

/**
 * A circular footprint that replaces a whole group of individual circles: the
 * newest same-update recent-AoE burst (`AutoDodgeController.as:1888-1945`) and
 * the persistent legacy-throw barrage (`:1947-2011`). Both are only formed when
 * the pattern is solid, so a ring or cross keeps its safe gaps.
 */
interface DodgeClusterFootprint {
  x: number;
  y: number;
  radius: number;
  /** Sweep length in ms: the burst's remaining life, or the AoE horizon. */
  remainingMs: number;
  /**
   * Whether the STANDING position is already inside the footprint. ProdMafia
   * tests this once from `player.x_`/`player.y_` (`:1895-1897`, `:1953-1955`) and
   * uses the single answer for every candidate, so it is not a per-candidate
   * property. The burst pins `impactMs = 0` only when it is true (`:1939-1942`).
   */
  playerInside: boolean;
}

/**
 * Everything that survived the broad phase for one frame, together with the
 * direct relevance counts ProdMafia reports as `threatCount`.
 */
interface FrameThreats {
  projectiles: readonly CombatProjectileSnapshot[];
  aoes: readonly ProdMafiaDodgeAoe[];
  telegraphedAoes: readonly DodgeTelegraphedAoe[];
  telegraphLasers: readonly DodgeTelegraphLaser[];
  movingEmitters: readonly DodgeMovingAoeEmitter[];
  recentAoes: readonly DodgeRecentAoe[];
  recentBurst: DodgeClusterFootprint | null;
  persistentCluster: DodgeClusterFootprint | null;
  maxHp: number;
  /**
   * Sum of every family's DIRECT relevance count. ProdMafia increments one
   * shared `threatCount` from each family's own pass (`:1440`, `:1541`,
   * `:1631`, `:1712`, `:1792`, `:1884`, `:1904`, `:1961`).
   */
  directCount: number;
  /** Longest AoE-style horizon any relevant family needs (`:1084-1085`). */
  requiresAoeHorizon: boolean;
}

/**
 * Per-projectile sample cadence. ProdMafia picks the step per projectile
 * (`AutoDodgeController.as:580`/`:1314` via `requiresFineProjectileSampling`),
 * so curved shots keep 30 ms resolution no matter how dense the fight is.
 */
interface ProjectileSampling {
  /** Outer cadence: the finest step any single projectile asked for. */
  loopStepMs: number;
  /** Cadence for one projectile; absent means `loopStepMs`. */
  stepMs: Map<CombatProjectileSnapshot, number>;
}

/**
 * Executable TypeScript port of ProdMafia AutoDodgeController's candidate
 * controller. It keeps the original 32 fixed directions + standstill + exact
 * intent candidate, 30/45/60 ms load sampling, literal hitbox clearances,
 * lexicographic safety ordering, 250/100 ms gentle/emergency arbitration,
 * speed probes, and 100 ms direction hysteresis.
 */
export class ProdMafiaAutoDodgeController {
  private enabled = false;
  private safeWalk = true;
  private config: ProdMafiaDodgeConfig = resolveProdMafiaDodgeConfig();
  private readonly directionX = new Array<number>(CANDIDATE_COUNT).fill(0);
  private readonly directionY = new Array<number>(CANDIDATE_COUNT).fill(0);
  private selectedCandidate = 0;
  private selectedUntil = 0;
  private selectedVelocity = { x: 0, y: 0 };
  private aoeEscapeCandidate = -1;
  private aoeEscapeUntil = 0;
  /** Identity of the AoE that armed the hold, re-checked every frame (`:2631-2634`). */
  private aoeEscapeSourceKey: string | null = null;
  private reactiveDamageUntil = 0;
  private reactiveDamageX = 0;
  private reactiveDamageY = 0;
  private reactiveDamageAmount = 0;
  private lastProjectileHitTime = -1;
  private lastProjectileHitX = 0;
  private lastProjectileHitY = 0;
  private stationaryProjectileHits = 0;
  private stuckEscapeUntil = 0;
  private stuckEscapeX = 0;
  private stuckEscapeY = 0;
  private stuckEscapeCandidate = -1;
  private readonly stuckFailedCandidates = new Set<number>();
  private lastAppliedTime = -1;
  private lastAppliedX = 0;
  private lastAppliedY = 0;
  private lastAppliedExpectedDistance = 0;
  private lastAppliedCandidate = -1;
  private blockedOverrideFrames = 0;
  private dangerRevision = 0;
  private pendingProjectileUpdates = 0;
  private pendingDangerUpdates = 0;
  private planRevision = 0;
  private searchRevision = 0;
  private lookaheadRevision = 0;
  private lastHeading: number | null = null;
  private state = emptyState(false);
  private metrics = emptyMetrics();

  constructor(_options: unknown = {}) {
    for (let index = 0; index < DIRECTION_COUNT; index++) {
      const angle = index * TWO_PI / DIRECTION_COUNT;
      this.directionX[index + 1] = Math.cos(angle);
      this.directionY[index + 1] = Math.sin(angle);
    }
  }

  setEnabled(enabled: boolean, options: AutoDodgeOptions = {}): void {
    this.enabled = enabled;
    if (options.safeWalk !== undefined) this.safeWalk = options.safeWalk;
    if (options.config !== undefined) this.setConfig(options.config);
    if (!enabled) this.reset();
    else this.state = { ...this.state, enabled: true };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Re-validate the planner tunables. ProdMafia re-reads every option each
   * frame (`AutoDodgeController.as:381-405`), so a mid-session change takes
   * effect on the next `evaluate` without a reset.
   */
  setConfig(overrides: Partial<ProdMafiaDodgeConfig>): void {
    this.config = resolveProdMafiaDodgeConfig({ ...this.config, ...overrides });
  }

  getConfig(): ProdMafiaDodgeConfig {
    return { ...this.config };
  }

  reset(): void {
    this.selectedCandidate = 0;
    this.selectedUntil = 0;
    this.selectedVelocity = { x: 0, y: 0 };
    this.aoeEscapeCandidate = -1;
    this.aoeEscapeUntil = 0;
    this.aoeEscapeSourceKey = null;
    this.reactiveDamageUntil = 0;
    this.reactiveDamageAmount = 0;
    this.lastProjectileHitTime = -1;
    this.stationaryProjectileHits = 0;
    this.clearStuckEscape();
    this.lastAppliedTime = -1;
    this.dangerRevision = 0;
    this.pendingProjectileUpdates = 0;
    this.pendingDangerUpdates = 0;
    this.planRevision = 0;
    this.searchRevision = 0;
    this.lookaheadRevision = 0;
    this.lastHeading = null;
    this.metrics = emptyMetrics();
    this.state = emptyState(this.enabled);
  }

  rebase(_position: { x: number; y: number }, _time: number): void {
    this.selectedUntil = 0;
    this.selectedCandidate = 0;
    this.selectedVelocity = { x: 0, y: 0 };
    this.aoeEscapeCandidate = -1;
    this.aoeEscapeUntil = 0;
    this.aoeEscapeSourceKey = null;
    this.lastAppliedTime = -1;
    this.blockedOverrideFrames = 0;
    this.dangerRevision++;
    this.metrics.trajectoryInvalidations++;
  }

  noteProjectileUpdate(count = 1): void {
    this.pendingProjectileUpdates += Math.max(1, count);
    this.dangerRevision++;
  }

  noteDangerUpdate(): void {
    this.pendingDangerUpdates++;
    this.dangerRevision++;
  }

  noteUnmodeledDamage(
    position: { x: number; y: number },
    time: number,
    amount: number,
  ): void {
    this.reactiveDamageX = position.x;
    this.reactiveDamageY = position.y;
    this.reactiveDamageAmount = Math.max(1, Math.trunc(amount));
    this.reactiveDamageUntil = time + REACTIVE_DAMAGE_ESCAPE_MS;
    this.noteDangerUpdate();
  }

  noteProjectileHit(
    position: { x: number; y: number },
    time: number,
    amount: number,
  ): void {
    const dx = position.x - this.lastProjectileHitX;
    const dy = position.y - this.lastProjectileHitY;
    if (this.lastProjectileHitTime >= 0
      && time - this.lastProjectileHitTime <= STATIONARY_HIT_WINDOW_MS
      && dx * dx + dy * dy <= STATIONARY_HIT_DISTANCE * STATIONARY_HIT_DISTANCE) {
      this.stationaryProjectileHits++;
    } else {
      this.stationaryProjectileHits = 1;
    }
    this.lastProjectileHitTime = time;
    this.lastProjectileHitX = position.x;
    this.lastProjectileHitY = position.y;
    if (this.stationaryProjectileHits >= 2) {
      this.armStuckEscape(position, time, amount, this.selectedCandidate);
    }
    this.noteDangerUpdate();
  }

  private armStuckEscape(
    position: { x: number; y: number },
    time: number,
    amount: number,
    failedCandidate: number,
  ): void {
    if (time >= this.stuckEscapeUntil) {
      this.stuckEscapeX = position.x;
      this.stuckEscapeY = position.y;
      this.stuckFailedCandidates.clear();
    }
    if (failedCandidate >= 1 && failedCandidate <= DIRECTION_COUNT) {
      this.stuckFailedCandidates.add(failedCandidate);
    }
    this.stuckEscapeCandidate = -1;
    this.stuckEscapeUntil = time + STUCK_ESCAPE_DURATION_MS;
    this.reactiveDamageX = this.stuckEscapeX;
    this.reactiveDamageY = this.stuckEscapeY;
    this.reactiveDamageAmount = Math.max(1, Math.trunc(amount));
    this.reactiveDamageUntil = Math.max(
      this.reactiveDamageUntil,
      time + REACTIVE_DAMAGE_ESCAPE_MS,
    );
  }

  private clearStuckEscape(): void {
    this.stuckEscapeUntil = 0;
    this.stuckEscapeCandidate = -1;
    this.stuckFailedCandidates.clear();
    this.stationaryProjectileHits = 0;
    this.blockedOverrideFrames = 0;
  }

  private updateAppliedMovementFeedback(snapshot: AutoDodgeSnapshot): void {
    if (this.lastAppliedTime < 0) return;
    const elapsed = snapshot.time - this.lastAppliedTime;
    const actualDistance = Math.max(
      Math.abs(snapshot.position.x - this.lastAppliedX),
      Math.abs(snapshot.position.y - this.lastAppliedY),
    );
    if (elapsed >= 0 && elapsed <= 250
      && this.lastAppliedExpectedDistance >= 0.03
      && actualDistance < Math.max(0.01, this.lastAppliedExpectedDistance * 0.15)) {
      this.blockedOverrideFrames = Math.min(
        BLOCKED_OVERRIDE_LIMIT,
        this.blockedOverrideFrames + 1,
      );
      if (this.lastAppliedCandidate >= 1
        && this.lastAppliedCandidate <= DIRECTION_COUNT) {
        this.stuckFailedCandidates.add(this.lastAppliedCandidate);
      }
      if (this.blockedOverrideFrames >= BLOCKED_OVERRIDE_LIMIT) {
        this.armStuckEscape(
          snapshot.position,
          snapshot.time,
          Math.max(1, this.reactiveDamageAmount),
          this.lastAppliedCandidate,
        );
      }
    } else {
      this.blockedOverrideFrames = 0;
    }
    this.lastAppliedTime = -1;
    this.lastAppliedCandidate = -1;
  }

  private stuckEscapeChoice(
    snapshot: AutoDodgeSnapshot,
    candidates: readonly Candidate[],
  ): Candidate | undefined {
    if (snapshot.time >= this.stuckEscapeUntil) {
      if (this.stuckEscapeUntil > 0) this.clearStuckEscape();
      return undefined;
    }
    if (Math.hypot(
      snapshot.position.x - this.stuckEscapeX,
      snapshot.position.y - this.stuckEscapeY,
    ) >= STUCK_ESCAPE_CLEAR_DISTANCE) {
      this.clearStuckEscape();
      return undefined;
    }
    const probeDistance = Math.min(
      STUCK_ESCAPE_MAX_PROBE,
      Math.max(STUCK_ESCAPE_MIN_PROBE, snapshot.moveSpeed * snapshot.movementLeadMs),
    );
    const endpointOpen = (candidate: Candidate): boolean => {
      const movedDistance = Math.hypot(candidate.x, candidate.y) * probeDistance;
      return movedDistance >= STUCK_ESCAPE_MIN_PROGRESS
        && snapshot.environment.canOccupy(
          snapshot.position.x + candidate.x * probeDistance,
          snapshot.position.y + candidate.y * probeDistance,
          this.safeWalk,
          false,
        );
    };
    const intent = candidates[INTENT_CANDIDATE]!;
    if (intent.valid
      && intent.expectedDamage <= EPSILON
      && intent.minimumClearance >= 0
      && endpointOpen(intent)) {
      return intent;
    }
    const retained = candidates[this.stuckEscapeCandidate];
    if (retained
      && retained.index >= 1
      && retained.index <= DIRECTION_COUNT
      && !this.stuckFailedCandidates.has(retained.index)
      && endpointOpen(retained)) {
      return retained;
    }
    let best: Candidate | undefined;
    for (let index = 1; index <= DIRECTION_COUNT; index++) {
      const candidate = candidates[index]!;
      if (this.stuckFailedCandidates.has(index) || !endpointOpen(candidate)) continue;
      if (!best || compareCandidate(candidate, best) < 0) best = candidate;
    }
    if (!best && this.stuckFailedCandidates.size > 0) {
      this.stuckFailedCandidates.clear();
      for (let index = 1; index <= DIRECTION_COUNT; index++) {
        const candidate = candidates[index]!;
        if (!endpointOpen(candidate)) continue;
        if (!best || compareCandidate(candidate, best) < 0) best = candidate;
      }
    }
    this.stuckEscapeCandidate = best?.index ?? -1;
    return best;
  }

  getState(): AutoDodgeState {
    return cloneState(this.state);
  }

  getPlannerMetrics(): DodgePlannerMetrics {
    return {
      ...this.metrics,
      planningDurationMs: 0,
      averagePlanningDurationMs: 0,
      worstPlanningDurationMs: 0,
    };
  }

  evaluate(snapshot: ProdMafiaDodgeSnapshot): AutoDodgeState {
    if (!this.enabled) {
      this.state = emptyState(false);
      return this.getState();
    }
    this.updateAppliedMovementFeedback(snapshot);
    if (snapshot.movementLocked || snapshot.moveSpeed <= 0) {
      this.state = this.makeState(snapshot, {
        candidate: 0,
        velocity: { x: 0, y: 0 },
        speedScale: 0,
        threatCount: 0,
        earliestImpactMs: null,
        override: true,
        decision: 'movement_locked',
        path: [],
        trajectory: null,
      });
      return this.getState();
    }

    const config = this.config;
    const liveProjectiles = [...snapshot.projectiles].filter((projectile) =>
      projectile.side === 'enemy'
      && !projectile.hitObjects.has(snapshot.playerId)
      && isProjectileAliveAt(projectile, snapshot.time));
    const liveAoes = snapshot.aoes.filter((aoe) =>
      aoe.landingTime + (aoe.blastDurationMs ?? 0) >= snapshot.time
      && aoe.landingTime - snapshot.time <= config.aoeLookAheadMs);
    const intentLength = Math.hypot(snapshot.intentVelocity.x, snapshot.intentVelocity.y);
    this.directionX[INTENT_CANDIDATE] = intentLength > 1e-6
      ? snapshot.intentVelocity.x / intentLength
      : 0;
    this.directionY[INTENT_CANDIDATE] = intentLength > 1e-6
      ? snapshot.intentVelocity.y / intentLength
      : 0;

    const loadSampleStep = liveProjectiles.length >= EXTREME_HOSTILE_COUNT
      ? EXTREME_SAMPLE_MS
      : liveProjectiles.length >= DENSE_HOSTILE_COUNT ? DENSE_SAMPLE_MS : SAMPLE_MS;
    // AutoDodgeController.as:504-654. The broad phase runs BEFORE any candidate
    // work: only envelope-relevant shots reach the sampler, and only
    // direct-relevant shots are reported as threats. A volley that cannot
    // approach the reachable envelope costs zero trajectory samples.
    const broadPhase = selectRelevantProjectiles(
      snapshot,
      liveProjectiles,
      config,
      loadSampleStep,
      this.directionX[INTENT_CANDIDATE]!,
      this.directionY[INTENT_CANDIDATE]!,
    );
    const projectiles = broadPhase.relevant;
    // AutoDodgeController.as:656-664 + DodgeThreatSpatialIndex.markNearby. A
    // landing effect whose disc cannot overlap the reachable envelope is
    // pre-classified away rather than scored per candidate.
    const aoeBroadPhase = selectRelevantAoes(snapshot, liveAoes, config);
    const activeAoes = aoeBroadPhase.relevant;
    // AutoDodgeController.as:724-1017. Each remaining family runs its OWN
    // broad-phase pass before any candidate is scored, on the same reachable
    // envelope as thrown AoEs — except telegraph lasers, which measure the
    // player against the beam's line (`:779-782`). A family that skipped this
    // would be scored against candidates it can never reach; a family culled on
    // point distance instead of line distance would vanish for exactly the
    // player standing on the beam.
    const telegraphBroadPhase = selectRelevantTelegraphedAoes(
      snapshot, snapshot.telegraphedAoes ?? [], config,
    );
    const laserBroadPhase = selectRelevantTelegraphLasers(
      snapshot, snapshot.telegraphLasers ?? [], config,
    );
    const emitterBroadPhase = selectRelevantMovingEmitters(
      snapshot, snapshot.movingAoeEmitters ?? [], config,
    );
    const recentBroadPhase = selectRelevantRecentAoes(
      snapshot, snapshot.recentAoes ?? [], config,
    );
    // The two aggregate footprints are built from the UNCULLED collections: a
    // barrage is defined by its own geometry (`:885-913`, `:954-974`), and only
    // the finished footprint is then tested for relevance to the player.
    const recentBurst = buildRecentBurstFootprint(
      snapshot, snapshot.recentAoes ?? [], config,
    );
    const persistentCluster = buildPersistentClusterFootprint(
      snapshot, liveAoes, config,
    );
    const threats: FrameThreats = {
      projectiles,
      aoes: activeAoes,
      telegraphedAoes: telegraphBroadPhase.relevant,
      telegraphLasers: laserBroadPhase.relevant,
      movingEmitters: emitterBroadPhase.relevant,
      recentAoes: recentBroadPhase.relevant,
      recentBurst,
      persistentCluster,
      maxHp: Math.max(1, Math.trunc(snapshot.maxHp ?? 1)),
      // `:1440`, `:1541`, `:1631`, `:1712`, `:1792`, `:1884`, `:1904`, `:1961` —
      // one shared counter incremented by each family's direct-relevance test.
      directCount: broadPhase.directCount
        + aoeBroadPhase.directCount
        + telegraphBroadPhase.directCount
        + laserBroadPhase.directCount
        + emitterBroadPhase.directCount
        + recentBroadPhase.directCount
        + (recentBurst ? 1 : 0)
        + (persistentCluster ? 1 : 0),
      // `:1084-1085` — an announced landing effect, of any family, extends the
      // path horizon from the projectile look-ahead to the AoE look-ahead.
      requiresAoeHorizon: activeAoes.length > 0
        || telegraphBroadPhase.relevant.length > 0
        || laserBroadPhase.relevant.length > 0
        || emitterBroadPhase.relevant.length > 0
        || persistentCluster !== null,
    };
    const sampling = buildProjectileSampling(projectiles, loadSampleStep);
    const candidates: Candidate[] = [];
    let rejectedGeometry = 0;
    for (let index = 0; index < CANDIDATE_COUNT; index++) {
      const candidate = this.evaluateCandidate(
        index,
        this.directionX[index]!,
        this.directionY[index]!,
        1,
        snapshot,
        threats,
        sampling,
      );
      if (!candidate.valid) rejectedGeometry++;
      candidates.push(candidate);
    }

    const firstSafetyBreach = minimumFinite(candidates.map(
      (candidate) => candidate.firstImpactMs,
    ));
    const requiredPathMs = Number.isFinite(firstSafetyBreach)
      ? Math.min(config.lookAheadMs, Math.max(
          PATH_SURVIVAL_MIN_MS,
          firstSafetyBreach + PATH_SURVIVAL_AFTER_BREACH_MS,
        ))
      : Math.min(config.lookAheadMs, config.reactionLeadMs);
    for (let index = 1; index < candidates.length; index++) {
      const candidate = candidates[index]!;
      // Unreachable, not lethal: `lethal` stays an independent signal so the
      // comparator's lethal tier can fire on its own.
      if (candidate.wallBlockMs <= requiredPathMs) candidate.valid = false;
    }
    applyWallTopology(candidates, snapshot, this.safeWalk, config);
    const shooterThreats = applyShooterCore(candidates, snapshot, config.shooterBackoffTiles);
    const reactiveThreats = applyReactiveDamage(candidates, snapshot, {
      active: snapshot.time < this.reactiveDamageUntil,
      x: this.reactiveDamageX,
      y: this.reactiveDamageY,
      amount: this.reactiveDamageAmount,
    }, config.lookAheadMs);

    const intentCandidate = candidates[INTENT_CANDIDATE]!;
    let best = candidates[0]!;
    for (let index = 1; index < candidates.length; index++) {
      if (compareCandidate(candidates[index]!, best) < 0) best = candidates[index]!;
    }
    // AutoDodgeController.as:654 + :3367 — the reported/behavioural threat
    // count is the DIRECT broad-phase count, not the envelope membership count.
    const threatCount = threats.directCount + shooterThreats + reactiveThreats;
    // AutoDodgeController.as:2408-2413 — Auto Play intent has no special
    // authority over safety, so it never inherits a high manual setting.
    const manualInfluence = snapshot.autonomousIntent
      ? Math.min(AUTONOMOUS_MANUAL_INFLUENCE, config.manualInfluence)
      : config.manualInfluence;
    const directUnsafe = !intentCandidate.valid
      || intentCandidate.expectedDamage > EPSILON
      || intentCandidate.minimumClearance < 0
      || intentCandidate.risk >= HARD_AOE_RISK;

    let choice = best;
    let decision = 'no_threat';
    let override = false;
    const stuckChoice = this.stuckEscapeChoice(snapshot, candidates);
    const latched = candidates[this.aoeEscapeCandidate];
    // AutoDodgeController.as:2631-2634 — the hold is released as soon as the
    // effect that armed it stops existing. The scheduled landing time captured
    // at arming time is an upper bound, never a licence to keep steering after
    // the AoE was cancelled or has fully resolved.
    const latchThreatAlive = this.aoeEscapeSourceKey !== null
      && liveAoes.some((aoe) => aoeIdentityKey(aoe) === this.aoeEscapeSourceKey);
    // `:2313` gates the latch on `threatCount > 0`, and `:2348` names the frame
    // `no_threat` when nothing is left, so a latch can never outlive its threat.
    const latchUsable = snapshot.time < this.aoeEscapeUntil
      && threatCount > 0
      && latchThreatAlive
      && !!latched
      && latched.valid
      && isProtectionNoWorse(latched, best)
      && latched.minimumClearance + EPSILON >= best.minimumClearance;
    if (stuckChoice) {
      choice = stuckChoice;
      override = true;
      decision = 'stuck_escape';
    } else if (latchUsable) {
      choice = latched;
      override = true;
      decision = 'aoe_escape_latched';
    } else if (threatCount === 0
      || !directUnsafe && intentCandidate.groundExposureMs <= best.groundExposureMs) {
      // AutoDodgeController.as:2382-2399. A fully safe intent is preserved for
      // both Auto Play and keyboard input, but only when it is also no worse on
      // damaging-ground exposure than the strategically safest route.
      choice = intentCandidate;
      decision = threatCount === 0
        ? 'no_threat'
        : snapshot.autonomousIntent ? 'autoplay_safe_intent' : 'preserve_safe_intent';
      if (threatCount === 0
        && intentLength <= 1e-6
        && !snapshot.autonomousIntent) {
        const spacing = spacingCandidate(
          snapshot.environment,
          snapshot.position.x,
          snapshot.position.y,
          this.safeWalk,
        );
        if (spacing > 0) {
          choice = candidates[spacing]!;
          choice.speedScale = SPACING_SPEED_FACTOR;
          override = true;
          decision = 'proactive_spacing';
        }
      }
    } else {
      const interventionLead = Math.max(
        config.reactionLeadMs,
        aoeInterventionLead(snapshot, activeAoes, config),
      );
      if (!snapshot.autonomousIntent
        && intentCandidate.valid
        && intentCandidate.firstImpactMs > interventionLead) {
        choice = intentCandidate;
        decision = 'impact_not_imminent';
      } else {
        override = true;
        const emergency = intentCandidate.firstImpactMs <= EMERGENCY_OVERRIDE_MS;
        decision = emergency ? 'emergency_override' : 'gentle_override';
        const blend = chooseIntentAligned(
          candidates,
          best,
          snapshot.intentVelocity,
          emergency,
          manualInfluence,
        );
        choice = blend.choice;
        if (choice.index !== best.index) {
          decision = blend.unavoidable
            ? 'unavoidable_manual_blend'
            : emergency ? 'emergency_manual_blend' : 'gentle_manual_blend';
        }
      }
    }

    if (override && choice.index !== 0 && decision !== 'stuck_escape') {
      choice = this.refineSpeed(
        choice,
        snapshot,
        threats,
        sampling,
        intentLength > 1e-6 ? VELOCITY_SPEED_SCALES : AOE_SPEED_PROBES,
      );
    }

    if (override && choice.index !== 0 && activeAoes.length > 0
      && decision !== 'stuck_escape') {
      let fixedChoice = choice;
      if (choice.index === INTENT_CANDIDATE) {
        fixedChoice = nearestEquivalentFixedCandidate(candidates, choice);
      }
      const standing = candidates[0]!;
      const improvesEscape = fixedChoice.index !== INTENT_CANDIDATE
        && (fixedChoice.expectedDamage + EPSILON < standing.expectedDamage
          || fixedChoice.minimumClearance >= 0 && standing.minimumClearance < 0);
      if (improvesEscape) {
        let source = activeAoes[0]!;
        for (const aoe of activeAoes) {
          if (aoe.landingTime < source.landingTime) source = aoe;
        }
        const earliestLanding = Math.max(0, source.landingTime - snapshot.time);
        this.aoeEscapeCandidate = fixedChoice.index;
        this.aoeEscapeSourceKey = aoeIdentityKey(source);
        this.aoeEscapeUntil = Math.max(
          this.aoeEscapeUntil,
          snapshot.time + earliestLanding + AOE_POST_IMPACT_HOLD_MS,
        );
        choice = fixedChoice;
      }
    } else if (snapshot.time >= this.aoeEscapeUntil || !latchThreatAlive) {
      this.aoeEscapeCandidate = -1;
      this.aoeEscapeSourceKey = null;
      this.aoeEscapeUntil = 0;
    }

    const retained = candidates[this.selectedCandidate];
    if (decision !== 'stuck_escape'
      && override
      && snapshot.time < this.selectedUntil
      && retained
      && retained.valid
      && retained.expectedDamage <= choice.expectedDamage + EPSILON
      && retained.groundExposureMs <= choice.groundExposureMs
      && retained.minimumClearance >= 0
      && choice.minimumClearance < retained.minimumClearance + HYSTERESIS_SCORE_GAIN) {
      choice = retained;
      choice.speedScale = Math.min(1, Math.hypot(
        this.selectedVelocity.x,
        this.selectedVelocity.y,
      ) / snapshot.moveSpeed);
      decision = 'hysteresis_hold';
    } else {
      this.selectedCandidate = choice.index;
      this.selectedUntil = snapshot.time + config.hysteresisMs;
    }

    const velocity = {
      x: choice.x * snapshot.moveSpeed * choice.speedScale,
      y: choice.y * snapshot.moveSpeed * choice.speedScale,
    };
    this.selectedVelocity = velocity;
    if (override && choice.index !== 0) {
      this.lastAppliedTime = snapshot.time;
      this.lastAppliedX = snapshot.position.x;
      this.lastAppliedY = snapshot.position.y;
      this.lastAppliedExpectedDistance = snapshot.moveSpeed * choice.speedScale
        * Math.max(1, snapshot.movementLeadMs);
      this.lastAppliedCandidate = choice.index;
    }
    const trajectory = buildTrajectory(snapshot, velocity);
    const path = trajectory.waypoints.map((waypoint) => ({ x: waypoint.x, y: waypoint.y }));
    this.planRevision++;
    this.searchRevision++;
    this.lookaheadRevision++;
    this.metrics.totalPlans++;
    this.metrics.normalReplans++;
    this.metrics.candidatesGenerated += CANDIDATE_COUNT;
    this.metrics.candidatesRejectedByGeometry += rejectedGeometry;
    // AutoDodgeController.as:807 — only broad-phase survivors are sampled, so an
    // irrelevant volley contributes nothing here.
    this.metrics.activeProjectilesConsidered += projectiles.length;
    // AutoDodgeController.as:1370/1494/1582/1673/1754 — `candidateChecks` counts
    // candidate x threat exact-scoring operations, which is zero when the broad
    // phase rejected everything.
    this.metrics.candidateChecks = (this.metrics.candidateChecks ?? 0)
      + CANDIDATE_COUNT * (projectiles.length
        + activeAoes.length
        + threats.telegraphedAoes.length
        + threats.telegraphLasers.length
        + threats.movingEmitters.length
        + threats.recentAoes.length);
    this.metrics.coalescedProjectileUpdates += this.pendingProjectileUpdates;
    this.pendingProjectileUpdates = 0;
    this.pendingDangerUpdates = 0;

    this.state = this.makeState(snapshot, {
      candidate: choice.index,
      velocity,
      speedScale: choice.speedScale,
      threatCount,
      // Priority 5: the winner's OWN impact time. A minimum across all 34
      // candidates describes a route that was not taken and made the field
      // useless for diagnosing why the winner was chosen.
      earliestImpactMs: Number.isFinite(choice.firstImpactMs) ? choice.firstImpactMs : null,
      override,
      decision,
      path,
      trajectory,
      route: {
        blockMs: Number.isFinite(choice.wallBlockMs) ? choice.wallBlockMs : null,
        reachableX: choice.reachableX,
        reachableY: choice.reachableY,
        safe: choice.valid && choice.minimumClearance >= 0 && choice.expectedDamage <= EPSILON,
        reason: choice.reason,
        expectedDamage: choice.expectedDamage,
        impactMs: Number.isFinite(choice.firstImpactMs) ? choice.firstImpactMs : null,
        groundExposureMs: choice.groundExposureMs,
        minimumClearance: choice.minimumClearance,
        risk: choice.risk,
        lethal: choice.lethal,
        escapeOptions: choice.escapeOptions,
      },
    });
    return this.getState();
  }

  private evaluateCandidate(
    index: number,
    directionX: number,
    directionY: number,
    speedScale: number,
    snapshot: AutoDodgeSnapshot,
    threats: FrameThreats,
    sampling: ProjectileSampling,
  ): Candidate {
    const projectiles = threats.projectiles;
    const aoes = threats.aoes;
    const sampleStep = sampling.loopStepMs;
    const candidate: Candidate = {
      index,
      x: directionX,
      y: directionY,
      speedScale,
      valid: true,
      lethal: false,
      expectedDamage: 0,
      groundExposureMs: 0,
      minimumClearance: Infinity,
      firstImpactMs: Infinity,
      wallBlockMs: Infinity,
      escapeOptions: 8,
      risk: 0,
      wallPenalty: 0,
      intentError: 0,
      reachableX: snapshot.position.x,
      reachableY: snapshot.position.y,
      reason: null,
    };
    const config = this.config;
    const velocityX = directionX * snapshot.moveSpeed * speedScale;
    const velocityY = directionY * snapshot.moveSpeed * speedScale;
    candidate.intentError = Math.hypot(
      velocityX - snapshot.intentVelocity.x,
      velocityY - snapshot.intentVelocity.y,
    );

    const previousProjectilePositions = new Map<CombatProjectileSnapshot, {
      projectileX: number;
      projectileY: number;
      playerX: number;
      playerY: number;
      movementOffset: number;
    }>();
    const coveredProjectiles = new Set<CombatProjectileSnapshot>();
    const nextProjectileSample = new Map<CombatProjectileSnapshot, number>();
    /**
     * Worst PHYSICAL clearance seen for each projectile along this route.
     * ProdMafia keeps the same per-projectile minimum in
     * `candidateThreatClearance_` and folds it into risk once
     * (`AutoDodgeController.as:1416-1436`).
     */
    const worstPhysicalClearance = new Map<CombatProjectileSnapshot, number>();
    const hitThreats = new Set<string>();
    const pathHorizon = threats.requiresAoeHorizon
      ? config.aoeLookAheadMs
      : config.lookAheadMs;
    // AutoDodgeController.as:1414 clamps each advance to the projectile's expiry,
    // so the exact final offset is ALWAYS evaluated. The port advances on a shared
    // grid instead, which can step straight over the expiry of a coarse-stepped
    // projectile and miss the sample where it is closest. Visiting each expiry
    // explicitly restores that guarantee while keeping the player offset and the
    // projectile offset consistent.
    const offsets = buildSampleOffsets(
      projectiles,
      snapshot.time,
      Math.min(pathHorizon, config.lookAheadMs),
      pathHorizon,
      sampleStep,
    );
    for (const offset of offsets) {
      let travelOffset = Number.isFinite(candidate.wallBlockMs)
        ? Math.min(offset, Math.max(0, candidate.wallBlockMs - SAMPLE_MS))
        : offset;
      let movementOffset = snapshot.movementLeadMs + travelOffset;
      let playerX = snapshot.position.x + velocityX * movementOffset;
      let playerY = snapshot.position.y + velocityY * movementOffset;
      if (!Number.isFinite(candidate.wallBlockMs)
        && !snapshot.environment.canOccupy(playerX, playerY, false, false)) {
        candidate.wallBlockMs = offset === 0
          ? 0
          : Math.max(SAMPLE_MS, offset - (sampleStep - SAMPLE_MS));
        if (offset === 0) {
          candidate.valid = false;
          candidate.reason = 'blocked_at_origin';
        } else if (candidate.reason === null) {
          candidate.reason = 'wall_blocked';
        }
        travelOffset = Math.min(offset, Math.max(0, candidate.wallBlockMs - SAMPLE_MS));
        movementOffset = snapshot.movementLeadMs + travelOffset;
        playerX = snapshot.position.x + velocityX * movementOffset;
        playerY = snapshot.position.y + velocityY * movementOffset;
      }
      candidate.reachableX = playerX;
      candidate.reachableY = playerY;
      const safeOpen = snapshot.environment.canOccupy(playerX, playerY, this.safeWalk, false);
      if (!safeOpen) candidate.groundExposureMs += sampleStep;

      if (offset > config.lookAheadMs) continue;
      for (const projectile of projectiles) {
        if (coveredProjectiles.has(projectile)) continue;
        // Advance each projectile on its own cadence, accumulated from the ideal
        // schedule so a coarse step does not drift onto the outer loop's grid.
        const dueAt = nextProjectileSample.get(projectile) ?? 0;
        if (offset < dueAt) continue;
        // `:1414` — clamp the next due offset to the expiry so the final sample is
        // never scheduled past the point where the projectile still exists.
        const expiryOffset = projectile.startTime
          + projectile.definition.lifetimeMs - snapshot.time;
        nextProjectileSample.set(
          projectile,
          Math.min(
            Math.max(expiryOffset, dueAt),
            dueAt + (sampling.stepMs.get(projectile) ?? sampleStep),
          ),
        );
        const time = snapshot.time + offset;
        if (!isProjectileAliveAt(projectile, time)) continue;
        const projectilePosition = predictProjectilePosition(projectile, time);
        const previous = previousProjectilePositions.get(projectile);
        if (!snapshot.environment.isProjectileSegmentOpen(
          previous?.projectileX ?? projectilePosition.x,
          previous?.projectileY ?? projectilePosition.y,
          projectilePosition.x,
          projectilePosition.y,
          projectile,
        )) {
          coveredProjectiles.add(projectile);
          continue;
        }
        const physicalHalfSize = projectileCollisionHalfSize(projectile.definition);
        const rawClearance = projectile.definition.laserDistance
          ? minimumLaserCorridorClearance(
              playerX,
              playerY,
              movementOffset,
              projectile,
              snapshot,
            )
          : previous
            ? minimumProjectileCorridorSweepClearance(
                previous.projectileX,
                previous.projectileY,
                projectilePosition.x,
                projectilePosition.y,
                previous.playerX,
                previous.playerY,
                playerX,
                playerY,
                previous.movementOffset,
                movementOffset,
                snapshot,
              )
            : minimumProjectileCorridorPointClearance(
                projectilePosition.x,
                projectilePosition.y,
                playerX,
                playerY,
                movementOffset,
                snapshot,
              );
        previousProjectilePositions.set(projectile, {
          projectileX: projectilePosition.x,
          projectileY: projectilePosition.y,
          playerX,
          playerY,
          movementOffset,
        });
        // Literal damage always uses the collision engine's boundary; the
        // hitbox percentage only shrinks the additional soft margin
        // (AutoDodgeController.as:1366-1372, :4256-4265).
        const physicalClearance = rawClearance - physicalHalfSize;
        const softClearance = physicalClearance
          - effectiveProjectileSafetyMargin(physicalHalfSize, config);
        candidate.minimumClearance = Math.min(candidate.minimumClearance, softClearance);
        const previousWorst = worstPhysicalClearance.get(projectile);
        if (previousWorst === undefined || physicalClearance < previousWorst) {
          worstPhysicalClearance.set(projectile, physicalClearance);
        }
        const threatKey = `p:${projectile.ownerId}:${projectile.bulletId}`;
        if (physicalClearance <= 0 && !hitThreats.has(threatKey)) {
          hitThreats.add(threatKey);
          candidate.firstImpactMs = Math.min(candidate.firstImpactMs, offset);
          candidate.expectedDamage += Math.max(0, projectile.damage);
          if (candidate.reason === null) candidate.reason = 'projectile_impact';
        }
      }
    }

    // Risk is a SUM over every projectile, so twenty near-misses rank worse
    // than one (AutoDodgeController.as:1416-1436).
    for (const [projectile, threatClearance] of worstPhysicalClearance) {
      if (!Number.isFinite(threatClearance)) continue;
      const margin = effectiveProjectileSafetyMargin(
        projectileCollisionHalfSize(projectile.definition),
        config,
      );
      if (threatClearance < margin) {
        candidate.risk += 1 + (margin - threatClearance) * 2;
      }
      if (threatClearance <= 0) {
        // `:1429-1430` — damage and `projectileEffectRisk` enter together, and
        // both only on PHYSICAL contact. A paralysing shot that merely grazes the
        // soft margin is priced as a near miss, exactly as a damaging one is; it
        // is contact that inflicts the condition.
        candidate.risk += Math.max(0, projectile.damage) * PROJECTILE_DAMAGE_RISK
          + projectileConditionRisk(projectile.definition);
        // The immobilising tier. `projectileConditionRisk` already returned
        // HARD_AOE_RISK for these, so the hard tier fires either way; `lethal` is
        // the explicit signal, which also keeps the manual-blend filter
        // (`isProtectionNoWorse`) from trading it away for input alignment.
        if (projectileConditionIsLethal(projectile.definition)) candidate.lethal = true;
      }
    }

    // Time spent on ground the route may not stand on also feeds soft risk
    // (AutoDodgeController.as:2049).
    if (candidate.groundExposureMs > 0) {
      candidate.risk += candidate.groundExposureMs / (pathHorizon + SAMPLE_MS) * 2;
    }

    for (const aoe of aoes) {
      const landingOffset = Math.max(0, aoe.landingTime - snapshot.time);
      if (landingOffset > config.aoeLookAheadMs) continue;
      const endOffset = landingOffset + Math.max(0, aoe.blastDurationMs ?? 0);
      let worstPhysical = Infinity;
      let impactOffset = Infinity;
      for (let offset = landingOffset; offset <= endOffset; offset += Math.max(30, sampleStep)) {
        const travelOffset = Number.isFinite(candidate.wallBlockMs)
          ? Math.min(offset, Math.max(0, candidate.wallBlockMs - SAMPLE_MS))
          : offset;
        const movementOffset = snapshot.movementLeadMs + travelOffset;
        const playerX = snapshot.position.x + velocityX * movementOffset;
        const playerY = snapshot.position.y + velocityY * movementOffset;
        // Same two-channel split as projectiles: the blast circle itself is the
        // physical boundary, AOE_CLEARANCE is the soft margin
        // (AutoDodgeController.as:1491-1505).
        const physicalClearance = pointToServerCorridorDistance(
          aoe.x,
          aoe.y,
          playerX,
          playerY,
          movementOffset,
          snapshot,
        )
          - aoe.radius;
        candidate.minimumClearance = Math.min(
          candidate.minimumClearance,
          physicalClearance - config.aoeClearance,
        );
        if (physicalClearance < worstPhysical) worstPhysical = physicalClearance;
        if (physicalClearance <= 0) {
          impactOffset = offset;
          break;
        }
      }
      if (!Number.isFinite(worstPhysical)) continue;
      // AutoDodgeController.as:1501-1519.
      if (worstPhysical < config.aoeClearance) {
        candidate.risk += 1 + (config.aoeClearance - worstPhysical) * 2;
      }
      if (worstPhysical <= 0) {
        candidate.firstImpactMs = Math.min(candidate.firstImpactMs, impactOffset);
        if (candidate.reason === null) candidate.reason = 'active_aoe';
        // AutoDodgeController.as:1860-1870. A one-off blast whose landing time
        // has already passed describes damage that ALREADY happened: its geometry
        // still keeps the route rejected, but charging it as future damage is the
        // phantom damage that fires Auto Nexus on a finished explosion. A
        // repeating pulse, or one that has not landed yet, always charges.
        const alreadyResolved = aoe.repeating !== true && aoe.landingTime < snapshot.time;
        const learnedDamage = aoe.damage;
        if (alreadyResolved) {
          candidate.risk += 1;
        } else if (learnedDamage !== undefined && learnedDamage >= 0) {
          candidate.expectedDamage += learnedDamage;
          candidate.risk += learnedDamage * PROJECTILE_DAMAGE_RISK;
        } else {
          // Damage not learned yet: an unknown blast is the hard tier, never a
          // one-point damage estimate (AutoDodgeController.as:1516-1518, and the
          // telegraph path at :1603-1612 which is strictly harsher still).
          candidate.risk += HARD_AOE_RISK;
          candidate.lethal = true;
        }
        // `:1519` — the condition term is added OUTSIDE the damage/no-damage
        // branch, so a blast whose damage is known and small still carries its
        // full paralysis cost.
        candidate.risk += conditionSetRisk(aoe.conditionEffects);
        if (conditionSetIsLethal(aoe.conditionEffects)) candidate.lethal = true;
      }
    }

    this.scoreTelegraphedAoes(candidate, snapshot, threats, velocityX, velocityY);
    this.scoreTelegraphLasers(candidate, snapshot, threats, velocityX, velocityY);
    this.scoreMovingEmitters(candidate, snapshot, threats, velocityX, velocityY);
    this.scoreRecentAoes(candidate, snapshot, threats, velocityX, velocityY, sampleStep);
    this.scoreClusterFootprints(candidate, snapshot, threats, velocityX, velocityY);

    return candidate;
  }

  /**
   * Travel time for a family that resolves at a single instant: a candidate the
   * wall stops early is measured at the last position it actually reached, never
   * at the position it would have had if the wall were not there
   * (`AutoDodgeController.as:1569-1573`, and identically at `:1660-1664`,
   * `:1741-1745`).
   */
  private clampedTravelMs(candidate: Candidate, landingOffset: number): number {
    return Number.isFinite(candidate.wallBlockMs)
      ? Math.min(landingOffset, Math.max(0, candidate.wallBlockMs - SAMPLE_MS))
      : landingOffset;
  }

  /**
   * Telegraphed circle AoEs — announced landings with a known centre and radius
   * (`AutoDodgeController.as:1549-1633`).
   *
   * This family is STRICTER than a thrown AoE, not more lenient. An unproven
   * telegraph (`damage < 0`) charges `HARD_AOE_RISK` *and* `max(1, maxHP)` of
   * expected damage (`:1603-1612`, "Unknown beam sources remain in the hard
   * tier"), where an unproven thrown AoE charges only the hard tier (`:1516-1518`)
   * and never touches expected damage. There is deliberately no diagnostic-only
   * path: an unknown beam is treated as fatal until its damage is learned.
   */
  private scoreTelegraphedAoes(
    candidate: Candidate,
    snapshot: AutoDodgeSnapshot,
    threats: FrameThreats,
    velocityX: number,
    velocityY: number,
  ): void {
    if (!candidate.valid) return;
    const config = this.config;
    for (const telegraph of threats.telegraphedAoes) {
      const landingOffset = Math.max(0, telegraph.impactTime - snapshot.time);
      if (landingOffset > config.aoeLookAheadMs) continue;
      const movementOffset = snapshot.movementLeadMs
        + this.clampedTravelMs(candidate, landingOffset);
      const clearance = pointToServerCorridorDistance(
        telegraph.x,
        telegraph.y,
        snapshot.position.x + velocityX * movementOffset,
        snapshot.position.y + velocityY * movementOffset,
        movementOffset,
        snapshot,
      ) - telegraph.radius;
      candidate.minimumClearance = Math.min(
        candidate.minimumClearance,
        clearance - config.aoeClearance,
      );
      if (clearance < config.aoeClearance) {
        candidate.risk += 1 + (config.aoeClearance - clearance) * 2;
      }
      if (clearance > 0) continue;
      const damage = telegraph.damage;
      if (damage !== undefined && damage >= 0) {
        candidate.expectedDamage += damage;
        candidate.risk += damage * PROJECTILE_DAMAGE_RISK;
      } else {
        candidate.risk += HARD_AOE_RISK;
        candidate.expectedDamage += threats.maxHp;
        candidate.lethal = true;
      }
      // No condition term. `map` exposes `getThrownAoeEffect` (`:1459`) and
      // `getRecentAoeEffect` (`:1814`) but has no telegraph equivalent, and
      // `:1593-1616` adds none — a `SHOW_EFFECT` telegraph announces only
      // position, radius, delay and damage. Inventing one here would diverge.
      candidate.firstImpactMs = Math.min(candidate.firstImpactMs, landingOffset);
      if (candidate.reason === null) candidate.reason = 'telegraphed_aoe';
    }
  }

  /**
   * Telegraph lasers and their damaging twins (`AutoDodgeController.as:1635-1714`).
   *
   * The reason this family matters most: `:3158-3162` records that 68 of 69
   * observed laser hits landed within 50 ms of the damaging twin spawning, so no
   * reactive dodge can beat one. Only the telegraph line, avoided before the twin
   * exists, prevents the hit.
   *
   * The clearance is a LINE measurement (`laserLineCorridorDistance`, `:523-527`
   * and `:558-561`) against the beam segment, not a point distance to its origin,
   * and the radius subtracted is the twin's danger radius (`:1651`). Damage comes
   * from the twin's own projectile row when it is known, so a beam competes with
   * bullets on real cost rather than as a flat catastrophe (`:1652-1654`).
   */
  private scoreTelegraphLasers(
    candidate: Candidate,
    snapshot: AutoDodgeSnapshot,
    threats: FrameThreats,
    velocityX: number,
    velocityY: number,
  ): void {
    if (!candidate.valid) return;
    const config = this.config;
    for (const laser of threats.telegraphLasers) {
      const impactOffset = Math.max(0, laser.impactTime - snapshot.time);
      if (impactOffset > config.aoeLookAheadMs) continue;
      const movementOffset = snapshot.movementLeadMs
        + this.clampedTravelMs(candidate, impactOffset);
      const clearance = telegraphLaserCorridorClearance(
        snapshot,
        laser,
        snapshot.position.x + velocityX * movementOffset,
        snapshot.position.y + velocityY * movementOffset,
        movementOffset,
      ) - laser.dangerRadius;
      candidate.minimumClearance = Math.min(
        candidate.minimumClearance,
        clearance - config.aoeClearance,
      );
      if (clearance < config.aoeClearance) {
        candidate.risk += 1 + (config.aoeClearance - clearance) * 2;
      }
      if (clearance > 0) continue;
      const twinDamage = laser.twinDamage;
      if (twinDamage !== undefined && twinDamage >= 0) {
        candidate.expectedDamage += twinDamage;
        candidate.risk += twinDamage * PROJECTILE_DAMAGE_RISK;
      } else {
        // `:1692-1694`. Unlike the circle telegraph above, an unknown twin does
        // NOT add `maxHP` of expected damage — the beam's geometry is certain but
        // its damage is not, and ProdMafia charges only the hard tier here.
        candidate.risk += HARD_AOE_RISK;
        candidate.lethal = true;
      }
      // No condition term either (`:1684-1697`). The twin's own condition risk
      // is charged when the twin actually exists and is scored as a projectile
      // through `projectileEffectRisk` (`:1430`); charging it here as well would
      // double-count the same shot.
      candidate.firstImpactMs = Math.min(candidate.firstImpactMs, impactOffset);
      if (candidate.reason === null) candidate.reason = 'telegraph_laser';
    }
  }

  /**
   * Moving AoE emitters — a hazard carried by an object that is itself in motion,
   * so the disc must be evaluated where the emitter WILL be at impact, not where
   * it is now (`AutoDodgeController.as:1716-1802`, centre from `predictedX`/
   * `predictedY` at `:1728-1729`).
   *
   * This is the site of the live `emitterConditionRisk` term (`:1776`).
   */
  private scoreMovingEmitters(
    candidate: Candidate,
    snapshot: AutoDodgeSnapshot,
    threats: FrameThreats,
    velocityX: number,
    velocityY: number,
  ): void {
    if (!candidate.valid) return;
    const config = this.config;
    for (const emitter of threats.movingEmitters) {
      const landingOffset = Math.max(0, emitter.impactOffsetMs);
      if (landingOffset > config.aoeLookAheadMs) continue;
      // `emitter.x`/`y` are already `predictedX(impactOffset)`/`predictedY(...)`:
      // ProdMafia resolves the pulse position once per emitter (`:1728-1729`) and
      // reuses it across all 34 candidates, so it belongs to the producer.
      const movementOffset = snapshot.movementLeadMs
        + this.clampedTravelMs(candidate, landingOffset);
      const clearance = pointToServerCorridorDistance(
        emitter.x,
        emitter.y,
        snapshot.position.x + velocityX * movementOffset,
        snapshot.position.y + velocityY * movementOffset,
        movementOffset,
        snapshot,
      ) - emitter.radius;
      candidate.minimumClearance = Math.min(
        candidate.minimumClearance,
        clearance - config.aoeClearance,
      );
      if (clearance < config.aoeClearance) {
        candidate.risk += 1 + (config.aoeClearance - clearance) * 2;
      }
      if (clearance > 0) continue;
      const damage = emitter.damage;
      if (damage !== undefined && damage >= 0) {
        candidate.expectedDamage += damage;
        candidate.risk += damage * PROJECTILE_DAMAGE_RISK;
      } else {
        candidate.risk += HARD_AOE_RISK;
        candidate.lethal = true;
      }
      // `:1776` — `emitterConditionRisk`, added outside the damage branch.
      candidate.risk += conditionSetRisk(emitter.conditionEffects);
      if (conditionSetIsLethal(emitter.conditionEffects)) candidate.lethal = true;
      candidate.firstImpactMs = Math.min(candidate.firstImpactMs, landingOffset);
      if (candidate.reason === null) candidate.reason = 'moving_aoe_emitter';
    }
  }

  /**
   * Recent-burst regions — raw AoE packets that have ALREADY detonated and are
   * still dangerous, swept over their remaining life
   * (`AutoDodgeController.as:1804-1886`).
   *
   * Two details separate this family from every other:
   *
   * 1. Its proximity risk base is `1.5`, not `1` (`:1854`). A crater you are
   *    standing next to outranks a bomb about to land next to you, because the
   *    crater has already proven it damages that ground.
   * 2. Damage is charged ONLY when the location has been observed REPEATING
   *    (`:1863-1870`). A one-off packet describes damage that already landed;
   *    charging it as future damage is what previously fired Auto Nexus on a
   *    finished explosion. The same gate covers the condition term at `:1866`.
   */
  private scoreRecentAoes(
    candidate: Candidate,
    snapshot: AutoDodgeSnapshot,
    threats: FrameThreats,
    velocityX: number,
    velocityY: number,
    sampleStep: number,
  ): void {
    if (!candidate.valid) return;
    const config = this.config;
    for (const recent of threats.recentAoes) {
      // `:1816-1817` — swept over the PROJECTILE horizon, not the AoE horizon:
      // the region is already live, so there is no landing to look ahead to.
      const remaining = Math.min(
        config.lookAheadMs,
        Math.max(0, recent.until - snapshot.time),
      );
      let worstClearance = Infinity;
      let firstImpact = Infinity;
      const step = Math.max(30, sampleStep);
      for (let offset = 0; offset <= remaining; offset += step) {
        const movementOffset = snapshot.movementLeadMs
          + this.clampedTravelMs(candidate, offset);
        const clearance = pointToServerCorridorDistance(
          recent.x,
          recent.y,
          snapshot.position.x + velocityX * movementOffset,
          snapshot.position.y + velocityY * movementOffset,
          movementOffset,
          snapshot,
        ) - recent.radius;
        if (clearance < worstClearance) worstClearance = clearance;
        if (clearance <= 0 && !Number.isFinite(firstImpact)) firstImpact = offset;
      }
      if (!Number.isFinite(worstClearance)) continue;
      candidate.minimumClearance = Math.min(
        candidate.minimumClearance,
        worstClearance - config.aoeClearance,
      );
      if (worstClearance < config.aoeClearance) {
        candidate.risk += RECENT_AOE_BASE_RISK
          + (config.aoeClearance - worstClearance) * 2;
      }
      if (!Number.isFinite(firstImpact)) continue;
      candidate.firstImpactMs = Math.min(candidate.firstImpactMs, firstImpact);
      if (candidate.reason === null) candidate.reason = 'recent_aoe';
      if (!recent.repeating) continue;
      candidate.expectedDamage += Math.max(0, recent.damage);
      candidate.risk += Math.max(0, recent.damage) * PROJECTILE_DAMAGE_RISK
        + conditionSetRisk(recent.conditionEffects);
      if (conditionSetIsLethal(recent.conditionEffects)) candidate.lethal = true;
    }
  }

  /**
   * The two aggregate footprints: the newest same-update recent-AoE burst
   * (`AutoDodgeController.as:1888-1945`) and the persistent legacy-throw barrage
   * (`:1947-2011`).
   *
   * Both replace a group of circles with one disc and score by EXPOSURE TIME
   * rather than by clearance alone, because every route starts inside the
   * footprint — minimum clearance is negative for all of them, so it cannot rank
   * them (`:1996-1999`). Exposure separates the genuinely fastest exit from a
   * route that merely crosses the zone and ends outside on the far side.
   *
   * The persistent cluster is the harsher of the two: base `2` against `1.5`,
   * exposure weight `6` against `4`, swept over the full AoE horizon rather than
   * the burst's remaining life, and it forces `firstImpactMs = 0` unconditionally
   * (`:2006-2008`) because a barrage that encloses the player is already landing.
   */
  private scoreClusterFootprints(
    candidate: Candidate,
    snapshot: AutoDodgeSnapshot,
    threats: FrameThreats,
    velocityX: number,
    velocityY: number,
  ): void {
    if (!candidate.valid) return;
    const config = this.config;
    const burst = threats.recentBurst;
    if (burst) {
      const swept = this.sweepFootprint(candidate, snapshot, burst, velocityX, velocityY);
      candidate.minimumClearance = Math.min(
        candidate.minimumClearance,
        swept.worstClearance - config.aoeClearance,
      );
      candidate.risk += RECENT_AOE_BASE_RISK
        + swept.exposureMs / Math.max(CLUSTER_SAMPLE_MS, burst.remainingMs)
          * RECENT_BURST_EXPOSURE_RISK;
      // `:1939-1942` — the impact is pinned only when the player is ALREADY
      // inside the burst, which the broad phase measured from the standing
      // position rather than from this candidate's endpoint.
      if (burst.playerInside) {
        candidate.firstImpactMs = 0;
        if (candidate.reason === null) candidate.reason = 'recent_burst';
      }
    }
    const cluster = threats.persistentCluster;
    if (cluster) {
      const swept = this.sweepFootprint(candidate, snapshot, cluster, velocityX, velocityY);
      candidate.minimumClearance = Math.min(
        candidate.minimumClearance,
        swept.worstClearance - config.aoeClearance,
      );
      candidate.risk += PERSISTENT_CLUSTER_BASE_RISK
        + swept.exposureMs / Math.max(CLUSTER_SAMPLE_MS, cluster.remainingMs)
          * PERSISTENT_CLUSTER_EXPOSURE_RISK;
      candidate.firstImpactMs = 0;
      if (candidate.reason === null) candidate.reason = 'persistent_aoe_cluster';
    }
  }

  /**
   * Shared sweep for both aggregate footprints: fixed 60 ms samples over the
   * footprint's life, accumulating time spent inside the soft margin
   * (`AutoDodgeController.as:1912-1931` and `:1970-1995`). The wall clamp holds a
   * blocked candidate at its last reachable position so it cannot win by
   * appearing to have escaped through a wall.
   */
  private sweepFootprint(
    candidate: Candidate,
    snapshot: AutoDodgeSnapshot,
    footprint: DodgeClusterFootprint,
    velocityX: number,
    velocityY: number,
  ): { worstClearance: number; exposureMs: number } {
    const config = this.config;
    let worstClearance = Infinity;
    let exposureMs = 0;
    for (let offset = 0; offset <= footprint.remainingMs; offset += CLUSTER_SAMPLE_MS) {
      const movementOffset = snapshot.movementLeadMs
        + this.clampedTravelMs(candidate, offset);
      const clearance = pointToServerCorridorDistance(
        footprint.x,
        footprint.y,
        snapshot.position.x + velocityX * movementOffset,
        snapshot.position.y + velocityY * movementOffset,
        movementOffset,
        snapshot,
      ) - footprint.radius;
      if (clearance < worstClearance) worstClearance = clearance;
      if (clearance < config.aoeClearance) exposureMs += CLUSTER_SAMPLE_MS;
    }
    return {
      worstClearance: Number.isFinite(worstClearance) ? worstClearance : Infinity,
      exposureMs,
    };
  }

  private refineSpeed(
    selected: Candidate,
    snapshot: AutoDodgeSnapshot,
    projectiles: readonly CombatProjectileSnapshot[],
    aoes: readonly DodgePlanningAoe[],
    sampling: ProjectileSampling,
    probes: readonly number[],
  ): Candidate {
    let best = selected;
    for (const scale of probes) {
      const candidate = this.evaluateCandidate(
        selected.index,
        selected.x,
        selected.y,
        scale,
        snapshot,
        projectiles,
        aoes,
        sampling,
      );
      applyWallTopology([candidate], snapshot, this.safeWalk, this.config);
      applyShooterCore([candidate], snapshot, this.config.shooterBackoffTiles);
      applyReactiveDamage([candidate], snapshot, {
        active: snapshot.time < this.reactiveDamageUntil,
        x: this.reactiveDamageX,
        y: this.reactiveDamageY,
        amount: this.reactiveDamageAmount,
      }, this.config.lookAheadMs);
      if (isProtectionNoWorse(candidate, selected)
        && candidate.minimumClearance >= Math.min(0, selected.minimumClearance)
        && candidate.intentError < best.intentError - EPSILON) {
        best = candidate;
      }
    }
    return best;
  }

  private makeState(
    snapshot: AutoDodgeSnapshot,
    result: {
      candidate: number;
      velocity: { x: number; y: number };
      speedScale: number;
      threatCount: number;
      earliestImpactMs: number | null;
      override: boolean;
      decision: string;
      path: Array<{ x: number; y: number }>;
      trajectory: DodgeTrajectory | null;
      route?: AutoDodgeRoute | null;
    },
  ): AutoDodgeState {
    const heading = Math.hypot(result.velocity.x, result.velocity.y) > 1e-9
      ? Math.atan2(result.velocity.y, result.velocity.x)
      : null;
    const headingChange = heading === null || this.lastHeading === null
      ? null
      : angularDistance(heading, this.lastHeading);
    this.lastHeading = heading;
    const target = result.trajectory?.waypoints.find(
      (waypoint) => waypoint.timeOffsetMs >= COMMAND_LOOKAHEAD_MS,
    ) ?? result.trajectory?.waypoints.at(-1);
    const goal = snapshot.goal ? { x: snapshot.goal.x, y: snapshot.goal.y } : null;
    const intentLength = Math.hypot(snapshot.intentVelocity.x, snapshot.intentVelocity.y);
    const progressSpeed = intentLength > 1e-9
      ? (result.velocity.x * snapshot.intentVelocity.x
        + result.velocity.y * snapshot.intentVelocity.y) / intentLength
      : 0;
    return {
      enabled: this.enabled,
      overrideActive: result.override,
      velocity: { ...result.velocity },
      target: target ? { x: target.x, y: target.y } : null,
      goal,
      path: result.path.map((point) => ({ ...point })),
      trajectory: result.trajectory ? {
        createdAt: result.trajectory.createdAt,
        waypoints: result.trajectory.waypoints.map((waypoint) => ({ ...waypoint })),
      } : null,
      planRevision: this.planRevision,
      planReused: false,
      searchRevision: this.searchRevision,
      searchPerformed: true,
      planCommitted: true,
      replanCause: 'periodic_refresh',
      movementIntentMode: snapshot.movementIntent?.mode ?? null,
      safetyState: result.override ? 'evasive' : 'normal',
      retreatPenaltyScale: 1,
      lastReplanAt: snapshot.time,
      replanReason: 'normal',
      dangerRevision: this.dangerRevision,
      threatCount: result.threatCount,
      earliestImpactMs: result.earliestImpactMs,
      selectedCandidate: result.candidate,
      speedScale: result.speedScale,
      commandedSpeed: Math.hypot(result.velocity.x, result.velocity.y),
      progressSpeed,
      firstControlHeading: heading,
      headingChange,
      committedScore: null,
      proposedScore: null,
      comparisonHorizonMs: this.config.lookAheadMs,
      movementTargetDistance: target
        ? Math.hypot(target.x - snapshot.position.x, target.y - snapshot.position.y)
        : 0,
      timeSinceLastMovementCommandMs: 0,
      lookaheadRevision: this.lookaheadRevision,
      lookaheadChanged: true,
      decision: result.decision,
      plannerMetrics: { ...this.metrics },
      route: result.route ?? null,
    };
  }
}

/**
 * Soft planning margin only. The configured clearance is reduced by whatever
 * the hitbox percentage already gave back, and clamped at zero so a zero
 * Projectile Clearance never becomes a hidden negative margin
 * (`AutoDodgeController.as:4256-4265`, handoff rules 6 and 7).
 */
function effectiveProjectileSafetyMargin(
  physicalHalfSize: number,
  config: ProdMafiaDodgeConfig,
): number {
  return Math.max(
    0,
    config.projectileClearance - physicalHalfSize * (1 - config.playerHitbox / 100),
  );
}

/**
 * Curved/path-parametric shots keep the original 30 ms resolution however
 * dense the fight is; straight and accelerating shots are already exact under
 * swept segments (`AutoDodgeController.as:3137-3147`). ProdMafia's
 * `isTurning_`/`isTurningCircled_` are `turnRate != 0` and
 * `circleTurnDelay != 0`.
 */
function requiresFineProjectileSampling(
  definition: CombatProjectileSnapshot['definition'],
): boolean {
  return definition.wavy
    || definition.parametric
    || definition.boomerang
    || definition.turnRate !== 0
    || definition.circleTurnDelay !== 0;
}

/**
 * The shared grid `0, step, 2*step, ... horizon`, plus every projectile's exact
 * expiry offset (`AutoDodgeController.as:1410-1414`). Ascending and deduplicated.
 */
function buildSampleOffsets(
  projectiles: readonly CombatProjectileSnapshot[],
  now: number,
  projectileHorizonMs: number,
  pathHorizonMs: number,
  stepMs: number,
): number[] {
  const offsets = new Set<number>();
  for (let offset = 0; offset <= pathHorizonMs; offset += stepMs) offsets.add(offset);
  for (const projectile of projectiles) {
    const expiry = projectile.startTime + projectile.definition.lifetimeMs - now;
    if (expiry > 0 && expiry <= projectileHorizonMs) offsets.add(expiry);
  }
  return [...offsets].sort((first, second) => first - second);
}

function buildProjectileSampling(
  projectiles: readonly CombatProjectileSnapshot[],
  loadSampleStepMs: number,
): ProjectileSampling {
  const stepMs = new Map<CombatProjectileSnapshot, number>();
  let loopStepMs = loadSampleStepMs;
  for (const projectile of projectiles) {
    const step = requiresFineProjectileSampling(projectile.definition)
      ? SAMPLE_MS
      : loadSampleStepMs;
    stepMs.set(projectile, step);
    if (step < loopStepMs) loopStepMs = step;
  }
  return { loopStepMs, stepMs };
}

/**
 * The cost channels `compareCandidate` orders, in priority order. Exposed so the
 * tier ordering itself is testable without reaching into the private candidate
 * buffer; see {@link compareDodgeRouteCost}.
 */
export interface DodgeRouteCost {
  valid: boolean;
  /** True once `risk` reaches `HARD_AOE_RISK` — an unknown blast outranks damage. */
  hardTier?: boolean;
  lethal: boolean;
  expectedDamage: number;
  groundExposureMs: number;
  risk: number;
  escapeOptions: number;
  minimumClearance: number;
  firstImpactMs: number;
  wallBlockMs: number;
  intentError: number;
  index: number;
}

/**
 * Orders two routes by ProdMafia's `isCandidateBetter` tiers
 * (`AutoDodgeController.as:3291-3352`). Negative means the first route wins.
 *
 * The tiers, highest authority first: validity, hard AoE tier, lethality,
 * expected damage, damaging-ground exposure, coarse risk (outside
 * `MOBILITY_RISK_TOLERANCE`), mobility tier, fine risk, soft safety, latest
 * impact, longest reachable path, most escape options, largest clearance,
 * smallest intent error, lowest index.
 */
export function compareDodgeRouteCost(first: DodgeRouteCost, second: DodgeRouteCost): number {
  return compareCandidate(toCandidate(first), toCandidate(second));
}

function toCandidate(cost: DodgeRouteCost): Candidate {
  return {
    index: cost.index,
    x: 0,
    y: 0,
    speedScale: 1,
    valid: cost.valid,
    lethal: cost.lethal,
    expectedDamage: cost.expectedDamage,
    groundExposureMs: cost.groundExposureMs,
    minimumClearance: cost.minimumClearance,
    firstImpactMs: cost.firstImpactMs,
    wallBlockMs: cost.wallBlockMs,
    escapeOptions: cost.escapeOptions,
    risk: cost.hardTier ? Math.max(cost.risk, HARD_AOE_RISK) : cost.risk,
    wallPenalty: 0,
    intentError: cost.intentError,
    reachableX: 0,
    reachableY: 0,
    reason: null,
  };
}

function compareCandidate(candidate: Candidate, incumbent: Candidate): number {
  if (candidate.valid !== incumbent.valid) return candidate.valid ? -1 : 1;
  // Hard tier first, before expected damage: a guaranteed unknown blast must
  // never win on a lower projectile-damage estimate
  // (AutoDodgeController.as:3291-3295).
  const candidateHardTier = candidate.risk >= HARD_AOE_RISK;
  const incumbentHardTier = incumbent.risk >= HARD_AOE_RISK;
  if (candidateHardTier !== incumbentHardTier) return candidateHardTier ? 1 : -1;
  if (candidate.lethal !== incumbent.lethal) return candidate.lethal ? 1 : -1;
  if (Math.abs(candidate.expectedDamage - incumbent.expectedDamage) > EPSILON) {
    return candidate.expectedDamage < incumbent.expectedDamage ? -1 : 1;
  }
  if (candidate.groundExposureMs !== incumbent.groundExposureMs) {
    return candidate.groundExposureMs < incumbent.groundExposureMs ? -1 : 1;
  }
  if (Math.abs(candidate.risk - incumbent.risk) > MOBILITY_RISK_TOLERANCE) {
    return candidate.risk < incumbent.risk ? -1 : 1;
  }
  const candidateMobility = mobilityTier(candidate.escapeOptions);
  const incumbentMobility = mobilityTier(incumbent.escapeOptions);
  if (candidateMobility !== incumbentMobility) {
    return candidateMobility > incumbentMobility ? -1 : 1;
  }
  if (Math.abs(candidate.risk - incumbent.risk) > EPSILON) {
    return candidate.risk < incumbent.risk ? -1 : 1;
  }
  const candidateSafe = candidate.minimumClearance >= 0;
  const incumbentSafe = incumbent.minimumClearance >= 0;
  if (candidateSafe !== incumbentSafe) return candidateSafe ? -1 : 1;
  if (candidate.firstImpactMs !== incumbent.firstImpactMs) {
    return candidate.firstImpactMs > incumbent.firstImpactMs ? -1 : 1;
  }
  if (candidate.wallBlockMs !== incumbent.wallBlockMs) {
    return candidate.wallBlockMs > incumbent.wallBlockMs ? -1 : 1;
  }
  if (candidate.escapeOptions !== incumbent.escapeOptions) {
    return candidate.escapeOptions > incumbent.escapeOptions ? -1 : 1;
  }
  if (Math.abs(candidate.minimumClearance - incumbent.minimumClearance) > EPSILON) {
    return candidate.minimumClearance > incumbent.minimumClearance ? -1 : 1;
  }
  if (Math.abs(candidate.intentError - incumbent.intentError) > EPSILON) {
    return candidate.intentError < incumbent.intentError ? -1 : 1;
  }
  return candidate.index - incumbent.index;
}

/**
 * Intent-aligned blend filter, ported from `AutoDodgeController.as:2464-2478`
 * (gentle) and `:2495-2509` (emergency). Both bands require a non-negative soft
 * safety score; the emergency band is additionally clamped at zero
 * (`:2492-2493`) so it can never admit a grazing route.
 */
function chooseIntentAligned(
  candidates: readonly Candidate[],
  safest: Candidate,
  intent: { x: number; y: number },
  emergency: boolean,
  manualInfluence: number,
): { choice: Candidate; unavoidable: boolean } {
  // AutoDodgeController.as:2428.
  const manualRiskTolerance = manualInfluence * 2;
  const safestHardTier = safest.risk >= HARD_AOE_RISK;
  // AutoDodgeController.as:2515-2546. When the safest route already soft-breaches
  // during an emergency, the score band admits nothing and control is kept
  // unblended. ProdMafia instead switches to impact-time and raw-clearance bands
  // — but only while no route predicts literal damage, so survival is never
  // traded for input alignment.
  const unavoidable = emergency
    && safest.minimumClearance < 0
    && safest.expectedDamage <= EPSILON;
  const acceptableClearance = unavoidable
    ? safest.minimumClearance - UNAVOIDABLE_CLEARANCE_BAND
    : emergency ? Math.max(0, safest.minimumClearance - EMERGENCY_INTENT_BAND) : 0;
  const acceptableImpactMs = unavoidable
    ? Math.max(0, safest.firstImpactMs - UNAVOIDABLE_IMPACT_BAND_MS)
    : -Infinity;

  let best = safest;
  let bestDot = -Infinity;
  for (const candidate of candidates) {
    if (!candidate.valid
      || !safestHardTier && candidate.risk >= HARD_AOE_RISK
      || candidate.expectedDamage > safest.expectedDamage + EPSILON
      || candidate.groundExposureMs > safest.groundExposureMs
      || candidate.risk > safest.risk + manualRiskTolerance
      || candidate.firstImpactMs < acceptableImpactMs
      || candidate.minimumClearance < acceptableClearance) {
      continue;
    }
    const dot = candidate.x * intent.x + candidate.y * intent.y;
    if (dot > bestDot) {
      bestDot = dot;
      best = candidate;
    }
  }
  return { choice: best, unavoidable };
}

function isProtectionNoWorse(candidate: Candidate, reference: Candidate): boolean {
  return candidate.valid
    && candidate.expectedDamage <= reference.expectedDamage + EPSILON
    && candidate.groundExposureMs <= reference.groundExposureMs;
}

/**
 * `AutoDodgeController.as:504-654`. Two independent verdicts per projectile:
 *
 * - `envelopeRelevant` — the path comes within `moveSpeed * (lead + offset) +
 *   hitHalf + RELEVANCE_CLEARANCE`, i.e. anywhere the player could reach. Only
 *   these enter `relevantProjectiles_` and are sampled per candidate (`:640-648`).
 * - `directRelevant` — the path comes within `hitHalf + RELEVANCE_CLEARANCE` of
 *   the STANDING position or the INTENT path (`:603-608`, `:621-630`). This is
 *   the count reported as `threatCount` and the one that gates cornering
 *   (`:654`, `:3367`).
 *
 * The minimum approach is taken over the whole sampled trajectory, not the spawn
 * point: a shot passing 2.5 tiles abeam is direct-irrelevant even though its
 * spawn was close.
 */
function selectRelevantProjectiles(
  snapshot: AutoDodgeSnapshot,
  projectiles: readonly CombatProjectileSnapshot[],
  config: ProdMafiaDodgeConfig,
  loadSampleStepMs: number,
  intentDirectionX: number,
  intentDirectionY: number,
): { relevant: CombatProjectileSnapshot[]; directCount: number } {
  const relevant: CombatProjectileSnapshot[] = [];
  let directCount = 0;
  const hitHalf = dodgePlanningHitHalfSize(config);
  const directThreshold = hitHalf + RELEVANCE_CLEARANCE;

  for (const projectile of projectiles) {
    const definition = projectile.definition;
    // Stage A (`:536-554`): an upper bound, not a heuristic. A non-accelerating
    // shot cannot leave the radius formed by its total travel plus lateral
    // amplitude, so most volleys are rejected before a single sample is taken.
    if (definition.acceleration === 0) {
      const maximumPathRadius = definition.laserDistance
        ? definition.laserDistance
        : definition.parametric
          ? Math.SQRT2 * Math.abs(definition.magnitude)
          : Math.abs(projectileDistanceAt(definition, definition.lifetimeMs))
            + Math.abs(definition.amplitude);
      const maximumPlayerReach = snapshot.moveSpeed
        * (snapshot.movementLeadMs + config.lookAheadMs)
        + hitHalf + RELEVANCE_CLEARANCE + serverOffsetDistance(snapshot);
      const spawnDx = projectile.startX - snapshot.position.x;
      const spawnDy = projectile.startY - snapshot.position.y;
      const bound = maximumPathRadius + maximumPlayerReach;
      if (spawnDx * spawnDx + spawnDy * spawnDy > bound * bound) continue;
    }

    const stepMs = requiresFineProjectileSampling(definition)
      ? SAMPLE_MS
      : loadSampleStepMs;
    const endOffset = Math.min(
      config.lookAheadMs,
      Math.max(0, projectile.startTime + definition.lifetimeMs - snapshot.time),
    );
    let envelopeRelevant = false;
    let directRelevant = false;
    let previous: { x: number; y: number } | null = null;
    let previousOffset = -snapshot.movementLeadMs;

    for (let offset = 0; offset <= endOffset;) {
      const time = snapshot.time + offset;
      if (!isProjectileAliveAt(projectile, time)) break;
      const position = predictProjectilePosition(projectile, time);
      const movementOffset = snapshot.movementLeadMs + offset;
      const reachable = snapshot.moveSpeed * movementOffset + hitHalf + RELEVANCE_CLEARANCE;
      const intentX = snapshot.position.x + intentDirectionX * snapshot.moveSpeed * movementOffset;
      const intentY = snapshot.position.y + intentDirectionY * snapshot.moveSpeed * movementOffset;

      let standingClearance: number;
      let intentClearance: number;
      if (definition.laserDistance) {
        // `:523-527`, `:558-561` — a beam's clearance is the distance to its
        // LINE, never to its origin point. Treating it as a point culled beams
        // the player was standing directly on.
        standingClearance = minimumLaserCorridorClearance(
          snapshot.position.x, snapshot.position.y, movementOffset, projectile, snapshot,
        );
        intentClearance = minimumLaserCorridorClearance(
          intentX, intentY, movementOffset, projectile, snapshot,
        );
      } else if (previous === null) {
        standingClearance = minimumProjectileCorridorPointClearance(
          position.x, position.y, snapshot.position.x, snapshot.position.y, movementOffset, snapshot,
        );
        intentClearance = minimumProjectileCorridorPointClearance(
          position.x, position.y, intentX, intentY, movementOffset, snapshot,
        );
      } else {
        // `:611-628` — sweep both endpoints so a crossing BETWEEN samples counts.
        const previousMovementOffset = snapshot.movementLeadMs + previousOffset;
        const previousIntentX = snapshot.position.x
          + intentDirectionX * snapshot.moveSpeed * previousMovementOffset;
        const previousIntentY = snapshot.position.y
          + intentDirectionY * snapshot.moveSpeed * previousMovementOffset;
        standingClearance = minimumProjectileCorridorSweepClearance(
          previous.x, previous.y, position.x, position.y,
          snapshot.position.x, snapshot.position.y,
          snapshot.position.x, snapshot.position.y,
          previousMovementOffset, movementOffset, snapshot,
        );
        intentClearance = minimumProjectileCorridorSweepClearance(
          previous.x, previous.y, position.x, position.y,
          previousIntentX, previousIntentY, intentX, intentY,
          previousMovementOffset, movementOffset, snapshot,
        );
      }
      if (standingClearance <= reachable) envelopeRelevant = true;
      if (Math.min(standingClearance, intentClearance) <= directThreshold) {
        directRelevant = true;
      }
      previous = position;
      previousOffset = offset;
      if (envelopeRelevant && directRelevant || offset >= endOffset) break;
      offset = Math.min(endOffset, offset + stepMs);
    }

    if (envelopeRelevant) relevant.push(projectile);
    if (directRelevant) directCount++;
  }
  return { relevant, directCount };
}

/**
 * `AutoDodgeController.as:664-717` and `:1540-1546`, matching
 * `DodgeThreatSpatialIndex.markNearby`. A landing disc is spatially relevant only
 * when its clearance to the standing position or the intent endpoint falls within
 * `aoeRelevanceClearance` (`:408`, floor 0.15). Two 0.5-radius circles two tiles
 * away are rejected outright — they are neither counted nor scored.
 *
 * Both surviving sibling behaviours still hold for the right reason: a circle the
 * player can reach has a small positive clearance and is retained, and an
 * oversized circle whose disc swallows the player has a large negative clearance
 * and can never be rejected.
 */
function selectRelevantAoes(
  snapshot: AutoDodgeSnapshot,
  aoes: readonly DodgePlanningAoe[],
  config: ProdMafiaDodgeConfig,
): { relevant: DodgePlanningAoe[]; directCount: number } {
  const relevant: DodgePlanningAoe[] = [];
  let directCount = 0;
  const relevanceClearance = aoeRelevanceClearance(config);
  const intentLength = Math.hypot(snapshot.intentVelocity.x, snapshot.intentVelocity.y);

  for (const aoe of aoes) {
    const landingOffset = Math.max(0, aoe.landingTime - snapshot.time);
    if (landingOffset > config.aoeLookAheadMs) continue;
    const movementOffset = snapshot.movementLeadMs + landingOffset;
    const standingClearance = pointToServerCorridorDistance(
      aoe.x, aoe.y, snapshot.position.x, snapshot.position.y, movementOffset, snapshot,
    ) - aoe.radius;
    // `:710-712` compares the standing clearance against the INTENT endpoint's,
    // so a stationary player degenerates to the standing test alone.
    const intentClearance = intentLength > 1e-6
      ? pointToServerCorridorDistance(
          aoe.x, aoe.y,
          snapshot.position.x + snapshot.intentVelocity.x * movementOffset,
          snapshot.position.y + snapshot.intentVelocity.y * movementOffset,
          movementOffset, snapshot,
        ) - aoe.radius
      : standingClearance;
    // `markNearby(x, y, radius)` overlaps when `distance <= queryRadius +
    // threatRadius`, and the live caller passes the player's reachable radius as
    // `queryRadius`. So the disc is relevant exactly while its clearance falls
    // inside how far the player can travel before it lands, floored at the
    // relevance band so a frozen player still sees a disc it is standing in.
    const reachable = snapshot.moveSpeed * movementOffset + relevanceClearance;
    if (Math.min(standingClearance, intentClearance) > reachable) continue;
    relevant.push(aoe);
    directCount++;
  }
  return { relevant, directCount };
}

/** Stable identity for an AoE across frames, used by the escape latch. */
function aoeIdentityKey(aoe: DodgePlanningAoe): string {
  return `${aoe.x}:${aoe.y}:${aoe.radius}:${aoe.landingTime}`;
}

/**
 * The shared broad-phase test every circular AoE-style family uses: keep the
 * threat while its clearance to the standing position or to the intent endpoint
 * falls inside how far the player can travel before it lands
 * (`AutoDodgeController.as:690-696` for throws, `:735-740` for circle
 * telegraphs, `:855-860` for moving emitters, `:1009-1011` for recent circles).
 *
 * `pointToServerCorridorDistance` is used for both anchors, so the trailing
 * server-acknowledged position widens the envelope the same way it does for
 * projectiles. The relevance band is floored at `aoeRelevanceClearance` (`:408`)
 * so a player who cannot move still sees a disc it is standing in.
 */
function circularThreatRelevance(
  snapshot: AutoDodgeSnapshot,
  centerX: number,
  centerY: number,
  radius: number,
  landingOffsetMs: number,
  config: ProdMafiaDodgeConfig,
): { envelopeRelevant: boolean; directRelevant: boolean } {
  const movementOffset = snapshot.movementLeadMs + landingOffsetMs;
  const relevanceClearance = aoeRelevanceClearance(config);
  const standingClearance = pointToServerCorridorDistance(
    centerX, centerY, snapshot.position.x, snapshot.position.y, movementOffset, snapshot,
  ) - radius;
  // `:710-712` compares the standing clearance against the INTENT endpoint's, so
  // a stationary player degenerates to the standing test alone.
  const intentLength = Math.hypot(snapshot.intentVelocity.x, snapshot.intentVelocity.y);
  const intentClearance = intentLength > 1e-6
    ? pointToServerCorridorDistance(
        centerX, centerY,
        snapshot.position.x + snapshot.intentVelocity.x * movementOffset,
        snapshot.position.y + snapshot.intentVelocity.y * movementOffset,
        movementOffset, snapshot,
      ) - radius
    : standingClearance;
  const nearest = Math.min(standingClearance, intentClearance);
  return {
    envelopeRelevant: nearest <= snapshot.moveSpeed * movementOffset + relevanceClearance,
    directRelevant: nearest <= relevanceClearance,
  };
}

/**
 * `AutoDodgeController.as:724-760`. Circle telegraphs are culled on the same
 * reachable-envelope test as thrown AoEs, so an announced strike the player
 * cannot possibly walk into costs nothing.
 */
function selectRelevantTelegraphedAoes(
  snapshot: AutoDodgeSnapshot,
  telegraphs: readonly DodgeTelegraphedAoe[],
  config: ProdMafiaDodgeConfig,
): { relevant: DodgeTelegraphedAoe[]; directCount: number } {
  const relevant: DodgeTelegraphedAoe[] = [];
  let directCount = 0;
  for (const telegraph of telegraphs) {
    const landingOffset = Math.max(0, telegraph.impactTime - snapshot.time);
    if (landingOffset > config.aoeLookAheadMs) continue;
    const relevance = circularThreatRelevance(
      snapshot, telegraph.x, telegraph.y, telegraph.radius, landingOffset, config,
    );
    if (!relevance.envelopeRelevant) continue;
    relevant.push(telegraph);
    if (relevance.directRelevant) directCount++;
  }
  return { relevant, directCount };
}

/**
 * `AutoDodgeController.as:762-802`. Same envelope test, but the clearance is the
 * distance to the beam's LINE rather than to a centre point
 * (`laserLineCorridorDistance`, `:3201-3214`). Treating a beam as a point culls
 * beams the player is standing directly on — which is the entire failure mode
 * this family exists to prevent, since the damaging twin connects on its first
 * frame.
 */
function selectRelevantTelegraphLasers(
  snapshot: AutoDodgeSnapshot,
  lasers: readonly DodgeTelegraphLaser[],
  config: ProdMafiaDodgeConfig,
): { relevant: DodgeTelegraphLaser[]; directCount: number } {
  const relevant: DodgeTelegraphLaser[] = [];
  let directCount = 0;
  const relevanceClearance = aoeRelevanceClearance(config);
  const intentLength = Math.hypot(snapshot.intentVelocity.x, snapshot.intentVelocity.y);
  for (const laser of lasers) {
    const impactOffset = Math.max(0, laser.impactTime - snapshot.time);
    if (impactOffset > config.aoeLookAheadMs) continue;
    const movementOffset = snapshot.movementLeadMs + impactOffset;
    // `:780` measures the standing anchor at the LEAD offset, not at the impact
    // offset: the beam's line is fixed, so only the player's own uncertainty
    // corridor moves.
    const standingClearance = telegraphLaserCorridorClearance(
      snapshot, laser, snapshot.position.x, snapshot.position.y, snapshot.movementLeadMs,
    ) - laser.dangerRadius;
    const intentClearance = intentLength > 1e-6
      ? telegraphLaserCorridorClearance(
          snapshot, laser,
          snapshot.position.x + snapshot.intentVelocity.x * movementOffset,
          snapshot.position.y + snapshot.intentVelocity.y * movementOffset,
          movementOffset,
        ) - laser.dangerRadius
      : standingClearance;
    const nearest = Math.min(standingClearance, intentClearance);
    if (nearest > snapshot.moveSpeed * movementOffset + relevanceClearance) continue;
    relevant.push(laser);
    if (nearest <= relevanceClearance) directCount++;
  }
  return { relevant, directCount };
}

/** `AutoDodgeController.as:809-880`, minus the projectile-guard branch. */
function selectRelevantMovingEmitters(
  snapshot: AutoDodgeSnapshot,
  emitters: readonly DodgeMovingAoeEmitter[],
  config: ProdMafiaDodgeConfig,
): { relevant: DodgeMovingAoeEmitter[]; directCount: number } {
  const relevant: DodgeMovingAoeEmitter[] = [];
  let directCount = 0;
  for (const emitter of emitters) {
    if (emitter.radius <= 0) continue;
    const landingOffset = Math.max(0, emitter.impactOffsetMs);
    if (landingOffset > config.aoeLookAheadMs) continue;
    const relevance = circularThreatRelevance(
      snapshot, emitter.x, emitter.y, emitter.radius, landingOffset, config,
    );
    if (!relevance.envelopeRelevant) continue;
    relevant.push(emitter);
    if (relevance.directRelevant) directCount++;
  }
  return { relevant, directCount };
}

/**
 * `AutoDodgeController.as:995-1017`. A retained circle is measured over the
 * remainder of its retention window, clamped to the PROJECTILE horizon
 * (`:1000-1001`) rather than the AoE one: it is already an impact, not an
 * announcement.
 */
function selectRelevantRecentAoes(
  snapshot: AutoDodgeSnapshot,
  recentAoes: readonly DodgeRecentAoe[],
  config: ProdMafiaDodgeConfig,
): { relevant: DodgeRecentAoe[]; directCount: number } {
  const relevant: DodgeRecentAoe[] = [];
  let directCount = 0;
  for (const recent of recentAoes) {
    if (recent.until < snapshot.time) continue;
    const remaining = Math.min(
      config.lookAheadMs,
      Math.max(0, recent.until - snapshot.time),
    );
    const relevance = circularThreatRelevance(
      snapshot, recent.x, recent.y, recent.radius, remaining, config,
    );
    if (!relevance.envelopeRelevant) continue;
    relevant.push(recent);
    if (relevance.directRelevant) directCount++;
  }
  return { relevant, directCount };
}

/**
 * `AutoDodgeController.as:930-994`. Packets from one server update share (or
 * nearly share) their expiry, so the newest 50 ms band is one footprint. Keeping
 * that window narrow prevents unrelated arena attacks from becoming a single
 * enormous exclusion zone (`:941-943`).
 *
 * Returns `null` unless the group is at least `PERSISTENT_CLUSTER_MIN` circles,
 * its centre is covered by a member, and the members fill
 * `CLUSTER_SOLID_FILL_RATIO` of the bounding disc.
 */
function buildRecentBurstFootprint(
  snapshot: AutoDodgeSnapshot,
  recentAoes: readonly DodgeRecentAoe[],
  config: ProdMafiaDodgeConfig,
): DodgeClusterFootprint | null {
  let burstUntil = 0;
  for (const recent of recentAoes) burstUntil = Math.max(burstUntil, recent.until);
  const members = recentAoes.filter((recent) =>
    burstUntil - recent.until <= RECENT_BURST_UPDATE_WINDOW_MS);
  if (members.length < PERSISTENT_CLUSTER_MIN) return null;
  const footprint = solidClusterFootprint(members);
  if (!footprint) return null;
  const remainingMs = Math.min(
    config.lookAheadMs,
    Math.max(0, burstUntil - snapshot.time),
  );
  // `:1898` gates on the CURRENT clearance only — the burst has already fired,
  // so its footprint is a place to leave, not a place to avoid arriving at.
  const currentClearance = pointToServerCorridorDistance(
    footprint.x, footprint.y,
    snapshot.position.x, snapshot.position.y,
    snapshot.movementLeadMs, snapshot,
  ) - footprint.radius;
  if (currentClearance > aoeRelevanceClearance(config)) return null;
  return { ...footprint, remainingMs };
}

/**
 * `AutoDodgeController.as:882-925`. Four or more simultaneous legacy throws
 * carrying `persistentWarning` describe a barrage footprint: the observed Realm
 * pattern began damaging after 187 ms, repeated for over two seconds, and
 * enclosed the player (`:1947-1951`).
 */
function buildPersistentClusterFootprint(
  snapshot: AutoDodgeSnapshot,
  aoes: readonly ProdMafiaDodgeAoe[],
  config: ProdMafiaDodgeConfig,
): DodgeClusterFootprint | null {
  const members = aoes.filter((aoe) => aoe.persistentWarning === true);
  if (members.length < PERSISTENT_CLUSTER_MIN) return null;
  const footprint = solidClusterFootprint(members);
  if (!footprint) return null;
  // `:915-918` uses the raw local distance, without the server corridor: the
  // barrage is already enclosing the player, so the acknowledged anchor cannot
  // make it less true.
  const distance = Math.hypot(
    snapshot.position.x - footprint.x,
    snapshot.position.y - footprint.y,
  );
  if (distance > footprint.radius + aoeRelevanceClearance(config)) return null;
  return { ...footprint, remainingMs: config.aoeLookAheadMs };
}

/**
 * The shared solidity test used by both cluster families
 * (`AutoDodgeController.as:885-913`, `:954-974`). The centroid is the mean of the
 * member centres, the radius is the furthest member EXTENT (centre distance plus
 * that member's own radius), and the group only becomes a footprint when the
 * centroid is inside some member and the summed member areas fill at least 55%
 * of the bounding disc.
 */
function solidClusterFootprint(
  members: readonly { x: number; y: number; radius: number }[],
): { x: number; y: number; radius: number } | null {
  let centerX = 0;
  let centerY = 0;
  for (const member of members) {
    centerX += member.x;
    centerY += member.y;
  }
  centerX /= members.length;
  centerY /= members.length;
  let radius = 0;
  let radiusSquaredSum = 0;
  let centerCovered = false;
  for (const member of members) {
    const distance = Math.hypot(member.x - centerX, member.y - centerY);
    radiusSquaredSum += member.radius * member.radius;
    if (distance <= member.radius) centerCovered = true;
    radius = Math.max(radius, distance + member.radius);
  }
  if (!centerCovered || radius <= 0) return null;
  if (radiusSquaredSum / (radius * radius) < CLUSTER_SOLID_FILL_RATIO) return null;
  return { x: centerX, y: centerY, radius };
}

/**
 * `laserLineCorridorDistance` (`AutoDodgeController.as:3201-3214`) — the line
 * analogue of `pointToServerCorridorDistance`. Distance from the local and
 * server-corridor player anchors to the telegraph's line, never to its origin.
 */
function telegraphLaserCorridorClearance(
  snapshot: AutoDodgeSnapshot,
  laser: DodgeTelegraphLaser,
  playerX: number,
  playerY: number,
  movementOffset: number,
): number {
  const endX = laser.x + Math.cos(laser.angle) * laser.length;
  const endY = laser.y + Math.sin(laser.angle) * laser.length;
  const local = pointToSegmentDistance(playerX, playerY, laser.x, laser.y, endX, endY);
  const serverOffset = temporalServerOffset(snapshot, movementOffset);
  if (!serverOffset) return local;
  return Math.min(local, pointToSegmentDistance(
    playerX + serverOffset.x,
    playerY + serverOffset.y,
    laser.x, laser.y, endX, endY,
  ));
}

/**
 * `AutoDodgeController.as:548` — `serverOffsetDistance_`, the extra reach the
 * position-reconciliation corridor can add to the player's envelope.
 */
function serverOffsetDistance(snapshot: AutoDodgeSnapshot): number {
  const offset = snapshot.serverPosition;
  if (!offset) return 0;
  return Math.hypot(offset.x - snapshot.position.x, offset.y - snapshot.position.y);
}

function countEscapeOptions(
  environment: DodgePlanningEnvironment,
  x: number,
  y: number,
  safeWalk: boolean,
  probeDistance = 0.35,
): number {
  let count = 0;
  for (let index = 0; index < 8; index++) {
    const angle = index * TWO_PI / 8;
    if (environment.canOccupy(
      x + Math.cos(angle) * probeDistance,
      y + Math.sin(angle) * probeDistance,
      safeWalk,
      false,
    )) {
      count++;
    }
  }
  return count;
}

function applyWallTopology(
  candidates: readonly Candidate[],
  snapshot: AutoDodgeSnapshot,
  safeWalk: boolean,
  config: ProdMafiaDodgeConfig,
): void {
  if (snapshot.moveSpeed <= 0 || config.cornerLookAheadTiles <= 0) return;
  const topologyHorizonMs = Math.min(
    config.lookAheadMs,
    Math.ceil(config.cornerLookAheadTiles / snapshot.moveSpeed),
  );
  for (const candidate of candidates) {
    if (!candidate.valid) continue;
    const reachableMs = Number.isFinite(candidate.wallBlockMs)
      ? Math.max(0, candidate.wallBlockMs - SAMPLE_MS)
      : config.lookAheadMs;
    const topologyReachableMs = Math.min(reachableMs, topologyHorizonMs);
    const endpointOffset = snapshot.movementLeadMs + topologyReachableMs;
    const endpointX = snapshot.position.x
      + candidate.x * snapshot.moveSpeed * candidate.speedScale * endpointOffset;
    const endpointY = snapshot.position.y
      + candidate.y * snapshot.moveSpeed * candidate.speedScale * endpointOffset;
    // Priority 1: the real `safeWalk` flag, not a hardcoded `true`. With Safe
    // Walk off, `<Sink/>` tiles (Abyss lava, Moonlight Village and Woodland
    // water, Japanese ponds) are walkable, so treating them as solid here
    // collapsed the measured escape space on exactly those maps.
    candidate.escapeOptions = countEscapeOptions(
      snapshot.environment,
      endpointX,
      endpointY,
      safeWalk,
      WALL_ESCAPE_PROBE_DISTANCE,
    );
    const approachingWall = Number.isFinite(candidate.wallBlockMs)
      && candidate.wallBlockMs <= topologyHorizonMs;
    const approachRatio = approachingWall
      ? 1 - topologyReachableMs / Math.max(1, topologyHorizonMs)
      : 0;
    candidate.wallPenalty = (approachRatio * WALL_APPROACH_RISK
      + (8 - candidate.escapeOptions) / 8 * WALL_TOPOLOGY_RISK) * config.cornerStrength;
    candidate.risk += candidate.wallPenalty;
  }
}

function applyShooterCore(
  candidates: readonly Candidate[],
  snapshot: AutoDodgeSnapshot,
  coreRadius: number,
): number {
  const reach = coreRadius + snapshot.moveSpeed * LOCAL_MOBILITY_HORIZON_MS;
  const emitters = (snapshot.pointBlankEmitters ?? []).filter((emitter) =>
    distanceSquaredPoints(snapshot.position.x, snapshot.position.y, emitter.x, emitter.y)
      <= reach * reach);
  if (emitters.length === 0) return 0;
  let directThreat = false;
  for (const candidate of candidates) {
    if (!candidate.valid) continue;
    const endpointX = snapshot.position.x
      + candidate.x * snapshot.moveSpeed * candidate.speedScale * LOCAL_MOBILITY_HORIZON_MS;
    const endpointY = snapshot.position.y
      + candidate.y * snapshot.moveSpeed * candidate.speedScale * LOCAL_MOBILITY_HORIZON_MS;
    let clearance = Infinity;
    for (const emitter of emitters) {
      const startDistance = Math.hypot(
        snapshot.position.x - emitter.x,
        snapshot.position.y - emitter.y,
      );
      const emitterClearance = startDistance < coreRadius
        ? Math.hypot(endpointX - emitter.x, endpointY - emitter.y) - coreRadius
        : pointToSegmentDistance(
            emitter.x,
            emitter.y,
            snapshot.position.x,
            snapshot.position.y,
            endpointX,
            endpointY,
          ) - coreRadius;
      clearance = Math.min(clearance, emitterClearance);
    }
    candidate.minimumClearance = Math.min(candidate.minimumClearance, clearance);
    if (clearance < 0) {
      candidate.risk += SHOOTER_CORE_RISK - clearance * SHOOTER_CORE_RISK;
      candidate.firstImpactMs = Math.min(candidate.firstImpactMs, 0);
    }
    if (candidate.index === INTENT_CANDIDATE && clearance < 0) directThreat = true;
  }
  return directThreat ? 1 : 0;
}

function applyReactiveDamage(
  candidates: readonly Candidate[],
  snapshot: AutoDodgeSnapshot,
  reactive: { active: boolean; x: number; y: number; amount: number },
  lookAheadMs: number,
): number {
  if (!reactive.active) return 0;
  const directThreat = Math.hypot(
    snapshot.position.x - reactive.x,
    snapshot.position.y - reactive.y,
  ) < REACTIVE_DAMAGE_RADIUS;
  for (const candidate of candidates) {
    if (!candidate.valid) continue;
    const travelMs = Math.min(
      lookAheadMs,
      Number.isFinite(candidate.wallBlockMs)
        ? Math.max(0, candidate.wallBlockMs - SAMPLE_MS)
        : lookAheadMs,
    );
    const endpointX = snapshot.position.x
      + candidate.x * snapshot.moveSpeed * candidate.speedScale * travelMs;
    const endpointY = snapshot.position.y
      + candidate.y * snapshot.moveSpeed * candidate.speedScale * travelMs;
    const clearance = Math.hypot(
      endpointX - reactive.x,
      endpointY - reactive.y,
    ) - REACTIVE_DAMAGE_RADIUS;
    candidate.minimumClearance = Math.min(candidate.minimumClearance, clearance);
    if (clearance < 0) {
      candidate.risk += SHOOTER_CORE_RISK - clearance * SHOOTER_CORE_RISK
        + reactive.amount * 0.04;
      candidate.firstImpactMs = Math.min(candidate.firstImpactMs, 0);
    }
  }
  return directThreat ? 1 : 0;
}

function mobilityTier(escapeOptions: number): number {
  return escapeOptions >= 6 ? 2 : escapeOptions >= 4 ? 1 : 0;
}

function distanceSquaredPoints(
  firstX: number,
  firstY: number,
  secondX: number,
  secondY: number,
): number {
  const dx = firstX - secondX;
  const dy = firstY - secondY;
  return dx * dx + dy * dy;
}

function spacingCandidate(
  environment: DodgePlanningEnvironment,
  x: number,
  y: number,
  safeWalk: boolean,
): number {
  let bestDirection = -1;
  let bestOpen = -1;
  let worstOpen = SPACING_PROBE_TILES;
  for (let candidate = 1; candidate <= DIRECTION_COUNT; candidate++) {
    const angle = (candidate - 1) * TWO_PI / DIRECTION_COUNT;
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    let open = SPACING_PROBE_TILES;
    for (
      let travelled = SPACING_STEP_TILES;
      travelled <= SPACING_PROBE_TILES + EPSILON;
      travelled += SPACING_STEP_TILES
    ) {
      // Priority 1: the real `safeWalk` flag. A literal `true` here made every
      // `<Sink/>` tile read as a wall, so proactive spacing measured a collapsed
      // open space on lava and water maps and refused to move.
      if (!environment.canOccupy(
        x + directionX * travelled,
        y + directionY * travelled,
        safeWalk,
        false,
      )) {
        open = travelled - SPACING_STEP_TILES;
        break;
      }
    }
    worstOpen = Math.min(worstOpen, open);
    if (open > bestOpen) {
      bestOpen = open;
      bestDirection = candidate;
    }
  }
  return bestDirection > 0
    && worstOpen < SPACING_PROBE_TILES
    && bestOpen >= worstOpen + SPACING_MIN_GAIN_TILES
    ? bestDirection
    : -1;
}

function nearestEquivalentFixedCandidate(
  candidates: readonly Candidate[],
  selected: Candidate,
): Candidate {
  let best = selected;
  let bestDot = -Infinity;
  for (let index = 1; index <= DIRECTION_COUNT; index++) {
    const candidate = candidates[index]!;
    if (!candidate.valid
      || candidate.expectedDamage > selected.expectedDamage + EPSILON
      || candidate.groundExposureMs > selected.groundExposureMs
      || candidate.minimumClearance + EPSILON < selected.minimumClearance) {
      continue;
    }
    const dot = candidate.x * selected.x + candidate.y * selected.y;
    if (dot > bestDot) {
      bestDot = dot;
      best = candidate;
    }
  }
  return best;
}

function aoeInterventionLead(
  snapshot: AutoDodgeSnapshot,
  aoes: readonly DodgePlanningAoe[],
  config: ProdMafiaDodgeConfig,
): number {
  if (snapshot.moveSpeed <= 0) return config.aoeLookAheadMs;
  let lead = config.reactionLeadMs;
  for (const aoe of aoes) {
    const landingOffset = aoe.landingTime - snapshot.time;
    if (landingOffset < 0 || landingOffset > config.aoeLookAheadMs) continue;
    const distanceToCenter = pointToServerCorridorDistance(
      aoe.x,
      aoe.y,
      snapshot.position.x,
      snapshot.position.y,
      snapshot.movementLeadMs,
      snapshot,
    );
    const escapeTiles = Math.max(0, aoe.radius + config.aoeClearance - distanceToCenter);
    const escapeMs = Math.ceil(escapeTiles / (snapshot.moveSpeed * AOE_ESCAPE_SPEED_FACTOR));
    lead = Math.max(lead, escapeMs + AOE_REACTION_MARGIN_MS);
  }
  return Math.min(config.aoeLookAheadMs, lead);
}

function minimumProjectileCorridorPointClearance(
  projectileX: number,
  projectileY: number,
  playerX: number,
  playerY: number,
  movementOffset: number,
  snapshot: AutoDodgeSnapshot,
): number {
  const local = Math.max(
    Math.abs(projectileX - playerX),
    Math.abs(projectileY - playerY),
  );
  const serverOffset = temporalServerOffset(snapshot, movementOffset);
  if (!serverOffset) return local;
  return Math.min(local, Math.max(
    Math.abs(projectileX - (playerX + serverOffset.x)),
    Math.abs(projectileY - (playerY + serverOffset.y)),
  ));
}

function minimumProjectileCorridorSweepClearance(
  previousProjectileX: number,
  previousProjectileY: number,
  projectileX: number,
  projectileY: number,
  previousPlayerX: number,
  previousPlayerY: number,
  playerX: number,
  playerY: number,
  previousMovementOffset: number,
  movementOffset: number,
  snapshot: AutoDodgeSnapshot,
): number {
  const local = minimumChebyshevOnSegment(
    previousProjectileX - previousPlayerX,
    previousProjectileY - previousPlayerY,
    projectileX - playerX,
    projectileY - playerY,
  );
  const previousServerOffset = temporalServerOffset(snapshot, previousMovementOffset);
  const serverOffset = temporalServerOffset(snapshot, movementOffset);
  if (!previousServerOffset || !serverOffset) return local;
  return Math.min(local, minimumChebyshevOnSegment(
    previousProjectileX - (previousPlayerX + previousServerOffset.x),
    previousProjectileY - (previousPlayerY + previousServerOffset.y),
    projectileX - (playerX + serverOffset.x),
    projectileY - (playerY + serverOffset.y),
  ));
}

function minimumLaserCorridorClearance(
  playerX: number,
  playerY: number,
  movementOffset: number,
  projectile: CombatProjectileSnapshot,
  snapshot: AutoDodgeSnapshot,
): number {
  const local = laserClearance(playerX, playerY, projectile);
  const serverOffset = temporalServerOffset(snapshot, movementOffset);
  return serverOffset
    ? Math.min(
        local,
        laserClearance(
          playerX + serverOffset.x,
          playerY + serverOffset.y,
          projectile,
        ),
      )
    : local;
}

function pointToServerCorridorDistance(
  pointX: number,
  pointY: number,
  playerX: number,
  playerY: number,
  movementOffset: number,
  snapshot: AutoDodgeSnapshot,
): number {
  const local = Math.hypot(pointX - playerX, pointY - playerY);
  const serverOffset = temporalServerOffset(snapshot, movementOffset);
  return serverOffset
    ? Math.min(
        local,
        Math.hypot(
          pointX - (playerX + serverOffset.x),
          pointY - (playerY + serverOffset.y),
        ),
      )
    : local;
}

function temporalServerOffset(
  snapshot: AutoDodgeSnapshot,
  movementOffset: number,
): { x: number; y: number } | null {
  if (!snapshot.serverPosition) return null;
  let offsetX = snapshot.serverPosition.x - snapshot.position.x;
  let offsetY = snapshot.serverPosition.y - snapshot.position.y;
  const distance = Math.hypot(offsetX, offsetY);
  if (distance < SERVER_PATH_MIN_OFFSET) return null;
  if (distance > SERVER_PATH_MAX_OFFSET) {
    const scale = SERVER_PATH_MAX_OFFSET / distance;
    offsetX *= scale;
    offsetY *= scale;
  }
  const temporalScale = Math.max(0, 1 - Math.max(0, movementOffset) / SERVER_PATH_CATCHUP_MS);
  return {
    x: offsetX * temporalScale,
    y: offsetY * temporalScale,
  };
}

/** Exact minimum L-infinity distance from the origin to a line segment. */
function minimumChebyshevOnSegment(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  let best = Math.min(
    Math.max(Math.abs(x0), Math.abs(y0)),
    Math.max(Math.abs(x1), Math.abs(y1)),
  );
  const dx = x1 - x0;
  const dy = y1 - y0;
  const probes: number[] = [];
  if (dx !== 0) probes.push(-x0 / dx);
  if (dy !== 0) probes.push(-y0 / dy);
  if (dx !== dy) probes.push((y0 - x0) / (dx - dy));
  if (dx !== -dy) probes.push((-y0 - x0) / (dx + dy));
  for (const ratio of probes) {
    if (ratio <= 0 || ratio >= 1) continue;
    const x = x0 + dx * ratio;
    const y = y0 + dy * ratio;
    best = Math.min(best, Math.max(Math.abs(x), Math.abs(y)));
  }
  return best;
}

function buildTrajectory(
  snapshot: AutoDodgeSnapshot,
  velocity: { x: number; y: number },
): DodgeTrajectory {
  const offsets = [20, 40, 65, 95, 130, 175, 230, 300];
  return {
    createdAt: snapshot.time,
    waypoints: offsets.map((timeOffsetMs) => ({
      timeOffsetMs,
      x: snapshot.position.x + velocity.x * timeOffsetMs,
      y: snapshot.position.y + velocity.y * timeOffsetMs,
      speed: Math.hypot(velocity.x, velocity.y) * 1000,
    })),
  };
}

function laserClearance(
  x: number,
  y: number,
  projectile: CombatProjectileSnapshot,
): number {
  const length = projectile.definition.laserDistance ?? 0;
  return pointToSegmentDistance(
    x,
    y,
    projectile.startX,
    projectile.startY,
    projectile.startX + Math.cos(projectile.angle) * length,
    projectile.startY + Math.sin(projectile.angle) * length,
  );
}

function pointToSegmentDistance(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): number {
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared <= 1e-7) return Math.hypot(pointX - startX, pointY - startY);
  const ratio = Math.max(0, Math.min(1,
    ((pointX - startX) * segmentX + (pointY - startY) * segmentY) / lengthSquared));
  return Math.hypot(
    pointX - (startX + segmentX * ratio),
    pointY - (startY + segmentY * ratio),
  );
}

function minimumFinite(values: readonly number[]): number {
  let minimum = Infinity;
  for (const value of values) if (value < minimum) minimum = value;
  return minimum;
}

function angularDistance(first: number, second: number): number {
  let difference = Math.abs(first - second) % TWO_PI;
  if (difference > Math.PI) difference = TWO_PI - difference;
  return difference;
}

function emptyMetrics(): DeterministicDodgePlannerMetrics {
  return {
    layerCount: 1,
    statesEnteringLayers: [1],
    candidatesGenerated: 0,
    candidatesRejectedByGeometry: 0,
    candidatesRejectedByProjectiles: 0,
    statesMerged: 0,
    statesPrunedByBeam: 0,
    activeProjectilesConsidered: 0,
    projectilesRejectedByBroadPhase: 0,
    trajectoryInvalidations: 0,
    normalReplans: 0,
    urgentReplans: 0,
    totalPlans: 0,
    coalescedProjectileUpdates: 0,
  };
}

function emptyState(enabled: boolean): AutoDodgeState {
  return {
    enabled,
    overrideActive: false,
    velocity: { x: 0, y: 0 },
    target: null,
    goal: null,
    path: [],
    trajectory: null,
    planRevision: 0,
    planReused: false,
    searchRevision: 0,
    searchPerformed: false,
    planCommitted: false,
    replanCause: null,
    movementIntentMode: null,
    safetyState: 'normal',
    retreatPenaltyScale: 1,
    lastReplanAt: null,
    replanReason: null,
    dangerRevision: 0,
    threatCount: 0,
    earliestImpactMs: null,
    selectedCandidate: 0,
    speedScale: 0,
    commandedSpeed: 0,
    progressSpeed: 0,
    firstControlHeading: null,
    headingChange: null,
    committedScore: null,
    proposedScore: null,
    comparisonHorizonMs: null,
    movementTargetDistance: 0,
    timeSinceLastMovementCommandMs: null,
    lookaheadRevision: 0,
    lookaheadChanged: false,
    decision: 'disabled',
    plannerMetrics: emptyMetrics(),
    route: null,
  };
}

function cloneState(state: AutoDodgeState): AutoDodgeState {
  return {
    ...state,
    velocity: { ...state.velocity },
    target: state.target ? { ...state.target } : null,
    goal: state.goal ? { ...state.goal } : null,
    path: state.path.map((point) => ({ ...point })),
    trajectory: state.trajectory ? {
      createdAt: state.trajectory.createdAt,
      waypoints: state.trajectory.waypoints.map((waypoint) => ({ ...waypoint })),
    } : null,
    plannerMetrics: {
      ...state.plannerMetrics,
      statesEnteringLayers: [...state.plannerMetrics.statesEnteringLayers],
    },
  };
}
