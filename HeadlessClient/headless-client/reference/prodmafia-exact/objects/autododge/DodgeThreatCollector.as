package com.company.assembleegameclient.objects.autododge {

import com.company.assembleegameclient.map.Map;
import com.company.assembleegameclient.map.MovingAoeEmitter;
import com.company.assembleegameclient.objects.Player;
import com.company.assembleegameclient.objects.Projectile;
import com.company.assembleegameclient.objects.thrown.ThrownProjectile;

/** Converts live map sources into one normalized, pooled frame threat set. */
public final class DodgeThreatCollector {
   private static const EMITTER_MATCH_DISTANCE:Number = 0.40;

   public function collect(out:DodgeThreatSet, player:Player, map:Map,
                           hostile:Vector.<Projectile>, time:int,
                           avoidDamagingGround:Boolean,
                           reactiveActive:Boolean = false,
                           reactiveIdentity:int = 0,
                           reactiveX:Number = 0, reactiveY:Number = 0,
                           reactiveRadius:Number = 1.25,
                           reactiveDamage:int = 0,
                           reactiveUntil:int = 0) : void {
      out.reset();
      this.collectProjectiles(out,player,hostile,time);
      this.collectThrownAoes(out,map,time);
      this.collectTelegraphedAoes(out,map,time);
      this.collectMovingEmitters(out,map,time);
      this.collectRecentAoes(out,map,time);
      if(avoidDamagingGround) {
         var ground:DodgeThreat = out.acquire(DodgeThreat.GROUND,1);
         ground.geometry = DodgeThreat.TILE_FIELD;
         ground.activeFrom = time;
         ground.activeUntil = int.MAX_VALUE;
         ground.confidence = DodgeThreat.AUTHORITATIVE;
         ground.authoritative = true;
      }
      if(reactiveActive) {
         var reactive:DodgeThreat = out.acquire(DodgeThreat.REACTIVE,
               reactiveIdentity);
         reactive.geometry = DodgeThreat.CIRCLE;
         reactive.x = reactiveX;
         reactive.y = reactiveY;
         reactive.radius = reactiveRadius;
         reactive.activeFrom = time;
         reactive.activeUntil = reactiveUntil;
         reactive.damage = reactiveDamage;
         reactive.confidence = DodgeThreat.PREDICTED;
         reactive.predicted = true;
         reactive.reactive = true;
      }
   }

   private function collectProjectiles(out:DodgeThreatSet, player:Player,
                                       hostile:Vector.<Projectile>, time:int) : void {
      var count:int = hostile != null ? hostile.length : 0;
      for(var index:int = 0; index < count; index++) {
         var projectile:Projectile = hostile[index];
         if(projectile == null || projectile.projProps == null ||
               !projectile.isThreatTo(player,time)) {
            continue;
         }
         var threat:DodgeThreat = out.acquire(DodgeThreat.PROJECTILE,
               projectile.ownerId_,int(projectile.bulletId_));
         threat.geometry = DodgeThreat.SWEPT_POINT;
         threat.sourceType = projectile.containerType_;
         threat.attackType = int(projectile.bulletType_);
         threat.activeFrom = projectile.startTime_;
         threat.activeUntil = projectile.startTime_ + int(projectile.lifetime);
         threat.damage = projectile.damage_;
         threat.armorPiercing = projectile.projProps.armorPiercing_;
         if(projectile.projProps.effects_ != null &&
               projectile.projProps.effects_.length > 0) {
            threat.effect = int(projectile.projProps.effects_[0]);
         }
         threat.confidence = DodgeThreat.AUTHORITATIVE;
         threat.authoritative = true;
         threat.predicted = true;
         threat.projectile = projectile;
      }
   }

   private function collectThrownAoes(out:DodgeThreatSet, map:Map, time:int) : void {
      var count:int = map.activeThrownProjectiles_.length;
      for(var index:int = 0; index < count; index++) {
         var thrown:ThrownProjectile = map.activeThrownProjectiles_[index];
         if(thrown == null || thrown.end_ == null ||
               !map.isThrownAoeConfirmed(thrown)) {
            continue;
         }
         // The matching authoritative impact replaces this visual warning.
         if(thrown.aoeImpactMatched_) {
            out.deduplicatedCount++;
            continue;
         }
         var threat:DodgeThreat = out.acquire(DodgeThreat.THROWN_AOE,
               int(thrown.dodgeThreatId_));
         threat.geometry = DodgeThreat.CIRCLE;
         threat.sourceType = thrown.sourceType_;
         threat.attackType = thrown.showEffectType_;
         threat.x = thrown.end_.x;
         threat.y = thrown.end_.y;
         threat.radius = map.getThrownAoeRadius(thrown);
         threat.impactOffset = map.getThrownAoeLandingOffset(thrown);
         threat.activeFrom = time;
         threat.activeUntil = time + Math.max(0,threat.impactOffset);
         threat.damage = map.getThrownAoeDamage(thrown);
         threat.armorPiercing = map.isThrownAoeArmorPiercing(thrown);
         threat.effect = map.getThrownAoeEffect(thrown);
         threat.effectDuration = map.getThrownAoeEffectDuration(thrown);
         threat.confidence = threat.damage >= 0 ? DodgeThreat.PROVEN :
               DodgeThreat.DIAGNOSTIC;
         threat.predicted = true;
         threat.repeating = thrown.persistentAoeWarning_;
         threat.thrown = thrown;
         out.indexCircle(threat);
      }
   }

   private function collectTelegraphedAoes(out:DodgeThreatSet, map:Map,
                                            time:int) : void {
      var count:int = map.getTelegraphedAoeCount(time);
      for(var index:int = 0; index < count; index++) {
         var threat:DodgeThreat = out.acquire(DodgeThreat.TELEGRAPH_AOE,
               map.getTelegraphedAoeId(index),map.getTelegraphedAoeTarget(index));
         threat.geometry = DodgeThreat.CIRCLE;
         threat.sourceType = map.getTelegraphedAoeSource(index);
         threat.attackType = map.getTelegraphedAoeEffect(index);
         threat.x = map.getTelegraphedAoeX(index);
         threat.y = map.getTelegraphedAoeY(index);
         threat.radius = map.getTelegraphedAoeRadius(index);
         threat.activeFrom = map.getTelegraphedAoeCreated(index);
         threat.activeUntil = map.getTelegraphedAoeUntil(index);
         threat.impactOffset = Math.max(0,map.getTelegraphedAoeImpact(index) - time);
         threat.damage = map.getTelegraphedAoeDamage(index);
         threat.armorPiercing = map.isTelegraphedAoeArmorPiercing(index);
         threat.confidence = threat.damage >= 0 ? DodgeThreat.PROVEN :
               DodgeThreat.DIAGNOSTIC;
         threat.predicted = true;
         out.indexCircle(threat);
      }
   }

   private function collectMovingEmitters(out:DodgeThreatSet, map:Map,
                                           time:int) : void {
      var count:int = map.activeMovingAoeEmitters_.length;
      for(var index:int = 0; index < count; index++) {
         var emitter:MovingAoeEmitter = map.activeMovingAoeEmitters_[index];
         if(emitter == null || emitter.object_ == null) {
            continue;
         }
         emitter.capturePosition(time);
         if(emitter.isProjectileGuard(time)) {
            var guard:DodgeThreat = out.acquire(DodgeThreat.PROJECTILE_EMITTER,
                  emitter.objectId,emitter.objectType);
            guard.geometry = DodgeThreat.MOVING_CIRCLE;
            guard.sourceType = emitter.objectType;
            guard.x = emitter.predictedX(0);
            guard.y = emitter.predictedY(0);
            guard.radius = emitter.projectileGuardRadius_;
            guard.activeFrom = time;
            guard.activeUntil = int.MAX_VALUE;
            guard.damage = emitter.projectileGuardDamage_;
            guard.confidence = DodgeThreat.PROVEN;
            guard.predicted = true;
            guard.emitter = emitter;
         }
         if(!emitter.isActive(time)) {
            continue;
         }
         var threat:DodgeThreat = out.acquire(DodgeThreat.MOVING_AOE,
               emitter.objectId,emitter.objectType);
         threat.geometry = DodgeThreat.MOVING_CIRCLE;
         threat.sourceType = emitter.objectType;
         threat.impactOffset = emitter.impactOffset(time);
         threat.x = emitter.predictedX(threat.impactOffset);
         threat.y = emitter.predictedY(threat.impactOffset);
         threat.radius = emitter.radius_;
         threat.activeFrom = time;
         threat.activeUntil = time + threat.impactOffset;
         threat.damage = emitter.damage_;
         threat.armorPiercing = emitter.armorPiercing_;
         threat.effect = emitter.effect_;
         threat.effectDuration = emitter.effectDuration_;
         threat.attackType = threat.effect;
         threat.confidence = threat.damage < 0 ? DodgeThreat.DIAGNOSTIC :
               emitter.confirmed_ ? DodgeThreat.AUTHORITATIVE : DodgeThreat.PROVEN;
         threat.authoritative = emitter.confirmed_;
         threat.predicted = true;
         threat.repeating = true;
         threat.emitter = emitter;
         out.indexCircle(threat);
      }
   }

   private function collectRecentAoes(out:DodgeThreatSet, map:Map,
                                      time:int) : void {
      var count:int = map.getRecentAoeCount(time);
      for(var index:int = 0; index < count; index++) {
         var created:int = map.getRecentAoeCreated(index);
         var originType:int = map.getRecentAoeOriginType(index);
         var x:Number = map.getRecentAoeX(index);
         var y:Number = map.getRecentAoeY(index);
         if(this.matchesMovingEmitter(out,originType,x,y,created,time)) {
            out.deduplicatedCount++;
            continue;
         }
         var threat:DodgeThreat = out.acquire(DodgeThreat.RECENT_AOE,
               map.getRecentAoeId(index));
         threat.geometry = DodgeThreat.CIRCLE;
         threat.sourceType = originType;
         threat.x = x;
         threat.y = y;
         threat.radius = map.getRecentAoeRadius(index);
         threat.activeFrom = created;
         threat.activeUntil = map.getRecentAoeUntil(index);
         threat.damage = map.getRecentAoeDamage(index);
         threat.armorPiercing = map.getRecentAoeArmorPiercing(index);
         threat.effect = map.getRecentAoeEffect(index);
         threat.effectDuration = map.getRecentAoeEffectDuration(index);
         threat.attackType = threat.effect;
         threat.confidence = DodgeThreat.AUTHORITATIVE;
         threat.authoritative = true;
         threat.repeating = map.isRecentAoeRepeating(index);
         out.indexCircle(threat);
      }
   }

   private function matchesMovingEmitter(out:DodgeThreatSet, originType:int,
                                         x:Number, y:Number, created:int,
                                         time:int) : Boolean {
      if(originType <= 0) {
         return false;
      }
      var count:int = out.movingAoes.length;
      for(var index:int = 0; index < count; index++) {
         var emitter:MovingAoeEmitter = out.movingAoes[index].emitter;
         if(emitter == null || emitter.objectType != originType ||
               emitter.lastImpact_ != created) {
            continue;
         }
         var matchRadius:Number = Math.max(EMITTER_MATCH_DISTANCE,
               Math.min(1,emitter.radius_ * 0.35));
         if(emitter.distanceSqToTrajectory(x,y,time) <= matchRadius * matchRadius) {
            return true;
         }
      }
      return false;
   }
}
}
