package com.company.assembleegameclient.objects.autododge {

/**
 * Validated, allocation-free snapshot of the planner options used in one
 * evaluation. Keeping validation here gives every planning stage the same
 * values and prevents option lookups from being scattered through hot loops.
 */
public final class DodgeConfig {
   public var projectileClearance:Number = 0.1;
   public var aoeClearance:Number = 0.2;
   public var lookAheadMs:int = 300;
   public var aoeLookAheadMs:int = 1200;
   public var playerHitboxScale:Number = 0.92;
   public var cornerLookAheadTiles:Number = 1.5;
   public var cornerStrength:Number = 1;
   public var reactionLeadMs:int = 250;
   public var manualInfluence:Number = 0.75;
   public var hysteresisMs:int = 100;
   public var avoidDamagingGround:Boolean = true;

   public function refresh(data:Object) : void {
      this.projectileClearance = number(data,"autoDodgeProjectileClearance",
            0.1,0,1.5);
      this.aoeClearance = number(data,"autoDodgeAoeClearance",0.2,0,1.5);
      this.lookAheadMs = int(number(data,"autoDodgeLookAheadMs",300,100,1000));
      this.aoeLookAheadMs = int(number(data,"autoDodgeAoeLookAheadMs",
            1200,300,2500));
      this.playerHitboxScale = number(data,"autoDodgePlayerHitbox",92,0,100) / 100;
      this.cornerLookAheadTiles = number(data,"autoDodgeCornerLookAheadTiles",
            1.5,0,4);
      this.cornerStrength = number(data,"autoDodgeCornerStrength",1,0,2);
      this.reactionLeadMs = int(number(data,"autoDodgeReactionLeadMs",250,100,500));
      this.manualInfluence = number(data,"autoDodgeManualInfluence",0.75,0,0.75);
      this.hysteresisMs = int(number(data,"autoDodgeHysteresisMs",100,0,500));
      this.avoidDamagingGround = data.autoDodgeAvoidGround !== false;
   }

   private static function number(data:Object, key:String, fallback:Number,
                                  minimum:Number, maximum:Number) : Number {
      var value:Number = Number(data[key]);
      if(isNaN(value)) {
         value = fallback;
      }
      return Math.max(minimum,Math.min(maximum,value));
   }
}
}
