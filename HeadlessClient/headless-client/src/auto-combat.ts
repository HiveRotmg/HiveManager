import {
  Classes,
  ConditionEffectBits,
  PlayerData,
  StatType,
} from 'realmlib';
import type {
  CombatDataProvider,
  CombatObjectDefinition,
  CombatProjectileDefinition,
} from './combat-tracker';
import type { WeaponAimPreview } from './command-sender';
import type { TrackedObject } from './models';
import { TargetMotionPredictor, type MotionObservation } from './target-motion-predictor';

/**
 * The four ProdMafia auto-aim modes.
 * `closestToAim` is the client's "closest to cursor" mode; scripts supply its
 * cursor-equivalent world coordinate through `aimPoint`.
 */
export type AutoAimMode = 'closest' | 'closestToAim' | 'maxHp' | 'random';

export interface AutoAimOptions {
  mode?: AutoAimMode;
  /** Maximum range in tiles. Zero derives range from the equipped weapon. */
  range?: number;
  bossPriority?: boolean;
  leadTargets?: boolean;
  includeInvulnerable?: boolean;
  /** Source `shootAtWalls`: false skips non-Character structures by default. */
  shootAtWalls?: boolean;
  /** Source `damageIgnored`: include types listed in `ignoredTypes`. */
  includeIgnored?: boolean;
  /** Source `onlyAimAtExcepted`: restrict to `exceptedTypes`. */
  onlyExcepted?: boolean;
  /** Runtime equivalent of ProdMafia's AAIgnore type list. */
  ignoredTypes?: readonly number[];
  /** Runtime equivalent of ProdMafia's AAException type list. */
  exceptedTypes?: readonly number[];
  /** Runtime equivalent of ProdMafia's CustomPriorityList. */
  priorityTypes?: readonly number[];
  /** World-space cursor/reference point used by `closestToAim`. */
  aimPoint?: { x: number; y: number };
  /** Source `AABoundingDist`, in tiles, for `closestToAim`. */
  boundingDistance?: number;
  weaponSlot?: number;
  /**
   * Source `avoidO3Shield`: never fire at Oryx the Mad God 3 while his GUARD
   * sprite is raised, because further damage triggers a 30s unpurifiable
   * Silence. The source detects the guard by alt-texture id but has not yet
   * captured which id that is, so the ids live in `o3GuardAltTextureIds`.
   */
  avoidO3Shield?: boolean;
  /**
   * Alt-texture ids that mark O3's raised shield. Empty reproduces the source's
   * current behaviour, where the capture is still outstanding and nothing is
   * suppressed. Non-player objects carry this id in the BXP stat slot.
   */
  o3GuardAltTextureIds?: readonly number[];
}

/** One step of the source's Tomb boss rotation. */
export interface TombBossPhase {
  /** The name the source flashes when the key selects this boss. */
  name: string;
  /** Tomb of the Ancients type followed by its Ice Tomb counterpart. */
  types: readonly number[];
}

/**
 * Source `TombCycleKey` (`MapUserInput.as:763-798`): rotating which Tomb of the
 * Ancients boss stays attackable kills them in the order the dungeon requires.
 * Each step keeps one boss out of the ignore list and puts the other two in,
 * covering the Ice Tomb variants alongside the originals.
 */
export const TOMB_BOSS_CYCLE: readonly TombBossPhase[] = [
  // Tomb Support (0x0d26) / Ice Tomb Support (0x7fb4).
  { name: 'Bes', types: [3366, 32692] },
  // Tomb Attacker (0x0d27) / Ice Tomb Attacker (0x7fb5).
  { name: 'Nut', types: [3367, 32693] },
  // Tomb Defender (0x0d28) / Ice Tomb Defender (0x7fb6).
  { name: 'Geb', types: [3368, 32694] },
];

export interface AutoAbilityOptions {
  /** Minimum current MP percentage (0-100). */
  minMpPercent?: number;
  /** Only use the ability when the selected target has at least this much HP. */
  minTargetHp?: number;
  /** Minimum number of valid enemies within ability range. */
  minTargets?: number;
  /** Maximum range in tiles. Zero derives range from the ability projectile. */
  range?: number;
  /** Additional minimum cooldown; the item's own cooldown is always respected. */
  cooldownMs?: number;
  /** Teleporting abilities are skipped unless explicitly enabled. */
  allowTeleport?: boolean;
  /**
   * Source `spellbombHPThreshold`: minimum enemy MAX HP before a single-target
   * ability (Wizard spellbomb, Archer quiver, Knight shield) may target it.
   * Zero keeps the generic path, which only consults `minTargetHp`.
   */
  singleTargetHpThreshold?: number;
  /**
   * Source `skullHPThreshold`: the same gate for AoE abilities (Necromancer,
   * Assassin, Huntress, Sorcerer, and a group-stasis Mystic). Zero disables it.
   */
  aoeHpThreshold?: number;
  /**
   * Source `skullTargets`: how many enemies must sit inside the AoE radius
   * before the ability fires at that cluster. Zero keeps the generic
   * single-target path, so `aoeHpThreshold` acts alone.
   */
  aoeMinTargets?: number;
  /** Source `<Activate radius>` of the equipped AoE ability, in tiles. */
  aoeRadius?: number;
  /**
   * Source `spamPrismNumber`: fire non-teleporting Trickster prisms in place
   * once more than this many enemies are nearby. Zero disables the spam, and
   * teleporting prisms are never spammed regardless of `allowTeleport`.
   */
  spamPrismTargets?: number;
  /** Source `mysticAAShootGroup`: stasis enemy groups instead of the player. */
  mysticStasisGroup?: boolean;
}

export interface AutoCombatState {
  autoAimEnabled: boolean;
  autoAbilityEnabled: boolean;
  mode: AutoAimMode;
  targetObjectId: number | null;
  fixedPosition: { x: number; y: number } | null;
  autoAim: Required<AutoAimOptions>;
  autoAbility: Required<AutoAbilityOptions>;
  /** Name of the Tomb boss the rotation currently leaves attackable. */
  tombBoss: string | null;
}

export interface AutoCombatSnapshot {
  inWorld: boolean;
  safeMap: boolean;
  player: PlayerData | undefined;
  playerPos: { x: number; y: number };
  objects: Iterable<TrackedObject>;
}

export interface AutoCombatActions {
  /** Retained for command compatibility; ProdMafia auto aim does not consult it. */
  previewWeaponAim?(weaponSlot: number): WeaponAimPreview | null;
  shootAt(target: { x: number; y: number }, weaponSlot: number): boolean;
  useAbilityAt(target: { x: number; y: number }): boolean;
}

interface TargetCandidate {
  object: TrackedObject;
  definition: CombatObjectDefinition;
  hp: number;
  maxHp: number;
  distance: number;
  boss: boolean;
}

const DEFAULT_AUTO_AIM: Required<AutoAimOptions> = {
  mode: 'closest',
  range: 0,
  bossPriority: true,
  leadTargets: true,
  includeInvulnerable: false,
  shootAtWalls: false,
  includeIgnored: false,
  onlyExcepted: false,
  ignoredTypes: [],
  exceptedTypes: [],
  priorityTypes: [],
  aimPoint: { x: 0, y: 0 },
  boundingDistance: 4,
  weaponSlot: 0,
  avoidO3Shield: true,
  o3GuardAltTextureIds: [],
};

const DEFAULT_AUTO_ABILITY: Required<AutoAbilityOptions> = {
  minMpPercent: 50,
  minTargetHp: 0,
  minTargets: 1,
  range: 0,
  cooldownMs: 0,
  allowTeleport: false,
  singleTargetHpThreshold: 0,
  aoeHpThreshold: 0,
  aoeMinTargets: 0,
  aoeRadius: 0,
  spamPrismTargets: 0,
  mysticStasisGroup: false,
};

/**
 * The source's shipped values for the class-specific gates
 * (`Parameters.as:749-751`, `:980`, `:1000`). Our own defaults leave every one
 * of these paths switched off so existing scripts keep the generic behaviour;
 * pass this to `configureAutoAbility` to opt into the source's tuning.
 */
export const PRODMAFIA_AUTO_ABILITY_DEFAULTS: Readonly<AutoAbilityOptions> = {
  singleTargetHpThreshold: 250,
  aoeHpThreshold: 800,
  aoeMinTargets: 5,
  spamPrismTargets: 0,
  mysticStasisGroup: false,
};

const DEFAULT_WEAPON_RANGE = 8;
const DEFAULT_ABILITY_RANGE = 12;
const DEFAULT_ABILITY_COOLDOWN_MS = 550;

/** Upper bounds of the source `spellbombHPThreshold` / `skullHPThreshold` choice lists. */
const MAX_SINGLE_TARGET_HP_THRESHOLD = 20_000;
const MAX_AOE_HP_THRESHOLD = 8_000;
/** Upper bound shared by the `skullTargets` and `spamPrismNumber` choice lists. */
const MAX_AOE_TARGETS = 10;

/**
 * Both nearby-enemy scans in the source gate on `getDistSquared(...) <= 225`
 * — the prism count (`Player.as:2510`) and the cluster search
 * (`Player.as:3036`).
 */
const AOE_SEARCH_RANGE = 15;

/**
 * Fallback AoE radius when none is configured: the top-tier `VampireBlast`
 * radius from the source assets, the skull being what the cluster search was
 * written for. The source instead reads `<Activate radius>` off the equipped
 * ability, which our game data does not carry.
 */
const DEFAULT_AOE_RADIUS = 3.75;

/** Oryx the Mad God 3 (`Player.as:2610`). */
const ORYX3_TYPE = 0xb133;

/**
 * Non-player objects carry their alt-texture id in the BXP stat slot, which the
 * source aliases as `StatData.ALT_TEXTURE_STAT`.
 */
const ALT_TEXTURE_STAT = StatType.BXP_STAT;

/**
 * Classes whose ability is single-target, and so gated on
 * `spellbombHPThreshold`: the Wizard spellbomb takes the `rangeSq == 144`
 * branch (`Player.as:2665`) while the Archer and Knight pass
 * `applySpellbombThreshold` (`Player.as:2521-2529`).
 */
const SINGLE_TARGET_CLASSES: readonly number[] = [Classes.Wizard, Classes.Archer, Classes.Knight];

/** The Sorcerer scepter takes the `rangeSq == 49` branch (`Player.as:2707`). */
const AOE_TARGET_CLASSES: readonly number[] = [Classes.Sorcerer];

/** Classes the source routes through `getNecroTarget` (`Player.as:2468-2483`). */
const AOE_GROUP_CLASSES: readonly number[] = [
  Classes.Assassin,
  Classes.Necromancer,
  Classes.Huntress,
];

/** Per-client target selection and firing state. Driven by Client's combat timer. */
export class AutoCombatController {
  private aim = { ...DEFAULT_AUTO_AIM };
  private ability = { ...DEFAULT_AUTO_ABILITY };
  private autoAimEnabled = false;
  private autoAbilityEnabled = false;
  private fixedObjectId: number | null = null;
  private fixedPosition: { x: number; y: number } | null = null;
  private selectedObjectId: number | null = null;
  /** Index into `TOMB_BOSS_CYCLE`; -1 until the cycle is first advanced. */
  private tombPhase = -1;
  private lastAbilityAt = -Infinity;
  private lastUpdateAt = -Infinity;
  // Auto Aim deliberately uses ProdMafia's conservative two-confirming-turn
  // model. The broader predictor remains available for other consumers/tests,
  // but Auto Aim must not hallucinate a circular path from one correction.
  private readonly motion = new TargetMotionPredictor('prodMafia');

  constructor(private readonly data: CombatDataProvider) {}

  aimAt(objectId: number): boolean {
    if (!Number.isFinite(objectId) || objectId <= 0) return false;
    this.fixedObjectId = Math.trunc(objectId);
    this.fixedPosition = null;
    this.autoAimEnabled = false;
    this.selectedObjectId = this.fixedObjectId;
    return true;
  }

  aimAtPosition(x: number, y: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    this.fixedPosition = { x, y };
    this.fixedObjectId = null;
    this.autoAimEnabled = false;
    this.selectedObjectId = null;
    return true;
  }

  stopAiming(): void {
    this.fixedObjectId = null;
    this.fixedPosition = null;
    this.selectedObjectId = null;
    this.autoAimEnabled = false;
  }

  enableAutoAim(options?: AutoAimOptions): boolean {
    if (options && !this.configureAutoAim(options)) return false;
    this.fixedObjectId = null;
    this.fixedPosition = null;
    this.autoAimEnabled = true;
    return true;
  }

  configureAutoAim(options: AutoAimMode | AutoAimOptions): boolean {
    const next = typeof options === 'string' ? { mode: options } : options;
    const mode = next.mode === undefined ? this.aim.mode : normalizeMode(next.mode);
    if (!mode) return false;
    this.aim = {
      mode,
      range: finiteNonNegative(next.range, this.aim.range),
      bossPriority: next.bossPriority ?? this.aim.bossPriority,
      leadTargets: next.leadTargets ?? this.aim.leadTargets,
      includeInvulnerable: next.includeInvulnerable ?? this.aim.includeInvulnerable,
      shootAtWalls: next.shootAtWalls ?? this.aim.shootAtWalls,
      includeIgnored: next.includeIgnored ?? this.aim.includeIgnored,
      onlyExcepted: next.onlyExcepted ?? this.aim.onlyExcepted,
      ignoredTypes: next.ignoredTypes === undefined ? this.aim.ignoredTypes : normalizeObjectTypes(next.ignoredTypes),
      exceptedTypes: next.exceptedTypes === undefined ? this.aim.exceptedTypes : normalizeObjectTypes(next.exceptedTypes),
      priorityTypes: next.priorityTypes === undefined ? this.aim.priorityTypes : normalizeObjectTypes(next.priorityTypes),
      aimPoint: next.aimPoint === undefined ? this.aim.aimPoint : finitePoint(next.aimPoint, this.aim.aimPoint),
      boundingDistance: finiteNonNegative(next.boundingDistance, this.aim.boundingDistance),
      weaponSlot: Math.trunc(finiteNonNegative(next.weaponSlot, this.aim.weaponSlot)),
      avoidO3Shield: next.avoidO3Shield ?? this.aim.avoidO3Shield,
      o3GuardAltTextureIds: next.o3GuardAltTextureIds === undefined
        ? this.aim.o3GuardAltTextureIds
        : normalizeObjectTypes(next.o3GuardAltTextureIds),
    };
    return true;
  }

  /**
   * Advances the source's Tomb boss rotation and returns the boss that is now
   * attackable. Like the source hotkey this works purely through the ignore
   * list, so it needs `includeIgnored` (source `damageIgnored`) left off.
   */
  cycleTombBoss(): TombBossPhase {
    this.tombPhase = (this.tombPhase + 1) % TOMB_BOSS_CYCLE.length;
    const active = TOMB_BOSS_CYCLE[this.tombPhase]!;
    const ignored = new Set(this.aim.ignoredTypes);
    for (const phase of TOMB_BOSS_CYCLE) {
      for (const type of phase.types) {
        if (phase === active) ignored.delete(type);
        else ignored.add(type);
      }
    }
    this.aim.ignoredTypes = [...ignored];
    return active;
  }

  /** Source `/tomb`: drops every Tomb boss type back out of the ignore list. */
  clearTombBossCycle(): void {
    const cycled = new Set(TOMB_BOSS_CYCLE.flatMap((phase) => phase.types));
    this.aim.ignoredTypes = this.aim.ignoredTypes.filter((type) => !cycled.has(type));
    this.tombPhase = -1;
  }

  /** The Tomb boss the cycle currently leaves attackable, or null when unused. */
  getTombBoss(): TombBossPhase | null {
    return TOMB_BOSS_CYCLE[this.tombPhase] ?? null;
  }

  enableAutoAbility(options?: AutoAbilityOptions): boolean {
    if (options && !this.configureAutoAbility(options)) return false;
    this.autoAbilityEnabled = true;
    return true;
  }

  configureAutoAbility(options: AutoAbilityOptions): boolean {
    this.ability = {
      minMpPercent: clamp(finiteNonNegative(options.minMpPercent, this.ability.minMpPercent), 0, 100),
      minTargetHp: finiteNonNegative(options.minTargetHp, this.ability.minTargetHp),
      minTargets: Math.max(1, Math.trunc(finiteNonNegative(options.minTargets, this.ability.minTargets))),
      range: finiteNonNegative(options.range, this.ability.range),
      cooldownMs: finiteNonNegative(options.cooldownMs, this.ability.cooldownMs),
      allowTeleport: options.allowTeleport ?? this.ability.allowTeleport,
      singleTargetHpThreshold: clamp(
        finiteNonNegative(options.singleTargetHpThreshold, this.ability.singleTargetHpThreshold),
        0,
        MAX_SINGLE_TARGET_HP_THRESHOLD,
      ),
      aoeHpThreshold: clamp(
        finiteNonNegative(options.aoeHpThreshold, this.ability.aoeHpThreshold),
        0,
        MAX_AOE_HP_THRESHOLD,
      ),
      aoeMinTargets: Math.trunc(clamp(
        finiteNonNegative(options.aoeMinTargets, this.ability.aoeMinTargets),
        0,
        MAX_AOE_TARGETS,
      )),
      aoeRadius: clamp(finiteNonNegative(options.aoeRadius, this.ability.aoeRadius), 0, AOE_SEARCH_RANGE),
      spamPrismTargets: Math.trunc(clamp(
        finiteNonNegative(options.spamPrismTargets, this.ability.spamPrismTargets),
        0,
        MAX_AOE_TARGETS,
      )),
      mysticStasisGroup: options.mysticStasisGroup ?? this.ability.mysticStasisGroup,
    };
    return true;
  }

  disableAutoAbility(): void {
    this.autoAbilityEnabled = false;
  }

  getState(): AutoCombatState {
    return {
      autoAimEnabled: this.autoAimEnabled,
      autoAbilityEnabled: this.autoAbilityEnabled,
      mode: this.aim.mode,
      targetObjectId: this.selectedObjectId,
      fixedPosition: this.fixedPosition ? { ...this.fixedPosition } : null,
      autoAim: { ...this.aim, aimPoint: { ...this.aim.aimPoint } },
      autoAbility: { ...this.ability },
      tombBoss: this.getTombBoss()?.name ?? null,
    };
  }

  /** Clears map-scoped locks and motion samples while preserving enabled automation settings. */
  clearMap(): void {
    this.fixedObjectId = null;
    this.fixedPosition = null;
    this.selectedObjectId = null;
    this.motion.clear();
    this.lastUpdateAt = -Infinity;
    this.lastAbilityAt = -Infinity;
  }

  /** Records authoritative NEWTICK endpoints before frame-level aiming resumes. */
  observeWorldTick(now: number, tickTime: number, observations: Iterable<MotionObservation>): void {
    this.motion.observeTick(now, tickTime, observations);
  }

  snapObject(objectId: number, position: { x: number; y: number }, now: number): void {
    this.motion.snap(objectId, position, now);
  }

  removeObject(objectId: number): void {
    this.motion.remove(objectId);
  }

  currentObjectPosition(object: MotionObservation, now: number): { x: number; y: number } {
    return this.motion.currentPosition(object.objectId, object, now);
  }

  predictObjectPosition(
    objectId: number,
    fallback: { x: number; y: number },
    now: number,
    futureMs: number,
  ): { x: number; y: number } {
    return this.motion.predictPosition(objectId, fallback, now, futureMs);
  }

  update(now: number, snapshot: AutoCombatSnapshot, actions: AutoCombatActions): void {
    const objects = [...snapshot.objects];
    if (now < this.lastUpdateAt) this.clearMap();
    this.lastUpdateAt = now;
    this.motion.observeSnapshot(now, objects.filter((object) => {
      const definition = this.data.getObject(object.type);
      return !!definition?.isEnemy && !definition.invincible;
    }));

    if (!snapshot.inWorld || snapshot.safeMap || !snapshot.player) {
      this.selectedObjectId = null;
      return;
    }

    const player = snapshot.player;
    const weaponType = player.inventory?.[this.aim.weaponSlot] ?? -1;
    const rangeProjectile = weaponType >= 0 ? this.data.getProjectile(weaponType, 0) : undefined;
    // Direct port: Player.shootAutoAimWeaponAngle always takes projectiles_[0]
    // and calcAvgSpeed/calcMaxRange from that definition.
    const weaponRange = this.aim.range
      || projectileRange(rangeProjectile, player.projSpeedMult, player.projLifeMult)
      || DEFAULT_WEAPON_RANGE;
    const weaponCandidates = this.candidates(objects, snapshot.playerPos, weaponRange);
    const selected = this.resolveTarget(weaponCandidates, weaponRange);
    const fixedPoint = this.fixedPosition;
    const shouldShoot = !!fixedPoint || this.fixedObjectId !== null || this.autoAimEnabled;

    if (shouldShoot) {
      const point = fixedPoint ?? (selected
        ? this.aimPoint(
            selected.object,
            snapshot.playerPos,
            rangeProjectile,
            player.projSpeedMult,
            player.projLifeMult,
          )
        : null);
      this.selectedObjectId = selected?.object.objectId ?? null;
      if (point) actions.shootAt(point, this.aim.weaponSlot);
    } else {
      this.selectedObjectId = null;
    }

    if (!this.autoAbilityEnabled) return;
    this.updateAutoAbility(now, snapshot, objects, selected, actions);
  }

  private updateAutoAbility(
    now: number,
    snapshot: AutoCombatSnapshot,
    objects: TrackedObject[],
    weaponTarget: TargetCandidate | null,
    actions: AutoCombatActions,
  ): void {
    const player = snapshot.player!;
    const abilityType = player.inventory?.[1] ?? -1;
    if (abilityType < 0) return;
    const definition = this.data.getObject(abilityType);
    if (definition?.usable === false) return;
    const effects = definition?.activateEffects?.map((effect) => effect.toLowerCase()) ?? [];
    const teleporting = effects.some((effect) => effect.includes('teleport'));
    if (!this.ability.allowTeleport && teleporting) return;
    const maxMp = Math.max(0, player.maxMP ?? 0);
    const mpPercent = maxMp > 0 ? (player.mp ?? 0) / maxMp * 100 : 0;
    if (mpPercent < this.ability.minMpPercent) return;

    const projectile = this.data.getProjectile(abilityType, 0);
    const range = this.ability.range || projectileRange(projectile) || DEFAULT_ABILITY_RANGE;
    const candidates = this.candidates(objects, snapshot.playerPos, range);
    const inRange = candidates.filter((candidate) => candidate.distance < range);
    if (inRange.length < this.ability.minTargets) return;
    const point = this.abilityPoint(snapshot, objects, weaponTarget, inRange, range, projectile, teleporting);
    if (!point) return;
    const itemCooldown = Math.max(DEFAULT_ABILITY_COOLDOWN_MS, definition?.cooldownMs ?? 0);
    const cooldown = Math.max(itemCooldown, this.ability.cooldownMs);
    if (now < this.lastAbilityAt + cooldown) return;
    if (actions.useAbilityAt(point)) this.lastAbilityAt = now;
  }

  /**
   * Where the ability should be aimed, or null to hold this frame. The source
   * splits this by class in `Player.useAutoAbility`, so the class-specific
   * branches take precedence over the generic single-target selection; each one
   * stays inert until its own option is turned on.
   */
  private abilityPoint(
    snapshot: AutoCombatSnapshot,
    objects: TrackedObject[],
    weaponTarget: TargetCandidate | null,
    inRange: TargetCandidate[],
    range: number,
    projectile: CombatProjectileDefinition | undefined,
    teleporting: boolean,
  ): { x: number; y: number } | null {
    const playerClass = snapshot.player?.class ?? -1;

    // Trickster prisms are thrown in place and never lead a target
    // (`Player.as:2506-2519`). The source's Trickster branch bails out entirely
    // when the prism teleports, so `allowTeleport` cannot re-enable it here.
    if (playerClass === Classes.Trickster && this.ability.spamPrismTargets > 0) {
      if (teleporting) return null;
      const nearby = this.countNearbyEnemies(objects, snapshot.playerPos);
      return nearby > this.ability.spamPrismTargets ? { ...snapshot.playerPos } : null;
    }

    // Cluster targeting for the AoE abilities, plus a Mystic asked to stasis
    // groups rather than itself (`Player.as:2468-2483`, `:2562`).
    const groupTargeting = AOE_GROUP_CLASSES.includes(playerClass)
      || (playerClass === Classes.Mystic && this.ability.mysticStasisGroup);
    if (groupTargeting && this.ability.aoeMinTargets > 0) {
      const cluster = this.clusterTarget(objects, snapshot.playerPos);
      if (cluster) return { x: cluster.object.x, y: cluster.object.y };
      // Only the Necromancer falls back to raising its summons in place.
      return playerClass === Classes.Necromancer ? { ...snapshot.playerPos } : null;
    }

    const threshold = SINGLE_TARGET_CLASSES.includes(playerClass)
      ? this.ability.singleTargetHpThreshold
      : AOE_TARGET_CLASSES.includes(playerClass) ? this.ability.aoeHpThreshold : 0;
    // Both source thresholds compare against MAX HP, not current HP, despite the
    // option text; `minTargetHp` keeps its own current-HP meaning.
    const pool = threshold > 0 ? inRange.filter((candidate) => candidate.maxHp >= threshold) : inRange;
    if (pool.length < this.ability.minTargets) return null;
    const selected = this.fixedObjectId !== null
      ? pool.find((candidate) => candidate.object.objectId === this.fixedObjectId) ?? null
      : weaponTarget && weaponTarget.distance <= range && weaponTarget.maxHp >= threshold
        ? weaponTarget
        : this.selectCandidate(pool, range);
    if (selected && selected.hp < this.ability.minTargetHp) return null;
    return this.fixedPosition
      ?? (selected ? this.aimPoint(selected.object, snapshot.playerPos, projectile) : snapshot.playerPos);
  }

  /**
   * Port of the prism count at `Player.as:2509-2511`, which walks every object
   * and only checks `isEnemy` and the 15-tile radius — no HP, condition or
   * ignore-list filtering.
   */
  private countNearbyEnemies(objects: TrackedObject[], playerPos: { x: number; y: number }): number {
    let count = 0;
    for (const object of objects) {
      if (!this.data.getObject(object.type)?.isEnemy) continue;
      if (Math.hypot(object.x - playerPos.x, object.y - playerPos.y) <= AOE_SEARCH_RANGE) count++;
    }
    return count;
  }

  /**
   * Port of `Player.getNecroTarget` and `Player.getNumNearbyEnemies`
   * (`Player.as:3027-3062`): the enemy within 15 tiles that has the most
   * above-threshold company inside the ability radius. Both the centre and its
   * neighbours must clear `aoeHpThreshold`, and the count must strictly exceed
   * `aoeMinTargets`, matching the source's comparisons.
   */
  private clusterTarget(objects: TrackedObject[], playerPos: { x: number; y: number }): TargetCandidate | null {
    const radius = this.ability.aoeRadius || DEFAULT_AOE_RADIUS;
    const minTargets = this.ability.aoeMinTargets;
    // Reusing the aim filter also applies the ignore/exception lists, so the
    // Tomb rotation keeps holding for abilities as well as the weapon.
    const eligible = this.candidates(objects, playerPos, AOE_SEARCH_RANGE)
      .filter((candidate) => candidate.maxHp >= this.ability.aoeHpThreshold);
    let best: TargetCandidate | null = null;
    let bestCount = 0;
    for (const centre of eligible) {
      if (centre.distance > AOE_SEARCH_RANGE) continue;
      const count = eligible.filter((other) => Math.hypot(
        other.object.x - centre.object.x,
        other.object.y - centre.object.y,
      ) <= radius).length;
      if (count > minTargets && count > bestCount) {
        best = centre;
        bestCount = count;
      }
    }
    return bestCount < minTargets ? null : best;
  }

  private candidates(objects: TrackedObject[], playerPos: { x: number; y: number }, range: number): TargetCandidate[] {
    const result: TargetCandidate[] = [];
    for (const object of objects) {
      const definition = this.data.getObject(object.type);
      if (!definition?.isEnemy || definition.invincible) continue;
      if (!this.aim.shootAtWalls && definition.isCharacter === false) continue;
      if (!this.aim.includeIgnored && this.aim.ignoredTypes.includes(object.type)) continue;
      if (this.aim.onlyExcepted && !this.aim.exceptedTypes.includes(object.type)) continue;
      if (this.isO3ShieldBlocked(object)) continue;
      const condition = object.player?.condition ?? rawNumber(object, StatType.CONDITION_STAT, 0);
      const blocked = ConditionEffectBits.PAUSED | ConditionEffectBits.STASIS | ConditionEffectBits.INVINCIBLE;
      if ((condition & blocked) !== 0) continue;
      if (!this.aim.includeInvulnerable && (condition & ConditionEffectBits.INVULNERABLE) !== 0) continue;
      const hp = object.player?.hp ?? rawNumber(object, StatType.HP_STAT, definition.maxHp ?? 0);
      if (hp <= 0) continue;
      const distance = Math.hypot(object.x - playerPos.x, object.y - playerPos.y);
      const maxHp = object.player?.maxHP ?? rawNumber(object, StatType.MAX_HP_STAT, definition.maxHp ?? hp);
      result.push({
        object,
        definition,
        hp,
        maxHp,
        distance,
        boss: !!definition.boss || !!definition.quest || this.aim.priorityTypes.includes(object.type),
      });
    }
    return result;
  }

  /**
   * Port of `Player.isO3ShieldBlocked`. Damaging Oryx 3 through his guard makes
   * him counter with a 30s unpurifiable Silence, which for an unattended client
   * means no abilities and a likely death. The source identifies the guard by
   * its alt-texture swap rather than a condition bit, because O3's ordinary
   * Invulnerable and Armored spells are harmless; it has not captured the guard
   * id yet, so the ids stay configurable and an empty list suppresses nothing.
   */
  private isO3ShieldBlocked(object: TrackedObject): boolean {
    if (!this.aim.avoidO3Shield || object.type !== ORYX3_TYPE) return false;
    if (this.aim.o3GuardAltTextureIds.length === 0) return false;
    return this.aim.o3GuardAltTextureIds.includes(rawNumber(object, ALT_TEXTURE_STAT, -1));
  }

  private resolveTarget(candidates: TargetCandidate[], range: number): TargetCandidate | null {
    if (this.fixedObjectId !== null) {
      return candidates.find((candidate) => candidate.object.objectId === this.fixedObjectId && candidate.distance < range) ?? null;
    }
    return this.autoAimEnabled || this.autoAbilityEnabled ? this.selectCandidate(candidates, range) : null;
  }

  /** Direct structural port of Player.calcAimAngle's target-selection loop. */
  private selectCandidate(candidates: TargetCandidate[], range: number): TargetCandidate | null {
    if (candidates.length === 0) return null;
    const scans = this.aim.bossPriority ? [true, false] : [false];
    for (const bossOnly of scans) {
      const pool = bossOnly ? candidates.filter((candidate) => candidate.boss) : candidates;
      if (pool.length === 0) continue;
      const selected = this.selectProdMafiaMode(pool, range, bossOnly);
      if (selected) return selected;
    }
    return null;
  }

  private selectProdMafiaMode(pool: TargetCandidate[], range: number, bossOnly: boolean): TargetCandidate | null {
    switch (this.aim.mode) {
      case 'closestToAim': {
        const origin = this.aim.aimPoint;
        const boundSq = this.aim.boundingDistance ** 2;
        let best: TargetCandidate | null = null;
        let bestDistanceSq = Infinity;
        for (const candidate of pool) {
          if (candidate.distance > range) continue; // source mode 0 is <=
          const cursorDistanceSq = (candidate.object.x - origin.x) ** 2 + (candidate.object.y - origin.y) ** 2;
          if (cursorDistanceSq > boundSq) continue;
          // Player.as intentionally uses the last boss encountered here.
          if (bossOnly || cursorDistanceSq <= bestDistanceSq) {
            best = candidate;
            bestDistanceSq = cursorDistanceSq;
          }
        }
        return best;
      }
      case 'maxHp': {
        let best: TargetCandidate | null = null;
        let bestMaxHp = -2_147_483_648;
        let bestHp = -2_147_483_648;
        let bestDistance = Infinity;
        for (const candidate of pool) {
          if (candidate.distance >= range || candidate.maxHp < bestMaxHp) continue;
          // This is deliberately the same ordering/overwrite behaviour as
          // Player.calcAimAngle, including its scan-order tie handling.
          if (candidate.maxHp === bestMaxHp && candidate.hp <= bestHp
            && !(candidate.hp === bestHp && candidate.distance > bestDistance)) {
            best = candidate;
            bestHp = candidate.hp;
            bestDistance = candidate.distance;
          }
          best = candidate;
          bestMaxHp = candidate.maxHp;
          bestHp = candidate.hp;
          bestDistance = candidate.distance;
          if (bossOnly) return best;
        }
        return best;
      }
      case 'random':
        if (bossOnly) return pool.find((candidate) => candidate.distance < range) ?? null;
        { const eligible = pool.filter((candidate) => candidate.distance < range); return eligible[Math.floor(Math.random() * eligible.length)] ?? null; }
      case 'closest':
      default:
        return pool.filter((candidate) => candidate.distance < range)
          .sort((a, b) => a.distance - b.distance)[0] ?? null;
    }
  }

  private aimPoint(
    object: TrackedObject,
    playerPos: { x: number; y: number },
    projectile: CombatProjectileDefinition | undefined,
    speedMultiplier = 1,
    lifetimeMultiplier = 1,
  ): { x: number; y: number } {
    const motion = this.motion.autoAimMotion(object.objectId, object, this.lastUpdateAt);
    const current = motion.position;
    if (!this.aim.leadTargets || !projectile) return current;
    return prodMafiaLeadEnemy(playerPos, current, motion.velocity, motion.turnRate,
      projectileAverageSpeed(projectile, speedMultiplier, lifetimeMultiplier)) ?? current;
  }
}

function rawNumber(object: TrackedObject, stat: number, fallback: number): number {
  const value = object.rawStats?.[String(stat)];
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function projectileRange(
  projectile: CombatProjectileDefinition | undefined,
  speedMultiplier = 1,
  lifetimeMultiplier = 1,
): number {
  if (!projectile) return 0;
  // ProjectileProperties.calcMaxRange -> calcDistance, copied directly.
  if (projectile.laserDistance && projectile.laserDistance > 0) return projectile.laserDistance;
  const elapsed = projectile.lifetimeMs * validMultiplier(lifetimeMultiplier);
  const baseSpeed = projectile.speed * validMultiplier(speedMultiplier) / 10_000;
  let distance = baseSpeed * elapsed;
  if (projectile.acceleration === 0 || elapsed <= projectile.accelerationDelay) return distance;
  const accelerationTime = elapsed - projectile.accelerationDelay;
  const accelerationPerMs = projectile.acceleration / 10_000_000;
  const clampSpeed = projectile.speedClamp / 10_000;
  const speedDifference = projectile.acceleration > 0
    ? Math.max(clampSpeed, baseSpeed) - baseSpeed
    : Math.min(clampSpeed, baseSpeed) - baseSpeed;
  const timeToClamp = speedDifference / accelerationPerMs;
  if (accelerationTime <= timeToClamp) {
    return distance + 0.5 * accelerationPerMs * accelerationTime ** 2;
  }
  distance += 0.5 * accelerationPerMs * timeToClamp ** 2;
  return distance + speedDifference * (accelerationTime - timeToClamp);
}

function normalizeMode(mode: string): AutoAimMode | null {
  switch (String(mode).trim().toLowerCase().replace(/[\s_-]+/g, '')) {
    case 'closest': return 'closest';
    case 'closesttoaim':
    case 'closesttocursor':
    case 'cursor': return 'closestToAim';
    case 'maxhp': return 'maxHp';
    case 'random': return 'random';
    default: return null;
  }
}

function normalizeObjectTypes(values: readonly number[]): number[] {
  return [...new Set(values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0)
    .map((value) => Math.trunc(value)))];
}

function finitePoint(
  value: { x: number; y: number },
  fallback: { x: number; y: number },
): { x: number; y: number } {
  const x = Number(value?.x);
  const y = Number(value?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { ...fallback };
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Direct TypeScript port of Player.leadEnemy (including five arc refinements). */
function prodMafiaLeadEnemy(
  shooter: { x: number; y: number },
  target: { x: number; y: number },
  velocity: { x: number; y: number },
  turnRate: number,
  projectileSpeed: number,
): { x: number; y: number } | null {
  if (Math.abs(turnRate) < 0.00001 || projectileSpeed <= 0 || Number.isNaN(projectileSpeed)) {
    if (projectileSpeed <= 0 || Number.isNaN(projectileSpeed)) return { ...target };
    return prodMafiaLinearLead(shooter, target, velocity, projectileSpeed);
  }
  let interceptTime = Math.hypot(target.x - shooter.x, target.y - shooter.y) / projectileSpeed;
  let predicted = { ...target };
  for (let iteration = 0; iteration < 5; iteration++) {
    const turn = Math.max(-Math.PI, Math.min(Math.PI, turnRate * interceptTime));
    const effectiveRate = interceptTime > 0 ? turn / interceptTime : turnRate;
    if (Math.abs(effectiveRate) < 0.0000001) {
      predicted = { x: target.x + velocity.x * interceptTime, y: target.y + velocity.y * interceptTime };
    } else {
      const sin = Math.sin(turn);
      const cos = Math.cos(turn);
      predicted = {
        x: target.x + (velocity.x * sin + velocity.y * (cos - 1)) / effectiveRate,
        y: target.y + (velocity.x * (1 - cos) + velocity.y * sin) / effectiveRate,
      };
    }
    const refined = Math.hypot(predicted.x - shooter.x, predicted.y - shooter.y) / projectileSpeed;
    if (Math.abs(refined - interceptTime) < 0.5) break;
    interceptTime = refined;
  }
  return predicted;
}

function prodMafiaLinearLead(shooter: { x: number; y: number }, target: { x: number; y: number }, velocity: { x: number; y: number }, speed: number): { x: number; y: number } | null {
  const dx = target.x - shooter.x;
  const dy = target.y - shooter.y;
  const a = velocity.x ** 2 + velocity.y ** 2 - speed ** 2;
  const b = 2 * (dx * velocity.x + dy * velocity.y);
  const c = dx ** 2 + dy ** 2;
  let time = Infinity;
  if (Math.abs(a) < 1e-10) {
    if (Math.abs(b) > 1e-10) { const value = -c / b; if (value >= 0) time = value; }
  } else {
    const discriminant = b ** 2 - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      const first = (-b - root) / (2 * a);
      const second = (-b + root) / (2 * a);
      if (first >= 0) time = first;
      if (second >= 0 && second < time) time = second;
    }
  }
  return Number.isFinite(time) ? { x: target.x + velocity.x * time, y: target.y + velocity.y * time } : null;
}

function projectileAverageSpeed(projectile: CombatProjectileDefinition, speedMultiplier = 1, lifetimeMultiplier = 1): number {
  const lifetime = projectile.lifetimeMs * validMultiplier(lifetimeMultiplier);
  return lifetime > 0 ? projectileRange(projectile, speedMultiplier, lifetimeMultiplier) / lifetime : 0;
}

function validMultiplier(value: number | undefined): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
}
