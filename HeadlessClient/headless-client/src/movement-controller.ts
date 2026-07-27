import { config } from './config';
import { ConditionEffectBits } from 'realmlib';

export interface MovementSnapshot {
  playerSpeed: number;
  playerSpeedBoost: number;
  localPos: { x: number; y: number };
  serverPos?: { x: number; y: number };
  condition?: number;
  tileSpeed?: number;
}

export interface MoveTarget {
  x: number;
  y: number;
  threshold: number;
}

export interface MovementUpdate {
  pos: { x: number; y: number };
  reached?: { x: number; y: number };
  stalled?: { distance: number };
  collision?: {
    requestedDistance: number;
    appliedDistance: number;
  };
}

export interface MovementVelocity {
  x: number;
  y: number;
}

export interface MovementUpdateOptions {
  /** Integrate from locally predicted movement instead of the last server position. */
  integrateFromLocal?: boolean;
  /** Temporarily replaces navigation velocity without changing its target. */
  velocityOverride?: MovementVelocity;
  /** Continue target-progress stall detection while applying the override. */
  trackTargetProgress?: boolean;
  /** Resolves the intended step against authoritative map collision. */
  resolvePosition?: MovementPositionResolver;
}

export type MovementPositionResolver = (
  from: Readonly<{ x: number; y: number }>,
  intended: Readonly<{ x: number; y: number }>,
) => { x: number; y: number };

const SPEED_MIN = 0.004;
const SPEED_MAX = 0.0096;
const MAX_COLLISION_STEP = 0.4;
const COLLISION_EPSILON = 1e-6;

/** Owns movement target state and local dead-reckoning between server ticks. */
export class MovementController {
  private target: MoveTarget | undefined;
  private bestDist = Infinity;
  private stallMs = 0;
  private stallWarned = false;

  setTarget(target: { x: number; y: number }, threshold = config.arriveThreshold): void {
    this.target = { x: target.x, y: target.y, threshold };
    this.bestDist = Infinity;
    this.stallMs = 0;
    this.stallWarned = false;
  }

  clear(): void {
    this.target = undefined;
    this.bestDist = Infinity;
    this.stallMs = 0;
    this.stallWarned = false;
  }

  hasTarget(): boolean {
    return this.target !== undefined;
  }

  /** Current navigation target for diagnostics and control-panel visualisation. */
  getTarget(): MoveTarget | undefined {
    return this.target ? { ...this.target } : undefined;
  }

  update(snapshot: MovementSnapshot, dt: number, options: MovementUpdateOptions = {}): MovementUpdate {
    if (!this.target && !options.velocityOverride) {
      return { pos: snapshot.localPos };
    }
    const base = options.integrateFromLocal
      ? snapshot.localPos
      : snapshot.serverPos ?? snapshot.localPos;
    const intended = options.velocityOverride
      ? this.stepWithVelocity(snapshot, dt, options.velocityOverride, !!options.integrateFromLocal)
      : this.stepToward(snapshot, dt, !!options.integrateFromLocal);
    const pos = options.resolvePosition
      ? options.resolvePosition(base, intended)
      : intended;
    const requestedDistance = Math.hypot(intended.x - base.x, intended.y - base.y);
    const appliedDistance = Math.hypot(pos.x - base.x, pos.y - base.y);
    const collision = Math.hypot(intended.x - pos.x, intended.y - pos.y) > COLLISION_EPSILON
      ? { requestedDistance, appliedDistance }
      : undefined;
    if (!this.target) return { pos, collision };
    const stalled = options.velocityOverride && !options.trackTargetProgress
      ? undefined
      : this.detectStall(snapshot.serverPos, dt);
    const confirmedPos = snapshot.serverPos ?? pos;
    if (Math.hypot(this.target.x - confirmedPos.x, this.target.y - confirmedPos.y) < this.target.threshold) {
      const reached = { x: this.target.x, y: this.target.y };
      this.clear();
      return { pos, reached, stalled, collision };
    }
    return { pos, stalled, collision };
  }

  getIntendedVelocity(snapshot: MovementSnapshot, integrateFromLocal = false): MovementVelocity {
    if (!this.target) return { x: 0, y: 0 };
    const base = integrateFromLocal ? snapshot.localPos : snapshot.serverPos ?? snapshot.localPos;
    const dx = this.target.x - base.x;
    const dy = this.target.y - base.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return { x: 0, y: 0 };
    const speed = movementSpeed(snapshot);
    return { x: dx / distance * speed, y: dy / distance * speed };
  }

  private stepToward(
    snapshot: MovementSnapshot,
    dt: number,
    integrateFromLocal: boolean,
  ): { x: number; y: number } {
    const target = this.target!;
    const base = integrateFromLocal ? snapshot.localPos : snapshot.serverPos ?? snapshot.localPos;
    const step = movementSpeed(snapshot) * dt;
    const dx = target.x - base.x;
    const dy = target.y - base.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= step || dist === 0) {
      return { x: target.x, y: target.y };
    }
    return { x: base.x + (dx / dist) * step, y: base.y + (dy / dist) * step };
  }

  private stepWithVelocity(
    snapshot: MovementSnapshot,
    dt: number,
    velocity: MovementVelocity,
    integrateFromLocal: boolean,
  ): { x: number; y: number } {
    const base = integrateFromLocal ? snapshot.localPos : snapshot.serverPos ?? snapshot.localPos;
    return { x: base.x + velocity.x * dt, y: base.y + velocity.y * dt };
  }

  private detectStall(serverPos: { x: number; y: number } | undefined, dt: number): { distance: number } | undefined {
    if (!this.target || !serverPos) {
      return undefined;
    }
    const serverDist = Math.hypot(this.target.x - serverPos.x, this.target.y - serverPos.y);
    if (serverDist < this.bestDist - 0.1) {
      this.bestDist = serverDist;
      this.stallMs = 0;
      this.stallWarned = false;
      return undefined;
    }
    this.stallMs += dt;
    if (this.stallMs > 3000 && !this.stallWarned) {
      this.stallWarned = true;
      return { distance: serverDist };
    }
    return undefined;
  }
}

/**
 * Sweeps a movement step through fractional collision geometry and slides along
 * a blocked axis instead of allowing a valid route to cut through an obstacle.
 */
export function resolveMovementCollision(
  from: Readonly<{ x: number; y: number }>,
  intended: Readonly<{ x: number; y: number }>,
  canOccupy: (x: number, y: number) => boolean,
): { x: number; y: number } {
  const dx = intended.x - from.x;
  const dy = intended.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= COLLISION_EPSILON) return { x: intended.x, y: intended.y };

  const steps = Math.max(1, Math.ceil(distance / MAX_COLLISION_STEP));
  const stepX = dx / steps;
  const stepY = dy / steps;
  let current = { x: from.x, y: from.y };
  for (let remaining = steps; remaining > 0; remaining--) {
    const next = {
      x: current.x + stepX,
      y: current.y + stepY,
    };
    if (canOccupy(next.x, next.y)) {
      current = next;
      continue;
    }

    const candidates = [
      furthestReachable(current, next, canOccupy),
      furthestReachable(current, { x: next.x, y: current.y }, canOccupy),
      furthestReachable(current, { x: current.x, y: next.y }, canOccupy),
    ];
    let best = current;
    let bestProgress = 0;
    for (const candidate of candidates) {
      const progress = (candidate.x - current.x) * dx + (candidate.y - current.y) * dy;
      if (progress > bestProgress + COLLISION_EPSILON) {
        best = candidate;
        bestProgress = progress;
      }
    }
    current = best;
  }
  return current;
}

function furthestReachable(
  from: Readonly<{ x: number; y: number }>,
  to: Readonly<{ x: number; y: number }>,
  canOccupy: (x: number, y: number) => boolean,
): { x: number; y: number } {
  if (canOccupy(to.x, to.y)) return { x: to.x, y: to.y };
  if (!canOccupy(from.x, from.y)) return { x: from.x, y: from.y };

  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 12; iteration++) {
    const ratio = (low + high) * 0.5;
    const x = from.x + (to.x - from.x) * ratio;
    const y = from.y + (to.y - from.y) * ratio;
    if (canOccupy(x, y)) low = ratio;
    else high = ratio;
  }
  return {
    x: from.x + (to.x - from.x) * low,
    y: from.y + (to.y - from.y) * low,
  };
}

export function movementSpeed(snapshot: MovementSnapshot): number {
  const tileMultiplier = Math.min(1, Math.max(0, snapshot.tileSpeed ?? 1));
  if (((snapshot.condition ?? 0) & ConditionEffectBits.SLOWED) !== 0) {
    return SPEED_MIN * tileMultiplier;
  }
  const speedStat = snapshot.playerSpeed + snapshot.playerSpeedBoost;
  let speed = SPEED_MIN + (speedStat / 75) * (SPEED_MAX - SPEED_MIN);
  if (((snapshot.condition ?? 0) & (ConditionEffectBits.SPEEDY | ConditionEffectBits.NINJA_SPEEDY)) !== 0) {
    speed *= 1.5;
  }
  return speed * tileMultiplier;
}
