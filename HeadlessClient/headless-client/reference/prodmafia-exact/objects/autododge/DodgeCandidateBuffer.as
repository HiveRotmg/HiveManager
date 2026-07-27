package com.company.assembleegameclient.objects.autododge {

/**
 * Preallocated candidate directions and per-frame scoring channels.
 *
 * The vectors are intentionally exposed: the controller's hot loops index them
 * directly, without allocating candidate objects or invoking accessors.
 */
public final class DodgeCandidateBuffer {
   private static const TWO_PI:Number = Math.PI * 2;

   public var directionCount:int;
   public var intentCandidate:int;
   public var count:int;

   public var x:Vector.<Number>;
   public var y:Vector.<Number>;
   public var score:Vector.<Number>;
   public var safetyScore:Vector.<Number>;
   public var minimumClearance:Vector.<Number>;
   public var lethal:Vector.<Boolean>;
   public var expectedDamage:Vector.<Number>;
   public var statusSeverity:Vector.<Number>;
   public var physicalEdgeDamage:Vector.<Number>;
   public var physicalEdgeImpactMs:Vector.<int>;
   public var escapeOptions:Vector.<int>;
   public var groundExposureMs:Vector.<int>;
   public var impactMs:Vector.<int>;
   public var firstImpactMs:Vector.<int>;
   public var blockMs:Vector.<int>;
   public var wallBlockMs:Vector.<int>;
   public var intentError:Vector.<Number>;
   public var valid:Vector.<Boolean>;
   public var threatClearance:Vector.<Number>;

   public function DodgeCandidateBuffer(directionCount:int) {
      this.directionCount = directionCount;
      this.intentCandidate = directionCount + 1;
      this.count = directionCount + 2;
      this.x = new Vector.<Number>(this.count,true);
      this.y = new Vector.<Number>(this.count,true);
      this.score = new Vector.<Number>(this.count,true);
      this.minimumClearance = new Vector.<Number>(this.count,true);
      this.safetyScore = this.minimumClearance;
      this.lethal = new Vector.<Boolean>(this.count,true);
      this.expectedDamage = new Vector.<Number>(this.count,true);
      this.statusSeverity = new Vector.<Number>(this.count,true);
      this.physicalEdgeDamage = new Vector.<Number>(this.count,true);
      this.physicalEdgeImpactMs = new Vector.<int>(this.count,true);
      this.escapeOptions = new Vector.<int>(this.count,true);
      this.groundExposureMs = new Vector.<int>(this.count,true);
      this.firstImpactMs = new Vector.<int>(this.count,true);
      this.impactMs = this.firstImpactMs;
      this.wallBlockMs = new Vector.<int>(this.count,true);
      this.blockMs = this.wallBlockMs;
      this.intentError = new Vector.<Number>(this.count,true);
      this.valid = new Vector.<Boolean>(this.count,true);
      this.threatClearance = new Vector.<Number>(this.count,true);

      for(var index:int = 0; index < directionCount; index++) {
         var angle:Number = index * TWO_PI / directionCount;
         this.x[index + 1] = Math.cos(angle);
         this.y[index + 1] = Math.sin(angle);
      }
      this.resetFrame();
   }

   public function resetFrame() : void {
      for(var index:int = 0; index < this.count; index++) {
         this.score[index] = Number.POSITIVE_INFINITY;
         this.safetyScore[index] = Number.POSITIVE_INFINITY;
         this.lethal[index] = false;
         this.expectedDamage[index] = 0;
         this.statusSeverity[index] = 0;
         this.physicalEdgeDamage[index] = 0;
         this.physicalEdgeImpactMs[index] = int.MAX_VALUE;
         this.escapeOptions[index] = 8;
         this.groundExposureMs[index] = 0;
         this.impactMs[index] = int.MAX_VALUE;
         this.blockMs[index] = int.MAX_VALUE;
         this.intentError[index] = 0;
         this.valid[index] = true;
      }
   }
}
}
