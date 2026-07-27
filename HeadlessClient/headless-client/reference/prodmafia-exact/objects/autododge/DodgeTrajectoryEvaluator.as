package com.company.assembleegameclient.objects.autododge {

import com.company.assembleegameclient.map.MovingAoeEmitter;
import com.company.assembleegameclient.objects.Player;
import com.company.assembleegameclient.objects.Projectile;
import flash.geom.Point;

/**
 * Single exact-route safety authority for every auto-dodge movement consumer.
 * It evaluates the velocity that will actually be integrated, holds movement
 * at the first blocked endpoint, and applies the same local/server temporal
 * anchors to projectiles, lasers and circular hazards.
 */
public final class DodgeTrajectoryEvaluator {
   private const projectilePosition_:Point = new Point();
   private const previousProjectilePosition_:Point = new Point();

   public function evaluate(context:DodgeFrameContext, velocityX:Number,
                            velocityY:Number,
                            out:DodgeTrajectoryResult) : DodgeTrajectoryResult {
      var player:Player = context.player;
      out.reset(player.x_,player.y_);

      var pathHorizon:int = Math.max(context.projectileHorizonMs,
            context.velocityAoeHorizonMs);
      var travelLimit:int = context.movementLeadMs + pathHorizon;
      var lastOpenOffset:int = 0;
      var sample:int;
      var movementOffset:int;
      var playerX:Number;
      var playerY:Number;
      var groundActive:Boolean = context.threats != null &&
            context.threats.grounds.length > 0;
      var startedOnGround:Boolean = groundActive &&
            context.map.isDamagingGround(player.x_,player.y_);
      var escapedGround:Boolean = !startedOnGround;
      for(sample = 0; sample <= pathHorizon; sample += context.sampleMs) {
         movementOffset = context.movementLeadMs + sample;
         playerX = player.x_ + velocityX * movementOffset;
         playerY = player.y_ + velocityY * movementOffset;
         // Terrain reachability and damaging ground are different facts. A
         // player starting on lava must be allowed to cross its interior to
         // escape, while a route starting outside must never enter it.
         var open:Boolean = context.map.canOccupyForDodge(playerX,playerY,false);
         if(open && context.serverRebaseActive) {
            var rebaseScale:Number = this.serverPathScale(context,movementOffset);
            open = context.map.canOccupyForDodge(
                  playerX + context.serverOffsetX * rebaseScale,
                  playerY + context.serverOffsetY * rebaseScale,false);
         }
         if(!open) {
            travelLimit = lastOpenOffset;
            out.blockMs = sample;
            break;
         }
         lastOpenOffset = movementOffset;
         out.reachableX = playerX;
         out.reachableY = playerY;
         if(groundActive) {
            var onGround:Boolean = context.map.isDamagingGround(playerX,playerY);
            if(onGround) {
               out.groundExposureMs += context.sampleMs;
               if(escapedGround) {
                  out.reject("damaging_ground",sample,0);
               }
            } else {
               escapedGround = true;
            }
         }
      }
      if(startedOnGround && !escapedGround) {
         out.reject("damaging_ground",pathHorizon,0);
      }

      this.evaluateProjectileEmitters(context,velocityX,velocityY,travelLimit,out);
      this.evaluateImpactAoes(context,context.threats.thrownAoes,velocityX,
            velocityY,travelLimit,out);
      this.evaluateImpactAoes(context,context.threats.telegraphedAoes,velocityX,
            velocityY,travelLimit,out);
      this.evaluateImpactAoes(context,context.threats.movingAoes,velocityX,
            velocityY,travelLimit,out);
      this.evaluateActiveAoes(context,context.threats.recentAoes,velocityX,
            velocityY,travelLimit,out);
      this.evaluateReactiveRegions(context,velocityX,velocityY,travelLimit,out);
      this.evaluateProjectiles(context,velocityX,velocityY,travelLimit,out);

      movementOffset = Math.min(travelLimit,
            context.movementLeadMs + pathHorizon);
      out.reachableX = player.x_ + velocityX * movementOffset;
      out.reachableY = player.y_ + velocityY * movementOffset;
      var survivalHp:int = player.hp_;
      if(player.clientHp > 0) {
         survivalHp = survivalHp > 0 ? Math.min(survivalHp,player.clientHp) :
               player.clientHp;
      }
      if(player.syncedChp > 0) {
         survivalHp = survivalHp > 0 ? Math.min(survivalHp,player.syncedChp) :
               player.syncedChp;
      }
      if(survivalHp > 0 && out.expectedDamage >= survivalHp) {
         out.lethal = true;
      }
      return out;
   }

   private function evaluateProjectileEmitters(context:DodgeFrameContext,
                                               velocityX:Number,
                                               velocityY:Number,
                                               travelLimit:int,
                                               out:DodgeTrajectoryResult) : void {
      var count:int = context.projectileEmitters != null ?
            context.projectileEmitters.length : 0;
      for(var index:int = 0; index < count; index++) {
         var emitter:MovingAoeEmitter = context.projectileEmitters[index];
         if(emitter == null) {
            continue;
         }
         var clearance:Number = this.projectileEmitterClearance(context,emitter,
               velocityX,velocityY,travelLimit);
         noteClearance(out,clearance);
         if(clearance < 0) {
            out.reject("projectile_emitter",0,clearance);
            var singleDamage:int = Math.max(0,context.player.damageWithDefense(
                  emitter.projectileGuardDamage_,context.player.defense_,false,
                  context.player.condition_));
            out.expectedDamage += singleDamage * emitter.projectileGuardShots_;
            out.impactMs = 0;
         }
      }
   }

   private function evaluateImpactAoes(context:DodgeFrameContext,
                                       threats:Vector.<DodgeThreat>,
                                       velocityX:Number, velocityY:Number,
                                       travelLimit:int,
                                       out:DodgeTrajectoryResult) : void {
      var count:int = threats != null ? threats.length : 0;
      for(var index:int = 0; index < count; index++) {
         var threat:DodgeThreat = threats[index];
         if(!threat.spatiallyRelevant ||
               threat.confidence == DodgeThreat.DIAGNOSTIC) {
            continue;
         }
         var impactOffset:int = threat.impactOffset;
         if(impactOffset < 0 || impactOffset > context.aoeHorizonMs) {
            continue;
         }
         if(threat.kind == DodgeThreat.THROWN_AOE && impactOffset == 0) {
            continue;
         }
         var trajectoryOffset:int = context.movementLeadMs + impactOffset;
         var movementOffset:int = Math.min(travelLimit,trajectoryOffset);
         var playerX:Number = context.player.x_ + velocityX * movementOffset;
         var playerY:Number = context.player.y_ + velocityY * movementOffset;
         var clearance:Number = this.pointToServerDistance(context,threat.x,
               threat.y,playerX,playerY,trajectoryOffset) - threat.radius;
         noteClearance(out,clearance - context.aoeClearance);
         if(clearance < context.aoeClearance) {
            out.reject("aoe",impactOffset,
                  clearance - context.aoeClearance);
         }
         if(clearance <= 0) {
            out.expectedDamage += effectiveDamage(context.player,threat);
            this.noteThreatStatus(out,threat);
            out.impactMs = Math.min(out.impactMs,impactOffset);
         }
      }
   }

   private function evaluateActiveAoes(context:DodgeFrameContext,
                                       threats:Vector.<DodgeThreat>,
                                       velocityX:Number, velocityY:Number,
                                       travelLimit:int,
                                       out:DodgeTrajectoryResult) : void {
      var count:int = threats != null ? threats.length : 0;
      for(var index:int = 0; index < count; index++) {
         var threat:DodgeThreat = threats[index];
         if(!threat.spatiallyRelevant) {
            continue;
         }
         var duration:int = Math.min(context.projectileHorizonMs,
               Math.max(0,threat.activeUntil - context.time));
         var escaped:Boolean = false;
         var contacted:Boolean = false;
         var sample:int = 0;
         while(true) {
            var trajectoryOffset:int = context.movementLeadMs + sample;
            var movementOffset:int = Math.min(travelLimit,trajectoryOffset);
            var playerX:Number = context.player.x_ + velocityX * movementOffset;
            var playerY:Number = context.player.y_ + velocityY * movementOffset;
            var clearance:Number = this.pointToServerDistance(context,threat.x,
                  threat.y,playerX,playerY,trajectoryOffset) - threat.radius;
            var marginClearance:Number = clearance - context.aoeClearance;
            noteClearance(out,marginClearance);
            var safe:Boolean = marginClearance >= 0;
            if(escaped && !safe) {
               out.reject("active_aoe_reentry",sample,marginClearance);
            }
            if(safe) {
               escaped = true;
            }
            if(clearance <= 0 && !contacted) {
               contacted = true;
               out.impactMs = Math.min(out.impactMs,sample);
               // A one-off raw AOE packet describes damage that already
               // happened; only an observed repeating location represents
               // expected future damage. This matches the batch scorer's
               // recent-AOE semantics exactly. The clearance rejection above
               // still keeps routes out of the circle, so avoidance is
               // unchanged -- only the damage handed to predictive Auto Nexus
               // stops counting finished explosions.
               if(threat.repeating) {
                  out.expectedDamage += effectiveDamage(context.player,threat);
                  this.noteThreatStatus(out,threat);
               }
            }
            if(sample >= duration) {
               break;
            }
            sample = Math.min(duration,sample + context.sampleMs);
         }
         if(!escaped) {
            out.reject("active_aoe",duration,
                  out.minimumClearance);
         }
      }
   }

   private function evaluateReactiveRegions(context:DodgeFrameContext,
                                            velocityX:Number,
                                            velocityY:Number,
                                            travelLimit:int,
                                            out:DodgeTrajectoryResult) : void {
      var threats:Vector.<DodgeThreat> = context.threats.reactiveRegions;
      var count:int = threats.length;
      for(var index:int = 0; index < count; index++) {
         var threat:DodgeThreat = threats[index];
         var duration:int = Math.min(context.projectileHorizonMs,
               Math.max(0,threat.activeUntil - context.time));
         var sample:int = Math.min(duration,450);
         var trajectoryOffset:int = context.movementLeadMs + sample;
         var movementOffset:int = Math.min(travelLimit,trajectoryOffset);
         var playerX:Number = context.player.x_ + velocityX * movementOffset;
         var playerY:Number = context.player.y_ + velocityY * movementOffset;
         var dx:Number = playerX - threat.x;
         var dy:Number = playerY - threat.y;
         var clearance:Number = Math.sqrt(dx * dx + dy * dy) - threat.radius;
         noteClearance(out,clearance);
         if(clearance < 0) {
            out.reject("reactive_region",sample,clearance);
            out.expectedDamage += Math.max(1,threat.damage);
            out.impactMs = Math.min(out.impactMs,sample);
         }
      }
   }

   private function evaluateProjectiles(context:DodgeFrameContext,
                                        velocityX:Number, velocityY:Number,
                                        travelLimit:int,
                                        out:DodgeTrajectoryResult) : void {
      var count:int = context.projectiles != null ? context.projectiles.length : 0;
      for(var index:int = 0; index < count; index++) {
         var projectile:Projectile = context.projectiles[index];
         if(projectile == null || projectile.projProps == null) {
            continue;
         }
         var planningHalfSize:Number = projectile.collisionHalfSize() *
               context.hitboxScale;
         var physicalHalfSize:Number = projectile.collisionHalfSize();
         var minimumPlanning:Number = Number.POSITIVE_INFINITY;
         var minimumPhysical:Number = Number.POSITIVE_INFINITY;
         var firstPlanningImpact:int = int.MAX_VALUE;
         var firstPhysicalImpact:int = int.MAX_VALUE;
         var previousSet:Boolean = !projectile.isLaser();
         var previousSample:int = -context.movementLeadMs;
         if(previousSet) {
            this.previousProjectilePosition_.setTo(projectile.x_,projectile.y_);
         }
         var endOffset:int = Math.min(context.projectileHorizonMs,
               Math.max(0,projectile.startTime_ + projectile.lifetime -
               context.time));
         var sample:int = 0;
         while(sample <= endOffset) {
            var sampleTime:int = context.time + sample;
            if(!projectile.isAliveAt(sampleTime)) {
               break;
            }
            projectile.predictPositionAt(sampleTime,this.projectilePosition_);
            if(previousSet && !projectile.isLaser() &&
                  !context.map.isProjectileSegmentOpen(
                  this.previousProjectilePosition_.x,
                  this.previousProjectilePosition_.y,
                  this.projectilePosition_.x,this.projectilePosition_.y,
                  projectile)) {
               break;
            }
            var movementOffset:int = Math.min(travelLimit,
                  context.movementLeadMs + sample);
            var playerX:Number = context.player.x_ + velocityX * movementOffset;
            var playerY:Number = context.player.y_ + velocityY * movementOffset;
            var rawClearance:Number;
            var impactOffset:int = sample;
            if(previousSet) {
               var previousMovementOffset:int = Math.min(travelLimit,
                     context.movementLeadMs + previousSample);
               var previousPlayerX:Number = context.player.x_ + velocityX *
                     previousMovementOffset;
               var previousPlayerY:Number = context.player.y_ + velocityY *
                     previousMovementOffset;
               rawClearance = this.projectileCorridorSweepClearance(context,
                     projectile,previousPlayerX,previousPlayerY,playerX,playerY,
                     previousMovementOffset,movementOffset);
               impactOffset = Math.max(0,previousSample);
            } else {
               rawClearance = this.projectileCorridorPointClearance(context,
                     projectile,playerX,playerY,movementOffset);
            }
            var planningClearance:Number = rawClearance - planningHalfSize;
            var physicalClearance:Number = rawClearance - physicalHalfSize;
            minimumPlanning = Math.min(minimumPlanning,planningClearance);
            minimumPhysical = Math.min(minimumPhysical,physicalClearance);
            if(planningClearance <= 0) {
               firstPlanningImpact = Math.min(firstPlanningImpact,impactOffset);
            }
            if(physicalClearance <= 0) {
               firstPhysicalImpact = Math.min(firstPhysicalImpact,impactOffset);
            }
            this.previousProjectilePosition_.copyFrom(this.projectilePosition_);
            previousSet = true;
            if(sample >= endOffset) {
               break;
            }
            previousSample = sample;
            sample = Math.min(endOffset,sample + context.sampleMs);
         }
         var safetyClearance:Number = minimumPlanning -
               context.projectileClearance;
         noteClearance(out,safetyClearance);
         if(safetyClearance < 0) {
            out.reject(projectile.isLaser() ? "laser" : "projectile",
                  firstPlanningImpact < int.MAX_VALUE ? firstPlanningImpact : 0,
                  safetyClearance);
         }
         if(minimumPhysical <= 0) {
            out.expectedDamage += Math.max(0,context.player.damageWithDefense(
                  projectile.damage_,context.player.defense_,
                  projectile.projProps.armorPiercing_,context.player.condition_));
            this.noteProjectileStatus(out,projectile);
            out.impactMs = Math.min(out.impactMs,firstPhysicalImpact);
         }
      }
   }

   private function projectileEmitterClearance(context:DodgeFrameContext,
                                               emitter:MovingAoeEmitter,
                                               velocityX:Number,
                                               velocityY:Number,
                                               travelLimit:int) : Number {
      var endOffset:int = context.movementLeadMs +
            context.localMobilityHorizonMs;
      var sourceStartX:Number = emitter.predictedX(0);
      var sourceStartY:Number = emitter.predictedY(0);
      var sourceEndX:Number = emitter.predictedX(context.localMobilityHorizonMs);
      var sourceEndY:Number = emitter.predictedY(context.localMobilityHorizonMs);
      var startMove:int = Math.min(travelLimit,context.movementLeadMs);
      var endMove:int = Math.min(travelLimit,endOffset);
      var playerStartX:Number = context.player.x_ + velocityX * startMove;
      var playerStartY:Number = context.player.y_ + velocityY * startMove;
      var playerEndX:Number = context.player.x_ + velocityX * endMove;
      var playerEndY:Number = context.player.y_ + velocityY * endMove;
      var clearance:Number = movingCoreClearance(sourceStartX,sourceStartY,
            sourceEndX,sourceEndY,playerStartX,playerStartY,playerEndX,
            playerEndY,emitter.projectileGuardRadius_);
      if(!context.serverTemporalActive) {
         return clearance;
      }
      var startScale:Number = this.serverPathScale(context,startMove);
      var endScale:Number = this.serverPathScale(context,endMove);
      return Math.min(clearance,movingCoreClearance(sourceStartX,sourceStartY,
            sourceEndX,sourceEndY,
            playerStartX + context.serverOffsetX * startScale,
            playerStartY + context.serverOffsetY * startScale,
            playerEndX + context.serverOffsetX * endScale,
            playerEndY + context.serverOffsetY * endScale,
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
      return DodgeGeometry.pointToSegmentDistance(0,0,startX,startY,endX,endY) -
            radius;
   }

   private function projectileCorridorPointClearance(context:DodgeFrameContext,
                                                      projectile:Projectile,
                                                      playerX:Number,
                                                      playerY:Number,
                                                      movementOffset:int) : Number {
      var localClearance:Number = this.projectilePointClearance(projectile,
            playerX,playerY);
      if(!context.serverTemporalActive) {
         return localClearance;
      }
      var scale:Number = this.serverPathScale(context,movementOffset);
      return Math.min(localClearance,this.projectilePointClearance(projectile,
            playerX + context.serverOffsetX * scale,
            playerY + context.serverOffsetY * scale));
   }

   private function projectileCorridorSweepClearance(context:DodgeFrameContext,
                                                      projectile:Projectile,
                                                      previousPlayerX:Number,
                                                      previousPlayerY:Number,
                                                      playerX:Number,
                                                      playerY:Number,
                                                      previousOffset:int,
                                                      movementOffset:int) : Number {
      var localClearance:Number = this.projectileSweepClearance(projectile,
            previousPlayerX,previousPlayerY,playerX,playerY);
      if(!context.serverTemporalActive) {
         return localClearance;
      }
      var previousScale:Number = this.serverPathScale(context,previousOffset);
      var scale:Number = this.serverPathScale(context,movementOffset);
      return Math.min(localClearance,this.projectileSweepClearance(projectile,
            previousPlayerX + context.serverOffsetX * previousScale,
            previousPlayerY + context.serverOffsetY * previousScale,
            playerX + context.serverOffsetX * scale,
            playerY + context.serverOffsetY * scale));
   }

   private function projectilePointClearance(projectile:Projectile,
                                             playerX:Number,
                                             playerY:Number) : Number {
      if(projectile.isLaser()) {
         return projectile.laserClearanceTo(playerX,playerY);
      }
      return Math.max(Math.abs(this.projectilePosition_.x - playerX),
            Math.abs(this.projectilePosition_.y - playerY));
   }

   private function projectileSweepClearance(projectile:Projectile,
                                             previousPlayerX:Number,
                                             previousPlayerY:Number,
                                             playerX:Number,
                                             playerY:Number) : Number {
      if(projectile.isLaser()) {
         return projectile.laserClearanceToSegment(previousPlayerX,
               previousPlayerY,playerX,playerY);
      }
      return DodgeGeometry.minimumChebyshevOnSegment(
            this.previousProjectilePosition_.x - previousPlayerX,
            this.previousProjectilePosition_.y - previousPlayerY,
            this.projectilePosition_.x - playerX,
            this.projectilePosition_.y - playerY);
   }

   private function pointToServerDistance(context:DodgeFrameContext,
                                          pointX:Number, pointY:Number,
                                          playerX:Number, playerY:Number,
                                          movementOffset:int) : Number {
      var localX:Number = pointX - playerX;
      var localY:Number = pointY - playerY;
      var localDistance:Number = Math.sqrt(localX * localX + localY * localY);
      if(!context.serverTemporalActive) {
         return localDistance;
      }
      var scale:Number = this.serverPathScale(context,movementOffset);
      var serverX:Number = pointX -
            (playerX + context.serverOffsetX * scale);
      var serverY:Number = pointY -
            (playerY + context.serverOffsetY * scale);
      return Math.min(localDistance,Math.sqrt(serverX * serverX +
            serverY * serverY));
   }

   private function serverPathScale(context:DodgeFrameContext,
                                    movementOffset:int) : Number {
      return Math.max(0,1 - Math.max(0,movementOffset) /
            Number(context.serverCatchupMs));
   }

   private static function effectiveDamage(player:Player,
                                           threat:DodgeThreat) : int {
      if(threat.damage < 0) {
         return Math.max(1,player.maxHP_);
      }
      return Math.max(0,player.damageWithDefense(threat.damage,player.defense_,
            threat.armorPiercing,player.condition_));
   }

   private function noteThreatStatus(out:DodgeTrajectoryResult,
                                     threat:DodgeThreat) : void {
      if(threat.damage < 0 || DodgeCost.isLethalCondition(threat.effect)) {
         out.lethal = true;
      }
      out.statusSeverity = Math.max(out.statusSeverity,
            DodgeCost.conditionSeverity(threat.effect,threat.effectDuration));
   }

   private function noteProjectileStatus(out:DodgeTrajectoryResult,
                                         projectile:Projectile) : void {
      if(projectile.projProps.effects_ == null) {
         return;
      }
      for each(var effect:uint in projectile.projProps.effects_) {
         out.statusSeverity = Math.max(out.statusSeverity,
               DodgeCost.conditionSeverity(int(effect),1));
         if(DodgeCost.isLethalCondition(int(effect))) {
            out.lethal = true;
         }
      }
   }

   private static function noteClearance(out:DodgeTrajectoryResult,
                                         clearance:Number) : void {
      if(clearance < out.minimumClearance) {
         out.minimumClearance = clearance;
      }
   }
}
}
