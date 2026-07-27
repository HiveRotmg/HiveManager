package com.company.assembleegameclient.objects.autododge {

/** Allocation-free result from one exact velocity evaluation. */
public final class DodgeTrajectoryResult {
   public var safe:Boolean = true;
   public var expectedDamage:Number = 0;
   public var lethal:Boolean = false;
   public var statusSeverity:Number = 0;
   public var impactMs:int = int.MAX_VALUE;
   public var safetyBreachMs:int = int.MAX_VALUE;
   public var minimumClearance:Number = Number.POSITIVE_INFINITY;
   public var blockMs:int = int.MAX_VALUE;
   public var reachableX:Number = 0;
   public var reachableY:Number = 0;
   public var groundExposureMs:int = 0;
   public var reason:String = "safe";

   public function reset(x:Number, y:Number) : void {
      this.safe = true;
      this.expectedDamage = 0;
      this.lethal = false;
      this.statusSeverity = 0;
      this.impactMs = int.MAX_VALUE;
      this.safetyBreachMs = int.MAX_VALUE;
      this.minimumClearance = Number.POSITIVE_INFINITY;
      this.blockMs = int.MAX_VALUE;
      this.reachableX = x;
      this.reachableY = y;
      this.groundExposureMs = 0;
      this.reason = "safe";
   }

   public function reject(reason:String, breachMs:int,
                          clearance:Number = Number.NEGATIVE_INFINITY) : void {
      this.safe = false;
      if(breachMs < this.safetyBreachMs) {
         this.safetyBreachMs = Math.max(0,breachMs);
         this.reason = reason;
      }
      if(clearance < this.minimumClearance) {
         this.minimumClearance = clearance;
      }
   }
}
}
