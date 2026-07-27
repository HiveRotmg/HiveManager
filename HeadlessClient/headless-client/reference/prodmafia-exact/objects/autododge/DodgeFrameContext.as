package com.company.assembleegameclient.objects.autododge {

import com.company.assembleegameclient.map.Map;
import com.company.assembleegameclient.map.MovingAoeEmitter;
import com.company.assembleegameclient.objects.Player;
import com.company.assembleegameclient.objects.Projectile;

/**
 * Reused snapshot of every input needed to evaluate an exact movement route.
 * The controller refreshes this once per frame; probes then share identical
 * threat horizons, collision boundaries and server-position semantics.
 */
public final class DodgeFrameContext {
   public var player:Player;
   public var map:Map;
   public var threats:DodgeThreatSet;
   public var projectiles:Vector.<Projectile>;
   public var projectileEmitters:Vector.<MovingAoeEmitter>;
   public var time:int;
   public var movementLeadMs:int;
   public var projectileHorizonMs:int;
   public var aoeHorizonMs:int;
   public var velocityAoeHorizonMs:int;
   public var sampleMs:int;
   public var localMobilityHorizonMs:int;
   public var projectileClearance:Number;
   public var aoeClearance:Number;
   public var hitboxScale:Number;
   public var serverOffsetX:Number;
   public var serverOffsetY:Number;
   public var serverTemporalActive:Boolean;
   public var serverRebaseActive:Boolean;
   public var serverCatchupMs:int;

   public function setTo(player:Player, map:Map, threats:DodgeThreatSet,
                         projectiles:Vector.<Projectile>,
                         projectileEmitters:Vector.<MovingAoeEmitter>,
                         time:int, movementLeadMs:int,
                         projectileHorizonMs:int, aoeHorizonMs:int,
                         velocityAoeHorizonMs:int, sampleMs:int,
                         localMobilityHorizonMs:int,
                         projectileClearance:Number, aoeClearance:Number,
                         hitboxScale:Number, serverOffsetX:Number,
                         serverOffsetY:Number,
                         serverTemporalActive:Boolean,
                         serverRebaseActive:Boolean,
                         serverCatchupMs:int) : void {
      this.player = player;
      this.map = map;
      this.threats = threats;
      this.projectiles = projectiles;
      this.projectileEmitters = projectileEmitters;
      this.time = time;
      this.movementLeadMs = movementLeadMs;
      this.projectileHorizonMs = projectileHorizonMs;
      this.aoeHorizonMs = aoeHorizonMs;
      this.velocityAoeHorizonMs = velocityAoeHorizonMs;
      this.sampleMs = sampleMs;
      this.localMobilityHorizonMs = localMobilityHorizonMs;
      this.projectileClearance = Math.max(0,projectileClearance);
      this.aoeClearance = Math.max(0,aoeClearance);
      this.hitboxScale = Math.max(0,hitboxScale);
      this.serverOffsetX = serverOffsetX;
      this.serverOffsetY = serverOffsetY;
      this.serverTemporalActive = serverTemporalActive;
      this.serverRebaseActive = serverRebaseActive;
      this.serverCatchupMs = Math.max(1,serverCatchupMs);
   }
}
}
