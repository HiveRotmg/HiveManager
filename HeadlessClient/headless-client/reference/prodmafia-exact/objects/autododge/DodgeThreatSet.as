package com.company.assembleegameclient.objects.autododge {

/** Allocation-free, pooled vectors of normalized threats for one frame. */
public final class DodgeThreatSet {
   private const pool_:Vector.<DodgeThreat> = new Vector.<DodgeThreat>();
   private var used_:int = 0;
   private const spatialIndex_:DodgeThreatSpatialIndex = new DodgeThreatSpatialIndex();

   public const all:Vector.<DodgeThreat> = new Vector.<DodgeThreat>();
   public const projectiles:Vector.<DodgeThreat> = new Vector.<DodgeThreat>();
   public const aoes:Vector.<DodgeThreat> = new Vector.<DodgeThreat>();
   public const thrownAoes:Vector.<DodgeThreat> = new Vector.<DodgeThreat>();
   public const telegraphedAoes:Vector.<DodgeThreat> = new Vector.<DodgeThreat>();
   public const movingAoes:Vector.<DodgeThreat> = new Vector.<DodgeThreat>();
   public const recentAoes:Vector.<DodgeThreat> = new Vector.<DodgeThreat>();
   public const projectileEmitters:Vector.<DodgeThreat> = new Vector.<DodgeThreat>();
   public const grounds:Vector.<DodgeThreat> = new Vector.<DodgeThreat>();
   public const reactiveRegions:Vector.<DodgeThreat> = new Vector.<DodgeThreat>();
   public var deduplicatedCount:int = 0;

   public function DodgeThreatSet(initialCapacity:int = 128) {
      for(var index:int = 0; index < initialCapacity; index++) {
         this.pool_.push(new DodgeThreat());
      }
   }

   public function reset() : void {
      this.used_ = 0;
      this.spatialIndex_.reset();
      this.all.length = 0;
      this.projectiles.length = 0;
      this.aoes.length = 0;
      this.thrownAoes.length = 0;
      this.telegraphedAoes.length = 0;
      this.movingAoes.length = 0;
      this.recentAoes.length = 0;
      this.projectileEmitters.length = 0;
      this.grounds.length = 0;
      this.reactiveRegions.length = 0;
      this.deduplicatedCount = 0;
   }

   public function acquire(kind:int, identityA:int,
                           identityB:int = 0) : DodgeThreat {
      if(this.used_ >= this.pool_.length) {
         this.pool_.push(new DodgeThreat());
      }
      var threat:DodgeThreat = this.pool_[this.used_++].reset(kind,identityA,identityB);
      this.all.push(threat);
      if(kind >= DodgeThreat.THROWN_AOE && kind <= DodgeThreat.RECENT_AOE) {
         this.aoes.push(threat);
      }
      switch(kind) {
         case DodgeThreat.PROJECTILE:
            this.projectiles.push(threat);
            break;
         case DodgeThreat.THROWN_AOE:
            this.thrownAoes.push(threat);
            break;
         case DodgeThreat.TELEGRAPH_AOE:
            this.telegraphedAoes.push(threat);
            break;
         case DodgeThreat.MOVING_AOE:
            this.movingAoes.push(threat);
            break;
         case DodgeThreat.RECENT_AOE:
            this.recentAoes.push(threat);
            break;
         case DodgeThreat.PROJECTILE_EMITTER:
            this.projectileEmitters.push(threat);
            break;
         case DodgeThreat.GROUND:
            this.grounds.push(threat);
            break;
         case DodgeThreat.REACTIVE:
            this.reactiveRegions.push(threat);
            break;
      }
      return threat;
   }

   public function indexCircle(threat:DodgeThreat) : void {
      this.spatialIndex_.insert(threat);
   }

   public function markNearbyAoes(x:Number, y:Number, radius:Number) : int {
      return this.spatialIndex_.markNearby(x,y,radius);
   }
}
}
