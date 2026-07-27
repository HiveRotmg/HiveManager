package com.company.assembleegameclient.objects.autododge {

/**
 * Conservative fixed-grid broad phase for normalized circle threats.
 *
 * Circles occupy every grid cell touched by their bounding box. Hash collisions
 * only create extra checks; exact circle overlap is verified during query, so
 * they cannot hide a threat. Very large circles use a global list.
 */
public final class DodgeThreatSpatialIndex {
   private static const CELL_SIZE:Number = 4;
   private static const BUCKET_COUNT:int = 256;
   private static const BUCKET_MASK:int = BUCKET_COUNT - 1;
   private static const MAX_INDEX_CELLS:int = 64;

   private const buckets_:Vector.<Vector.<DodgeThreat>> =
         new Vector.<Vector.<DodgeThreat>>(BUCKET_COUNT,true);
   private const touched_:Vector.<Boolean> = new Vector.<Boolean>(BUCKET_COUNT,true);
   private const touchedIndices_:Vector.<int> = new Vector.<int>();
   private const global_:Vector.<DodgeThreat> = new Vector.<DodgeThreat>();

   public function DodgeThreatSpatialIndex() {
      for(var index:int = 0; index < BUCKET_COUNT; index++) {
         this.buckets_[index] = new Vector.<DodgeThreat>();
      }
   }

   public function reset() : void {
      var count:int = this.touchedIndices_.length;
      for(var index:int = 0; index < count; index++) {
         var bucketIndex:int = this.touchedIndices_[index];
         this.buckets_[bucketIndex].length = 0;
         this.touched_[bucketIndex] = false;
      }
      this.touchedIndices_.length = 0;
      this.global_.length = 0;
   }

   public function insert(threat:DodgeThreat) : void {
      if(threat == null || !isFinite(threat.x) || !isFinite(threat.y) ||
            !isFinite(threat.radius) || threat.radius < 0) {
         this.global_.push(threat);
         return;
      }
      var minX:int = int(Math.floor((threat.x - threat.radius) / CELL_SIZE));
      var maxX:int = int(Math.floor((threat.x + threat.radius) / CELL_SIZE));
      var minY:int = int(Math.floor((threat.y - threat.radius) / CELL_SIZE));
      var maxY:int = int(Math.floor((threat.y + threat.radius) / CELL_SIZE));
      var cellsWide:int = maxX - minX + 1;
      var cellsHigh:int = maxY - minY + 1;
      if(cellsWide * cellsHigh > MAX_INDEX_CELLS) {
         this.global_.push(threat);
         return;
      }
      for(var cellY:int = minY; cellY <= maxY; cellY++) {
         for(var cellX:int = minX; cellX <= maxX; cellX++) {
            var bucketIndex:int = hash(cellX,cellY);
            if(!this.touched_[bucketIndex]) {
               this.touched_[bucketIndex] = true;
               this.touchedIndices_.push(bucketIndex);
            }
            this.buckets_[bucketIndex].push(threat);
         }
      }
   }

   /** Marks every circle which can overlap the query circle. */
   public function markNearby(x:Number, y:Number, radius:Number) : int {
      var marked:int = 0;
      var minX:int = int(Math.floor((x - radius) / CELL_SIZE));
      var maxX:int = int(Math.floor((x + radius) / CELL_SIZE));
      var minY:int = int(Math.floor((y - radius) / CELL_SIZE));
      var maxY:int = int(Math.floor((y + radius) / CELL_SIZE));
      for(var cellY:int = minY; cellY <= maxY; cellY++) {
         for(var cellX:int = minX; cellX <= maxX; cellX++) {
            var bucket:Vector.<DodgeThreat> = this.buckets_[hash(cellX,cellY)];
            var count:int = bucket.length;
            for(var index:int = 0; index < count; index++) {
               var threat:DodgeThreat = bucket[index];
               if(threat.spatiallyRelevant || !overlaps(threat,x,y,radius)) {
                  continue;
               }
               threat.spatiallyRelevant = true;
               marked++;
            }
         }
      }
      var globalCount:int = this.global_.length;
      for(index = 0; index < globalCount; index++) {
         threat = this.global_[index];
         if(threat != null && !threat.spatiallyRelevant &&
               overlaps(threat,x,y,radius)) {
            threat.spatiallyRelevant = true;
            marked++;
         }
      }
      return marked;
   }

   private static function overlaps(threat:DodgeThreat, x:Number, y:Number,
                                    radius:Number) : Boolean {
      if(threat == null || !isFinite(threat.x) || !isFinite(threat.y) ||
            !isFinite(threat.radius)) {
         return true;
      }
      var combined:Number = Math.max(0,radius) + Math.max(0,threat.radius);
      var dx:Number = threat.x - x;
      var dy:Number = threat.y - y;
      return dx * dx + dy * dy <= combined * combined;
   }

   private static function hash(cellX:int, cellY:int) : int {
      return ((cellX * 73856093) ^ (cellY * 19349663)) & BUCKET_MASK;
   }
}
}
