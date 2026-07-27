/**
 * Shared static passability contract for Commit 4 (HiveManager pathfinder refactor).
 *
 * Step 4.1: types only. Implementation lands in 4.2; A* and dodge migration in 4.3/4.4.
 *
 * Scope: terrain, occupySquare/fullOccupy objects, learned blocks, map bounds,
 * and the navigation hazard-traversal cost (see {@link HazardTraversalPolicy}).
 * Out of scope: combat enemy exclusion zones (see enemy-clearance-overlay.ts),
 * projectile segment cover (DodgeCollisionWorld.isProjectilePathOpen).
 */

/** Integer tile coordinates on the map grid. */
export interface GridTile {
  x: number;
  y: number;
}

/** Fractional world position used by dodge sub-tile occupancy checks. */
export interface WorldPoint {
  x: number;
  y: number;
}

/**
 * Subsystems that currently disagree on unresolved-tile and damage handling.
 * Full dual-predicate wiring is Commit 4.5; the discriminator is scaffolded here.
 */
export type StaticPassabilityConsumer = 'pathfinding' | 'dodge';

/**
 * Passability semantics generation for cache invalidation (Commit 5.7).
 * Bump when inflation, overlay, segment validation, or other shared predicates change
 * so long-lived pathfinder no-path cache entries self-invalidate on upgrade/revert.
 */
export const PASSABILITY_SCHEMA_VERSION = 3;

/**
 * How a navigation query treats hazardous-but-walkable ground — `<MinDamage>` /
 * `<MaxDamage>` floors and `<Sink />` water/lava surfaces.
 *
 * - `block` (default): hazardous ground is impassable. This is the historical
 *   behavior and stays the default so no caller silently starts routing through
 *   lava.
 * - `cost`: hazardous ground is passable and {@link
 *   StaticPassabilityModel.getTileTraversalPenalty} reports what it costs.
 *
 * ProdMafia itself has no cost model: `GameSprite.apBuildPath` is an unweighted
 * breadth-first search and `Map.canOccupyForDodge(x, y, true)` rejects damaging
 * ground outright, so a route across lava simply does not exist there. `cost` is
 * therefore our own addition, used only as an escalation after a hazard-free
 * search has been proven impossible.
 */
export type HazardTraversalPolicy = 'block' | 'cost';

/** Optional store configuration (Commit 5.1+). */
export interface StaticPassabilityConfig {
  /** When true, apply Chebyshev obstacle/fullOccupy inflation on static queries. */
  useInflatedPassability?: boolean;
}

/** Tile/object definition hooks shared by pathfinding and dodge data providers. */
export interface StaticPassabilityDataProvider {
  tileIsBlockingWalk?(tileType: number): boolean;
  getTileDamage?(tileType: number): number | undefined;
  /**
   * `<Sink />` water/lava surfaces. Walkable in ProdMafia
   * (`Square.isWalkable()` ignores `sink_`), so this only participates in the
   * `safeWalk` avoidance policy alongside damaging ground.
   */
  tileIsSink?(tileType: number): boolean;
  /** `<Sinking />` quicksand/honey — walkable, but decays movement speed. */
  tileIsSinking?(tileType: number): boolean;
  /** `<Speed>` multiplier; 1 when the tile does not alter movement speed. */
  getTileSpeed?(tileType: number): number;
  /** ProdMafia `Player.as:4215` sinking decay at a given sink level. */
  getSinkingSpeedMultiplier?(tileType: number, sinkLevel: number): number;
  getObject?(objectType: number): StaticObjectPassabilityProfile | undefined;
}

/** Object flags that affect static geometry (not enemy proximity). */
export interface StaticObjectPassabilityProfile {
  occupySquare: boolean;
  fullOccupy?: boolean;
  enemyOccupySquare?: boolean;
}

/** Options for integer-tile static blockage queries (A* grid, segment tracing). */
export interface StaticTileQuery {
  /**
   * Which consumer rules apply for unknown tiles and damaging floors.
   * - pathfinding: unobserved tiles are walkable; damaging floors block unless
   *   {@link StaticTileQuery.hazardTraversal} is `cost`.
   * - dodge: unobserved tiles block unless explorativeUnknown; damaging floors
   *   and sink (water/lava) surfaces block only when safeWalk is set.
   */
  consumer: StaticPassabilityConsumer;
  /** When set, that tile is treated as open (start-cell exemption). */
  exemptTile?: GridTile;
  /**
   * Dodge consumer only. When true, prefer to keep the body off hazardous but
   * walkable ground — damaging floors and `<Sink />` water/lava surfaces.
   */
  safeWalk?: boolean;
  /**
   * Navigation-only hazard policy, defaulting to `block`. Setting `cost` makes
   * damaging floors and `<Sink />` surfaces passable for this query alone and
   * moves the decision onto {@link StaticPassabilityModel.getTileTraversalPenalty}.
   *
   * It overrides the damaging-ground and sink parts of {@link safeWalk} so the
   * two pathfinders can escalate without a second query flavor. Dodge never
   * passes it, so dodge semantics are untouched.
   */
  hazardTraversal?: HazardTraversalPolicy;
}

/** Options for fractional-position occupancy (dodge planner / local snapshots). */
export interface StaticOccupancyQuery extends StaticTileQuery {
  /**
   * When true (default for dodge), reject positions whose neighboring tiles contain
   * a fullOccupy object. Pathfinding uses integer tiles and does not need this.
   */
  checkFullOccupyNeighbors?: boolean;
  /** Overrides the global exploratory-unknown policy for physical movement. */
  allowUnknown?: boolean;
}

/**
 * Read-only static passability view.
 *
 * Current-function mapping (pre-extraction):
 *
 * | Planned method              | Current source                                      |
 * |-----------------------------|-----------------------------------------------------|
 * | getRevision()               | ExplorativePathfinder.getMapVersion()               |
 * |                             | DodgeCollisionWorld staticRevision (internal)       |
 * | getWidth()/getHeight()      | ExplorativePathfinder/DodgeCollisionWorld bounds    |
 * | inBounds()                  | ExplorativePathfinder.inBounds()                    |
 * |                             | DodgeCollisionWorld.inBounds()                      |
 * | isTileStaticallyBlocked()   | ExplorativePathfinder.isBlocked()                   |
 * |                             | (combat layer stays in pathfinder via isPathBlocked)|
 * | canOccupyAt()               | DodgeCollisionWorld.canOccupyStatic()               |
 * |                             | (enemy layer stays via canOccupy + enemyClearance)  |
 *
 * A* PathSearch and traceSegment call sites that use isPathBlocked today will keep
 * combat exclusions outside this model; only the isBlocked portion moves here.
 */
export interface StaticPassabilityModel {
  /**
   * Monotonic revision bumped by map reset, bounds, terrain, objects, learned blocks,
   * and explorativeUnknown toggles. Wired to PathSearch mapVersion today.
   */
  getRevision(): number;

  getWidth(): number;
  getHeight(): number;

  /** True when tile coordinates lie inside current map bounds. */
  inBounds(tileX: number, tileY: number): boolean;

  /**
   * Integer-tile static blockage: terrain, learned blocks, occupySquare objects.
   * Does not apply combat enemy exclusion (EnemyClearanceOverlay overlay).
   */
  isTileStaticallyBlocked(tileX: number, tileY: number, query: StaticTileQuery): boolean;

  /**
   * Fractional-position static occupancy including fullOccupy neighbor checks.
   * Does not apply enemy clearance (EnemyClearanceOverlay overlay).
   */
  canOccupyAt(x: number, y: number, query: StaticOccupancyQuery): boolean;

  /**
   * Whether unobserved in-bounds tiles are treated as walkable.
   * Pathfinding always behaves as true; dodge toggles via setExplorativeUnknown.
   */
  isExplorativeUnknown(): boolean;

  /** Observed tile type at integer coordinates; undefined when never observed. */
  getObservedTileType(tileX: number, tileY: number): number | undefined;

  /** True when an occupySquare object sits on the integer tile. */
  hasOccupySquareAt(tileX: number, tileY: number): boolean;

  /**
   * Extra traversal cost, in tile-steps, for entering this tile under
   * {@link HazardTraversalPolicy} `cost`. Zero for ordinary dry ground, so a
   * hazard-free route always beats a hazardous one of the same length.
   */
  getTileTraversalPenalty(tileX: number, tileY: number): number;

  /** Whether Commit 5.1 inflated passability is active on this store. */
  isInflatedPassabilityEnabled(): boolean;
}

/**
 * Incremental updates feeding the shared static model (Commit 4.2).
 *
 * Current-function mapping:
 *
 * | Planned method           | Current source                                   |
 * |--------------------------|--------------------------------------------------|
 * | reset()                  | ExplorativePathfinder.resetMap()                 |
 * |                          | DodgeCollisionWorld.reset() (static portion)     |
 * | setMapBounds()           | setMapBounds on both consumers                   |
 * | observeTile()            | observeTile on both consumers                    |
 * | markLearnedBlocked()     | ExplorativePathfinder.reportStall() cell learn   |
 * |                          | DodgeCollisionWorld.markBlocked()                |
 * | setExplorativeUnknown()  | DodgeCollisionWorld.setExplorativeUnknown()      |
 * | upsertObject()           | upsertObject object-block counts on both         |
 * | removeObject()           | removeObject on both                             |
 */
export interface StaticPassabilityMutator {
  reset(): void;
  setMapBounds(width: number, height: number): void;
  observeTile(x: number, y: number, tileType: number): void;
  /** Returns true when the learned block was newly recorded. */
  markLearnedBlocked(tileX: number, tileY: number): boolean;
  setExplorativeUnknown(enabled: boolean): void;
  upsertObject(
    objectId: number,
    objectType: number,
    x: number,
    y: number,
    profile: StaticObjectPassabilityProfile,
  ): void;
  removeObject(objectId: number): void;
}

/** Full shared model: queries plus incremental maintenance. */
export interface StaticPassabilityStore
  extends StaticPassabilityModel,
    StaticPassabilityMutator,
    StaticPassabilityDualPredicates,
    StaticOccupancyDualPredicates {}

/**
 * TEMPORARY SCAFFOLDING FOR COMMIT 5 — to be deleted.
 *
 * Side-by-side integer-tile predicates where A* and dodge still disagree.
 * Production call sites keep using isTileStaticallyBlocked(query); these exist
 * only for comparison, tests, and the Commit 5 unification work.
 *
 * Known disagreements:
 * - Unknown tiles: pathfinding walkable, dodge blocked unless explorativeUnknown.
 * - Damaging floors: pathfinding blocks unless hazardTraversal is `cost`; dodge
 *   blocks only when safeWalk.
 * - Start-cell exemption: caller passes exemptTile on both sides.
 */
export interface StaticPassabilityDualPredicates {
  isTileBlockedForPathfinding(tileX: number, tileY: number, exemptTile?: GridTile): boolean;
  isTileBlockedForDodge(
    tileX: number,
    tileY: number,
    options?: Pick<StaticTileQuery, 'exemptTile' | 'safeWalk'>,
  ): boolean;
}

/**
 * TEMPORARY SCAFFOLDING FOR COMMIT 5 — to be deleted.
 *
 * Side-by-side fractional-position occupancy predicates. Pathfinding uses integer
 * tiles only; dodge adds fullOccupy neighbor checks at sub-tile positions.
 */
export interface StaticOccupancyDualPredicates {
  canOccupyForPathfindingAt(x: number, y: number, exemptTile?: GridTile): boolean;
  canOccupyForDodgeAt(
    x: number,
    y: number,
    options?: Pick<StaticOccupancyQuery, 'exemptTile' | 'safeWalk'>,
  ): boolean;
}
