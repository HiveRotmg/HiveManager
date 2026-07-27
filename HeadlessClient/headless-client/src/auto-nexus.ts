export interface AutoNexusConfig {
  enabled: boolean;
  thresholdPercent: number;
  /** ProdMafia's optional sliding-window margin for damage the client did not predict. */
  observedDamageMargin: boolean;
}

export type AutoNexusTriggerSource =
  | 'server'
  | 'projectile'
  | 'aoe'
  | 'ground'
  | 'condition'
  | 'predictive';

export interface AutoNexusState extends AutoNexusConfig {
  serverHp: number | null;
  predictedHp: number | null;
  syncedHp: number | null;
  maxHp: number | null;
  pendingDamage: number;
  pendingRecovery: number;
  effectiveThresholdHp: number | null;
  unattributedDps: number;
  safeMap: boolean;
  triggered: boolean;
  lastTriggerAt: number | null;
  lastTriggerSource: AutoNexusTriggerSource | null;
}

export interface AutoNexusTrigger {
  source: AutoNexusTriggerSource;
  hp: number;
  maxHp: number;
  thresholdHp: number;
  effectiveThresholdHp: number;
  thresholdPercent: number;
  predictedDamage?: number;
  impactMs?: number;
  candidate?: number;
  threats?: number;
  decision?: string;
}

export interface AutoNexusDamageOptions {
  baseDamage: number;
  defense: number;
  armorPiercing?: boolean;
  armorBroken?: boolean;
  armored?: boolean;
  invincible?: boolean;
  invulnerable?: boolean;
  exposed?: boolean;
  petrified?: boolean;
  cursed?: boolean;
}

export interface PredictiveAutoNexusOptions {
  predictedDamage: number;
  impactMs: number;
  candidate?: number;
  threats?: number;
  decision?: string;
}

export interface AutoNexusRoutePrediction {
  predictedDamage: number;
  impactMs: number;
}

export interface AutoNexusRoutePredictionOptions {
  now: number;
  playerId: number;
  position: { x: number; y: number };
  trajectory: DodgeTrajectory | null;
  projectiles: readonly CombatProjectileSnapshot[];
  aoes: readonly DodgePlanningAoe[];
  calculateDamage(baseDamage: number, armorPiercing: boolean): number;
  leadMs?: number;
}

interface PendingDamage {
  amount: number;
  expiresAt: number;
}

interface UnattributedDamage {
  amount: number;
  at: number;
}

/** ProdMafia defaults AutoNexus to 15 percent. */
const DEFAULT_THRESHOLD_PERCENT = 15;
const PROJECTILE_DAMAGE_PREDICTION_MS = 600;
const ENVIRONMENT_DAMAGE_PREDICTION_MS = 1_200;
const MAX_PENDING_DAMAGE_PREDICTIONS = 64;
const UNATTRIBUTED_WINDOW_MS = 2_000;
const UNATTRIBUTED_REACTION_MS = 350;
const UNATTRIBUTED_MAX_FRACTION = 0.12;
const PREDICTIVE_NEXUS_LEAD_MS = 180;
const PREDICTIVE_SAMPLE_MS = 10;

// Keep these spellings aligned with GameSprite.isSafeMap in ProdMafia.
const AUTO_NEXUS_SAFE_MAPS = new Set([
  'nexus',
  'vault',
  'guild hall',
  'guild hall 2',
  'guild hall 3',
  'guild hall 4',
  'guild hall 5',
  'cloth bazaar',
  'nexus explanation',
  'daily quest room',
  'daily login room',
  'pet yard',
  'pet yard 2',
  'pet yard 3',
  'pet yard 4',
  'pet yard 5',
]);

/** Maps where ProdMafia suppresses autonexus health checks. */
export function isAutoNexusSafeMap(mapName: string): boolean {
  return AUTO_NEXUS_SAFE_MAPS.has(String(mapName ?? '').trim().toLowerCase());
}

/** RotMG player-damage formula used by ProdMafia's local HP prediction. */
export function calculateAutoNexusDamage(options: AutoNexusDamageOptions): number {
  if (options.invincible || options.invulnerable) return 0;
  const baseDamage = Math.max(0, Math.trunc(Number(options.baseDamage) || 0));
  let defense = Math.max(0, Math.trunc(Number(options.defense) || 0));
  if (options.armorPiercing || options.armorBroken) defense = 0;
  else if (options.armored) defense = Math.trunc(defense * 1.5);
  if (options.exposed) defense -= 20;
  let damage = Math.max(baseDamage - defense, Math.trunc(baseDamage * 3 / 20));
  if (options.petrified) damage = Math.trunc(damage * 0.9);
  if (options.cursed) damage = Math.trunc(damage * 1.25);
  return damage;
}

/**
 * Totals damage which still intersects the dodge controller's committed
 * safest route inside ProdMafia's 180 ms predictive-nexus window.
 */
export function predictAutoNexusRouteDamage(
  options: AutoNexusRoutePredictionOptions,
): AutoNexusRoutePrediction {
  const leadMs = Math.max(
    0,
    Math.min(PREDICTIVE_NEXUS_LEAD_MS, Math.trunc(options.leadMs ?? PREDICTIVE_NEXUS_LEAD_MS)),
  );
  let predictedDamage = 0;
  let impactMs = Number.POSITIVE_INFINITY;

  for (const projectile of options.projectiles) {
    if (
      projectile.side !== 'enemy'
      || projectile.hitObjects.has(options.playerId)
      || !isProjectileAliveAt(projectile, options.now)
    ) {
      continue;
    }
    const halfSize = projectileCollisionHalfSize(projectile.definition);
    let previousOffset = 0;
    let previousProjectile = predictProjectilePosition(projectile, options.now);
    let previousPlayer = routePositionAt(
      options.position,
      options.trajectory,
      options.now,
      options.now,
    );
    let hitAt: number | null = pointInsideRelativeSquare(
      previousProjectile,
      previousPlayer,
      halfSize,
    ) ? 0 : null;

    for (
      let offset = PREDICTIVE_SAMPLE_MS;
      hitAt === null && offset <= leadMs;
      offset += PREDICTIVE_SAMPLE_MS
    ) {
      const nextOffset = Math.min(offset, leadMs);
      const absoluteTime = options.now + nextOffset;
      if (!isProjectileAliveAt(projectile, absoluteTime)) break;
      const nextProjectile = predictProjectilePosition(projectile, absoluteTime);
      const nextPlayer = routePositionAt(
        options.position,
        options.trajectory,
        options.now,
        absoluteTime,
      );
      if (relativeSegmentIntersectsSquare(
        previousProjectile.x - previousPlayer.x,
        previousProjectile.y - previousPlayer.y,
        nextProjectile.x - nextPlayer.x,
        nextProjectile.y - nextPlayer.y,
        halfSize,
      )) {
        hitAt = previousOffset;
        break;
      }
      previousOffset = nextOffset;
      previousProjectile = nextProjectile;
      previousPlayer = nextPlayer;
      if (nextOffset === leadMs) break;
      if (offset + PREDICTIVE_SAMPLE_MS > leadMs) offset = leadMs - PREDICTIVE_SAMPLE_MS;
    }

    if (hitAt !== null) {
      predictedDamage += options.calculateDamage(
        projectile.damage,
        !!projectile.definition.armorPiercing,
      );
      impactMs = Math.min(impactMs, hitAt);
    }
  }

  for (const aoe of options.aoes) {
    const damage = Math.max(0, Math.trunc(Number(aoe.damage) || 0));
    if (damage <= 0) continue;
    const landingOffset = aoe.landingTime - options.now;
    const dwellEnd = landingOffset + Math.max(0, aoe.blastDurationMs ?? 0);
    if (dwellEnd < 0 || landingOffset > leadMs) continue;
    const firstOffset = Math.max(0, landingOffset);
    const lastOffset = Math.min(leadMs, Math.max(firstOffset, dwellEnd));
    let hitAt: number | null = null;
    for (
      let offset = firstOffset;
      offset <= lastOffset;
      offset += PREDICTIVE_SAMPLE_MS
    ) {
      const player = routePositionAt(
        options.position,
        options.trajectory,
        options.now,
        options.now + offset,
      );
      if (Math.hypot(player.x - aoe.x, player.y - aoe.y) < aoe.radius) {
        hitAt = offset;
        break;
      }
      if (offset + PREDICTIVE_SAMPLE_MS > lastOffset && offset !== lastOffset) {
        offset = lastOffset - PREDICTIVE_SAMPLE_MS;
      }
    }
    if (hitAt !== null) {
      predictedDamage += options.calculateDamage(damage, !!aoe.armorPiercing);
      impactMs = Math.min(impactMs, hitAt);
    }
  }

  return {
    predictedDamage,
    impactMs: Number.isFinite(impactMs) ? Math.trunc(impactMs) : -1,
  };
}

/**
 * Ports ProdMafia's Auto Nexus health model:
 * - server HP and a separate synced baseline;
 * - bounded, expiring local-damage predictions;
 * - locally predicted recovery reconciled against later server healing;
 * - an optional observed-unattributed-damage margin; and
 * - a pre-impact trigger supplied by the dodge controller's safest route.
 */
export class AutoNexusMonitor {
  private enabled = true;
  private thresholdPercent = DEFAULT_THRESHOLD_PERCENT;
  private observedDamageMargin = false;
  private serverHp: number | null = null;
  private predictedHp: number | null = null;
  private syncedHp: number | null = null;
  private maxHp: number | null = null;
  private pendingRecovery = 0;
  private pendingDamage = 0;
  private readonly pendingDamageEntries: PendingDamage[] = [];
  private readonly unattributedDamage: UnattributedDamage[] = [];
  private safeMap = true;
  private triggered = false;
  private lastTriggerAt: number | null = null;
  private lastTriggerSource: AutoNexusTriggerSource | null = null;

  constructor(
    private readonly onTrigger: (trigger: AutoNexusTrigger) => void,
    private readonly now: () => number = Date.now,
  ) {}

  configure(options: Partial<AutoNexusConfig>): void {
    if (options.thresholdPercent !== undefined) this.setThreshold(options.thresholdPercent);
    if (options.observedDamageMargin !== undefined) {
      this.setObservedDamageMargin(options.observedDamageMargin);
    }
    if (options.enabled !== undefined) this.setEnabled(options.enabled);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = !!enabled;
    if (!this.enabled) this.triggered = false;
    else this.check('server');
  }

  setThreshold(thresholdPercent: number): void {
    const value = Number(thresholdPercent);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new RangeError('Autonexus threshold must be between 0 and 100 percent.');
    }
    this.thresholdPercent = value;
    // ProdMafia's "Off" threshold is zero. Retain the explicit enabled switch,
    // while making zero behave exactly like that option.
    if (value === 0) this.triggered = false;
    this.check('server');
  }

  setObservedDamageMargin(enabled: boolean): void {
    this.observedDamageMargin = !!enabled;
    this.check('server');
  }

  setSafeMap(safeMap: boolean): void {
    this.safeMap = !!safeMap;
    if (this.safeMap) this.triggered = false;
    else this.check('server');
  }

  reset(serverHp?: number, maxHp?: number): void {
    this.serverHp = validHp(serverHp);
    this.predictedHp = this.serverHp;
    this.syncedHp = this.serverHp;
    this.maxHp = validMaxHp(maxHp);
    this.pendingRecovery = 0;
    this.clearPendingDamage();
    this.unattributedDamage.length = 0;
    this.triggered = false;
  }

  /**
   * Reconciles one authoritative HP sample. Negative deltas consume pending
   * damage oldest-first; positive deltas acknowledge locally predicted recovery.
   */
  reconcileServerHp(serverHp: number, maxHp: number, full = false, at = this.now()): boolean {
    const nextMax = validMaxHp(maxHp);
    const nextServer = validHp(serverHp);
    if (nextMax === null || nextServer === null) return false;
    const boundedServer = Math.min(nextServer, nextMax);

    if (full || this.syncedHp === null || this.predictedHp === null) {
      this.serverHp = boundedServer;
      this.predictedHp = boundedServer;
      this.syncedHp = boundedServer;
      this.maxHp = nextMax;
      this.pendingRecovery = 0;
      this.clearPendingDamage();
      return this.check('server', at);
    }

    const oldMax = this.maxHp;
    const serverDelta = boundedServer - this.syncedHp;
    const capacityDelta = oldMax === null ? 0 : nextMax - oldMax;
    if (serverDelta > 0) {
      this.pendingRecovery -= Math.min(serverDelta, this.pendingRecovery);
    } else if (serverDelta < 0) {
      const capacityLoss = Math.max(0, -capacityDelta);
      const combatDamage = Math.max(0, -serverDelta - capacityLoss);
      const unpredictedDamage = Math.max(0, combatDamage - this.pendingDamage);
      this.consumePendingDamage(-serverDelta);
      if (unpredictedDamage > 0 && capacityDelta === 0) {
        this.noteUnattributedDamage(unpredictedDamage, at);
      }
    }

    this.maxHp = nextMax;
    this.serverHp = boundedServer;
    this.syncedHp = boundedServer;
    this.expirePendingDamage(at, false);
    this.rebuildPredictedHp();
    // ProdMafia never lets an optimistic local recovery exceed a fresh sample.
    if (this.predictedHp !== null && this.predictedHp > boundedServer) {
      this.predictedHp = boundedServer;
      this.pendingRecovery = 0;
    }
    return this.check('server', at);
  }

  applyDamage(amount: number, source: AutoNexusTriggerSource, at = this.now()): boolean {
    if (this.predictedHp === null) return false;
    const damage = positiveInteger(amount);
    if (damage <= 0) return false;
    if (source !== 'server' && source !== 'predictive') {
      this.addPendingDamage(damage, source, at);
    }
    this.predictedHp -= damage;
    return this.check(source, at);
  }

  /**
   * Applies a DAMAGE-packet hit immediately to the authoritative figures.
   * ProdMafia advances hp_ before calling its server_damage path, so waiting for
   * the next NEWTICK here would make the headless port react one packet later.
   */
  applyServerDamage(amount: number, at = this.now()): boolean {
    const damage = positiveInteger(amount);
    if (damage <= 0 || this.serverHp === null) return false;
    this.serverHp = Math.max(0, this.serverHp - damage);
    this.syncedHp = this.syncedHp === null
      ? this.serverHp
      : Math.min(this.syncedHp, this.serverHp);
    this.rebuildPredictedHp();
    if (this.predictedHp !== null && this.syncedHp !== null && this.predictedHp > this.syncedHp) {
      this.predictedHp = this.syncedHp;
      this.pendingRecovery = 0;
    }
    return this.check('server', at);
  }

  /** Adds local VIT/healing recovery and tracks it until a server increase acknowledges it. */
  applyRecovery(amount: number, at = this.now()): boolean {
    if (this.predictedHp === null || this.maxHp === null) return false;
    const recovery = positiveInteger(amount);
    if (recovery <= 0) return false;
    const before = this.predictedHp;
    this.predictedHp = Math.min(this.maxHp, this.predictedHp + recovery);
    this.pendingRecovery += Math.max(0, this.predictedHp - before);
    return this.check('server', at);
  }

  /** Expires stale local predictions and runs the ordinary health check. */
  tick(at = this.now()): boolean {
    this.expirePendingDamage(at);
    this.pruneUnattributed(at);
    return this.check('server', at);
  }

  /** Records server-applied combat damage which had no matching local prediction. */
  noteUnattributedDamage(amount: number, at = this.now()): void {
    const damage = positiveInteger(amount);
    if (damage <= 0) return;
    this.unattributedDamage.push({ amount: damage, at });
    this.pruneUnattributed(at);
  }

  /**
   * ProdMafia's 180 ms pre-impact check. The caller must supply damage from the
   * safest modeled route, not merely the current movement route.
   */
  checkPredictive(options: PredictiveAutoNexusOptions, at = this.now()): boolean {
    if (
      !this.enabled
      || this.thresholdPercent === 0
      || this.safeMap
      || this.triggered
      || this.maxHp === null
    ) {
      return false;
    }
    const predictedDamage = positiveInteger(options.predictedDamage);
    const impactMs = Math.trunc(Number(options.impactMs));
    if (
      predictedDamage <= 0
      || !Number.isFinite(impactMs)
      || impactMs < 0
      || impactMs > PREDICTIVE_NEXUS_LEAD_MS
    ) {
      return false;
    }
    this.expirePendingDamage(at);
    const hp = this.lowestHealth();
    if (hp === null) return false;
    // ProdMafia deliberately uses the configured threshold here, not the
    // observed-damage margin used by the ordinary health check.
    const thresholdHp = this.baseThresholdHp();
    if (hp <= 0 || hp - predictedDamage > thresholdHp) return false;

    return this.trigger({
      source: 'predictive',
      hp,
      maxHp: this.maxHp,
      thresholdHp,
      effectiveThresholdHp: thresholdHp,
      thresholdPercent: this.thresholdPercent,
      predictedDamage,
      impactMs,
      candidate: options.candidate,
      threats: options.threats,
      decision: options.decision,
    }, at);
  }

  getState(at = this.now()): AutoNexusState {
    this.expirePendingDamage(at);
    this.pruneUnattributed(at);
    return {
      enabled: this.enabled,
      thresholdPercent: this.thresholdPercent,
      observedDamageMargin: this.observedDamageMargin,
      serverHp: this.serverHp,
      predictedHp: this.predictedHp,
      syncedHp: this.syncedHp,
      maxHp: this.maxHp,
      pendingDamage: this.pendingDamage,
      pendingRecovery: this.pendingRecovery,
      effectiveThresholdHp: this.maxHp === null ? null : this.effectiveThresholdHp(at),
      unattributedDps: this.unattributedDps(at),
      safeMap: this.safeMap,
      triggered: this.triggered,
      lastTriggerAt: this.lastTriggerAt,
      lastTriggerSource: this.lastTriggerSource,
    };
  }

  private check(source: AutoNexusTriggerSource, at = this.now()): boolean {
    if (
      !this.enabled
      || this.thresholdPercent === 0
      || this.safeMap
      || this.triggered
      || this.maxHp === null
    ) {
      return false;
    }
    this.expirePendingDamage(at);
    const hp = this.lowestHealth();
    if (hp === null) return false;
    const thresholdHp = this.baseThresholdHp();
    const effectiveThresholdHp = this.effectiveThresholdHp(at);
    if (hp > effectiveThresholdHp) return false;

    return this.trigger({
      source,
      hp,
      maxHp: this.maxHp,
      thresholdHp,
      effectiveThresholdHp,
      thresholdPercent: this.thresholdPercent,
    }, at);
  }

  private trigger(trigger: AutoNexusTrigger, at: number): boolean {
    this.triggered = true;
    this.lastTriggerAt = at;
    this.lastTriggerSource = trigger.source;
    this.onTrigger(trigger);
    return true;
  }

  private lowestHealth(): number | null {
    const hpValues = [this.serverHp, this.predictedHp, this.syncedHp]
      .filter((hp): hp is number => hp !== null);
    return hpValues.length > 0 ? Math.min(...hpValues) : null;
  }

  private baseThresholdHp(): number {
    return (this.maxHp ?? 0) * this.thresholdPercent * 0.01;
  }

  private effectiveThresholdHp(at: number): number {
    const threshold = this.baseThresholdHp();
    if (!this.observedDamageMargin || threshold <= 0 || this.maxHp === null) return threshold;
    const margin = Math.min(
      this.unattributedDps(at) * (UNATTRIBUTED_REACTION_MS / 1_000),
      this.maxHp * UNATTRIBUTED_MAX_FRACTION,
    );
    return threshold + Math.trunc(margin);
  }

  private unattributedDps(at: number): number {
    this.pruneUnattributed(at);
    const total = this.unattributedDamage.reduce((sum, sample) => sum + sample.amount, 0);
    return total / (UNATTRIBUTED_WINDOW_MS / 1_000);
  }

  private pruneUnattributed(at: number): void {
    const cutoff = at - UNATTRIBUTED_WINDOW_MS;
    let count = 0;
    while (
      count < this.unattributedDamage.length
      && this.unattributedDamage[count]!.at < cutoff
    ) {
      count++;
    }
    if (count > 0) this.unattributedDamage.splice(0, count);
  }

  private addPendingDamage(amount: number, source: AutoNexusTriggerSource, at: number): void {
    this.expirePendingDamage(at);
    if (this.pendingDamageEntries.length >= MAX_PENDING_DAMAGE_PREDICTIONS) {
      const removed = this.pendingDamageEntries.shift();
      if (removed) this.pendingDamage -= removed.amount;
      this.rebuildPredictedHp();
    }
    this.pendingDamageEntries.push({
      amount,
      expiresAt: at + (
        source === 'projectile'
          ? PROJECTILE_DAMAGE_PREDICTION_MS
          : ENVIRONMENT_DAMAGE_PREDICTION_MS
      ),
    });
    this.pendingDamage += amount;
  }

  private consumePendingDamage(amount: number): void {
    let remaining = amount;
    while (remaining > 0 && this.pendingDamageEntries.length > 0) {
      const entry = this.pendingDamageEntries[0]!;
      const consumed = Math.min(remaining, entry.amount);
      entry.amount -= consumed;
      remaining -= consumed;
      this.pendingDamage -= consumed;
      if (entry.amount === 0) this.pendingDamageEntries.shift();
    }
  }

  private expirePendingDamage(at: number, rebuild = true): void {
    let expired = 0;
    for (let index = this.pendingDamageEntries.length - 1; index >= 0; index--) {
      const entry = this.pendingDamageEntries[index]!;
      if (at < entry.expiresAt) continue;
      expired += entry.amount;
      this.pendingDamage -= entry.amount;
      this.pendingDamageEntries.splice(index, 1);
    }
    if (rebuild && expired > 0) this.rebuildPredictedHp();
  }

  private clearPendingDamage(): void {
    this.pendingDamageEntries.length = 0;
    this.pendingDamage = 0;
  }

  private rebuildPredictedHp(): void {
    if (this.syncedHp === null) return;
    this.predictedHp = this.syncedHp + this.pendingRecovery - this.pendingDamage;
    if (this.maxHp !== null) this.predictedHp = Math.min(this.predictedHp, this.maxHp);
  }
}

function positiveInteger(value: unknown): number {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function validHp(value: unknown): number | null {
  const hp = Number(value);
  return Number.isFinite(hp) && hp >= 0 ? hp : null;
}

function validMaxHp(value: unknown): number | null {
  const hp = Number(value);
  return Number.isFinite(hp) && hp > 0 ? hp : null;
}

function routePositionAt(
  current: { x: number; y: number },
  trajectory: DodgeTrajectory | null,
  now: number,
  absoluteTime: number,
): { x: number; y: number } {
  if (!trajectory || trajectory.waypoints.length === 0 || absoluteTime <= now) {
    return { ...current };
  }
  const currentOffset = Math.max(0, now - trajectory.createdAt);
  const targetOffset = Math.max(currentOffset, absoluteTime - trajectory.createdAt);
  let previous = { ...current, timeOffsetMs: currentOffset };
  for (const waypoint of trajectory.waypoints) {
    if (waypoint.timeOffsetMs <= currentOffset) continue;
    if (targetOffset <= waypoint.timeOffsetMs) {
      const duration = waypoint.timeOffsetMs - previous.timeOffsetMs;
      const ratio = duration <= 0
        ? 1
        : Math.max(0, Math.min(1, (targetOffset - previous.timeOffsetMs) / duration));
      return {
        x: previous.x + (waypoint.x - previous.x) * ratio,
        y: previous.y + (waypoint.y - previous.y) * ratio,
      };
    }
    previous = waypoint;
  }
  return { x: previous.x, y: previous.y };
}

function pointInsideRelativeSquare(
  projectile: { x: number; y: number },
  player: { x: number; y: number },
  halfSize: number,
): boolean {
  return Math.abs(projectile.x - player.x) <= halfSize
    && Math.abs(projectile.y - player.y) <= halfSize;
}

/** Liang-Barsky intersection against an origin-centered axis-aligned square. */
function relativeSegmentIntersectsSquare(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  halfSize: number,
): boolean {
  const dx = endX - startX;
  const dy = endY - startY;
  let low = 0;
  let high = 1;
  const clips: ReadonlyArray<readonly [number, number]> = [
    [-dx, startX + halfSize],
    [dx, halfSize - startX],
    [-dy, startY + halfSize],
    [dy, halfSize - startY],
  ];
  for (const [p, q] of clips) {
    if (Math.abs(p) <= 1e-12) {
      if (q < 0) return false;
      continue;
    }
    const ratio = q / p;
    if (p < 0) {
      if (ratio > high) return false;
      low = Math.max(low, ratio);
    } else {
      if (ratio < low) return false;
      high = Math.min(high, ratio);
    }
  }
  return low <= high;
}
import {
  isProjectileAliveAt,
  predictProjectilePosition,
  type CombatProjectileSnapshot,
} from './combat-tracker';
import type { DodgePlanningAoe, DodgeTrajectory } from './dodge-trajectory-planner';
import { projectileCollisionHalfSize } from './projectile-motion';
