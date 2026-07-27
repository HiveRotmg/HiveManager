package com.company.assembleegameclient.objects.autododge {

import com.company.assembleegameclient.map.MovingAoeEmitter;
import com.company.assembleegameclient.objects.Projectile;
import com.company.assembleegameclient.objects.thrown.ThrownProjectile;

/**
 * Reusable normalized description of one damaging source. Source objects are
 * retained only as typed references needed by the current trajectory model.
 */
public final class DodgeThreat {
   public static const PROJECTILE:int = 1;
   public static const THROWN_AOE:int = 2;
   public static const TELEGRAPH_AOE:int = 3;
   public static const MOVING_AOE:int = 4;
   public static const RECENT_AOE:int = 5;
   public static const PROJECTILE_EMITTER:int = 6;
   public static const GROUND:int = 7;
   public static const REACTIVE:int = 8;

   public static const SWEPT_POINT:int = 1;
   public static const CIRCLE:int = 2;
   public static const MOVING_CIRCLE:int = 3;
   public static const TILE_FIELD:int = 4;

   public static const DIAGNOSTIC:int = 0;
   public static const PREDICTED:int = 1;
   public static const PROVEN:int = 2;
   public static const AUTHORITATIVE:int = 3;

   public var kind:int;
   public var geometry:int;
   public var identityA:int;
   public var identityB:int;
   public var sourceType:int;
   public var attackType:int;
   public var x:Number;
   public var y:Number;
   public var radius:Number;
   public var activeFrom:int;
   public var activeUntil:int;
   public var impactOffset:int;
   public var damage:int;
   public var armorPiercing:Boolean;
   public var effect:int;
   public var effectDuration:Number;
   public var confidence:int;
   public var authoritative:Boolean;
   public var predicted:Boolean;
   public var repeating:Boolean;
   public var reactive:Boolean;
   public var spatiallyRelevant:Boolean;
   public var projectile:Projectile;
   public var thrown:ThrownProjectile;
   public var emitter:MovingAoeEmitter;

   public function reset(kind:int, identityA:int, identityB:int = 0) : DodgeThreat {
      this.kind = kind;
      this.geometry = 0;
      this.identityA = identityA;
      this.identityB = identityB;
      this.sourceType = -1;
      this.attackType = -1;
      this.x = 0;
      this.y = 0;
      this.radius = 0;
      this.activeFrom = 0;
      this.activeUntil = 0;
      this.impactOffset = 0;
      this.damage = -1;
      this.armorPiercing = false;
      this.effect = 0;
      this.effectDuration = 0;
      this.confidence = DIAGNOSTIC;
      this.authoritative = false;
      this.predicted = false;
      this.repeating = false;
      this.reactive = false;
      this.spatiallyRelevant = false;
      this.projectile = null;
      this.thrown = null;
      this.emitter = null;
      return this;
   }
}
}
