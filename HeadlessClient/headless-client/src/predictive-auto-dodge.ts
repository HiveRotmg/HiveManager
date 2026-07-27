import type { CombatProjectileSnapshot } from './combat-tracker';
import {
  cloneDodgeMovementIntent,
  type DodgeMovementIntent,
  type DodgeMovementIntentMode,
} from './dodge-movement-intent';
import {
  SpaceTimeDodgePlanner,
  type DeterministicDodgePlannerMetrics,
  type DodgePlannerMetrics,
  type DodgePlannerOptions,
  type DodgePlanningAoe,
  type DodgePlanningEnvironment,
  type DodgePlanningInput,
  type DodgePlanningResult,
  type DodgeReplanReason,
  type DodgeTrajectory,
  type TimedDodgeWaypoint,
} from './dodge-trajectory-planner';

export type {
  DeterministicDodgePlannerMetrics,
  DodgePlannerMetrics,
  DodgeTrajectory,
  TimedDodgeWaypoint,
} from './dodge-trajectory-planner';

export interface AutoDodgeOptions {
  /** Penalize positive XML floor damage while selecting local trajectories. */
  safeWalk?: boolean;
  /**
   * Validated planner tunables for the ProdMafia controller. Unset fields keep
   * ProdMafia's defaults; out-of-range values are clamped, not rejected. Typed
   * loosely here so `predictive-auto-dodge` does not depend on the ProdMafia
   * port's module.
   */
  config?: {
    projectileClearance?: number;
    aoeClearance?: number;
    lookAheadMs?: number;
    aoeLookAheadMs?: number;
    playerHitbox?: number;
    cornerLookAheadTiles?: number;
    cornerStrength?: number;
    shooterBackoffTiles?: number;
    reactionLeadMs?: number;
    manualInfluence?: number;
    hysteresisMs?: number;
  };
}

export interface AutoDodgePointBlankEmitter {
  objectId: number;
  x: number;
  y: number;
}

// `AutoDodgeAoeThreat` and `AutoDodgeEnvironment` used to exist here as empty
// extensions of `DodgePlanningAoe` and `DodgePlanningEnvironment` respectively.
// They created a naming fork with no semantic difference — consumers had to
// choose between structurally-identical types, and grepping for one name missed
// code using the other. Deleted for the LutherManager fork; use the
// `DodgePlanning*` names directly. Any historical caller compiles against the
// same shape via TypeScript's structural typing.

/** Internal trajectory-controller state; scripts select movement intent, not this state. */
export type DodgeSafetyState = 'normal' | 'evasive' | 'recovering';

export type DodgeReplanCause =
  | 'initial'
  | 'new_threat'
  | 'unsafe'
  | 'intent_changed'
  | 'route_changed'
  | 'drift'
  | 'expired'
  | 'better_plan'
  | 'correction'
  | 'periodic_refresh';

export interface AutoDodgeSnapshot {
  time: number;
  playerId: number;
  position: { x: number; y: number };
  /**
   * Time-aligned acknowledged position. ProdMafia scores this as a second
   * anchor that converges to the local position over 350 ms; it never fills
   * the space between the two positions.
   */
  serverPosition?: { x: number; y: number };
  /** True when Auto Play, rather than keyboard input, supplied the intent. */
  autonomousIntent?: boolean;
  /** Current bounded waypoint supplied by direct walking or global pathfinding. */
  goal?: { x: number; y: number; threshold?: number };
  /** Stable global/script intent; `goal` remains the current local route point. */
  movementIntent?: DodgeMovementIntent | null;
  routeRevision?: number;
  combatTargetPositionAt?: (timeOffsetMs: number) => { x: number; y: number };
  /** Maximum movement speed in tiles per millisecond. */
  moveSpeed: number;
  intentVelocity: { x: number; y: number };
  movementLeadMs: number;
  movementLocked?: boolean;
  projectiles: Iterable<CombatProjectileSnapshot>;
  aoes: readonly DodgePlanningAoe[];
  /** Projectile-capable quest bosses guarded by ProdMafia's 0.9-tile core. */
  pointBlankEmitters?: readonly AutoDodgePointBlankEmitter[];
  environment: DodgePlanningEnvironment;
}

export interface AutoDodgeState {
  enabled: boolean;
  overrideActive: boolean;
  velocity: { x: number; y: number };
  target: { x: number; y: number } | null;
  goal: { x: number; y: number } | null;
  /** Vectorized future route for diagnostics and viewer rendering. */
  path: Array<{ x: number; y: number }>;
  /** Full time-parameterized local plan followed by the movement controller. */
  trajectory: DodgeTrajectory | null;
  planRevision: number;
  planReused: boolean;
  /** Increments for every planner search, including searches that reuse a plan. */
  searchRevision: number;
  searchPerformed: boolean;
  planCommitted: boolean;
  replanCause: DodgeReplanCause | null;
  movementIntentMode: DodgeMovementIntentMode | null;
  safetyState: DodgeSafetyState;
  /** Scales only combat's soft too-far cost; hard safety remains fully enforced. */
  retreatPenaltyScale: number;
  lastReplanAt: number | null;
  replanReason: DodgeReplanReason | null;
  dangerRevision: number;
  threatCount: number;
  earliestImpactMs: number | null;
  selectedCandidate: number;
  speedScale: number;
  /** Magnitude of the commanded velocity in tiles per millisecond. */
  commandedSpeed: number;
  /** Signed velocity projected onto the selected intent direction, in tiles per millisecond. */
  progressSpeed: number;
  /** Heading of the first control in the committed plan, in radians. */
  firstControlHeading: number | null;
  /** Absolute heading change from the previously committed first control, in radians. */
  headingChange: number | null;
  committedScore: number | null;
  proposedScore: number | null;
  comparisonHorizonMs: number | null;
  movementTargetDistance: number;
  timeSinceLastMovementCommandMs: number | null;
  lookaheadRevision: number;
  lookaheadChanged: boolean;
  decision: string;
  /**
   * Deterministic subset of {@link DodgePlannerMetrics} — the three wall-clock
   * fields (`planningDurationMs`, `averagePlanningDurationMs`,
   * `worstPlanningDurationMs`) are excluded so two byte-identical replays
   * produce byte-identical AutoDodgeState. Live telemetry consumers (dodge
   * viewer, dashboards) should use {@link PredictiveAutoDodgeController.getPlannerMetrics}
   * instead, which still returns the full DodgePlannerMetrics.
   */
  plannerMetrics: DeterministicDodgePlannerMetrics;
  /**
   * The WINNING route's own evaluation, not an aggregate over all candidates.
   * `null` for planners that do not evaluate discrete routes.
   *
   * `earliestImpactMs` above is a minimum across every candidate, which describes
   * a route that was not taken; `route.impactMs` is the one actually commanded.
   */
  route: AutoDodgeRoute | null;
}

/** Per-route evaluation surfaced for diagnostics and tier-ordering tests. */
export interface AutoDodgeRoute {
  /** Milliseconds until a wall stops this route, or `null` if it never does. */
  blockMs: number | null;
  /** Furthest position the route actually reaches. */
  reachableX: number;
  reachableY: number;
  safe: boolean;
  /** Why the route was rejected, or `null` while it is still viable. */
  reason: string | null;
  expectedDamage: number;
  impactMs: number | null;
  groundExposureMs: number;
  /** Soft (planning) clearance: negative means a margin breach, not a hit. */
  minimumClearance: number;
  /** Accumulated soft risk across every threat channel. */
  risk: number;
  lethal: boolean;
  escapeOptions: number;
}

interface CommittedPlan {
  result: DodgePlanningResult;
  start: { x: number; y: number };
  goal: { x: number; y: number; threshold: number } | null;
  intent: DodgeMovementIntent | null;
  routeRevision: number;
}

const NORMAL_REPLAN_INTERVAL_MS = 100;
const URGENT_REPLAN_INTERVAL_MS = 40;
const MINIMUM_REMAINING_HORIZON_MS = 300;
const TRAJECTORY_DRIFT_TOLERANCE = 0.45;
const GOAL_CHANGE_TOLERANCE = 0.5;
const GOAL_DIRECTION_CHANGE_COSINE = Math.cos(12 * Math.PI / 180);
const RANGE_CHANGE_TOLERANCE = 0.05;
const PLAN_COMPARISON_HORIZON_MS = 350;
const COMMAND_LOOKAHEAD_MS = 60;
const PLAN_SCORE_ABSOLUTE_GAIN = 0.35;
const PLAN_SCORE_RELATIVE_GAIN = 0.08;
const VELOCITY_MATCH_TOLERANCE = 1e-6;
const EVASIVE_IMPACT_WINDOW_MS = 500;
const EVASIVE_RETREAT_RESPONSE_MS = 80;
const EVASIVE_INITIAL_RESPONSE_MS = 20;
const RECOVERY_RETREAT_RESPONSE_MS = 500;

/**
 * Schedules perception, planning, trajectory hysteresis, and receding-horizon
 * execution around the chronological `SpaceTimeDodgePlanner`.
 */
export class PredictiveAutoDodgeController {
  private readonly planner: SpaceTimeDodgePlanner;
  private enabled = false;
  private safeWalk = true;
  private committed: CommittedPlan | undefined;
  private planRevision = 0;
  private lastPlanAt = -Infinity;
  private lastUrgentPlanAt = -Infinity;
  private lastReplanAt: number | null = null;
  private lastEnvironmentRevision: number | undefined;
  private readonly projectileKeys = new Set<string>();
  private readonly aoeKeys = new Set<string>();
  private pendingProjectileUpdates = 0;
  private pendingDangerUpdates = 0;
  private dangerRevision = 0;
  private urgentReplanPending = false;
  private lastCommandVelocity = { x: 0, y: 0 };
  private safetyState: DodgeSafetyState = 'normal';
  private retreatPenaltyScale = 1;
  private dangerPressure = 0;
  private lastSafetyUpdateAt: number | null = null;
  private searchRevision = 0;
  private searchPerformed = false;
  private planCommitted = false;
  private replanCause: DodgeReplanCause | null = null;
  private committedScore: number | null = null;
  private proposedScore: number | null = null;
  private comparisonHorizonMs: number | null = null;
  private firstControlHeading: number | null = null;
  private headingChange: number | null = null;
  private lastLookaheadTarget: { x: number; y: number } | null = null;
  private lookaheadRevision = 0;
  private lastMovementCommandAt: number | null = null;
  private state: AutoDodgeState;

  constructor(plannerOptions: DodgePlannerOptions = {}) {
    this.planner = new SpaceTimeDodgePlanner(plannerOptions);
    this.state = emptyState(false, this.planner.getDeterministicMetrics());
  }

  setEnabled(enabled: boolean, options: AutoDodgeOptions = {}): void {
    this.enabled = enabled;
    if (options.safeWalk !== undefined) this.safeWalk = options.safeWalk;
    if (!enabled) this.reset();
    else this.state = { ...this.state, enabled: true };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  reset(): void {
    this.committed = undefined;
    this.planRevision = 0;
    this.lastPlanAt = -Infinity;
    this.lastUrgentPlanAt = -Infinity;
    this.lastReplanAt = null;
    this.lastEnvironmentRevision = undefined;
    this.projectileKeys.clear();
    this.aoeKeys.clear();
    this.pendingProjectileUpdates = 0;
    this.pendingDangerUpdates = 0;
    this.dangerRevision = 0;
    this.urgentReplanPending = false;
    this.lastCommandVelocity = { x: 0, y: 0 };
    this.safetyState = 'normal';
    this.retreatPenaltyScale = 1;
    this.dangerPressure = 0;
    this.lastSafetyUpdateAt = null;
    this.searchRevision = 0;
    this.searchPerformed = false;
    this.planCommitted = false;
    this.replanCause = null;
    this.committedScore = null;
    this.proposedScore = null;
    this.comparisonHorizonMs = null;
    this.firstControlHeading = null;
    this.headingChange = null;
    this.lastLookaheadTarget = null;
    this.lookaheadRevision = 0;
    this.lastMovementCommandAt = null;
    this.state = emptyState(this.enabled, this.planner.getDeterministicMetrics());
  }

  getState(): AutoDodgeState {
    return cloneState(this.state);
  }

  getPlannerMetrics(): DodgePlannerMetrics {
    return this.planner.getMetrics();
  }

  /** Marks one or more newly tracked shots without starting a search in the packet handler. */
  noteProjectileUpdate(count = 1): void {
    this.pendingProjectileUpdates += Math.max(1, Math.trunc(count));
  }

  /** Marks an AOE or other time-varying danger update for the next local-frame observation. */
  noteDangerUpdate(count = 1): void {
    this.pendingDangerUpdates += Math.max(1, Math.trunc(count));
  }

  /** Discards all coordinates after an authoritative correction or teleport. */
  rebase(_position: { x: number; y: number }, time: number): void {
    if (this.committed) this.planner.recordTrajectoryInvalidation();
    this.committed = undefined;
    this.lastPlanAt = -Infinity;
    this.lastUrgentPlanAt = Math.min(this.lastUrgentPlanAt, time - URGENT_REPLAN_INTERVAL_MS);
    this.urgentReplanPending = false;
    this.lastCommandVelocity = { x: 0, y: 0 };
    this.firstControlHeading = null;
    this.headingChange = null;
    this.lastLookaheadTarget = null;
    this.replanCause = 'correction';
    this.state = {
      ...emptyState(this.enabled, this.planner.getDeterministicMetrics()),
      planRevision: this.planRevision,
      searchRevision: this.searchRevision,
      lastReplanAt: this.lastReplanAt,
      dangerRevision: this.dangerRevision,
      replanCause: 'correction',
      decision: 'authoritative_rebase',
    };
  }

  evaluate(snapshot: AutoDodgeSnapshot): AutoDodgeState {
    this.beginEvaluation();
    if (!this.enabled) {
      this.state = emptyState(false, this.planner.getDeterministicMetrics(), snapshot.intentVelocity);
      return this.state;
    }

    const projectiles = [...snapshot.projectiles];
    const dangerChanged = this.observeDanger(snapshot, projectiles);
    const environmentRevision = snapshot.environment.getRevision?.();
    const environmentChanged = environmentRevision !== undefined
      && this.lastEnvironmentRevision !== undefined
      && environmentRevision !== this.lastEnvironmentRevision;
    this.lastEnvironmentRevision = environmentRevision;
    const goal = normalizedGoal(snapshot.goal);
    const intent = normalizedMovementIntent(snapshot, goal);
    const intentChanged = !sameMovementIntent(intent, this.committed?.intent ?? null, snapshot.position);
    const routeRevision = snapshot.routeRevision ?? 0;
    const routeChanged = !!this.committed && routeRevision !== this.committed.routeRevision;
    this.advanceSafetyState(snapshot.time, intent, snapshot.position);
    if (dangerChanged && projectiles.length === 0 && snapshot.aoes.length === 0) {
      this.setDangerPressure(0, snapshot.time);
    }

    if (snapshot.movementLocked || snapshot.moveSpeed <= 0) {
      if (this.committed) this.planner.recordTrajectoryInvalidation();
      this.committed = undefined;
      this.lastCommandVelocity = { x: 0, y: 0 };
      return this.finish(snapshot, goal, {
        velocity: { x: 0, y: 0 },
        target: null,
        path: [],
        trajectory: null,
        overrideActive: false,
        planReused: false,
        replanReason: null,
        threatCount: projectiles.length + snapshot.aoes.length,
        earliestImpactMs: null,
        selectedCandidate: 0,
        decision: 'movement_locked',
      });
    }

    const hasMovementIntent = !!intent
      || Math.hypot(snapshot.intentVelocity.x, snapshot.intentVelocity.y) > VELOCITY_MATCH_TOLERANCE;
    if (!hasMovementIntent && projectiles.length === 0 && snapshot.aoes.length === 0) {
      this.committed = undefined;
      this.lastCommandVelocity = { x: 0, y: 0 };
      return this.finish(snapshot, goal, {
        velocity: { x: 0, y: 0 },
        target: null,
        path: [],
        trajectory: null,
        overrideActive: false,
        planReused: false,
        replanReason: null,
        threatCount: 0,
        earliestImpactMs: null,
        selectedCandidate: 0,
        decision: 'idle',
      });
    }

    const input: DodgePlanningInput = {
      time: snapshot.time,
      playerId: snapshot.playerId,
      position: { ...snapshot.position },
      goal: goal ?? undefined,
      intent,
      routeWaypoint: goal ?? undefined,
      preferredDirection: normalizedDirection(snapshot.intentVelocity),
      combatTargetPositionAt: snapshot.combatTargetPositionAt,
      retreatPenaltyScale: this.retreatPenaltyScale,
      moveSpeed: snapshot.moveSpeed,
      intentVelocity: { ...snapshot.intentVelocity },
      previousVelocity: this.committed
        ? { ...this.lastCommandVelocity }
        : { ...snapshot.intentVelocity },
      movementLeadMs: snapshot.movementLeadMs,
      projectiles,
      aoes: snapshot.aoes,
      environment: snapshot.environment,
      safeWalk: this.safeWalk,
    };

    let currentUnsafe = this.urgentReplanPending;
    let remainingMs = this.committed
      ? trajectoryRemainingMs(this.committed.result.trajectory, snapshot.time)
      : 0;
    let drifted = false;
    if (this.committed) {
      const expected = trajectoryPositionAt(
        this.committed.start,
        this.committed.result.trajectory,
        snapshot.time,
      );
      // A controlled-stop fallback has no moving trajectory to drift from. Its
      // start position can differ from a later authoritative position without
      // making the unchanged collision snapshot worth searching every frame.
      drifted = this.committed.result.fallback !== 'stop'
        && Math.hypot(expected.x - snapshot.position.x, expected.y - snapshot.position.y)
          > TRAJECTORY_DRIFT_TOLERANCE;
      if (dangerChanged || environmentChanged || drifted) {
        const assessment = this.planner.assessTrajectory(input, this.committed.result.trajectory);
        currentUnsafe = !assessment.safe;
        this.urgentReplanPending = currentUnsafe;
        remainingMs = assessment.remainingMs;
        if (currentUnsafe) {
          this.setDangerPressure(1, snapshot.time);
          input.retreatPenaltyScale = this.retreatPenaltyScale;
        }
        if (currentUnsafe || drifted) this.planner.recordTrajectoryInvalidation();
      }
    }

    let replanReason: DodgeReplanReason | null = null;
    let replanCause: DodgeReplanCause | null = null;
    const urgentDue = snapshot.time - this.lastUrgentPlanAt >= URGENT_REPLAN_INTERVAL_MS;
    const normalDue = snapshot.time - this.lastPlanAt >= NORMAL_REPLAN_INTERVAL_MS;
    if (!this.committed) {
      // A blocked local collision snapshot can legitimately produce no committed
      // trajectory. Do not search again on every local frame while that snapshot
      // is unchanged; doing so turns a controlled stop into a tight planner loop.
      const hasDanger = projectiles.length > 0 || snapshot.aoes.length > 0;
      if (hasDanger ? urgentDue : normalDue) {
        replanReason = hasDanger ? 'urgent' : 'normal';
        replanCause = 'initial';
      }
    } else if (currentUnsafe) {
      replanReason = urgentDue ? 'urgent' : null;
      if (replanReason) replanCause = dangerChanged ? 'new_threat' : 'unsafe';
    } else if (drifted) {
      replanReason = 'normal';
      replanCause = 'drift';
    } else if (intentChanged) {
      replanReason = 'normal';
      replanCause = 'intent_changed';
    } else if (routeChanged) {
      replanReason = 'normal';
      replanCause = 'route_changed';
    } else if (this.committed.result.fallback !== 'stop'
      && remainingMs <= MINIMUM_REMAINING_HORIZON_MS) {
      replanReason = 'normal';
      replanCause = 'expired';
    } else if (normalDue) {
      replanReason = 'normal';
      replanCause = 'periodic_refresh';
    }

    let planReused = !!this.committed;
    if (replanReason) {
      this.searchRevision++;
      this.searchPerformed = true;
      this.replanCause = replanCause;
      const proposed = this.planner.plan(input, replanReason);
      this.setDangerPressure(
        Math.max(
          currentUnsafe ? 1 : 0,
          planningDangerPressure(proposed, snapshot.aoes.length),
        ),
        snapshot.time,
      );
      this.lastPlanAt = snapshot.time;
      if (replanReason === 'urgent') this.lastUrgentPlanAt = snapshot.time;
      const proposedRemainingMs = trajectoryRemainingMs(proposed.trajectory, snapshot.time);
      const comparisonHorizonMs = Math.min(
        PLAN_COMPARISON_HORIZON_MS,
        remainingMs || proposedRemainingMs,
        proposedRemainingMs,
      );
      const currentComparable = this.committed
        ? this.planner.assessTrajectory(
            input,
            this.committed.result.trajectory,
            comparisonHorizonMs,
          )
        : undefined;
      const proposedComparable = this.planner.assessTrajectory(
        input,
        proposed.trajectory,
        comparisonHorizonMs,
      );
      this.committedScore = finiteComparisonScore(currentComparable?.score);
      this.proposedScore = finiteComparisonScore(proposedComparable.score);
      this.comparisonHorizonMs = proposedComparable.comparisonHorizonMs;
      if (currentComparable && !currentComparable.safe) currentUnsafe = true;
      const forceReplace = !this.committed
        || currentUnsafe
        || intentChanged
        || drifted
        || remainingMs <= MINIMUM_REMAINING_HORIZON_MS;
      const meaningfulGain = !!currentComparable
        && proposedComparable.safe
        && proposedComparable.score + PLAN_SCORE_ABSOLUTE_GAIN
          < currentComparable.score * (1 - PLAN_SCORE_RELATIVE_GAIN);
      const safeReplacement = !this.committed || proposedComparable.safe || currentUnsafe;
      if (safeReplacement && (forceReplace || meaningfulGain)) {
        const nextHeading = trajectoryFirstHeading(snapshot.position, proposed.trajectory);
        this.headingChange = headingDifference(this.firstControlHeading, nextHeading);
        this.firstControlHeading = nextHeading;
        this.committed = {
          result: proposed,
          start: { ...snapshot.position },
          goal,
          intent: cloneDodgeMovementIntent(intent),
          routeRevision,
        };
        this.planRevision++;
        this.lastReplanAt = snapshot.time;
        this.planCommitted = true;
        if (meaningfulGain && !forceReplace) this.replanCause = 'better_plan';
        planReused = false;
      } else if (routeChanged && this.committed) {
        // The updated route was searched and did not justify command churn.
        this.committed.routeRevision = routeRevision;
      }
      if (replanReason === 'urgent') {
        this.urgentReplanPending = !proposed.reachesHorizon
          && proposed.activeProjectileCount + snapshot.aoes.length > 0;
      }

    }

    const committed = this.committed;
    if (!committed) {
      this.lastCommandVelocity = { x: 0, y: 0 };
      return this.finish(snapshot, goal, {
        velocity: { x: 0, y: 0 },
        target: null,
        path: [],
        trajectory: null,
        overrideActive: !!intent,
        planReused,
        replanReason,
        threatCount: projectiles.length + snapshot.aoes.length,
        earliestImpactMs: null,
        selectedCandidate: 0,
        decision: intent ? `${intent.mode}_blocked` : 'controlled_stop',
      });
    }

    const velocity = trajectoryVelocityAt(committed.start, committed.result.trajectory, snapshot.time);
    const target = trajectoryPositionAt(
      committed.start,
      committed.result.trajectory,
      snapshot.time + COMMAND_LOOKAHEAD_MS,
    );
    const path = vectorizedRemainingPath(
      committed.start,
      committed.result.trajectory,
      snapshot.time,
      target,
    );
    const matchesIntent = Math.hypot(
      velocity.x - snapshot.intentVelocity.x,
      velocity.y - snapshot.intentVelocity.y,
    ) <= VELOCITY_MATCH_TOLERANCE;
    const earliestImpactMs = committed.result.earliestIntentCollisionMs ?? null;
    const overrideActive = !!intent || !matchesIntent || earliestImpactMs !== null;
    const commandVelocity = !overrideActive && matchesIntent
      ? { ...snapshot.intentVelocity }
      : velocity;
    this.lastCommandVelocity = { ...commandVelocity };
    const fallback = committed.result.fallback;
    const decision = fallback === 'stop'
      ? (intent ? `${intent.mode}_blocked` : 'controlled_stop')
      : fallback === 'least_risk' || fallback === 'partial'
        ? 'controlled_fallback'
        : overrideActive
          ? (intent?.mode === 'combat_range' ? 'combat_range_path'
            : intent ? 'goal_path' : 'dodge_trajectory')
          : 'preserve_safe_intent';

    return this.finish(snapshot, goal, {
      velocity: commandVelocity,
      target,
      path,
      trajectory: cloneTrajectory(committed.result.trajectory),
      overrideActive,
      planReused,
      replanReason,
      threatCount: committed.result.activeProjectileCount + snapshot.aoes.length,
      earliestImpactMs,
      selectedCandidate: committed.result.firstControl,
      decision,
    });
  }

  private observeDanger(
    snapshot: AutoDodgeSnapshot,
    projectiles: readonly CombatProjectileSnapshot[],
  ): boolean {
    const nextProjectileKeys = new Set<string>();
    for (const projectile of projectiles) {
      if (projectile.side !== 'enemy' || projectile.hitObjects.has(snapshot.playerId)) continue;
      nextProjectileKeys.add(projectileKey(projectile));
    }
    const nextAoeKeys = new Set(snapshot.aoes.map(aoeKey));
    const projectileSetChanged = !sameSet(this.projectileKeys, nextProjectileKeys);
    const aoeSetChanged = !sameSet(this.aoeKeys, nextAoeKeys);
    const updateCount = this.pendingProjectileUpdates + this.pendingDangerUpdates;
    const changed = projectileSetChanged || aoeSetChanged || updateCount > 0;
    if (changed) {
      this.dangerRevision++;
      this.planner.recordProjectileBatch(Math.max(updateCount, setDifferenceCount(
        this.projectileKeys,
        nextProjectileKeys,
      )));
      replaceSet(this.projectileKeys, nextProjectileKeys);
      replaceSet(this.aoeKeys, nextAoeKeys);
    }
    this.pendingProjectileUpdates = 0;
    this.pendingDangerUpdates = 0;
    return changed;
  }

  private beginEvaluation(): void {
    this.searchPerformed = false;
    this.planCommitted = false;
    this.replanCause = null;
    this.committedScore = null;
    this.proposedScore = null;
    this.comparisonHorizonMs = null;
  }

  private finish(
    snapshot: AutoDodgeSnapshot,
    goal: CommittedPlan['goal'],
    result: {
      velocity: { x: number; y: number };
      target: { x: number; y: number } | null;
      path: Array<{ x: number; y: number }>;
      trajectory: DodgeTrajectory | null;
      overrideActive: boolean;
      planReused: boolean;
      replanReason: DodgeReplanReason | null;
      threatCount: number;
      earliestImpactMs: number | null;
      selectedCandidate: number;
      decision: string;
    },
  ): AutoDodgeState {
    const lookaheadChanged = !sameOptionalPoint(this.lastLookaheadTarget, result.target);
    if (lookaheadChanged) {
      this.lookaheadRevision++;
      this.lastLookaheadTarget = result.target ? { ...result.target } : null;
    }
    if (result.target) this.lastMovementCommandAt = snapshot.time;
    const movementIntent = normalizedMovementIntent(snapshot, goal);
    const intentDirection = telemetryIntentDirection(
      movementIntent,
      snapshot.position,
      snapshot.intentVelocity,
    );
    const commandedSpeed = Math.hypot(result.velocity.x, result.velocity.y);
    this.state = {
      enabled: this.enabled,
      overrideActive: result.overrideActive,
      velocity: { ...result.velocity },
      target: result.target ? { ...result.target } : null,
      goal: goal ? { x: goal.x, y: goal.y } : null,
      path: result.path.map((point) => ({ ...point })),
      trajectory: result.trajectory ? cloneTrajectory(result.trajectory) : null,
      planRevision: this.planRevision,
      planReused: result.planReused,
      searchRevision: this.searchRevision,
      searchPerformed: this.searchPerformed,
      planCommitted: this.planCommitted,
      replanCause: this.replanCause,
      movementIntentMode: movementIntent?.mode ?? null,
      safetyState: this.safetyState,
      retreatPenaltyScale: this.retreatPenaltyScale,
      lastReplanAt: this.lastReplanAt,
      replanReason: result.replanReason,
      dangerRevision: this.dangerRevision,
      threatCount: result.threatCount,
      earliestImpactMs: result.earliestImpactMs,
      selectedCandidate: result.selectedCandidate,
      speedScale: snapshot.moveSpeed > 0
        ? commandedSpeed / snapshot.moveSpeed
        : 0,
      commandedSpeed,
      progressSpeed: intentDirection
        ? result.velocity.x * intentDirection.x + result.velocity.y * intentDirection.y
        : 0,
      firstControlHeading: this.firstControlHeading,
      headingChange: this.headingChange,
      committedScore: this.committedScore,
      proposedScore: this.proposedScore,
      comparisonHorizonMs: this.comparisonHorizonMs,
      movementTargetDistance: result.target
        ? Math.hypot(result.target.x - snapshot.position.x, result.target.y - snapshot.position.y)
        : 0,
      timeSinceLastMovementCommandMs: this.lastMovementCommandAt === null
        ? null
        : Math.max(0, snapshot.time - this.lastMovementCommandAt),
      lookaheadRevision: this.lookaheadRevision,
      lookaheadChanged,
      decision: result.decision,
      plannerMetrics: this.planner.getDeterministicMetrics(),
      route: null,
    };
    return this.state;
  }

  private advanceSafetyState(
    now: number,
    intent: DodgeMovementIntent | null,
    position: { x: number; y: number },
  ): void {
    const previousUpdate = this.lastSafetyUpdateAt;
    this.lastSafetyUpdateAt = now;
    if (previousUpdate === null) return;
    const elapsedMs = Math.max(0, now - previousUpdate);

    if (this.dangerPressure > 0) {
      this.safetyState = 'evasive';
      const targetScale = 1 - this.dangerPressure;
      const response = clamp(elapsedMs / EVASIVE_RETREAT_RESPONSE_MS, 0, 1);
      this.retreatPenaltyScale += (targetScale - this.retreatPenaltyScale) * response;
      return;
    }

    if (this.safetyState === 'evasive') this.safetyState = 'recovering';
    if (this.safetyState !== 'recovering') {
      this.retreatPenaltyScale = 1;
      return;
    }

    this.retreatPenaltyScale = Math.min(
      1,
      this.retreatPenaltyScale + elapsedMs / RECOVERY_RETREAT_RESPONSE_MS,
    );
    if (this.retreatPenaltyScale >= 1 && movementIntentSatisfied(intent, position)) {
      this.safetyState = 'normal';
    }
  }

  private setDangerPressure(pressure: number, now: number): void {
    const normalized = clamp(pressure, 0, 1);
    if (normalized > 0) {
      if (this.safetyState !== 'evasive') {
        const targetScale = 1 - normalized;
        const initialResponse = EVASIVE_INITIAL_RESPONSE_MS / EVASIVE_RETREAT_RESPONSE_MS;
        this.retreatPenaltyScale += (
          targetScale - this.retreatPenaltyScale
        ) * initialResponse;
      }
      this.safetyState = 'evasive';
    } else if (this.dangerPressure > 0 || this.safetyState === 'evasive') {
      this.safetyState = 'recovering';
    }
    this.dangerPressure = normalized;
    this.lastSafetyUpdateAt ??= now;
  }
}

export interface TrackedThrownAoe extends DodgePlanningAoe {
  id: number;
  effectType: number;
  source: 'predicted_throw' | 'authoritative_aoe';
  /**
   * Optional origin object type from the AOE packet. Used only by
   * {@link AoeRepeatObserver} known-cadence lookup (`Map.as:1179-1199`).
   */
  originType?: number;
  /** Condition effect id from the AOE packet, when present. */
  effect?: number;
  /**
   * `ThrownProjectile.persistentAoeWarning_` — dense legacy THROW barrage rings
   * (`Map.promoteDenseLegacyThrowCluster`). First-sighting repeating producer.
   */
  persistentWarning?: boolean;
  /** Condition set for ProdMafia condition-risk scoring. */
  conditionEffects?: readonly { effect: number; durationSec?: number }[];
}

/** `map.getRecentAoe*` retention record (`Map.as:1151-1159`). */
export interface TrackedRecentAoe {
  x: number;
  y: number;
  radius: number;
  until: number;
  damage: number;
  repeating: boolean;
  armorPiercing?: boolean;
  effect?: number;
  effectDurationSec?: number;
  originType?: number;
  conditionEffects?: readonly { effect: number; durationSec?: number }[];
}

/** `map.getTelegraphedAoe*` circle telegraph (`Map.as:1324-1355`). */
export interface TrackedTelegraphedAoe {
  x: number;
  y: number;
  radius: number;
  impactTime: number;
  until: number;
  targetId: number;
  effectType: number;
  sourceType: number;
  damage: number;
  armorPiercing: boolean;
}

/**
 * `Map.as:1080-1157` — observes authoritative AOE packets and decides whether a
 * location is an expected FUTURE pulse (`repeating`) rather than a finished
 * one-off. Without this, Auto Nexus under-charges repeating ground pulses and
 * over-charges finished explosions.
 *
 * Cadence rules, copied from LIVE `Map.as`:
 * - Same quarter-tile + radius + origin + damage + effect + color key
 * - `repeatCount >= 2` within [80, 1500] ms, OR a known first-pulse cadence
 * - `persistentWarning` / Barrage rings are repeating from the first sighting
 */
export class AoeRepeatObserver {
  static readonly IMPACT_GRACE_MS = 90;
  private static readonly REPEAT_MIN_INTERVAL_MS = 80;
  private static readonly REPEAT_MAX_INTERVAL_MS = 1500;
  private static readonly REPEAT_MAX_HOLD_MS = 750;
  private static readonly HARMLESS_DAMAGE_MAX = 15;

  private readonly lastImpact = new Map<string, number>();
  private readonly repeatCount = new Map<string, number>();

  clear(): void {
    this.lastImpact.clear();
    this.repeatCount.clear();
  }

  /**
   * Record one authoritative pulse. Returns whether the location is now
   * expected to pulse again (`Map.as:1108`) and the hold window for recent
   * retention (`Map.as:1117-1120`).
   */
  observe(input: {
    x: number;
    y: number;
    radius: number;
    time: number;
    damage?: number;
    effect?: number;
    originType?: number;
    color?: number;
    /** Legacy SHOW_EFFECT type-4 barrage warning (`ThrownProjectile.as:49`). */
    persistentWarning?: boolean;
  }): { repeating: boolean; holdMs: number; repeatCount: number } {
    if (input.persistentWarning === true) {
      return {
        repeating: true,
        holdMs: AoeRepeatObserver.REPEAT_MAX_HOLD_MS,
        repeatCount: 2,
      };
    }

    const damage = Math.trunc(input.damage ?? 0);
    const effect = Math.trunc(input.effect ?? 0);
    const originType = Math.trunc(input.originType ?? 0);
    const color = Math.trunc(input.color ?? 0);
    const key = [
      Math.floor(input.x * 4 + 0.5),
      Math.floor(input.y * 4 + 0.5),
      Math.floor(input.radius * 10 + 0.5),
      originType,
      damage,
      effect,
      color,
    ].join(':');

    const previousTime = this.lastImpact.get(key);
    let interval = 0;
    let repeatCount = 1;
    if (previousTime !== undefined) {
      interval = input.time - previousTime;
      repeatCount = this.repeatCount.get(key) ?? 1;
      if (
        interval >= AoeRepeatObserver.REPEAT_MIN_INTERVAL_MS
        && interval <= AoeRepeatObserver.REPEAT_MAX_INTERVAL_MS
      ) {
        repeatCount++;
      } else if (interval > AoeRepeatObserver.REPEAT_MAX_INTERVAL_MS) {
        repeatCount = 1;
      }
    }
    if (
      previousTime === undefined
      || interval >= AoeRepeatObserver.REPEAT_MIN_INTERVAL_MS
    ) {
      this.lastImpact.set(key, input.time);
    }
    this.repeatCount.set(key, repeatCount);

    let repeating = repeatCount >= 2;
    const knownInterval = knownAoeRepeatInterval(originType, effect, damage);
    if (knownInterval > 0) {
      repeating = true;
      if (interval < AoeRepeatObserver.REPEAT_MIN_INTERVAL_MS) {
        interval = knownInterval;
      }
    }

    let holdMs = AoeRepeatObserver.IMPACT_GRACE_MS;
    if (repeating && interval >= AoeRepeatObserver.REPEAT_MIN_INTERVAL_MS) {
      holdMs = Math.min(
        AoeRepeatObserver.REPEAT_MAX_HOLD_MS,
        Math.max(
          AoeRepeatObserver.IMPACT_GRACE_MS,
          interval + AoeRepeatObserver.IMPACT_GRACE_MS,
        ),
      );
    }
    return { repeating, holdMs, repeatCount };
  }

  /** `Map.isHarmlessAoeDamage` — scenery pulses never become danger circles. */
  static isHarmless(damage: number, effect: number): boolean {
    return damage >= 0
      && damage <= AoeRepeatObserver.HARMLESS_DAMAGE_MAX
      && effect === 0;
  }
}

/**
 * Packet-confirmed cadences from `Map.as:1179-1199`. A known interval marks
 * the first pulse as repeating so the player evacuates before taking two hits.
 */
function knownAoeRepeatInterval(
  originType: number,
  effect: number,
  damage: number,
): number {
  if (originType === 9827 && effect === 4 && damage === 100) return 610;
  if (originType === 51058 && damage === 40) return 1030;
  if (originType === 44924 && damage === 120) return 210;
  if (originType === 49436 && damage === 80) return 205;
  return 0;
}

const TELEGRAPH_AOE_GRACE_MS = 650;
const TELEGRAPH_AOE_MATCH_DISTANCE_SQ = 0.25;

function aoeConditionEffects(
  effect: number | undefined,
  durationSec: number | undefined,
): { effect: number; durationSec?: number }[] | undefined {
  const effectId = Math.trunc(effect ?? 0);
  if (effectId <= 0) return undefined;
  return [{ effect: effectId, durationSec: durationSec ?? 0 }];
}

/** Unified stream of predicted throws and authoritative dwelling AOE packets. */
export class DodgeAoeThreatTracker {
  private readonly threats: TrackedThrownAoe[] = [];
  private readonly recent: TrackedRecentAoe[] = [];
  private readonly telegraphs: TrackedTelegraphedAoe[] = [];
  private readonly learnedRadius = new Map<number, number>();
  private readonly learnedBlastDuration = new Map<number, number>();
  private readonly learnedDamage = new Map<number, number>();
  private readonly learnedArmorPiercing = new Map<number, boolean>();
  private readonly learnedEffect = new Map<number, number>();
  private readonly repeatObserver = new AoeRepeatObserver();
  private nextId = 1;

  clear(): void {
    this.threats.length = 0;
    this.recent.length = 0;
    this.telegraphs.length = 0;
    this.learnedRadius.clear();
    this.learnedBlastDuration.clear();
    this.learnedDamage.clear();
    this.learnedArmorPiercing.clear();
    this.learnedEffect.clear();
    this.repeatObserver.clear();
    this.nextId = 1;
  }

  track(
    effectType: number,
    end: { x: number; y: number },
    durationSeconds: number,
    now: number,
    blastDurationSeconds?: number,
    options?: { persistentWarning?: boolean; sourceType?: number },
  ): void {
    const durationMs = Math.max(0, durationSeconds * 1000);
    const normalizedType = effectType >>> 0;
    const learnedBlastMs = this.learnedBlastDuration.get(normalizedType);
    const explicitBlastMs = blastDurationSeconds !== undefined
      ? Math.max(0, blastDurationSeconds * 1000)
      : undefined;
    const persistentWarning = options?.persistentWarning === true;
    this.threats.push({
      id: this.nextId++,
      effectType: normalizedType,
      source: 'predicted_throw',
      originType: options?.sourceType,
      x: end.x,
      y: end.y,
      radius: this.learnedRadius.get(normalizedType) ?? 1,
      landingTime: now + durationMs,
      blastDurationMs: explicitBlastMs ?? learnedBlastMs,
      damage: this.learnedDamage.get(normalizedType),
      armorPiercing: this.learnedArmorPiercing.get(normalizedType),
      effect: this.learnedEffect.get(normalizedType),
      persistentWarning: persistentWarning || undefined,
      repeating: persistentWarning || undefined,
      conditionEffects: aoeConditionEffects(
        this.learnedEffect.get(normalizedType),
        undefined,
      ),
    });
  }

  /**
   * Holy/Chaos beam SHOW_EFFECT telegraphs (`Map.recordTelegraphedAoe`,
   * `GameServerConnectionConcrete.as:3514-3555`). Not THROW effects.
   */
  recordTelegraphedAoe(input: {
    x: number;
    y: number;
    radius: number;
    now: number;
    impactTime: number;
    targetId: number;
    effectType: number;
    sourceType: number;
    damage?: number;
    armorPiercing?: boolean;
  }): void {
    this.pruneTelegraphedAoes(input.now);
    const damage = input.damage !== undefined && Number.isFinite(input.damage)
      ? Math.trunc(input.damage)
      : -1;
    for (let index = this.telegraphs.length - 1; index >= 0; index--) {
      const existing = this.telegraphs[index]!;
      if (
        existing.targetId !== input.targetId
        || existing.effectType !== input.effectType
        || existing.sourceType !== input.sourceType
      ) {
        continue;
      }
      existing.x = input.x;
      existing.y = input.y;
      existing.radius = Math.max(0, input.radius);
      existing.impactTime = input.impactTime;
      existing.until = input.impactTime + TELEGRAPH_AOE_GRACE_MS;
      existing.damage = damage;
      existing.armorPiercing = input.armorPiercing === true;
      return;
    }
    this.telegraphs.push({
      x: input.x,
      y: input.y,
      radius: Math.max(0, input.radius),
      impactTime: input.impactTime,
      until: input.impactTime + TELEGRAPH_AOE_GRACE_MS,
      targetId: input.targetId,
      effectType: input.effectType,
      sourceType: input.sourceType,
      damage,
      armorPiercing: input.armorPiercing === true,
    });
    while (this.telegraphs.length > 256) {
      let evict = 0;
      for (let scan = 1; scan < this.telegraphs.length; scan++) {
        if (this.telegraphs[scan]!.until < this.telegraphs[evict]!.until) evict = scan;
      }
      this.telegraphs.splice(evict, 1);
    }
  }

  recordAoe(
    position: { x: number; y: number },
    radius: number,
    now: number,
    blastDurationSeconds?: number,
    damage?: number,
    armorPiercing?: boolean,
    originType = 0,
    effect = 0,
    color = 0,
  ): boolean {
    this.resolveTelegraphedAoe(position.x, position.y, now, originType);

    let best: TrackedThrownAoe | undefined;
    let bestDistance = 1;
    for (let index = 0; index < this.threats.length; index++) {
      const thrown = this.threats[index]!;
      if (thrown.source !== 'predicted_throw') continue;
      if (now < thrown.landingTime - 150 || now > thrown.landingTime + 750) continue;
      const distance = Math.hypot(position.x - thrown.x, position.y - thrown.y);
      if (distance > bestDistance) continue;
      bestDistance = distance;
      best = thrown;
    }
    const matchedPrediction = best !== undefined;
    const blastMs = blastDurationSeconds !== undefined
      ? Math.max(0, blastDurationSeconds * 1000)
      : 0;
    const effectId = Math.trunc(effect);
    const durationSec = blastDurationSeconds;
    if (!best) {
      best = this.threats.find((threat) => {
        return threat.source === 'authoritative_aoe'
          && Math.abs(threat.landingTime - now) <= 50
          && Math.hypot(position.x - threat.x, position.y - threat.y) <= 0.05
          && Math.abs(threat.radius - radius) <= 0.05;
      });
      if (!best && blastMs <= 0) {
        // Still retain recent/repeating circles even when there is no dwell and
        // no matching throw — Map.as always records recent AoEs.
        this.retainRecentAoe({
          x: position.x,
          y: position.y,
          radius,
          now,
          damage,
          armorPiercing,
          originType,
          effect: effectId,
          effectDurationSec: durationSec,
          color,
        });
        return false;
      }
      if (!best) {
        best = {
          id: this.nextId++,
          effectType: originType >>> 0,
          originType: originType >>> 0,
          source: 'authoritative_aoe',
          x: position.x,
          y: position.y,
          radius: Math.max(0, radius),
          landingTime: now,
          blastDurationMs: blastMs,
          damage: damage !== undefined && Number.isFinite(damage)
            ? Math.max(0, Math.trunc(damage))
            : undefined,
          armorPiercing: armorPiercing === undefined ? undefined : !!armorPiercing,
          effect: effectId > 0 ? effectId : undefined,
          conditionEffects: aoeConditionEffects(effectId, durationSec),
        };
        this.threats.push(best);
      }
    } else {
      this.learnedRadius.set(best.effectType, radius);
      best.source = 'authoritative_aoe';
      best.landingTime = now;
    }
    best.x = position.x;
    best.y = position.y;
    best.radius = Math.max(0, radius);
    best.originType = originType >>> 0;
    if (effectId > 0) {
      best.effect = effectId;
      if (best.effectType !== 0) this.learnedEffect.set(best.effectType, effectId);
    }
    best.conditionEffects = aoeConditionEffects(best.effect, durationSec);
    if (damage !== undefined && Number.isFinite(damage) && damage > 0) {
      const learnedDamage = Math.trunc(damage);
      if (best.effectType !== 0) this.learnedDamage.set(best.effectType, learnedDamage);
      best.damage = learnedDamage;
    }
    if (armorPiercing !== undefined) {
      if (best.effectType !== 0) {
        this.learnedArmorPiercing.set(best.effectType, !!armorPiercing);
      }
      best.armorPiercing = !!armorPiercing;
    }
    if (blastDurationSeconds !== undefined) {
      if (best.effectType !== 0) this.learnedBlastDuration.set(best.effectType, blastMs);
      best.blastDurationMs = blastMs;
    }
    // Map.as:1080-1157 — only an observed repeating location predicts future
    // damage. A one-off packet describes damage that already landed.
    const observed = this.repeatObserver.observe({
      x: best.x,
      y: best.y,
      radius: best.radius,
      time: now,
      damage: best.damage,
      effect: best.effect ?? effectId,
      originType: best.originType ?? best.effectType,
      color: color || best.effectType,
      persistentWarning: best.persistentWarning,
    });
    if (observed.repeating) best.repeating = true;
    // Stretch the dwell to the Map hold window so getActive keeps a repeating
    // crater visible long enough for the next pulse to be anticipated.
    if (observed.repeating) {
      best.blastDurationMs = Math.max(best.blastDurationMs ?? 0, observed.holdMs);
    }
    this.retainRecentAoe({
      x: best.x,
      y: best.y,
      radius: best.radius,
      now,
      damage: best.damage,
      armorPiercing: best.armorPiercing,
      originType: best.originType ?? originType,
      effect: best.effect ?? effectId,
      effectDurationSec: durationSec,
      color,
      repeating: observed.repeating,
      holdMs: observed.holdMs,
    });
    // Do NOT splice the matched throw here — leaving it in place lets
    // getActive() surface it to the planner during the dwell window (see
    // spec docs/superpowers/specs/2026-07-19-aoe-blast-dwell-rewrite-design.md
    // touchpoint 3). Post-dwell expiry happens in getActive() below.
    return matchedPrediction || blastMs > 0;
  }

  getActive(now: number): readonly TrackedThrownAoe[] {
    // Fresh array per call — the prior contract returned `this.active` (a
    // mutable buffer swapped on each call), so a caller retaining the array
    // across the next `getActive()` silently got a length-zero view when the
    // buffer was reset. `TrackedThrownAoe` is a flat primitive shape; shallow
    // clone plus a fresh array is cheap and avoids the retention footgun.
    const active: TrackedThrownAoe[] = [];
    for (let index = this.threats.length - 1; index >= 0; index--) {
      const thrown = this.threats[index]!;
      const dwellMs = thrown.blastDurationMs ?? 0;
      const expiresAt = thrown.landingTime + Math.max(750, dwellMs);
      if (now > expiresAt) {
        this.threats.splice(index, 1);
        continue;
      }
      if (thrown.effectType !== 0) {
        thrown.radius = this.learnedRadius.get(thrown.effectType) ?? thrown.radius;
        const learnedBlast = this.learnedBlastDuration.get(thrown.effectType);
        if (learnedBlast !== undefined) thrown.blastDurationMs = learnedBlast;
        thrown.damage = this.learnedDamage.get(thrown.effectType) ?? thrown.damage;
        thrown.armorPiercing = this.learnedArmorPiercing.get(thrown.effectType)
          ?? thrown.armorPiercing;
        thrown.effect = this.learnedEffect.get(thrown.effectType) ?? thrown.effect;
        thrown.conditionEffects = aoeConditionEffects(thrown.effect, undefined)
          ?? thrown.conditionEffects;
      }
      // Include pre-landing throws (existing behavior) AND during-dwell throws
      // (new for P3). Post-dwell throws are cleaned up above.
      if (now < thrown.landingTime + (thrown.blastDurationMs ?? 0)) {
        active.push({ ...thrown });
      }
    }
    return active;
  }

  /** Retained authoritative AOE circles (`map.getRecentAoe*`). */
  getRecentAoes(now: number): readonly TrackedRecentAoe[] {
    this.pruneRecentAoes(now);
    return this.recent.map((entry) => ({ ...entry }));
  }

  /** Holy/Chaos beam telegraphs still awaiting impact (`map.getTelegraphedAoe*`). */
  getTelegraphedAoes(now: number): readonly TrackedTelegraphedAoe[] {
    this.pruneTelegraphedAoes(now);
    return this.telegraphs.map((entry) => ({ ...entry }));
  }

  private retainRecentAoe(input: {
    x: number;
    y: number;
    radius: number;
    now: number;
    damage?: number;
    armorPiercing?: boolean;
    originType?: number;
    effect?: number;
    effectDurationSec?: number;
    color?: number;
    repeating?: boolean;
    holdMs?: number;
  }): void {
    const damage = Math.trunc(input.damage ?? 0);
    const effect = Math.trunc(input.effect ?? 0);

    let repeating = input.repeating;
    let holdMs = input.holdMs;
    if (repeating === undefined || holdMs === undefined) {
      const observed = this.repeatObserver.observe({
        x: input.x,
        y: input.y,
        radius: input.radius,
        time: input.now,
        damage,
        effect,
        originType: input.originType,
        color: input.color,
      });
      repeating = observed.repeating;
      holdMs = observed.holdMs;
    }

    // Harmless scenery still teaches cadence above, but never becomes a danger
    // circle (`Map.as:1143-1149`).
    if (AoeRepeatObserver.isHarmless(damage, effect)) return;

    this.pruneRecentAoes(input.now);
    this.recent.push({
      x: input.x,
      y: input.y,
      radius: Math.max(0, input.radius),
      until: input.now + (holdMs ?? AoeRepeatObserver.IMPACT_GRACE_MS),
      damage,
      repeating: repeating === true,
      armorPiercing: input.armorPiercing,
      effect: effect > 0 ? effect : undefined,
      effectDurationSec: input.effectDurationSec,
      originType: input.originType,
      conditionEffects: aoeConditionEffects(effect, input.effectDurationSec),
    });
  }

  private resolveTelegraphedAoe(
    x: number,
    y: number,
    now: number,
    originType: number,
  ): void {
    if (originType <= 0 || this.telegraphs.length === 0) return;
    this.pruneTelegraphedAoes(now);
    let bestIndex = -1;
    let bestDistanceSq = TELEGRAPH_AOE_MATCH_DISTANCE_SQ;
    for (let index = this.telegraphs.length - 1; index >= 0; index--) {
      const telegraph = this.telegraphs[index]!;
      if (telegraph.sourceType !== originType) continue;
      const dx = x - telegraph.x;
      const dy = y - telegraph.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq <= bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0) this.telegraphs.splice(bestIndex, 1);
  }

  private pruneTelegraphedAoes(now: number): void {
    for (let index = this.telegraphs.length - 1; index >= 0; index--) {
      if (now > this.telegraphs[index]!.until) this.telegraphs.splice(index, 1);
    }
  }

  private pruneRecentAoes(now: number): void {
    for (let index = this.recent.length - 1; index >= 0; index--) {
      if (now >= this.recent[index]!.until) this.recent.splice(index, 1);
    }
  }
}

/** Backward-compatible name for callers that only use thrown telegraphs. */
export class ThrownAoeTracker extends DodgeAoeThreatTracker {}

// ---------------------------------------------------------------------------
// Moving AoE emitters — source-specific live objects (`Map.as:3058-3278`).
// ---------------------------------------------------------------------------

const MOVING_AOE_MATCH_DISTANCE_SQ = 2.25;
const MOVING_AOE_DEFAULT_INTERVAL_MS = 610;
const MOVING_AOE_MIN_INTERVAL_MS = 80;
const MOVING_AOE_MAX_INTERVAL_MS = 5000;
const MOVING_AOE_PULSE_GRACE_MS = 90;
const MOVING_AOE_RETIRED_GRACE_MS = 800;

/** Object types whose live position is the pre-impact AoE geometry (`Map.as`). */
const MOVING_AOE_EMITTER_TYPES = new Set<number>([
  0xB01A, // O2_BOMB_ARTIFACT
  0xB096, // O2_BOMB_ARTIFACT_2
  0xB1DC, // O3_BOMB_ARTIFACT_H
  0xB1DD, // O3_BOMB_ARTIFACT_1
  0xB1DE, // O3_BOMB_ARTIFACT_2
  0xB1E9, // O3_BOMB_ARTIFACT
  0xB1DA, // O3_ORYX_PORTAL
  0x25A5, // O3_PORTAL_OFFENSIVE
  0x86AA, // BANESERPENT_IMPACT_TELEGRAPH
  0x871C, // BONE_TOWER_2
  0x871D, // BONE_TOWER_3
  0x366C, // HUDL_CONSTRUCT_COLOSSUS
  0x467C, // MAMMOTH_CITY_RAT_BOULDER
  0xC11C, // SMALL_KOGBOLD_3
  0xC092, // KSW_CRUSHER
  0xC458, // KSW_STEMWALKER_HARD
]);

interface MovingEmitterProfile {
  radius: number;
  damage: number;
  armorPiercing: boolean;
  effect: number;
  effectDurationSec: number;
  intervalMs: number;
  silenceTimeoutMs: number;
}

interface MovingEmitterState {
  objectId: number;
  objectType: number;
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  velocityX: number;
  velocityY: number;
  lastTime: number;
  radius: number;
  damage: number;
  armorPiercing: boolean;
  effect: number;
  effectDurationSec: number;
  intervalMs: number;
  silenceTimeoutMs: number;
  confirmed: boolean;
  lastImpact: number;
  nextImpact: number;
  pulseCount: number;
  firstSeen: number;
  retiredAt: number;
}

function movingEmitterProfile(objectType: number): MovingEmitterProfile {
  const profile: MovingEmitterProfile = {
    radius: 0,
    damage: -1,
    armorPiercing: false,
    effect: 0,
    effectDurationSec: 0,
    intervalMs: MOVING_AOE_DEFAULT_INTERVAL_MS,
    silenceTimeoutMs: 1800,
  };
  switch (objectType) {
    case 0xB01A:
    case 0xB096:
      profile.radius = 2.8;
      profile.damage = 180;
      profile.intervalMs = 410;
      profile.silenceTimeoutMs = 1500;
      break;
    case 0xB1DD:
    case 0xB1DE:
      profile.radius = 2;
      profile.damage = 200;
      break;
    case 0xB1E9:
      profile.radius = 1.75;
      profile.damage = 150;
      break;
    case 0xB1DC:
      profile.radius = 1.75;
      profile.damage = 210;
      profile.intervalMs = 410;
      profile.silenceTimeoutMs = 1200;
      break;
    case 0x86AA:
      profile.radius = 1.75;
      profile.damage = 170;
      profile.intervalMs = 410;
      profile.silenceTimeoutMs = 1200;
      break;
    case 0x467C:
      profile.radius = 1.5;
      profile.damage = 50;
      profile.armorPiercing = true;
      profile.effect = 16;
      profile.effectDurationSec = 2;
      profile.intervalMs = 410;
      profile.silenceTimeoutMs = 1200;
      break;
    case 0xB1DA:
    case 0x25A5:
      profile.intervalMs = 200;
      profile.silenceTimeoutMs = 1000;
      break;
    case 0x871C:
    case 0x871D:
      profile.intervalMs = 1220;
      profile.silenceTimeoutMs = 3000;
      break;
    case 0x366C:
      profile.intervalMs = 1010;
      profile.silenceTimeoutMs = 2500;
      break;
    case 0xC11C:
      profile.intervalMs = 200;
      profile.silenceTimeoutMs = 800;
      break;
    case 0xC458:
      profile.intervalMs = 200;
      profile.silenceTimeoutMs = 2000;
      break;
    case 0xC092:
      profile.intervalMs = 3000;
      profile.silenceTimeoutMs = 5000;
      break;
    default:
      break;
  }
  return profile;
}

function movingAoeNextInterval(originType: number, damage: number): number {
  switch (originType) {
    case 0xB01A:
    case 0xB096:
    case 0xB1DC:
    case 0x86AA:
    case 0x467C:
      return 410;
    case 0xB1DD:
    case 0xB1DE:
    case 0xB1E9:
      return 610;
    case 0xB1DA:
    case 0x25A5:
    case 0xC11C:
      return 200;
    case 0x871C:
    case 0x871D:
      return 1220;
    case 0x366C:
      return 1010;
    case 0xC092:
      return 3000;
    case 0xC458:
      if (damage === 120) return 400;
      if (damage >= 150) return 800;
      return 200;
    default:
      return 0;
  }
}

/**
 * Tracks source-specific moving bomb/portal objects whose next pulse is
 * predicted from live position + learned cadence (`MovingAoeEmitter.as`).
 *
 * Gap vs ProdMafia: headless objects have no `moveVec_` / `tickPosition_`, so
 * velocity is estimated from UPDATE/NEWTICK position deltas and projection is
 * capped to the last observed step rather than the current server-tick endpoint.
 */
export class MovingAoeEmitterTracker {
  private readonly emitters = new Map<number, MovingEmitterState>();

  clear(): void {
    this.emitters.clear();
  }

  static isEmitterType(objectType: number): boolean {
    return MOVING_AOE_EMITTER_TYPES.has(objectType >>> 0);
  }

  register(objectId: number, objectType: number, x: number, y: number, now: number): void {
    const type = objectType >>> 0;
    if (!MovingAoeEmitterTracker.isEmitterType(type) || this.emitters.has(objectId)) return;
    const profile = movingEmitterProfile(type);
    this.emitters.set(objectId, {
      objectId,
      objectType: type,
      x,
      y,
      previousX: x,
      previousY: y,
      velocityX: 0,
      velocityY: 0,
      lastTime: now,
      radius: profile.radius,
      damage: profile.damage,
      armorPiercing: profile.armorPiercing,
      effect: profile.effect,
      effectDurationSec: profile.effectDurationSec,
      intervalMs: profile.intervalMs,
      silenceTimeoutMs: profile.silenceTimeoutMs,
      confirmed: false,
      lastImpact: 0,
      nextImpact: 0,
      pulseCount: 0,
      firstSeen: now,
      retiredAt: -1,
    });
  }

  update(objectId: number, x: number, y: number, now: number): void {
    const emitter = this.emitters.get(objectId);
    if (!emitter || emitter.retiredAt >= 0) return;
    if (now !== emitter.lastTime || x !== emitter.x || y !== emitter.y) {
      const dt = Math.max(1, now - emitter.lastTime);
      emitter.previousX = emitter.x;
      emitter.previousY = emitter.y;
      emitter.velocityX = (x - emitter.x) / dt;
      emitter.velocityY = (y - emitter.y) / dt;
      emitter.x = x;
      emitter.y = y;
      emitter.lastTime = now;
    }
  }

  remove(objectId: number, now: number): void {
    const emitter = this.emitters.get(objectId);
    if (!emitter || emitter.retiredAt >= 0) return;
    emitter.retiredAt = now;
  }

  recordImpact(
    x: number,
    y: number,
    radius: number,
    now: number,
    damage: number,
    armorPiercing: boolean,
    effect: number,
    effectDurationSec: number,
    originType: number,
  ): boolean {
    if (!MovingAoeEmitterTracker.isEmitterType(originType)) return false;
    this.refresh(now);
    let best: MovingEmitterState | undefined;
    let bestDistanceSq = MOVING_AOE_MATCH_DISTANCE_SQ;
    for (const emitter of this.emitters.values()) {
      if (emitter.objectType !== originType || !this.isRetained(emitter, now)) continue;
      const distanceSq = this.distanceSqToTrajectory(emitter, x, y);
      if (distanceSq <= bestDistanceSq) {
        bestDistanceSq = distanceSq;
        best = emitter;
      }
    }
    if (!best) return false;

    if (best.lastImpact > 0) {
      const observedInterval = now - best.lastImpact;
      if (
        observedInterval >= MOVING_AOE_MIN_INTERVAL_MS
        && observedInterval <= MOVING_AOE_MAX_INTERVAL_MS
      ) {
        best.intervalMs = best.pulseCount <= 1
          ? observedInterval
          : Math.round(best.intervalMs * 0.7 + observedInterval * 0.3);
      }
    }
    best.radius = Math.max(0, radius);
    best.damage = Math.trunc(damage);
    best.armorPiercing = armorPiercing;
    best.effect = Math.trunc(effect);
    best.effectDurationSec = effectDurationSec;
    const nextInterval = movingAoeNextInterval(originType, best.damage);
    if (nextInterval > 0) {
      best.intervalMs = Math.max(
        MOVING_AOE_MIN_INTERVAL_MS,
        Math.min(MOVING_AOE_MAX_INTERVAL_MS, nextInterval),
      );
    }
    best.confirmed = true;
    best.lastImpact = now;
    best.pulseCount++;
    best.nextImpact = now + best.intervalMs;
    return true;
  }

  getActive(now: number): Array<{
    x: number;
    y: number;
    radius: number;
    impactOffsetMs: number;
    damage?: number;
    conditionEffects?: readonly { effect: number; durationSec?: number }[];
    objectId: number;
  }> {
    this.refresh(now);
    const active: Array<{
      x: number;
      y: number;
      radius: number;
      impactOffsetMs: number;
      damage?: number;
      conditionEffects?: readonly { effect: number; durationSec?: number }[];
      objectId: number;
    }> = [];
    for (const emitter of this.emitters.values()) {
      if (!this.isActive(emitter, now) || emitter.radius <= 0) continue;
      const impactOffsetMs = this.impactOffset(emitter, now);
      active.push({
        x: emitter.x + emitter.velocityX * impactOffsetMs,
        y: emitter.y + emitter.velocityY * impactOffsetMs,
        radius: emitter.radius,
        impactOffsetMs,
        damage: emitter.damage,
        conditionEffects: aoeConditionEffects(emitter.effect, emitter.effectDurationSec),
        objectId: emitter.objectId,
      });
    }
    return active;
  }

  private refresh(now: number): void {
    for (const [objectId, emitter] of this.emitters) {
      if (this.isRetained(emitter, now)) continue;
      this.emitters.delete(objectId);
    }
  }

  private isRetained(emitter: MovingEmitterState, now: number): boolean {
    if (emitter.firstSeen === 0) emitter.firstSeen = now;
    return emitter.retiredAt < 0
      || now - emitter.retiredAt <= MOVING_AOE_RETIRED_GRACE_MS;
  }

  private isActive(emitter: MovingEmitterState, now: number): boolean {
    if (!this.isRetained(emitter, now) || emitter.radius <= 0) return false;
    if (!emitter.confirmed) {
      let grace = emitter.intervalMs + MOVING_AOE_PULSE_GRACE_MS;
      if (emitter.silenceTimeoutMs > 0 && emitter.silenceTimeoutMs < grace) {
        grace = emitter.silenceTimeoutMs;
      }
      return now - emitter.firstSeen <= grace;
    }
    return emitter.silenceTimeoutMs <= 0
      || now - emitter.lastImpact <= emitter.silenceTimeoutMs;
  }

  private impactOffset(emitter: MovingEmitterState, now: number): number {
    if (!emitter.confirmed) return 0;
    let next = emitter.nextImpact > 0 ? emitter.nextImpact : now;
    if (next < now - MOVING_AOE_PULSE_GRACE_MS) {
      const interval = Math.max(MOVING_AOE_MIN_INTERVAL_MS, emitter.intervalMs);
      const missed = Math.trunc((now - MOVING_AOE_PULSE_GRACE_MS - next) / interval) + 1;
      next += missed * interval;
    }
    return Math.max(0, next - now);
  }

  private distanceSqToTrajectory(
    emitter: MovingEmitterState,
    x: number,
    y: number,
  ): number {
    return Math.min(
      pointToSegmentDistanceSq(
        x, y, emitter.previousX, emitter.previousY, emitter.x, emitter.y,
      ),
      pointToSegmentDistanceSq(
        x, y,
        emitter.x, emitter.y,
        emitter.x + emitter.velocityX * 250,
        emitter.y + emitter.velocityY * 250,
      ),
    );
  }
}

function pointToSegmentDistanceSq(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): number {
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const lengthSq = segmentX * segmentX + segmentY * segmentY;
  const scale = lengthSq > 1e-10
    ? Math.max(0, Math.min(1, ((pointX - startX) * segmentX + (pointY - startY) * segmentY) / lengthSq))
    : 0;
  const dx = pointX - (startX + segmentX * scale);
  const dy = pointY - (startY + segmentY * scale);
  return dx * dx + dy * dy;
}

// ---------------------------------------------------------------------------
// Holy/Chaos beam SHOW_EFFECT → telegraphed circle (`GSCC.as:3644-3717`).
// ---------------------------------------------------------------------------

const BEAM_AOE_WARNING_MS = 100;
const O3_HOLY_BEAM_WARNING_MS = 200;
const O3_CLERIC_BEAM_STRIKE = 0x1AF3;
const O3_CARDINAL_BEAM_STRIKE = 0x1AF6;
const O3_DEACON_BEAM_STRIKE = 0xB22F;
const O3_BEAM_STRIKE = 0xB418;
const O2_VISUAL_BEAM = 0x6E28;
const CHAOTIC_SCRIPTURE_EFFECT = 0x70A4;
const SANGUINE_FOREST_BEAM = 0xCF1B;
const O3_CHAOS_RAY_STRIKE = 0x19DD;
const O3_CHAOS_RAY_STRIKE_MINOR = 0x19DC;

/** Source-specific beam radius; 0 means non-hostile visual reuse. */
export function beamAoeRadius(sourceType: number): number {
  switch (sourceType >>> 0) {
    case O2_VISUAL_BEAM:
    case CHAOTIC_SCRIPTURE_EFFECT:
      return 0;
    case O3_CARDINAL_BEAM_STRIKE:
      return 2.5;
    case SANGUINE_FOREST_BEAM:
    case O3_CHAOS_RAY_STRIKE:
    case O3_CHAOS_RAY_STRIKE_MINOR:
      return 1;
    default:
      return 1.4;
  }
}

export function beamAoeDamage(sourceType: number): number {
  switch (sourceType >>> 0) {
    case O3_CLERIC_BEAM_STRIKE:
    case O3_CARDINAL_BEAM_STRIKE:
    case O3_DEACON_BEAM_STRIKE:
    case O3_BEAM_STRIKE:
      return 200;
    case O3_CHAOS_RAY_STRIKE:
      return 325;
    case O3_CHAOS_RAY_STRIKE_MINOR:
      return 300;
    case SANGUINE_FOREST_BEAM:
      return 120;
    default:
      return -1;
  }
}

export function beamAoeArmorPiercing(sourceType: number): boolean {
  const type = sourceType >>> 0;
  return type === O3_CLERIC_BEAM_STRIKE
    || type === O3_CARDINAL_BEAM_STRIKE
    || type === O3_DEACON_BEAM_STRIKE
    || type === O3_BEAM_STRIKE
    || type === O3_CHAOS_RAY_STRIKE
    || type === O3_CHAOS_RAY_STRIKE_MINOR
    || type === SANGUINE_FOREST_BEAM;
}

export function beamAoeWarningMs(sourceType: number): number {
  switch (sourceType >>> 0) {
    case SANGUINE_FOREST_BEAM:
    case O3_CHAOS_RAY_STRIKE:
    case O3_CHAOS_RAY_STRIKE_MINOR:
      return 0;
    case O3_CLERIC_BEAM_STRIKE:
    case O3_CARDINAL_BEAM_STRIKE:
    case O3_DEACON_BEAM_STRIKE:
    case O3_BEAM_STRIKE:
      return O3_HOLY_BEAM_WARNING_MS;
    default:
      return BEAM_AOE_WARNING_MS;
  }
}

function emptyState(
  enabled: boolean,
  metrics: DeterministicDodgePlannerMetrics,
  velocity = { x: 0, y: 0 },
): AutoDodgeState {
  return {
    enabled,
    overrideActive: false,
    velocity: { ...velocity },
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
    speedScale: 1,
    commandedSpeed: Math.hypot(velocity.x, velocity.y),
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
    decision: 'none',
    plannerMetrics: cloneMetrics(metrics),
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
    trajectory: state.trajectory ? cloneTrajectory(state.trajectory) : null,
    plannerMetrics: cloneMetrics(state.plannerMetrics),
  };
}

function cloneMetrics(
  metrics: DeterministicDodgePlannerMetrics,
): DeterministicDodgePlannerMetrics {
  return { ...metrics, statesEnteringLayers: [...metrics.statesEnteringLayers] };
}

function cloneTrajectory(trajectory: DodgeTrajectory): DodgeTrajectory {
  return {
    createdAt: trajectory.createdAt,
    waypoints: trajectory.waypoints.map((waypoint) => ({ ...waypoint })),
  };
}

function trajectoryFirstHeading(
  start: { x: number; y: number },
  trajectory: DodgeTrajectory,
): number | null {
  let previous = start;
  for (const waypoint of trajectory.waypoints) {
    const dx = waypoint.x - previous.x;
    const dy = waypoint.y - previous.y;
    if (Math.hypot(dx, dy) > 1e-9) return Math.atan2(dy, dx);
    previous = waypoint;
  }
  return null;
}

function headingDifference(previous: number | null, next: number | null): number | null {
  if (previous === null || next === null) return null;
  const wrapped = Math.atan2(Math.sin(next - previous), Math.cos(next - previous));
  return Math.abs(wrapped);
}

function finiteComparisonScore(score: number | undefined): number | null {
  return Number.isFinite(score) ? Number(score) : null;
}

function planningDangerPressure(result: DodgePlanningResult, activeAoes: number): number {
  if (!result.reachesHorizon && result.activeProjectileCount + activeAoes > 0) return 1;
  const impactMs = result.earliestIntentCollisionMs;
  if (impactMs === null || impactMs === undefined) return 0;
  return clamp((EVASIVE_IMPACT_WINDOW_MS - impactMs) / EVASIVE_IMPACT_WINDOW_MS, 0, 1);
}

function movementIntentSatisfied(
  intent: DodgeMovementIntent | null,
  position: { x: number; y: number },
): boolean {
  if (intent?.mode !== 'combat_range') return true;
  const distance = Math.hypot(position.x - intent.targetX, position.y - intent.targetY);
  return distance >= intent.preferredMinimumRange - 1e-6
    && distance <= intent.preferredMaximumRange + 1e-6;
}

function trajectoryRemainingMs(trajectory: DodgeTrajectory, now: number): number {
  const end = trajectory.waypoints[trajectory.waypoints.length - 1]?.timeOffsetMs ?? 0;
  return Math.max(0, trajectory.createdAt + end - now);
}

function trajectoryPositionAt(
  start: { x: number; y: number },
  trajectory: DodgeTrajectory,
  absoluteTime: number,
): { x: number; y: number } {
  const elapsed = absoluteTime - trajectory.createdAt;
  if (elapsed <= 0 || trajectory.waypoints.length === 0) return { ...start };
  let previous: { x: number; y: number; timeOffsetMs: number } = {
    ...start,
    timeOffsetMs: 0,
  };
  for (const waypoint of trajectory.waypoints) {
    if (elapsed <= waypoint.timeOffsetMs) {
      const duration = waypoint.timeOffsetMs - previous.timeOffsetMs;
      const ratio = duration <= 0 ? 1 : clamp((elapsed - previous.timeOffsetMs) / duration, 0, 1);
      return {
        x: previous.x + (waypoint.x - previous.x) * ratio,
        y: previous.y + (waypoint.y - previous.y) * ratio,
      };
    }
    previous = waypoint;
  }
  return { x: previous.x, y: previous.y };
}

function trajectoryVelocityAt(
  start: { x: number; y: number },
  trajectory: DodgeTrajectory,
  absoluteTime: number,
): { x: number; y: number } {
  const elapsed = absoluteTime - trajectory.createdAt;
  let previous: { x: number; y: number; timeOffsetMs: number } = {
    ...start,
    timeOffsetMs: 0,
  };
  for (const waypoint of trajectory.waypoints) {
    if (elapsed < waypoint.timeOffsetMs - 1e-9) {
      const duration = waypoint.timeOffsetMs - previous.timeOffsetMs;
      return duration <= 0
        ? { x: 0, y: 0 }
        : {
            x: (waypoint.x - previous.x) / duration,
            y: (waypoint.y - previous.y) / duration,
          };
    }
    previous = waypoint;
  }
  return { x: 0, y: 0 };
}

function vectorizedRemainingPath(
  start: { x: number; y: number },
  trajectory: DodgeTrajectory,
  now: number,
  lookahead: { x: number; y: number },
): Array<{ x: number; y: number }> {
  const elapsed = now - trajectory.createdAt;
  const points = [lookahead, ...trajectory.waypoints
    .filter((waypoint) => waypoint.timeOffsetMs > elapsed + COMMAND_LOOKAHEAD_MS)
    .map((waypoint) => ({ x: waypoint.x, y: waypoint.y }))];
  if (points.length <= 1) return points;
  const output: Array<{ x: number; y: number }> = [{ ...points[0]! }];
  let previousPoint = start;
  let previousDirection: { x: number; y: number } | undefined;
  for (const point of points) {
    const dx = point.x - previousPoint.x;
    const dy = point.y - previousPoint.y;
    const length = Math.hypot(dx, dy);
    if (length > 1e-6) {
      const direction = { x: dx / length, y: dy / length };
      if (previousDirection
        && previousDirection.x * direction.x + previousDirection.y * direction.y < 0.9995) {
        appendDistinct(output, previousPoint);
      }
      previousDirection = direction;
    }
    previousPoint = point;
  }
  appendDistinct(output, points[points.length - 1]!);
  return output;
}

function appendDistinct(
  points: Array<{ x: number; y: number }>,
  point: { x: number; y: number },
): void {
  const previous = points[points.length - 1];
  if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > 1e-6) {
    points.push({ ...point });
  }
}

function normalizedGoal(goal: AutoDodgeSnapshot['goal']): CommittedPlan['goal'] {
  if (!goal || !Number.isFinite(goal.x) || !Number.isFinite(goal.y)) return null;
  return {
    x: goal.x,
    y: goal.y,
    threshold: Number.isFinite(goal.threshold) ? Math.max(0, Number(goal.threshold)) : 0,
  };
}

function normalizedMovementIntent(
  snapshot: AutoDodgeSnapshot,
  fallbackGoal: CommittedPlan['goal'],
): DodgeMovementIntent | null {
  if (snapshot.movementIntent) return cloneDodgeMovementIntent(snapshot.movementIntent);
  if (!fallbackGoal) return null;
  return {
    mode: 'goal',
    goalX: fallbackGoal.x,
    goalY: fallbackGoal.y,
    arriveThreshold: fallbackGoal.threshold,
  };
}

function sameMovementIntent(
  a: DodgeMovementIntent | null,
  b: DodgeMovementIntent | null,
  position: { x: number; y: number },
): boolean {
  if (!a || !b) return a === b;
  if (a.mode !== b.mode) return false;
  if (a.mode === 'goal' && b.mode === 'goal') {
    if ((a.goalId !== undefined || b.goalId !== undefined) && a.goalId !== b.goalId) return false;
    if (Math.abs((a.arriveThreshold ?? 0) - (b.arriveThreshold ?? 0))
      > RANGE_CHANGE_TOLERANCE) return false;
    const destinationChange = Math.hypot(a.goalX - b.goalX, a.goalY - b.goalY);
    if (destinationChange >= GOAL_CHANGE_TOLERANCE) return false;
    const aDirection = unitDirection(position, { x: a.goalX, y: a.goalY });
    const bDirection = unitDirection(position, { x: b.goalX, y: b.goalY });
    return !aDirection || !bDirection
      || aDirection.x * bDirection.x + aDirection.y * bDirection.y >= GOAL_DIRECTION_CHANGE_COSINE;
  }
  if (a.mode !== 'combat_range' || b.mode !== 'combat_range') return false;
  // Combat-range intents must match on BOTH targetId AND position tolerance:
  // a targetId is stable across ticks even when the server relocates the
  // enemy, so `targetId ===` alone lets a target that moved 20 tiles between
  // frames read as unchanged. Mirror the goal-branch position check.
  const withinDistance = Math.hypot(a.targetX - b.targetX, a.targetY - b.targetY)
    < GOAL_CHANGE_TOLERANCE;
  const sameTarget = a.targetId > 0 || b.targetId > 0
    ? a.targetId === b.targetId && withinDistance
    : withinDistance;
  return sameTarget
    && Math.abs(a.hardMinimumRange - b.hardMinimumRange) <= RANGE_CHANGE_TOLERANCE
    && Math.abs(a.preferredMinimumRange - b.preferredMinimumRange) <= RANGE_CHANGE_TOLERANCE
    && Math.abs(a.preferredMaximumRange - b.preferredMaximumRange) <= RANGE_CHANGE_TOLERANCE;
}

function unitDirection(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number } | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length > 1e-9 ? { x: dx / length, y: dy / length } : undefined;
}

function normalizedDirection(
  velocity: { x: number; y: number },
): { x: number; y: number } | undefined {
  const speed = Math.hypot(velocity.x, velocity.y);
  return speed > 1e-9 ? { x: velocity.x / speed, y: velocity.y / speed } : undefined;
}

function telemetryIntentDirection(
  intent: DodgeMovementIntent | null,
  position: { x: number; y: number },
  fallbackVelocity: { x: number; y: number },
): { x: number; y: number } | undefined {
  if (intent?.mode === 'combat_range') {
    const target = { x: intent.targetX, y: intent.targetY };
    const targetDistance = Math.hypot(target.x - position.x, target.y - position.y);
    if (targetDistance < intent.preferredMinimumRange) return unitDirection(target, position);
    if (targetDistance > intent.preferredMaximumRange) return unitDirection(position, target);
    return undefined;
  }
  const fallback = normalizedDirection(fallbackVelocity);
  if (fallback) return fallback;
  if (intent?.mode === 'goal') {
    return unitDirection(position, { x: intent.goalX, y: intent.goalY });
  }
  return undefined;
}

function sameOptionalPoint(
  a: { x: number; y: number } | null,
  b: { x: number; y: number } | null,
): boolean {
  if (!a || !b) return a === b;
  return Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6;
}

function projectileKey(projectile: CombatProjectileSnapshot): string {
  return `${projectile.ownerId}:${projectile.bulletId}:${projectile.startTime}`;
}

function aoeKey(aoe: DodgePlanningAoe): string {
  return `${aoe.landingTime}:${aoe.x}:${aoe.y}:${aoe.radius}`;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function setDifferenceCount(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let count = 0;
  for (const value of a) if (!b.has(value)) count++;
  for (const value of b) if (!a.has(value)) count++;
  return count;
}

function replaceSet(target: Set<string>, source: ReadonlySet<string>): void {
  target.clear();
  for (const value of source) target.add(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return maximum;
  return Math.min(maximum, Math.max(minimum, value));
}
