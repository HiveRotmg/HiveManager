import {
  isProjectileAliveAt,
  predictProjectilePosition,
  type CombatProjectileSnapshot,
} from './combat-tracker';
import type {
  AutoDodgeOptions,
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
import { projectileCollisionHalfSize } from './projectile-motion';

const DIRECTION_COUNT = 32;
const INTENT_CANDIDATE = DIRECTION_COUNT + 1;
const CANDIDATE_COUNT = DIRECTION_COUNT + 2;
const TWO_PI = Math.PI * 2;
const SAMPLE_MS = 30;
const DENSE_SAMPLE_MS = 45;
const EXTREME_SAMPLE_MS = 60;
const DENSE_HOSTILE_COUNT = 80;
const EXTREME_HOSTILE_COUNT = 160;
const PROJECTILE_CLEARANCE = 0.1;
const AOE_CLEARANCE = 0.2;
const LOOK_AHEAD_MS = 300;
const AOE_LOOK_AHEAD_MS = 1200;
const PLAYER_HITBOX_SCALE = 0.92;
const REACTION_LEAD_MS = 250;
const EMERGENCY_OVERRIDE_MS = 100;
const HYSTERESIS_MS = 100;
const HYSTERESIS_SCORE_GAIN = 0.25;
const PHYSICAL_HIT_HALF_SIZE = 0.5;
const VELOCITY_SPEED_SCALES = [1, 0.8, 0.6, 0.4, 0.25, 0.15] as const;
const AOE_SPEED_PROBES = [0.05, 0.1, 0.15, 0.25, 0.4, 0.6, 0.8, 1] as const;
const COMMAND_LOOKAHEAD_MS = 60;
const EPSILON = 0.001;

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
  intentError: number;
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
  private readonly directionX = new Array<number>(CANDIDATE_COUNT).fill(0);
  private readonly directionY = new Array<number>(CANDIDATE_COUNT).fill(0);
  private selectedCandidate = 0;
  private selectedUntil = 0;
  private selectedVelocity = { x: 0, y: 0 };
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
    if (!enabled) this.reset();
    else this.state = { ...this.state, enabled: true };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  reset(): void {
    this.selectedCandidate = 0;
    this.selectedUntil = 0;
    this.selectedVelocity = { x: 0, y: 0 };
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

  evaluate(snapshot: AutoDodgeSnapshot): AutoDodgeState {
    if (!this.enabled) {
      this.state = emptyState(false);
      return this.getState();
    }
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

    const projectiles = [...snapshot.projectiles].filter((projectile) =>
      projectile.side === 'enemy'
      && !projectile.hitObjects.has(snapshot.playerId)
      && isProjectileAliveAt(projectile, snapshot.time));
    const activeAoes = snapshot.aoes.filter((aoe) =>
      aoe.landingTime + (aoe.blastDurationMs ?? 0) >= snapshot.time
      && aoe.landingTime - snapshot.time <= AOE_LOOK_AHEAD_MS);
    const intentLength = Math.hypot(snapshot.intentVelocity.x, snapshot.intentVelocity.y);
    this.directionX[INTENT_CANDIDATE] = intentLength > 1e-6
      ? snapshot.intentVelocity.x / intentLength
      : 0;
    this.directionY[INTENT_CANDIDATE] = intentLength > 1e-6
      ? snapshot.intentVelocity.y / intentLength
      : 0;

    const sampleStep = projectiles.length >= EXTREME_HOSTILE_COUNT
      ? EXTREME_SAMPLE_MS
      : projectiles.length >= DENSE_HOSTILE_COUNT ? DENSE_SAMPLE_MS : SAMPLE_MS;
    const candidates: Candidate[] = [];
    let rejectedGeometry = 0;
    for (let index = 0; index < CANDIDATE_COUNT; index++) {
      const candidate = this.evaluateCandidate(
        index,
        this.directionX[index]!,
        this.directionY[index]!,
        1,
        snapshot,
        projectiles,
        activeAoes,
        sampleStep,
      );
      if (!candidate.valid) rejectedGeometry++;
      candidates.push(candidate);
    }

    const intentCandidate = candidates[INTENT_CANDIDATE]!;
    let best = candidates[0]!;
    for (let index = 1; index < candidates.length; index++) {
      if (compareCandidate(candidates[index]!, best) < 0) best = candidates[index]!;
    }
    const threatCount = countRelevantThreats(snapshot, projectiles, activeAoes);
    const earliestImpact = minimumFinite(candidates.map((candidate) => candidate.firstImpactMs));
    const directUnsafe = !intentCandidate.valid
      || intentCandidate.expectedDamage > EPSILON
      || intentCandidate.minimumClearance < 0;

    let choice = best;
    let decision = 'no_threat';
    let override = false;
    if (threatCount === 0 || !directUnsafe) {
      choice = intentCandidate;
      decision = threatCount === 0 ? 'no_threat' : 'maximum_manual_preserved';
    } else {
      override = true;
      const emergency = intentCandidate.firstImpactMs <= EMERGENCY_OVERRIDE_MS;
      decision = emergency ? 'emergency_override' : 'gentle_override';
      choice = chooseIntentAligned(candidates, best, snapshot.intentVelocity, emergency);
      if (choice.index !== best.index) {
        decision = emergency ? 'emergency_manual_blend' : 'gentle_manual_blend';
      }
    }

    if (override && choice.index !== 0) {
      choice = this.refineSpeed(
        choice,
        snapshot,
        projectiles,
        activeAoes,
        sampleStep,
        intentLength > 1e-6 ? VELOCITY_SPEED_SCALES : AOE_SPEED_PROBES,
      );
    }

    const retained = candidates[this.selectedCandidate];
    if (override
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
      this.selectedUntil = snapshot.time + HYSTERESIS_MS;
    }

    const velocity = {
      x: choice.x * snapshot.moveSpeed * choice.speedScale,
      y: choice.y * snapshot.moveSpeed * choice.speedScale,
    };
    this.selectedVelocity = velocity;
    const trajectory = buildTrajectory(snapshot, velocity);
    const path = trajectory.waypoints.map((waypoint) => ({ x: waypoint.x, y: waypoint.y }));
    this.planRevision++;
    this.searchRevision++;
    this.lookaheadRevision++;
    this.metrics.totalPlans++;
    this.metrics.normalReplans++;
    this.metrics.candidatesGenerated += CANDIDATE_COUNT;
    this.metrics.candidatesRejectedByGeometry += rejectedGeometry;
    this.metrics.activeProjectilesConsidered += projectiles.length;
    this.metrics.coalescedProjectileUpdates += this.pendingProjectileUpdates;
    this.pendingProjectileUpdates = 0;
    this.pendingDangerUpdates = 0;

    this.state = this.makeState(snapshot, {
      candidate: choice.index,
      velocity,
      speedScale: choice.speedScale,
      threatCount,
      earliestImpactMs: Number.isFinite(earliestImpact) ? earliestImpact : null,
      override,
      decision,
      path,
      trajectory,
    });
    return this.getState();
  }

  private evaluateCandidate(
    index: number,
    directionX: number,
    directionY: number,
    speedScale: number,
    snapshot: AutoDodgeSnapshot,
    projectiles: readonly CombatProjectileSnapshot[],
    aoes: readonly DodgePlanningAoe[],
    sampleStep: number,
  ): Candidate {
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
      intentError: 0,
    };
    const velocityX = directionX * snapshot.moveSpeed * speedScale;
    const velocityY = directionY * snapshot.moveSpeed * speedScale;
    candidate.intentError = Math.hypot(
      velocityX - snapshot.intentVelocity.x,
      velocityY - snapshot.intentVelocity.y,
    );

    const previousProjectilePositions = new Map<CombatProjectileSnapshot, { x: number; y: number }>();
    const coveredProjectiles = new Set<CombatProjectileSnapshot>();
    const hitThreats = new Set<string>();
    for (let offset = 0; offset <= Math.max(LOOK_AHEAD_MS, snapshot.movementLeadMs); offset += sampleStep) {
      const movementOffset = snapshot.movementLeadMs + offset;
      const playerX = snapshot.position.x + velocityX * movementOffset;
      const playerY = snapshot.position.y + velocityY * movementOffset;
      const physicalOpen = snapshot.environment.canOccupy(playerX, playerY, false, false);
      const safeOpen = snapshot.environment.canOccupy(playerX, playerY, this.safeWalk, false);
      if (!physicalOpen) {
        candidate.valid = false;
        candidate.wallBlockMs = Math.min(candidate.wallBlockMs, offset);
        break;
      }
      if (!safeOpen) candidate.groundExposureMs += sampleStep;

      for (const projectile of projectiles) {
        if (coveredProjectiles.has(projectile)) continue;
        const time = snapshot.time + offset;
        if (!isProjectileAliveAt(projectile, time)) continue;
        const projectilePosition = predictProjectilePosition(projectile, time);
        const previous = previousProjectilePositions.get(projectile) ?? projectilePosition;
        previousProjectilePositions.set(projectile, { ...projectilePosition });
        if (!snapshot.environment.isProjectileSegmentOpen(
          previous.x,
          previous.y,
          projectilePosition.x,
          projectilePosition.y,
          projectile,
        )) {
          coveredProjectiles.add(projectile);
          continue;
        }
        const halfSize = projectileCollisionHalfSize(projectile.definition)
          * PLAYER_HITBOX_SCALE + PROJECTILE_CLEARANCE;
        const clearance = projectile.definition.laserDistance
          ? laserClearance(playerX, playerY, projectile) - halfSize
          : Math.max(
            Math.abs(projectilePosition.x - playerX),
            Math.abs(projectilePosition.y - playerY),
          ) - halfSize;
        candidate.minimumClearance = Math.min(candidate.minimumClearance, clearance);
        const threatKey = `p:${projectile.ownerId}:${projectile.bulletId}`;
        if (clearance <= 0 && !hitThreats.has(threatKey)) {
          hitThreats.add(threatKey);
          candidate.firstImpactMs = Math.min(candidate.firstImpactMs, offset);
          candidate.expectedDamage += Math.max(0, projectile.damage);
        }
      }
    }

    for (const aoe of aoes) {
      const landingOffset = Math.max(0, aoe.landingTime - snapshot.time);
      if (landingOffset > AOE_LOOK_AHEAD_MS) continue;
      const endOffset = landingOffset + Math.max(0, aoe.blastDurationMs ?? 0);
      for (let offset = landingOffset; offset <= endOffset; offset += Math.max(30, sampleStep)) {
        const movementOffset = snapshot.movementLeadMs + offset;
        const playerX = snapshot.position.x + velocityX * movementOffset;
        const playerY = snapshot.position.y + velocityY * movementOffset;
        const clearance = Math.hypot(playerX - aoe.x, playerY - aoe.y)
          - aoe.radius - AOE_CLEARANCE;
        candidate.minimumClearance = Math.min(candidate.minimumClearance, clearance);
        if (clearance <= 0) {
          candidate.firstImpactMs = Math.min(candidate.firstImpactMs, offset);
          const threatKey = `a:${aoe.x}:${aoe.y}:${aoe.landingTime}`;
          if (!hitThreats.has(threatKey)) {
            hitThreats.add(threatKey);
            candidate.expectedDamage += Math.max(0, aoe.damage ?? 1);
          }
          break;
        }
      }
    }

    const endpointOffset = snapshot.movementLeadMs + LOOK_AHEAD_MS;
    const endpointX = snapshot.position.x + velocityX * endpointOffset;
    const endpointY = snapshot.position.y + velocityY * endpointOffset;
    candidate.escapeOptions = countEscapeOptions(snapshot.environment, endpointX, endpointY, this.safeWalk);
    candidate.lethal = !candidate.valid;
    return candidate;
  }

  private refineSpeed(
    selected: Candidate,
    snapshot: AutoDodgeSnapshot,
    projectiles: readonly CombatProjectileSnapshot[],
    aoes: readonly DodgePlanningAoe[],
    sampleStep: number,
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
        sampleStep,
      );
      if (isProtectionNoWorse(candidate, selected)
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
      comparisonHorizonMs: LOOK_AHEAD_MS,
      movementTargetDistance: target
        ? Math.hypot(target.x - snapshot.position.x, target.y - snapshot.position.y)
        : 0,
      timeSinceLastMovementCommandMs: 0,
      lookaheadRevision: this.lookaheadRevision,
      lookaheadChanged: true,
      decision: result.decision,
      plannerMetrics: { ...this.metrics },
    };
  }
}

function compareCandidate(candidate: Candidate, incumbent: Candidate): number {
  if (candidate.valid !== incumbent.valid) return candidate.valid ? -1 : 1;
  if (candidate.lethal !== incumbent.lethal) return candidate.lethal ? 1 : -1;
  if (Math.abs(candidate.expectedDamage - incumbent.expectedDamage) > EPSILON) {
    return candidate.expectedDamage < incumbent.expectedDamage ? -1 : 1;
  }
  if (candidate.groundExposureMs !== incumbent.groundExposureMs) {
    return candidate.groundExposureMs < incumbent.groundExposureMs ? -1 : 1;
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

function chooseIntentAligned(
  candidates: readonly Candidate[],
  safest: Candidate,
  intent: { x: number; y: number },
  emergency: boolean,
): Candidate {
  let best = safest;
  let bestDot = -Infinity;
  for (const candidate of candidates) {
    if (!candidate.valid
      || candidate.expectedDamage > safest.expectedDamage + EPSILON
      || candidate.groundExposureMs > safest.groundExposureMs
      || emergency && candidate.minimumClearance < safest.minimumClearance - 0.75) {
      continue;
    }
    const dot = candidate.x * intent.x + candidate.y * intent.y;
    if (dot > bestDot) {
      bestDot = dot;
      best = candidate;
    }
  }
  return best;
}

function isProtectionNoWorse(candidate: Candidate, reference: Candidate): boolean {
  return candidate.valid
    && candidate.expectedDamage <= reference.expectedDamage + EPSILON
    && candidate.groundExposureMs <= reference.groundExposureMs;
}

function countRelevantThreats(
  snapshot: AutoDodgeSnapshot,
  projectiles: readonly CombatProjectileSnapshot[],
  aoes: readonly DodgePlanningAoe[],
): number {
  let count = aoes.length;
  const reach = snapshot.moveSpeed * (snapshot.movementLeadMs + LOOK_AHEAD_MS) + 1.5;
  for (const projectile of projectiles) {
    const start = predictProjectilePosition(projectile, snapshot.time);
    const end = predictProjectilePosition(
      projectile,
      Math.min(snapshot.time + LOOK_AHEAD_MS, projectile.startTime + projectile.definition.lifetimeMs),
    );
    if (pointToSegmentDistance(
      snapshot.position.x,
      snapshot.position.y,
      start.x,
      start.y,
      end.x,
      end.y,
    ) <= reach) {
      count++;
    }
  }
  return count;
}

function countEscapeOptions(
  environment: DodgePlanningEnvironment,
  x: number,
  y: number,
  safeWalk: boolean,
): number {
  let count = 0;
  for (let index = 0; index < 8; index++) {
    const angle = index * TWO_PI / 8;
    if (environment.canOccupy(
      x + Math.cos(angle) * 0.35,
      y + Math.sin(angle) * 0.35,
      safeWalk,
      false,
    )) {
      count++;
    }
  }
  return count;
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
