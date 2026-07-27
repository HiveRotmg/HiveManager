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
import type { StaticPassabilityStore } from './static-passability-model';
import { createStaticPassabilityStore } from './static-passability-store';

export const PROD_MAFIA_MAX_LOCAL_GOAL_DISTANCE = 5;
export const PROD_MAFIA_PATH_SEARCH_BUDGET: PathSearchStepBudget = {
  maxNodes: 2500,
  maxMs: Number.POSITIVE_INFINITY,
};

const DIR_X = [1, -1, 0, 0, 1, 1, -1, -1] as const;
const DIR_Y = [0, 0, 1, -1, 1, -1, 1, -1] as const;
const EXPANSION_LIMIT = 2500;
const INTERMEDIATE_THRESHOLD = 0.25;

interface GridPoint {
  x: number;
  y: number;
}

/**
 * Direct TypeScript port of ProdMafia GameSprite.apBuildPath.
 *
 * It deliberately keeps ProdMafia's bounded breadth-first search, direction
 * order, cardinal-neighbor goal rule, no-corner-cutting rule, 0.2-tile segment
 * validation, closest-frontier fallback, and learned route-cell rejection.
 */
export class ProdMafiaPathfinder {
  private readonly staticPassability: StaticPassabilityStore;
  private target: PathTarget | undefined;
  private combatRange: CombatPathfindingRange | undefined;
  private goalId: DodgeMovementIntentId | undefined;
  private combatTargetId: number | undefined;
  private path: PathPoint[] = [];
  private plannedTiles: PathPoint[] = [];
  private blocked = new Set<number>();
  private logicalRevision = 0;
  private routeRevision = 0;
  private mapRevision = 0;
  private plannedMapRevision = -1;
  private plannedTargetKey = '';

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
    this.combatTargetId = undefined;
    this.path = [];
    this.plannedTiles = [];
    this.blocked.clear();
    this.logicalRevision++;
    this.routeRevision++;
    this.mapRevision++;
    this.plannedMapRevision = -1;
    this.plannedTargetKey = '';
  }

  setMapBounds(width: number, height: number): void {
    const before = this.staticPassability.getRevision();
    this.staticPassability.setMapBounds(width, height);
    if (before !== this.staticPassability.getRevision()) this.invalidate();
  }

  setTarget(target: PathPoint, threshold: number, goalId?: DodgeMovementIntentId): boolean {
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return false;
    const next = { x: target.x, y: target.y, threshold: Math.max(0, threshold) };
    const changed = !this.target
      || this.target.x !== next.x
      || this.target.y !== next.y
      || this.target.threshold !== next.threshold
      || this.goalId !== goalId
      || !!this.combatRange;
    this.target = next;
    this.combatRange = undefined;
    this.goalId = goalId;
    this.combatTargetId = undefined;
    if (changed) {
      this.logicalRevision++;
      this.clearRoute();
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
    if (changed) {
      this.logicalRevision++;
      this.clearRoute();
    }
    return true;
  }

  clearTarget(): void {
    if (!this.target && this.path.length === 0) return;
    this.target = undefined;
    this.combatRange = undefined;
    this.goalId = undefined;
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
    let replanned = false;
    const targetDistance = distance(position, target);
    if (this.combatRange) {
      if (targetDistance >= this.combatRange.minimumDistance
        && targetDistance <= this.combatRange.maximumDistance) {
        return this.finishTarget();
      }
    } else if (targetDistance <= target.threshold) {
      return this.finishTarget();
    }

    const targetKey = `${Math.trunc(target.x)},${Math.trunc(target.y)}:${this.combatTargetId ?? this.goalId ?? ''}`;
    if (this.path.length === 0
      || this.plannedMapRevision !== this.mapRevision
      || this.plannedTargetKey !== targetKey) {
      const raw = this.buildPath(
        Math.trunc(position.x),
        Math.trunc(position.y),
        Math.trunc(target.x),
        Math.trunc(target.y),
      );
      this.plannedTiles = raw.map((point) => ({ x: point.x + 0.5, y: point.y + 0.5 }));
      this.path = this.plannedTiles.map((point) => ({ ...point }));
      this.plannedMapRevision = this.mapRevision;
      this.plannedTargetKey = targetKey;
      this.routeRevision++;
      replanned = true;
      if (this.path.length === 0) return { noPath: true, replanned: true };
    }

    while (this.path.length > 0 && distance(position, this.path[0]!) <= INTERMEDIATE_THRESHOLD) {
      this.path.shift();
    }
    if (this.path.length === 0) {
      this.plannedMapRevision = -1;
      return { replanned: false };
    }
    return {
      waypoint: { ...this.path[0]! },
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
    this.clearRoute();
    return { x: tileX, y: tileY };
  }

  private finishTarget(): PathfindingStep {
    const reached = this.target ? { x: this.target.x, y: this.target.y } : undefined;
    this.clearTarget();
    return reached ? { reached } : {};
  }

  private buildPath(sx: number, sy: number, gx: number, gy: number): GridPoint[] {
    const width = this.staticPassability.getWidth();
    const height = this.staticPassability.getHeight();
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) return [];

    const startKey = sx + sy * width;
    const queue: number[] = [startKey];
    const seen = new Set<number>([startKey]);
    const parent = new Map<number, number>();
    let head = 0;
    let expanded = 0;
    let found = -1;
    let bestKey = startKey;
    let bestDistance = squaredDistance(sx, sy, gx, gy);
    let fallbackKey = startKey;
    let fallbackDistance = 0;

    while (head < queue.length && expanded < EXPANSION_LIMIT) {
      const currentKey = queue[head++]!;
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
        if (seen.has(key) || this.blocked.has(key) || !this.tileOccupable(nx, ny)) continue;
        if (dx !== 0 && dy !== 0
          && (!this.tileWalkable(x + dx, y) || !this.tileWalkable(x, y + dy))) {
          continue;
        }
        if (!this.canTraverse(x + 0.5, y + 0.5, nx + 0.5, ny + 0.5)) continue;
        seen.add(key);
        parent.set(key, currentKey);
        queue.push(key);
      }
    }

    if (found < 0) {
      found = bestKey !== startKey ? bestKey : fallbackKey !== startKey ? fallbackKey : -1;
    }
    if (found < 0) return [];

    const result: GridPoint[] = [];
    let cursor = found;
    let guard = 0;
    while (cursor !== startKey && cursor >= 0 && guard++ < 512) {
      result.push({ x: cursor % width, y: Math.trunc(cursor / width) });
      cursor = parent.get(cursor) ?? -1;
    }
    result.reverse();
    return result;
  }

  private tileWalkable(x: number, y: number): boolean {
    return this.staticPassability.getObservedTileType(x, y) !== undefined
      && !this.staticPassability.isTileStaticallyBlocked(x, y, {
        consumer: 'dodge',
        safeWalk: true,
      });
  }

  private tileOccupable(x: number, y: number): boolean {
    return this.staticPassability.canOccupyAt(x + 0.5, y + 0.5, {
      consumer: 'dodge',
      safeWalk: true,
      checkFullOccupyNeighbors: true,
      allowUnknown: false,
    });
  }

  private canTraverse(fromX: number, fromY: number, toX: number, toY: number): boolean {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.2));
    let reachedOccupable = this.canPhysicallyOccupy(fromX, fromY);
    for (let step = 1; step <= steps; step++) {
      const ratio = step / steps;
      const occupiable = this.canPhysicallyOccupy(fromX + dx * ratio, fromY + dy * ratio);
      if (!occupiable && reachedOccupable) return false;
      if (occupiable) reachedOccupable = true;
    }
    return reachedOccupable;
  }

  private canPhysicallyOccupy(x: number, y: number): boolean {
    return this.staticPassability.canOccupyAt(x, y, {
      consumer: 'dodge',
      safeWalk: true,
      checkFullOccupyNeighbors: true,
      allowUnknown: false,
    });
  }

  private clearRoute(): void {
    this.path = [];
    this.plannedTiles = [];
    this.plannedMapRevision = -1;
    this.plannedTargetKey = '';
    this.routeRevision++;
  }

  private invalidate(): void {
    this.mapRevision++;
    this.clearRoute();
  }
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
