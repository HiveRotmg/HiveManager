import {
  ConditionEffectBits,
  EnemyHitPacket,
  EnemyShootPacket,
  OtherHitPacket,
  Packet,
  PlayerHitPacket,
  PlayerShootPacket,
  ServerPlayerShootPacket,
  StatType,
  SquareHitPacket,
} from 'realmlib';
import {
  projectileCollisionHalfSize,
  projectileDistanceAt,
  turningPositionAt,
} from './projectile-motion';

export interface CombatProjectileDefinition {
  speed: number;
  lifetimeMs: number;
  /** Collision radius in tiles. Game data derives this from projectile XML size. */
  hitRadius?: number;
  /** Unscaled lifetime used by path shapes whose phase is tied to XML lifetime. */
  trajectoryLifetimeMs?: number;
  multiHit: boolean;
  passesCover: boolean;
  amplitude: number;
  frequency: number;
  magnitude: number;
  wavy: boolean;
  parametric: boolean;
  boomerang: boolean;
  acceleration: number;
  accelerationDelay: number;
  speedClamp: number;
  /** Fixed world-space beam length from `<Laser>`; absent/zero for ordinary shots. */
  laserDistance?: number;
  armorPiercing?: boolean;
  /**
   * Turning model. Mirrors the client's ProjectileProperties turn fields.
   * `turnRate` and `turnClamp` and `circleTurnAngle` are RADIANS of total
   * sweep, not rates: the sweep completes over `turnStopTime`.
   * `turnStopTime` and `circleTurnDelay` are milliseconds; `turnStopTime === 0`
   * means "no explicit stop, fall back to the projectile lifetime".
   * `turnRateDelay` and `turnAccelerationDelay` are SECONDS, matching the
   * reference implementation's elapsed-seconds comparison.
   */
  turnRate: number;
  turnRateDelay: number;
  turnAcceleration: number;
  turnAccelerationDelay: number;
  turnClamp: number;
  turnStopTime: number;
  circleTurnAngle: number;
  circleTurnDelay: number;
  /** Projectile collision half-extent multiplier; 1 when the XML omits it. */
  collisionMult: number;
}

/**
 * Returns `true` when a projectile's motion cannot be modelled as a single
 * constant-velocity segment — used by the dodge planner to decide between
 * fine-step sub-sampling (~15 ms) and a single analytic ProjectileSegment.
 *
 * Add any new nonlinear-motion flag here; the planner and every other coarse
 * "is this projectile nonlinear" caller then picks up the update automatically.
 * Per-flag motion math (wavy / parametric / boomerang / amplitude deflection /
 * quadratic accel) still lives in `positionAt` — this helper is only the
 * category check.
 */
export function isNonlinearProjectile(definition: CombatProjectileDefinition): boolean {
  return definition.wavy
    || definition.parametric
    || definition.boomerang
    || definition.amplitude !== 0
    || definition.acceleration !== 0
    // Turning projectiles arc. Classifying one as linear makes
    // predictProjectileSegments emit a single straight segment across the whole
    // planning horizon for a path that curves - the defect this model fixes.
    || definition.turnRate !== 0
    || definition.circleTurnDelay !== 0;
}

export interface CombatPlayerHit {
  bulletId: number;
  ownerId: number;
  damage: number;
  projectile: CombatProjectileDefinition;
}

export interface CombatWeaponPatternDefinition {
  projectileId: number;
  patternIndex: number;
  numProjectiles: number;
  arcGap: number;
  defaultAngle: number;
  posOffsetX: number;
  posOffsetY: number;
}

export interface CombatWeaponSubattackDefinition {
  rateOfFire: number;
  /** Projectile budget multiplier for one server-enforced burst. */
  burstCount?: number;
  /** Full burst cooldown at zero dexterity, in milliseconds. */
  burstDelayMs?: number;
  /** Burst cooldown at 75+ dexterity, in milliseconds. */
  burstMinDelayMs?: number;
  isDummy: boolean;
  defaultAngleIncrease: number;
  minIncrAngleCounter: number;
  maxIncrAngleCounter: number;
  patterns: readonly CombatWeaponPatternDefinition[];
}

export interface CombatObjectDefinition {
  /** Source XML object id/display metadata used by ProdMafia Auto Play. */
  id?: string;
  displayId?: string;
  objectClass?: string;
  isEnemy: boolean;
  /** True when this object type owns at least one projectile definition. */
  hasProjectiles?: boolean;
  invincible?: boolean;
  isPlayer?: boolean;
  isContainer?: boolean;
  isLoot?: boolean;
  /** XML `<Static />`; structural Auto Play quests must not become movement targets. */
  static?: boolean;
  soulbound?: boolean;
  bagType?: number;
  dungeonName?: string;
  occupySquare: boolean;
  fullOccupy?: boolean;
  enemyOccupySquare?: boolean;
  protectFromGroundDamage?: boolean;
  /** Weapon RateOfFire (1 = full speed); used to derive the shot cooldown. */
  rateOfFire?: number;
  /** Number of projectiles the weapon fires per trigger. */
  numProjectiles?: number;
  /** Arc gap between projectiles, in degrees. */
  arcGap?: number;
  /** Modern weapon fire definitions parsed from `<Subattack>`. */
  subattacks?: readonly CombatWeaponSubattackDefinition[];
  /** Legacy root-level burst metadata for weapons without parsed subattacks. */
  burstCount?: number;
  burstDelayMs?: number;
  burstMinDelayMs?: number;
  maxHp?: number;
  quest?: boolean;
  /** Mirrors ObjectProperties.boss_: XML Quest plus any caller-defined priority type. */
  boss?: boolean;
  /** False for wall/structure objects that source Auto Aim skips by default. */
  isCharacter?: boolean;
  usable?: boolean;
  mpCost?: number;
  cooldownMs?: number;
  activateEffects?: readonly string[];
}

/** Minimal game-data surface needed by combat simulation. */
export interface CombatDataProvider {
  getObject(type: number): CombatObjectDefinition | undefined;
  getEnchantment?(type: number): { rateOfFireMultiplier?: number } | undefined;
  getProjectile(objectType: number, projectileId: number): CombatProjectileDefinition | undefined;
  getTileDamage?(tileType: number): number | undefined;
  getTileSpeed?(tileType: number): number;
  tileIsBlockingWalk?(tileType: number): boolean;
  /** `<Sink />` water/lava. Walkable; only the safeWalk policy avoids it. */
  tileIsSink?(tileType: number): boolean;
  /** `<Sinking />` quicksand/honey, which progressively slows the player. */
  tileIsSinking?(tileType: number): boolean;
  /** ProdMafia `Player.as:4217` sinking decay for a given accumulated sink level. */
  getSinkingSpeedMultiplier?(tileType: number, sinkLevel: number): number;
  /** `<SlideAmount>` ice momentum retention factor (ProdMafia `Player.as:1134-1145`). */
  getTileSlideAmount?(tileType: number): number | undefined;
  /** Per-ms push velocity of a `<Push />` tile (ProdMafia `Player.as:1264-1265`). */
  getTilePushVelocity?(tileType: number): { dx: number; dy: number } | undefined;
}

export interface CombatEntity {
  objectId: number;
  type: number;
  x: number;
  y: number;
  player?: {
    hp: number;
    condition: number;
    condition2: number;
  };
  rawStats?: Record<string, number | string>;
}

export interface CombatTile {
  x: number;
  y: number;
  type: number;
}

export interface CombatWorldSnapshot {
  playerId: number;
  playerPos: { x: number; y: number };
  mapWidth: number;
  mapHeight: number;
  entities: Iterable<CombatEntity>;
  tiles: Iterable<CombatTile>;
  /** Resolves the render-time position of a server-tick-interpolated entity. */
  resolveEntityPosition?(entity: CombatEntity): { x: number; y: number };
}

export type CombatProjectileSide = 'enemy' | 'own';

/** Read-only combat state consumed by predictive systems such as auto-dodge. */
export interface CombatProjectileSnapshot {
  side: CombatProjectileSide;
  bulletId: number;
  bulletType: number;
  ownerId: number;
  containerType: number;
  startX: number;
  startY: number;
  angle: number;
  startTime: number;
  definition: CombatProjectileDefinition;
  damage: number;
  hitObjects: ReadonlySet<number>;
}

interface ActiveProjectile extends CombatProjectileSnapshot {
  simulatedElapsed: number;
  hitObjects: Set<number>;
}

interface PreparedWorld {
  snapshot: CombatWorldSnapshot;
  tiles: Map<string, CombatTile>;
  covers: Map<string, CombatEntity[]>;
  enemies: CombatEntity[];
  players: CombatEntity[];
}

const SIMULATION_STEP_MS = 16;
const INVALID_TILE_TYPE = 0xffff;
const ACCURACY_HISTORY_MS = 60 * 60 * 1000;

/**
 * Replays the projectile lifecycle that the current game client uses to emit
 * PLAYERHIT/OTHERHIT/SQUAREHIT/ENEMYHIT claims.
 */
export class CombatTracker {
  private readonly projectiles = new Map<string, ActiveProjectile>();
  private readonly shotTimes: number[] = [];
  private readonly hitTimes: number[] = [];
  private projectileNoclipEnabled = false;

  constructor(
    private readonly data: CombatDataProvider,
    private readonly send: (packet: Packet) => void,
    private readonly onPlayerHit?: (hit: CombatPlayerHit) => boolean,
  ) {}

  clear(): void {
    this.projectiles.clear();
  }

  setProjectileNoclip(enabled: boolean): void {
    this.projectileNoclipEnabled = enabled;
  }

  isProjectileNoclipEnabled(): boolean {
    return this.projectileNoclipEnabled;
  }

  removeOwner(ownerId: number): void {
    for (const [key, projectile] of this.projectiles) {
      if (projectile.ownerId === ownerId) {
        this.projectiles.delete(key);
      }
    }
  }

  /**
   * Registers an enemy shot whose owner type is already known.
   *
   * Returns how many projectiles were added, so a caller can tell "this owner
   * type has no projectile definition for that bulletType" apart from a tracked
   * shot. That distinction used to be invisible: the shot was dropped here and
   * never entered the threat model, so Auto Dodge was blind to it rather than
   * bad at avoiding it (ProdMafia `GameServerConnectionConcrete.as:2547-2552`).
   */
  trackEnemyShoot(
    packet: EnemyShootPacket,
    ownerType: number | undefined,
    startTime: number,
  ): number {
    if (ownerType === undefined) {
      return 0;
    }
    return this.addEnemyShoot(
      enemyShootObservation(packet),
      ownerType,
      startTime,
      -SIMULATION_STEP_MS,
    );
  }

  /**
   * Replays a deferred ENEMYSHOOT whose owner type only became resolvable after
   * the packet arrived (ProdMafia `GameServerConnectionConcrete.as:2654-2657`).
   *
   * `shot.shotTime` stays the original packet time, so lifetime, geometry and
   * the dodge planner's `predictProjectilePosition` all describe where the
   * bullet is *now* rather than where it would be had it just spawned.
   * Collision testing, however, starts at the shot's current age instead of
   * zero: the span already flown happened against player positions this client
   * no longer holds, and re-walking it against the present position would
   * invent hits the server never claimed.
   */
  trackDeferredEnemyShoot(shot: PendingEnemyShoot, ownerType: number, now: number): number {
    const age = Math.max(0, now - shot.shotTime);
    return this.addEnemyShoot(
      shot,
      ownerType,
      shot.shotTime,
      Math.max(-SIMULATION_STEP_MS, age - SIMULATION_STEP_MS),
    );
  }

  private addEnemyShoot(
    shot: EnemyShootObservation,
    ownerType: number,
    shotTime: number,
    simulatedElapsed: number,
  ): number {
    const definition = this.data.getProjectile(ownerType, shot.bulletType);
    if (!definition || definition.lifetimeMs <= 0 || simulatedElapsed >= definition.lifetimeMs) {
      return 0;
    }
    const shotCount = enemyShotCount(shot.numShots);
    for (let index = 0; index < shotCount; index++) {
      // ENEMYSHOOT, DAMAGE and PLAYERHIT all carry a uint16 bullet id, and every
      // hit-report packet writes it back as a short. Masking to 8 bits aliased
      // ids above 255 onto live projectiles of the same owner and named the
      // wrong bullet in PLAYERHIT/OTHERHIT/SQUAREHIT.
      const bulletId = (shot.bulletId + index) & 0xffff;
      this.add({
        side: 'enemy',
        bulletId,
        bulletType: shot.bulletType,
        ownerId: shot.ownerId,
        containerType: ownerType,
        startX: shot.startX,
        startY: shot.startY,
        angle: shot.angle + shot.angleInc * index,
        startTime: shotTime,
        simulatedElapsed,
        definition,
        damage: shot.damage,
        hitObjects: new Set(),
      });
    }
    return shotCount;
  }

  /**
   * Registers a weapon shot we announced via PLAYERSHOOT. The server keeps a
   * ledger of the bullets we fire and expects every one of them to resolve
   * with an ENEMYHIT/OTHERHIT/SQUAREHIT; leaving them unresolved gets the
   * connection dropped with FAILURE errorId=0 after roughly a dozen shots.
   */
  trackPlayerShoot(
    ownerId: number,
    packet: PlayerShootPacket,
    startTime: number,
    projectileId = 0,
    speedMultiplier = 1,
    lifetimeMultiplier = 1,
  ): void {
    if (ownerId === -1) {
      return;
    }
    this.shotTimes.push(Date.now());
    this.pruneAccuracy();
    const baseDefinition = this.data.getProjectile(packet.containerType, projectileId);
    if (!baseDefinition || baseDefinition.lifetimeMs <= 0) {
      return;
    }
    const definition = scaleProjectileDefinition(baseDefinition, speedMultiplier, lifetimeMultiplier);
    this.add({
      side: 'own',
      bulletId: packet.bulletId,
      bulletType: projectileId,
      ownerId,
      containerType: packet.containerType,
      startX: packet.startingPos.x,
      startY: packet.startingPos.y,
      angle: packet.angle,
      startTime,
      simulatedElapsed: -SIMULATION_STEP_MS,
      definition,
      damage: 0,
      hitObjects: new Set(),
    });
  }

  trackOwnShoot(packet: ServerPlayerShootPacket, startTime: number): void {
    // ProdMafia keeps its locally-created projectile when the server echoes the
    // shot. Preserve it here because it has the exact subattack projectile id.
    if (this.projectiles.has(projectileKey(packet.ownerId, packet.bulletId))) {
      return;
    }
    const definition = this.data.getProjectile(packet.containerType, 0);
    if (!definition || definition.lifetimeMs <= 0) {
      return;
    }
    this.add({
      side: 'own',
      bulletId: packet.bulletId,
      bulletType: 0,
      ownerId: packet.ownerId,
      containerType: packet.containerType,
      startX: packet.startingPos.x,
      startY: packet.startingPos.y,
      angle: packet.angle,
      startTime,
      simulatedElapsed: -SIMULATION_STEP_MS,
      definition,
      damage: packet.damage,
      hitObjects: new Set(),
    });
  }

  update(now: number, snapshot: CombatWorldSnapshot): void {
    if (this.projectiles.size === 0) {
      return;
    }
    const world = this.prepareWorld(snapshot);
    for (const [key, projectile] of this.projectiles) {
      if (!this.advance(projectile, now, world)) {
        this.projectiles.delete(key);
      }
    }
  }

  get size(): number {
    return this.projectiles.size;
  }

  /** Live projectile snapshots. Callers must not mutate values yielded here. */
  getActiveProjectiles(): Iterable<CombatProjectileSnapshot> {
    return this.projectiles.values();
  }

  accuracy(): number {
    this.pruneAccuracy();
    return this.shotTimes.length > 0
      ? Math.min(1, this.hitTimes.length / this.shotTimes.length)
      : 0;
  }

  recentAccuracy(minutes: number): number {
    this.pruneAccuracy();
    const cutoff = Date.now() - Math.max(0, minutes) * 60_000;
    const shots = this.shotTimes.filter((time) => time >= cutoff).length;
    if (shots === 0) return 0;
    return Math.min(1, this.hitTimes.filter((time) => time >= cutoff).length / shots);
  }

  resetAccuracy(): void {
    this.shotTimes.length = 0;
    this.hitTimes.length = 0;
  }

  private pruneAccuracy(): void {
    const cutoff = Date.now() - ACCURACY_HISTORY_MS;
    while (this.shotTimes.length > 0 && this.shotTimes[0]! < cutoff) this.shotTimes.shift();
    while (this.hitTimes.length > 0 && this.hitTimes[0]! < cutoff) this.hitTimes.shift();
  }

  private add(projectile: ActiveProjectile): void {
    this.projectiles.set(projectileKey(projectile.ownerId, projectile.bulletId), projectile);
  }

  private prepareWorld(snapshot: CombatWorldSnapshot): PreparedWorld {
    const tiles = new Map<string, CombatTile>();
    for (const tile of snapshot.tiles) {
      tiles.set(tileKey(tile.x, tile.y), tile);
    }
    const covers = new Map<string, CombatEntity[]>();
    const enemies: CombatEntity[] = [];
    const players: CombatEntity[] = [];
    for (const source of snapshot.entities) {
      const position = snapshot.resolveEntityPosition?.(source);
      const entity = position && (position.x !== source.x || position.y !== source.y)
        ? { ...source, x: position.x, y: position.y }
        : source;
      const definition = this.data.getObject(entity.type);
      if (!definition) {
        continue;
      }
      const hp = entity.player?.hp ?? rawNumber(entity, StatType.HP_STAT);
      const condition = entity.player?.condition ?? rawNumber(entity, StatType.CONDITION_STAT) ?? 0;
      const dead = hp !== undefined && hp <= 0;
      const blocked = ConditionEffectBits.PAUSED
        | ConditionEffectBits.STASIS
        | ConditionEffectBits.INVINCIBLE;
      if (definition.isEnemy && !definition.invincible && !dead && (condition & blocked) === 0) {
        enemies.push(entity);
      }
      const playerBlocked = ConditionEffectBits.STASIS | ConditionEffectBits.INVINCIBLE;
      if (definition.isPlayer && !dead && (condition & playerBlocked) === 0) {
        players.push(entity);
      }
      if (definition.occupySquare || definition.enemyOccupySquare) {
        const key = tileKey(Math.floor(entity.x), Math.floor(entity.y));
        const list = covers.get(key) ?? [];
        list.push(entity);
        covers.set(key, list);
      }
    }
    return { snapshot, tiles, covers, enemies, players };
  }

  private advance(projectile: ActiveProjectile, now: number, world: PreparedWorld): boolean {
    const targetElapsed = Math.min(now - projectile.startTime, projectile.definition.lifetimeMs);
    if (targetElapsed < 0) {
      return true;
    }
    let elapsed = projectile.simulatedElapsed;
    while (elapsed < targetElapsed) {
      elapsed = Math.min(Math.max(0, elapsed + SIMULATION_STEP_MS), targetElapsed);
      const pos = positionAt(projectile, elapsed);
      const hit = this.resolveAt(projectile, projectile.startTime + elapsed, pos, world);
      projectile.simulatedElapsed = elapsed;
      if (hit) {
        return false;
      }
    }
    return targetElapsed < projectile.definition.lifetimeMs;
  }

  private resolveAt(
    projectile: ActiveProjectile,
    time: number,
    pos: { x: number; y: number },
    world: PreparedWorld,
  ): boolean {
    // Shared with the dodge planner's segment collisionRadius; see
    // projectileCollisionHalfSize.
    const halfSize = projectileCollisionHalfSize(projectile.definition);
    const tileX = Math.floor(pos.x);
    const tileY = Math.floor(pos.y);
    const outside = tileX < 0 || tileY < 0
      || (world.snapshot.mapWidth > 0 && tileX >= world.snapshot.mapWidth)
      || (world.snapshot.mapHeight > 0 && tileY >= world.snapshot.mapHeight);
    const tile = world.tiles.get(tileKey(tileX, tileY));
    if (outside || tile?.type === INVALID_TILE_TYPE) {
      this.sendSquareHit(projectile, time);
      return true;
    }

    const skipsCover = this.projectileNoclipEnabled
      && projectile.side === 'own'
      && projectile.ownerId === world.snapshot.playerId;
    if (!skipsCover) {
      for (const cover of world.covers.get(tileKey(tileX, tileY)) ?? []) {
        if (cover.objectId === projectile.ownerId) {
          continue;
        }
        const definition = this.data.getObject(cover.type);
        if (!definition) {
          continue;
        }
        const blocksOwnShot = projectile.side !== 'own' || !definition.isEnemy;
        const blocksProjectile = !!definition.enemyOccupySquare
          || (!projectile.definition.passesCover && definition.occupySquare);
        if (blocksOwnShot && blocksProjectile) {
          this.sendOtherHit(projectile, time, cover.objectId);
          return true;
        }
      }
    }

    if (projectile.side === 'enemy') {
      if (withinHitBox(pos, world.snapshot.playerPos, halfSize)
        && !projectile.hitObjects.has(world.snapshot.playerId)) {
        const intercepted = this.onPlayerHit?.({
          bulletId: projectile.bulletId,
          ownerId: projectile.ownerId,
          damage: projectile.damage,
          projectile: projectile.definition,
        }) ?? false;
        projectile.hitObjects.add(world.snapshot.playerId);
        if (intercepted) return true;
        const hit = new PlayerHitPacket();
        hit.bulletId = projectile.bulletId;
        hit.objectId = projectile.ownerId;
        this.send(hit);
        return !projectile.definition.multiHit;
      }
      const player = nearestHit(pos, world.players, projectile.hitObjects, halfSize);
      if (player) {
        projectile.hitObjects.add(player.objectId);
        if (!projectile.definition.multiHit) {
          this.sendOtherHit(projectile, time, player.objectId);
          return true;
        }
      }
      return false;
    }

    const enemy = firstHit(pos, world.enemies, projectile.hitObjects, halfSize);
    if (!enemy) {
      return false;
    }
    const hit = new EnemyHitPacket();
    hit.time = Math.trunc(time);
    hit.bulletId = projectile.bulletId;
    hit.shooterId = projectile.ownerId;
    hit.targetId = enemy.objectId;
    hit.kill = false;
    hit.mainId = projectile.ownerId;
    this.send(hit);
    this.hitTimes.push(Date.now());
    this.pruneAccuracy();
    projectile.hitObjects.add(enemy.objectId);
    return !projectile.definition.multiHit;
  }

  private sendOtherHit(projectile: ActiveProjectile, time: number, targetId: number): void {
    const hit = new OtherHitPacket();
    hit.time = Math.trunc(time);
    hit.bulletId = projectile.bulletId;
    hit.objectId = projectile.ownerId;
    hit.targetId = targetId;
    this.send(hit);
  }

  private sendSquareHit(projectile: ActiveProjectile, time: number): void {
    const hit = new SquareHitPacket();
    hit.time = Math.trunc(time);
    hit.bulletId = projectile.bulletId;
    hit.objectId = projectile.ownerId;
    this.send(hit);
  }
}

function scaleProjectileDefinition(
  definition: CombatProjectileDefinition,
  speedMultiplier: number,
  lifetimeMultiplier: number,
): CombatProjectileDefinition {
  const speed = validMultiplier(speedMultiplier);
  const lifetime = validMultiplier(lifetimeMultiplier);
  return {
    ...definition,
    speed: definition.speed * speed,
    lifetimeMs: definition.lifetimeMs * lifetime,
    trajectoryLifetimeMs: definition.trajectoryLifetimeMs ?? definition.lifetimeMs,
  };
}

function validMultiplier(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

function projectileKey(ownerId: number, bulletId: number): string {
  return `${ownerId}:${bulletId}`;
}

function rawNumber(entity: CombatEntity, stat: number): number | undefined {
  const value = entity.rawStats?.[String(stat)];
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * `halfSize` is required rather than defaulted to 0.5 so that a new call site
 * cannot silently reintroduce the hardcoded extent. It must always come from
 * projectileCollisionHalfSize, which the dodge planner uses for the same
 * projectile — if the two disagree the planner dodges a differently-sized
 * bullet than the one that actually connects.
 */
function withinHitBox(
  a: { x: number; y: number },
  b: { x: number; y: number },
  halfSize: number,
): boolean {
  return Math.abs(a.x - b.x) <= halfSize && Math.abs(a.y - b.y) <= halfSize;
}

function nearestHit(
  pos: { x: number; y: number },
  entities: CombatEntity[],
  ignored: Set<number>,
  halfSize: number,
): CombatEntity | undefined {
  let nearest: CombatEntity | undefined;
  let nearestDistance = Infinity;
  for (const entity of entities) {
    if (ignored.has(entity.objectId) || !withinHitBox(pos, entity, halfSize)) {
      continue;
    }
    const dx = entity.x - pos.x;
    const dy = entity.y - pos.y;
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      nearest = entity;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function firstHit(
  pos: { x: number; y: number },
  entities: CombatEntity[],
  ignored: Set<number>,
  halfSize: number,
): CombatEntity | undefined {
  return entities.find(
    (entity) => !ignored.has(entity.objectId) && withinHitBox(pos, entity, halfSize),
  );
}

/** Predicts a projectile's analytic world position at an absolute client time. */
export function predictProjectilePosition(
  projectile: CombatProjectileSnapshot,
  time: number,
  out: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number } {
  return positionAt(projectile, time - projectile.startTime, out);
}

export function isProjectileAliveAt(projectile: CombatProjectileSnapshot, time: number): boolean {
  const elapsed = time - projectile.startTime;
  return elapsed >= 0 && elapsed <= projectile.definition.lifetimeMs;
}

function positionAt(
  projectile: CombatProjectileSnapshot,
  elapsed: number,
  out: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number } {
  const definition = projectile.definition;

  // Turning projectiles own the whole position calculation: their heading
  // rotates, so the wavy/parametric branches below do not apply. Checked before
  // the shared setup because Task 6 makes this the hot sampling path.
  if (definition.turnRate !== 0 || definition.circleTurnDelay !== 0) {
    return turningPositionAt(
      definition, projectile.angle, projectile.startX, projectile.startY, elapsed, out,
      { clampElapsed: false },
    );
  }

  const trajectoryLifetime = definition.trajectoryLifetimeMs ?? definition.lifetimeMs;
  const baseSpeed = definition.speed / 10000;
  // No clamp and no zero floor: this call site never had either. See the
  // divergence note at the top of projectile-motion.ts.
  let distance = projectileDistanceAt(definition, elapsed, { clampElapsed: false });

  const phase = projectile.bulletId % 2 === 0 ? 0 : Math.PI;
  let x = projectile.startX;
  let y = projectile.startY;
  if (definition.wavy) {
    const angle = projectile.angle + Math.PI / 64 * Math.sin(phase + 6 * Math.PI * elapsed / 1000);
    x += distance * Math.cos(angle);
    y += distance * Math.sin(angle);
  } else if (definition.parametric) {
    const t = elapsed / trajectoryLifetime * 2 * Math.PI;
    const localX = Math.sin(t) * (projectile.bulletId % 2 ? 1 : -1);
    const localY = Math.sin(2 * t) * (projectile.bulletId % 4 < 2 ? 1 : -1);
    x += (localX * Math.cos(projectile.angle) - localY * Math.sin(projectile.angle)) * definition.magnitude;
    y += (localX * Math.sin(projectile.angle) + localY * Math.cos(projectile.angle)) * definition.magnitude;
  } else {
    if (definition.boomerang) {
      const halfway = trajectoryLifetime * baseSpeed * 0.5;
      if (distance > halfway) {
        distance = halfway - (distance - halfway);
      }
    }
    x += distance * Math.cos(projectile.angle);
    y += distance * Math.sin(projectile.angle);
    if (definition.amplitude !== 0) {
      const deflection = definition.amplitude * Math.sin(
        phase + elapsed / trajectoryLifetime * definition.frequency * 2 * Math.PI,
      );
      x += deflection * Math.cos(projectile.angle + Math.PI / 2);
      y += deflection * Math.sin(projectile.angle + Math.PI / 2);
    }
  }
  out.x = x;
  out.y = y;
  return out;
}

//#region ENEMYSHOOT deferral and owner-type recovery

/**
 * How long a shot with no resolvable owner stays queued, from ProdMafia
 * `GameServerConnectionConcrete.as:1860`. Its comment records why the earlier
 * 750 ms window was wrong: it discarded 1,711 locally relevant shot packets in
 * one session (810 in Wine Cellar), every one of them invisible to Auto Dodge.
 */
export const PENDING_ENEMY_SHOOT_MS = 4000;

/**
 * Queue ceiling (ProdMafia `:1861`). The queue exists to survive a streaming
 * race, not to buffer a hostile peer: at 256 entries the whole queue costs a
 * few tens of KB, and every entry is re-examined on each UPDATE and NEWTICK on
 * the same thread as the 16 ms frame timer. Overflow drops the newest shot and
 * is counted rather than silent.
 */
export const MAX_PENDING_ENEMY_SHOOTS = 256;

/**
 * Launch-point distance beyond which a shot is never queued (ProdMafia
 * `:1865`). Perimeter shooters in Malogia begin 20-27 tiles out during
 * streaming, so the window has to exceed that; past it the bullet cannot reach
 * the player inside the deferral window and buying queue slots for it only
 * crowds out shots that matter.
 */
export const PENDING_ENEMY_SHOOT_DISTANCE = 35;

/** ProdMafia `:1853`. */
export const MAX_MAP_ENEMY_SHOOT_SOURCES = 512;

/**
 * ProdMafia `:1854`. Dungeon-owned shooters use small, layout-stable object
 * ids; ids above this are per-instance and reused, so a learned association
 * would be meaningless on the next entry.
 */
export const MAX_STABLE_MAP_OWNER_ID = 4096;

/**
 * Signature-table ceiling. ProdMafia leaves this table unbounded because it
 * clears it on every MAPINFO; we clear it too, but cap it as well so a peer
 * that streams distinct damage/count tuples cannot grow it without limit
 * within one map.
 */
export const MAX_ENEMY_SHOOT_SIGNATURES = 2048;

/** Distinct unresolved profiles retained for diagnostics before new ones are ignored. */
export const MAX_UNRESOLVED_ENEMY_SHOOT_PROFILES = 256;

/** Radius ProdMafia `Map.resolveStaticHostileSourceType` (`Map.as:773-774`) searches. */
export const ENEMY_SHOOT_LAUNCH_MATCH_DISTANCE = 0.85;

/**
 * Which source produced an owner type. Strings match ProdMafia's
 * `recoveryMode` values so log lines can be compared side by side.
 */
export type EnemyShootRecoveryMode =
  | 'live'
  | 'persistent_cache'
  | 'map_source_cache'
  | 'verified_map_source'
  | 'launch_position'
  | 'signature_cache'
  | 'deferred'
  | 'deferred_map_source'
  | 'deferred_launch_position'
  | 'deferred_signature';

/** The primitive fields of an ENEMYSHOOT that a replay needs. */
export interface EnemyShootObservation {
  ownerId: number;
  bulletId: number;
  bulletType: number;
  damage: number;
  numShots: number;
  angleInc: number;
  angle: number;
  startX: number;
  startY: number;
}

export interface PendingEnemyShoot extends EnemyShootObservation {
  /** Client time the packet arrived; a replay keeps it as the shot's origin. */
  shotTime: number;
  queuedAt: number;
}

/** Why a shot could not be handed straight to the threat model. */
export type EnemyShootDeferral = 'queued' | 'distant' | 'overflow';

/** World lookups the resolver needs from the client, supplied per pass. */
export interface EnemyShootResolveContext {
  /** Client clock, the same base as the shot times handed to the tracker. */
  now: number;
  /** Live object type for an owner id, falling back to the recent-type cache; -1 if unknown. */
  ownerType(ownerId: number): number;
  /** ProdMafia `Map.resolveStaticHostileSourceType`: nearest live enemy to a launch point, or -1. */
  staticHostileType?(x: number, y: number): number;
  /** ProdMafia `Map.cacheObjectType`: trains the recent-type cache from a recovered identity. */
  cacheObjectType(ownerId: number, ownerType: number): void;
  /** Distance from the local player to a launch point; -1 when our position is unknown. */
  playerDistanceTo(x: number, y: number): number;
  /** Hands a resolved shot to the threat model. */
  replay(
    shot: PendingEnemyShoot,
    ownerType: number,
    mode: EnemyShootRecoveryMode,
    delayMs: number,
  ): void;
}

interface MapEnemyShootSource {
  type: number;
  x: number;
  y: number;
}

/**
 * ENEMYSHOOT deferral and owner-type recovery, ported from ProdMafia
 * `GameServerConnectionConcrete.as:2424-2907`.
 *
 * An ENEMYSHOOT can arrive before the UPDATE that streams its owner in. With no
 * owner there is no object type; with no object type there is no projectile
 * definition; and the shot was then dropped outright, so it never entered the
 * threat model and the dodge planner was *blind* to it rather than bad at
 * avoiding it. This queues those packets and recovers the owner type from three
 * learned sources — a damage/count/spread signature, a position-verified
 * per-map objectId association, and the nearest live enemy to the launch point
 * — then replays the shot with its original timing.
 *
 * Every drop path increments a counter surfaced through `stats()`. The defect
 * this fixes went unnoticed for as long as it did because the drop was silent.
 */
export class EnemyShootRecovery {
  private readonly pending: PendingEnemyShoot[] = [];
  /** Per-map: an unambiguous shot signature is object-type authority. */
  private readonly typeBySignature = new Map<string, number>();
  private readonly ambiguousSignatures = new Set<string>();
  /**
   * Keyed `mapName|ownerId` and retained across maps, exactly as ProdMafia's
   * `static mapEnemyShootSources_` is (`:1850-1852`, never cleared by
   * `onMapInfo`). The map name in the key plus the launch-position check is the
   * scoping: an association learned in one map can never answer a lookup in
   * another, and random-map id reuse cannot pass the position check.
   */
  private readonly mapSources = new Map<string, MapEnemyShootSource>();
  private readonly ambiguousMapSources = new Set<string>();
  private readonly unresolvedProfiles = new Map<string, number>();
  private mapName = '';

  private queuedCount = 0;
  private recoveredCount = 0;
  private signatureRecoveredCount = 0;
  private mapSourceRecoveredCount = 0;
  private positionRecoveredCount = 0;
  private expiredCount = 0;
  private distantSkippedCount = 0;
  private overflowCount = 0;
  private lateCount = 0;
  private noDefinitionCount = 0;
  private maxRecoveryDelayMs = 0;

  constructor(private readonly data: CombatDataProvider) {}

  /**
   * ProdMafia `onMapInfo` (`:5391-5392`) empties the queue and calls
   * `clearEnemyShootSignatures`. Signatures and unresolved profiles are learned
   * from one map's population and must not answer for the next one; the
   * position-verified per-map associations are keyed by map name and survive.
   */
  setMap(mapName: string): void {
    this.mapName = mapName;
    this.pending.length = 0;
    this.typeBySignature.clear();
    this.ambiguousSignatures.clear();
    this.unresolvedProfiles.clear();
  }

  /**
   * Trains both learned tables from a shot whose owner is present and alive —
   * the only case where the owner id is authority for what it shoots
   * (ProdMafia `:2428-2433`).
   */
  observeLiveShot(ownerType: number, shot: EnemyShootObservation): void {
    this.rememberSignature(ownerType, shot);
    this.rememberMapSource(shot.ownerId, ownerType, shot.startX, shot.startY);
  }

  /**
   * Recovers the object type of a shot whose owner is *not* in the world, in
   * ProdMafia's order of decreasing authority (`:2438-2477`), then trains the
   * caches from the result (`:2511-2522`).
   *
   * Call this only once the owner is known to be absent or dead, matching
   * ProdMafia's `if(owner == null || owner.dead_)` guard: a hit on
   * `ctx.ownerType` here is therefore the recent-type cache, not a live object.
   * `ownerType` is -1 when nothing resolved, in which case `mode` is unused.
   */
  resolveOwnerType(
    shot: EnemyShootObservation,
    ctx: EnemyShootResolveContext,
  ): { ownerType: number; mode: EnemyShootRecoveryMode } {
    let ownerType = ctx.ownerType(shot.ownerId);
    let mode: EnemyShootRecoveryMode = 'persistent_cache';
    if (ownerType < 0) {
      ownerType = this.getMapEnemyShootSourceType(shot.ownerId, shot.bulletType, shot.startX, shot.startY);
      if (ownerType >= 0) mode = 'map_source_cache';
    }
    if (ownerType < 0) {
      ownerType = this.getBuiltInMapEnemyShootSourceType(shot.ownerId, shot.bulletType);
      if (ownerType >= 0) mode = 'verified_map_source';
    }
    if (ownerType < 0 && ctx.staticHostileType) {
      const nearby = ctx.staticHostileType(shot.startX, shot.startY);
      if (this.hasProjectileDefinition(nearby, shot.bulletType)) {
        ownerType = nearby;
        mode = 'launch_position';
      }
    }
    if (ownerType < 0) {
      ownerType = this.getEnemyShootSignatureType(shot);
      if (ownerType >= 0) mode = 'signature_cache';
    }
    if (ownerType < 0) {
      return { ownerType: -1, mode: 'persistent_cache' };
    }
    // A launch-square match is good enough for this one shot but is not
    // owner-id authority, so it must not train the persistent caches
    // (ProdMafia `:2515-2522`).
    if (mode !== 'signature_cache' && mode !== 'launch_position') {
      ctx.cacheObjectType(shot.ownerId, ownerType);
    }
    if (mode !== 'launch_position') {
      this.rememberSignature(ownerType, shot);
      this.rememberMapSource(shot.ownerId, ownerType, shot.startX, shot.startY);
    }
    if (mode === 'map_source_cache' || mode === 'verified_map_source') this.mapSourceRecoveredCount++;
    if (mode === 'launch_position') this.positionRecoveredCount++;
    if (mode === 'signature_cache') this.signatureRecoveredCount++;
    return { ownerType, mode };
  }

  /**
   * Queues a shot that could not be resolved, so a following UPDATE can supply
   * the owner (ProdMafia `:2482-2509`). The packet's primitive fields are
   * copied because incoming messages are pooled.
   */
  deferUnresolved(
    shot: EnemyShootObservation,
    shotTime: number,
    ctx: EnemyShootResolveContext,
  ): EnemyShootDeferral {
    this.recordUnresolvedEnemyShoot(shot);
    const distance = ctx.playerDistanceTo(shot.startX, shot.startY);
    if (distance >= 0 && distance > PENDING_ENEMY_SHOOT_DISTANCE) {
      this.distantSkippedCount++;
      return 'distant';
    }
    if (this.pending.length >= MAX_PENDING_ENEMY_SHOOTS) {
      this.overflowCount++;
      return 'overflow';
    }
    this.pending.push({
      ownerId: shot.ownerId,
      bulletId: shot.bulletId,
      bulletType: shot.bulletType,
      damage: shot.damage,
      numShots: shot.numShots,
      angleInc: shot.angleInc,
      angle: shot.angle,
      startX: shot.startX,
      startY: shot.startY,
      shotTime,
      queuedAt: ctx.now,
    });
    this.queuedCount++;
    return 'queued';
  }

  /**
   * Re-attempts every queued shot, replaying the ones that now resolve and
   * evicting the ones that timed out (ProdMafia `processPendingEnemyShoots`,
   * `:2586-2692`). ProdMafia drives this from `onUpdate` and `onNewTick`.
   */
  resolvePending(ctx: EnemyShootResolveContext): void {
    for (let index = this.pending.length - 1; index >= 0; index--) {
      const shot = this.pending[index]!;
      let ownerType = ctx.ownerType(shot.ownerId);
      let signatureRecovery = false;
      let mapSourceRecovery = false;
      let positionRecovery = false;
      if (ownerType < 0) {
        ownerType = this.getMapEnemyShootSourceType(shot.ownerId, shot.bulletType, shot.startX, shot.startY);
        mapSourceRecovery = ownerType >= 0;
      }
      if (ownerType < 0) {
        ownerType = this.getBuiltInMapEnemyShootSourceType(shot.ownerId, shot.bulletType);
        mapSourceRecovery = ownerType >= 0;
      }
      if (ownerType < 0 && ctx.staticHostileType) {
        const nearby = ctx.staticHostileType(shot.startX, shot.startY);
        if (this.hasProjectileDefinition(nearby, shot.bulletType)) {
          ownerType = nearby;
          positionRecovery = true;
        }
      }
      if (ownerType < 0) {
        ownerType = this.getEnemyShootSignatureType(shot);
        signatureRecovery = ownerType >= 0;
      }
      if (ownerType < 0) {
        if (ctx.now - shot.queuedAt >= PENDING_ENEMY_SHOOT_MS) {
          this.expiredCount++;
          this.removeAt(index);
        }
        continue;
      }
      if (!signatureRecovery && !positionRecovery) {
        ctx.cacheObjectType(shot.ownerId, ownerType);
      }
      if (!positionRecovery) {
        this.rememberSignature(ownerType, shot);
        this.rememberMapSource(shot.ownerId, ownerType, shot.startX, shot.startY);
      }
      const recoveryDelay = Math.max(0, ctx.now - shot.queuedAt);
      const definition = this.data.getProjectile(ownerType, shot.bulletType);
      const shotAge = Math.max(0, ctx.now - shot.shotTime);
      if (!definition || definition.lifetimeMs <= 0) {
        this.noDefinitionCount++;
      } else if (shotAge >= definition.lifetimeMs) {
        // Rebuilding a shot after its configured lifetime adds an
        // already-dead projectile for one frame and can make the dodge
        // controller flee danger that no longer exists (ProdMafia `:2645-2649`).
        this.lateCount++;
      } else {
        const mode: EnemyShootRecoveryMode = signatureRecovery
          ? 'deferred_signature'
          : mapSourceRecovery
            ? 'deferred_map_source'
            : positionRecovery
              ? 'deferred_launch_position'
              : 'deferred';
        ctx.replay(shot, ownerType, mode, recoveryDelay);
        this.recoveredCount++;
        if (signatureRecovery) this.signatureRecoveredCount++;
        if (mapSourceRecovery) this.mapSourceRecoveredCount++;
        if (positionRecovery) this.positionRecoveredCount++;
        this.maxRecoveryDelayMs = Math.max(this.maxRecoveryDelayMs, recoveryDelay);
      }
      this.removeAt(index);
    }
  }

  /**
   * Counts a shot whose owner type *was* resolved but whose bulletType has no
   * projectile definition for it. ProdMafia only notes this to its packet log
   * (`:2547-2552`); it stays a drop, because re-queuing cannot make a missing
   * game-data entry appear.
   */
  noteMissingDefinition(): void {
    this.noDefinitionCount++;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Counters for `debugInfo()`. `queued` / `bySignature` / `byMapSource` /
   * `unresolved` are the four the dodge investigation needs: how many shots the
   * old code would have thrown away, how each one was recovered, and how many
   * are still being lost.
   */
  stats(): Record<string, unknown> {
    return {
      pending: this.pending.length,
      queued: this.queuedCount,
      recovered: this.recoveredCount,
      bySignature: this.signatureRecoveredCount,
      byMapSource: this.mapSourceRecoveredCount,
      byLaunchPosition: this.positionRecoveredCount,
      unresolved: this.expiredCount,
      distantSkipped: this.distantSkippedCount,
      queueOverflow: this.overflowCount,
      tooLateToReplay: this.lateCount,
      noProjectileDefinition: this.noDefinitionCount,
      maxRecoveryDelayMs: this.maxRecoveryDelayMs,
      learnedSignatures: this.typeBySignature.size,
      ambiguousSignatures: this.ambiguousSignatures.size,
      learnedMapSources: this.mapSources.size,
      unresolvedProfiles: this.describeUnresolvedProfiles(),
    };
  }

  /** ProdMafia `enemyShootSignature` (`:2738-2742`). */
  private enemyShootSignature(shot: EnemyShootObservation): string {
    return `${shot.bulletType}:${shot.damage}:${Math.max(1, shot.numShots)}:${Math.round(shot.angleInc * 10000)}`;
  }

  /**
   * ProdMafia `rememberEnemyShootSignature` (`:2744-2761`). Two object types
   * sharing a signature poisons it permanently for this map rather than
   * letting the second one overwrite the first.
   */
  private rememberSignature(ownerType: number, shot: EnemyShootObservation): void {
    if (ownerType < 0) {
      return;
    }
    const key = this.enemyShootSignature(shot);
    if (this.ambiguousSignatures.has(key)) {
      return;
    }
    const previous = this.typeBySignature.get(key);
    if (previous !== undefined) {
      if (previous !== ownerType) {
        this.typeBySignature.delete(key);
        if (this.ambiguousSignatures.size < MAX_ENEMY_SHOOT_SIGNATURES) {
          this.ambiguousSignatures.add(key);
        }
      }
      return;
    }
    if (this.typeBySignature.size >= MAX_ENEMY_SHOOT_SIGNATURES) {
      return;
    }
    this.typeBySignature.set(key, ownerType);
  }

  /** ProdMafia `getEnemyShootSignatureType` (`:2763-2772`). */
  private getEnemyShootSignatureType(shot: EnemyShootObservation): number {
    const key = this.enemyShootSignature(shot);
    if (this.ambiguousSignatures.has(key)) {
      return -1;
    }
    return this.typeBySignature.get(key) ?? -1;
  }

  /** ProdMafia `hasEnemyShootProjectileDefinition` (`:2774-2782`). */
  private hasProjectileDefinition(ownerType: number, bulletType: number): boolean {
    if (ownerType < 0) {
      return false;
    }
    const definition = this.data.getProjectile(ownerType, bulletType);
    return !!definition && definition.lifetimeMs > 0;
  }

  /** ProdMafia `mapEnemyShootSourceKey` (`:2784-2786`). */
  private mapSourceKey(ownerId: number): string {
    return `${this.mapName}|${ownerId}`;
  }

  /** ProdMafia `rememberMapEnemyShootSource` (`:2788-2820`). */
  private rememberMapSource(ownerId: number, ownerType: number, startX: number, startY: number): void {
    if (ownerId < 0 || ownerId > MAX_STABLE_MAP_OWNER_ID || ownerType < 0
      || !Number.isFinite(startX) || !Number.isFinite(startY)) {
      return;
    }
    // The nexus and the realm recycle low object ids across a huge, changing
    // population, so nothing learned there is worth keeping.
    if (this.mapName === '' || this.mapName === 'Nexus' || this.mapName === 'Realm of the Mad God') {
      return;
    }
    const key = this.mapSourceKey(ownerId);
    if (this.ambiguousMapSources.has(key)) {
      return;
    }
    const previous = this.mapSources.get(key);
    if (previous) {
      const dx = previous.x - startX;
      const dy = previous.y - startY;
      if (previous.type !== ownerType || dx * dx + dy * dy > 1) {
        this.mapSources.delete(key);
        if (this.ambiguousMapSources.size < MAX_MAP_ENEMY_SHOOT_SOURCES) {
          this.ambiguousMapSources.add(key);
        }
      }
      return;
    }
    if (this.mapSources.size >= MAX_MAP_ENEMY_SHOOT_SOURCES) {
      return;
    }
    this.mapSources.set(key, { type: ownerType, x: startX, y: startY });
  }

  /** ProdMafia `getMapEnemyShootSourceType` (`:2822-2841`). */
  private getMapEnemyShootSourceType(
    ownerId: number,
    bulletType: number,
    startX: number,
    startY: number,
  ): number {
    if (!Number.isFinite(startX) || !Number.isFinite(startY)) {
      return -1;
    }
    const key = this.mapSourceKey(ownerId);
    if (this.ambiguousMapSources.has(key)) {
      return -1;
    }
    const source = this.mapSources.get(key);
    if (!source) {
      return -1;
    }
    const dx = source.x - startX;
    const dy = source.y - startY;
    return dx * dx + dy * dy <= 1 && this.hasProjectileDefinition(source.type, bulletType)
      ? source.type
      : -1;
  }

  /**
   * ProdMafia `getBuiltInMapEnemyShootSourceType` (`:2843-2870`). Neo Forax's
   * perimeter sources are server-owned map objects that never enter UPDATE
   * until the player streams their sector. Their low ids and types were stable
   * across the July 15, 17 and 21 captures; the bullet-type check makes a
   * changed layout fail closed into ordinary deferral.
   */
  private getBuiltInMapEnemyShootSourceType(ownerId: number, bulletType: number): number {
    if (this.mapName !== 'Neo Forax') {
      return -1;
    }
    let ownerType = -1;
    switch (ownerId) {
      case 4: ownerType = 0xdcd0; break; // background watcher
      case 5:
      case 15: ownerType = 0xdcd1; break; // background watchling
      case 7: ownerType = 0xdcd2; break; // background watcher sentinel
      case 10: ownerType = 0xdcd3; break; // background hunger
      default: return -1;
    }
    return this.hasProjectileDefinition(ownerType, bulletType) ? ownerType : -1;
  }

  /** ProdMafia `recordUnresolvedEnemyShoot` (`:2872-2881`). */
  private recordUnresolvedEnemyShoot(shot: EnemyShootObservation): void {
    const key = this.enemyShootSignature(shot);
    const count = this.unresolvedProfiles.get(key);
    if (count === undefined && this.unresolvedProfiles.size >= MAX_UNRESOLVED_ENEMY_SHOOT_PROFILES) {
      return;
    }
    this.unresolvedProfiles.set(key, (count ?? 0) + 1);
  }

  /**
   * ProdMafia `consumeUnresolvedEnemyShootProfiles` (`:2883-2893`) drains this
   * into a one-second summary log. `debugInfo()` is polled instead of pushed,
   * so this reports without consuming.
   */
  private describeUnresolvedProfiles(): string {
    const parts: string[] = [];
    for (const [key, count] of this.unresolvedProfiles) {
      if (parts.length >= 8) break;
      parts.push(`${key}x${count}`);
    }
    return parts.join(',');
  }

  /** ProdMafia `removePendingEnemyShoot` (`:2732-2736`): swap with the tail. */
  private removeAt(index: number): void {
    const last = this.pending.length - 1;
    this.pending[index] = this.pending[last]!;
    this.pending.length = last;
  }
}

/** ProdMafia treats a zero/unset shot count as one (`:2553`). */
export function enemyShotCount(numShots: number): number {
  return numShots > 0 && numShots !== 0xff ? numShots : 1;
}

/** Copies the primitive ENEMYSHOOT fields out of a pooled packet object. */
export function enemyShootObservation(packet: EnemyShootPacket): EnemyShootObservation {
  return {
    ownerId: packet.ownerId,
    bulletId: packet.bulletId,
    bulletType: packet.bulletType,
    damage: packet.damage,
    numShots: packet.numShots,
    angleInc: packet.angleInc,
    angle: packet.angle,
    startX: packet.startingPos.x,
    startY: packet.startingPos.y,
  };
}

//#endregion
