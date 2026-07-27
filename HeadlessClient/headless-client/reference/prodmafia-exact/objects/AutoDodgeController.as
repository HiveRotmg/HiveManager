package com.company.assembleegameclient.objects {
import com.company.assembleegameclient.parameters.Parameters;
import com.company.assembleegameclient.map.Map;
import com.company.assembleegameclient.map.MovingAoeEmitter;
import com.company.assembleegameclient.objects.thrown.ThrownProjectile;
import com.company.assembleegameclient.util.ConditionEffect;
import flash.geom.Point;
import flash.geom.Vector3D;
import flash.utils.Dictionary;
import flash.utils.getTimer;
import kabam.lib.net.impl.DebugLog;

/**
 * Allocation-free state for the replacement auto-dodge system.
 *
 * Owns reusable threat-prediction, candidate-scoring and hysteresis state.
 * Normal operation performs no per-frame heap allocation.
 */
public final class AutoDodgeController {

   public static const DIRECTION_COUNT:int = 32;
   public static const INTENT_CANDIDATE:int = DIRECTION_COUNT + 1;
   public static const CANDIDATE_COUNT:int = DIRECTION_COUNT + 2;

   private static const TWO_PI:Number = Math.PI * 2;
   // The controller only overrides inside 250 ms. Prediction distance is a
   // player option because earlier reactions trade CPU and movement freedom for
   // additional planning time.
   private static const SAMPLE_MS:int = 30;
   private static const DENSE_SAMPLE_MS:int = 45;
   private static const EXTREME_SAMPLE_MS:int = 60;
   private static const DENSE_HOSTILE_COUNT:int = 80;
   private static const EXTREME_HOSTILE_COUNT:int = 160;
   // The controller replans every frame. Projectile intersection is evaluated
   // over the complete configured horizon; this short probe is now reserved for
   // the point-blank emitter guard. Wall topology has its own tile-distance
   // option because a speed-independent 90-ms endpoint missed upcoming corners.
   private static const LOCAL_MOBILITY_HORIZON_MS:int = 90;
   // These are fallback speeds around the continuous projection of the player's
   // intended velocity. Their order is irrelevant: the selector ranks velocity
   // error, rather than returning the first/slowest collision-free result.
   private static const VELOCITY_SPEED_SCALES:Vector.<Number> =
         new <Number>[1.0,0.80,0.60,0.40,0.25,0.15];
   private static const AOE_SPEED_PROBES:Vector.<Number> =
         new <Number>[0.05,0.10,0.15,0.25,0.40,0.60,0.80,1.0];
   // Enemy sprites are not collision hazards. Quest bosses can, however, emit a
   // complete radial volley from their origin. Inside this deliberately small
   // core, the first client-visible projectile may already overlap the player's
   // physical collision box. Guard only projectile-capable quest bosses; normal
   // Wine Cellar enemies must not recreate the old two-tile body avoidance.
   private static const DEFAULT_SHOOTER_CORE_RADIUS:Number = 0.90;
   private static const SHOOTER_CORE_RISK:Number = 20;
   private static const HARD_AOE_RISK:Number = 100000;
   private static const PERSISTENT_CLUSTER_MIN:int = 4;
   private static const RELEVANCE_CLEARANCE:Number = 1.0;
   private static const INTENT_SAFE_CLEARANCE:Number = 0.08;
   private static const EMERGENCY_INTENT_BAND:Number = 0.14;
   private static const UNAVOIDABLE_IMPACT_BAND_MS:int = 60;
   private static const UNAVOIDABLE_CLEARANCE_BAND:Number = 0.05;
   private static const GENTLE_OVERRIDE_MS:int = 250;
   private static const EMERGENCY_OVERRIDE_MS:int = 100;
   private static const HYSTERESIS_MS:int = 100;
   private static const HYSTERESIS_SCORE_GAIN:Number = 0.25;
   // Map.update runs GameObjects (including Player) before BasicObjects
   // (including Projectile). The player's sample therefore includes this
   // frame's movementLead, while the projectile collision later in the SAME map
   // update still evaluates at `time`, not `time + movementLead`.
   private static const PHYSICAL_HIT_HALF_SIZE:Number = 0.5;
   private static const PATH_SURVIVAL_MIN_MS:int = 120;
   private static const PATH_SURVIVAL_AFTER_BREACH_MS:int = 90;
   private static const WALL_ESCAPE_PROBE_DISTANCE:Number = 1.10;
   private static const WALL_APPROACH_RISK:Number = 4.0;
   private static const WALL_TOPOLOGY_RISK:Number = 6.0;
   private static const MOBILITY_RISK_TOLERANCE:Number = 12.0;
   private static const PROJECTILE_DAMAGE_RISK:Number = 0.04;
   private static const AOE_REACTION_MARGIN_MS:int = 340;
   private static const AOE_ESCAPE_SPEED_FACTOR:Number = 0.70;
   private static const AOE_POST_IMPACT_HOLD_MS:int = 100;
   private static const SERVER_PATH_MAX_OFFSET:Number = 1.75;
   // A large acknowledgement gap is not a 1.75-tile uncertainty corridor. It
   // means the server collision origin has materially diverged from the local
   // render position and must be evaluated as a second, authoritative anchor.
   private static const SERVER_PATH_MIN_OFFSET:Number = 0.04;
   private static const SERVER_PATH_CATCHUP_MS:int = 350;
   private static const REACTIVE_DAMAGE_ESCAPE_MS:int = 700;
   private static const REACTIVE_DAMAGE_RADIUS:Number = 1.25;
   private static const STATIONARY_HIT_WINDOW_MS:int = 1500;
   private static const STATIONARY_HIT_DISTANCE:Number = 0.20;
   private static const STUCK_ESCAPE_DURATION_MS:int = 1500;
   private static const STUCK_ESCAPE_CLEAR_DISTANCE:Number = 0.75;
   private static const BLOCKED_OVERRIDE_LIMIT:int = 3;
   private static const PREDICTIVE_NEXUS_LEAD_MS:int = 180;
   private static const STUCK_ESCAPE_MIN_PROBE:Number = 0.08;
   private static const STUCK_ESCAPE_MAX_PROBE:Number = 0.20;
   private static const STUCK_ESCAPE_MIN_PROGRESS:Number = 0.015;

   public const projectilePosition:Point = new Point();
   public const previousProjectilePosition:Point = new Point();
   public const candidateX:Vector.<Number> = new Vector.<Number>(CANDIDATE_COUNT,true);
   public const candidateY:Vector.<Number> = new Vector.<Number>(CANDIDATE_COUNT,true);
   public const candidateScore:Vector.<Number> = new Vector.<Number>(CANDIDATE_COUNT,true);
   // Minimum clearance after subtracting the margin for that specific hazard.
   // Zero is therefore the common "safe" boundary across projectiles, AoEs,
   // hostile bodies and ground without allowing one domain to inflate another.
   public const candidateSafetyScore:Vector.<Number> =
         new Vector.<Number>(CANDIDATE_COUNT,true);
   public const candidateRisk:Vector.<Number> = new Vector.<Number>(CANDIDATE_COUNT,true);
   public const candidateExpectedDamage:Vector.<Number> =
         new Vector.<Number>(CANDIDATE_COUNT,true);
   // Damage predicted to land within PREDICTIVE_NEXUS_LEAD_MS only. The full
   // candidateExpectedDamage sums every threat over the whole horizon (up to
   // 1.2 s) as if all of them connect, which made the predictive nexus fire at
   // 900/900 HP in swarms (5 of 13 triggers in the 07-22..24 logs were at
   // >=90% HP). Lethality decisions must use the imminent window.
   public const candidateImminentDamage:Vector.<Number> =
         new Vector.<Number>(CANDIDATE_COUNT,true);
   public const candidateWallPenalty:Vector.<Number> =
         new Vector.<Number>(CANDIDATE_COUNT,true);
   public const candidateEscapeOptions:Vector.<int> =
         new Vector.<int>(CANDIDATE_COUNT,true);
   // Time spent on known damaging ground inside the prediction horizon. Keep
   // this separate from abstract risk so wall-topology preferences cannot make
   // a stationary lava route beat an otherwise equivalent escape.
   private const candidateGroundExposureMs_:Vector.<int> =
         new Vector.<int>(CANDIDATE_COUNT,true);
   public const candidateImpactMs:Vector.<int> = new Vector.<int>(CANDIDATE_COUNT,true);
   public const candidateBlockMs:Vector.<int> = new Vector.<int>(CANDIDATE_COUNT,true);
   public const candidateValid:Vector.<Boolean> = new Vector.<Boolean>(CANDIDATE_COUNT,true);
   private const candidateThreatClearance_:Vector.<Number> =
         new Vector.<Number>(CANDIDATE_COUNT,true);
   // First predicted collision time against the CURRENT projectile only;
   // feeds the imminent-damage window without disturbing candidateImpactMs.
   private const candidateThreatImpactMs_:Vector.<int> =
         new Vector.<int>(CANDIDATE_COUNT,true);

   // Reused broad-phase result. Dense encounters can contain hundreds of
   // hostile projectiles, while only a small fraction can enter any position
   // the player can reach during the prediction horizon.
   private const relevantProjectiles_:Vector.<Projectile> = new Vector.<Projectile>();
   private const relevantEnemies_:Vector.<GameObject> = new Vector.<GameObject>();
   private const relevantProjectileEmitters_:Vector.<MovingAoeEmitter> =
         new Vector.<MovingAoeEmitter>();
   // Zero-damage warning lasers whose damaging twin spawns on the same line
   // when they expire. They are excluded from live-projectile steering
   // (isThreatTo) but must be planned around as scheduled line hazards.
   private const relevantTelegraphLasers_:Vector.<Projectile> =
         new Vector.<Projectile>();
   // containerType -> damaging laser sibling (or null when the container has
   // none, i.e. the zero-damage laser is purely cosmetic). Resolved once per
   // container type for the session.
   private static const telegraphTwinCache_:Dictionary = new Dictionary();

   public var selectedCandidate:int = 0;
   public var proposedCandidate:int = 0;
   private var runnerUpCandidate_:int = -1;
   public var selectedUntil:int = 0;
   public var earliestImpactMs:int = int.MAX_VALUE;
   public var earliestSafetyBreachMs:int = int.MAX_VALUE;
   public var threatCount:int = 0;
   public var overrideActive:Boolean = false;
   public var debugVelocityX:Number = 0;
   public var debugVelocityY:Number = 0;
   public var debugSpeedScale:Number = 1;

   private var intentVelocityX_:Number = 0;
   private var intentVelocityY_:Number = 0;
   private var requiredSafetyClearance_:Number = INTENT_SAFE_CLEARANCE;
   private var aoeSafetyClearance_:Number = 0.2;
   private var horizonMs_:int = 300;
   private var aoeHorizonMs_:int = 1200;
   private var earliestAoeLandingMs_:int = int.MAX_VALUE;
   private var aoeInterventionLeadMs_:int = GENTLE_OVERRIDE_MS;
   private var velocityAoeHorizonMs_:int = 0;
   private var aoeEscapeCandidate_:int = -1;
   private var aoeEscapeUntil_:int = 0;
   private var persistentClusterActive_:Boolean = false;
   private var persistentClusterX_:Number = 0;
   private var persistentClusterY_:Number = 0;
   private var persistentClusterRadius_:Number = 0;
   private var recentBurstActive_:Boolean = false;
   private var recentBurstX_:Number = 0;
   private var recentBurstY_:Number = 0;
   private var recentBurstRadius_:Number = 0;
   private var recentBurstRemainingMs_:int = 0;
   private var hitHalfSize_:Number = 0.5;
   private var hitboxScale_:Number = 0.92;
   private var cornerLookAheadTiles_:Number = 1.5;
   private var cornerStrength_:Number = 1;
   private var shooterCoreRadius_:Number = DEFAULT_SHOOTER_CORE_RADIUS;
   private var reactionLeadMs_:int = GENTLE_OVERRIDE_MS;
   private var cornerEscapeActive_:Boolean = false;
   private var lastMovementLeadMs_:int = 0;
   private var loadSampleStepMs_:int = SAMPLE_MS;
   private var serverOffsetX_:Number = 0;
   private var serverOffsetY_:Number = 0;
   private var serverOffsetDistance_:Number = 0;
   private var serverRawOffsetDistance_:Number = 0;
   private var serverTemporalActive_:Boolean = false;
   private var serverRebaseActive_:Boolean = false;
   private var lastEffectiveManualInfluence_:Number = 0.75;
   private var lastAutonomousIntent_:Boolean = false;
   private var reactiveDamageTime_:int = -1;
   private var reactiveDamageX_:Number = 0;
   private var reactiveDamageY_:Number = 0;
   private var reactiveDamageAmount_:int = 0;
   private var lastProjectileHitTime_:int = -1;
   private var lastProjectileHitX_:Number = 0;
   private var lastProjectileHitY_:Number = 0;
   private var stationaryProjectileHits_:int = 0;
   private var stuckEscapeUntil_:int = 0;
   private var stuckEscapeX_:Number = 0;
   private var stuckEscapeY_:Number = 0;
   private var stuckEscapeCandidate_:int = -1;
   private var stuckFailedCandidates_:uint = 0;
   private const stuckPreviewPosition_:Point = new Point();
   private var stuckPreviewDistance_:Number = 0;
   private var lastAppliedTime_:int = -1;
   private var lastAppliedX_:Number = 0;
   private var lastAppliedY_:Number = 0;
   private var lastAppliedExpectedDistance_:Number = 0;
   private var lastAppliedCandidate_:int = -1;
   private var blockedOverrideFrames_:int = 0;
   private var minimumMotionEligible_:Boolean = false;
   private var plannedSpeedScale_:Number = 1;
   private var plannedSpeedCandidate_:int = -1;
   private var lastMinimumMotionTests_:int = 0;
   private var lastShooterCoreClearance_:Number = Number.POSITIVE_INFINITY;
   private var velocityBestCandidate_:int = -1;
   private var velocityBestScale_:Number = 1;
   private var velocityBestError_:Number = Number.POSITIVE_INFINITY;
   private var directEmitterThreat_:Boolean = false;
   private var directPortalThreat_:Boolean = false;
   private var intendedEmitterClearance_:Number = Number.POSITIVE_INFINITY;

   private var lastThreatLog_:int = 0;
   private var activeHostileCount_:int = 0;
   private var activeLaserCount_:int = 0;
   private var relevantLaserCount_:int = 0;
   private var nearestLaserClearance_:Number = -1;
   private var broadPhaseThreatCount_:int = 0;
   private var directBroadPhaseThreatCount_:int = 0;
   private var activeAoeCount_:int = 0;
   private var relevantAoeCount_:int = 0;
   private var nearestThreatDistance_:Number = -1;
   private var lastDecision_:String = "none";
   private var lastEvaluationTime_:int = -1;
   private var windowFrames_:int = 0;
   private var windowEvaluationMs_:int = 0;
   private var windowMaxEvaluationMs_:int = 0;
   private var windowProjectileSamples_:int = 0;
   private var windowCandidateChecks_:int = 0;
   private var windowInvalidCandidates_:int = 0;
   private var windowOverrides_:int = 0;
   private var windowEmergencyOverrides_:int = 0;
   private var windowGentleOverrides_:int = 0;
   private var windowPreservedSafe_:int = 0;
   private var windowNoThreat_:int = 0;
   private var windowProactiveSpacing_:int = 0;
   private var windowLocked_:int = 0;
   private var windowManualPreferred_:int = 0;
   private var windowFractionalSpeed_:int = 0;
   private var windowSpeedScaleTotal_:Number = 0;
   private var windowMinimumMotionFrames_:int = 0;
   private var windowMinimumMotionTests_:int = 0;
   private var windowMaxHostile_:int = 0;
   private var windowMaxBroad_:int = 0;
   private var windowMaxDirectBroad_:int = 0;
   private var windowMaxActiveAoe_:int = 0;
   private var windowMaxRelevantAoe_:int = 0;

   public function AutoDodgeController() {
      // Candidate zero means stand still. Remaining candidates cover the full
      // world-space circle at equal angular intervals.
      this.candidateX[0] = 0;
      this.candidateY[0] = 0;
      for(var index:int = 0; index < DIRECTION_COUNT; index++) {
         var angle:Number = index * TWO_PI / DIRECTION_COUNT;
         this.candidateX[index + 1] = Math.cos(angle);
         this.candidateY[index + 1] = Math.sin(angle);
      }
      this.candidateX[INTENT_CANDIDATE] = 0;
      this.candidateY[INTENT_CANDIDATE] = 0;
      this.resetFrame();
   }

   public function resetFrame() : void {
      this.earliestImpactMs = int.MAX_VALUE;
      this.earliestSafetyBreachMs = int.MAX_VALUE;
      this.threatCount = 0;
      this.broadPhaseThreatCount_ = 0;
      this.directBroadPhaseThreatCount_ = 0;
      this.activeAoeCount_ = 0;
      this.relevantAoeCount_ = 0;
      this.activeLaserCount_ = 0;
      this.relevantLaserCount_ = 0;
      this.nearestLaserClearance_ = -1;
      this.relevantProjectiles_.length = 0;
      this.relevantEnemies_.length = 0;
      this.relevantProjectileEmitters_.length = 0;
      this.relevantTelegraphLasers_.length = 0;
      this.earliestAoeLandingMs_ = int.MAX_VALUE;
      this.aoeInterventionLeadMs_ = GENTLE_OVERRIDE_MS;
      this.velocityAoeHorizonMs_ = 0;
      this.serverOffsetX_ = 0;
      this.serverOffsetY_ = 0;
      this.serverOffsetDistance_ = 0;
      this.serverRawOffsetDistance_ = 0;
      this.serverTemporalActive_ = false;
      this.serverRebaseActive_ = false;
      this.overrideActive = false;
      this.runnerUpCandidate_ = -1;
      this.minimumMotionEligible_ = false;
      this.plannedSpeedScale_ = 1;
      this.plannedSpeedCandidate_ = -1;
      this.persistentClusterActive_ = false;
      this.recentBurstActive_ = false;
      this.lastMinimumMotionTests_ = 0;
      this.lastShooterCoreClearance_ = Number.POSITIVE_INFINITY;
      this.velocityBestCandidate_ = -1;
      this.velocityBestScale_ = 1;
      this.velocityBestError_ = Number.POSITIVE_INFINITY;
      this.cornerEscapeActive_ = false;
      this.lastAutonomousIntent_ = false;
      this.directEmitterThreat_ = false;
      this.directPortalThreat_ = false;
      this.intendedEmitterClearance_ = Number.POSITIVE_INFINITY;
      for(var index:int = 0; index < CANDIDATE_COUNT; index++) {
         this.candidateScore[index] = Number.POSITIVE_INFINITY;
         this.candidateSafetyScore[index] = Number.POSITIVE_INFINITY;
         this.candidateRisk[index] = 0;
         this.candidateExpectedDamage[index] = 0;
         this.candidateImminentDamage[index] = 0;
         this.candidateWallPenalty[index] = 0;
         this.candidateEscapeOptions[index] = 8;
         this.candidateGroundExposureMs_[index] = 0;
         this.candidateImpactMs[index] = int.MAX_VALUE;
         this.candidateBlockMs[index] = int.MAX_VALUE;
         this.candidateValid[index] = true;
      }
   }

   public function reset() : void {
      this.resetFrame();
      this.selectedCandidate = 0;
      this.proposedCandidate = 0;
      this.selectedUntil = 0;
      this.aoeEscapeCandidate_ = -1;
      this.aoeEscapeUntil_ = 0;
      this.projectilePosition.setTo(0,0);
      this.previousProjectilePosition.setTo(0,0);
      this.lastThreatLog_ = 0;
      this.lastEvaluationTime_ = -1;
      this.activeHostileCount_ = 0;
      this.nearestThreatDistance_ = -1;
      this.reactiveDamageTime_ = -1;
      this.reactiveDamageAmount_ = 0;
      this.lastProjectileHitTime_ = -1;
      this.stationaryProjectileHits_ = 0;
      this.stuckEscapeUntil_ = 0;
      this.stuckEscapeCandidate_ = -1;
      this.stuckFailedCandidates_ = 0;
      this.lastAppliedTime_ = -1;
      this.lastAppliedCandidate_ = -1;
      this.blockedOverrideFrames_ = 0;
      this.resetTelemetryWindow();
   }

   /**
    * Step-3 observe-only threat collection. It uses the map's immediately
    * maintained hostile vector and does not influence movement or allocate in
    * normal operation. Candidate prediction/scoring is added in step 4.
    */
   public function evaluateThreats(player:Player, map:Map, hostile:Vector.<Projectile>, time:int,
                                   moveSpeed:Number, intentX:Number, intentY:Number,
                                   movementLeadMs:int) : void {
      var profiling:Boolean = Parameters.data.autoDodgeDebug;
      var evaluationStart:int = profiling ? getTimer() : 0;
      var projectileSamples:int = 0;
      var candidateChecks:int = 0;
      var invalidCandidates:int = 0;
      var configuredProjectileClearance:Number =
            optionNumber("autoDodgeProjectileClearance",0.1,0,1.5);
      this.cornerLookAheadTiles_ = optionNumber("autoDodgeCornerLookAheadTiles",
            1.5,0,4);
      this.cornerStrength_ = optionNumber("autoDodgeCornerStrength",1,0,2);
      this.shooterCoreRadius_ = optionNumber("autoDodgeShooterBackoffTiles",
            DEFAULT_SHOOTER_CORE_RADIUS,0,2);
      this.reactionLeadMs_ = int(optionNumber("autoDodgeReactionLeadMs",
            GENTLE_OVERRIDE_MS,100,500));
      // This is the one and only margin outside the user-selected hitbox.
      // Zero means exactly the scaled projectile collision box: no hidden model
      // floor, physical-box restoration, or second additive option.
      var projectileSafetyClearance:Number = configuredProjectileClearance;
      // Like Projectile Clearance, Bomb Circle Distance is a literal user
      // boundary. The former hidden 0.20-tile model floor made a selected 0.10
      // behave like 0.30 before server-corridor uncertainty was even applied.
      var aoeSafetyClearance:Number = optionNumber("autoDodgeAoeClearance",0.2,0,1.5);
      // NEWTICK is an acknowledgement of an older client position, not a second
      // simultaneous hitbox. Projectile.getHit evaluates the locally integrated
      // position, while authoritative AoEs already use the local/server corridor
      // below. Adding the acknowledgement gap again inflated both boundaries by
      // as much as 0.35 tiles and double-counted the same uncertainty.
      this.horizonMs_ = int(optionNumber("autoDodgeLookAheadMs",300,100,1000));
      this.aoeHorizonMs_ = int(optionNumber("autoDodgeAoeLookAheadMs",1200,300,2500));
      this.hitboxScale_ = optionNumber("autoDodgePlayerHitbox",92,0,100) / 100;
      this.hitHalfSize_ = PHYSICAL_HIT_HALF_SIZE * this.hitboxScale_;
      this.lastMovementLeadMs_ = movementLeadMs;
      var aoeRelevanceClearance:Number = Math.max(0.15,aoeSafetyClearance);
      var useAoeClusters:Boolean = Parameters.data.autoDodgeAoeClusters !== false;
      var avoidDamagingGround:Boolean = Parameters.data.autoDodgeAvoidGround !== false;
      this.requiredSafetyClearance_ = projectileSafetyClearance;
      this.resetFrame();
      this.aoeSafetyClearance_ = aoeSafetyClearance;
      // Refresh strategic-suppression thresholds every frame (even when this
      // evaluation early-returns for no threat) so a hit connecting on any
      // frame is judged against current HP.
      this.updateStrategicThresholds(player);
      this.updateAppliedMovementFeedback(player,time,profiling);
      if(time < this.stuckEscapeUntil_) {
         var stuckMovedX:Number = player.x_ - this.stuckEscapeX_;
         var stuckMovedY:Number = player.y_ - this.stuckEscapeY_;
         if(stuckMovedX * stuckMovedX + stuckMovedY * stuckMovedY >=
               STUCK_ESCAPE_CLEAR_DISTANCE * STUCK_ESCAPE_CLEAR_DISTANCE) {
            this.clearStuckEscape();
         }
      }
      var rawServerOffsetX:Number = player.dodgeServerOffsetX(time);
      var rawServerOffsetY:Number = player.dodgeServerOffsetY(time);
      this.serverRawOffsetDistance_ = Math.sqrt(rawServerOffsetX * rawServerOffsetX +
            rawServerOffsetY * rawServerOffsetY);
      this.serverOffsetX_ = player.dodgeTemporalServerOffsetX(time);
      this.serverOffsetY_ = player.dodgeTemporalServerOffsetY(time);
      this.serverOffsetDistance_ = Math.sqrt(this.serverOffsetX_ * this.serverOffsetX_ +
            this.serverOffsetY_ * this.serverOffsetY_);
      // "Server Position Corridor" A/B toggle. The protocol has no server-side
      // shot collision (the client is the damage authority via PLAYERHIT /
      // AOEACK), so planning against the trailing server-acknowledged anchor
      // is optional ghost-dodging: Off evaluates threats against the real
      // local hitbox only. Rebase handling (genuine GOTO teleports affecting
      // terrain legality) stays active in both positions.
      this.serverTemporalActive_ = Parameters.data.autoDodgeServerCorridor !== false &&
            player.dodgeTemporalServerPathActive(time);
      this.serverRebaseActive_ = player.dodgeServerRebaseActive(time);
      if(!this.serverRebaseActive_ &&
            this.serverOffsetDistance_ > SERVER_PATH_MAX_OFFSET) {
         var serverOffsetScale:Number = SERVER_PATH_MAX_OFFSET /
               this.serverOffsetDistance_;
         this.serverOffsetX_ *= serverOffsetScale;
         this.serverOffsetY_ *= serverOffsetScale;
         this.serverOffsetDistance_ = SERVER_PATH_MAX_OFFSET;
      } else if(this.serverOffsetDistance_ < SERVER_PATH_MIN_OFFSET) {
         this.serverOffsetX_ = 0;
         this.serverOffsetY_ = 0;
         this.serverOffsetDistance_ = 0;
         this.serverTemporalActive_ = false;
      }
      var unmodeledDamageSource:Boolean = player.lastLocalDamageSource == "server_hp" ||
            player.lastLocalDamageSource == "server_damage";
      if(unmodeledDamageSource && player.lastLocalDamageTime >= 0 &&
            player.lastLocalDamageTime != this.reactiveDamageTime_) {
         this.reactiveDamageTime_ = player.lastLocalDamageTime;
         this.reactiveDamageX_ = player.x_;
         this.reactiveDamageY_ = player.y_;
         this.reactiveDamageAmount_ = Math.max(1,player.lastLocalDamageAmount);
         if(profiling) {
            DebugLog.event("auto_dodge_reactive_damage",{
                  "source":player.lastLocalDamageSource,
                  "amount":this.reactiveDamageAmount_,
                  "x":this.reactiveDamageX_,"y":this.reactiveDamageY_});
         }
      }
      var reactiveDamageAge:int = this.reactiveDamageTime_ >= 0 ?
            time - this.reactiveDamageTime_ : int.MAX_VALUE;
      var reactiveDamageActive:Boolean = reactiveDamageAge >= 0 &&
            (reactiveDamageAge <= REACTIVE_DAMAGE_ESCAPE_MS ||
             time < this.stuckEscapeUntil_);
      this.lastEvaluationTime_ = time;
      this.debugVelocityX = intentX;
      this.debugVelocityY = intentY;
      this.debugSpeedScale = 1;
      this.intentVelocityX_ = intentX;
      this.intentVelocityY_ = intentY;
      var nearestDistanceSq:Number = Number.POSITIVE_INFINITY;
      var count:int = hostile.length;
      this.activeHostileCount_ = count;
      this.loadSampleStepMs_ = count >= EXTREME_HOSTILE_COUNT ?
            EXTREME_SAMPLE_MS : count >= DENSE_HOSTILE_COUNT ?
            DENSE_SAMPLE_MS : SAMPLE_MS;
      var candidate:int;
      var sampleOffset:int;
      var intentLength:Number = Math.sqrt(intentX * intentX + intentY * intentY);
      if(intentLength > 0.000001) {
         this.candidateX[INTENT_CANDIDATE] = intentX / intentLength;
         this.candidateY[INTENT_CANDIDATE] = intentY / intentLength;
      } else {
         this.candidateX[INTENT_CANDIDATE] = 0;
         this.candidateY[INTENT_CANDIDATE] = 0;
      }

      // Broad phase classifies both the complete reachable envelope and direct
      // danger to standing/manual intent. If there is no direct danger, there
      // is no reason to score 34 escape candidates this frame.
      var directProjectileThreats:int = 0;
      for(var broadIndex:int = 0; broadIndex < count; broadIndex++) {
         var broadProjectile:Projectile = hostile[broadIndex];
         if(broadProjectile == null || broadProjectile.projProps == null) {
            continue;
         }
         if(!broadProjectile.isThreatTo(player,time)) {
            // A live telegraph laser is not steered around, but its line is a
            // scheduled hazard: the damaging twin spawns along it when the
            // warning expires. Collected here; classified and scored with the
            // other AoE-style telegraphs after the broad phase.
            if(isTelegraphLaser(broadProjectile) &&
                  broadProjectile.isAliveAt(time) &&
                  telegraphLaserTwin(broadProjectile.containerType_) != null) {
               this.relevantTelegraphLasers_.push(broadProjectile);
            }
            continue;
         }
         if(broadProjectile.isLaser()) {
            this.activeLaserCount_++;
            var currentLaserClearance:Number = broadProjectile.laserClearanceTo(
                  player.x_,player.y_);
            if(this.nearestLaserClearance_ < 0 ||
                  currentLaserClearance < this.nearestLaserClearance_) {
               this.nearestLaserClearance_ = currentLaserClearance;
            }
         }
         var broadHitHalfSize:Number = broadProjectile.collisionHalfSize();
         // Most projectiles can be rejected from their immutable spawn/range
         // before any prediction samples are taken. This is an upper bound,
         // not a heuristic: curved/wavy paths cannot leave the radius formed
         // by their total travel plus lateral amplitude. Accelerating attacks
         // retain the full sampler because their extrema require more care.
         if(broadProjectile.projProps.acceleration == 0) {
            var maximumPathRadius:Number = broadProjectile.isLaser() ?
                  broadProjectile.projProps.laserDistance_ :
                  broadProjectile.projProps.parametric ?
                  Math.SQRT2 * Math.abs(broadProjectile.projProps.magnitude) :
                  Math.abs(broadProjectile.projProps.calcDistance(
                        broadProjectile.lifetime,broadProjectile.speedMul)) +
                        Math.abs(broadProjectile.projProps.amplitude);
            var spawnDx:Number = broadProjectile.startX - player.x_;
            var spawnDy:Number = broadProjectile.startY - player.y_;
            var maximumPlayerReach:Number = moveSpeed *
                  (movementLeadMs + this.horizonMs_) + broadHitHalfSize +
                  RELEVANCE_CLEARANCE + this.serverOffsetDistance_;
            if(spawnDx * spawnDx + spawnDy * spawnDy >
                  (maximumPathRadius + maximumPlayerReach) *
                  (maximumPathRadius + maximumPlayerReach)) {
               continue;
            }
         }
         var broadDx:Number = broadProjectile.x_ - player.x_;
         var broadDy:Number = broadProjectile.y_ - player.y_;
         var broadDistanceSq:Number;
         if(broadProjectile.isLaser()) {
            var broadLaserClearance:Number = broadProjectile.laserClearanceTo(
                  player.x_,player.y_);
            broadDistanceSq = broadLaserClearance * broadLaserClearance;
         } else {
            broadDistanceSq = broadDx * broadDx + broadDy * broadDy;
         }
         if(broadDistanceSq < nearestDistanceSq) {
            nearestDistanceSq = broadDistanceSq;
         }
         var envelopeRelevant:Boolean = false;
         var directRelevant:Boolean = false;
         // Player.update runs before BasicObject/Projectile.update. Seed the
         // first interval from the projectile's last rendered position so the
         // scorer evaluates the same current-frame relative-motion sweep that
         // Projectile.sweptPlayerPathHit() will execute later in this frame.
         // The old point-only first sample missed crossings between endpoints.
         var broadPreviousSet:Boolean = !broadProjectile.isLaser();
         if(broadPreviousSet) {
            this.previousProjectilePosition.setTo(broadProjectile.x_,
                  broadProjectile.y_);
         }
         var broadSampleStep:int = requiresFineProjectileSampling(broadProjectile) ?
               SAMPLE_MS : this.loadSampleStepMs_;
         var broadEndOffset:int = int(Math.min(this.horizonMs_,Math.max(0,
               broadProjectile.startTime_ + broadProjectile.lifetime - time)));
         var broadPreviousSample:int = -movementLeadMs;
         sampleOffset = 0;
         while(sampleOffset <= broadEndOffset) {
            var broadTime:int = time + sampleOffset;
            if(!broadProjectile.isAliveAt(broadTime)) {
               break;
            }
            broadProjectile.predictPositionAt(broadTime,this.projectilePosition);
            projectileSamples++;
            var reachable:Number = moveSpeed * (movementLeadMs + sampleOffset) +
                  broadHitHalfSize + RELEVANCE_CLEARANCE;
            var broadIntentOffset:int = movementLeadMs + sampleOffset;
            var broadIntentX:Number = player.x_ + this.candidateX[INTENT_CANDIDATE] *
                  moveSpeed * broadIntentOffset;
            var broadIntentY:Number = player.y_ + this.candidateY[INTENT_CANDIDATE] *
                  moveSpeed * broadIntentOffset;
             if(!broadPreviousSet) {
                envelopeRelevant = this.projectileCorridorPointClearance(
                      broadProjectile,player.x_,player.y_,broadIntentOffset) <= reachable;
                directRelevant = Math.min(
                      this.projectileCorridorPointClearance(broadProjectile,
                            player.x_,player.y_,broadIntentOffset),
                      this.projectileCorridorPointClearance(broadProjectile,
                            broadIntentX,broadIntentY,broadIntentOffset)) <=
                      broadHitHalfSize + RELEVANCE_CLEARANCE;
             } else {
                var broadPreviousOffset:int = movementLeadMs + broadPreviousSample;
                if(this.projectileCorridorSweepClearance(broadProjectile,
                      player.x_,player.y_,player.x_,player.y_,
                      broadPreviousOffset,broadIntentOffset) <= reachable) {
                   envelopeRelevant = true;
                }
               var previousIntentOffset:int = movementLeadMs + broadPreviousSample;
               var previousIntentX:Number = player.x_ + this.candidateX[INTENT_CANDIDATE] *
                     moveSpeed * previousIntentOffset;
               var previousIntentY:Number = player.y_ + this.candidateY[INTENT_CANDIDATE] *
                     moveSpeed * previousIntentOffset;
                if(Math.min(
                      this.projectileCorridorSweepClearance(broadProjectile,
                            player.x_,player.y_,player.x_,player.y_,
                            broadPreviousOffset,broadIntentOffset),
                      this.projectileCorridorSweepClearance(broadProjectile,
                            previousIntentX,previousIntentY,broadIntentX,broadIntentY,
                            broadPreviousOffset,broadIntentOffset)) <=
                       broadHitHalfSize + RELEVANCE_CLEARANCE) {
                  directRelevant = true;
               }
            }
            this.previousProjectilePosition.copyFrom(this.projectilePosition);
            broadPreviousSet = true;
            if(envelopeRelevant && directRelevant || sampleOffset >= broadEndOffset) {
               break;
            }
            broadPreviousSample = sampleOffset;
            sampleOffset = Math.min(broadEndOffset,sampleOffset + broadSampleStep);
         }
         if(envelopeRelevant) {
            this.relevantProjectiles_.push(broadProjectile);
            if(broadProjectile.isLaser()) {
               this.relevantLaserCount_++;
            }
            if(broadProjectile.dodgeFirstRelevantTime_ < 0) {
               broadProjectile.dodgeFirstRelevantTime_ = time;
            }
         }
         if(directRelevant) {
            directProjectileThreats++;
         }
      }
      this.broadPhaseThreatCount_ = this.relevantProjectiles_.length;
      this.directBroadPhaseThreatCount_ = directProjectileThreats;

      // Pre-classify landing effects so far-away throws do not force the full
      // candidate pass. Exact candidate scoring happens after path validation.
      var thrownCount:int = map.activeThrownProjectiles_.length;
      this.activeAoeCount_ = 0;
      var directAoeThreat:Boolean = false;
      var persistentAoeCount:int = 0;
      var persistentCenterX:Number = 0;
      var persistentCenterY:Number = 0;
      for(var broadThrownIndex:int = 0; broadThrownIndex < thrownCount; broadThrownIndex++) {
         var broadThrown:ThrownProjectile = map.activeThrownProjectiles_[broadThrownIndex];
         // THROW is a visual primitive as well as an AoE telegraph. Do not let
         // visual-only arcs steer the player until this map has correlated the
         // effect type with a real server AOE packet.
         if(broadThrown == null || !map.isThrownAoeConfirmed(broadThrown) ||
               map.isThrownAoeHarmless(broadThrown)) {
            continue;
         }
         this.activeAoeCount_++;
         if(broadThrown.persistentAoeWarning_ && broadThrown.end_ != null) {
            persistentAoeCount++;
            persistentCenterX += broadThrown.end_.x;
            persistentCenterY += broadThrown.end_.y;
         }
         var broadLandingOffset:int = map.getThrownAoeLandingOffset(broadThrown);
         // Bomb telegraphs routinely arrive about one second before impact.
         // Projectile look-ahead is intentionally short/configurable, but an
         // announced landing position is deterministic and should be planned
         // around for the complete AoE horizon.
         if(broadLandingOffset <= 0 || broadLandingOffset > this.aoeHorizonMs_ ||
               broadThrown.end_ == null) {
            continue;
         }
         var broadAoeRadius:Number = map.getThrownAoeRadius(broadThrown);
         var broadAoeMoveOffset:int = movementLeadMs + broadLandingOffset;
         var broadCenterDistance:Number = this.pointToServerCorridorDistance(
               broadThrown.end_.x,broadThrown.end_.y,player.x_,player.y_,
               movementLeadMs);
         if(broadCenterDistance > broadAoeRadius + moveSpeed * broadAoeMoveOffset +
               aoeRelevanceClearance) {
            continue;
         }
         this.relevantAoeCount_++;
         this.velocityAoeHorizonMs_ = Math.max(this.velocityAoeHorizonMs_,
               broadLandingOffset);
         if(broadLandingOffset < this.earliestAoeLandingMs_) {
            this.earliestAoeLandingMs_ = broadLandingOffset;
         }
         var broadAoeIntentX:Number = player.x_ + this.candidateX[INTENT_CANDIDATE] *
               moveSpeed * broadAoeMoveOffset;
         var broadAoeIntentY:Number = player.y_ + this.candidateY[INTENT_CANDIDATE] *
               moveSpeed * broadAoeMoveOffset;
         var broadAoeIntentDistance:Number = this.pointToServerCorridorDistance(
               broadThrown.end_.x,broadThrown.end_.y,broadAoeIntentX,
               broadAoeIntentY,broadAoeMoveOffset);
         if(Math.min(broadCenterDistance,
               broadAoeIntentDistance) -
               broadAoeRadius <= aoeRelevanceClearance) {
            directAoeThreat = true;
            this.updateAoeInterventionLead(broadAoeRadius,broadCenterDistance,
                  broadAoeIntentDistance,aoeSafetyClearance,moveSpeed);
         }
      }

      // Holy/Chaos beam SHOW_EFFECT packets announce a fixed strike target and
      // delay but are not THROW effects. Treat those explicit telegraphs as AoE
      // inputs instead of waiting for the damaging AOE packet.
      var telegraphCount:int = map.getTelegraphedAoeCount(time);
      this.activeAoeCount_ += telegraphCount;
      for(var broadTelegraphIndex:int = 0; broadTelegraphIndex < telegraphCount;
            broadTelegraphIndex++) {
         var broadTelegraphOffset:int = Math.max(0,
               map.getTelegraphedAoeImpact(broadTelegraphIndex) - time);
         if(broadTelegraphOffset > this.aoeHorizonMs_) {
            continue;
         }
         var broadTelegraphX:Number = map.getTelegraphedAoeX(broadTelegraphIndex);
         var broadTelegraphY:Number = map.getTelegraphedAoeY(broadTelegraphIndex);
         var broadTelegraphRadius:Number = map.getTelegraphedAoeRadius(broadTelegraphIndex);
         var broadTelegraphMoveOffset:int = movementLeadMs + broadTelegraphOffset;
         var broadTelegraphDistance:Number = this.pointToServerCorridorDistance(
               broadTelegraphX,broadTelegraphY,player.x_,player.y_,movementLeadMs);
         if(broadTelegraphDistance > broadTelegraphRadius +
               moveSpeed * broadTelegraphMoveOffset + aoeRelevanceClearance) {
            continue;
         }
         this.relevantAoeCount_++;
         this.velocityAoeHorizonMs_ = Math.max(this.velocityAoeHorizonMs_,
               broadTelegraphOffset);
         this.earliestAoeLandingMs_ = Math.min(this.earliestAoeLandingMs_,
               broadTelegraphOffset);
         var broadTelegraphIntentX:Number = player.x_ +
               this.candidateX[INTENT_CANDIDATE] * moveSpeed * broadTelegraphMoveOffset;
         var broadTelegraphIntentY:Number = player.y_ +
               this.candidateY[INTENT_CANDIDATE] * moveSpeed * broadTelegraphMoveOffset;
         var broadTelegraphIntentDistance:Number = this.pointToServerCorridorDistance(
               broadTelegraphX,broadTelegraphY,broadTelegraphIntentX,
               broadTelegraphIntentY,broadTelegraphMoveOffset);
         if(Math.min(broadTelegraphDistance,broadTelegraphIntentDistance) -
               broadTelegraphRadius <= aoeRelevanceClearance) {
            directAoeThreat = true;
            this.updateAoeInterventionLead(broadTelegraphRadius,
                  broadTelegraphDistance,broadTelegraphIntentDistance,
                  aoeSafetyClearance,moveSpeed);
         }
      }

      // Telegraph lasers announce a strike LINE the same way SHOW_EFFECT
      // telegraphs announce a strike circle. Impact time is the telegraph's
      // own expiry: the damaging twin spawns there and connects frame-one, so
      // the player must already be off the line by then.
      var broadLaserCount:int = this.relevantTelegraphLasers_.length;
      this.activeAoeCount_ += broadLaserCount;
      for(var broadLaserIndex:int = 0; broadLaserIndex < broadLaserCount;
            broadLaserIndex++) {
         var broadLaser:Projectile = this.relevantTelegraphLasers_[broadLaserIndex];
         var broadLaserImpact:int = int(Math.max(0,
               broadLaser.startTime_ + broadLaser.lifetime - time));
         if(broadLaserImpact > this.aoeHorizonMs_) {
            continue;
         }
         var broadLaserRadius:Number = telegraphLaserDangerRadius(
               telegraphLaserTwin(broadLaser.containerType_));
         var broadLaserMoveOffset:int = movementLeadMs + broadLaserImpact;
         var broadLaserDistance:Number = this.laserLineCorridorDistance(
               broadLaser,player.x_,player.y_,movementLeadMs);
         if(broadLaserDistance > broadLaserRadius +
               moveSpeed * broadLaserMoveOffset + aoeRelevanceClearance) {
            continue;
         }
         this.relevantAoeCount_++;
         this.velocityAoeHorizonMs_ = Math.max(this.velocityAoeHorizonMs_,
               broadLaserImpact);
         this.earliestAoeLandingMs_ = Math.min(this.earliestAoeLandingMs_,
               broadLaserImpact);
         var broadLaserIntentX:Number = player.x_ +
               this.candidateX[INTENT_CANDIDATE] * moveSpeed * broadLaserMoveOffset;
         var broadLaserIntentY:Number = player.y_ +
               this.candidateY[INTENT_CANDIDATE] * moveSpeed * broadLaserMoveOffset;
         var broadLaserIntentDistance:Number = this.laserLineCorridorDistance(
               broadLaser,broadLaserIntentX,broadLaserIntentY,broadLaserMoveOffset);
         if(Math.min(broadLaserDistance,broadLaserIntentDistance) -
               broadLaserRadius <= aoeRelevanceClearance) {
            directAoeThreat = true;
            this.updateAoeInterventionLead(broadLaserRadius,broadLaserDistance,
                  broadLaserIntentDistance,aoeSafetyClearance,moveSpeed);
         }
      }

      // Source-specific live AOE objects are not SHOW_EFFECT throws. Their
      // current position plus the proven pulse cadence is the only pre-impact
      // geometry available. Keep this separate from projectile hitboxes: server
      // AOE collision compares player centre directly to the packet radius.
      var movingEmitterCount:int = map.activeMovingAoeEmitters_.length;
      for(var broadEmitterIndex:int = 0; broadEmitterIndex < movingEmitterCount;
            broadEmitterIndex++) {
         var broadEmitter:MovingAoeEmitter =
               map.activeMovingAoeEmitters_[broadEmitterIndex];
         if(broadEmitter == null || broadEmitter.object_ == null) {
            continue;
         }
         broadEmitter.capturePosition(time);
         if(broadEmitter.isProjectileGuard(time)) {
            var guardX:Number = broadEmitter.predictedX(0);
            var guardY:Number = broadEmitter.predictedY(0);
            var guardDistance:Number = this.pointToServerCorridorDistance(guardX,
                  guardY,player.x_,player.y_,movementLeadMs);
            var guardIntentOffset:int = movementLeadMs + LOCAL_MOBILITY_HORIZON_MS;
            var guardIntentX:Number = player.x_ +
                  this.candidateX[INTENT_CANDIDATE] * moveSpeed * guardIntentOffset;
            var guardIntentY:Number = player.y_ +
                  this.candidateY[INTENT_CANDIDATE] * moveSpeed * guardIntentOffset;
            var guardIntentDistance:Number = this.pointToServerCorridorDistance(
                  broadEmitter.predictedX(LOCAL_MOBILITY_HORIZON_MS),
                  broadEmitter.predictedY(LOCAL_MOBILITY_HORIZON_MS),
                  guardIntentX,guardIntentY,guardIntentOffset);
            if(Math.min(guardDistance,guardIntentDistance) <=
                  broadEmitter.projectileGuardRadius_ + RELEVANCE_CLEARANCE) {
               this.relevantProjectileEmitters_.push(broadEmitter);
               if(Math.min(guardDistance,guardIntentDistance) <=
                     broadEmitter.projectileGuardRadius_) {
                  this.directEmitterThreat_ = true;
                  this.directPortalThreat_ = true;
               }
               this.intendedEmitterClearance_ = Math.min(
                     this.intendedEmitterClearance_,guardIntentDistance -
                     broadEmitter.projectileGuardRadius_);
            }
         }
         if(!broadEmitter.isActive(time)) {
            continue;
         }
         this.activeAoeCount_++;
         var broadEmitterOffset:int = broadEmitter.impactOffset(time);
         if(broadEmitterOffset > this.aoeHorizonMs_) {
            continue;
         }
         var broadEmitterX:Number = broadEmitter.predictedX(broadEmitterOffset);
         var broadEmitterY:Number = broadEmitter.predictedY(broadEmitterOffset);
         var broadEmitterMoveOffset:int = movementLeadMs + broadEmitterOffset;
         var broadEmitterDistance:Number = this.pointToServerCorridorDistance(
               broadEmitterX,broadEmitterY,player.x_,player.y_,movementLeadMs);
         if(broadEmitterDistance > broadEmitter.radius_ +
               moveSpeed * broadEmitterMoveOffset + aoeRelevanceClearance) {
            continue;
         }
         this.relevantAoeCount_++;
         this.velocityAoeHorizonMs_ = Math.max(this.velocityAoeHorizonMs_,
               broadEmitterOffset);
         this.earliestAoeLandingMs_ = Math.min(this.earliestAoeLandingMs_,
               broadEmitterOffset);
         var broadEmitterIntentX:Number = player.x_ +
               this.candidateX[INTENT_CANDIDATE] * moveSpeed * broadEmitterMoveOffset;
         var broadEmitterIntentY:Number = player.y_ +
               this.candidateY[INTENT_CANDIDATE] * moveSpeed * broadEmitterMoveOffset;
         var broadEmitterIntentDistance:Number = this.pointToServerCorridorDistance(
               broadEmitterX,broadEmitterY,broadEmitterIntentX,
               broadEmitterIntentY,broadEmitterMoveOffset);
         if(Math.min(broadEmitterDistance,broadEmitterIntentDistance) -
               broadEmitter.radius_ <= aoeRelevanceClearance) {
            directAoeThreat = true;
            this.updateAoeInterventionLead(broadEmitter.radius_,
                  broadEmitterDistance,broadEmitterIntentDistance,
                  aoeSafetyClearance,moveSpeed);
         }
      }

      var persistentClusterRadius:Number = 0;
      var persistentClusterSolid:Boolean = false;
      if(useAoeClusters && persistentAoeCount >= PERSISTENT_CLUSTER_MIN) {
         persistentCenterX /= persistentAoeCount;
         persistentCenterY /= persistentAoeCount;
         var persistentRadiusSqSum:Number = 0;
         var persistentCenterCovered:Boolean = false;
         for(broadThrownIndex = 0; broadThrownIndex < thrownCount; broadThrownIndex++) {
            broadThrown = map.activeThrownProjectiles_[broadThrownIndex];
            if(!broadThrown.persistentAoeWarning_ || broadThrown.end_ == null) {
               continue;
            }
            var clusterDx:Number = broadThrown.end_.x - persistentCenterX;
            var clusterDy:Number = broadThrown.end_.y - persistentCenterY;
            var clusterMemberRadius:Number = map.getThrownAoeRadius(broadThrown);
            var clusterMemberDistance:Number = Math.sqrt(clusterDx * clusterDx +
                  clusterDy * clusterDy);
            var clusterExtent:Number = clusterMemberDistance + clusterMemberRadius;
            persistentRadiusSqSum += clusterMemberRadius * clusterMemberRadius;
            if(clusterMemberDistance <= clusterMemberRadius) {
               persistentCenterCovered = true;
            }
            if(clusterExtent > persistentClusterRadius) {
               persistentClusterRadius = clusterExtent;
            }
         }
         // A bounding circle is valid only for a genuinely dense, center-filled
         // pattern. Ring and cross attacks intentionally contain safe gaps; the
         // old envelope erased those gaps and made the player flee absurdly far.
         persistentClusterSolid = persistentCenterCovered && persistentClusterRadius > 0 &&
               persistentRadiusSqSum / (persistentClusterRadius *
               persistentClusterRadius) >= 0.55;
         if(persistentClusterSolid) {
            var playerClusterDx:Number = player.x_ - persistentCenterX;
            var playerClusterDy:Number = player.y_ - persistentCenterY;
            if(Math.sqrt(playerClusterDx * playerClusterDx + playerClusterDy * playerClusterDy) <=
                  persistentClusterRadius + aoeRelevanceClearance) {
               directAoeThreat = true;
               this.relevantAoeCount_++;
               this.velocityAoeHorizonMs_ = Math.max(
                     this.velocityAoeHorizonMs_,this.aoeHorizonMs_);
            }
         }
      }

      // A raw AOE packet is already an impact, but many attacks pulse or reuse
      // the same area. Retain recent circles briefly so the first untelegraphed
      // hit causes an evacuation before the next pulse.
      var recentAoeCount:int = map.getRecentAoeCount(time);
      var recentBurstUntil:int = 0;
      for(var recentBurstIndex:int = 0; recentBurstIndex < recentAoeCount;
            recentBurstIndex++) {
         recentBurstUntil = Math.max(recentBurstUntil,
               map.getRecentAoeUntil(recentBurstIndex));
      }
      var recentBurstCount:int = 0;
      var recentBurstCenterX:Number = 0;
      var recentBurstCenterY:Number = 0;
      for(recentBurstIndex = 0; recentBurstIndex < recentAoeCount; recentBurstIndex++) {
         // Packets in one server update share (or nearly share) their expiry.
         // Keeping the window narrow prevents unrelated arena attacks from
         // becoming one enormous exclusion zone.
         if(recentBurstUntil - map.getRecentAoeUntil(recentBurstIndex) > 50) {
            continue;
         }
         recentBurstCount++;
         recentBurstCenterX += map.getRecentAoeX(recentBurstIndex);
         recentBurstCenterY += map.getRecentAoeY(recentBurstIndex);
      }
      var recentBurstRadius:Number = 0;
      var recentBurstSolid:Boolean = false;
      if(useAoeClusters && recentBurstCount >= PERSISTENT_CLUSTER_MIN) {
         recentBurstCenterX /= recentBurstCount;
         recentBurstCenterY /= recentBurstCount;
         var recentRadiusSqSum:Number = 0;
         var recentCenterCovered:Boolean = false;
         for(recentBurstIndex = 0; recentBurstIndex < recentAoeCount; recentBurstIndex++) {
            if(recentBurstUntil - map.getRecentAoeUntil(recentBurstIndex) > 50) {
               continue;
            }
            var burstDx:Number = map.getRecentAoeX(recentBurstIndex) - recentBurstCenterX;
            var burstDy:Number = map.getRecentAoeY(recentBurstIndex) - recentBurstCenterY;
            var burstMemberRadius:Number = map.getRecentAoeRadius(recentBurstIndex);
            var burstMemberDistance:Number = Math.sqrt(burstDx * burstDx + burstDy * burstDy);
            var burstExtent:Number = burstMemberDistance + burstMemberRadius;
            recentRadiusSqSum += burstMemberRadius * burstMemberRadius;
            if(burstMemberDistance <= burstMemberRadius) {
               recentCenterCovered = true;
            }
            recentBurstRadius = Math.max(recentBurstRadius,burstExtent);
         }
         recentBurstSolid = recentCenterCovered && recentBurstRadius > 0 &&
               recentRadiusSqSum / (recentBurstRadius * recentBurstRadius) >= 0.55;
         if(recentBurstSolid) {
            var burstPlayerDx:Number = player.x_ - recentBurstCenterX;
            var burstPlayerDy:Number = player.y_ - recentBurstCenterY;
            var burstIntentOffset:int = movementLeadMs + Math.min(this.horizonMs_,
                  Math.max(0,recentBurstUntil - time));
            var burstIntentDx:Number = player.x_ + this.candidateX[INTENT_CANDIDATE] *
                  moveSpeed * burstIntentOffset - recentBurstCenterX;
            var burstIntentDy:Number = player.y_ + this.candidateY[INTENT_CANDIDATE] *
                  moveSpeed * burstIntentOffset - recentBurstCenterY;
            if(Math.min(Math.sqrt(burstPlayerDx * burstPlayerDx + burstPlayerDy * burstPlayerDy),
                  Math.sqrt(burstIntentDx * burstIntentDx + burstIntentDy * burstIntentDy)) -
                  recentBurstRadius <= aoeRelevanceClearance) {
               directAoeThreat = true;
               this.relevantAoeCount_++;
               this.velocityAoeHorizonMs_ = Math.max(
                     this.velocityAoeHorizonMs_,Math.max(0,
                     recentBurstUntil - time));
            }
         }
      }
      for(var recentBroadIndex:int = 0; recentBroadIndex < recentAoeCount;
            recentBroadIndex++) {
         var recentRadius:Number = map.getRecentAoeRadius(recentBroadIndex);
         var recentX:Number = map.getRecentAoeX(recentBroadIndex);
         var recentY:Number = map.getRecentAoeY(recentBroadIndex);
         var recentRemaining:int = Math.min(this.horizonMs_,
               Math.max(0,map.getRecentAoeUntil(recentBroadIndex) - time));
         var recentIntentOffset:int = movementLeadMs + recentRemaining;
         var recentPlayerDx:Number = recentX - player.x_;
         var recentPlayerDy:Number = recentY - player.y_;
         var recentIntentDx:Number = recentX - (player.x_ +
               this.candidateX[INTENT_CANDIDATE] * moveSpeed * recentIntentOffset);
         var recentIntentDy:Number = recentY - (player.y_ +
               this.candidateY[INTENT_CANDIDATE] * moveSpeed * recentIntentOffset);
         if(Math.min(Math.sqrt(recentPlayerDx * recentPlayerDx + recentPlayerDy * recentPlayerDy),
               Math.sqrt(recentIntentDx * recentIntentDx + recentIntentDy * recentIntentDy)) -
               recentRadius <= aoeRelevanceClearance) {
            directAoeThreat = true;
            this.relevantAoeCount_++;
            this.velocityAoeHorizonMs_ = Math.max(this.velocityAoeHorizonMs_,
                  recentRemaining);
         }
      }

      var onDamagingGround:Boolean = avoidDamagingGround && map.isDamagingGround(player.x_,player.y_);
      var directGroundThreat:Boolean = onDamagingGround;
      var earliestGroundEntry:int = onDamagingGround ? 0 : int.MAX_VALUE;
      if(avoidDamagingGround && !onDamagingGround) {
         for(var groundIntentSample:int = 0; groundIntentSample <= this.horizonMs_;
               groundIntentSample += SAMPLE_MS) {
            var groundIntentOffset:int = movementLeadMs + groundIntentSample;
            if(map.isDamagingGround(
                  player.x_ + this.candidateX[INTENT_CANDIDATE] * moveSpeed * groundIntentOffset,
                  player.y_ + this.candidateY[INTENT_CANDIDATE] * moveSpeed * groundIntentOffset)) {
               directGroundThreat = true;
               earliestGroundEntry = groundIntentSample;
               break;
            }
         }
      }

      // Enemy sprites are not damaging collision geometry. Retain only nearby
      // projectile-capable quest bosses whose origin can create an undodgeable
      // point-blank volley. Generic enemies remain completely absent from this
      // layer, avoiding the old Wine Cellar body-avoidance regression.
      var enemyCount:int = map.questBossEmitters_ != null ?
            map.questBossEmitters_.length : 0;
      var shooterReach:Number = this.shooterCoreRadius_ +
            moveSpeed * LOCAL_MOBILITY_HORIZON_MS;
      var shooterReachSq:Number = shooterReach * shooterReach;
      for(var enemyIndex:int = 0; enemyIndex < enemyCount; enemyIndex++) {
         var nearbyEnemy:GameObject = map.questBossEmitters_[enemyIndex];
         if(nearbyEnemy == null || nearbyEnemy.dead_ || !(nearbyEnemy is Character) ||
               !isPointBlankEmitter(nearbyEnemy)) {
            continue;
         }
         var enemyDx:Number = nearbyEnemy.x_ - player.x_;
         var enemyDy:Number = nearbyEnemy.y_ - player.y_;
         var enemyDistanceSq:Number = enemyDx * enemyDx + enemyDy * enemyDy;
         if(enemyDistanceSq > shooterReachSq) {
            continue;
         }
         this.relevantEnemies_.push(nearbyEnemy);
      }
      var shooterIntentClearance:Number = this.shooterCoreClearanceForVelocity(player,
            this.candidateX[INTENT_CANDIDATE] * moveSpeed,
            this.candidateY[INTENT_CANDIDATE] * moveSpeed);
      this.intendedEmitterClearance_ = Math.min(this.intendedEmitterClearance_,
            shooterIntentClearance);
      this.directEmitterThreat_ = this.directEmitterThreat_ ||
            shooterIntentClearance < 0;
      this.nearestThreatDistance_ = nearestDistanceSq < Number.POSITIVE_INFINITY ?
            Math.sqrt(nearestDistanceSq) : -1;
      if(directProjectileThreats == 0 && !directAoeThreat && !directGroundThreat &&
            !reactiveDamageActive && !this.directEmitterThreat_) {
         this.proposedCandidate = 0;
         this.strategicArmed_ = false;
         this.recordEvaluationTelemetry(profiling,evaluationStart,projectileSamples,
               candidateChecks,invalidCandidates);
         return;
      }
      this.minimumMotionEligible_ = (directProjectileThreats > 0 ||
            this.directEmitterThreat_) &&
            !directAoeThreat && !directGroundThreat && !reactiveDamageActive;

      // Record the first blocked sample rather than invalidating the complete
      // trajectory. A direction blocked at 300 ms is still valid for dodging a
      // projectile arriving in 60 ms. Threat scoring below holds the player at
      // the last reachable point; it must never discard danger after the wall.
      var pathHorizon:int = directAoeThreat || persistentClusterSolid ?
            this.aoeHorizonMs_ : this.horizonMs_;
      // Dense straight-shot encounters already use exact swept segments at a
      // 45-60ms cadence. Match the terrain probe cadence, but record the block
      // at least as early as the former 30ms grid would have done so this saves
      // collision checks without making a wall route look safer.
      var pathSampleStep:int = this.loadSampleStepMs_;
      for(candidate = 1; candidate < CANDIDATE_COUNT; candidate++) {
         for(sampleOffset = 0; sampleOffset <= pathHorizon;
               sampleOffset += pathSampleStep) {
            var pathOffset:int = movementLeadMs + sampleOffset;
            var pathX:Number = player.x_ + this.candidateX[candidate] * moveSpeed * pathOffset;
            var pathY:Number = player.y_ + this.candidateY[candidate] * moveSpeed * pathOffset;
            var pathOpen:Boolean = map.canOccupyForDodge(pathX,pathY,
                  !onDamagingGround);
            if(pathOpen && this.serverRebaseActive_) {
               var pathServerScale:Number = this.serverPathScale(pathOffset);
               pathOpen = map.canOccupyForDodge(
                     pathX + this.serverOffsetX_ * pathServerScale,
                     pathY + this.serverOffsetY_ * pathServerScale,
                     !onDamagingGround);
            }
            if(!pathOpen) {
               this.candidateBlockMs[candidate] = sampleOffset == 0 ? 0 :
                     Math.max(SAMPLE_MS,sampleOffset -
                     (pathSampleStep - SAMPLE_MS));
               if(sampleOffset == 0) {
                  this.candidateValid[candidate] = false;
               }
               invalidCandidates++;
               break;
            }
         }
      }

      // A locally safe dodge can still be strategically bad when it ends in a
      // corner. Measure continuation space for EVERY candidate, including a
      // currently stationary player and routes that do not hit a wall inside
      // this horizon. The previous implementation skipped both cases, so their
      // wall penalty was always zero and the scorer repeatedly backed into a
      // dead end before discovering the wall on a later frame.
      var topologyEnabled:Boolean = this.cornerLookAheadTiles_ > 0 &&
            this.cornerStrength_ > 0;
      var topologyHorizonMs:int = topologyEnabled && moveSpeed > 0 ?
            Math.min(pathHorizon,int(Math.ceil(this.cornerLookAheadTiles_ /
            moveSpeed))) : 0;
      for(candidate = 0; candidate < CANDIDATE_COUNT; candidate++) {
         if(!this.candidateValid[candidate]) {
            continue;
         }
         var routeBlocked:Boolean = this.candidateBlockMs[candidate] < int.MAX_VALUE;
         var reachableMs:int = routeBlocked ?
               Math.max(0,this.candidateBlockMs[candidate] - SAMPLE_MS) :
               pathHorizon;
         // Evaluate every direction at the same configurable strategic distance.
         // The old 90-ms cap inspected only 0.78 tiles at the speed in the Realm
         // trace, then certified eight exits even when the refined route ended at
         // a wall several frames later.
         var topologyReachableMs:int = topologyEnabled ?
               Math.min(reachableMs,topologyHorizonMs) : 0;
         var endpointOffset:int = movementLeadMs + topologyReachableMs;
         var endpointX:Number = player.x_ + this.candidateX[candidate] *
               moveSpeed * endpointOffset;
         var endpointY:Number = player.y_ + this.candidateY[candidate] *
               moveSpeed * endpointOffset;
         var escapeOptions:int = topologyEnabled ? 0 : 8;
         if(topologyEnabled) {
            for(var escapeIndex:int = 0; escapeIndex < 8; escapeIndex++) {
               var escapeCandidate:int = 1 + escapeIndex * 4;
               var escapeX:Number = this.candidateX[escapeCandidate];
               var escapeY:Number = this.candidateY[escapeCandidate];
               if(map.canOccupyForDodge(endpointX + escapeX *
                     WALL_ESCAPE_PROBE_DISTANCE,endpointY + escapeY *
                     WALL_ESCAPE_PROBE_DISTANCE,!onDamagingGround)) {
                  escapeOptions++;
               }
            }
         }
         this.candidateEscapeOptions[candidate] = escapeOptions;
         var approachingInsideProbe:Boolean = topologyEnabled && routeBlocked &&
               this.candidateBlockMs[candidate] <= topologyHorizonMs;
         var approachRatio:Number = approachingInsideProbe ?
               (topologyHorizonMs > 0 ? 1 - topologyReachableMs /
               Number(topologyHorizonMs) : 1) : 0;
         var wallPenalty:Number = topologyEnabled ? this.cornerStrength_ *
               (approachRatio * WALL_APPROACH_RISK +
               (8 - escapeOptions) / 8 * WALL_TOPOLOGY_RISK) : 0;
         this.candidateWallPenalty[candidate] = wallPenalty;
         this.candidateRisk[candidate] += wallPenalty;
      }

      // Do not steer around enemy sprites. This scores only the small emission
      // core of a quest boss when the requested path would enter or remain in
      // it. Stopping outside the core is safe; from inside, candidates are
      // ranked by their short-horizon progress out of it.
      if(this.relevantEnemies_.length > 0) {
         if(this.directEmitterThreat_ && !this.directPortalThreat_) {
            this.threatCount++;
            this.earliestSafetyBreachMs = 0;
         }
         for(candidate = 0; candidate < CANDIDATE_COUNT; candidate++) {
            if(!this.candidateValid[candidate]) {
               continue;
            }
            var emitterClearance:Number = this.shooterCoreClearanceForVelocity(player,
                  this.candidateX[candidate] * moveSpeed,
                  this.candidateY[candidate] * moveSpeed);
            this.candidateScore[candidate] = Math.min(
                  this.candidateScore[candidate],emitterClearance);
            this.candidateSafetyScore[candidate] = Math.min(
                  this.candidateSafetyScore[candidate],emitterClearance);
            if(emitterClearance < 0) {
               this.candidateRisk[candidate] += SHOOTER_CORE_RISK -
                     emitterClearance * SHOOTER_CORE_RISK;
            }
         }
      }

      // O3's portal can create a complete point-blank volley before a client
      // frame ever sees the individual projectiles. Score only the two exact
      // portal source types registered by Map; ordinary enemy sprites remain
      // completely absent from this guard.
      if(this.relevantProjectileEmitters_.length > 0) {
         if(this.directPortalThreat_) {
            this.threatCount++;
            this.earliestSafetyBreachMs = 0;
         }
         var portalEmitterCount:int = this.relevantProjectileEmitters_.length;
         for(var portalEmitterIndex:int = 0;
               portalEmitterIndex < portalEmitterCount; portalEmitterIndex++) {
            var portalEmitter:MovingAoeEmitter =
                  this.relevantProjectileEmitters_[portalEmitterIndex];
            var portalEffectiveDamage:int = Math.max(0,player.damageWithDefense(
                  portalEmitter.projectileGuardDamage_,player.defense_,false,
                  player.condition_));
            var portalVolleyDamage:int = portalEffectiveDamage *
                  portalEmitter.projectileGuardShots_;
            for(candidate = 0; candidate < CANDIDATE_COUNT; candidate++) {
               if(!this.candidateValid[candidate]) {
                  continue;
               }
               var portalClearance:Number =
                     this.projectileEmitterClearanceForVelocity(player,
                     portalEmitter,this.candidateX[candidate] * moveSpeed,
                     this.candidateY[candidate] * moveSpeed,movementLeadMs);
               this.candidateScore[candidate] = Math.min(
                     this.candidateScore[candidate],portalClearance);
               this.candidateSafetyScore[candidate] = Math.min(
                     this.candidateSafetyScore[candidate],portalClearance);
               if(portalClearance < 0) {
                  this.candidateExpectedDamage[candidate] += portalVolleyDamage;
                  this.candidateImminentDamage[candidate] += portalVolleyDamage;
                  this.candidateRisk[candidate] += SHOOTER_CORE_RISK -
                        portalClearance * SHOOTER_CORE_RISK +
                        portalVolleyDamage * PROJECTILE_DAMAGE_RISK;
                  this.candidateImpactMs[candidate] = 0;
               }
            }
         }
      }

      // A server HP drop with no matching local projectile/AoE/ground collision
      // proves the current location is unsafe even when the missing mechanic is
      // not yet decoded. Model a small, short-lived exclusion circle at the
      // observed hit position. This preserves a safe manual direction, chooses
      // any reachable escape when stationary, and stops once outside the circle.
      if(reactiveDamageActive) {
         var reactiveSample:int = Math.min(this.horizonMs_,450);
         var reactiveDirect:Boolean = false;
         for(candidate = 0; candidate < CANDIDATE_COUNT; candidate++) {
            if(!this.candidateValid[candidate]) {
               continue;
            }
            var reactiveTravel:int = reactiveSample;
            if(this.candidateBlockMs[candidate] < int.MAX_VALUE) {
               reactiveTravel = Math.min(reactiveTravel,
                     Math.max(0,this.candidateBlockMs[candidate] - SAMPLE_MS));
            }
            var reactiveOffset:int = movementLeadMs + reactiveTravel;
            var reactivePlayerX:Number = player.x_ + this.candidateX[candidate] *
                  moveSpeed * reactiveOffset;
            var reactivePlayerY:Number = player.y_ + this.candidateY[candidate] *
                  moveSpeed * reactiveOffset;
            var reactiveDx:Number = reactivePlayerX - this.reactiveDamageX_;
            var reactiveDy:Number = reactivePlayerY - this.reactiveDamageY_;
            var reactiveClearance:Number = Math.sqrt(reactiveDx * reactiveDx +
                  reactiveDy * reactiveDy) - REACTIVE_DAMAGE_RADIUS;
            if(reactiveClearance < this.candidateScore[candidate]) {
               this.candidateScore[candidate] = reactiveClearance;
            }
            if(reactiveClearance < this.candidateSafetyScore[candidate]) {
               this.candidateSafetyScore[candidate] = reactiveClearance;
            }
            if(reactiveClearance < 0) {
               this.candidateExpectedDamage[candidate] += this.reactiveDamageAmount_;
               this.candidateImminentDamage[candidate] += this.reactiveDamageAmount_;
               this.candidateRisk[candidate] += 4 - reactiveClearance * 2;
               this.candidateImpactMs[candidate] = 0;
               if(candidate == 0 || candidate == INTENT_CANDIDATE) {
                  reactiveDirect = true;
               }
            }
         }
         this.threatCount++;
         if(reactiveDirect) {
            this.earliestImpactMs = 0;
            this.earliestSafetyBreachMs = 0;
         }
      }

      count = this.relevantProjectiles_.length;
      for(var index:int = 0; index < count; index++) {
         var projectile:Projectile = this.relevantProjectiles_[index];
         var projectilePhysicalHalfSize:Number = projectile.collisionHalfSize();
         var projectileSafetyMargin:Number = this.effectiveProjectileSafetyMargin(
               projectile,projectileSafetyClearance);
         var projectileEffectiveDamage:int = Math.max(0,player.damageWithDefense(
               projectile.damage_,player.defense_,projectile.projProps.armorPiercing_,
               player.condition_));
         var projectileEffectRisk:Number = projectileConditionRisk(projectile);
         for(candidate = 0; candidate < CANDIDATE_COUNT; candidate++) {
            this.candidateThreatClearance_[candidate] = Number.POSITIVE_INFINITY;
            this.candidateThreatImpactMs_[candidate] = int.MAX_VALUE;
         }
         var standingClearance:Number = Number.POSITIVE_INFINITY;
         var intentClearance:Number = Number.POSITIVE_INFINITY;
         var previousSet:Boolean = !projectile.isLaser();
         if(previousSet) {
            this.previousProjectilePosition.setTo(projectile.x_,projectile.y_);
         }
         var exactSampleStep:int = requiresFineProjectileSampling(projectile) ?
               SAMPLE_MS : this.loadSampleStepMs_;
         var exactEndOffset:int = int(Math.min(this.horizonMs_,Math.max(0,
               projectile.startTime_ + projectile.lifetime - time)));
         var previousSampleOffset:int = -movementLeadMs;
         sampleOffset = 0;
         while(sampleOffset <= exactEndOffset) {
            var sampleTime:int = time + sampleOffset;
            if(!projectile.isAliveAt(sampleTime)) {
               break;
            }
            projectile.predictPositionAt(sampleTime,this.projectilePosition);
            projectileSamples++;
            if(previousSet && !projectile.isLaser() &&
                  !map.isProjectileSegmentOpen(this.previousProjectilePosition.x,
                  this.previousProjectilePosition.y,this.projectilePosition.x,
                  this.projectilePosition.y,projectile)) {
               break;
            }
            for(candidate = 0; candidate < CANDIDATE_COUNT; candidate++) {
               if(!this.candidateValid[candidate]) {
                  continue;
               }
               var candidateTravelMs:int = sampleOffset;
               if(this.candidateBlockMs[candidate] < int.MAX_VALUE) {
                  candidateTravelMs = Math.min(candidateTravelMs,
                        Math.max(0,this.candidateBlockMs[candidate] - SAMPLE_MS));
               }
               var movementOffset:int = movementLeadMs + candidateTravelMs;
               var playerX:Number = player.x_ + this.candidateX[candidate] * moveSpeed * movementOffset;
               var playerY:Number = player.y_ + this.candidateY[candidate] * moveSpeed * movementOffset;
               var rawClearance:Number;
               var impactOffset:int = sampleOffset;
               if(!previousSet) {
                  rawClearance = this.projectileCorridorPointClearance(projectile,
                        playerX,playerY,movementOffset);
               } else {
                  var previousTravelMs:int = previousSampleOffset;
                  if(this.candidateBlockMs[candidate] < int.MAX_VALUE) {
                     previousTravelMs = Math.min(previousTravelMs,
                           Math.max(0,this.candidateBlockMs[candidate] - SAMPLE_MS));
                  }
                  var previousMovementOffset:int = movementLeadMs + previousTravelMs;
                  var previousPlayerX:Number = player.x_ + this.candidateX[candidate] *
                        moveSpeed * previousMovementOffset;
                  var previousPlayerY:Number = player.y_ + this.candidateY[candidate] *
                        moveSpeed * previousMovementOffset;
                  rawClearance = this.projectileCorridorSweepClearance(projectile,
                        previousPlayerX,previousPlayerY,playerX,playerY,
                        previousMovementOffset,movementOffset);
                  impactOffset = Math.max(0,previousSampleOffset);
               }
               // Literal damage always uses the collision engine's boundary.
               // The configured hitbox percentage only reduces the additional
               // soft margin through projectileSafetyMargin.
               var clearance:Number = rawClearance - projectilePhysicalHalfSize;
               candidateChecks++;
               if(clearance < this.candidateScore[candidate]) {
                  this.candidateScore[candidate] = clearance;
               }
               if(clearance < this.candidateThreatClearance_[candidate]) {
                  this.candidateThreatClearance_[candidate] = clearance;
               }
               if(clearance <= 0 &&
                     impactOffset < this.candidateImpactMs[candidate]) {
                  this.candidateImpactMs[candidate] = impactOffset;
               }
               if(clearance <= 0 &&
                     impactOffset < this.candidateThreatImpactMs_[candidate]) {
                  this.candidateThreatImpactMs_[candidate] = impactOffset;
               }
               if(candidate == 0 && clearance < standingClearance) {
                  standingClearance = clearance;
                  if(clearance <= projectileSafetyMargin &&
                        impactOffset < this.earliestSafetyBreachMs) {
                     this.earliestSafetyBreachMs = impactOffset;
                  }
                  if(clearance <= 0 &&
                        impactOffset < this.earliestImpactMs) {
                     this.earliestImpactMs = impactOffset;
                  }
               }
               if(candidate == INTENT_CANDIDATE && clearance < intentClearance) {
                  intentClearance = clearance;
                  if(clearance <= projectileSafetyMargin &&
                        impactOffset < this.earliestSafetyBreachMs) {
                     this.earliestSafetyBreachMs = impactOffset;
                  }
                  if(clearance <= 0 &&
                        impactOffset < this.earliestImpactMs) {
                     this.earliestImpactMs = impactOffset;
                  }
               }
            }
            this.previousProjectilePosition.copyFrom(this.projectilePosition);
            previousSet = true;
            if(sampleOffset >= exactEndOffset) {
               break;
            }
            previousSampleOffset = sampleOffset;
            sampleOffset = Math.min(exactEndOffset,sampleOffset + exactSampleStep);
         }
         for(candidate = 0; candidate < CANDIDATE_COUNT; candidate++) {
            var threatClearance:Number = this.candidateThreatClearance_[candidate];
            if(isFinite(threatClearance)) {
               this.candidateSafetyScore[candidate] = Math.min(
                     this.candidateSafetyScore[candidate],
                     threatClearance - projectileSafetyMargin);
            }
            if(isFinite(threatClearance) && threatClearance < projectileSafetyMargin) {
               this.candidateRisk[candidate] += 1 +
                     (projectileSafetyMargin - threatClearance) * 2;
            }
            if(isFinite(threatClearance) && threatClearance <= 0) {
               this.candidateExpectedDamage[candidate] += projectileEffectiveDamage;
               this.candidateRisk[candidate] += projectileEffectiveDamage *
                      PROJECTILE_DAMAGE_RISK + projectileEffectRisk;
               if(this.candidateThreatImpactMs_[candidate] <=
                     PREDICTIVE_NEXUS_LEAD_MS) {
                  this.candidateImminentDamage[candidate] += projectileEffectiveDamage;
               }
            }
         }
         var effectiveIntentClearance:Number = this.candidateValid[INTENT_CANDIDATE] ?
               intentClearance : standingClearance;
         if(Math.min(standingClearance,effectiveIntentClearance) <= RELEVANCE_CLEARANCE) {
            this.threatCount++;
         }
      }

      // Thrown SHOW_EFFECT projectiles announce their endpoint and landing
      // time before the AOE damage packet arrives. Score the endpoint at that
      // instant; Map learns the exact radius after the first matching impact.
      for(var thrownIndex:int = 0; thrownIndex < thrownCount; thrownIndex++) {
         var thrown:ThrownProjectile = map.activeThrownProjectiles_[thrownIndex];
         if(thrown == null || !map.isThrownAoeConfirmed(thrown) ||
               map.isThrownAoeHarmless(thrown)) {
            continue;
         }
         var landingOffset:int = map.getThrownAoeLandingOffset(thrown);
         if(landingOffset <= 0 || landingOffset > this.aoeHorizonMs_ || thrown.end_ == null) {
            continue;
         }
         var aoeRadius:Number = map.getThrownAoeRadius(thrown);
         var learnedAoeDamage:int = map.getThrownAoeDamage(thrown);
         var learnedAoeEffect:int = map.getThrownAoeEffect(thrown);
         var learnedAoeEffectDuration:Number =
               map.getThrownAoeEffectDuration(thrown);
         var learnedAoeConditionRisk:Number = aoeConditionRisk(
               learnedAoeEffect,learnedAoeEffectDuration);
         var effectiveAoeDamage:int = learnedAoeDamage >= 0 ?
               Math.max(0,player.damageWithDefense(learnedAoeDamage,player.defense_,
               map.isThrownAoeArmorPiercing(thrown),player.condition_)) : -1;
         var maxReach:Number = moveSpeed * (movementLeadMs + landingOffset);
         var centerDx:Number = thrown.end_.x - player.x_;
         var centerDy:Number = thrown.end_.y - player.y_;
         if(Math.sqrt(centerDx * centerDx + centerDy * centerDy) >
               aoeRadius + maxReach + aoeRelevanceClearance) {
            continue;
         }
         var standingAoeClearance:Number = Number.POSITIVE_INFINITY;
         var intentAoeClearance:Number = Number.POSITIVE_INFINITY;
         for(candidate = 0; candidate < CANDIDATE_COUNT; candidate++) {
            if(!this.candidateValid[candidate]) {
               continue;
            }
            // If a route reaches a wall before impact, evaluate the reachable
            // position held just before that wall. Skipping the candidate here
            // previously left it with zero AoE risk and allowed it to win.
            var aoeTravelMs:int = landingOffset;
            if(this.candidateBlockMs[candidate] < int.MAX_VALUE) {
               aoeTravelMs = Math.min(aoeTravelMs,
                     Math.max(0,this.candidateBlockMs[candidate] - SAMPLE_MS));
            }
            var aoeMovementOffset:int = movementLeadMs + aoeTravelMs;
            var aoePlayerX:Number = player.x_ + this.candidateX[candidate] * moveSpeed * aoeMovementOffset;
            var aoePlayerY:Number = player.y_ + this.candidateY[candidate] * moveSpeed * aoeMovementOffset;
            var aoeClearance:Number = this.pointToServerCorridorDistance(
                  thrown.end_.x,thrown.end_.y,aoePlayerX,aoePlayerY,
                  aoeMovementOffset) - aoeRadius;
            candidateChecks++;
            if(aoeClearance < this.candidateScore[candidate]) {
               this.candidateScore[candidate] = aoeClearance;
            }
            this.candidateSafetyScore[candidate] = Math.min(
                  this.candidateSafetyScore[candidate],
                  aoeClearance - aoeSafetyClearance);
            if(aoeClearance < aoeSafetyClearance) {
               this.candidateRisk[candidate] += 1 +
                     (aoeSafetyClearance - aoeClearance) * 2;
            }
            if(aoeClearance <= 0) {
               // Confirmed throws carry damage learned from their matching AOE
               // packet. Compare that cost with colliding projectiles instead of
               // treating every bomb as equally catastrophic.
               if(effectiveAoeDamage >= 0) {
                  this.candidateExpectedDamage[candidate] += effectiveAoeDamage;
                  this.candidateRisk[candidate] += effectiveAoeDamage *
                        PROJECTILE_DAMAGE_RISK;
                  if(landingOffset <= PREDICTIVE_NEXUS_LEAD_MS) {
                     this.candidateImminentDamage[candidate] += effectiveAoeDamage;
                  }
               } else {
                  this.candidateRisk[candidate] += HARD_AOE_RISK;
               }
               this.candidateRisk[candidate] += learnedAoeConditionRisk;
               if(landingOffset < this.candidateImpactMs[candidate]) {
                  this.candidateImpactMs[candidate] = landingOffset;
               }
            }
            if(candidate == 0) {
               standingAoeClearance = aoeClearance;
               if(aoeClearance <= aoeSafetyClearance &&
                     landingOffset < this.earliestSafetyBreachMs) {
                  this.earliestSafetyBreachMs = landingOffset;
               }
            } else if(candidate == INTENT_CANDIDATE) {
               intentAoeClearance = aoeClearance;
               if(aoeClearance <= aoeSafetyClearance &&
                     landingOffset < this.earliestSafetyBreachMs) {
                  this.earliestSafetyBreachMs = landingOffset;
               }
            }
         }
         var effectiveIntentAoeClearance:Number = this.candidateValid[INTENT_CANDIDATE] ?
               intentAoeClearance : standingAoeClearance;
         if(Math.min(standingAoeClearance,effectiveIntentAoeClearance) <= aoeRelevanceClearance) {
            this.threatCount++;
            if(Math.min(standingAoeClearance,effectiveIntentAoeClearance) <= 0 &&
                  landingOffset < this.earliestImpactMs) {
               this.earliestImpactMs = landingOffset;
            }
         }
      }

      for(var telegraphIndex:int = 0; telegraphIndex < telegraphCount;
            telegraphIndex++) {
         var telegraphLandingOffset:int = Math.max(0,
               map.getTelegraphedAoeImpact(telegraphIndex) - time);
         if(telegraphLandingOffset > this.aoeHorizonMs_) {
            continue;
         }
         var telegraphX:Number = map.getTelegraphedAoeX(telegraphIndex);
         var telegraphY:Number = map.getTelegraphedAoeY(telegraphIndex);
         var telegraphRadius:Number = map.getTelegraphedAoeRadius(telegraphIndex);
         var telegraphRawDamage:int = map.getTelegraphedAoeDamage(telegraphIndex);
         var telegraphEffectiveDamage:int = telegraphRawDamage >= 0 ?
               Math.max(0,player.damageWithDefense(telegraphRawDamage,
               player.defense_,map.isTelegraphedAoeArmorPiercing(telegraphIndex),
               player.condition_)) : -1;
         var telegraphRelevant:Boolean = false;
         for(candidate = 0; candidate < CANDIDATE_COUNT; candidate++) {
            if(!this.candidateValid[candidate]) {
               continue;
            }
            var telegraphTravelMs:int = telegraphLandingOffset;
            if(this.candidateBlockMs[candidate] < int.MAX_VALUE) {
               telegraphTravelMs = Math.min(telegraphTravelMs,
                     Math.max(0,this.candidateBlockMs[candidate] - SAMPLE_MS));
            }
            var telegraphMoveOffset:int = movementLeadMs + telegraphTravelMs;
            var telegraphPlayerX:Number = player.x_ + this.candidateX[candidate] *
                  moveSpeed * telegraphMoveOffset;
            var telegraphPlayerY:Number = player.y_ + this.candidateY[candidate] *
                  moveSpeed * telegraphMoveOffset;
            var telegraphClearance:Number = this.pointToServerCorridorDistance(
                  telegraphX,telegraphY,telegraphPlayerX,telegraphPlayerY,
                  telegraphMoveOffset) - telegraphRadius;
            candidateChecks++;
            if(telegraphClearance < this.candidateScore[candidate]) {
               this.candidateScore[candidate] = telegraphClearance;
            }
            this.candidateSafetyScore[candidate] = Math.min(
                  this.candidateSafetyScore[candidate],
                  telegraphClearance - aoeSafetyClearance);
            if(telegraphClearance < aoeSafetyClearance) {
               this.candidateRisk[candidate] += 1 +
                     (aoeSafetyClearance - telegraphClearance) * 2;
            }
            if(telegraphClearance <= 0) {
               if(telegraphEffectiveDamage >= 0) {
                  this.candidateExpectedDamage[candidate] +=
                        telegraphEffectiveDamage;
                  this.candidateRisk[candidate] += telegraphEffectiveDamage *
                        PROJECTILE_DAMAGE_RISK;
                  if(telegraphLandingOffset <= PREDICTIVE_NEXUS_LEAD_MS) {
                     this.candidateImminentDamage[candidate] +=
                           telegraphEffectiveDamage;
                  }
               } else {
                  // Unknown beam sources remain in the hard tier; known Oryx
                  // beam families carry exact damage from packet captures.
                  this.candidateRisk[candidate] += HARD_AOE_RISK;
                  this.candidateExpectedDamage[candidate] +=
                        Math.max(1,player.maxHP_);
                  if(telegraphLandingOffset <= PREDICTIVE_NEXUS_LEAD_MS) {
                     this.candidateImminentDamage[candidate] +=
                           Math.max(1,player.maxHP_);
                  }
               }
               this.candidateImpactMs[candidate] = Math.min(
                     this.candidateImpactMs[candidate],telegraphLandingOffset);
            }
            if((candidate == 0 || candidate == INTENT_CANDIDATE) &&
                  telegraphClearance <= aoeRelevanceClearance) {
               telegraphRelevant = true;
               if(telegraphClearance <= aoeSafetyClearance) {
                  this.earliestSafetyBreachMs = Math.min(this.earliestSafetyBreachMs,
                        telegraphLandingOffset);
               }
               if(telegraphClearance <= 0) {
                  this.earliestImpactMs = Math.min(this.earliestImpactMs,
                        telegraphLandingOffset);
               }
            }
         }
         if(telegraphRelevant) {
            this.threatCount++;
         }
      }

      // Score candidate endpoints against each telegraph laser's line at its
      // expiry, exactly as circle telegraphs are scored at their landing. The
      // twin's real damage (from the container's projectile table) ranks the
      // route against other hazards instead of a flat hard tier.
      var laserTelegraphCount:int = this.relevantTelegraphLasers_.length;
      for(var laserTelegraphIndex:int = 0; laserTelegraphIndex < laserTelegraphCount;
            laserTelegraphIndex++) {
         var laserTelegraph:Projectile =
               this.relevantTelegraphLasers_[laserTelegraphIndex];
         var laserTelegraphImpact:int = int(Math.max(0,
               laserTelegraph.startTime_ + laserTelegraph.lifetime - time));
         if(laserTelegraphImpact > this.aoeHorizonMs_) {
            continue;
         }
         var laserTwin:ProjectileProperties = telegraphLaserTwin(
               laserTelegraph.containerType_);
         var laserTelegraphRadius:Number = telegraphLaserDangerRadius(laserTwin);
         var laserTwinDamage:int = laserTwin != null ? Math.max(0,
               player.damageWithDefense(laserTwin.maxDamage_,player.defense_,
               laserTwin.armorPiercing_,player.condition_)) : -1;
         var laserTelegraphRelevant:Boolean = false;
         for(candidate = 0; candidate < CANDIDATE_COUNT; candidate++) {
            if(!this.candidateValid[candidate]) {
               continue;
            }
            var laserTravelMs:int = laserTelegraphImpact;
            if(this.candidateBlockMs[candidate] < int.MAX_VALUE) {
               laserTravelMs = Math.min(laserTravelMs,
                     Math.max(0,this.candidateBlockMs[candidate] - SAMPLE_MS));
            }
            var laserMoveOffset:int = movementLeadMs + laserTravelMs;
            var laserPlayerX:Number = player.x_ + this.candidateX[candidate] *
                  moveSpeed * laserMoveOffset;
            var laserPlayerY:Number = player.y_ + this.candidateY[candidate] *
                  moveSpeed * laserMoveOffset;
            var laserClearance:Number = this.laserLineCorridorDistance(
                  laserTelegraph,laserPlayerX,laserPlayerY,laserMoveOffset) -
                  laserTelegraphRadius;
            candidateChecks++;
            if(laserClearance < this.candidateScore[candidate]) {
               this.candidateScore[candidate] = laserClearance;
            }
            this.candidateSafetyScore[candidate] = Math.min(
                  this.candidateSafetyScore[candidate],
                  laserClearance - aoeSafetyClearance);
            if(laserClearance < aoeSafetyClearance) {
               this.candidateRisk[candidate] += 1 +
                     (aoeSafetyClearance - laserClearance) * 2;
            }
            if(laserClearance <= 0) {
               if(laserTwinDamage >= 0) {
                  this.candidateExpectedDamage[candidate] += laserTwinDamage;
                  this.candidateRisk[candidate] += laserTwinDamage *
                        PROJECTILE_DAMAGE_RISK;
                  if(laserTelegraphImpact <= PREDICTIVE_NEXUS_LEAD_MS) {
                     this.candidateImminentDamage[candidate] += laserTwinDamage;
                  }
               } else {
                  this.candidateRisk[candidate] += HARD_AOE_RISK;
               }
               this.candidateImpactMs[candidate] = Math.min(
                     this.candidateImpactMs[candidate],laserTelegraphImpact);
            }
            if((candidate == 0 || candidate == INTENT_CANDIDATE) &&
                  laserClearance <= aoeRelevanceClearance) {
               laserTelegraphRelevant = true;
               if(laserClearance <= aoeSafetyClearance) {
                  this.earliestSafetyBreachMs = Math.min(this.earliestSafetyBreachMs,
                        laserTelegraphImpact);
               }
               if(laserClearance <= 0) {
                  this.earliestImpactMs = Math.min(this.earliestImpactMs,
                        laserTelegraphImpact);
               }
            }
         }
         if(laserTelegraphRelevant) {
            this.threatCount++;
         }
      }

      for(var emitterIndex:int = 0; emitterIndex < movingEmitterCount;
            emitterIndex++) {
         var scoredEmitter:MovingAoeEmitter =
               map.activeMovingAoeEmitters_[emitterIndex];
         if(scoredEmitter == null || scoredEmitter.object_ == null ||
               !scoredEmitter.isActive(time)) {
            continue;
         }
         var emitterLandingOffset:int = scoredEmitter.impactOffset(time);
         if(emitterLandingOffset > this.aoeHorizonMs_) {
            continue;
         }
         var scoredEmitterX:Number = scoredEmitter.predictedX(emitterLandingOffset);
         var scoredEmitterY:Number = scoredEmitter.predictedY(emitterLandingOffset);
         var emitterEffectiveDamage:int = scoredEmitter.damage_ >= 0 ?
               Math.max(0,player.damageWithDefense(scoredEmitter.damage_,
               player.defense_,scoredEmitter.armorPiercing_,player.condition_)) : -1;
         var emitterConditionRisk:Number = aoeConditionRisk(scoredEmitter.effect_,
               scoredEmitter.effectDuration_);
         var standingEmitterClearance:Number = Number.POSITIVE_INFINITY;
         var intentEmitterClearance:Number = Number.POSITIVE_INFINITY;
         for(candidate = 0; candidate < CANDIDATE_COUNT; candidate++) {
            if(!this.candidateValid[candidate]) {
               continue;
            }
            var emitterTravelMs:int = emitterLandingOffset;
            if(this.candidateBlockMs[candidate] < int.MAX_VALUE) {
               emitterTravelMs = Math.min(emitterTravelMs,
                     Math.max(0,this.candidateBlockMs[candidate] - SAMPLE_MS));
            }
            var emitterMoveOffset:int = movementLeadMs + emitterTravelMs;
            var emitterPlayerX:Number = player.x_ + this.candidateX[candidate] *
                  moveSpeed * emitterMoveOffset;
            var emitterPlayerY:Number = player.y_ + this.candidateY[candidate] *
                  moveSpeed * emitterMoveOffset;
            var movingEmitterClearance:Number = this.pointToServerCorridorDistance(
                  scoredEmitterX,scoredEmitterY,emitterPlayerX,emitterPlayerY,
                  emitterMoveOffset) - scoredEmitter.radius_;
            candidateChecks++;
            this.candidateScore[candidate] = Math.min(this.candidateScore[candidate],
                  movingEmitterClearance);
            this.candidateSafetyScore[candidate] = Math.min(
                  this.candidateSafetyScore[candidate],
                  movingEmitterClearance - aoeSafetyClearance);
            if(movingEmitterClearance < aoeSafetyClearance) {
               this.candidateRisk[candidate] += 1 +
                     (aoeSafetyClearance - movingEmitterClearance) * 2;
            }
            if(movingEmitterClearance <= 0) {
               if(emitterEffectiveDamage >= 0) {
                  this.candidateExpectedDamage[candidate] += emitterEffectiveDamage;
                  this.candidateRisk[candidate] += emitterEffectiveDamage *
                        PROJECTILE_DAMAGE_RISK;
                  if(emitterLandingOffset <= PREDICTIVE_NEXUS_LEAD_MS) {
                     this.candidateImminentDamage[candidate] +=
                           emitterEffectiveDamage;
                  }
               } else {
                  this.candidateRisk[candidate] += HARD_AOE_RISK;
               }
               this.candidateRisk[candidate] += emitterConditionRisk;
               this.candidateImpactMs[candidate] = Math.min(
                     this.candidateImpactMs[candidate],emitterLandingOffset);
            }
            if(candidate == 0) {
               standingEmitterClearance = movingEmitterClearance;
            } else if(candidate == INTENT_CANDIDATE) {
               intentEmitterClearance = movingEmitterClearance;
            }
         }
         var effectiveIntentEmitterClearance:Number =
               this.candidateValid[INTENT_CANDIDATE] ? intentEmitterClearance :
               standingEmitterClearance;
         var minimumEmitterClearance:Number = Math.min(standingEmitterClearance,
               effectiveIntentEmitterClearance);
         if(minimumEmitterClearance <= aoeRelevanceClearance) {
            this.threatCount++;
            if(minimumEmitterClearance <= aoeSafetyClearance) {
               this.earliestSafetyBreachMs = Math.min(this.earliestSafetyBreachMs,
                     emitterLandingOffset);
            }
            if(minimumEmitterClearance <= 0) {
               this.earliestImpactMs = Math.min(this.earliestImpactMs,
                     emitterLandingOffset);
            }
         }
      }

      for(var recentIndex:int = 0; recentIndex < recentAoeCount; recentIndex++) {
         recentRadius = map.getRecentAoeRadius(recentIndex);
         recentX = map.getRecentAoeX(recentIndex);
         recentY = map.getRecentAoeY(recentIndex);
         var recentRepeating:Boolean = map.isRecentAoeRepeating(recentIndex);
         var recentRawDamage:int = map.getRecentAoeDamage(recentIndex);
         var recentEffectiveDamage:int = Math.max(0,player.damageWithDefense(
               recentRawDamage,player.defense_,
               map.getRecentAoeArmorPiercing(recentIndex),player.condition_));
         var recentConditionRisk:Number = aoeConditionRisk(
               map.getRecentAoeEffect(recentIndex),
               map.getRecentAoeEffectDuration(recentIndex));
         recentRemaining = Math.min(this.horizonMs_,
               Math.max(0,map.getRecentAoeUntil(recentIndex) - time));
         var recentRelevant:Boolean = false;
         for(candidate = 0; candidate < CANDIDATE_COUNT; candidate++) {
            if(!this.candidateValid[candidate]) {
               continue;
            }
            var worstRecentClearance:Number = Number.POSITIVE_INFINITY;
            var firstRecentImpact:int = int.MAX_VALUE;
            for(var recentSample:int = 0; recentSample <= recentRemaining;
                  recentSample += SAMPLE_MS) {
               var recentTravelSample:int = recentSample;
               if(this.candidateBlockMs[candidate] < int.MAX_VALUE) {
                  recentTravelSample = Math.min(recentTravelSample,
                        Math.max(0,this.candidateBlockMs[candidate] - SAMPLE_MS));
               }
               var recentMoveOffset:int = movementLeadMs + recentTravelSample;
               var recentCandidateX:Number = player.x_ + this.candidateX[candidate] *
                     moveSpeed * recentMoveOffset;
               var recentCandidateY:Number = player.y_ + this.candidateY[candidate] *
                     moveSpeed * recentMoveOffset;
               var recentClearance:Number = this.pointToServerCorridorDistance(
                     recentX,recentY,recentCandidateX,recentCandidateY,
                     recentMoveOffset) - recentRadius;
               if(recentClearance < worstRecentClearance) {
                  worstRecentClearance = recentClearance;
               }
               if(recentClearance <= 0 && firstRecentImpact == int.MAX_VALUE) {
                  firstRecentImpact = recentSample;
               }
            }
            if(worstRecentClearance < this.candidateScore[candidate]) {
               this.candidateScore[candidate] = worstRecentClearance;
            }
            this.candidateSafetyScore[candidate] = Math.min(
                  this.candidateSafetyScore[candidate],
                  worstRecentClearance - aoeSafetyClearance);
            if(worstRecentClearance < aoeSafetyClearance) {
               this.candidateRisk[candidate] += 1.5 +
                     (aoeSafetyClearance - worstRecentClearance) * 2;
            }
            if(firstRecentImpact < this.candidateImpactMs[candidate]) {
               this.candidateImpactMs[candidate] = firstRecentImpact;
            }
            // A one-off raw AOE packet describes damage that already happened;
            // only an observed repeating location represents expected future
            // damage. The short grace window still supports same-frame geometry.
            if(recentRepeating && firstRecentImpact < int.MAX_VALUE) {
               this.candidateExpectedDamage[candidate] += recentEffectiveDamage;
               this.candidateRisk[candidate] += recentEffectiveDamage *
                     PROJECTILE_DAMAGE_RISK + recentConditionRisk;
               if(firstRecentImpact <= PREDICTIVE_NEXUS_LEAD_MS) {
                  this.candidateImminentDamage[candidate] += recentEffectiveDamage;
               }
            }
            if((candidate == 0 || candidate == INTENT_CANDIDATE) &&
                  worstRecentClearance <= aoeRelevanceClearance) {
               recentRelevant = true;
               if(firstRecentImpact < this.earliestImpactMs) {
                  this.earliestImpactMs = firstRecentImpact;
               }
               if(worstRecentClearance <= aoeSafetyClearance &&
                     firstRecentImpact < this.earliestSafetyBreachMs) {
                  this.earliestSafetyBreachMs = firstRecentImpact;
               }
            }
         }
         if(recentRelevant) {
            this.threatCount++;
         }
      }

      // Some Sanctuary patterns provide no useful warning before a group of
      // raw AOE packets. Model the newest same-update burst as one footprint,
      // so an expanding cross/ring makes the player leave the whole pattern
      // instead of stepping between circles that are about to pulse again.
      if(recentBurstSolid) {
         var recentBurstRemaining:int = Math.min(this.horizonMs_,
               Math.max(0,recentBurstUntil - time));
         var currentBurstClearance:Number = this.pointToServerCorridorDistance(
               recentBurstCenterX,recentBurstCenterY,player.x_,player.y_,
               movementLeadMs) - recentBurstRadius;
         if(currentBurstClearance <= aoeRelevanceClearance) {
            this.recentBurstActive_ = true;
            this.recentBurstX_ = recentBurstCenterX;
            this.recentBurstY_ = recentBurstCenterY;
            this.recentBurstRadius_ = recentBurstRadius;
            this.recentBurstRemainingMs_ = recentBurstRemaining;
            this.threatCount++;
            this.earliestSafetyBreachMs = 0;
            for(candidate = 0; candidate < CANDIDATE_COUNT; candidate++) {
               if(!this.candidateValid[candidate]) {
                  continue;
               }
               var burstExposureMs:int = 0;
               var worstBurstClearance:Number = Number.POSITIVE_INFINITY;
               for(var burstSample:int = 0; burstSample <= recentBurstRemaining;
                     burstSample += 60) {
                  var burstTravelSample:int = burstSample;
                  if(this.candidateBlockMs[candidate] < int.MAX_VALUE) {
                     burstTravelSample = Math.min(burstTravelSample,
                           Math.max(0,this.candidateBlockMs[candidate] - SAMPLE_MS));
                  }
                  var burstMoveOffset:int = movementLeadMs + burstTravelSample;
                  var burstPlayerX:Number = player.x_ + this.candidateX[candidate] *
                        moveSpeed * burstMoveOffset;
                  var burstPlayerY:Number = player.y_ + this.candidateY[candidate] *
                        moveSpeed * burstMoveOffset;
                  var burstClearance:Number = this.pointToServerCorridorDistance(
                        recentBurstCenterX,recentBurstCenterY,burstPlayerX,
                        burstPlayerY,burstMoveOffset) - recentBurstRadius;
                  worstBurstClearance = Math.min(worstBurstClearance,burstClearance);
                  if(burstClearance < aoeSafetyClearance) {
                     burstExposureMs += 60;
                  }
               }
               this.candidateScore[candidate] = Math.min(this.candidateScore[candidate],
                     worstBurstClearance);
               this.candidateSafetyScore[candidate] = Math.min(
                     this.candidateSafetyScore[candidate],
                     worstBurstClearance - aoeSafetyClearance);
               this.candidateRisk[candidate] += 1.5 + burstExposureMs /
                     Number(Math.max(60,recentBurstRemaining)) * 4;
               if(currentBurstClearance <= 0) {
                  this.candidateImpactMs[candidate] = 0;
                  this.earliestImpactMs = 0;
               }
            }
         }
      }

      // Four or more simultaneous legacy throws describe a barrage footprint.
      // The observed Realm pattern began damaging after 187 ms, repeated for
      // over two seconds, and enclosed the player. Treat the complete warning
      // ring as a persistent exclusion zone and choose the reachable direction
      // that finishes farthest outside it.
      if(persistentClusterSolid) {
         var currentClusterClearance:Number = this.pointToServerCorridorDistance(
               persistentCenterX,persistentCenterY,player.x_,player.y_,
               movementLeadMs) - persistentClusterRadius;
         if(currentClusterClearance <= aoeRelevanceClearance) {
            this.persistentClusterActive_ = true;
            this.persistentClusterX_ = persistentCenterX;
            this.persistentClusterY_ = persistentCenterY;
            this.persistentClusterRadius_ = persistentClusterRadius;
            this.threatCount++;
            this.earliestSafetyBreachMs = 0;
            this.earliestImpactMs = 0;
            for(candidate = 0; candidate < CANDIDATE_COUNT; candidate++) {
               if(!this.candidateValid[candidate]) {
                  continue;
               }
               var clusterExposureMs:int = 0;
               var worstClusterClearance:Number = Number.POSITIVE_INFINITY;
               for(var clusterSample:int = 0; clusterSample <= this.aoeHorizonMs_;
                     clusterSample += 60) {
                  // A candidate that reaches a wall before the full horizon must
                  // not retain zero risk and win as an "infinitely safe" route.
                  // Hold it at the last valid sample and continue measuring how
                  // long that reachable position remains inside the barrage.
                  var clusterTravelSample:int = clusterSample;
                  if(this.candidateBlockMs[candidate] < int.MAX_VALUE) {
                     clusterTravelSample = Math.min(clusterTravelSample,
                           Math.max(0,this.candidateBlockMs[candidate] - SAMPLE_MS));
                  }
                  var clusterMoveOffset:int = movementLeadMs + clusterTravelSample;
                  var clusterPlayerX:Number = player.x_ + this.candidateX[candidate] *
                        moveSpeed * clusterMoveOffset;
                  var clusterPlayerY:Number = player.y_ + this.candidateY[candidate] *
                        moveSpeed * clusterMoveOffset;
                  var clusterClearance:Number = this.pointToServerCorridorDistance(
                        persistentCenterX,persistentCenterY,clusterPlayerX,
                        clusterPlayerY,clusterMoveOffset) - persistentClusterRadius;
                  if(clusterClearance < worstClusterClearance) {
                     worstClusterClearance = clusterClearance;
                  }
                  if(clusterClearance < aoeSafetyClearance) {
                     clusterExposureMs += 60;
                  }
               }
               // Every path begins inside the barrage, so minimum clearance
               // correctly forces an override. Exposure time then distinguishes
               // the genuinely fastest exit from a path that merely crosses the
               // zone and ends outside on the far side.
               if(worstClusterClearance < this.candidateScore[candidate]) {
                  this.candidateScore[candidate] = worstClusterClearance;
               }
               this.candidateSafetyScore[candidate] = Math.min(
                     this.candidateSafetyScore[candidate],
                     worstClusterClearance - aoeSafetyClearance);
               this.candidateRisk[candidate] += 2 + clusterExposureMs /
                     Number(this.aoeHorizonMs_) * 6;
               this.candidateImpactMs[candidate] = 0;
            }
         }
      }

      // Ground damage is deterministic from the loaded tile XML. It is always
      // a dodge hazard, independent of the user's general Safe Walk preference.
      // When already standing on it, rank directions by how quickly they leave
      // the current damaging tile instead of invalidating every escape at t=0.
      if(onDamagingGround) {
         this.threatCount++;
         this.earliestSafetyBreachMs = 0;
         this.earliestImpactMs = 0;
         for(candidate = 0; candidate < CANDIDATE_COUNT; candidate++) {
            if(!this.candidateValid[candidate]) {
               continue;
            }
            var exposureMs:int = this.horizonMs_ + SAMPLE_MS;
            for(sampleOffset = 0; sampleOffset <= this.horizonMs_; sampleOffset += SAMPLE_MS) {
               var groundTravelMs:int = sampleOffset;
               if(this.candidateBlockMs[candidate] < int.MAX_VALUE) {
                  groundTravelMs = Math.min(groundTravelMs,
                        Math.max(0,this.candidateBlockMs[candidate] - SAMPLE_MS));
               }
               var groundMoveOffset:int = movementLeadMs + groundTravelMs;
               var groundX:Number = player.x_ + this.candidateX[candidate] *
                     moveSpeed * groundMoveOffset;
               var groundY:Number = player.y_ + this.candidateY[candidate] *
                     moveSpeed * groundMoveOffset;
               if(!map.isDamagingGround(groundX,groundY)) {
                  exposureMs = sampleOffset;
                  break;
               }
            }
            var groundScore:Number = -exposureMs / Number(this.horizonMs_ + SAMPLE_MS);
            this.candidateGroundExposureMs_[candidate] = exposureMs;
            if(groundScore < this.candidateScore[candidate]) {
               this.candidateScore[candidate] = groundScore;
            }
            this.candidateSafetyScore[candidate] = Math.min(
                  this.candidateSafetyScore[candidate],groundScore);
            this.candidateRisk[candidate] += exposureMs /
                  Number(this.horizonMs_ + SAMPLE_MS) * 2;
            this.candidateImpactMs[candidate] = 0;
         }
      } else if(directGroundThreat) {
         this.threatCount++;
         if(earliestGroundEntry < this.earliestSafetyBreachMs) {
            this.earliestSafetyBreachMs = earliestGroundEntry;
         }
         if(earliestGroundEntry < this.earliestImpactMs) {
            this.earliestImpactMs = earliestGroundEntry;
         }
         for(candidate = 0; candidate < CANDIDATE_COUNT; candidate++) {
            if(!this.candidateValid[candidate]) {
               continue;
            }
            var candidateGroundEntry:int = int.MAX_VALUE;
            for(sampleOffset = 0; sampleOffset <= this.horizonMs_; sampleOffset += SAMPLE_MS) {
               groundTravelMs = sampleOffset;
               if(this.candidateBlockMs[candidate] < int.MAX_VALUE) {
                  groundTravelMs = Math.min(groundTravelMs,
                        Math.max(0,this.candidateBlockMs[candidate] - SAMPLE_MS));
               }
               groundMoveOffset = movementLeadMs + groundTravelMs;
               groundX = player.x_ + this.candidateX[candidate] * moveSpeed * groundMoveOffset;
               groundY = player.y_ + this.candidateY[candidate] * moveSpeed * groundMoveOffset;
               if(map.isDamagingGround(groundX,groundY)) {
                  candidateGroundEntry = sampleOffset;
                  break;
               }
            }
            if(candidateGroundEntry < int.MAX_VALUE) {
               this.candidateGroundExposureMs_[candidate] =
                     this.horizonMs_ - candidateGroundEntry + SAMPLE_MS;
               this.candidateRisk[candidate] += 2 +
                     (this.horizonMs_ - candidateGroundEntry) / Number(this.horizonMs_);
               if(-0.1 < this.candidateScore[candidate]) {
                  this.candidateScore[candidate] = -0.1;
               }
               this.candidateSafetyScore[candidate] = Math.min(
                     this.candidateSafetyScore[candidate],-0.1);
               if(candidateGroundEntry < this.candidateImpactMs[candidate]) {
                  this.candidateImpactMs[candidate] = candidateGroundEntry;
               }
            }
         }
      }

      // With no manual input the intent candidate duplicates standing still.
      // Normalize any untouched Infinity/NaN score so it cannot be mistaken for
      // an infinitely safe path and trigger preserve_safe_intent.
      if(!isFinite(this.candidateScore[INTENT_CANDIDATE])) {
         this.candidateScore[INTENT_CANDIDATE] = this.candidateScore[0];
         this.candidateSafetyScore[INTENT_CANDIDATE] =
               this.candidateSafetyScore[0];
         this.candidateImpactMs[INTENT_CANDIDATE] = this.candidateImpactMs[0];
         this.candidateBlockMs[INTENT_CANDIDATE] = this.candidateBlockMs[0];
         this.candidateValid[INTENT_CANDIDATE] = this.candidateValid[0];
      }
      // A lower-risk direction is not a usable escape when it reaches a wall
      // before the current threat can pass. Require each moving candidate to
      // remain navigable through the first safety breach plus two samples.
      // Paths blocked later remain eligible for short, urgent dodges.
      var requiredPathMs:int = this.earliestSafetyBreachMs < int.MAX_VALUE ?
            Math.min(pathHorizon,Math.max(PATH_SURVIVAL_MIN_MS,
                  this.earliestSafetyBreachMs + PATH_SURVIVAL_AFTER_BREACH_MS)) :
            Math.min(pathHorizon,this.reactionLeadMs_);
      for(candidate = 1; candidate < CANDIDATE_COUNT; candidate++) {
         if(this.candidateBlockMs[candidate] <= requiredPathMs) {
            this.candidateValid[candidate] = false;
            this.candidateRisk[candidate] += HARD_AOE_RISK;
         }
      }
      // Avoid a predicted lethal volley even when its geometric clearance is
      // only marginally worse than another route. Use the lowest maintained HP
      // estimate because local and server damage reconciliation can be briefly
      // out of phase in dense encounters.
      var survivalHp:int = player.hp_;
      if(player.clientHp > 0) {
         survivalHp = survivalHp > 0 ? Math.min(survivalHp,player.clientHp) : player.clientHp;
      }
      if(player.syncedChp > 0) {
         survivalHp = survivalHp > 0 ? Math.min(survivalHp,player.syncedChp) : player.syncedChp;
      }
      if(survivalHp > 0) {
         for(candidate = 0; candidate < CANDIDATE_COUNT; candidate++) {
            if(this.candidateExpectedDamage[candidate] >= survivalHp) {
               this.candidateRisk[candidate] += HARD_AOE_RISK;
            }
         }
      }
      this.proposedCandidate = 0;
      if(this.threatCount > 0) {
         for(candidate = 1; candidate < CANDIDATE_COUNT; candidate++) {
            if(this.candidateValid[candidate] &&
                  this.isCandidateBetter(candidate,this.proposedCandidate)) {
               this.proposedCandidate = candidate;
            }
         }
         for(candidate = 0; candidate < CANDIDATE_COUNT; candidate++) {
            if(candidate == this.proposedCandidate || !this.candidateValid[candidate]) {
               continue;
            }
            if(this.runnerUpCandidate_ < 0 ||
                  this.isCandidateBetter(candidate,this.runnerUpCandidate_)) {
               this.runnerUpCandidate_ = candidate;
            }
         }
      }
      // Arm Strategic Ack Suppression when the BEST available route still can't
      // avoid damage this frame -- i.e. the incoming hit is genuinely
      // unavoidable. The per-hit gate (shouldSuppressStrategicHit) additionally
      // requires the individual hit to be lethal or large, so ordinary
      // unavoidable chip damage is still taken normally.
      this.strategicArmed_ = this.threatCount > 0 &&
            this.proposedCandidate >= 0 &&
            this.proposedCandidate < CANDIDATE_COUNT &&
            this.candidateExpectedDamage[this.proposedCandidate] > 0.001;
      if(this.strategicArmed_) {
         this.windowStrategicArmed_++;
      }
      this.recordEvaluationTelemetry(profiling,evaluationStart,projectileSamples,
            candidateChecks,invalidCandidates);
   }

   // ---- Strategic Ack Suppression -----------------------------------------
   // strategicArmed_ (best route already can't avoid damage) is diagnostic only.
   // Suppression does NOT require it: a hit that is CONNECTING is, by that fact,
   // one the dodge failed to avoid, so the only question is whether it is big
   // enough to matter. strategicBigHit_ = autoDodgeSuppressThreshold% of max HP.
   private var strategicArmed_:Boolean = false;
   private var strategicSurvivalHp_:int = 0;
   private var strategicBigHit_:int = int.MAX_VALUE;
   private var windowStrategicSuppressed_:int = 0;
   private var windowStrategicArmed_:int = 0;

   /** True when this connecting hit is lethal to current survival HP or at least
    * the configured fraction of max HP. The option gate (projectile vs AoE)
    * lives at each call site; this is the shared magnitude test. When true the
    * caller must NOT apply local damage and must NOT report the hit -- the
    * server, being the non-authority on collision, then never applies it. Chip
    * damage is unaffected. Thresholds are refreshed every frame in
    * evaluateThreats, so a hit is always judged against current HP. */
   public function shouldSuppressStrategicHit(effectiveDamage:int) : Boolean {
      if(effectiveDamage <= 0) {
         return false;
      }
      var lethal:Boolean = this.strategicSurvivalHp_ > 0 &&
            effectiveDamage >= this.strategicSurvivalHp_;
      if(lethal || effectiveDamage >= this.strategicBigHit_) {
         this.windowStrategicSuppressed_++;
         return true;
      }
      return false;
   }

   /** Refresh the suppression magnitude thresholds from current HP and the
    * configured percentage. Called every frame, including no-threat frames, so
    * a hit arriving on any frame is judged correctly. */
   private function updateStrategicThresholds(player:Player) : void {
      var survivalHp:int = player.hp_;
      if(player.clientHp > 0) {
         survivalHp = survivalHp > 0 ? Math.min(survivalHp,player.clientHp) :
               player.clientHp;
      }
      if(player.syncedChp > 0) {
         survivalHp = survivalHp > 0 ? Math.min(survivalHp,player.syncedChp) :
               player.syncedChp;
      }
      this.strategicSurvivalHp_ = survivalHp;
      var percent:Number = Number(Parameters.data.autoDodgeSuppressThreshold);
      if(isNaN(percent)) {
         percent = 10;
      }
      percent = Math.max(1,Math.min(100,percent));
      this.strategicBigHit_ = Math.max(1,int(Math.max(1,player.maxHP_) *
            percent / 100));
   }

   /** Apply the evaluated choice to the existing world-space movement vector. */
   public function applyDodge(player:Player, map:Map, time:int,
                               moveSpeed:Number, movement:Vector3D, movementLeadMs:int) : Boolean {
      var autonomousIntent:Boolean = Parameters.data.autoPlay == true &&
            !player.hasManualMovementInput();
      this.lastAutonomousIntent_ = autonomousIntent;
      // Preserve the previous frame's world-space side before the main scorer
      // may replace selectedCandidate below. The applied-movement feedback is
      // intentionally consumed during evaluation, so it cannot serve as this
      // continuity signal.
      var previousSelectedCandidate:int = this.selectedCandidate;
      if(moveSpeed <= 0 || player.isParalyzed || player.isPetrified) {
         this.lastDecision_ = "movement_locked";
         this.windowLocked_++;
         this.aoeEscapeCandidate_ = -1;
         this.aoeEscapeUntil_ = 0;
         if(time >= this.selectedUntil) {
            this.selectedCandidate = 0;
         }
         return false;
      }

      // A predicted escape is useless if collision resolution never moves the
      // player. This happened in the Realm trace: candidate 33 remained
      // "safe" while the player stayed at exactly (1873,1220) through twelve
      // hits. Once execution feedback or repeated hits arms recovery, abandon
      // the mutable intent slot and commit to a reachable fixed direction.
      if(time < this.stuckEscapeUntil_) {
         // A real keyboard direction always gets the first opportunity to
         // recover control. Only yield when the exact direction makes useful
         // progress through the same collision resolver used by walkTo(); this
         // preserves automated recovery when a held key is simply pushing into
         // the wall that caused the stall.
         if(player.hasManualMovementInput() &&
               this.manualStuckEscapeIsUsable(player,map,moveSpeed,movement,
                     movementLeadMs)) {
            this.clearStuckEscape();
            this.lastDecision_ = "stuck_manual_override";
            this.debugVelocityX = movement.x;
            this.debugVelocityY = movement.y;
            this.debugSpeedScale = 1;
            this.overrideActive = false;
            this.windowManualPreferred_++;
            return false;
         }
         var stuckChoice:int = this.selectStuckEscapeCandidate(player,map,
               moveSpeed,movementLeadMs);
         if(stuckChoice > 0) {
            this.selectedCandidate = stuckChoice;
            this.selectedUntil = Math.max(this.selectedUntil,time + HYSTERESIS_MS);
            this.lastDecision_ = "stuck_damage_escape";
            var stuckApplied:Boolean = this.applyCandidateMovement(player,map,time,moveSpeed,movement,
                  movementLeadMs,stuckChoice,true);
            // The collision preview measures the movement walkTo() can really
            // execute at this half-tile boundary. Use that as feedback instead
            // of immediately declaring the deliberately short slide blocked.
            this.lastAppliedExpectedDistance_ = Math.min(
                  this.lastAppliedExpectedDistance_,this.stuckPreviewDistance_);
            return stuckApplied;
         }
         // Recovery must never fall through to candidate 33. That mutable slot
         // was the failed player/autoplay intent in every stationary-hit loop
         // from the latest Realm trace. A genuinely enclosed player stays put
         // for this frame so the predictive lethal-volley guard can nexus.
         movement.x = 0;
         movement.y = 0;
         this.debugVelocityX = 0;
         this.debugVelocityY = 0;
         this.debugSpeedScale = 0;
         this.overrideActive = true;
         this.lastDecision_ = "stuck_damage_no_route";
         this.lastAppliedTime_ = -1;
         this.lastAppliedCandidate_ = -1;
         this.windowOverrides_++;
         return true;
      }

      // Once a confirmed bomb escape starts, retain the safe corridor through
      // the landing instead of releasing it when a single frame's intent happens
      // to score safe. Replan immediately if a new projectile or wall makes the
      // corridor materially worse than the current best candidate.
      var latchCandidate:int = this.aoeEscapeCandidate_;
      var latchUsable:Boolean = time < this.aoeEscapeUntil_ &&
            latchCandidate >= 0 && latchCandidate < CANDIDATE_COUNT &&
            this.candidateValid[latchCandidate];
      if(latchUsable && this.threatCount > 0) {
         var latchScore:Number = this.candidateSafetyScore[latchCandidate];
         var bestScore:Number = this.candidateSafetyScore[this.proposedCandidate];
         var materiallyBetterClearance:Boolean = latchScore < 0 &&
               (bestScore >= 0 || bestScore > latchScore +
               Math.max(0.05,this.requiredSafetyClearance_));
         var materiallyLaterImpact:Boolean =
               this.candidateExpectedDamage[this.proposedCandidate] <=
                     this.candidateExpectedDamage[latchCandidate] + 0.001 &&
               this.candidateImpactMs[latchCandidate] < int.MAX_VALUE &&
               this.candidateImpactMs[this.proposedCandidate] >
                     this.candidateImpactMs[latchCandidate] +
                     UNAVOIDABLE_IMPACT_BAND_MS;
         if(this.candidateExpectedDamage[latchCandidate] >
                   this.candidateExpectedDamage[this.proposedCandidate] + 0.001 ||
               !this.groundExposureNoWorse(latchCandidate,
                     this.proposedCandidate) ||
               this.candidateRisk[latchCandidate] >
                   this.candidateRisk[this.proposedCandidate] + 0.001 ||
               materiallyBetterClearance || materiallyLaterImpact) {
            latchUsable = false;
         }
      }
      if(latchUsable) {
         this.selectedCandidate = latchCandidate;
         this.lastDecision_ = "aoe_escape_latched";
         this.planAoeEscapeSpeed(player,map,time,moveSpeed,movementLeadMs,
               latchCandidate);
         return this.applyCandidateMovement(player,map,time,moveSpeed,movement,
               movementLeadMs,latchCandidate,false);
      }
      if(time >= this.aoeEscapeUntil_ || this.aoeEscapeCandidate_ >= 0) {
         this.aoeEscapeCandidate_ = -1;
         this.aoeEscapeUntil_ = 0;
      }
      if(this.threatCount == 0) {
         this.lastDecision_ = "no_threat";
         this.windowNoThreat_++;
         if(time >= this.selectedUntil) {
            this.selectedCandidate = 0;
         }
         if(this.applyProactiveSpacing(player,map,time,moveSpeed,movement,
               movementLeadMs,autonomousIntent)) {
            return true;
         }
         return false;
      }

      var intendedScore:Number = this.candidateSafetyScore[INTENT_CANDIDATE];
      this.cornerEscapeActive_ = this.shouldEscapeCorner(player,moveSpeed);
      // A trajectory can enter the safety margin without crossing the nominal
      // hitbox in our sampled model. Previously earliestImpactMs stayed infinite
      // and suppressed every correction; 16 long-lead hits in one session came
      // from that exact impact_not_imminent state. Trigger on margin breach time,
      // while retaining physical impact time for emergency classification.
      var interventionLeadMs:int = Math.max(this.reactionLeadMs_,
            this.aoeInterventionLeadMs_);
      // Manual Movement Priority belongs to a human holding a movement key. An
      // Auto Play route is only strategic intent and must yield when that local
      // trajectory predicts a real collision. The July 21 high-SPD traces
      // showed the distinction:
      // a zero-damage candidate existed, but autonomous forward intent was
      // repeatedly retained until the player entered a fresh volley.
      // Automated movement may look projectile-safe while its collision path is
      // about to terminate in a dead end. Do not let that state bypass the open
      // route selected by the strategic scorer. A real keyboard direction is
      // deliberately exempt: corner preference alone must never fight the user.
      var intentPathUsable:Boolean = this.candidateValid[INTENT_CANDIDATE] ||
            player.hasManualMovementInput();
      var autonomousIntentSafe:Boolean = autonomousIntent &&
            !this.cornerEscapeActive_ && intentPathUsable &&
            this.candidateValid[INTENT_CANDIDATE] &&
            this.candidateExpectedDamage[INTENT_CANDIDATE] <= 0.001 &&
            this.candidateSafetyScore[INTENT_CANDIDATE] >= 0 &&
            this.candidateRisk[INTENT_CANDIDATE] < HARD_AOE_RISK &&
            this.groundExposureNoWorse(INTENT_CANDIDATE,
                  this.proposedCandidate);
      if(autonomousIntentSafe || !autonomousIntent &&
            !this.cornerEscapeActive_ && intentPathUsable &&
            (intendedScore >= 0 ||
             this.earliestSafetyBreachMs > interventionLeadMs)) {
         this.lastDecision_ = autonomousIntentSafe ? "autoplay_safe_intent" :
               (intendedScore >= 0 ? "preserve_safe_intent" :
               "impact_not_imminent");
         this.windowPreservedSafe_++;
         return false;
      }

      var choice:int = this.proposedCandidate;
      var proposedRisk:Number = this.candidateRisk[choice];
      var proposedExpectedDamage:Number = this.candidateExpectedDamage[choice];
      var proposedHardTier:Boolean = proposedRisk >= HARD_AOE_RISK;
      var intentX:Number = this.candidateX[INTENT_CANDIDATE];
      var intentY:Number = this.candidateY[INTENT_CANDIDATE];
      var manualInfluence:Number = optionNumber("autoDodgeManualInfluence",0.75,0,0.75);
      if(autonomousIntent) {
         // Auto Play may preserve useful forward progress among genuinely safe
         // routes, but it must not inherit a high manual-control setting during
         // a predicted collision. Human keyboard priority remains unchanged.
         manualInfluence = Math.min(manualInfluence,0.25);
      }
      if(this.relevantAoeCount_ > 0 &&
            this.earliestAoeLandingMs_ < this.aoeInterventionLeadMs_) {
         // Preserve the configured control level while there is time, then
         // progressively narrow it near a confirmed landing deadline. This is
         // geometry-driven and does not make ordinary projectile steering more
         // aggressive.
         var deadlineRange:Number = Math.max(1,
               this.aoeInterventionLeadMs_ - EMERGENCY_OVERRIDE_MS);
         var deadlineControl:Number = Math.max(0.15,Math.min(1,
               (this.earliestAoeLandingMs_ - EMERGENCY_OVERRIDE_MS) /
               deadlineRange));
         manualInfluence *= deadlineControl;
      }
      this.lastEffectiveManualInfluence_ = manualInfluence;
      var manualRiskTolerance:Number = manualInfluence * 2;
      var bestDot:Number;
      var dot:Number;
      var candidate:int;
      var hasManualIntent:Boolean = intentLengthSquared(intentX,intentY) > 0.000001;
      // At the maximum setting, a safety-margin-only warning must not wrest the
      // controls away. The exact requested trajectory is retained while it has
      // no predicted damage and is outside every hard/unknown danger tier. Soft
      // margin risk can accumulate across dozens of Wine Cellar projectiles and
      // nearby shooters; it must not defeat this guarantee. A real physical
      // intersection still has an impact time and enters emergency arbitration.
      if(!this.cornerEscapeActive_ && player.hasManualMovementInput() &&
            manualInfluence >= 0.7 && hasManualIntent &&
            this.earliestImpactMs >= EMERGENCY_OVERRIDE_MS &&
            this.candidateValid[INTENT_CANDIDATE] &&
            this.candidateExpectedDamage[INTENT_CANDIDATE] <= 0.001 &&
            this.candidateExpectedDamage[INTENT_CANDIDATE] <=
                  proposedExpectedDamage + 0.001 &&
            this.groundExposureNoWorse(INTENT_CANDIDATE,choice) &&
            this.candidateRisk[INTENT_CANDIDATE] < HARD_AOE_RISK) {
         this.lastDecision_ = "maximum_manual_preserved";
         this.windowManualPreferred_++;
         this.windowPreservedSafe_++;
         return false;
      }
      if(this.cornerEscapeActive_) {
         this.lastDecision_ = "corner_escape";
      }
      else if(this.earliestImpactMs >= EMERGENCY_OVERRIDE_MS) {
         this.lastDecision_ = "gentle_override";
         // For a non-emergency correction, choose the safe direction closest to
         // what the player/controller requested instead of maximizing clearance.
         bestDot = Number.NEGATIVE_INFINITY;
         // Include INTENT_CANDIDATE itself. The old upper bound stopped at the
         // fixed directions, so the exact direction requested by the player
         // could be scored as safe and then excluded from the gentle choice.
         for(candidate = 0; candidate < CANDIDATE_COUNT; candidate++) {
            if(!this.candidateValid[candidate] ||
                  (!proposedHardTier && this.candidateRisk[candidate] >= HARD_AOE_RISK) ||
                  this.candidateExpectedDamage[candidate] > proposedExpectedDamage + 0.001 ||
                  !this.groundExposureNoWorse(candidate,this.proposedCandidate) ||
                  this.candidateRisk[candidate] > proposedRisk + manualRiskTolerance ||
                  this.candidateSafetyScore[candidate] < 0) {
               continue;
            }
            dot = this.candidateX[candidate] * intentX + this.candidateY[candidate] * intentY;
            if(dot > bestDot) {
               bestDot = dot;
               choice = candidate;
            }
         }
         if(choice != this.proposedCandidate) {
            this.lastDecision_ = "gentle_manual_blend";
            this.windowManualPreferred_++;
         }
      }
      else {
         this.lastDecision_ = "emergency_override";
         // Preserve as much manual steering as possible without giving up a
         // materially safer escape. More direction samples make this a small
         // correction around the shot instead of a coarse 22.5-degree snap.
         var bestEmergencyScore:Number = this.candidateSafetyScore[choice];
         if(hasManualIntent &&
               bestEmergencyScore >= 0) {
            var acceptableScore:Number = Math.max(0,
                  bestEmergencyScore - manualInfluence);
            bestDot = Number.NEGATIVE_INFINITY;
            for(candidate = 0; candidate < CANDIDATE_COUNT; candidate++) {
               if(!this.candidateValid[candidate] ||
                     (!proposedHardTier && this.candidateRisk[candidate] >= HARD_AOE_RISK) ||
                     this.candidateExpectedDamage[candidate] > proposedExpectedDamage + 0.001 ||
                     !this.groundExposureNoWorse(candidate,this.proposedCandidate) ||
                     this.candidateRisk[candidate] > proposedRisk + manualRiskTolerance ||
                     this.candidateSafetyScore[candidate] < acceptableScore) {
                  continue;
               }
               dot = this.candidateX[candidate] * intentX + this.candidateY[candidate] * intentY;
               if(dot > bestDot) {
                  bestDot = dot;
                  choice = candidate;
               }
            }
            if(choice != this.proposedCandidate) {
               this.lastDecision_ = "emergency_manual_blend";
               this.windowManualPreferred_++;
            }
         }
         else if(hasManualIntent && proposedExpectedDamage <= 0.001) {
            // When every candidate is predicted to collide, maximizing a tiny
            // safety-margin difference can wrest control away without saving the
            // player. Manual blending is allowed only while no route predicts a
            // physical hit. Once literal damage is unavoidable, retain the
            // lowest-damage route instead of trading survival for input alignment.
            var bestImpactMs:int = this.candidateImpactMs[choice];
            var acceptableImpactMs:int = Math.max(0,bestImpactMs - UNAVOIDABLE_IMPACT_BAND_MS);
            var acceptableClearance:Number = this.candidateScore[choice] -
                  UNAVOIDABLE_CLEARANCE_BAND;
            bestDot = Number.NEGATIVE_INFINITY;
            for(candidate = 0; candidate < CANDIDATE_COUNT; candidate++) {
               if(!this.candidateValid[candidate] ||
                     (!proposedHardTier && this.candidateRisk[candidate] >= HARD_AOE_RISK) ||
                     this.candidateExpectedDamage[candidate] > proposedExpectedDamage + 0.001 ||
                     !this.groundExposureNoWorse(candidate,this.proposedCandidate) ||
                     this.candidateRisk[candidate] > proposedRisk + manualRiskTolerance ||
                     this.candidateImpactMs[candidate] < acceptableImpactMs ||
                     this.candidateScore[candidate] < acceptableClearance) {
                  continue;
               }
               dot = this.candidateX[candidate] * intentX + this.candidateY[candidate] * intentY;
               if(dot > bestDot) {
                  bestDot = dot;
                  choice = candidate;
               }
            }
            if(choice != this.proposedCandidate) {
               this.lastDecision_ = "unavoidable_manual_blend";
               this.windowManualPreferred_++;
            }
         }
      }

      // Retain a still-safe recent choice unless the new option is materially
      // safer. This suppresses left/right oscillation in symmetric patterns.
      var choiceIntentDot:Number = this.candidateX[choice] * intentX + this.candidateY[choice] * intentY;
      var selectedIntentDot:Number = this.candidateX[this.selectedCandidate] * intentX +
            this.candidateY[this.selectedCandidate] * intentY;
      if(!this.cornerEscapeActive_ && time < this.selectedUntil &&
            this.selectedCandidate >= 0 &&
            this.candidateValid[this.selectedCandidate] &&
            this.candidateExpectedDamage[this.selectedCandidate] <=
                  this.candidateExpectedDamage[choice] + 0.001 &&
            this.groundExposureNoWorse(this.selectedCandidate,choice) &&
            this.candidateRisk[this.selectedCandidate] <= this.candidateRisk[choice] + 0.001 &&
            this.candidateSafetyScore[this.selectedCandidate] >= 0 &&
            (intentLengthSquared(intentX,intentY) <= 0.000001 ||
             selectedIntentDot >= choiceIntentDot - 0.05) &&
            this.candidateSafetyScore[choice] <
                  this.candidateSafetyScore[this.selectedCandidate] +
                  HYSTERESIS_SCORE_GAIN) {
         choice = this.selectedCandidate;
      } else {
         this.selectedCandidate = choice;
         var selectionHoldMs:int = int(optionNumber("autoDodgeHysteresisMs",100,0,500));
         if(this.earliestAoeLandingMs_ < int.MAX_VALUE &&
               this.candidateRisk[choice] < HARD_AOE_RISK) {
            // Replanning every frame can zig-zag back into the bomb even when
            // every individual prediction looked safe. Briefly retain a safe
            // escape corridor, while the existing safety checks still permit an
            // immediate switch if that corridor becomes dangerous.
            selectionHoldMs = Math.max(selectionHoldMs,
                  Math.min(500,this.earliestAoeLandingMs_));
         }
         this.selectedUntil = time + selectionHoldMs;
      }

      if(this.minimumMotionEligible_ && !this.cornerEscapeActive_) {
         // Direction scoring above establishes the survival tier. Refine that
         // into the collision-free velocity closest to the player's requested
         // velocity; speed reduction is an option, not the objective.
         choice = this.selectIntentPreservingVelocity(player,map,time,
               moveSpeed,movementLeadMs,intentX,intentY,choice,
               previousSelectedCandidate);
         this.selectedCandidate = choice;
      }

      if(choice != 0 && this.relevantAoeCount_ > 0 &&
            this.earliestAoeLandingMs_ < int.MAX_VALUE) {
         var escapeChoice:int = choice;
         if(escapeChoice == INTENT_CANDIDATE) {
            // The intent slot is rewritten from the current input every frame;
            // retaining its index would not retain a corridor. Latch the nearest
            // equivalently safe fixed direction instead (32 directions means at
            // most a 5.625-degree change).
            var escapeDot:Number = Number.NEGATIVE_INFINITY;
            for(var escapeIndex:int = 1; escapeIndex <= DIRECTION_COUNT;
                  escapeIndex++) {
               if(!this.candidateValid[escapeIndex] ||
                     this.candidateExpectedDamage[escapeIndex] >
                           this.candidateExpectedDamage[choice] + 0.001 ||
                     !this.groundExposureNoWorse(escapeIndex,choice) ||
                     this.candidateRisk[escapeIndex] >
                           this.candidateRisk[choice] + 0.001) {
                  continue;
               }
               var currentEscapeDot:Number = this.candidateX[escapeIndex] *
                     this.candidateX[choice] + this.candidateY[escapeIndex] *
                     this.candidateY[choice];
               if(currentEscapeDot > escapeDot) {
                  escapeDot = currentEscapeDot;
                  escapeChoice = escapeIndex;
               }
            }
         }
         // Do not latch a direction for a map-sized or otherwise inescapable
         // AOE when it neither avoids damage nor reaches safety. Re-evaluating
         // those fields each frame preserves projectile/player intent instead
         // of backing into a corner under a useless bomb lock.
         var escapeActuallyImproves:Boolean =
               this.candidateExpectedDamage[escapeChoice] + 0.001 <
                     this.candidateExpectedDamage[0] ||
               this.candidateSafetyScore[escapeChoice] >= 0 &&
                     this.candidateSafetyScore[0] < 0;
         if(escapeChoice != INTENT_CANDIDATE && escapeActuallyImproves) {
            this.aoeEscapeCandidate_ = escapeChoice;
            this.aoeEscapeUntil_ = Math.max(this.aoeEscapeUntil_,time +
                  this.earliestAoeLandingMs_ + AOE_POST_IMPACT_HOLD_MS);
         }
      }
      if(choice != 0 && this.relevantAoeCount_ > 0) {
         this.planAoeEscapeSpeed(player,map,time,moveSpeed,movementLeadMs,choice);
      }
      return this.applyCandidateMovement(player,map,time,moveSpeed,movement,
            movementLeadMs,choice,this.cornerEscapeActive_ &&
            this.relevantAoeCount_ == 0);
   }

   /**
    * Refine an already-selected AoE escape into the velocity closest to the
    * player's intent. In particular, a stationary player gets the smallest
    * speed that reaches the configured circle boundary, rather than being
    * forced to run at full speed until the landing latch expires.
    *
    * The coarse bracket keeps the common case cheap; four bisection probes
    * then resolve the boundary to less than 1/160 of full speed. Every probe
    * passes through the complete projectile, AoE, wall and ground validator.
    */
   private function planAoeEscapeSpeed(player:Player, map:Map, time:int,
                                       moveSpeed:Number, movementLeadMs:int,
                                       choice:int) : void {
      if(choice <= 0 || choice >= CANDIDATE_COUNT || moveSpeed <= 0 ||
            !this.candidateValid[choice]) {
         return;
      }
      var directionX:Number = this.candidateX[choice];
      var directionY:Number = this.candidateY[choice];
      var targetScale:Number = (this.intentVelocityX_ * directionX +
            this.intentVelocityY_ * directionY) / moveSpeed;
      targetScale = Math.max(0,Math.min(1,targetScale));

      // If the velocity requested by the player/follower is already safe, it
      // is the exact optimum and no search is necessary.
      if(this.isVelocitySafe(player,map,time,movementLeadMs,
            directionX * moveSpeed * targetScale,
            directionY * moveSpeed * targetScale)) {
         this.plannedSpeedCandidate_ = choice;
         this.plannedSpeedScale_ = targetScale;
         return;
      }

      // AoE escape along the selected outward corridor is monotonic in the
      // normal case. Find the first safe speed above the requested one. The
      // fixed samples also give a safe fallback when another projectile makes
      // a small non-monotonic pocket in the corridor.
      var lower:Number = targetScale;
      var upper:Number = -1;
      for(var probeIndex:int = 0; probeIndex < AOE_SPEED_PROBES.length;
            probeIndex++) {
         var probe:Number = AOE_SPEED_PROBES[probeIndex];
         if(probe <= targetScale) {
            continue;
         }
         if(this.isVelocitySafe(player,map,time,movementLeadMs,
               directionX * moveSpeed * probe,directionY * moveSpeed * probe)) {
            upper = probe;
            break;
         }
         lower = probe;
      }
      if(upper < 0) {
         // The strategic scorer can intentionally choose the least-damaging
         // route when no fully safe velocity exists. Preserve that route at
         // full speed instead of manufacturing a false stop.
         this.plannedSpeedCandidate_ = choice;
         this.plannedSpeedScale_ = 1;
         return;
      }
      for(var refinement:int = 0; refinement < 4; refinement++) {
         var midpoint:Number = (lower + upper) * 0.5;
         if(this.isVelocitySafe(player,map,time,movementLeadMs,
               directionX * moveSpeed * midpoint,
               directionY * moveSpeed * midpoint)) {
            upper = midpoint;
         } else {
            lower = midpoint;
         }
      }
      this.plannedSpeedCandidate_ = choice;
      this.plannedSpeedScale_ = upper;
   }

   private function applyCandidateMovement(player:Player, map:Map, time:int,
                                             moveSpeed:Number, movement:Vector3D,
                                             movementLeadMs:int, choice:int,
                                             forceFullSpeed:Boolean) : Boolean {
      var speedScale:Number = 1;
      if(!forceFullSpeed && this.plannedSpeedCandidate_ == choice) {
         speedScale = this.plannedSpeedScale_;
      } else if(!forceFullSpeed && choice != 0 && this.candidateValid[choice] &&
            this.candidateSafetyScore[choice] >= 0) {
         speedScale = this.selectManualAlignedSpeed(player,map,time,moveSpeed,
               movementLeadMs,this.candidateX[choice],this.candidateY[choice]);
      }
      movement.x = this.candidateX[choice] * moveSpeed * speedScale;
      movement.y = this.candidateY[choice] * moveSpeed * speedScale;
      if(choice != 0 && movementLeadMs > 0) {
         this.lastAppliedTime_ = time;
         this.lastAppliedX_ = player.x_;
         this.lastAppliedY_ = player.y_;
         this.lastAppliedExpectedDistance_ = moveSpeed * speedScale * movementLeadMs;
         this.lastAppliedCandidate_ = choice;
      } else {
         this.lastAppliedTime_ = -1;
         this.lastAppliedCandidate_ = -1;
      }
      this.debugVelocityX = movement.x;
      this.debugVelocityY = movement.y;
      this.debugSpeedScale = speedScale;
      this.overrideActive = true;
      this.windowOverrides_++;
      this.windowSpeedScaleTotal_ += speedScale;
      if(speedScale < 0.999) {
         this.windowFractionalSpeed_++;
      }
      if(this.earliestImpactMs < EMERGENCY_OVERRIDE_MS) {
         this.windowEmergencyOverrides_++;
      } else {
         this.windowGentleOverrides_++;
      }
      return true;
   }

   // ---- Proactive spacing (idle-time open-floor drift) --------------------
   // How far a direction is probed for open floor, the minimum openness
   // advantage worth moving for, and the gentle fraction of full speed used.
   private static const SPACING_PROBE_TILES:Number = 2.25;
   private static const SPACING_STEP_TILES:Number = 0.45;
   private static const SPACING_MIN_GAIN_TILES:Number = 0.7;
   private static const SPACING_SPEED_FACTOR:Number = 0.45;

   /** When idle with no immediate threat, gently drift toward the most open
    * walkable direction so the next volley is entered with escape room instead
    * of pinned against a wall. Strictly the lowest-priority movement source:
    * it never fires while a threat is active, while the player holds a movement
    * key, or while Auto Play is driving (autonomousIntent) -- those own
    * movement, and Auto Play overwrites this vector after the dodge anyway.
    * Returns true only when it actually writes a drift. */
   private function applyProactiveSpacing(player:Player, map:Map, time:int,
                                          moveSpeed:Number, movement:Vector3D,
                                          movementLeadMs:int,
                                          autonomousIntent:Boolean) : Boolean {
      if(Parameters.data.autoDodgeProactiveSpacing === false || moveSpeed <= 0 ||
            map == null || player.hasManualMovementInput() || autonomousIntent) {
         return false;
      }
      // Never drift while an interactive station is in use range: stations
      // (vault Enchanter, chests, portals) often sit in corners, exactly the
      // geometry the open-floor drift walks away from -- which made the
      // Enchanter unusable. Standing at a station is a deliberate position.
      if(player.nearInteractiveObject_) {
         return false;
      }
      var bestDirection:int = this.spacingCandidate(map,player.x_,player.y_);
      if(bestDirection < 0) {
         return false;
      }
      movement.x = this.candidateX[bestDirection] * moveSpeed * SPACING_SPEED_FACTOR;
      movement.y = this.candidateY[bestDirection] * moveSpeed * SPACING_SPEED_FACTOR;
      // Spacing is optional comfort movement: do not feed the stuck/blocked
      // override detector, and do not count as an emergency override.
      this.lastAppliedTime_ = -1;
      this.lastAppliedCandidate_ = -1;
      this.debugVelocityX = movement.x;
      this.debugVelocityY = movement.y;
      this.debugSpeedScale = SPACING_SPEED_FACTOR;
      this.overrideActive = true;
      this.selectedCandidate = bestDirection;
      this.lastDecision_ = "proactive_spacing";
      this.windowProactiveSpacing_++;
      return true;
   }

   /** The fixed direction (1..DIRECTION_COUNT) toward the most open walkable
    * floor, or -1 when the position is not constrained enough to warrant moving
    * (every axis open within the probe, or no materially more open direction).
    * Shared by manual-idle spacing and the Auto Play stand-and-shoot drift. */
   private function spacingCandidate(map:Map, x:Number, y:Number) : int {
      var bestDirection:int = -1;
      var bestOpen:Number = -1;
      var worstHere:Number = SPACING_PROBE_TILES;
      for(var candidate:int = 1; candidate <= DIRECTION_COUNT; candidate++) {
         var open:Number = this.spacingOpenDistance(map,x,y,
               this.candidateX[candidate],this.candidateY[candidate]);
         if(open < worstHere) {
            worstHere = open;
         }
         if(open > bestOpen) {
            bestOpen = open;
            bestDirection = candidate;
         }
      }
      if(bestDirection < 0 || worstHere >= SPACING_PROBE_TILES ||
            bestOpen < worstHere + SPACING_MIN_GAIN_TILES) {
         return -1;
      }
      return bestDirection;
   }

   /** Auto Play hook: while it would otherwise stand still, ask for a gentle
    * open-floor drift. Writes a world-space unit direction into `out` and
    * returns true when spacing is warranted; does not touch controller movement
    * state (Auto Play owns the movement here). */
   public function proactiveSpacingDirection(map:Map, x:Number, y:Number,
                                             out:Point) : Boolean {
      if(Parameters.data.autoDodgeProactiveSpacing === false || map == null ||
            out == null) {
         return false;
      }
      var best:int = this.spacingCandidate(map,x,y);
      if(best < 0) {
         return false;
      }
      out.setTo(this.candidateX[best],this.candidateY[best]);
      return true;
   }

   /** Walkable distance (tiles, capped at the probe) from (x,y) along a unit
    * direction. Direction (0,0) returns the probe cap. */
   private function spacingOpenDistance(map:Map, x:Number, y:Number,
                                        dirX:Number, dirY:Number) : Number {
      if(dirX == 0 && dirY == 0) {
         return SPACING_PROBE_TILES;
      }
      var travelled:Number = SPACING_STEP_TILES;
      while(travelled <= SPACING_PROBE_TILES) {
         if(!map.canOccupyForDodge(x + dirX * travelled,y + dirY * travelled,
               true)) {
            return travelled - SPACING_STEP_TILES;
         }
         travelled += SPACING_STEP_TILES;
      }
      return SPACING_PROBE_TILES;
   }

   /** Nexus only when even the best modeled route crosses the user's normal
    * Auto Nexus threshold inside the immediate packet/impact window. This is
    * deliberately not based on the current manual route: a dodgeable volley
    * must still be dodged rather than treated as lethal. */
   public function checkPredictiveAutoNexus(player:Player, time:int) : Boolean {
      if(player == null || this.threatCount <= 0) {
         return false;
      }
      var candidate:int = this.proposedCandidate;
      if(this.lastDecision_ == "stuck_damage_no_route") {
         candidate = 0;
      }
      if(candidate < 0 || candidate >= CANDIDATE_COUNT) {
         return false;
      }
      var impactMs:int = this.candidateImpactMs[candidate];
      // Only damage predicted to land within the nexus lead window counts as
      // lethal. The full-horizon expectedDamage sums every threat over up to
      // 1.2 s as if all connect, which nexused at 900/900 HP in swarms —
      // damage arriving beyond the window is re-dodged on later frames.
      var expectedDamage:int = int(Math.ceil(
            this.candidateImminentDamage[candidate]));
      if(expectedDamage <= 0 || impactMs < 0 ||
            impactMs > PREDICTIVE_NEXUS_LEAD_MS) {
         return false;
      }
      return player.checkPredictiveAutoNexus(time,expectedDamage,impactMs,
            candidate,this.threatCount,this.lastDecision_);
   }

   /** Compare the previous frame's requested dodge with the displacement that
    * collision resolution actually produced. Three failed non-zero overrides
    * prove that the model's route and the movement executor disagree. */
   private function updateAppliedMovementFeedback(player:Player, time:int,
                                                   profiling:Boolean) : void {
      if(this.lastAppliedTime_ < 0) {
         return;
      }
      var elapsed:int = time - this.lastAppliedTime_;
      var appliedCandidate:int = this.lastAppliedCandidate_;
      var actualDistance:Number = Math.max(Math.abs(player.x_ - this.lastAppliedX_),
            Math.abs(player.y_ - this.lastAppliedY_));
      if(elapsed >= 0 && elapsed <= 250 &&
            this.lastAppliedExpectedDistance_ >= 0.03 &&
            actualDistance < Math.max(0.01,this.lastAppliedExpectedDistance_ * 0.15)) {
         this.blockedOverrideFrames_ = Math.min(BLOCKED_OVERRIDE_LIMIT,
               this.blockedOverrideFrames_ + 1);
         if(this.blockedOverrideFrames_ >= BLOCKED_OVERRIDE_LIMIT) {
            this.armStuckEscape(player,time,Math.max(1,this.reactiveDamageAmount_),
                  appliedCandidate,"blocked_override",profiling);
         }
      } else {
         this.blockedOverrideFrames_ = 0;
      }
      // Consume this result once. applyCandidateMovement records the current
      // frame again if another override is issued.
      this.lastAppliedTime_ = -1;
      this.lastAppliedCandidate_ = -1;
   }

   private function noteProjectileHit(player:Player, projectile:Projectile,
                                      time:int) : void {
      var hitDx:Number = player.x_ - this.lastProjectileHitX_;
      var hitDy:Number = player.y_ - this.lastProjectileHitY_;
      var stationaryDistanceSq:Number = STATIONARY_HIT_DISTANCE *
            STATIONARY_HIT_DISTANCE;
      if(this.lastProjectileHitTime_ >= 0 &&
            time - this.lastProjectileHitTime_ <= STATIONARY_HIT_WINDOW_MS &&
            hitDx * hitDx + hitDy * hitDy <= stationaryDistanceSq) {
         this.stationaryProjectileHits_++;
      } else {
         this.stationaryProjectileHits_ = 1;
      }
      this.lastProjectileHitTime_ = time;
      this.lastProjectileHitX_ = player.x_;
      this.lastProjectileHitY_ = player.y_;
      if(this.stationaryProjectileHits_ >= 2) {
         var effectiveDamage:int = Math.max(1,player.damageWithDefense(
               projectile.damage_,player.defense_,projectile.projProps.armorPiercing_,
               player.condition_));
         this.armStuckEscape(player,time,effectiveDamage,this.selectedCandidate,
               "stationary_hits",Boolean(Parameters.data.autoDodgeDebug));
      }
   }

   private function armStuckEscape(player:Player, time:int, amount:int,
                                   failedCandidate:int, reason:String,
                                   profiling:Boolean) : void {
      var newlyArmed:Boolean = time >= this.stuckEscapeUntil_;
      if(newlyArmed) {
         this.stuckEscapeX_ = player.x_;
         this.stuckEscapeY_ = player.y_;
         this.stuckFailedCandidates_ = 0;
      }
      var previousFailedMask:uint = this.stuckFailedCandidates_;
      if(failedCandidate >= 1 && failedCandidate <= DIRECTION_COUNT) {
         this.stuckFailedCandidates_ |= uint(1 << (failedCandidate - 1));
      }
      var newlyFailed:Boolean = previousFailedMask != this.stuckFailedCandidates_;
      this.stuckEscapeCandidate_ = -1;
      this.stuckEscapeUntil_ = time + STUCK_ESCAPE_DURATION_MS;
      this.reactiveDamageTime_ = time;
      this.reactiveDamageX_ = this.stuckEscapeX_;
      this.reactiveDamageY_ = this.stuckEscapeY_;
      this.reactiveDamageAmount_ = Math.max(1,amount);
      if(profiling && (newlyArmed || newlyFailed)) {
         DebugLog.event("auto_dodge_stuck_escape_armed",{
               "reason":reason,"new":newlyArmed,
               "hits":this.stationaryProjectileHits_,
               "blockedFrames":this.blockedOverrideFrames_,
               "failedCandidate":failedCandidate,
               "failedMask":this.stuckFailedCandidates_,
               "x":player.x_,"y":player.y_});
      }
   }

   private function clearStuckEscape() : void {
      this.stuckEscapeUntil_ = 0;
      this.stuckEscapeCandidate_ = -1;
      this.stuckFailedCandidates_ = 0;
      this.stationaryProjectileHits_ = 0;
      this.blockedOverrideFrames_ = 0;
   }

   /** Select only immutable world-space directions during recovery. Normal
    * path validity asks whether a direction survives the whole threat window;
    * recovery instead needs the 0.08-0.20 tile collision-resolved slide that
    * can get a player off a wall seam right now. */
   private function selectStuckEscapeCandidate(player:Player, map:Map,
                                                moveSpeed:Number,
                                                movementLeadMs:int) : int {
      var probeDistance:Number = Math.min(STUCK_ESCAPE_MAX_PROBE,
            Math.max(STUCK_ESCAPE_MIN_PROBE,moveSpeed * movementLeadMs));
      var onDamagingGround:Boolean = map.isDamagingGround(player.x_,player.y_);
      var best:int = -1;
      var bestDistance:Number = 0;
      // Once a collision-resolved slide has been selected, keep pushing along
      // it until it becomes blocked. Re-ranking every frame made the Infernal
      // Abyss recovery reverse from candidate 17 to candidate 1 at (164.99,81),
      // pinning the player on the seam instead of completing either slide.
      if(this.stuckEscapeCandidate_ >= 1 &&
            this.stuckEscapeCandidate_ <= DIRECTION_COUNT &&
            (this.stuckFailedCandidates_ & uint(1 <<
                  (this.stuckEscapeCandidate_ - 1))) == 0) {
         var retainedCandidate:int = this.stuckEscapeCandidate_;
         player.previewAutoDodgeMove(player.x_ + this.candidateX[retainedCandidate] *
               probeDistance,player.y_ + this.candidateY[retainedCandidate] *
               probeDistance,this.stuckPreviewPosition_);
         var retainedX:Number = this.stuckPreviewPosition_.x - player.x_;
         var retainedY:Number = this.stuckPreviewPosition_.y - player.y_;
         var retainedDistance:Number = Math.sqrt(retainedX * retainedX +
               retainedY * retainedY);
         if(retainedDistance >= STUCK_ESCAPE_MIN_PROGRESS &&
               (onDamagingGround || !map.isDamagingGround(
                     this.stuckPreviewPosition_.x,this.stuckPreviewPosition_.y))) {
            this.stuckPreviewDistance_ = retainedDistance;
            return retainedCandidate;
         }
         this.stuckFailedCandidates_ |= uint(1 << (retainedCandidate - 1));
         this.stuckEscapeCandidate_ = -1;
      }
      var pass:int = 0;
      for(pass = 0; pass < 2 && best < 0; pass++) {
         for(var candidate:int = 1; candidate <= DIRECTION_COUNT; candidate++) {
            if((this.stuckFailedCandidates_ &
                  uint(1 << (candidate - 1))) != 0) {
               continue;
            }
            player.previewAutoDodgeMove(player.x_ + this.candidateX[candidate] *
                  probeDistance,player.y_ + this.candidateY[candidate] *
                  probeDistance,this.stuckPreviewPosition_);
            var movedX:Number = this.stuckPreviewPosition_.x - player.x_;
            var movedY:Number = this.stuckPreviewPosition_.y - player.y_;
            var movedDistance:Number = Math.sqrt(movedX * movedX + movedY * movedY);
            if(movedDistance < STUCK_ESCAPE_MIN_PROGRESS ||
                  !onDamagingGround && map.isDamagingGround(
                  this.stuckPreviewPosition_.x,this.stuckPreviewPosition_.y)) {
               continue;
            }
            if(best < 0 || this.isCandidateBetter(candidate,best) ||
                  !this.isCandidateBetter(best,candidate) &&
                  movedDistance > bestDistance + 0.005) {
               best = candidate;
               bestDistance = movedDistance;
            }
         }
         if(best < 0 && this.stuckFailedCandidates_ != 0) {
            // Every attempted fixed direction was blocked. Clear only the
            // fixed-direction mask and retry; candidate 33 remains prohibited.
            this.stuckFailedCandidates_ = 0;
         }
      }
      this.stuckEscapeCandidate_ = best;
      this.stuckPreviewDistance_ = bestDistance;
      return best;
   }

   private function manualStuckEscapeIsUsable(player:Player, map:Map,
                                               moveSpeed:Number,
                                               movement:Vector3D,
                                               movementLeadMs:int) : Boolean {
      // Terrain progress alone is not permission to release recovery. The
      // Secluded Thicket trace had a reachable keyboard path predicting 508
      // damage and a fixed escape predicting zero; yielding here caused five
      // simultaneous boss shots to land. Manual input resumes only when its
      // already-scored trajectory is genuinely safe.
      if(this.threatCount > 0 &&
            (!this.candidateValid[INTENT_CANDIDATE] ||
             this.candidateExpectedDamage[INTENT_CANDIDATE] > 0.001 ||
             this.candidateSafetyScore[INTENT_CANDIDATE] < 0 ||
             this.candidateRisk[INTENT_CANDIDATE] >= HARD_AOE_RISK ||
             !this.groundExposureNoWorse(INTENT_CANDIDATE,
                   this.proposedCandidate))) {
         return false;
      }
      var length:Number = Math.sqrt(movement.x * movement.x +
            movement.y * movement.y);
      if(length <= 0.000001) {
         return false;
      }
      var probeDistance:Number = Math.min(STUCK_ESCAPE_MAX_PROBE,
            Math.max(STUCK_ESCAPE_MIN_PROBE,moveSpeed * movementLeadMs));
      var scale:Number = probeDistance / length;
      player.previewAutoDodgeMove(player.x_ + movement.x * scale,
            player.y_ + movement.y * scale,this.stuckPreviewPosition_);
      var movedX:Number = this.stuckPreviewPosition_.x - player.x_;
      var movedY:Number = this.stuckPreviewPosition_.y - player.y_;
      var movedDistance:Number = Math.sqrt(movedX * movedX + movedY * movedY);
      // Require substantial progress so a 0.01-tile collision clamp cannot be
      // mistaken for a usable manual escape and recreate the stationary loop.
      if(movedDistance < Math.max(STUCK_ESCAPE_MIN_PROGRESS,
            probeDistance * 0.45)) {
         return false;
      }
      return map.isDamagingGround(player.x_,player.y_) ||
            !map.isDamagingGround(this.stuckPreviewPosition_.x,
                  this.stuckPreviewPosition_.y);
   }

   private static function isPointBlankEmitter(enemy:GameObject) : Boolean {
      if(enemy == null || enemy.props_ == null || enemy.props_.projectiles_ == null) {
         return false;
      }
      if(!enemy.props_.isQuest_) {
         return false;
      }
      for(var bulletType:* in enemy.props_.projectiles_) {
         return true;
      }
      return false;
   }

   /** Keep status-inflicting zero-damage shots consequential without letting
    * harmless/invincibility-nullified shots drive movement. */
   private static function projectileConditionRisk(projectile:Projectile) : Number {
      if(projectile == null || projectile.projProps == null ||
            projectile.projProps.effects_ == null) {
         return 0;
      }
      var risk:Number = 0;
      for each(var effect:uint in projectile.projProps.effects_) {
         risk = Math.max(risk,aoeConditionRisk(int(effect),1));
      }
      return risk;
   }

   /** Straight and accelerating projectiles are scored with exact swept
    * segments, so denser sampling only repeats points along the same path.
    * Curved/path-parametric shots retain the original 30ms resolution. */
   private static function requiresFineProjectileSampling(projectile:Projectile) : Boolean {
      if(projectile == null || projectile.projProps == null) {
         return true;
      }
      var props:ProjectileProperties = projectile.projProps;
      return props.wavy_ || props.parametric || props.boomerang_ ||
            props.isTurning_ || props.isTurningCircled_;
   }

   // NOTE: an earlier "persistent beam" model gave MultiHit projectiles with
   // >= 2.5 s lifetimes the full AoE planning horizon plus a raised
   // intervention lead. In Oryx's Sanctuary nearly every projectile is
   // MultiHit with a long lifetime, so ordinary minion shots seconds away
   // steered the player constantly (broad-phase threats 2 -> 8 median, gentle
   // overrides 3x, "extreme movement with no projectiles around") and set up a
   // predictive nexus. Deliberately removed; do not reintroduce without a far
   // narrower gate and an explicit opt-in.

   /** The telegraph half of a laser telegraph/beam pair: hostile, zero-damage,
    * effect-less. Excluded from live steering by Projectile.isThreatTo, but
    * its line is where a damaging twin materializes when it expires -- the
    * 07-24 logs show 68/69 laser hits landing within 50 ms of that spawn,
    * which no reactive dodge can beat. */
   private static function isTelegraphLaser(projectile:Projectile) : Boolean {
      return projectile != null && projectile.projProps != null &&
            projectile.isLaser() && projectile.damagesPlayers_ &&
            projectile.damage_ <= 0 &&
            (projectile.projProps.effects_ == null ||
             projectile.projProps.effects_.length == 0);
   }

   /** The damaging laser sibling in the telegraph's container, or null when
    * the container has none (purely cosmetic beam -- not planned around). */
   private static function telegraphLaserTwin(containerType:int) : ProjectileProperties {
      var cached:* = telegraphTwinCache_[containerType];
      if(cached !== undefined) {
         return cached as ProjectileProperties;
      }
      var twin:ProjectileProperties = null;
      var containerProps:ObjectProperties = ObjectLibrary.getPropsFromType(containerType);
      if(containerProps != null && containerProps.projectiles_ != null) {
         for each(var siblingProps:ProjectileProperties in containerProps.projectiles_) {
            if(siblingProps == null || siblingProps.laserDistance_ <= 0 ||
                  siblingProps.maxDamage_ <= 0) {
               continue;
            }
            if(twin == null || siblingProps.maxDamage_ > twin.maxDamage_) {
               twin = siblingProps;
            }
         }
      }
      telegraphTwinCache_[containerType] = twin;
      return twin;
   }

   /** Half-width of the line the damaging twin will strike along. Matches
    * getLaserHit's boundary: laserClearanceTo(player) <= collisionHalfSize. */
   private static function telegraphLaserDangerRadius(twin:ProjectileProperties) : Number {
      return PHYSICAL_HIT_HALF_SIZE * (twin != null ? twin.collisionMult_ : 1);
   }

   /** Distance from the local/server-corridor player anchors to the telegraph
    * laser's line. Line analogue of pointToServerCorridorDistance. */
   private function laserLineCorridorDistance(projectile:Projectile,
                                              playerX:Number, playerY:Number,
                                              movementOffset:int) : Number {
      var localDistance:Number = projectile.laserClearanceTo(playerX,playerY);
      if(!this.serverTemporalActive_) {
         return localDistance;
      }
      var scale:Number = this.serverPathScale(movementOffset);
      return Math.min(localDistance,projectile.laserClearanceTo(
            playerX + this.serverOffsetX_ * scale,
            playerY + this.serverOffsetY_ * scale));
   }

   /** Start an AoE escape only as early as its geometry requires. A fixed
    * 250-ms gate is too late when the player is deep inside a large landing
    * circle, while always moving at the full AoE horizon fights manual input. */
   private function updateAoeInterventionLead(radius:Number,
                                              currentDistance:Number,
                                              intentDistance:Number,
                                              safetyClearance:Number,
                                              moveSpeed:Number) : void {
      if(moveSpeed <= 0) {
         return;
      }
      var unsafeDepth:Number = Math.max(
            radius + safetyClearance - currentDistance,
            radius + safetyClearance - intentDistance);
      if(unsafeDepth <= 0) {
         return;
      }
      // A real escape is rarely perfectly radial: discrete direction samples,
      // walls and preserving manual input all reduce outward speed. Budget the
      // measured depth against a conservative radial component instead of
      // assuming the complete movement vector exits the circle.
      var requiredMs:int = int(Math.ceil(unsafeDepth /
            (moveSpeed * AOE_ESCAPE_SPEED_FACTOR))) +
            AOE_REACTION_MARGIN_MS;
      this.aoeInterventionLeadMs_ = Math.max(this.aoeInterventionLeadMs_,
            Math.min(this.aoeHorizonMs_,requiredMs));
   }

   /** Status effects change the cost of otherwise equal bomb routes. Mobility
    * loss is safety-critical because it can make the next volley unavoidable;
    * other combat debuffs remain a strong soft preference without pretending
    * they are literal HP damage. Effect -1 is a verified harmful status whose
    * exact modern id was not present in the ProdMafia diagnostic. */
   private static function aoeConditionRisk(effect:int, duration:Number) : Number {
      var durationRisk:Number = Math.min(10,Math.max(0,duration));
      switch(effect) {
         case -1:
            return 30;
         case ConditionEffect.PARALYZED:
         case ConditionEffect.PETRIFIED:
         case ConditionEffect.STASIS:
            return HARD_AOE_RISK;
         case ConditionEffect.SLOWED:
         case ConditionEffect.CONFUSED:
         case ConditionEffect.STUNNED:
            return 35 + durationRisk * 5;
         case ConditionEffect.DAZED:
         case ConditionEffect.SICK:
         case ConditionEffect.QUIET:
         case ConditionEffect.SILENCED:
         case ConditionEffect.ARMOR_BROKEN:
         case ConditionEffect.BLEEDING:
         case ConditionEffect.CURSE:
         case ConditionEffect.EXPOSED:
         case ConditionEffect.UNSTABLE:
         case ConditionEffect.DARKNESS:
         case ConditionEffect.BLIND:
         case ConditionEffect.WEAK:
         case ConditionEffect.HALLUCINATING:
         case ConditionEffect.DRUNK:
         case ConditionEffect.HEXED:
         case ConditionEffect.HP_DEBUFF:
         case ConditionEffect.MP_DEBUFF:
         case ConditionEffect.ATT_DEBUFF:
         case ConditionEffect.DEF_DEBUFF:
         case ConditionEffect.SPD_DEBUFF:
         case ConditionEffect.VIT_DEBUFF:
         case ConditionEffect.WIS_DEBUFF:
         case ConditionEffect.DEX_DEBUFF:
            return 15 + durationRisk * 3;
      }
      return 0;
   }

   private function isCandidateBetter(candidate:int, incumbent:int) : Boolean {
      var candidateHardTier:Boolean = this.candidateRisk[candidate] >= HARD_AOE_RISK;
      var incumbentHardTier:Boolean = this.candidateRisk[incumbent] >= HARD_AOE_RISK;
      if(candidateHardTier != incumbentHardTier) {
         return !candidateHardTier;
      }
      var candidateDamage:Number = this.candidateExpectedDamage[candidate];
      var incumbentDamage:Number = this.candidateExpectedDamage[incumbent];
      if(candidateDamage < incumbentDamage - 0.001) {
         return true;
      }
      if(Math.abs(candidateDamage - incumbentDamage) > 0.001) {
         return false;
      }
      var candidateGroundExposure:int =
            this.candidateGroundExposureMs_[candidate];
      var incumbentGroundExposure:int =
            this.candidateGroundExposureMs_[incumbent];
      if(candidateGroundExposure != incumbentGroundExposure) {
         return candidateGroundExposure < incumbentGroundExposure;
      }
      var candidateRiskValue:Number = this.candidateRisk[candidate];
      var incumbentRiskValue:Number = this.candidateRisk[incumbent];
      // A major soft-risk difference can represent a dangerous status effect,
      // not merely comfort clearance. Never trade that away for open floor.
      if(Math.abs(candidateRiskValue - incumbentRiskValue) >
            MOBILITY_RISK_TOLERANCE) {
         return candidateRiskValue < incumbentRiskValue;
      }
      // Once literal predicted damage is equal, prefer an endpoint that keeps
      // several independent exits. Compare broad mobility tiers before soft
      // projectile margins: dozens of nearby harmless margins must not make a
      // corner look strategically safer than open floor.
      var candidateMobilityTier:int = mobilityTier(
            this.candidateEscapeOptions[candidate]);
      var incumbentMobilityTier:int = mobilityTier(
            this.candidateEscapeOptions[incumbent]);
      if(candidateMobilityTier != incumbentMobilityTier) {
         return candidateMobilityTier > incumbentMobilityTier;
      }
      if(candidateRiskValue < incumbentRiskValue - 0.001) {
         return true;
      }
      if(Math.abs(candidateRiskValue - incumbentRiskValue) > 0.001) {
         return false;
      }
      if(this.candidateEscapeOptions[candidate] !=
            this.candidateEscapeOptions[incumbent]) {
         return this.candidateEscapeOptions[candidate] >
               this.candidateEscapeOptions[incumbent];
      }
      if(this.candidateSafetyScore[candidate] >
            this.candidateSafetyScore[incumbent] + 0.001) {
         return true;
      }
      if(Math.abs(this.candidateSafetyScore[candidate] -
            this.candidateSafetyScore[incumbent]) > 0.001) {
         return false;
      }
      return this.candidateImpactMs[candidate] > this.candidateImpactMs[incumbent] ||
            this.candidateImpactMs[candidate] == this.candidateImpactMs[incumbent] &&
            this.candidateScore[candidate] > this.candidateScore[incumbent];
   }

   private function groundExposureNoWorse(candidate:int, reference:int) : Boolean {
      return this.candidateGroundExposureMs_[candidate] <=
            this.candidateGroundExposureMs_[reference] + SAMPLE_MS;
   }

   /** Decide whether automated movement is about to consume its remaining
    * continuation space while projectile pressure is already present. This is
    * intentionally narrower than a generic "prefer open floor" rule: corridors
    * remain valid while they continue forward, and manual keyboard input is
    * never overridden solely because a wall is nearby. */
   private function shouldEscapeCorner(player:Player, moveSpeed:Number) : Boolean {
      if(player == null || player.hasManualMovementInput() || moveSpeed <= 0 ||
            this.cornerLookAheadTiles_ <= 0 || this.cornerStrength_ <= 0 ||
            this.directBroadPhaseThreatCount_ <= 0) {
         return false;
      }
      var proposed:int = this.proposedCandidate;
      if(proposed <= 0 || proposed > DIRECTION_COUNT ||
            !this.candidateValid[proposed] ||
            this.candidateRisk[proposed] >= HARD_AOE_RISK ||
            this.candidateExpectedDamage[proposed] >
                  this.candidateExpectedDamage[INTENT_CANDIDATE] + 0.001 ||
            !this.groundExposureNoWorse(proposed,INTENT_CANDIDATE)) {
         return false;
      }
      var lookAheadMs:int = int(Math.ceil(this.cornerLookAheadTiles_ / moveSpeed));
      var intendedBlockMs:int = this.candidateBlockMs[INTENT_CANDIDATE];
      var intentMoving:Boolean = intentLengthSquared(
            this.candidateX[INTENT_CANDIDATE],
            this.candidateY[INTENT_CANDIDATE]) > 0.000001;
      var approachesDeadEnd:Boolean = intentMoving &&
            intendedBlockMs < int.MAX_VALUE && intendedBlockMs <= lookAheadMs;
      var intendedMobility:int = mobilityTier(
            this.candidateEscapeOptions[INTENT_CANDIDATE]);
      var proposedMobility:int = mobilityTier(
            this.candidateEscapeOptions[proposed]);
      var stationaryConstrained:Boolean = !intentMoving && intendedMobility == 0;
      if(!approachesDeadEnd && !stationaryConstrained) {
         return false;
      }
      var proposedContinues:Boolean = this.candidateBlockMs[proposed] ==
            int.MAX_VALUE || this.candidateBlockMs[proposed] > lookAheadMs;
      var materiallyMoreOpen:Boolean = proposedMobility > intendedMobility ||
            this.candidateWallPenalty[proposed] + 0.5 <
                  this.candidateWallPenalty[INTENT_CANDIDATE];
      return proposedContinues && materiallyMoreOpen;
   }

   private static function mobilityTier(escapeOptions:int) : int {
      if(escapeOptions >= 6) {
         return 2;
      }
      return escapeOptions >= 4 ? 1 : 0;
   }

   public function logDiagnostics(time:int, player:Player = null,
                                  effectiveMoveSpeed:Number = Number.NaN) : void {
      if(!Parameters.data.autoDodgeDebug || time - this.lastThreatLog_ < 1000) {
         return;
      }
      DebugLog.event("auto_dodge_threat_model",{
          "activeHostile":this.activeHostileCount_,
          "activeLasers":this.activeLaserCount_,
          "relevantLasers":this.relevantLaserCount_,
          "telegraphLasers":this.relevantTelegraphLasers_.length,
          "nearestLaserClearance":this.nearestLaserClearance_,
         "broadPhaseThreats":this.broadPhaseThreatCount_,
         "directBroadPhaseThreats":this.directBroadPhaseThreatCount_,
         "activeAoe":this.activeAoeCount_,
          "relevantAoe":this.relevantAoeCount_,
          "relevantEnemies":this.relevantEnemies_.length,
          "enemyBodiesAreHazards":false,
          "questBossEmitterGuard":true,
          "directEmitterThreat":this.directEmitterThreat_,
          "intendedEmitterClearance":isFinite(this.intendedEmitterClearance_) ?
                this.intendedEmitterClearance_ : -1,
          "shooterCoreRadius":this.shooterCoreRadius_,
         "earliestAoeLandingMs":this.earliestAoeLandingMs_ < int.MAX_VALUE ?
               this.earliestAoeLandingMs_ : -1,
         "maxActiveHostile":this.windowMaxHostile_,
         "maxBroadPhaseThreats":this.windowMaxBroad_,
         "maxDirectBroadPhaseThreats":this.windowMaxDirectBroad_,
         "maxActiveAoe":this.windowMaxActiveAoe_,
         "maxRelevantAoe":this.windowMaxRelevantAoe_,
         "relevantThreats":this.threatCount,
         "nearest":this.nearestThreatDistance_,
          "earliestImpactMs":this.earliestImpactMs < int.MAX_VALUE ? this.earliestImpactMs : -1,
         "earliestSafetyBreachMs":this.earliestSafetyBreachMs < int.MAX_VALUE ?
               this.earliestSafetyBreachMs : -1,
         "intendedScore":this.candidateScore[INTENT_CANDIDATE],
         "intendedSafetyScore":this.candidateSafetyScore[INTENT_CANDIDATE],
         "intendedExpectedDamage":this.candidateExpectedDamage[INTENT_CANDIDATE],
         "intendedGroundExposureMs":this.candidateGroundExposureMs_[INTENT_CANDIDATE],
          "intendedRisk":this.candidateRisk[INTENT_CANDIDATE],
          "intendedWallPenalty":this.candidateWallPenalty[INTENT_CANDIDATE],
          "intendedEscapeOptions":this.candidateEscapeOptions[INTENT_CANDIDATE],
         "proposedCandidate":this.proposedCandidate,
         "applied":this.overrideActive,
         "appliedCandidate":this.overrideActive ? this.selectedCandidate : -1,
         "appliedX":this.overrideActive ? this.candidateX[this.selectedCandidate] : 0,
         "appliedY":this.overrideActive ? this.candidateY[this.selectedCandidate] : 0,
          "speedScale":this.debugSpeedScale,
          "minimumMotionEligible":this.minimumMotionEligible_,
          "minimumMotionCandidate":this.plannedSpeedCandidate_,
          "minimumMotionScale":this.plannedSpeedScale_,
          "minimumMotionTests":this.lastMinimumMotionTests_,
          "intentVelocityErrorRatio":isFinite(this.velocityBestError_) &&
                effectiveMoveSpeed > 0.000001 ?
                Math.sqrt(this.velocityBestError_) / effectiveMoveSpeed : -1,
          "shooterCoreClearance":isFinite(this.lastShooterCoreClearance_) ?
                this.lastShooterCoreClearance_ : -1,
         "proposedScore":this.candidateScore[this.proposedCandidate],
         "proposedSafetyScore":this.candidateSafetyScore[this.proposedCandidate],
         "proposedRisk":this.candidateRisk[this.proposedCandidate],
         "proposedExpectedDamage":this.candidateExpectedDamage[this.proposedCandidate],
         "proposedGroundExposureMs":this.candidateGroundExposureMs_[this.proposedCandidate],
         "proposedWallPenalty":this.candidateWallPenalty[this.proposedCandidate],
         "proposedEscapeOptions":this.candidateEscapeOptions[this.proposedCandidate],
         "runnerUpCandidate":this.runnerUpCandidate_,
         "runnerUpRisk":this.runnerUpCandidate_ >= 0 ?
               this.candidateRisk[this.runnerUpCandidate_] : -1,
         "runnerUpExpectedDamage":this.runnerUpCandidate_ >= 0 ?
               this.candidateExpectedDamage[this.runnerUpCandidate_] : -1,
         "runnerUpWallPenalty":this.runnerUpCandidate_ >= 0 ?
               this.candidateWallPenalty[this.runnerUpCandidate_] : -1,
         "proposedImpactMs":this.candidateImpactMs[this.proposedCandidate] < int.MAX_VALUE ?
               this.candidateImpactMs[this.proposedCandidate] : -1,
         "intendedImpactMs":this.candidateImpactMs[INTENT_CANDIDATE] < int.MAX_VALUE ?
               this.candidateImpactMs[INTENT_CANDIDATE] : -1,
         "decision":this.lastDecision_,
         "predictiveEnabled":Boolean(Parameters.data.autoDodgePredictive),
         "aoeClearance":Number(Parameters.data.autoDodgeAoeClearance),
         "projectileClearance":Number(Parameters.data.autoDodgeProjectileClearance),
         "configuredHitboxHalfSize":this.hitHalfSize_,
         "physicalHitboxHalfSize":PHYSICAL_HIT_HALF_SIZE,
         "effectiveRequiredClearance":this.requiredSafetyClearance_,
          "lookAheadMs":this.horizonMs_,
          "localMobilityHorizonMs":LOCAL_MOBILITY_HORIZON_MS,
          "cornerLookAheadTiles":this.cornerLookAheadTiles_,
          "cornerStrength":this.cornerStrength_,
          "cornerEscapeActive":this.cornerEscapeActive_,
          "reactionLeadMs":this.reactionLeadMs_,
         "loadSampleStepMs":this.loadSampleStepMs_,
         "aoeLookAheadMs":this.aoeHorizonMs_,
         "aoeInterventionLeadMs":this.aoeInterventionLeadMs_,
         "playerHitboxPercent":Number(Parameters.data.autoDodgePlayerHitbox),
         "manualInfluence":Number(Parameters.data.autoDodgeManualInfluence),
         "effectiveManualInfluence":this.lastEffectiveManualInfluence_,
         "autonomousIntent":this.lastAutonomousIntent_,
         "aoeEscapeLatched":time < this.aoeEscapeUntil_,
         "aoeEscapeRemainingMs":Math.max(0,this.aoeEscapeUntil_ - time),
         "positionUncertainty":player != null ? player.dodgePositionUncertainty(time) : 0,
         "positionUncertaintyApplied":false,
         "serverPathOffset":this.serverOffsetDistance_,
         "serverRawOffset":this.serverRawOffsetDistance_,
         "serverTemporalActive":this.serverTemporalActive_,
         "serverRebaseActive":this.serverRebaseActive_,
         "hysteresisMs":int(Parameters.data.autoDodgeHysteresisMs),
         "aoeClusters":Boolean(Parameters.data.autoDodgeAoeClusters),
         "avoidGround":Boolean(Parameters.data.autoDodgeAvoidGround),
         "sweptShotCollision":Parameters.data.sweptShotCollision !== false,
         "serverCorridor":Parameters.data.autoDodgeServerCorridor !== false,
         "onDamagingGround":player != null && player.map_ != null ?
               player.map_.isDamagingGround(player.x_,player.y_) : false,
         "speedStat":player != null ? player.speed_ : -1,
         "speedBoost":player != null ? player.speedBoost_ : -1,
         "effectiveMoveSpeed":effectiveMoveSpeed,
         "tileMoveMultiplier":player != null ? player.moveMultDebug() : -1,
         "projectilePredictionLeadMs":this.lastMovementLeadMs_,
         "speedy":player != null && player.isSpeedy,
         "ninjaSpeedy":player != null && player.isNinjaSpeedy,
         "slowed":player != null && player.isSlowed,
         "walking":player != null && player.isWalking,
         "stationaryHits":this.stationaryProjectileHits_,
         "blockedOverrideFrames":this.blockedOverrideFrames_,
         "stuckEscapeRemainingMs":Math.max(0,this.stuckEscapeUntil_ - time),
         "stuckEscapeCandidate":this.stuckEscapeCandidate_,
         "frames":this.windowFrames_,
         "evaluationAvgMs":this.windowFrames_ > 0 ? this.windowEvaluationMs_ / this.windowFrames_ : 0,
         "evaluationMaxMs":this.windowMaxEvaluationMs_,
         "projectileSamples":this.windowProjectileSamples_,
         "candidateChecks":this.windowCandidateChecks_,
         "invalidCandidates":this.windowInvalidCandidates_,
         "overrides":this.windowOverrides_,
         "emergencyOverrides":this.windowEmergencyOverrides_,
         "gentleOverrides":this.windowGentleOverrides_,
         "preservedSafe":this.windowPreservedSafe_,
         "noThreatFrames":this.windowNoThreat_,
         "proactiveSpacingFrames":this.windowProactiveSpacing_,
         "strategicSuppressedHits":this.windowStrategicSuppressed_,
         "strategicArmedFrames":this.windowStrategicArmed_,
         "strategicAckOption":Parameters.data.autoDodgeStrategicAckSuppression === true,
         "strategicAoeAckOption":Parameters.data.autoDodgeSuppressAoeAck === true,
         "strategicBigHitThreshold":this.strategicBigHit_,
         "movementLockedFrames":this.windowLocked_,
         "manualPreferred":this.windowManualPreferred_,
          "fractionalSpeedFrames":this.windowFractionalSpeed_,
          "minimumMotionFrames":this.windowMinimumMotionFrames_,
          "minimumMotionTestCount":this.windowMinimumMotionTests_,
          "averageSpeedScale":this.windowOverrides_ > 0 ?
               this.windowSpeedScaleTotal_ / this.windowOverrides_ : 1
      });
      this.lastThreatLog_ = time;
      this.resetTelemetryWindow();
   }

   private function resetTelemetryWindow() : void {
      this.windowFrames_ = 0;
      this.windowEvaluationMs_ = 0;
      this.windowMaxEvaluationMs_ = 0;
      this.windowProjectileSamples_ = 0;
      this.windowCandidateChecks_ = 0;
      this.windowInvalidCandidates_ = 0;
      this.windowOverrides_ = 0;
      this.windowEmergencyOverrides_ = 0;
      this.windowGentleOverrides_ = 0;
      this.windowPreservedSafe_ = 0;
      this.windowNoThreat_ = 0;
      this.windowProactiveSpacing_ = 0;
      this.windowStrategicSuppressed_ = 0;
      this.windowStrategicArmed_ = 0;
      this.windowLocked_ = 0;
      this.windowManualPreferred_ = 0;
      this.windowFractionalSpeed_ = 0;
      this.windowSpeedScaleTotal_ = 0;
      this.windowMinimumMotionFrames_ = 0;
      this.windowMinimumMotionTests_ = 0;
      this.windowMaxHostile_ = 0;
      this.windowMaxBroad_ = 0;
      this.windowMaxDirectBroad_ = 0;
      this.windowMaxActiveAoe_ = 0;
      this.windowMaxRelevantAoe_ = 0;
   }

   /** Snapshot controller state at an actual local-player projectile collision. */
   public function logHit(player:Player, projectile:Projectile, time:int) : void {
      // Safety feedback must not depend on debug logging. Bleeding ticks can
      // overwrite Player.lastLocalDamageSource immediately after a shot, so the
      // collision callback is the only reliable place to retain this evidence.
      this.noteProjectileHit(player,projectile,time);
      if(!Parameters.data.autoDodgeDebug) {
         return;
      }
      var selectedScore:Number = this.selectedCandidate >= 0 && this.selectedCandidate < CANDIDATE_COUNT ?
            this.candidateScore[this.selectedCandidate] : Number.NaN;
      DebugLog.event("auto_dodge_hit",{
         "time":time,
         "predictiveEnabled":Boolean(Parameters.data.autoDodgePredictive),
         "projectileId":projectile.objectId_,
         "bulletId":projectile.bulletId_,
         "ownerId":projectile.ownerId_,
         "containerType":projectile.containerType_,
         "bulletType":projectile.bulletType_,
          "collisionMult":projectile.projProps.collisionMult_,
          "collisionHalfSize":projectile.collisionHalfSize(),
          "laser":projectile.isLaser(),
          "laserDistance":projectile.projProps.laserDistance_,
          "laserClearance":projectile.isLaser() ?
                projectile.laserClearanceTo(player.x_,player.y_) : -1,
         "recoveryMode":projectile.dodgeRecoveryMode_,
         "recoveryDelayMs":projectile.dodgeRecoveryDelayMs_,
         "spawnDistance":projectile.dodgeSpawnDistance_,
         "shotAgeMs":Math.max(0,time - projectile.startTime_),
         "firstRelevantLeadMs":projectile.dodgeFirstRelevantTime_ >= 0 ?
               time - projectile.dodgeFirstRelevantTime_ : -1,
         "evaluationAgeMs":this.lastEvaluationTime_ >= 0 ?
               time - this.lastEvaluationTime_ : -1,
          "playerX":player.x_,"playerY":player.y_,
          "positionUncertainty":player.dodgePositionUncertainty(time),
          "serverPathOffset":this.serverOffsetDistance_,
          "serverRawOffset":this.serverRawOffsetDistance_,
          "serverTemporalActive":this.serverTemporalActive_,
          "serverRebaseActive":this.serverRebaseActive_,
         "projectileX":projectile.x_,"projectileY":projectile.y_,
         "distanceX":Math.abs(projectile.x_ - player.x_),
         "distanceY":Math.abs(projectile.y_ - player.y_),
         "activeHostile":this.activeHostileCount_,
         "relevantThreats":this.threatCount,
          "earliestImpactMs":this.earliestImpactMs < int.MAX_VALUE ? this.earliestImpactMs : -1,
         "earliestSafetyBreachMs":this.earliestSafetyBreachMs < int.MAX_VALUE ?
               this.earliestSafetyBreachMs : -1,
         "intendedScore":this.candidateScore[INTENT_CANDIDATE],
         "intendedSafetyScore":this.candidateSafetyScore[INTENT_CANDIDATE],
         "intendedExpectedDamage":this.candidateExpectedDamage[INTENT_CANDIDATE],
         "intendedRisk":this.candidateRisk[INTENT_CANDIDATE],
         "proposedCandidate":this.proposedCandidate,
         "proposedScore":this.candidateScore[this.proposedCandidate],
         "proposedSafetyScore":this.candidateSafetyScore[this.proposedCandidate],
         "proposedExpectedDamage":this.candidateExpectedDamage[this.proposedCandidate],
         "runnerUpCandidate":this.runnerUpCandidate_,
         "runnerUpExpectedDamage":this.runnerUpCandidate_ >= 0 ?
               this.candidateExpectedDamage[this.runnerUpCandidate_] : -1,
         "selectedCandidate":this.selectedCandidate,
         "selectedScore":selectedScore,
         "selectedSafetyScore":this.selectedCandidate >= 0 &&
               this.selectedCandidate < CANDIDATE_COUNT ?
               this.candidateSafetyScore[this.selectedCandidate] : -1,
         "selectedRisk":this.selectedCandidate >= 0 && this.selectedCandidate < CANDIDATE_COUNT ?
               this.candidateRisk[this.selectedCandidate] : -1,
         "selectedExpectedDamage":this.selectedCandidate >= 0 &&
               this.selectedCandidate < CANDIDATE_COUNT ?
               this.candidateExpectedDamage[this.selectedCandidate] : -1,
         "selectedWallPenalty":this.selectedCandidate >= 0 &&
               this.selectedCandidate < CANDIDATE_COUNT ?
               this.candidateWallPenalty[this.selectedCandidate] : -1,
         "selectedEscapeOptions":this.selectedCandidate >= 0 &&
               this.selectedCandidate < CANDIDATE_COUNT ?
               this.candidateEscapeOptions[this.selectedCandidate] : -1,
         "selectedImpactMs":this.candidateImpactMs[this.selectedCandidate] < int.MAX_VALUE ?
               this.candidateImpactMs[this.selectedCandidate] : -1,
         "selectedBlockMs":this.candidateBlockMs[this.selectedCandidate] < int.MAX_VALUE ?
               this.candidateBlockMs[this.selectedCandidate] : -1,
         "intendedBlockMs":this.candidateBlockMs[INTENT_CANDIDATE] < int.MAX_VALUE ?
               this.candidateBlockMs[INTENT_CANDIDATE] : -1,
         "stationaryHits":this.stationaryProjectileHits_,
         "blockedOverrideFrames":this.blockedOverrideFrames_,
         "stuckEscapeRemainingMs":Math.max(0,this.stuckEscapeUntil_ - time),
         "stuckEscapeCandidate":this.stuckEscapeCandidate_,
         "directEmitterThreat":this.directEmitterThreat_,
         "intendedEmitterClearance":isFinite(this.intendedEmitterClearance_) ?
               this.intendedEmitterClearance_ : -1,
         "overrideActive":this.overrideActive,
         "speedScale":this.debugSpeedScale,
         "decision":this.lastDecision_
      });
   }

   /** Snapshot the threat model at an authoritative local-player AOE hit. */
   public function logAoeHit(player:Player, time:int, centerX:Number,
                             centerY:Number, radius:Number, rawDamage:int,
                             effectiveDamage:int, armorPiercing:Boolean,
                             effect:int, effectDuration:Number,
                             originType:int) : void {
      if(!Parameters.data.autoDodgeDebug || player == null) {
         return;
      }
      var dx:Number = player.x_ - centerX;
      var dy:Number = player.y_ - centerY;
      var selected:int = this.selectedCandidate >= 0 &&
            this.selectedCandidate < CANDIDATE_COUNT ?
            this.selectedCandidate : 0;
      DebugLog.event("auto_dodge_aoe_hit",{
         "time":time,"playerX":player.x_,"playerY":player.y_,
         "centerX":centerX,"centerY":centerY,
         "centerDistance":Math.sqrt(dx * dx + dy * dy),"radius":radius,
         "rawDamage":rawDamage,"effectiveDamage":effectiveDamage,
         "armorPiercing":armorPiercing,"effect":effect,
         "effectDuration":effectDuration,"originType":originType,
         "evaluationAgeMs":this.lastEvaluationTime_ >= 0 ?
               time - this.lastEvaluationTime_ : -1,
         "activeAoe":this.activeAoeCount_,"relevantAoe":this.relevantAoeCount_,
         "earliestAoeLandingMs":this.earliestAoeLandingMs_ < int.MAX_VALUE ?
               this.earliestAoeLandingMs_ : -1,
         "earliestImpactMs":this.earliestImpactMs < int.MAX_VALUE ?
               this.earliestImpactMs : -1,
         "proposedCandidate":this.proposedCandidate,
         "proposedExpectedDamage":this.candidateExpectedDamage[
               this.proposedCandidate],
         "selectedCandidate":selected,
         "selectedExpectedDamage":this.candidateExpectedDamage[selected],
         "selectedRisk":this.candidateRisk[selected],
         "blockedOverrideFrames":this.blockedOverrideFrames_,
         "stuckEscapeRemainingMs":Math.max(0,this.stuckEscapeUntil_ - time),
         "overrideActive":this.overrideActive,"decision":this.lastDecision_
      });
   }

   private function selectIntentPreservingVelocity(player:Player, map:Map,
                                                   time:int, moveSpeed:Number,
                                                   movementLeadMs:int,
                                                   intentX:Number,
                                                   intentY:Number,
                                                   preferred:int,
                                                   continuity:int) : int {
      this.plannedSpeedCandidate_ = -1;
      this.plannedSpeedScale_ = 1;
      this.lastMinimumMotionTests_ = 0;
      this.lastShooterCoreClearance_ = Number.POSITIVE_INFINITY;
      this.velocityBestCandidate_ = -1;
      this.velocityBestScale_ = 1;
      this.velocityBestError_ = Number.POSITIVE_INFINITY;

      // Seed the search with the full scorer's route, the exact input velocity,
      // and stopping. Stopping participates as one velocity candidate; it no
      // longer wins merely because it was tested first. A tangential velocity
      // closer to the player's input will replace it.
      this.considerIntentVelocity(player,map,time,moveSpeed,movementLeadMs,
            preferred,1,preferred,continuity);
      var intendedSpeed:Number = Math.sqrt(intentX * intentX + intentY * intentY);
      var intendedScale:Number = moveSpeed > 0 ?
            Math.min(1,intendedSpeed / moveSpeed) : 0;
      if(intendedScale > 0.000001) {
         this.considerIntentVelocity(player,map,time,moveSpeed,movementLeadMs,
               INTENT_CANDIDATE,intendedScale,preferred,continuity);
      }
      this.considerIntentVelocity(player,map,time,moveSpeed,movementLeadMs,
            0,0,preferred,continuity);

      // For each direction, the dot projection is the continuous speed that is
      // closest to the intended velocity. This is the key difference from the
      // old scale-first search: a small angular correction at useful speed beats
      // braking to 15%, and braking beats reversing only when it truly changes
      // the requested velocity less.
      var candidate:int;
      for(candidate = 1; candidate < CANDIDATE_COUNT; candidate++) {
         if(!this.candidateValid[candidate]) {
            continue;
         }
         var projectedScale:Number = moveSpeed > 0 ?
               (intentX * this.candidateX[candidate] +
                intentY * this.candidateY[candidate]) / moveSpeed : 0;
         projectedScale = Math.max(0,Math.min(1,projectedScale));
         if(projectedScale > 0.000001) {
            this.considerIntentVelocity(player,map,time,moveSpeed,movementLeadMs,
                  candidate,projectedScale,preferred,continuity);
         }
      }

      // A collision boundary can make the continuous projection unsafe while a
      // nearby faster/slower velocity remains valid. Check the small fixed set,
      // pruning every option whose velocity error already exceeds the best one.
      for(var scaleIndex:int = 0; scaleIndex < VELOCITY_SPEED_SCALES.length;
            scaleIndex++) {
         var scale:Number = VELOCITY_SPEED_SCALES[scaleIndex];
         for(candidate = 1; candidate < CANDIDATE_COUNT; candidate++) {
            if(this.candidateValid[candidate]) {
               this.considerIntentVelocity(player,map,time,moveSpeed,
                     movementLeadMs,candidate,scale,preferred,continuity);
            }
         }
      }

      if(this.velocityBestCandidate_ >= 0) {
         this.plannedSpeedCandidate_ = this.velocityBestCandidate_;
         this.plannedSpeedScale_ = this.velocityBestScale_;
         this.lastShooterCoreClearance_ = this.shooterCoreClearanceForVelocity(
               player,this.candidateX[this.velocityBestCandidate_] * moveSpeed *
               this.velocityBestScale_,this.candidateY[this.velocityBestCandidate_] *
               moveSpeed * this.velocityBestScale_);
         this.windowMinimumMotionFrames_++;
         this.windowMinimumMotionTests_ += this.lastMinimumMotionTests_;
         this.lastDecision_ = (this.velocityBestScale_ <= 0.000001 ?
               "intent_velocity_stop_" : "intent_velocity_") + this.lastDecision_;
         return this.velocityBestCandidate_;
      }
      this.windowMinimumMotionTests_ += this.lastMinimumMotionTests_;
      return preferred;
   }

   private function considerIntentVelocity(player:Player, map:Map, time:int,
                                           moveSpeed:Number, movementLeadMs:int,
                                           candidate:int, scale:Number,
                                           preferred:int,
                                           continuity:int) : void {
      if(candidate < 0 || candidate >= CANDIDATE_COUNT ||
            !this.candidateValid[candidate]) {
         return;
      }
      // Refinement may improve alignment only inside the damage tier selected
      // by the main scorer. Exact velocity safety is checked immediately below.
      if(this.candidateExpectedDamage[candidate] >
            this.candidateExpectedDamage[preferred] + 0.001) {
         return;
      }
      scale = Math.max(0,Math.min(1,scale));
      var velocityX:Number = this.candidateX[candidate] * moveSpeed * scale;
      var velocityY:Number = this.candidateY[candidate] * moveSpeed * scale;
      var differenceX:Number = velocityX - this.intentVelocityX_;
      var differenceY:Number = velocityY - this.intentVelocityY_;
      var error:Number = differenceX * differenceX + differenceY * differenceY;
      var errorTolerance:Number = Math.max(0.0000000001,
            moveSpeed * moveSpeed * 0.000001);
      if(candidate == this.velocityBestCandidate_ &&
            Math.abs(scale - this.velocityBestScale_) <= 0.000001) {
         return;
      }
      if(error > this.velocityBestError_ + errorTolerance) {
         return;
      }

      this.lastMinimumMotionTests_++;
      if(!this.isVelocitySafe(player,map,time,movementLeadMs,velocityX,velocityY)) {
         return;
      }

      var better:Boolean = this.velocityBestCandidate_ < 0 ||
            error < this.velocityBestError_ - errorTolerance;
      if(!better && Math.abs(error - this.velocityBestError_) <= errorTolerance) {
         var candidateContinuous:Boolean = candidate == continuity;
         var bestContinuous:Boolean = this.velocityBestCandidate_ ==
               continuity;
         if(candidateContinuous != bestContinuous) {
            better = candidateContinuous;
         } else if((candidate == preferred) !=
               (this.velocityBestCandidate_ == preferred)) {
            better = candidate == preferred;
         } else {
            var candidateMobility:int = mobilityTier(
                  this.candidateEscapeOptions[candidate]);
            var bestMobility:int = mobilityTier(
                  this.candidateEscapeOptions[this.velocityBestCandidate_]);
            if(candidateMobility != bestMobility) {
               better = candidateMobility > bestMobility;
            } else if(this.candidateWallPenalty[candidate] !=
                  this.candidateWallPenalty[this.velocityBestCandidate_]) {
               better = this.candidateWallPenalty[candidate] <
                     this.candidateWallPenalty[this.velocityBestCandidate_];
            } else if(scale != this.velocityBestScale_) {
               better = scale > this.velocityBestScale_;
            }
         }
      }
      if(better) {
         this.velocityBestCandidate_ = candidate;
         this.velocityBestScale_ = scale;
         this.velocityBestError_ = error;
      }
   }

   private function shooterCoreClearanceForVelocity(player:Player,
                                                     velocityX:Number,
                                                     velocityY:Number) : Number {
      var enemyCount:int = this.relevantEnemies_.length;
      if(enemyCount == 0) {
         return Number.POSITIVE_INFINITY;
      }
      var endpointX:Number = player.x_ + velocityX *
            LOCAL_MOBILITY_HORIZON_MS;
      var endpointY:Number = player.y_ + velocityY *
            LOCAL_MOBILITY_HORIZON_MS;
      var nearest:Number = Number.POSITIVE_INFINITY;
      for(var index:int = 0; index < enemyCount; index++) {
         var enemy:GameObject = this.relevantEnemies_[index];
         if(enemy == null || enemy.dead_) {
            continue;
         }
         var dx:Number = endpointX - enemy.x_;
         var dy:Number = endpointY - enemy.y_;
         var startDx:Number = player.x_ - enemy.x_;
         var startDy:Number = player.y_ - enemy.y_;
         var startDistance:Number = Math.sqrt(startDx * startDx +
               startDy * startDy);
         var clearance:Number;
         if(startDistance < this.shooterCoreRadius_) {
            // Already inside: judge whether this short correction gets out.
            // Using segment minimum here would reject every escape because the
            // segment necessarily begins inside the core.
            clearance = Math.sqrt(dx * dx + dy * dy) - this.shooterCoreRadius_;
         } else {
            // Outside: do not allow a fast correction to cross the core and end
            // on the far side merely because its endpoint is clear.
            clearance = pointToSegmentDistance(enemy.x_,enemy.y_,player.x_,
                  player.y_,endpointX,endpointY) - this.shooterCoreRadius_;
         }
         nearest = Math.min(nearest,clearance);
      }
      return nearest;
   }

   private function projectileEmitterClearanceForVelocity(player:Player,
                                                           emitter:MovingAoeEmitter,
                                                           velocityX:Number,
                                                           velocityY:Number,
                                                           movementLeadMs:int) : Number {
      var endOffset:int = movementLeadMs + LOCAL_MOBILITY_HORIZON_MS;
      var sourceStartX:Number = emitter.predictedX(0);
      var sourceStartY:Number = emitter.predictedY(0);
      var sourceEndX:Number = emitter.predictedX(LOCAL_MOBILITY_HORIZON_MS);
      var sourceEndY:Number = emitter.predictedY(LOCAL_MOBILITY_HORIZON_MS);
      var playerStartX:Number = player.x_ + velocityX * movementLeadMs;
      var playerStartY:Number = player.y_ + velocityY * movementLeadMs;
      var playerEndX:Number = player.x_ + velocityX * endOffset;
      var playerEndY:Number = player.y_ + velocityY * endOffset;
      var clearance:Number = movingCoreClearance(sourceStartX,sourceStartY,
            sourceEndX,sourceEndY,playerStartX,playerStartY,playerEndX,
            playerEndY,emitter.projectileGuardRadius_);
      if(!this.serverTemporalActive_) {
         return clearance;
      }
      var startScale:Number = this.serverPathScale(movementLeadMs);
      var endScale:Number = this.serverPathScale(endOffset);
      return Math.min(clearance,movingCoreClearance(sourceStartX,sourceStartY,
            sourceEndX,sourceEndY,
            playerStartX + this.serverOffsetX_ * startScale,
            playerStartY + this.serverOffsetY_ * startScale,
            playerEndX + this.serverOffsetX_ * endScale,
            playerEndY + this.serverOffsetY_ * endScale,
            emitter.projectileGuardRadius_));
   }

   private static function movingCoreClearance(sourceStartX:Number,
                                               sourceStartY:Number,
                                               sourceEndX:Number,
                                               sourceEndY:Number,
                                               playerStartX:Number,
                                               playerStartY:Number,
                                               playerEndX:Number,
                                               playerEndY:Number,
                                               radius:Number) : Number {
      var startX:Number = playerStartX - sourceStartX;
      var startY:Number = playerStartY - sourceStartY;
      var endX:Number = playerEndX - sourceEndX;
      var endY:Number = playerEndY - sourceEndY;
      var startDistance:Number = Math.sqrt(startX * startX + startY * startY);
      if(startDistance < radius) {
         return Math.sqrt(endX * endX + endY * endY) - radius;
      }
      return pointToSegmentDistance(0,0,startX,startY,endX,endY) - radius;
   }

   private function selectManualAlignedSpeed(player:Player, map:Map, time:int,
                                             moveSpeed:Number, movementLeadMs:int,
                                             directionX:Number, directionY:Number) : Number {
      var bestScale:Number = 1;
      var fullDx:Number = directionX * moveSpeed - this.intentVelocityX_;
      var fullDy:Number = directionY * moveSpeed - this.intentVelocityY_;
      var bestDifference:Number = fullDx * fullDx + fullDy * fullDy;
      for(var step:int = 1; step <= 4; step++) {
         var scale:Number = step * 0.2;
         var velocityX:Number = directionX * moveSpeed * scale;
         var velocityY:Number = directionY * moveSpeed * scale;
         var differenceX:Number = velocityX - this.intentVelocityX_;
         var differenceY:Number = velocityY - this.intentVelocityY_;
         var difference:Number = differenceX * differenceX + differenceY * differenceY;
         if(difference >= bestDifference ||
               !this.isVelocitySafe(player,map,time,movementLeadMs,velocityX,velocityY)) {
            continue;
         }
         bestDifference = difference;
         bestScale = scale;
      }
      return bestScale;
   }

   private function isVelocitySafe(player:Player, map:Map, time:int, movementLeadMs:int,
                                   velocityX:Number, velocityY:Number) : Boolean {
      var sampleOffset:int;
      // A future bomb may allow most of its lead time for a small correction.
      // The old 300-ms clamp made the refinement assume movement stopped long
      // before a 1,200-ms landing, forcing a needlessly high escape speed.
      var velocityPathHorizon:int = Math.max(this.horizonMs_,
            this.velocityAoeHorizonMs_);
      var velocityTravelLimit:int = movementLeadMs + velocityPathHorizon;
      var lastOpenOffset:int = 0;
      for(sampleOffset = 0; sampleOffset <= velocityPathHorizon;
            sampleOffset += SAMPLE_MS) {
         var movementOffset:int = movementLeadMs + sampleOffset;
         var velocityPathX:Number = player.x_ + velocityX * movementOffset;
         var velocityPathY:Number = player.y_ + velocityY * movementOffset;
         var velocityPathOpen:Boolean = map.canOccupyForDodge(velocityPathX,
               velocityPathY,Parameters.data.autoDodgeAvoidGround !== false);
         if(velocityPathOpen && this.serverRebaseActive_) {
            var velocityServerScale:Number = this.serverPathScale(movementOffset);
            velocityPathOpen = map.canOccupyForDodge(
                  velocityPathX + this.serverOffsetX_ * velocityServerScale,
                  velocityPathY + this.serverOffsetY_ * velocityServerScale,
                  Parameters.data.autoDodgeAvoidGround !== false);
         }
         if(!velocityPathOpen) {
            // Collision resolution stops/slides at the first blocked boundary;
            // it does not teleport the player through the wall and it does not
            // force an unrelated 90 ms stop. Hold the last reachable point for
            // the rest of this safety prediction.
            velocityTravelLimit = lastOpenOffset;
            break;
         }
         lastOpenOffset = movementOffset;
      }
      if(this.relevantEnemies_.length > 0 &&
            this.shooterCoreClearanceForVelocity(player,velocityX,velocityY) < 0) {
         return false;
      }
      var projectileEmitterCount:int = this.relevantProjectileEmitters_.length;
      for(var projectileEmitterIndex:int = 0;
            projectileEmitterIndex < projectileEmitterCount;
            projectileEmitterIndex++) {
         if(this.projectileEmitterClearanceForVelocity(player,
               this.relevantProjectileEmitters_[projectileEmitterIndex],velocityX,
               velocityY,movementLeadMs) < 0) {
            return false;
         }
      }
      var thrownCount:int = map.activeThrownProjectiles_.length;
      for(var thrownIndex:int = 0; thrownIndex < thrownCount; thrownIndex++) {
         var thrown:ThrownProjectile = map.activeThrownProjectiles_[thrownIndex];
         if(!map.isThrownAoeConfirmed(thrown) ||
               map.isThrownAoeHarmless(thrown)) {
            continue;
         }
         var landingOffset:int = map.getThrownAoeLandingOffset(thrown);
         if(landingOffset <= 0 || landingOffset > this.aoeHorizonMs_ || thrown.end_ == null) {
            continue;
         }
         var aoeTrajectoryOffset:int = movementLeadMs + landingOffset;
         var aoeMovementOffset:int = Math.min(velocityTravelLimit,
               aoeTrajectoryOffset);
         var velocityAoeX:Number = player.x_ + velocityX * aoeMovementOffset;
         var velocityAoeY:Number = player.y_ + velocityY * aoeMovementOffset;
         if(this.pointToServerCorridorDistance(thrown.end_.x,thrown.end_.y,
               velocityAoeX,velocityAoeY,aoeTrajectoryOffset) -
               map.getThrownAoeRadius(thrown) <
               this.aoeSafetyClearance_) {
            return false;
         }
      }
      var telegraphCount:int = map.getTelegraphedAoeCount(time);
      for(var telegraphIndex:int = 0; telegraphIndex < telegraphCount;
            telegraphIndex++) {
         var telegraphLandingOffset:int = Math.max(0,
               map.getTelegraphedAoeImpact(telegraphIndex) - time);
         if(telegraphLandingOffset > this.aoeHorizonMs_) {
            continue;
         }
         var telegraphTrajectoryOffset:int = movementLeadMs +
               telegraphLandingOffset;
         var telegraphMovementOffset:int = Math.min(velocityTravelLimit,
               telegraphTrajectoryOffset);
         var velocityTelegraphX:Number = player.x_ + velocityX *
               telegraphMovementOffset;
         var velocityTelegraphY:Number = player.y_ + velocityY *
               telegraphMovementOffset;
         if(this.pointToServerCorridorDistance(
               map.getTelegraphedAoeX(telegraphIndex),
               map.getTelegraphedAoeY(telegraphIndex),velocityTelegraphX,
               velocityTelegraphY,telegraphTrajectoryOffset) -
               map.getTelegraphedAoeRadius(telegraphIndex) <
               this.aoeSafetyClearance_) {
            return false;
         }
      }
      // Telegraph laser lines: the refined velocity must clear the strike line
      // by its expiry just like a circle telegraph, or a slow "aligned" speed
      // would park the player exactly where the damaging twin spawns.
      var velocityLaserCount:int = this.relevantTelegraphLasers_.length;
      for(var velocityLaserIndex:int = 0; velocityLaserIndex < velocityLaserCount;
            velocityLaserIndex++) {
         var velocityLaser:Projectile =
               this.relevantTelegraphLasers_[velocityLaserIndex];
         var velocityLaserImpact:int = int(Math.max(0,
               velocityLaser.startTime_ + velocityLaser.lifetime - time));
         if(velocityLaserImpact > this.aoeHorizonMs_) {
            continue;
         }
         var velocityLaserTrajectoryOffset:int = movementLeadMs +
               velocityLaserImpact;
         var velocityLaserMovementOffset:int = Math.min(velocityTravelLimit,
               velocityLaserTrajectoryOffset);
         if(this.laserLineCorridorDistance(velocityLaser,
               player.x_ + velocityX * velocityLaserMovementOffset,
               player.y_ + velocityY * velocityLaserMovementOffset,
               velocityLaserTrajectoryOffset) -
               telegraphLaserDangerRadius(telegraphLaserTwin(
                     velocityLaser.containerType_)) <
               this.aoeSafetyClearance_) {
            return false;
         }
      }
      var movingEmitterCount:int = map.activeMovingAoeEmitters_.length;
      for(var emitterIndex:int = 0; emitterIndex < movingEmitterCount;
            emitterIndex++) {
         var emitter:MovingAoeEmitter = map.activeMovingAoeEmitters_[emitterIndex];
         if(!emitter.isActive(time)) {
            continue;
         }
         var emitterLandingOffset:int = emitter.impactOffset(time);
         if(emitterLandingOffset > this.aoeHorizonMs_) {
            continue;
         }
         var emitterTrajectoryOffset:int = movementLeadMs + emitterLandingOffset;
         var emitterMovementOffset:int = Math.min(velocityTravelLimit,
               emitterTrajectoryOffset);
         var velocityEmitterX:Number = player.x_ + velocityX * emitterMovementOffset;
         var velocityEmitterY:Number = player.y_ + velocityY * emitterMovementOffset;
         if(this.pointToServerCorridorDistance(
               emitter.predictedX(emitterLandingOffset),
               emitter.predictedY(emitterLandingOffset),velocityEmitterX,
               velocityEmitterY,emitterTrajectoryOffset) - emitter.radius_ <
               this.aoeSafetyClearance_) {
            return false;
         }
      }
      // Recent authoritative AoEs are scored by the main candidate pass too.
      // Include them here so the small-displacement refinement cannot select a
      // lower-speed endpoint inside an area that the full-speed candidate left.
      var recentAoeCount:int = map.getRecentAoeCount(time);
      for(var recentIndex:int = 0; recentIndex < recentAoeCount; recentIndex++) {
         var recentRemaining:int = Math.min(this.horizonMs_,Math.max(0,
               map.getRecentAoeUntil(recentIndex) - time));
         if(!this.isAoeEnvelopeVelocitySafe(player,movementLeadMs,
               velocityTravelLimit,velocityX,velocityY,
               map.getRecentAoeX(recentIndex),map.getRecentAoeY(recentIndex),
               map.getRecentAoeRadius(recentIndex),recentRemaining,SAMPLE_MS)) {
            return false;
         }
      }
      if(this.recentBurstActive_ && !this.isAoeEnvelopeVelocitySafe(player,
            movementLeadMs,velocityTravelLimit,velocityX,velocityY,
            this.recentBurstX_,this.recentBurstY_,this.recentBurstRadius_,
            this.recentBurstRemainingMs_,60)) {
         return false;
      }
      if(this.persistentClusterActive_ && !this.isAoeEnvelopeVelocitySafe(player,
            movementLeadMs,velocityTravelLimit,velocityX,velocityY,
            this.persistentClusterX_,this.persistentClusterY_,
            this.persistentClusterRadius_,this.aoeHorizonMs_,60)) {
         return false;
      }
      var count:int = this.relevantProjectiles_.length;
      for(var index:int = 0; index < count; index++) {
         var projectile:Projectile = this.relevantProjectiles_[index];
         var projectilePhysicalHalfSize:Number = projectile.collisionHalfSize();
         var projectileSafetyMargin:Number = this.effectiveProjectileSafetyMargin(
               projectile,this.requiredSafetyClearance_);
         var previousSet:Boolean = !projectile.isLaser();
         var velocityPreviousSampleOffset:int = -movementLeadMs;
         if(previousSet) {
            this.previousProjectilePosition.setTo(projectile.x_,projectile.y_);
         }
         for(sampleOffset = 0; sampleOffset <= this.horizonMs_; sampleOffset += SAMPLE_MS) {
            var sampleTime:int = time + sampleOffset;
            if(!projectile.isAliveAt(sampleTime)) {
               break;
            }
            projectile.predictPositionAt(sampleTime,this.projectilePosition);
            if(previousSet && !projectile.isLaser() &&
                  !map.isProjectileSegmentOpen(this.previousProjectilePosition.x,
                  this.previousProjectilePosition.y,this.projectilePosition.x,
                  this.projectilePosition.y,projectile)) {
               break;
            }
            movementOffset = movementLeadMs + sampleOffset;
            movementOffset = Math.min(velocityTravelLimit,movementOffset);
            var playerX:Number = player.x_ + velocityX * movementOffset;
            var playerY:Number = player.y_ + velocityY * movementOffset;
            var clearance:Number;
            if(previousSet) {
               var previousMovementOffset:int = movementLeadMs +
                     velocityPreviousSampleOffset;
               previousMovementOffset = Math.min(velocityTravelLimit,
                     previousMovementOffset);
               var previousPlayerX:Number = player.x_ + velocityX * previousMovementOffset;
               var previousPlayerY:Number = player.y_ + velocityY * previousMovementOffset;
               clearance = this.projectileCorridorSweepClearance(projectile,
                     previousPlayerX,previousPlayerY,playerX,playerY,
                     previousMovementOffset,movementOffset);
            } else {
               clearance = this.projectileCorridorPointClearance(projectile,
                     playerX,playerY,movementOffset);
            }
            // A reduced planning hitbox may remove soft clearance, but never
            // the physical collision boundary used by Projectile.getHit().
            if(clearance - projectilePhysicalHalfSize < projectileSafetyMargin) {
               return false;
            }
            this.previousProjectilePosition.copyFrom(this.projectilePosition);
            previousSet = true;
            velocityPreviousSampleOffset = sampleOffset;
         }
      }
      return true;
   }

   /** A player already inside a just-landed/repeating AoE must be allowed to
    * cross the unsafe interior on the way out. Require the velocity to reach
    * the literal boundary before the envelope expires, and reject any later
    * re-entry. A trajectory that begins outside remains outside throughout. */
   private function isAoeEnvelopeVelocitySafe(player:Player,
                                              movementLeadMs:int,
                                              velocityTravelLimit:int,
                                              velocityX:Number,
                                              velocityY:Number,
                                              centerX:Number,
                                              centerY:Number,
                                              radius:Number,
                                              durationMs:int,
                                              sampleStepMs:int) : Boolean {
      durationMs = Math.max(0,durationMs);
      sampleStepMs = Math.max(1,sampleStepMs);
      var escaped:Boolean = false;
      var sample:int = 0;
      while(true) {
         var trajectoryOffset:int = movementLeadMs + sample;
         var movementOffset:int = Math.min(velocityTravelLimit,trajectoryOffset);
         var playerX:Number = player.x_ + velocityX * movementOffset;
         var playerY:Number = player.y_ + velocityY * movementOffset;
         var safe:Boolean = this.pointToServerCorridorDistance(centerX,centerY,
               playerX,playerY,trajectoryOffset) - radius >=
               this.aoeSafetyClearance_;
         if(escaped && !safe) {
            return false;
         }
         if(safe) {
            escaped = true;
         }
         if(sample >= durationMs) {
            break;
         }
         sample = Math.min(durationMs,sample + sampleStepMs);
      }
      return escaped;
   }

   /** Keep the configurable percentage as a soft-margin control without ever
    * shrinking the literal boundary used by Projectile.getHit(). For example,
    * 92% with 0.05 clearance becomes a 0.01 margin around a physical 0.5 box. */
   private function effectiveProjectileSafetyMargin(projectile:Projectile,
                                                      configuredMargin:Number) : Number {
      var physicalHalfSize:Number = projectile != null ?
            projectile.collisionHalfSize() : PHYSICAL_HIT_HALF_SIZE;
      return Math.max(0,configuredMargin -
            physicalHalfSize * (1 - this.hitboxScale_));
   }

   /** Score local and time-aligned server anchors separately. Never fill the
    * space between them: doing so turns acknowledgement lag into a many-tile
    * hitbox, while ignoring the server anchor misses real turn/corner hits. */
   private function projectileCorridorPointClearance(projectile:Projectile,
                                                      playerX:Number,
                                                      playerY:Number,
                                                      movementOffset:int) : Number {
      var localClearance:Number = this.projectilePointClearance(projectile,
            playerX,playerY);
      if(!this.serverTemporalActive_) {
         return localClearance;
      }
      var scale:Number = this.serverPathScale(movementOffset);
      return Math.min(localClearance,this.projectilePointClearance(projectile,
            playerX + this.serverOffsetX_ * scale,
            playerY + this.serverOffsetY_ * scale));
   }

   private function projectileCorridorSweepClearance(projectile:Projectile,
                                                      previousPlayerX:Number,
                                                      previousPlayerY:Number,
                                                      playerX:Number,
                                                      playerY:Number,
                                                      previousMovementOffset:int,
                                                      movementOffset:int) : Number {
      var localClearance:Number = this.projectileSweepClearance(projectile,
            previousPlayerX,previousPlayerY,playerX,playerY);
      if(!this.serverTemporalActive_) {
         return localClearance;
      }
      var previousScale:Number = this.serverPathScale(previousMovementOffset);
      var scale:Number = this.serverPathScale(movementOffset);
      return Math.min(localClearance,this.projectileSweepClearance(projectile,
            previousPlayerX + this.serverOffsetX_ * previousScale,
            previousPlayerY + this.serverOffsetY_ * previousScale,
            playerX + this.serverOffsetX_ * scale,
            playerY + this.serverOffsetY_ * scale));
   }

   private function pointToServerCorridorDistance(pointX:Number, pointY:Number,
                                                   playerX:Number, playerY:Number,
                                                   movementOffset:int) : Number {
      var scale:Number = this.serverPathScale(movementOffset);
      if(!this.serverTemporalActive_) {
         var directX:Number = pointX - playerX;
         var directY:Number = pointY - playerY;
         return Math.sqrt(directX * directX + directY * directY);
      }
      var localX:Number = pointX - playerX;
      var localY:Number = pointY - playerY;
      var serverX:Number = pointX -
            (playerX + this.serverOffsetX_ * scale);
      var serverY:Number = pointY -
            (playerY + this.serverOffsetY_ * scale);
      return Math.min(Math.sqrt(localX * localX + localY * localY),
            Math.sqrt(serverX * serverX + serverY * serverY));
   }

   private function serverPathScale(movementOffset:int) : Number {
      return Math.max(0,1 - Math.max(0,movementOffset) /
            Number(SERVER_PATH_CATCHUP_MS));
   }

   private function projectilePointClearance(projectile:Projectile,
                                             playerX:Number, playerY:Number) : Number {
      if(projectile.isLaser()) {
         return projectile.laserClearanceTo(playerX,playerY);
      }
      return Math.max(Math.abs(this.projectilePosition.x - playerX),
            Math.abs(this.projectilePosition.y - playerY));
   }

   private function projectileSweepClearance(projectile:Projectile,
                                             previousPlayerX:Number,
                                             previousPlayerY:Number,
                                             playerX:Number, playerY:Number) : Number {
      if(projectile.isLaser()) {
         return projectile.laserClearanceToSegment(previousPlayerX,previousPlayerY,
               playerX,playerY);
      }
      return minimumChebyshevOnSegment(
            this.previousProjectilePosition.x - previousPlayerX,
            this.previousProjectilePosition.y - previousPlayerY,
            this.projectilePosition.x - playerX,
            this.projectilePosition.y - playerY);
   }

   private function recordEvaluationTelemetry(profiling:Boolean, evaluationStart:int,
                                              projectileSamples:int, candidateChecks:int,
                                              invalidCandidates:int) : void {
      if(!profiling) {
         return;
      }
      var evaluationMs:int = getTimer() - evaluationStart;
      this.windowFrames_++;
      this.windowEvaluationMs_ += evaluationMs;
      if(evaluationMs > this.windowMaxEvaluationMs_) {
         this.windowMaxEvaluationMs_ = evaluationMs;
      }
      this.windowProjectileSamples_ += projectileSamples;
      this.windowCandidateChecks_ += candidateChecks;
      this.windowInvalidCandidates_ += invalidCandidates;
      if(this.activeHostileCount_ > this.windowMaxHostile_) {
         this.windowMaxHostile_ = this.activeHostileCount_;
      }
      if(this.broadPhaseThreatCount_ > this.windowMaxBroad_) {
         this.windowMaxBroad_ = this.broadPhaseThreatCount_;
      }
      if(this.directBroadPhaseThreatCount_ > this.windowMaxDirectBroad_) {
         this.windowMaxDirectBroad_ = this.directBroadPhaseThreatCount_;
      }
      if(this.activeAoeCount_ > this.windowMaxActiveAoe_) {
         this.windowMaxActiveAoe_ = this.activeAoeCount_;
      }
      if(this.relevantAoeCount_ > this.windowMaxRelevantAoe_) {
         this.windowMaxRelevantAoe_ = this.relevantAoeCount_;
      }
   }

   /** Exact minimum L-infinity distance from the origin to a line segment. */
   private static function minimumChebyshevOnSegment(x0:Number, y0:Number,
                                                      x1:Number, y1:Number) : Number {
      var best:Number = Math.min(Math.max(Math.abs(x0),Math.abs(y0)),
            Math.max(Math.abs(x1),Math.abs(y1)));
      var dx:Number = x1 - x0;
      var dy:Number = y1 - y0;
      var t:Number;
      var x:Number;
      var y:Number;
      var value:Number;

      if(dx != 0) {
         t = -x0 / dx;
         if(t > 0 && t < 1) {
            y = y0 + dy * t;
            value = Math.abs(y);
            if(value < best) best = value;
         }
      }
      if(dy != 0) {
         t = -y0 / dy;
         if(t > 0 && t < 1) {
            x = x0 + dx * t;
            value = Math.abs(x);
            if(value < best) best = value;
         }
      }
      if(dx != dy) {
         t = (y0 - x0) / (dx - dy);
         if(t > 0 && t < 1) {
            x = x0 + dx * t;
            y = y0 + dy * t;
            value = Math.max(Math.abs(x),Math.abs(y));
            if(value < best) best = value;
         }
      }
      if(dx != -dy) {
         t = (-y0 - x0) / (dx + dy);
         if(t > 0 && t < 1) {
            x = x0 + dx * t;
            y = y0 + dy * t;
            value = Math.max(Math.abs(x),Math.abs(y));
            if(value < best) best = value;
         }
      }
      return best;
   }

   private static function pointToSegmentDistance(pointX:Number, pointY:Number,
                                                  startX:Number, startY:Number,
                                                  endX:Number, endY:Number) : Number {
      var segmentX:Number = endX - startX;
      var segmentY:Number = endY - startY;
      var lengthSq:Number = segmentX * segmentX + segmentY * segmentY;
      if(lengthSq <= 0.0000001) {
         segmentX = pointX - startX;
         segmentY = pointY - startY;
         return Math.sqrt(segmentX * segmentX + segmentY * segmentY);
      }
      var t:Number = ((pointX - startX) * segmentX +
            (pointY - startY) * segmentY) / lengthSq;
      t = Math.max(0,Math.min(1,t));
      var dx:Number = pointX - (startX + segmentX * t);
      var dy:Number = pointY - (startY + segmentY * t);
      return Math.sqrt(dx * dx + dy * dy);
   }

   private static function intentLengthSquared(x:Number, y:Number) : Number {
      return x * x + y * y;
   }

   private static function optionNumber(key:String, fallback:Number,
                                        minimum:Number, maximum:Number) : Number {
      var value:Number = Number(Parameters.data[key]);
      if(isNaN(value)) {
         value = fallback;
      }
      return Math.max(minimum,Math.min(maximum,value));
   }
}
}
