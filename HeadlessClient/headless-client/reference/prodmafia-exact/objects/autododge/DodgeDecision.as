package com.company.assembleegameclient.objects.autododge {

/** Allocation-free record of the route that will actually be integrated. */
public final class DodgeDecision {
   public var valid:Boolean = false;
   public var candidate:int = 0;
   public var velocityX:Number = 0;
   public var velocityY:Number = 0;
   public var speedScale:Number = 0;
   public var expectedDamage:Number = 0;
   public var impactMs:int = int.MAX_VALUE;
   public var overrideApplied:Boolean = false;
   public var threatCount:int = 0;
   public var reason:String = "none";

   public function reset() : void {
      this.valid = false;
      this.candidate = 0;
      this.velocityX = 0;
      this.velocityY = 0;
      this.speedScale = 0;
      this.expectedDamage = 0;
      this.impactMs = int.MAX_VALUE;
      this.overrideApplied = false;
      this.threatCount = 0;
      this.reason = "none";
   }

   public function setTo(candidate:int, velocityX:Number, velocityY:Number,
                         speedScale:Number, expectedDamage:Number, impactMs:int,
                         overrideApplied:Boolean, threatCount:int,
                         reason:String) : void {
      this.valid = true;
      this.candidate = candidate;
      this.velocityX = velocityX;
      this.velocityY = velocityY;
      this.speedScale = speedScale;
      this.expectedDamage = expectedDamage;
      this.impactMs = impactMs;
      this.overrideApplied = overrideApplied;
      this.threatCount = threatCount;
      this.reason = reason;
   }
}
}
