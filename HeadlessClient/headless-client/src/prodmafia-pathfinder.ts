import type { DodgeMovementIntentId } from './dodge-movement-intent';
import { staticMovementProfile } from './dodge-collision-world';
import type {
  CombatPathfindingRange,
  PathfindingDataProvider,
  PathfindingIntentRevisions,
  PathfindingStep,
  PathPoint,
  PathSearchStatus,
  PathSearchStepBudget,
  PathTarget,
} from './explorative-pathfinder';
import type { HazardTraversalPolicy, StaticPassabilityStore } from './static-passability-model';
import { createStaticPassabilityStore } from './static-passability-store';

export const PROD_MAFIA_MAX_LOCAL_GOAL_DISTANCE = 5;
export const PROD_MAFIA_PATH_SEARCH_BUDGET: PathSearchStepBudget = {
  maxNodes: 2500,
  maxMs: Number.POSITIVE_INFINITY,
};

const DIR_X = [1, -1, 0, 0, 1, 1, -1, -1] as const;
const DIR_Y = [0, 0, 1, -1, 1, -1, 1, -1] as const;
const EXPANSION_LIMIT = 2500;
/** Cardinal/diagonal step weight for the hazard `cost` Dijkstra tier. */
const STEP_COST = 1;
// Flash passes 0.35 into apMoveToward as a stopDist, but waypoint consumption
// at ~0.45 always wins first — so intermediates never actually stop. Feeding
// MovementController a positive arrive radius clears intent mid-tile and causes
// stop-go between centers. Keep handoff pathfinder-owned (threshold 0).
const INTERMEDIATE_THRESHOLD = 0;
const WAYPOINT_REACHED_SQUARED = 0.20;
const PATH_PROGRESS_TIMEOUT_MS = 3500;
const PATH_MIN_PROGRESS = 0.75;
const DODGE_YIELD_MS = 250;
const DODGE_DISPLACED_SQUARED = 6.25;
const WALL_ESCAPE_HOLD_MS = 6000;
const FAILED_ROUTE_RADIUS = 6.5;

interface GridPoint {
  x: number;
  y: number;
}

export interface ProdMafiaPathRuntimeContext {
  time: number;
  mapName: string;
  dodgeOverrideActive: boolean;
  allowWallEscape?: boolean;
}

interface FailedRouteRegion {
  x: number;
  y: number;
  radius: number;
}

interface ProdMafiaPathBuildResult {
  path: GridPoint[];
  reachedGoal: boolean;
  bestDistance: number;
  lastBuildWasWallEscape: boolean;
  wallEscapeDirectionX: number;
  wallEscapeDirectionY: number;
  /** Oryx castle oscillated escape — caller must clear blocked/stuck. */
  clearBlockedState: boolean;
}

export type ProdMafiaFinalApproach = 'none' | 'guarded' | 'portal';

/**
 * Direct TypeScript port of ProdMafia GameSprite.apBuildPath.
 *
 * It deliberately keeps ProdMafia's bounded breadth-first search, direction
 * order, cardinal-neighbor goal rule, no-corner-cutting rule, 0.2-tile segment
 * validation, closest-frontier fallback, and learned route-cell rejection.
 *
 * Hazardous ground is a two-tier addition on top of that port. ProdMafia itself
 * never paths onto damaging ground (`canOccupyForDodge(..., true)`), so there is
 * no Flash cost model to copy. Tier one mirrors that safeWalk BFS. Tier two only
 * runs when tier one cannot reach a cardinal neighbor of the goal, and prices
 * damaging / sink / slow tiles via {@link StaticPassabilityStore.getTileTraversalPenalty}.
 */
export class ProdMafiaPathfinder {
  private readonly staticPassability: StaticPassabilityStore;
  private target: PathTarget | undefined;
  private combatRange: CombatPathfindingRange | undefined;
  private goalId: DodgeMovementIntentId | undefined;
  private finalApproach: ProdMafiaFinalApproach = 'none';
  private combatTargetId: number | undefined;
  private path: PathPoint[] = [];
  private plannedTiles: PathPoint[] = [];
  private blocked = new Set<number>();
  private logicalRevision = 0;
  private routeRevision = 0;
  private mapRevision = 0;
  private plannedMapRevision = -1;
  private plannedTargetKey = '';
  private runtimeTime = 0;
  private mapName = '';
  private dodgeOverrideActive = false;
  private dodgeYieldUntil = 0;
  private allowWallEscape = true;
  private lastPathBuild = 0;
  private progressAt = 0;
  private bestTargetDistance = Infinity;
  private stuckCount = 0;
  private lastBuildWasWallEscape = false;
  private wallEscapeTargetKey = '';
  private wallEscapeUntil = 0;
  private wallEscapeDirectionX = 0;
  private wallEscapeDirectionY = 0;
  private lastWallEscapeFrom = -1;
  private lastWallEscapeTo = -1;
  private wallEscapeReverseCount = 0;
  private readonly failedRouteRegions: FailedRouteRegion[] = [];
  /** Active during a single {@link searchPath} call; see class comment. */
  private hazardTraversal: HazardTraversalPolicy = 'block';
  private hazardEscalationEnabled = true;
  /** True while the active route was planned under the hazard `cost` tier. */
  private routeAllowsHazard = false;

  constructor(
    private readonly data?: PathfindingDataProvider,
    staticPassability?: StaticPassabilityStore,
  ) {
    this.staticPassability = staticPassability ?? createStaticPassabilityStore(data);
  }

  getStaticPassabilityStore(): StaticPassabilityStore {
    return this.staticPassability;
  }

  resetMap(): void {
    this.staticPassability.reset();
    this.target = undefined;
    this.combatRange = undefined;
    this.goalId = undefined;
    this.finalApproach = 'none';
    this.combatTargetId = undefined;
    this.path = [];
    this.plannedTiles = [];
    this.blocked.clear();
    this.logicalRevision++;
    this.routeRevision++;
    this.mapRevision++;
    this.plannedMapRevision = -1;
    this.plannedTargetKey = '';
    this.runtimeTime = 0;
    this.dodgeYieldUntil = 0;
    this.lastPathBuild = 0;
    this.progressAt = 0;
    this.bestTargetDistance = Infinity;
    this.stuckCount = 0;
    this.lastBuildWasWallEscape = false;
    this.wallEscapeTargetKey = '';
    this.wallEscapeUntil = 0;
    this.wallEscapeDirectionX = 0;
    this.wallEscapeDirectionY = 0;
    this.lastWallEscapeFrom = -1;
    this.lastWallEscapeTo = -1;
    this.wallEscapeReverseCount = 0;
    this.failedRouteRegions.length = 0;
  }

  setRuntimeContext(context: ProdMafiaPathRuntimeContext, position?: PathPoint): void {
    this.runtimeTime = Math.max(0, Math.trunc(context.time));
    this.mapName = context.mapName;
    this.dodgeOverrideActive = context.dodgeOverrideActive;
    this.allowWallEscape = context.allowWallEscape ?? !this.isOryxCastle();
    if (!context.dodgeOverrideActive) return;
    this.progressAt = this.runtimeTime;
    this.dodgeYieldUntil = this.runtimeTime + DODGE_YIELD_MS;
    const head = this.path[0];
    if (position && head && squaredDistance(position.x, position.y, head.x, head.y) > DODGE_DISPLACED_SQUARED) {
      this.clearRoute();
      this.lastPathBuild = 0;
    }
  }

  isYieldingToDodge(): boolean {
    return this.dodgeOverrideActive || this.runtimeTime < this.dodgeYieldUntil;
  }

  rememberFailedRouteRegion(x: number, y: number, radius = FAILED_ROUTE_RADIUS): void {
    for (const region of this.failedRouteRegions) {
      const mergeRadius = Math.max(radius, region.radius);
      if (squaredDistance(x, y, region.x, region.y) <= mergeRadius * mergeRadius) {
        region.radius = mergeRadius;
        return;
      }
    }
    this.failedRouteRegions.push({ x, y, radius });
    this.clearRoute();
  }

  clearFailedRouteRegions(): void {
    if (this.failedRouteRegions.length === 0) return;
    this.failedRouteRegions.length = 0;
    this.clearRoute();
  }

  getLastBuildWasWallEscape(): boolean {
    return this.lastBuildWasWallEscape;
  }

  getStuckCount(): number {
    return this.stuckCount;
  }

  canTraverseForAutoPlay(fromX: number, fromY: number, toX: number, toY: number): boolean {
    return this.canTraverse(fromX, fromY, toX, toY);
  }

  hasExactPathTo(fromX: number, fromY: number, toX: number, toY: number): boolean {
    const previousWallEscape = this.lastBuildWasWallEscape;
    const previousDirectionX = this.wallEscapeDirectionX;
    const previousDirectionY = this.wallEscapeDirectionY;
    const path = this.buildPath(
      Math.trunc(fromX),
      Math.trunc(fromY),
      Math.trunc(toX),
      Math.trunc(toY),
      false,
    );
    this.lastBuildWasWallEscape = previousWallEscape;
    this.wallEscapeDirectionX = previousDirectionX;
    this.wallEscapeDirectionY = previousDirectionY;
    const end = path.at(-1);
    return !!end
      && Math.abs(end.x - Math.trunc(toX)) + Math.abs(end.y - Math.trunc(toY)) <= 1;
  }

  setMapBounds(width: number, height: number): void {
    const before = this.staticPassability.getRevision();
    this.staticPassability.setMapBounds(width, height);
    if (before !== this.staticPassability.getRevision()) this.invalidate();
  }

  setTarget(
    target: PathPoint,
    threshold: number,
    goalId?: DodgeMovementIntentId,
    finalApproach: ProdMafiaFinalApproach = 'none',
  ): boolean {
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return false;
    const next = { x: target.x, y: target.y, threshold: Math.max(0, threshold) };
    // GameSprite.apPathToward keys progress/stuck state by objectId (or the
    // fixed Castle route id), not by a moving object's current coordinates.
    const identityChanged = goalId !== undefined || this.goalId !== undefined
      ? this.goalId !== goalId
      : !this.target || this.target.x !== next.x || this.target.y !== next.y;
    const changed = !this.target
      || identityChanged
      || this.target.threshold !== next.threshold
      || this.finalApproach !== finalApproach
      || !!this.combatRange;
    this.target = next;
    this.combatRange = undefined;
    this.goalId = goalId;
    this.finalApproach = finalApproach;
    this.combatTargetId = undefined;
    if (changed) {
      this.logicalRevision++;
      this.clearRoute();
      this.resetProgress();
    }
    return true;
  }

  setCombatTarget(target: PathPoint, range: CombatPathfindingRange, targetId = 0): boolean {
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return false;
    const normalized = {
      minimumDistance: Math.max(0, range.minimumDistance),
      preferredDistance: Math.max(0, range.preferredDistance),
      maximumDistance: Math.max(0, range.maximumDistance),
    };
    const changed = !this.target
      || this.target.x !== target.x
      || this.target.y !== target.y
      || this.combatTargetId !== targetId
      || !sameRange(this.combatRange, normalized);
    this.target = { x: target.x, y: target.y, threshold: normalized.preferredDistance };
    this.combatRange = normalized;
    this.combatTargetId = targetId;
    this.goalId = undefined;
    this.finalApproach = 'none';
    if (changed) {
      this.logicalRevision++;
      this.clearRoute();
      this.resetProgress();
    }
    return true;
  }

  clearTarget(): void {
    if (!this.target && this.path.length === 0) return;
    this.target = undefined;
    this.combatRange = undefined;
    this.goalId = undefined;
    this.finalApproach = 'none';
    this.combatTargetId = undefined;
    this.logicalRevision++;
    this.clearRoute();
  }

  hasTarget(): boolean {
    return !!this.target;
  }

  getTarget(): PathTarget | undefined {
    return this.target ? { ...this.target } : undefined;
  }

  getIntentRevisions(): PathfindingIntentRevisions {
    return {
      logicalRevision: this.logicalRevision,
      routeRevision: this.routeRevision,
    };
  }

  getEnemyRevision(): number {
    return 0;
  }

  getMapVersion(): number {
    return this.mapRevision;
  }

  getActivePathSearchStatus(): PathSearchStatus | undefined {
    return undefined;
  }

  getRemainingPath(): PathPoint[] {
    return this.path.map((point) => ({ ...point }));
  }

  getPlannedTiles(): PathPoint[] {
    return this.plannedTiles.map((point) => ({ ...point }));
  }

  observeTile(x: number, y: number, tileType: number): void {
    const before = this.staticPassability.getRevision();
    this.staticPassability.observeTile(x, y, tileType);
    if (before !== this.staticPassability.getRevision()) this.invalidate();
  }

  upsertObject(objectId: number, objectType: number, x: number, y: number): void {
    const before = this.staticPassability.getRevision();
    this.staticPassability.upsertObject(
      objectId,
      objectType,
      x,
      y,
      staticMovementProfile(this.data?.getObject(objectType)),
    );
    if (before !== this.staticPassability.getRevision()) this.invalidate();
  }

  removeObject(objectId: number): void {
    const before = this.staticPassability.getRevision();
    this.staticPassability.removeObject(objectId);
    if (before !== this.staticPassability.getRevision()) this.invalidate();
  }

  // ProdMafia Auto Play deliberately routes through ordinary enemy sprites.
  markEnemyThreat(_objectId: number): void {}

  next(position: PathPoint, _budget = PROD_MAFIA_PATH_SEARCH_BUDGET): PathfindingStep {
    const target = this.target;
    if (!target) return {};
    if (this.isYieldingToDodge()) return {};
    let replanned = false;
    const targetDistance = distance(position, target);
    if (this.combatRange) {
      if (!this.isDamagingGround(position.x, position.y)
        && targetDistance >= this.combatRange.minimumDistance
        && targetDistance <= this.combatRange.maximumDistance) {
        return this.finishTarget();
      }
    } else if (!this.isDamagingGround(position.x, position.y)
      && targetDistance <= target.threshold) {
      return this.finishTarget();
    }

    const routeIdentity = this.combatTargetId ?? this.goalId;
    const targetKey = routeIdentity !== undefined
      ? String(routeIdentity)
      : `${Math.trunc(target.x)},${Math.trunc(target.y)}`;
    if (!Number.isFinite(this.bestTargetDistance)) {
      this.bestTargetDistance = targetDistance;
      this.progressAt = this.runtimeTime;
    } else if (targetDistance + PATH_MIN_PROGRESS < this.bestTargetDistance) {
      this.bestTargetDistance = targetDistance;
      this.progressAt = this.runtimeTime;
      this.stuckCount = 0;
      this.wallEscapeDirectionX = 0;
      this.wallEscapeDirectionY = 0;
    } else if (this.runtimeTime - this.progressAt > PATH_PROGRESS_TIMEOUT_MS) {
      this.progressAt = this.runtimeTime;
      this.stuckCount++;
      const rejectCount = Math.min(this.path.length, this.stuckCount >= 2 ? 3 : 1);
      if (!this.isOryxCastle()) {
        for (let index = 0; index < rejectCount; index++) {
          const point = this.path[index]!;
          this.blocked.add(Math.trunc(point.x) + Math.trunc(point.y)
            * Math.max(1, this.staticPassability.getWidth()));
        }
      }
      this.clearRoute();
      this.lastPathBuild = 0;
      return {};
    }

    const committedWallEscape = this.plannedTargetKey === targetKey
      && this.wallEscapeTargetKey === targetKey
      && this.runtimeTime < this.wallEscapeUntil
      && this.path.length > 0;
    if (this.path.length === 0
      || this.plannedTargetKey !== targetKey
      || !committedWallEscape && this.runtimeTime - this.lastPathBuild >= 1000) {
      const raw = this.buildPath(
        Math.trunc(position.x),
        Math.trunc(position.y),
        Math.trunc(target.x),
        Math.trunc(target.y),
        this.allowWallEscape,
      );
      this.plannedTiles = raw.map((point) => ({ x: point.x + 0.5, y: point.y + 0.5 }));
      this.path = this.plannedTiles.map((point) => ({ ...point }));
      this.plannedMapRevision = this.mapRevision;
      this.plannedTargetKey = targetKey;
      this.lastPathBuild = this.runtimeTime;
      if (this.lastBuildWasWallEscape) {
        this.wallEscapeTargetKey = targetKey;
        this.wallEscapeUntil = this.runtimeTime + WALL_ESCAPE_HOLD_MS;
      } else {
        this.wallEscapeTargetKey = '';
        this.wallEscapeUntil = 0;
      }
      this.routeRevision++;
      replanned = true;
      if (this.path.length === 0) {
        const finalStep = this.finalApproachStep(position);
        return finalStep
          ? { ...finalStep, replanned: true }
          : { noPath: true, replanned: true };
      }
    }

    while (this.path.length > 0
      && squaredDistance(position.x, position.y, this.path[0]!.x, this.path[0]!.y)
        <= WAYPOINT_REACHED_SQUARED) {
      this.path.shift();
    }
    if (this.path.length === 0) {
      this.plannedMapRevision = -1;
      this.wallEscapeTargetKey = '';
      this.wallEscapeUntil = 0;
      return this.finalApproachStep(position) ?? { replanned: false };
    }
    const waypoint = this.path[0]!;
    if (!this.canTraverse(
      position.x,
      position.y,
      waypoint.x,
      waypoint.y,
      this.routeAllowsHazard,
    )) {
      if (this.allowWallEscape) {
        const tileX = Math.trunc(waypoint.x);
        const tileY = Math.trunc(waypoint.y);
        this.blocked.add(tileX + tileY * Math.max(1, this.staticPassability.getWidth()));
      }
      this.clearRoute();
      this.lastPathBuild = 0;
      this.wallEscapeTargetKey = '';
      this.wallEscapeUntil = 0;
      return {};
    }
    return {
      waypoint: { ...waypoint },
      waypointThreshold: INTERMEDIATE_THRESHOLD,
      replanned,
    };
  }

  reportStall(position: PathPoint): PathPoint | undefined {
    const next = this.path[0];
    if (!next) return undefined;
    const tileX = Math.trunc(next.x);
    const tileY = Math.trunc(next.y);
    const key = tileX + tileY * Math.max(1, this.staticPassability.getWidth());
    this.blocked.add(key);
    this.staticPassability.markLearnedBlocked(tileX, tileY);
    this.stuckCount++;
    this.progressAt = this.runtimeTime;
    this.clearRoute();
    return { x: tileX, y: tileY };
  }

  private finishTarget(): PathfindingStep {
    const reached = this.target ? { x: this.target.x, y: this.target.y } : undefined;
    this.clearTarget();
    return reached ? { reached } : {};
  }

  private finalApproachStep(position: PathPoint): PathfindingStep | undefined {
    const target = this.target;
    if (!target || this.finalApproach === 'none') return undefined;
    if (this.finalApproach === 'guarded') {
      const angle = Math.atan2(target.y - position.y, target.x - position.x);
      const distanceToTarget = distance(position, target);
      const probeDistance = Math.min(0.8, distanceToTarget);
      const probeX = position.x + Math.cos(angle) * probeDistance;
      const probeY = position.y + Math.sin(angle) * probeDistance;
      if (!this.canTraverse(position.x, position.y, probeX, probeY)) return undefined;
    }
    return {
      waypoint: { x: target.x, y: target.y },
      waypointThreshold: target.threshold,
    };
  }

  private buildPath(
    sx: number,
    sy: number,
    gx: number,
    gy: number,
    allowWallEscape = true,
  ): GridPoint[] {
    const dry = this.searchPath(sx, sy, gx, gy, allowWallEscape, 'block');
    let chosen = dry;
    let choseHazardRoute = false;
    if (!dry.reachedGoal && this.hazardEscalationEnabled) {
      const wet = this.searchPath(sx, sy, gx, gy, allowWallEscape, 'cost');
      if (wet.reachedGoal || wet.bestDistance < dry.bestDistance - 1e-9) {
        chosen = wet;
        choseHazardRoute = true;
      }
    }
    if (chosen.clearBlockedState) {
      this.blocked.clear();
      this.stuckCount = 0;
      this.wallEscapeReverseCount = 0;
    }
    this.lastBuildWasWallEscape = chosen.lastBuildWasWallEscape;
    if (chosen.lastBuildWasWallEscape) {
      this.wallEscapeDirectionX = chosen.wallEscapeDirectionX;
      this.wallEscapeDirectionY = chosen.wallEscapeDirectionY;
    } else {
      this.wallEscapeDirectionX = 0;
      this.wallEscapeDirectionY = 0;
    }
    this.hazardTraversal = 'block';
    this.routeAllowsHazard = choseHazardRoute;
    return chosen.path;
  }

  private searchPath(
    sx: number,
    sy: number,
    gx: number,
    gy: number,
    allowWallEscape: boolean,
    hazard: HazardTraversalPolicy,
  ): ProdMafiaPathBuildResult {
    const width = this.staticPassability.getWidth();
    const height = this.staticPassability.getHeight();
    this.hazardTraversal = hazard;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
      return emptyPathBuildResult(squaredDistance(sx, sy, gx, gy));
    }

    const startKey = sx + sy * width;
    const parent = new Map<number, number>();
    const bestG = new Map<number, number>([[startKey, 0]]);
    // Tier one keeps ProdMafia's FIFO BFS. Tier two is Dijkstra so lava damage
    // and sink/slow penalties order hazardous crossings.
    const useCosts = hazard === 'cost';
    const queue: number[] = [startKey];
    let head = 0;
    let expanded = 0;
    let found = -1;
    let bestKey = startKey;
    let bestDistance = squaredDistance(sx, sy, gx, gy);
    let fallbackKey = startKey;
    let fallbackDistance = 0;
    let wallEscapeKey = startKey;
    let wallEscapeDistance = 0;
    let alignedWallEscapeKey = startKey;
    let alignedWallEscapeDistance = 0;
    const hasCommittedEscapeDirection = this.wallEscapeDirectionX * this.wallEscapeDirectionX
      + this.wallEscapeDirectionY * this.wallEscapeDirectionY > 0.25;
    const startingGoalDistance = bestDistance;
    const maxEscapeGoalRadius = Math.sqrt(startingGoalDistance) + 8;
    const maxEscapeGoalDistance = maxEscapeGoalRadius * maxEscapeGoalRadius;
    const startInFailedRegion = this.isFailedRouteRegion(sx + 0.5, sy + 0.5);
    // Linear-scan min heap of {g, key} for the cost tier. Maps are small
    // (≤2500 expansions); a binary heap would be overkill for that budget.
    const heap: Array<{ g: number; key: number }> = useCosts ? [{ g: 0, key: startKey }] : [];

    const popNext = (): { key: number; g: number } | undefined => {
      if (!useCosts) {
        if (head >= queue.length) return undefined;
        const key = queue[head++]!;
        return { key, g: bestG.get(key) ?? 0 };
      }
      while (heap.length > 0) {
        let bestIndex = 0;
        for (let i = 1; i < heap.length; i++) {
          if (heap[i]!.g < heap[bestIndex]!.g) bestIndex = i;
        }
        const next = heap[bestIndex]!;
        const last = heap.pop()!;
        if (bestIndex < heap.length) heap[bestIndex] = last;
        if (next.g === bestG.get(next.key)) return next;
      }
      return undefined;
    };

    while (expanded < EXPANSION_LIMIT) {
      const current = popNext();
      if (current === undefined) break;
      const currentKey = current.key;
      const currentG = current.g;
      const x = currentKey % width;
      const y = Math.trunc(currentKey / width);
      expanded++;

      const goalDistance = squaredDistance(x, y, gx, gy);
      if (goalDistance < bestDistance) {
        bestDistance = goalDistance;
        bestKey = currentKey;
      }
      const startDistance = squaredDistance(x, y, sx, sy);
      if (startDistance > fallbackDistance) {
        fallbackDistance = startDistance;
        fallbackKey = currentKey;
      }
      if (goalDistance <= maxEscapeGoalDistance && startDistance > wallEscapeDistance) {
        wallEscapeDistance = startDistance;
        wallEscapeKey = currentKey;
      }
      const escapeDx = x - sx;
      const escapeDy = y - sy;
      const escapeAlignment = escapeDx * this.wallEscapeDirectionX
        + escapeDy * this.wallEscapeDirectionY;
      if (goalDistance <= maxEscapeGoalDistance
        && (!hasCommittedEscapeDirection || escapeAlignment >= -0.001)
        && startDistance > alignedWallEscapeDistance) {
        alignedWallEscapeDistance = startDistance;
        alignedWallEscapeKey = currentKey;
      }
      if (Math.abs(x - gx) + Math.abs(y - gy) <= 1) {
        found = currentKey;
        break;
      }

      for (let index = 0; index < 8; index++) {
        const dx = DIR_X[index]!;
        const dy = DIR_Y[index]!;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const key = nx + ny * width;
        if (this.blocked.has(key)
          || !startInFailedRegion && this.isFailedRouteRegion(nx + 0.5, ny + 0.5)
          || !this.tileOccupable(nx, ny)) continue;
        if (dx !== 0 && dy !== 0
          && (!this.tileWalkable(x + dx, y) || !this.tileWalkable(x, y + dy))) {
          continue;
        }
        if (!this.canTraverse(x + 0.5, y + 0.5, nx + 0.5, ny + 0.5, hazard === 'cost')) {
          continue;
        }
        const stepG = currentG + STEP_COST
          + (useCosts ? this.staticPassability.getTileTraversalPenalty(nx, ny) : 0);
        const prior = bestG.get(key);
        if (prior !== undefined && prior <= stepG) continue;
        bestG.set(key, stepG);
        parent.set(key, currentKey);
        if (useCosts) heap.push({ g: stepG, key });
        else queue.push(key);
      }
    }

    let lastBuildWasWallEscape = false;
    let wallEscapeDirectionX = 0;
    let wallEscapeDirectionY = 0;
    const reachedGoal = found >= 0;

    if (found < 0) {
      if (allowWallEscape && this.stuckCount > 0 && wallEscapeKey !== startKey) {
        if (hasCommittedEscapeDirection && alignedWallEscapeKey !== startKey) {
          wallEscapeKey = alignedWallEscapeKey;
        }
        if (this.isOryxCastle()) {
          if (this.lastWallEscapeFrom === wallEscapeKey && this.lastWallEscapeTo === startKey) {
            this.wallEscapeReverseCount++;
          } else if (this.lastWallEscapeFrom !== startKey || this.lastWallEscapeTo !== wallEscapeKey) {
            this.wallEscapeReverseCount = 0;
          }
          this.lastWallEscapeFrom = startKey;
          this.lastWallEscapeTo = wallEscapeKey;
          if (this.wallEscapeReverseCount >= 2) {
            return {
              path: [],
              reachedGoal: false,
              bestDistance,
              lastBuildWasWallEscape: false,
              wallEscapeDirectionX: 0,
              wallEscapeDirectionY: 0,
              clearBlockedState: true,
            };
          }
        }
        found = wallEscapeKey;
        lastBuildWasWallEscape = true;
        const escapeX = wallEscapeKey % width;
        const escapeY = Math.trunc(wallEscapeKey / width);
        const selectedEscapeDx = escapeX - sx;
        const selectedEscapeDy = escapeY - sy;
        const selectedEscapeLength = Math.hypot(selectedEscapeDx, selectedEscapeDy);
        if (selectedEscapeLength > 0.001) {
          wallEscapeDirectionX = selectedEscapeDx / selectedEscapeLength;
          wallEscapeDirectionY = selectedEscapeDy / selectedEscapeLength;
        }
      } else {
        found = bestKey !== startKey
          ? bestKey
          : allowWallEscape && fallbackKey !== startKey ? fallbackKey : -1;
      }
    }
    if (found < 0) {
      return emptyPathBuildResult(bestDistance);
    }

    const result: GridPoint[] = [];
    let cursor = found;
    let guard = 0;
    while (cursor !== startKey && cursor >= 0 && guard++ < 512) {
      result.push({ x: cursor % width, y: Math.trunc(cursor / width) });
      cursor = parent.get(cursor) ?? -1;
    }
    result.reverse();
    return {
      path: result,
      reachedGoal,
      bestDistance,
      lastBuildWasWallEscape,
      wallEscapeDirectionX,
      wallEscapeDirectionY,
      clearBlockedState: false,
    };
  }

  private tileWalkable(x: number, y: number): boolean {
    // Pathfinding consumer: sink water is walkable; damaging ground follows
    // hazardTraversal. Dodge safeWalk is intentionally not used here — it also
    // rejects pure Sink, which would wall off Abyssal Sanctuary's dry floor.
    return this.staticPassability.getObservedTileType(x, y) !== undefined
      && !this.staticPassability.isTileStaticallyBlocked(x, y, {
        consumer: 'pathfinding',
        hazardTraversal: this.hazardTraversal,
      });
  }

  private tileOccupable(x: number, y: number): boolean {
    if (!this.tileWalkable(x, y)) return false;
    // Physical footprint only. Damaging/sink policy is owned by tileWalkable so
    // dodge safeWalk (which also avoids water) cannot wall Abyss again.
    return this.staticPassability.canOccupyAt(x + 0.5, y + 0.5, {
      consumer: 'dodge',
      safeWalk: false,
      checkFullOccupyNeighbors: true,
      allowUnknown: false,
    });
  }

  private canTraverse(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    allowHazardReentry = false,
  ): boolean {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.2));
    let reachedSafeGround = !this.isDamagingGround(fromX, fromY);
    let reachedOccupable = this.canPhysicallyOccupy(fromX, fromY);
    for (let step = 1; step <= steps; step++) {
      const ratio = step / steps;
      const sampleX = fromX + dx * ratio;
      const sampleY = fromY + dy * ratio;
      const damagingGround = this.isDamagingGround(sampleX, sampleY);
      // ProdMafia leave-but-not-reenter, unless the cost tier is pricing a crossing.
      if (damagingGround && reachedSafeGround && !allowHazardReentry) return false;
      if (!damagingGround) reachedSafeGround = true;
      const occupiable = this.canPhysicallyOccupy(sampleX, sampleY);
      if (!occupiable && reachedOccupable) return false;
      if (occupiable) reachedOccupable = true;
    }
    return reachedOccupable;
  }

  private canPhysicallyOccupy(x: number, y: number): boolean {
    return this.staticPassability.canOccupyAt(x, y, {
      consumer: 'dodge',
      safeWalk: false,
      checkFullOccupyNeighbors: true,
      allowUnknown: false,
    });
  }

  private clearRoute(): void {
    this.path = [];
    this.plannedTiles = [];
    this.plannedMapRevision = -1;
    this.plannedTargetKey = '';
    this.routeAllowsHazard = false;
    this.routeRevision++;
  }

  private invalidate(): void {
    this.mapRevision++;
  }

  private resetProgress(): void {
    this.progressAt = this.runtimeTime;
    this.bestTargetDistance = Infinity;
    this.stuckCount = 0;
    this.wallEscapeTargetKey = '';
    this.wallEscapeUntil = 0;
    this.wallEscapeDirectionX = 0;
    this.wallEscapeDirectionY = 0;
  }

  private isDamagingGround(x: number, y: number): boolean {
    const tileType = this.staticPassability.getObservedTileType(Math.floor(x), Math.floor(y));
    return tileType !== undefined && (this.data?.getTileDamage?.(tileType) ?? 0) > 0;
  }

  private isFailedRouteRegion(x: number, y: number): boolean {
    return this.failedRouteRegions.some((region) =>
      squaredDistance(x, y, region.x, region.y) <= region.radius * region.radius);
  }

  private isOryxCastle(): boolean {
    return this.mapName.toLowerCase().includes("oryx's castle");
  }
}

function emptyPathBuildResult(bestDistance: number): ProdMafiaPathBuildResult {
  return {
    path: [],
    reachedGoal: false,
    bestDistance,
    lastBuildWasWallEscape: false,
    wallEscapeDirectionX: 0,
    wallEscapeDirectionY: 0,
    clearBlockedState: false,
  };
}

function squaredDistance(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function distance(a: PathPoint, b: PathPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function sameRange(
  first: CombatPathfindingRange | undefined,
  second: CombatPathfindingRange,
): boolean {
  return !!first
    && first.minimumDistance === second.minimumDistance
    && first.preferredDistance === second.preferredDistance
    && first.maximumDistance === second.maximumDistance;
}
