package com.company.assembleegameclient.map {
   import com.company.assembleegameclient.game.AGameSprite;
   import com.company.assembleegameclient.map.mapoverlay.MapOverlay;
   import com.company.assembleegameclient.map.partyoverlay.PartyOverlay;
   import com.company.assembleegameclient.objects.BasicObject;
   import com.company.assembleegameclient.objects.Character;
   import com.company.assembleegameclient.objects.GameObject;
   import com.company.assembleegameclient.objects.IInteractiveObject;
   import com.company.assembleegameclient.objects.Merchant;
   import com.company.assembleegameclient.objects.ObjectProperties;
   import com.company.assembleegameclient.objects.Party;
   import com.company.assembleegameclient.objects.Projectile;
   import com.company.assembleegameclient.objects.thrown.ThrownProjectile;
   import com.company.assembleegameclient.objects.particles.ParticleEffect;
   import com.company.assembleegameclient.parameters.Parameters;
   import com.company.assembleegameclient.util.TileRedrawer;
   import com.company.util.PointUtil;
   import flash.display.BitmapData;
   import flash.display.GraphicsBitmapFill;
   import flash.display.Graphics;
   import flash.filters.ColorMatrixFilter;
   import flash.geom.ColorTransform;
   import flash.geom.Point;
   import flash.geom.Rectangle;
   import flash.utils.Dictionary;
   import flash.utils.getTimer;
   import kabam.lib.net.impl.DebugLog;
   import kabam.rotmg.core.StaticInjectorContext;
   import kabam.rotmg.game.model.GameModel;
   import kabam.rotmg.stage3D.GraphicsFillExtra;
   import kabam.rotmg.stage3D.Render3D;
   import kabam.rotmg.stage3D.Renderer;
   import kabam.rotmg.stage3D.graphic3D.Program3DFactory;
   import kabam.rotmg.stage3D.graphic3D.TextureFactory;
   import kabam.rotmg.ui.signals.RealmOryxSignal;
   
   public class Map extends AbstractMap {
      
      public static const CLOTH_BAZAAR:String = "Cloth Bazaar";
      
      public static const NEXUS:String = "Nexus";
      
      public static const DAILY_QUEST_ROOM:String = "Daily Quest Room";
      
      public static const DAILY_LOGIN_ROOM:String = "Daily Login Room";
      
      public static const PET_YARD_1:String = "Pet Yard";
      
      public static const PET_YARD_2:String = "Pet Yard 2";
      
      public static const PET_YARD_3:String = "Pet Yard 3";
      
      public static const PET_YARD_4:String = "Pet Yard 4";
      
      public static const PET_YARD_5:String = "Pet Yard 5";
      
      public static const REALM:String = "Realm of the Mad God";

      public static const MOONLIGHT_VILLAGE:String = "Moonlight Village";
      
      public static const ORYX_CHAMBER:String = "Oryx\'s Chamber";
      
      public static const GUILD_HALL:String = "Guild Hall";
      
      public static const GUILD_HALL_2:String = "Guild Hall 2";
      
      public static const GUILD_HALL_3:String = "Guild Hall 3";
      
      public static const GUILD_HALL_4:String = "Guild Hall 4";
      
      public static const GUILD_HALL_5:String = "Guild Hall 5";
      
      public static const NEXUS_EXPLANATION:String = "Nexus_Explanation";
      
      public static const VAULT:String = "Vault";
      
      private static const VISIBLE_SORT_FIELDS:Array = ["sortVal_","objectId_"];
      
      private static const VISIBLE_SORT_PARAMS:Array = [16,16];
      
      protected static const BLIND_FILTER:ColorMatrixFilter = new ColorMatrixFilter([0.05,0.05,0.05,0,0,0.05,0.05,0.05,0,0,0.05,0.05,0.05,0,0,0.05,0.05,0.05,1,0]);
      
      public static var forceSoftwareRender:Boolean = false;
      
      public static var texture:BitmapData;
      
      protected static var BREATH_CT:ColorTransform = new ColorTransform(1,0.215686274509804,0,0);
       
      
      public var visible_:Array;
      
      public var visibleUnder_:Array;
      
      public var visibleSquares_:Vector.<Square>;
      
      public var topSquares_:Vector.<Square>;
      
      private var inUpdate_:Boolean = false;

      // Beyond this distance (tiles) from the player, object updates decimate to
      // 1/4 rate — safely off any view (a window would have to show ~100 tiles
      // across to reach it), so nothing visible is ever decimated.
      private static const OFFSCREEN_UPDATE_SQ:Number = 50 * 50;

      private var updateFrame_:int = 0;

      // Retained Realm maps contain thousands of static walls/decorations. A
      // Dictionary walk still paid for every one of them each frame merely to
      // discover that GameObject.update() was a no-op. Keep the genuinely
      // time-dependent objects dense and update only that list.
      private var updateGameObjects_:Vector.<GameObject>;

      // Dense mirrors of goDict_/boDict_ membership for the per-frame draw
      // pass. A Dictionary for-each walk is the slowest iteration AS3 has, and
      // goDict_ retains every explored object on Realm/dungeon maps -- 12,541
      // at peak in the 2026-07-27 Woodland Labyrinth session -- so the draw
      // loop was hash-walking five figures of entries per frame to reject
      // nearly all of them. Same swap-removal pattern as updateGameObjects_.
      private var drawGameObjects_:Vector.<GameObject>;
      private var drawBasicObjects_:Vector.<BasicObject>;

      /** Dense list for the 100ms interaction proximity check. */
      public const interactiveObjects_:Vector.<GameObject> = new Vector.<GameObject>();
      private const interactiveObjectIndices_:Dictionary = new Dictionary();

      // Visible encounter lanterns only. Decorative lantern GameObjects and the
      // invisible support actors are deliberately excluded, so Follow Lantern
      // cannot latch onto scenery or an unseen controller.
      private static const MV_LANTERN_SYSTEM:int = 0x4FE6;
      private static const MV_TUTORIAL_LANTERN:int = 0x5041;
      private static const MV_EVENT_LANTERN:int = 0x518A;
      private const moonlightLanterns_:Vector.<GameObject> =
            new Vector.<GameObject>();
      private const moonlightLanternIndices_:Dictionary = new Dictionary();

      public function get updateGameObjectCount() : int {
         return this.updateGameObjects_ != null ? this.updateGameObjects_.length : 0;
      }
      
      private var objsToAdd_:Vector.<BasicObject>;
      
      private var idsToRemove_:Vector.<int>;
      
      private var forceSoftwareMap:Dictionary;
      
      private var oryxObjectId:int;
      
      private var graphicsData_:Vector.<GraphicsBitmapFill>;

      private const angleBuckets_:Vector.<Number> = new Vector.<Number>(12,true);
      private const dodgeDebugMatrix_:Vector.<Number> = new Vector.<Number>(16,true);
      private const dodgeDebugPoint_:Point = new Point();
      private const dodgeLaserEndPoint_:Point = new Point();
      private const dodgeDebugVelocity_:Point = new Point();
      private var dodgeDebugOriginWorldX_:Number = 0;
      private var dodgeDebugOriginWorldY_:Number = 0;
      private var dodgeDebugOriginScreenX_:Number = 0;
      private var dodgeDebugOriginScreenY_:Number = 0;
      private const dodgeAoeX_:Vector.<Number> = new Vector.<Number>();
      private const dodgeAoeY_:Vector.<Number> = new Vector.<Number>();
      private const dodgeAoeRadius_:Vector.<Number> = new Vector.<Number>();
      private const dodgeAoeUntil_:Vector.<int> = new Vector.<int>();
      private const dodgeAoeDamage_:Vector.<int> = new Vector.<int>();
      private const dodgeAoeArmorPiercing_:Vector.<Boolean> = new Vector.<Boolean>();
      private const dodgeAoeRepeating_:Vector.<Boolean> = new Vector.<Boolean>();
      private const dodgeAoeEffect_:Vector.<int> = new Vector.<int>();
      private const dodgeAoeEffectDuration_:Vector.<Number> = new Vector.<Number>();
      // HP reconciliation commonly arrives after the short gameplay hazard has
      // expired. Keep a separate bounded packet history for attribution only;
      // these entries are never scored by Auto Dodge.
      private const aoeEvidenceX_:Vector.<Number> = new Vector.<Number>();
      private const aoeEvidenceY_:Vector.<Number> = new Vector.<Number>();
      private const aoeEvidenceRadius_:Vector.<Number> = new Vector.<Number>();
      private const aoeEvidenceTime_:Vector.<int> = new Vector.<int>();
      private const aoeEvidenceDamage_:Vector.<int> = new Vector.<int>();
      private const aoeEvidenceArmorPiercing_:Vector.<Boolean> = new Vector.<Boolean>();
      private const aoeEvidenceEffect_:Vector.<int> = new Vector.<int>();
      private const aoeEvidenceOriginType_:Vector.<int> = new Vector.<int>();
      private var aoeEvidenceHead_:int = 0;
      private const telegraphAoeX_:Vector.<Number> = new Vector.<Number>();
      private const telegraphAoeY_:Vector.<Number> = new Vector.<Number>();
      private const telegraphAoeRadius_:Vector.<Number> = new Vector.<Number>();
      private const telegraphAoeImpact_:Vector.<int> = new Vector.<int>();
      private const telegraphAoeUntil_:Vector.<int> = new Vector.<int>();
      private const telegraphAoeTarget_:Vector.<int> = new Vector.<int>();
      private const telegraphAoeEffect_:Vector.<int> = new Vector.<int>();
      private const telegraphAoeSource_:Vector.<int> = new Vector.<int>();
      private const telegraphAoeCreated_:Vector.<int> = new Vector.<int>();
      private const telegraphAoeDamage_:Vector.<int> = new Vector.<int>();
      private const telegraphAoeArmorPiercing_:Vector.<Boolean> = new Vector.<Boolean>();
      public const activeThrownProjectiles_:Vector.<ThrownProjectile> = new Vector.<ThrownProjectile>();
      public const activeMovingAoeEmitters_:Vector.<MovingAoeEmitter> =
            new Vector.<MovingAoeEmitter>();
      private const movingAoeEmitterIndices_:Dictionary = new Dictionary();
      private const learnedAoeRadius_:Dictionary = new Dictionary();
      private const learnedAoeDamage_:Dictionary = new Dictionary();
      private const learnedAoeArmorPiercing_:Dictionary = new Dictionary();
      private const learnedAoeEffect_:Dictionary = new Dictionary();
      private const learnedAoeEffectDuration_:Dictionary = new Dictionary();
      private const learnedAoeTimingLead_:Dictionary = new Dictionary();
      private const learnedAoeMatches_:Dictionary = new Dictionary();
      private const learnedAoeLastMatch_:Dictionary = new Dictionary();
      // Source-specific profiles are safe to retain across maps. A visual id
      // alone is not unique, but SHOW primitive + visual + authoritative source
      // type + duration bucket is stable in the Exalt captures.
      private static const sharedAoeRadius_:Dictionary = new Dictionary();
      private static const sharedAoeDamage_:Dictionary = new Dictionary();
      private static const sharedAoeArmorPiercing_:Dictionary = new Dictionary();
      private static const sharedAoeEffect_:Dictionary = new Dictionary();
      private static const sharedAoeEffectDuration_:Dictionary = new Dictionary();
      private static const sharedAoeTimingLead_:Dictionary = new Dictionary();
      private static var knownAoeProfilesInitialized_:Boolean = false;
      private static const PERSISTED_AOE_PROFILE_VERSION:int = 1;
      private static const MAX_PERSISTED_AOE_PROFILES:int = 256;
      private static const MAX_PERSISTED_AOE_LIFETIME_BUCKET:int = 20;
      private var aoeLastImpact_:Dictionary = new Dictionary();
      private var aoeRepeatCount_:Dictionary = new Dictionary();
      private var aoeObservationWindowStart_:int = 0;
      private static const AOE_IMPACT_GRACE_MS:int = 90;
      // Beam AOE arrival is normally about 200ms after SHOW_EFFECT. The retained
      // traces also contain a small O3 tail through 717ms, so keep the warning
      // until the authoritative AOE resolves it (or 750ms if that packet never
      // arrives) instead of dropping protection during packet/animation jitter.
      private static const TELEGRAPH_AOE_GRACE_MS:int = 650;
      private static const AOE_REPEAT_MIN_INTERVAL_MS:int = 80;
      private static const AOE_REPEAT_MAX_INTERVAL_MS:int = 1500;
      private static const AOE_REPEAT_MAX_HOLD_MS:int = 750;
      private static const PENDING_AOE_RETENTION_MS:int = 1500;
      private static const O2_DELAYED_LANDING_MS:int = 1000;
      private static const AOE_OBSERVATION_RESET_MS:int = 30000;
      private static const O3_BOMB_ARTIFACT_H:int = 0xB1DC;
      private static const O3_BOMB_ARTIFACT_1:int = 0xB1DD;
      private static const O3_BOMB_ARTIFACT_2:int = 0xB1DE;
      private static const O3_BOMB_ARTIFACT:int = 0xB1E9;
      private static const O2_BOMB_ARTIFACT:int = 0xB01A;
      private static const O2_BOMB_ARTIFACT_2:int = 0xB096;
      private static const O3_ORYX_PORTAL:int = 0xB1DA;
      private static const O3_PORTAL_OFFENSIVE:int = 0x25A5;
      private static const BANESERPENT_IMPACT_TELEGRAPH:int = 0x86AA;
      private static const BONE_TOWER_2:int = 0x871C;
      private static const BONE_TOWER_3:int = 0x871D;
      private static const HUDL_CONSTRUCT_COLOSSUS:int = 0x366C;
      private static const MAMMOTH_CITY_RAT_BOULDER:int = 0x467C;
      private static const SMALL_KOGBOLD_3:int = 0xC11C;
      private static const KSW_CRUSHER:int = 0xC092;
      private static const KSW_STEMWALKER_HARD:int = 0xC458;
      private static const MOVING_AOE_MATCH_DISTANCE_SQ:Number = 2.25;
      private static const TELEGRAPH_AOE_MATCH_DISTANCE_SQ:Number = 0.25;
      private static const AOE_EVIDENCE_RETENTION_MS:int = 2000;
      private static const MAX_AOE_EVIDENCE:int = 512;
      private const pendingAoeType_:Vector.<uint> = new Vector.<uint>();
      private const pendingAoeShowEffectType_:Vector.<int> = new Vector.<int>();
      private const pendingAoeSourceType_:Vector.<int> = new Vector.<int>();
      private const pendingAoeLifetime_:Vector.<int> = new Vector.<int>();
      private const pendingAoeX_:Vector.<Number> = new Vector.<Number>();
      private const pendingAoeY_:Vector.<Number> = new Vector.<Number>();
      private const pendingAoeUntil_:Vector.<int> = new Vector.<int>();
      private var dodgeRenderLogTime_:int = 0;
      private var dodgeRenderFrames_:int = 0;
      private var dodgeRenderTotalMs_:int = 0;
      private var dodgeRenderMaxMs_:int = 0;
      private var dodgeRenderPaths_:int = 0;
      private var dodgeRenderHitboxes_:int = 0;
      private const recentObjectType_:Dictionary = new Dictionary();
      // Projectiles are commonly removed locally before a delayed HP stat is
      // processed. Retain a bounded, primitive-only trace of their final swept
      // segment so HP diagnostics can still attribute a crossing after the
      // pooled Projectile instance has been recycled.
      private const recentProjectileOwner_:Vector.<int> = new Vector.<int>();
      private const recentProjectileBullet_:Vector.<int> = new Vector.<int>();
      private const recentProjectileType_:Vector.<int> = new Vector.<int>();
      private const recentProjectileBulletType_:Vector.<int> = new Vector.<int>();
      private const recentProjectileDamage_:Vector.<int> = new Vector.<int>();
      private const recentProjectileArmorPiercing_:Vector.<Boolean> = new Vector.<Boolean>();
      private const recentProjectileLaser_:Vector.<Boolean> = new Vector.<Boolean>();
      private const recentProjectileRemovedAt_:Vector.<int> = new Vector.<int>();
      private const recentProjectileStartAt_:Vector.<int> = new Vector.<int>();
      private const recentProjectileStartX_:Vector.<Number> = new Vector.<Number>();
      private const recentProjectileStartY_:Vector.<Number> = new Vector.<Number>();
      private const recentProjectileEndX_:Vector.<Number> = new Vector.<Number>();
      private const recentProjectileEndY_:Vector.<Number> = new Vector.<Number>();
      private const recentProjectileStartPoint_:Point = new Point();
      private const recentProjectileEndPoint_:Point = new Point();
      private var recentProjectileHead_:int = 0;
      private static const RECENT_PROJECTILE_TRACE_MS:int = 1000;
      private static const MAX_RECENT_PROJECTILE_TRACES:int = 256;
      private static const RECENT_PROJECTILE_COMPACT_HEAD:int = 128;
      
      public function Map(gameSprite:AGameSprite) {
         initializeKnownAoeProfiles();
         objsToAdd_ = new Vector.<BasicObject>();
         idsToRemove_ = new Vector.<int>();
         updateGameObjects_ = new Vector.<GameObject>();
         drawGameObjects_ = new Vector.<GameObject>();
         drawBasicObjects_ = new Vector.<BasicObject>();
         forceSoftwareMap = new Dictionary();
         graphicsData_ = new Vector.<GraphicsBitmapFill>();
         visible_ = [];
         visibleUnder_ = [];
         visibleSquares_ = new Vector.<Square>();
         topSquares_ = new Vector.<Square>();
         super();
         gs_ = gameSprite;
         mapOverlay_ = new MapOverlay();
         partyOverlay_ = new PartyOverlay(this);
         party_ = new Party(this);
         quest_ = new Quest(this);
         StaticInjectorContext.getInjector().getInstance(GameModel).gameObjects = goDict_;
      }
      
      /** Legacy (non-predictive) flee direction: 12 thirty-degree sectors, each
       * accumulating the distance of the threats inside it; the emptiest sector
       * wins and its center angle is returned. The decompiled original folded
       * every threat into the first quadrant with abs() and could only ever
       * write three of its buckets, so it fled at a near-constant 45 degrees
       * regardless of where the danger actually was. */
      override public function enumGOAngles() : Number {
         var i:int = 0;
         var bucket:int = 0;
         var angle:Number = 0;
         var enemy:* = null;
         var projectile:* = null;
         var playerX:Number = player_.x_;
         var playerY:Number = player_.y_;
         var buckets:Vector.<Number> = this.angleBuckets_;
         for(i = 0; i < 12; i++) {
            buckets[i] = 0;
         }
         var enemyCount:int = this.vulnEnemyDict_.length;
         for(i = 0; i < enemyCount; i++) {
            enemy = this.vulnEnemyDict_[i];
            angle = Math.atan2(enemy.y_ - playerY,enemy.x_ - playerX);
            if(angle < 0) {
               angle += 6.28318530717959;
            }
            bucket = int(angle / 0.523598775598299);
            if(bucket > 11) {
               bucket = 11;
            }
            buckets[bucket] += PointUtil.distanceXY(enemy.x_,enemy.y_,playerX,playerY);
         }
         var projectileCount:int = this.hostileProjectiles_.length;
         for(i = 0; i < projectileCount; i++) {
            projectile = this.hostileProjectiles_[i];
            angle = Math.atan2(projectile.y_ - playerY,projectile.x_ - playerX);
            if(angle < 0) {
               angle += 6.28318530717959;
            }
            bucket = int(angle / 0.523598775598299);
            if(bucket > 11) {
               bucket = 11;
            }
            buckets[bucket] += PointUtil.distanceXY(projectile.x_,projectile.y_,playerX,playerY);
         }
         var minSum:Number = Number.POSITIVE_INFINITY;
         var bestBucket:int = 0;
         for(i = 0; i < 12; i++) {
            if(buckets[i] < minSum) {
               minSum = buckets[i];
               bestBucket = i;
            }
         }
         return (bestBucket * 30 + 15) * 3.14159265358979 / 180;
      }
      
      override public function calcVulnerables() : void {
         var projectile:* = null;
         var gameObject:GameObject = null;
         this.vulnEnemyDict_.length = 0;
         this.questBossEmitters_.length = 0;
         this.vulnPlayerDict_.length = 0;
         this.visProjDict.length = 0;
         this.playerLength = 0;
         for each(var basicObj:* in boDict_) {
            projectile = basicObj as Projectile;
            if(projectile && projectile.damagesPlayers_) {
               this.visProjDict.push(projectile);
            }
         }
         for each(gameObject in goDict_) {
            if(gameObject.props_.isEnemy_) {
               // Keep boss emitters independently of vulnerability. Bosses such
               // as Gemsbok can shoot during invulnerable phases, while the
               // vulnerable list intentionally excludes them from auto-aim.
               if(!gameObject.dead_ && gameObject.props_.isQuest_ &&
                     gameObject.props_.projectiles_ != null) {
                  for(var emitterProjectileType:* in
                        gameObject.props_.projectiles_) {
                     this.questBossEmitters_.push(gameObject);
                     break;
                  }
               }
               if(!gameObject.dead_ && !gameObject.isInvincible) {
                        if((gameObject.condition_[0] & 11534336) == 0) {
                           this.vulnEnemyDict_.push(gameObject);
                        }
               }
            } else if(gameObject.props_.isPlayer_) {
               this.playerLength++;
               if(!gameObject.isInvincible && !gameObject.isStasis && !gameObject.dead_) {
                  this.vulnPlayerDict_.push(gameObject);
               }
            }
         }
      }
      
      override public function setProps(width:int, height:int, mapName:String, background:int, allowPlayerTeleport:Boolean, showDisplays:Boolean, maxPlayerCount:int = 0) : void {
         mapWidth = width;
         mapHeight = height;
         name_ = mapName;
         back_ = background;
         allowPlayerTeleport_ = allowPlayerTeleport;
         showDisplays_ = showDisplays;
         maxPlayers = maxPlayerCount;
         this.forceSoftwareRenderCheck(name_);
      }
      
      override public function initialize() : void {
         squares.length = mapWidth * mapHeight;
         addChild(map_);
         addChild(mapOverlay_);
         addChild(partyOverlay_);
         isPetYard = name_.substr(0,8) == "Pet Yard";
         isQuestRoom = name_.indexOf("Quest") != -1;
      }
      
      override public function dispose() : void {
         var gameObject:* = null;
         var basicObj:* = null;
         if(goDict_ == null && boDict_ == null) {
            this.inUpdate_ = false;
            return;
         }
         // An object update can synchronously trigger a reconnect/autonexus and
         // dispose this map before Map.update() has returned. Mark the map as
         // no longer updating before nulling its mutation queues so add/remove
         // calls made by the unwinding object update cannot push into null.
         this.inUpdate_ = false;
         gs_ = null;
         background_ = null;
         map_ = null;
         mapOverlay_ = null;
         partyOverlay_ = null;
         squares.length = 0;
         squares = null;
         for each(gameObject in goDict_) {
            gameObject.dispose();
         }
         goDict_ = null;
         this.updateGameObjects_.length = 0;
         this.updateGameObjects_ = null;
         if(this.drawGameObjects_ != null) {
            this.drawGameObjects_.length = 0;
            this.drawGameObjects_ = null;
         }
         if(this.drawBasicObjects_ != null) {
            this.drawBasicObjects_.length = 0;
            this.drawBasicObjects_ = null;
         }
         this.interactiveObjects_.length = 0;
         this.moonlightLanterns_.length = 0;
         this.questBossEmitters_.length = 0;
         for each(basicObj in boDict_) {
            basicObj.dispose();
         }
         boDict_ = null;
         hostileProjectiles_.length = 0;
         hostileProjectiles_ = null;
         this.activeThrownProjectiles_.length = 0;
         this.dodgeAoeX_.length = 0;
         this.dodgeAoeY_.length = 0;
         this.dodgeAoeRadius_.length = 0;
         this.dodgeAoeUntil_.length = 0;
         this.dodgeAoeDamage_.length = 0;
         this.dodgeAoeArmorPiercing_.length = 0;
         this.dodgeAoeRepeating_.length = 0;
         this.dodgeAoeEffect_.length = 0;
         this.dodgeAoeEffectDuration_.length = 0;
         this.telegraphAoeX_.length = 0;
         this.telegraphAoeY_.length = 0;
         this.telegraphAoeRadius_.length = 0;
         this.telegraphAoeImpact_.length = 0;
         this.telegraphAoeUntil_.length = 0;
         this.telegraphAoeTarget_.length = 0;
         this.telegraphAoeEffect_.length = 0;
         this.telegraphAoeSource_.length = 0;
         this.telegraphAoeCreated_.length = 0;
         this.telegraphAoeDamage_.length = 0;
         this.telegraphAoeArmorPiercing_.length = 0;
         this.activeMovingAoeEmitters_.length = 0;
         this.aoeEvidenceX_.length = 0;
         this.aoeEvidenceY_.length = 0;
         this.aoeEvidenceRadius_.length = 0;
         this.aoeEvidenceTime_.length = 0;
         this.aoeEvidenceDamage_.length = 0;
         this.aoeEvidenceArmorPiercing_.length = 0;
         this.aoeEvidenceEffect_.length = 0;
         this.aoeEvidenceOriginType_.length = 0;
         this.aoeEvidenceHead_ = 0;
         this.pendingAoeType_.length = 0;
         this.pendingAoeShowEffectType_.length = 0;
         this.pendingAoeSourceType_.length = 0;
         this.pendingAoeLifetime_.length = 0;
         this.pendingAoeX_.length = 0;
         this.pendingAoeY_.length = 0;
         this.pendingAoeUntil_.length = 0;
         this.clearDictionary(this.interactiveObjectIndices_);
         this.clearDictionary(this.moonlightLanternIndices_);
         this.clearDictionary(this.movingAoeEmitterIndices_);
         this.clearDictionary(this.learnedAoeRadius_);
         this.clearDictionary(this.learnedAoeDamage_);
         this.clearDictionary(this.learnedAoeArmorPiercing_);
         this.clearDictionary(this.learnedAoeEffect_);
         this.clearDictionary(this.learnedAoeEffectDuration_);
         this.clearDictionary(this.learnedAoeTimingLead_);
         this.clearDictionary(this.learnedAoeMatches_);
         this.clearDictionary(this.learnedAoeLastMatch_);
         this.clearDictionary(this.recentObjectType_);
         this.aoeLastImpact_ = new Dictionary();
         this.aoeRepeatCount_ = new Dictionary();
         this.aoeObservationWindowStart_ = 0;
         this.clearRecentProjectileTraces();
         if(this.visible_ != null) {
            this.visible_.length = 0;
            this.visible_ = null;
         }
         if(this.visibleUnder_ != null) {
            this.visibleUnder_.length = 0;
            this.visibleUnder_ = null;
         }
         if(this.visibleSquares_ != null) {
            this.visibleSquares_.length = 0;
            this.visibleSquares_ = null;
         }
         if(this.topSquares_ != null) {
            this.topSquares_.length = 0;
            this.topSquares_ = null;
         }
         if(this.graphicsData_ != null) {
            this.graphicsData_.length = 0;
            this.graphicsData_ = null;
         }
         while(numChildren > 0) {
            removeChildAt(numChildren - 1);
         }
         merchLookup_ = null;
         player_ = null;
         party_ = null;
         quest_ = null;
         this.objsToAdd_ = null;
         this.idsToRemove_ = null;
         TextureFactory.disposeTextures();
         GraphicsFillExtra.dispose();
         Program3DFactory.getInstance().dispose();
      }

      private function clearDictionary(dictionary:Dictionary) : void {
         if(dictionary == null) {
            return;
         }
         for(var key:* in dictionary) {
            delete dictionary[key];
         }
      }
      
      override public function update(time:int, dt:int) : void {
         var obj:* = null;
         // GameSprite can receive one final ENTER_FRAME for the old map while a
         // reconnect is replacing it. dispose() nulls both dictionaries and the
         // mutation queues; a disposed map has nothing left to update.
         if(goDict_ == null || boDict_ == null || this.updateGameObjects_ == null ||
               this.objsToAdd_ == null || this.idsToRemove_ == null) {
            this.inUpdate_ = false;
            return;
         }
         this.refreshMovingAoeEmitters(time);
         // Coalesced vulnerable-list refresh (was rebuilt on BOTH onUpdate and
         // onNewTick — two full goDict_/boDict_ scans every server tick). The
         // packet handlers now just mark the map dirty; rebuild once here, before
         // the object loops, so projectile collision (boDict_) and player
         // auto-aim (goDict_) read a current list this frame. Skipped on frames
         // with no object/condition changes.
         if(this.vulnDirty_) {
            this.vulnDirty_ = false;
            this.calcVulnerables();
         }
         this.inUpdate_ = true;
         // No idsToRemove_.indexOf dedup: internalRemoveObj is idempotent (it
         // no-ops on an id already gone), so a duplicate queued id is harmless —
         // far cheaper than scanning idsToRemove_ O(n) per object every frame.
         //
         // Off-screen update decimation: objects more than OFFSCREEN_UPDATE_DIST
         // tiles from the player can't be on any view, so run their client-side
         // interpolation/animation at 1/4 rate (spread by objectId). The distance
         // is re-checked every frame, so anything approaching the view resumes
         // full updates long before it becomes visible; the player and projectiles
         // (boDict_ below) always update every frame.
         var _plr:GameObject = this.player_;
         var _px:Number = _plr != null ? _plr.x_ : 0;
         var _py:Number = _plr != null ? _plr.y_ : 0;
         var _fc:int = this.updateFrame_++;
         var _dx:Number = NaN;
         var _dy:Number = NaN;
         var updateObjectCount:int = this.updateGameObjects_.length;
         for(var updateObjectIndex:int = 0;
               updateObjectIndex < updateObjectCount; updateObjectIndex++) {
            if(this.updateGameObjects_ == null || goDict_ == null ||
                  boDict_ == null || this.idsToRemove_ == null) {
               this.inUpdate_ = false;
               return;
            }
            obj = this.updateGameObjects_[updateObjectIndex];
            if(obj && this.idsToRemove_ != null) {
               if(_plr != null && obj != _plr) {
                  _dx = obj.x_ - _px;
                  _dy = obj.y_ - _py;
                  if(_dx * _dx + _dy * _dy > OFFSCREEN_UPDATE_SQ) {
                     if(((_fc + obj.objectId_) & 3) != 0) {
                        continue;
                     }
                  }
               }
               var keepGameObject:Boolean = obj.update(time,dt);
               if(this.updateGameObjects_ == null || goDict_ == null ||
                     boDict_ == null || this.idsToRemove_ == null) {
                  this.inUpdate_ = false;
                  return;
               }
               if(!keepGameObject) {
                  this.idsToRemove_.push(obj.objectId_);
               }
            }
         }
         if(boDict_ == null || this.idsToRemove_ == null) {
            this.inUpdate_ = false;
            return;
         }
         // Dense-list walk; membership == boDict_. Additions during the loop
         // are queued (inUpdate_), removals go through idsToRemove_ below, so
         // the snapshot count is stable for the duration of the loop.
         if(this.drawBasicObjects_ == null) {
            this.inUpdate_ = false;
            return;
         }
         var updateBasicCount:int = this.drawBasicObjects_.length;
         for(var updateBasicIndex:int = 0; updateBasicIndex < updateBasicCount; updateBasicIndex++) {
            obj = this.drawBasicObjects_[updateBasicIndex];
            if(obj && this.idsToRemove_ != null) {
               var keepBasicObject:Boolean = obj.update(time,dt);
               if(boDict_ == null || this.idsToRemove_ == null ||
                     this.drawBasicObjects_ == null) {
                  this.inUpdate_ = false;
                  return;
               }
               if(!keepBasicObject) {
                  this.idsToRemove_.push(obj.objectId_);
               }
            }
         }
         this.inUpdate_ = false;
         // Null-check BEFORE dereferencing .length: dispose() nulls these queues,
         // and a frame can tick during a map transition (the old code checked for
         // null only AFTER reading .length, so it threw #1009 at Map/update() —
         // the GameSprite.onEnterFrame crash in the session logs).
         if(this.objsToAdd_ != null) {
            var addCount:int = this.objsToAdd_.length;
            for(var addIndex:int = 0; addIndex < addCount; addIndex++) {
               this.internalAddObj(this.objsToAdd_[addIndex]);
            }
            this.objsToAdd_.length = 0;
         }
         if(this.idsToRemove_ != null) {
            var removeCount:int = this.idsToRemove_.length;
            for(var removeIndex:int = 0; removeIndex < removeCount; removeIndex++) {
               this.internalRemoveObj(this.idsToRemove_[removeIndex]);
            }
            this.idsToRemove_.length = 0;
         }
         party_ && party_.update(time, dt);
      }
      
      override public function pSTopW(screenX:Number, screenY:Number) : Point {
         var square:* = null;
         for each(square in this.visibleSquares_) {
            if(square.faces_.length != 0 && square.faces_[0].face.contains(screenX,screenY)) {
               return new Point(square.centerX_,square.centerY_);
            }
         }
         return null;
      }
      
      override public function setGroundTile(tileX:int, tileY:int, newTileType:uint) : void {
         var neighborY:int = 0;
         var index:int = 0;
         var neighbor:Square = null;
         var centerSquare:Square = this.getSquare(tileX,tileY);
         if(centerSquare.tileType == newTileType) {
            return;
         }
         var oldTileType:uint = centerSquare.tileType;
         centerSquare.setTileType(newTileType);
         // Ground<->wave swaps within a Katalund texture pair do not alter any
         // neighbour blend. The center has already invalidated its own faces;
         // rebuilding the surrounding eight squares only creates cache churn.
         if(TileRedrawer.sameTransientBlendGroup(oldTileType,newTileType)) {
            return;
         }
         var maxX:int = tileX < mapWidth - 1?tileX + 1:tileX;
         var maxY:int = tileY < mapHeight - 1?tileY + 1:tileY;
         var neighborX:int = tileX > 0?tileX - 1:tileX;
         while(neighborX <= maxX) {
            neighborY = tileY > 0?tileY - 1:tileY;
            while(neighborY <= maxY) {
               index = neighborX + neighborY * mapWidth;
               neighbor = squares[index];
               if(neighbor != null && (neighbor.props_ && neighbor.props_.hasEdge_ || neighbor.tileType != newTileType)) {
                  neighbor.invalidateFaces();
               }
               neighborY++;
            }
            neighborX++;
         }
      }
      
      override public function addObj(obj:BasicObject, x:Number, y:Number) : void {
         if(obj == null || goDict_ == null || boDict_ == null) {
            return;
         }
         obj.x_ = x;
         obj.y_ = y;
         if(obj is ParticleEffect) {
            (obj as ParticleEffect).reducedDrawEnabled = !Parameters.data.particleEffect;
         }
         if(this.inUpdate_) {
            if(this.objsToAdd_ != null) {
               this.objsToAdd_.push(obj);
            }
         } else {
            this.internalAddObj(obj);
         }
      }

      /** Resolve SHOW_EFFECT throws that omit targetObjectId. Their pos2 is the
       * launch point; a tight nearest-enemy lookup recovers the source type so
       * the visual can use a source-specific, previously verified AoE profile. */
      public function resolveHostileSourceType(x:Number, y:Number,
                                               maxDistance:Number = 1.5) : int {
         if(goDict_ == null || !isFinite(x) || !isFinite(y)) {
            return -1;
         }
         var bestType:int = -1;
         var bestDistanceSq:Number = maxDistance * maxDistance;
         for each(var object:GameObject in goDict_) {
            if(object == null || object.dead_ || object.props_ == null ||
                  !object.props_.isEnemy_) {
               continue;
            }
            var dx:Number = object.x_ - x;
            var dy:Number = object.y_ - y;
            var distanceSq:Number = dx * dx + dy * dy;
            if(distanceSq <= bestDistanceSq) {
               bestDistanceSq = distanceSq;
               bestType = object.objectType_;
            }
         }
         return bestType;
      }

      /** Resolve a static hostile source from the map square at a packet's
       * launch point. Unlike resolveHostileSourceType(), this is a bounded
       * square lookup rather than an O(n) scan of every streamed object, so it
       * is safe to use on the high-frequency ENEMYSHOOT path. */
      public function resolveStaticHostileSourceType(x:Number, y:Number,
                                                      maxDistance:Number = 0.85) : int {
         if(squares == null || !isFinite(x) || !isFinite(y)) {
            return -1;
         }
         var minX:int = Math.max(0,int(Math.floor(x - maxDistance)));
         var maxX:int = Math.min(mapWidth - 1,int(Math.floor(x + maxDistance)));
         var minY:int = Math.max(0,int(Math.floor(y - maxDistance)));
         var maxY:int = Math.min(mapHeight - 1,int(Math.floor(y + maxDistance)));
         var bestType:int = -1;
         var bestDistanceSq:Number = maxDistance * maxDistance;
         for(var tileY:int = minY; tileY <= maxY; tileY++) {
            for(var tileX:int = minX; tileX <= maxX; tileX++) {
               var square:Square = this.lookupSquare(tileX,tileY);
               var object:GameObject = square != null ? square.obj_ : null;
               if(object == null || object.dead_ || object.props_ == null ||
                     !object.props_.isEnemy_) {
                  continue;
               }
               var dx:Number = object.x_ - x;
               var dy:Number = object.y_ - y;
               var distanceSq:Number = dx * dx + dy * dy;
               if(distanceSq <= bestDistanceSq) {
                  bestDistanceSq = distanceSq;
                  bestType = object.objectType_;
               }
            }
         }
         return bestType;
      }

      override public function removeObj(objectId:int) : void {
         if(goDict_ == null || boDict_ == null) {
            return;
         }
         if(this.inUpdate_) {
            if(this.idsToRemove_ != null) {
               this.idsToRemove_.push(objectId);
            }
         } else {
            this.internalRemoveObj(objectId);
         }
      }
      
      override public function draw(camera:Camera, time:int) : void {
         // Renderer dispatch or a reconnect can dispose the old map between
         // ENTER_FRAME scheduling and this call. A disposed map owns no safe
         // render targets.
         if(camera == null || map_ == null || this.mapOverlay_ == null ||
               this.partyOverlay_ == null || this.visible_ == null ||
               this.graphicsData_ == null) {
            return;
         }
         var tileDx:int = 0;
         var clipRect:Rectangle = camera.clipRect_;
         // Place the 2D overlay (status text, names, HP bars, auto-dodge shapes)
         // exactly on top of the Stage3D world, which now FILLS THE WHOLE WINDOW.
         // The overlay draws in the fixed 50-units-per-world-unit posS_ space with
         // the player at local (0,0); Main scales the whole UI tree by gameScale
         // (uniform) and letterbox-centers it. So:
         //   (a) scale the overlay UNIFORMLY by mscale/gameScale to match the
         //       world's on-screen px-per-unit (the old anisotropic 800/w vs
         //       600/h factors squeezed the overlay AND skewed mouse-aim, since
         //       the shot angle is atan2 about this origin);
         //   (b) put local (0,0) at the player's ACTUAL projected screen position.
         // The player's screen NDC follows Renderer.setTranslationToGame
         // (tX = -200*w/800  ->  ndcX = -mscale/4) and Camera.correctViewingArea
         // (clipRect -> ndcY); solving for the letterboxed logical position gives
         // the closed forms below — verified to 1e-13 px against the renderer
         // across aspect ratios, center/off-center, and mscale. MUST stay in sync
         // with those two functions if their translation constants change.
         var _ms:Number = Parameters.data.mscale;
         var _gsc:Number = Main.gameScale();
         var _bw:Number = Main.gameBufferWidth();
         var _bh:Number = Main.gameBufferHeight();
         var _ndcX:Number = -_ms / 4;
         var _ndcY:Number = (clipRect.y + clipRect.height / 2) * 2 * _ms / _bh;
         scaleX = scaleY = _ms / _gsc;
         x = 400 + _ndcX * _bw / (2 * _gsc);
         y = 300 - _ndcY * _bh / (2 * _gsc);
         // NOTE: the stage3D viewport offset (stage3Ds[0].x/y) is owned by
         // Renderer.resizeStage3DBackBuffer (centered letterbox). The old code
         // stomped it every frame with 400 - windowWidth/2, which shoves the
         // world off-center on any window wider than 800 — the "camera offset
         // from center when zoomed out" bug.
         var filterIndex:uint = 0;
         var render3D:Render3D = null;
         var square:Square = null;
         var gameObject:GameObject = null;
         var basicObj:BasicObject = null;
         var tileDy:int = 0;
         this.visible_.length = 0;
         this.visibleUnder_.length = 0;
         this.visibleSquares_.length = 0;
         this.topSquares_.length = 0;
         this.graphicsData_.length = 0;
         // Tile draw radius: grow with what the camera can actually SHOW.
         // maxDist_ is the camera's half-diagonal in tiles for the current
         // buffer size, so on a big window we draw enough (cached) tiles to
         // fill the view instead of a fixed 16-tile disc surrounded by black.
         // renderDistance acts as the user-set floor; cap keeps the per-frame
         // square loop bounded on very large displays.
         var _needR:int = int(Math.ceil(camera.maxDist_)) + 1;
         var tileRadius:int = Math.min(40, Math.max(int(Parameters.data.renderDistance), _needR)) - 1;
         // Low CPU: clamp the tile radius to a small fixed value so a large window
         // no longer drags in thousands of tiles + their objects. This is the main
         // Low-CPU FPS lever (objects piggyback on square.lastVisible_, so a
         // tighter tile radius culls their draws + updates too).
         if(Parameters.lowCPUMode) {
            tileRadius = Math.min(tileRadius, int(Parameters.data.lowCPUDrawDistance));
         }
         if(this.player_ == null) {
            // A frame can render after the player is removed (autonexus/disconnect
            // teardown) — caught #1009 here at the end of the 2026-07-09 manual
            // session. Nothing to center the tile disc on; skip the frame.
            return;
         }
         // Frustum-rect tile culling. wToS_ is affine and its screen x/y depend
         // only on world x/y (the camera right/up vectors have z=0), so invert its
         // 2x2 to map the clip rectangle's corners back to world tiles and iterate
         // only that bounding box. A large window then walks the tiles it can
         // actually show instead of a radius-tileRadius disc whose off-screen corners
         // were pure waste (the resize-lag). Rotating the camera grows the box
         // toward the old disc, so the win shrinks but never gaps; everything is
         // clamped to +/-tileRadius so coverage is never larger than before.
         var _fMinX:int = -tileRadius;
         var _fMaxX:int = tileRadius;
         var _fMinY:int = -tileRadius;
         var _fMaxY:int = tileRadius;
         var _fr:Vector.<Number> = camera.wToS_.rawData;
         var _fdet:Number = _fr[0] * _fr[5] - _fr[4] * _fr[1];
         if(clipRect != null && (_fdet > 0.000001 || _fdet < -0.000001)) {
            var _fia:Number = _fr[5] / _fdet;
            var _fib:Number = -_fr[4] / _fdet;
            var _fic:Number = -_fr[1] / _fdet;
            var _fid:Number = _fr[0] / _fdet;
            var _ftx:Number = _fr[12];
            var _fty:Number = _fr[13];
            var _fWMinX:Number = 1000000;
            var _fWMaxX:Number = -1000000;
            var _fWMinY:Number = 1000000;
            var _fWMaxY:Number = -1000000;
            var _fk:int = 0;
            var _fsx:Number = NaN;
            var _fsy:Number = NaN;
            var _fwx:Number = NaN;
            var _fwy:Number = NaN;
            while(_fk < 4) {
               _fsx = ((_fk == 0 || _fk == 3) ? clipRect.left : clipRect.right) - _ftx;
               _fsy = ((_fk < 2) ? clipRect.top : clipRect.bottom) - _fty;
               _fwx = _fia * _fsx + _fib * _fsy;
               _fwy = _fic * _fsx + _fid * _fsy;
               if(_fwx < _fWMinX) { _fWMinX = _fwx; }
               if(_fwx > _fWMaxX) { _fWMaxX = _fwx; }
               if(_fwy < _fWMinY) { _fWMinY = _fwy; }
               if(_fwy > _fWMaxY) { _fWMaxY = _fwy; }
               _fk++;
            }
            // +/-2 tile margin absorbs partial edge tiles and camera jitter.
            _fMinX = Math.max(-tileRadius, int(Math.floor(_fWMinX - this.player_.x_)) - 2);
            _fMaxX = Math.min(tileRadius, int(Math.ceil(_fWMaxX - this.player_.x_)) + 2);
            _fMinY = Math.max(-tileRadius, int(Math.floor(_fWMinY - this.player_.y_)) - 2);
            _fMaxY = Math.min(tileRadius, int(Math.ceil(_fWMaxY - this.player_.y_)) + 2);
         }
         tileDx = _fMinX;
         while(tileDx <= _fMaxX) {
            tileDy = _fMinY;
            while(tileDy <= _fMaxY) {
               square = this.lookupSquare(tileDx + this.player_.x_,tileDy + this.player_.y_);
               if(square != null) {
                  square.lastVisible_ = time;
                  square.draw(this.graphicsData_,camera,time);
                  this.visibleSquares_.push(square);
                  if(square.topFace_ != null) {
                     this.topSquares_.push(square);
                  }
               }
               tileDy++;
            }
            tileDx++;
         }
         // Fast reject before touching each object's Square and render
         // properties. The server retains explored Realm scenery in goDict_,
         // but only squares inside this exact tile window can have lastVisible_
         // set to the current frame.
         var objectMinX:Number = this.player_.x_ + _fMinX - 1;
         var objectMaxX:Number = this.player_.x_ + _fMaxX + 1;
         var objectMinY:Number = this.player_.y_ + _fMinY - 1;
         var objectMaxY:Number = this.player_.y_ + _fMaxY + 1;
         // Dense-list walk (see drawGameObjects_ declaration). Also skip the
         // sort-key transform entirely on frames where no sort will run
         // (Low CPU / disableSorting): computeSortVal is two Vector rebuilds
         // plus a Matrix3D.transformVectors per object per frame, and its
         // output is read only by sortOn.
         var needSort:Boolean = !Parameters.data.disableSorting && !Parameters.lowCPUMode;
         if(this.drawGameObjects_ == null || this.drawBasicObjects_ == null) {
            return;
         }
         var drawGoCount:int = this.drawGameObjects_.length;
         for(var drawGoIndex:int = 0; drawGoIndex < drawGoCount; drawGoIndex++) {
            gameObject = this.drawGameObjects_[drawGoIndex];
            gameObject.drawn_ = false;
            if(gameObject.dead_ && gameObject.hp_ > 0) {
               gameObject.dead_ = false;
            }
            if(gameObject.x_ < objectMinX || gameObject.x_ > objectMaxX ||
                  gameObject.y_ < objectMinY || gameObject.y_ > objectMaxY) {
               continue;
            }
            if(!gameObject.dead_) {
               square = gameObject.square;
               if(!(square == null || square.lastVisible_ != time)) {
                  gameObject.drawn_ = true;
                  if(needSort) {
                     gameObject.computeSortVal(camera);
                     if(gameObject.objectId_ == player_.objectId_) {
                        gameObject.sortVal_ = 9999;
                     }
                  }
                  if(gameObject.props_.drawUnder_) {
                     if(gameObject.props_.drawOnGround_) {
                        gameObject.draw(this.graphicsData_,camera,time);
                     } else {
                        this.visibleUnder_.push(gameObject);
                     }
                  } else {
                     this.visible_.push(gameObject);
                  }
               }
            }
         }
         var drawBoCount:int = this.drawBasicObjects_.length;
         for(var drawBoIndex:int = 0; drawBoIndex < drawBoCount; drawBoIndex++) {
            basicObj = this.drawBasicObjects_[drawBoIndex];
            basicObj.drawn_ = false;
            square = basicObj.square;
            if(!(square == null || square.lastVisible_ != time)) {
               basicObj.drawn_ = true;
               if(needSort) {
                  basicObj.computeSortVal(camera);
               }
               this.visible_.push(basicObj);
            }
         }
         if(this.visibleUnder_.length > 0) {
            if(needSort) {
               this.visibleUnder_.sortOn(VISIBLE_SORT_FIELDS,VISIBLE_SORT_PARAMS);
            }
            var underCount:int = this.visibleUnder_.length;
            for(var underIndex:int = 0; underIndex < underCount; underIndex++) {
               this.visibleUnder_[underIndex].draw(this.graphicsData_,camera,time);
            }
         }
         // A depth sort only means anything with 2+ objects; skip the native
         // call for the common sparse frame (matches the visibleUnder_ guard).
         if(this.visible_.length > 1 && needSort) {
            this.visible_.sortOn(VISIBLE_SORT_FIELDS,VISIBLE_SORT_PARAMS);
         }
         var visibleCount:int = this.visible_.length;
         for(var visibleIndex:int = 0; visibleIndex < visibleCount; visibleIndex++) {
            this.visible_[visibleIndex].draw(this.graphicsData_,camera,time);
         }
         if(this.topSquares_.length > 0 && !Parameters.lowCPUMode) {
            var topCount:int = this.topSquares_.length;
            for(var topIndex:int = 0; topIndex < topCount; topIndex++) {
               this.topSquares_[topIndex].drawTop(this.graphicsData_,camera,time);
            }
         }
         if(Renderer.inGame) {
            filterIndex = this.getFilterIndex();
            render3D = StaticInjectorContext.getInjector().getInstance(Render3D);
            render3D.dispatch(this.graphicsData_,filterIndex);
            if(time % 149 == 0) {
               GraphicsFillExtra.manageSize();
            }
         }
         // Stage3D dispatch can synchronously trigger a reconnect/autonexus.
         // Re-check the overlays because dispose() deliberately nulls them.
         if(this.mapOverlay_ == null || this.partyOverlay_ == null) {
            return;
         }
         this.drawAutoDodgeDebug(camera,time);
         if(this.mapOverlay_ != null && this.partyOverlay_ != null) {
            this.mapOverlay_.draw(camera,time);
            this.partyOverlay_.draw(camera,time);
         }
      }

      public function recordDebugAoe(x:Number, y:Number, radius:Number, time:int,
                                     damage:int = 0,
                                     armorPiercing:Boolean = false,
                                     effect:int = 0,
                                     effectDuration:Number = 0,
                                     originType:int = -1,
                                     color:int = -1) : void {
         // Resolve pre-impact models before retaining this authoritative impact.
         // A beam telegraph is finished at this instant, while a moving bomb
         // artifact uses the packet to establish its next pulse cadence.
         this.resolveTelegraphedAoe(x,y,time,originType);
         var movingEmitter:MovingAoeEmitter = this.recordMovingAoeEmitterImpact(
               x,y,radius,time,damage,armorPiercing,effect,effectDuration,
               originType);
         this.learnAoeRadius(x,y,radius,time,damage,armorPiercing,effect,
               effectDuration,originType);
         if(this.aoeObservationWindowStart_ == 0 ||
               time - this.aoeObservationWindowStart_ > AOE_OBSERVATION_RESET_MS) {
            this.aoeLastImpact_ = new Dictionary();
            this.aoeRepeatCount_ = new Dictionary();
            this.aoeObservationWindowStart_ = time;
         }
         // Only repeat the same attack. O3 emits several unrelated bomb and
         // beam families onto the same quarter-tile; the old geometry-only key
         // merged them and continuously refreshed a danger circle after the
         // original impact had ended.
         var observationKey:String = int(Math.floor(x * 4 + 0.5)) + ":" +
               int(Math.floor(y * 4 + 0.5)) + ":" +
               int(Math.floor(radius * 10 + 0.5)) + ":" + originType + ":" +
               damage + ":" + effect + ":" + color;
         var previousTime:* = this.aoeLastImpact_[observationKey];
         var repeatCount:int = 1;
         var interval:int = 0;
         if(previousTime !== undefined) {
            interval = time - int(previousTime);
            repeatCount = int(this.aoeRepeatCount_[observationKey]);
            if(interval >= AOE_REPEAT_MIN_INTERVAL_MS &&
                  interval <= AOE_REPEAT_MAX_INTERVAL_MS) {
               repeatCount++;
            } else if(interval > AOE_REPEAT_MAX_INTERVAL_MS) {
               repeatCount = 1;
            }
         }
         if(previousTime === undefined || interval >= AOE_REPEAT_MIN_INTERVAL_MS) {
            this.aoeLastImpact_[observationKey] = time;
         }
         this.aoeRepeatCount_[observationKey] = repeatCount;
         var repeating:Boolean = repeatCount >= 2;
         var knownRepeatInterval:int = knownAoeRepeatInterval(originType,effect,
               damage);
         if(knownRepeatInterval > 0) {
            repeating = true;
            if(interval < AOE_REPEAT_MIN_INTERVAL_MS) {
               interval = knownRepeatInterval;
            }
         }
         var holdMs:int = AOE_IMPACT_GRACE_MS;
         if(repeating && interval >= AOE_REPEAT_MIN_INTERVAL_MS) {
            holdMs = Math.min(AOE_REPEAT_MAX_HOLD_MS,
                  Math.max(AOE_IMPACT_GRACE_MS,interval + AOE_IMPACT_GRACE_MS));
         }
         if(Parameters.data.autoDodgeDebug) {
            var playerDistance:Number = this.player_ == null ? -1 :
                  PointUtil.distanceXY(x,y,this.player_.x_,this.player_.y_);
            DebugLog.event("auto_dodge_aoe_packet",{
               "x":x,"y":y,"radius":radius,"playerDistance":playerDistance,
                "damage":damage,"armorPiercing":armorPiercing,
                "effect":effect,"effectDuration":effectDuration,
                "originType":originType,"color":color,
                "repeating":repeating,"repeatCount":repeatCount,
                "repeatIntervalMs":interval,"holdMs":holdMs,
                "activeThrown":this.activeThrownProjectiles_.length,
                "movingEmitterId":movingEmitter != null ?
                      movingEmitter.objectId : -1,
                "movingEmitterIntervalMs":movingEmitter != null ?
                      movingEmitter.interval_ : -1,
                "map":name_
             });
         }
         this.recordAoeEvidence(x,y,radius,time,damage,armorPiercing,effect,
               originType);
         this.pruneRecentAoe(time);
         // Harmless scenery pulse (e.g. AoO Poison Cluster 2: radius 14,
         // damage 5): evidence/learning above still run so the profile stays
         // known, but it must never become a danger circle the dodge flees —
         // evacuating a 14-tile circle over 5 damage made the Dammah and O3
         // fights unplayable.
         if(isHarmlessAoeDamage(damage,effect)) {
            return;
         }
         this.dodgeAoeX_.push(x);
         this.dodgeAoeY_.push(y);
         this.dodgeAoeRadius_.push(radius);
         this.dodgeAoeUntil_.push(time + holdMs);
         this.dodgeAoeDamage_.push(damage);
         this.dodgeAoeArmorPiercing_.push(armorPiercing);
         this.dodgeAoeRepeating_.push(repeating);
         this.dodgeAoeEffect_.push(effect);
         this.dodgeAoeEffectDuration_.push(effectDuration);
      }

      /** Packet-confirmed repeating ground pulses whose first interval must be
       * protected before a second packet exists to teach the generic cadence. */
      /** A trivially small hit with no condition effect is scenery, not a
       * movement hazard, regardless of its (possibly huge) radius. */
      private static const HARMLESS_AOE_DAMAGE_MAX:int = 15;

      public static function isHarmlessAoeDamage(damage:int, effect:int) : Boolean {
         return damage >= 0 && damage <= HARMLESS_AOE_DAMAGE_MAX && effect == 0;
      }

      /** Confirmed throw whose learned profile is scenery-grade (see above):
       * still rendered and learned, but excluded from dodge steering. */
      public function isThrownAoeHarmless(thrown:ThrownProjectile) : Boolean {
         return isHarmlessAoeDamage(this.getThrownAoeDamage(thrown),
               this.getThrownAoeEffect(thrown));
      }

      private static function knownAoeRepeatInterval(originType:int,
                                                     effect:int,
                                                     damage:int) : int {
         if(originType == 9827 && effect == 4 && damage == 100) {
            return 610;
         }
         // Unwarned pulse sources from the 07-22..24 logs (no SHOW_EFFECT
         // throw, no telegraph — 35 first-encounter AoE hits). A known cadence
         // marks the circle as repeating from its FIRST pulse, so the player
         // evacuates before the second instead of learning by taking two hits.
         // Cadences are the same-position inter-packet medians.
         if(originType == 51058 && damage == 40) {
            return 1030;
         }
         if(originType == 44924 && damage == 120) {
            return 210;
         }
         if(originType == 49436 && damage == 80) {
            return 205;
         }
         return 0;
      }

      public function getRecentAoeCount(time:int) : int {
         this.pruneRecentAoe(time);
         return this.dodgeAoeUntil_.length;
      }

      public function getRecentAoeX(index:int) : Number {
         return this.dodgeAoeX_[index];
      }

      public function getRecentAoeY(index:int) : Number {
         return this.dodgeAoeY_[index];
      }

      public function getRecentAoeRadius(index:int) : Number {
         return this.dodgeAoeRadius_[index];
      }

      public function getRecentAoeUntil(index:int) : int {
         return this.dodgeAoeUntil_[index];
      }

      public function getRecentAoeDamage(index:int) : int {
         return this.dodgeAoeDamage_[index];
      }

      public function getRecentAoeArmorPiercing(index:int) : Boolean {
         return this.dodgeAoeArmorPiercing_[index];
      }

      public function isRecentAoeRepeating(index:int) : Boolean {
         return this.dodgeAoeRepeating_[index];
      }

      public function getRecentAoeEffect(index:int) : int {
         return this.dodgeAoeEffect_[index];
      }

      public function getRecentAoeEffectDuration(index:int) : Number {
         return this.dodgeAoeEffectDuration_[index];
      }

      /** Authoritative AOE history retained for delayed HP attribution only. */
      private function recordAoeEvidence(x:Number, y:Number, radius:Number,
                                         time:int, damage:int,
                                         armorPiercing:Boolean, effect:int,
                                         originType:int) : void {
         this.pruneAoeEvidence(time);
         this.aoeEvidenceX_.push(x);
         this.aoeEvidenceY_.push(y);
         this.aoeEvidenceRadius_.push(radius);
         this.aoeEvidenceTime_.push(time);
         this.aoeEvidenceDamage_.push(damage);
         this.aoeEvidenceArmorPiercing_.push(armorPiercing);
         this.aoeEvidenceEffect_.push(effect);
         this.aoeEvidenceOriginType_.push(originType);
         if(this.aoeEvidenceTime_.length - this.aoeEvidenceHead_ >
               MAX_AOE_EVIDENCE) {
            this.aoeEvidenceHead_++;
         }
      }

      public function getAoeEvidenceCount(time:int) : int {
         this.pruneAoeEvidence(time);
         return this.aoeEvidenceTime_.length - this.aoeEvidenceHead_;
      }

      public function getAoeEvidenceX(index:int) : Number {
         return this.aoeEvidenceX_[index + this.aoeEvidenceHead_];
      }

      public function getAoeEvidenceY(index:int) : Number {
         return this.aoeEvidenceY_[index + this.aoeEvidenceHead_];
      }

      public function getAoeEvidenceRadius(index:int) : Number {
         return this.aoeEvidenceRadius_[index + this.aoeEvidenceHead_];
      }

      public function getAoeEvidenceTime(index:int) : int {
         return this.aoeEvidenceTime_[index + this.aoeEvidenceHead_];
      }

      public function getAoeEvidenceDamage(index:int) : int {
         return this.aoeEvidenceDamage_[index + this.aoeEvidenceHead_];
      }

      public function isAoeEvidenceArmorPiercing(index:int) : Boolean {
         return this.aoeEvidenceArmorPiercing_[index + this.aoeEvidenceHead_];
      }

      public function getAoeEvidenceEffect(index:int) : int {
         return this.aoeEvidenceEffect_[index + this.aoeEvidenceHead_];
      }

      public function getAoeEvidenceOriginType(index:int) : int {
         return this.aoeEvidenceOriginType_[index + this.aoeEvidenceHead_];
      }

      private function pruneAoeEvidence(time:int) : void {
         var cutoff:int = time - AOE_EVIDENCE_RETENTION_MS;
         while(this.aoeEvidenceHead_ < this.aoeEvidenceTime_.length &&
               this.aoeEvidenceTime_[this.aoeEvidenceHead_] < cutoff) {
            this.aoeEvidenceHead_++;
         }
         if(this.aoeEvidenceHead_ < 256 || this.aoeEvidenceHead_ * 2 <
               this.aoeEvidenceTime_.length) {
            return;
         }
         this.aoeEvidenceX_.splice(0,this.aoeEvidenceHead_);
         this.aoeEvidenceY_.splice(0,this.aoeEvidenceHead_);
         this.aoeEvidenceRadius_.splice(0,this.aoeEvidenceHead_);
         this.aoeEvidenceTime_.splice(0,this.aoeEvidenceHead_);
         this.aoeEvidenceDamage_.splice(0,this.aoeEvidenceHead_);
         this.aoeEvidenceArmorPiercing_.splice(0,this.aoeEvidenceHead_);
         this.aoeEvidenceEffect_.splice(0,this.aoeEvidenceHead_);
         this.aoeEvidenceOriginType_.splice(0,this.aoeEvidenceHead_);
         this.aoeEvidenceHead_ = 0;
      }

      /** A SHOW_EFFECT telegraph whose target and delay are known before the
       * authoritative AOE packet. Holy/Chaos beams previously rendered here but
       * never reached Auto Dodge, so their first pulse was necessarily late. */
      public function recordTelegraphedAoe(x:Number, y:Number, radius:Number,
                                           currentTime:int, impactTime:int,
                                           targetId:int, effectType:int,
                                           sourceType:int, damage:int = -1,
                                           armorPiercing:Boolean = false) : void {
         this.pruneTelegraphedAoe(currentTime);
         for(var index:int = this.telegraphAoeTarget_.length - 1; index >= 0; index--) {
            if(this.telegraphAoeTarget_[index] == targetId &&
                  this.telegraphAoeEffect_[index] == effectType &&
                  this.telegraphAoeSource_[index] == sourceType) {
               this.telegraphAoeX_[index] = x;
               this.telegraphAoeY_[index] = y;
               this.telegraphAoeRadius_[index] = radius;
               this.telegraphAoeImpact_[index] = impactTime;
               this.telegraphAoeUntil_[index] = impactTime + TELEGRAPH_AOE_GRACE_MS;
               this.telegraphAoeCreated_[index] = currentTime;
               this.telegraphAoeDamage_[index] = damage;
               this.telegraphAoeArmorPiercing_[index] = armorPiercing;
               return;
            }
         }
         this.telegraphAoeX_.push(x);
         this.telegraphAoeY_.push(y);
         this.telegraphAoeRadius_.push(radius);
         this.telegraphAoeImpact_.push(impactTime);
         this.telegraphAoeUntil_.push(impactTime + TELEGRAPH_AOE_GRACE_MS);
         this.telegraphAoeTarget_.push(targetId);
         this.telegraphAoeEffect_.push(effectType);
         this.telegraphAoeSource_.push(sourceType);
         this.telegraphAoeCreated_.push(currentTime);
         this.telegraphAoeDamage_.push(damage);
         this.telegraphAoeArmorPiercing_.push(armorPiercing);
         if(Parameters.data.autoDodgeDebug) {
            DebugLog.event("auto_dodge_telegraph",{
                  "effectType":effectType,"targetId":targetId,
                  "sourceType":sourceType,
                  "x":x,"y":y,"radius":radius,
                  "damage":damage,"armorPiercing":armorPiercing,
                  "impactTime":impactTime,"map":name_});
         }
         // Swap-removal leaves an arbitrary entry at index 0, so evicting index
         // 0 at the cap could drop a still-imminent warning while stale ones
         // survive. Evict the entry expiring soonest instead.
         while(this.telegraphAoeUntil_.length > 256) {
            var evictIndex:int = 0;
            for(var evictScan:int = 1; evictScan < this.telegraphAoeUntil_.length;
                  evictScan++) {
               if(this.telegraphAoeUntil_[evictScan] <
                     this.telegraphAoeUntil_[evictIndex]) {
                  evictIndex = evictScan;
               }
            }
            this.removeTelegraphedAoeAt(evictIndex);
         }
      }

      /** Retire the exact visual warning as soon as its authoritative AOE lands. */
      private function resolveTelegraphedAoe(x:Number, y:Number, time:int,
                                             originType:int) : void {
         if(originType <= 0 || this.telegraphAoeUntil_.length == 0) {
            return;
         }
         this.pruneTelegraphedAoe(time);
         var bestIndex:int = -1;
         var bestDistanceSq:Number = TELEGRAPH_AOE_MATCH_DISTANCE_SQ;
         for(var index:int = this.telegraphAoeUntil_.length - 1; index >= 0; index--) {
            if(this.telegraphAoeSource_[index] != originType) {
               continue;
            }
            var dx:Number = x - this.telegraphAoeX_[index];
            var dy:Number = y - this.telegraphAoeY_[index];
            var distanceSq:Number = dx * dx + dy * dy;
            if(distanceSq <= bestDistanceSq) {
               bestDistanceSq = distanceSq;
               bestIndex = index;
            }
         }
         if(bestIndex < 0) {
            return;
         }
         if(Parameters.data.autoDodgeDebug) {
            DebugLog.event("auto_dodge_telegraph_resolved",{
                  "sourceType":originType,
                  "effectType":this.telegraphAoeEffect_[bestIndex],
                  "targetId":this.telegraphAoeTarget_[bestIndex],
                  "observedLeadMs":time - this.telegraphAoeCreated_[bestIndex],
                  "scheduledLeadMs":this.telegraphAoeImpact_[bestIndex] -
                        this.telegraphAoeCreated_[bestIndex],
                  "distance":Math.sqrt(bestDistanceSq),"map":name_});
         }
         this.removeTelegraphedAoeAt(bestIndex);
      }

      public function getTelegraphedAoeCount(time:int) : int {
         this.pruneTelegraphedAoe(time);
         return this.telegraphAoeUntil_.length;
      }

      public function getTelegraphedAoeX(index:int) : Number { return this.telegraphAoeX_[index]; }
      public function getTelegraphedAoeY(index:int) : Number { return this.telegraphAoeY_[index]; }
      public function getTelegraphedAoeRadius(index:int) : Number { return this.telegraphAoeRadius_[index]; }
      public function getTelegraphedAoeDamage(index:int) : int { return this.telegraphAoeDamage_[index]; }
      public function isTelegraphedAoeArmorPiercing(index:int) : Boolean {
         return this.telegraphAoeArmorPiercing_[index];
      }
      public function getTelegraphedAoeImpact(index:int) : int { return this.telegraphAoeImpact_[index]; }

      private function pruneTelegraphedAoe(time:int) : void {
         for(var index:int = this.telegraphAoeUntil_.length - 1; index >= 0; index--) {
            if(time <= this.telegraphAoeUntil_[index]) {
               continue;
            }
            this.removeTelegraphedAoeAt(index);
         }
      }

      private function removeTelegraphedAoeAt(index:int) : void {
         var last:int = this.telegraphAoeUntil_.length - 1;
         this.telegraphAoeX_[index] = this.telegraphAoeX_[last];
         this.telegraphAoeY_[index] = this.telegraphAoeY_[last];
         this.telegraphAoeRadius_[index] = this.telegraphAoeRadius_[last];
         this.telegraphAoeImpact_[index] = this.telegraphAoeImpact_[last];
         this.telegraphAoeUntil_[index] = this.telegraphAoeUntil_[last];
         this.telegraphAoeTarget_[index] = this.telegraphAoeTarget_[last];
         this.telegraphAoeEffect_[index] = this.telegraphAoeEffect_[last];
         this.telegraphAoeSource_[index] = this.telegraphAoeSource_[last];
         this.telegraphAoeCreated_[index] = this.telegraphAoeCreated_[last];
         this.telegraphAoeDamage_[index] = this.telegraphAoeDamage_[last];
         this.telegraphAoeArmorPiercing_[index] =
               this.telegraphAoeArmorPiercing_[last];
         this.telegraphAoeX_.length = last;
         this.telegraphAoeY_.length = last;
         this.telegraphAoeRadius_.length = last;
         this.telegraphAoeImpact_.length = last;
         this.telegraphAoeUntil_.length = last;
         this.telegraphAoeTarget_.length = last;
         this.telegraphAoeEffect_.length = last;
         this.telegraphAoeSource_.length = last;
         this.telegraphAoeCreated_.length = last;
         this.telegraphAoeDamage_.length = last;
         this.telegraphAoeArmorPiercing_.length = last;
      }

      private function pruneRecentAoe(time:int) : void {
         for(var index:int = this.dodgeAoeUntil_.length - 1; index >= 0; index--) {
            if(time < this.dodgeAoeUntil_[index]) {
               continue;
            }
            var last:int = this.dodgeAoeUntil_.length - 1;
            this.dodgeAoeX_[index] = this.dodgeAoeX_[last];
            this.dodgeAoeY_[index] = this.dodgeAoeY_[last];
            this.dodgeAoeRadius_[index] = this.dodgeAoeRadius_[last];
            this.dodgeAoeUntil_[index] = this.dodgeAoeUntil_[last];
            this.dodgeAoeDamage_[index] = this.dodgeAoeDamage_[last];
            this.dodgeAoeArmorPiercing_[index] = this.dodgeAoeArmorPiercing_[last];
            this.dodgeAoeRepeating_[index] = this.dodgeAoeRepeating_[last];
            this.dodgeAoeEffect_[index] = this.dodgeAoeEffect_[last];
            this.dodgeAoeEffectDuration_[index] = this.dodgeAoeEffectDuration_[last];
            this.dodgeAoeX_.length = last;
            this.dodgeAoeY_.length = last;
            this.dodgeAoeRadius_.length = last;
            this.dodgeAoeUntil_.length = last;
            this.dodgeAoeDamage_.length = last;
            this.dodgeAoeArmorPiercing_.length = last;
            this.dodgeAoeRepeating_.length = last;
            this.dodgeAoeEffect_.length = last;
            this.dodgeAoeEffectDuration_.length = last;
         }
      }

      /** Record the endpoint before a thrown animation is removed. */
      public function recordThrownLanding(thrown:ThrownProjectile, time:int) : void {
         if(thrown == null || thrown.end_ == null || thrown.aoeImpactMatched_) {
            return;
         }
         this.prunePendingAoe(time);
         // Hard cap like every other dodge structure: a burst of hundreds of
         // unmatched landings must stay bounded. The oldest pending entry is
         // the least likely to still match a delayed packet.
         while(this.pendingAoeUntil_.length >= 512) {
            var oldestPending:int = 0;
            for(var pendingScan:int = 1; pendingScan < this.pendingAoeUntil_.length;
                  pendingScan++) {
               if(this.pendingAoeUntil_[pendingScan] <
                     this.pendingAoeUntil_[oldestPending]) {
                  oldestPending = pendingScan;
               }
            }
            this.removePendingAoe(oldestPending);
         }
         this.pendingAoeType_.push(thrown.effectType_);
         this.pendingAoeShowEffectType_.push(thrown.showEffectType_);
         this.pendingAoeSourceType_.push(thrown.sourceType_);
         this.pendingAoeLifetime_.push(thrown.lifetime_);
         this.pendingAoeX_.push(thrown.end_.x);
         this.pendingAoeY_.push(thrown.end_.y);
         this.pendingAoeUntil_.push(time + PENDING_AOE_RETENTION_MS);
         // O2 sometimes removes the visual throw roughly one second before the
         // authoritative Wine Cellar impact. Only an unmatched, already-proven
         // signature reaches here; retain its exact endpoint until the packet
         // resolves it instead of silently dropping the first delayed bomb.
         if(thrown.sourceType_ == 2354 && thrown.showEffectType_ == 4 &&
               thrown.effectType_ == 16711680 &&
               this.isThrownAoeConfirmed(thrown)) {
            // Synthetic target ids are negated so they can never collide with
            // a live object id and overwrite that object's telegraph via the
            // target+effect+source dedupe in recordTelegraphedAoe.
            this.recordTelegraphedAoe(thrown.end_.x,thrown.end_.y,
                  this.getThrownAoeRadius(thrown),time,
                  time + O2_DELAYED_LANDING_MS,
                  thrown.objectId_ > 0 ? thrown.objectId_ : -time,
                  thrown.effectType_,thrown.sourceType_,
                  this.getThrownAoeDamage(thrown),
                  this.isThrownAoeArmorPiercing(thrown));
         }
         if(Parameters.data.autoDodgeDebug) {
            DebugLog.event("auto_dodge_throw_landed",{
               "showEffectType":thrown.showEffectType_,
               "effectType":thrown.effectType_,"sourceType":thrown.sourceType_,
               "lifetime":thrown.lifetime_,"x":thrown.end_.x,"y":thrown.end_.y,
               "pending":this.pendingAoeUntil_.length,"map":name_
            });
         }
      }

      /** Radius known from prior impacts of this SHOW_EFFECT projectile type. */
      public function getThrownAoeRadius(thrown:ThrownProjectile) : Number {
         var learned:* = this.getThrownAoeProfileValue(thrown,
               this.learnedAoeRadius_,sharedAoeRadius_);
         // The SHOW_EFFECT packet has no radius. One tile is a conservative
         // first-observation fallback; subsequent throws use the server radius.
         return learned === undefined ? 1.0 : Number(learned);
      }

      public function getThrownAoeDamage(thrown:ThrownProjectile) : int {
         var learned:* = this.getThrownAoeProfileValue(thrown,
               this.learnedAoeDamage_,sharedAoeDamage_);
         return learned === undefined ? -1 : int(learned);
      }

      public function isThrownAoeArmorPiercing(thrown:ThrownProjectile) : Boolean {
         return this.getThrownAoeProfileValue(thrown,
               this.learnedAoeArmorPiercing_,sharedAoeArmorPiercing_) === true;
      }

      public function getThrownAoeEffect(thrown:ThrownProjectile) : int {
         var learned:* = this.getThrownAoeProfileValue(thrown,
               this.learnedAoeEffect_,sharedAoeEffect_);
         return learned === undefined ? 0 : int(learned);
      }

      public function getThrownAoeEffectDuration(thrown:ThrownProjectile) : Number {
         var learned:* = this.getThrownAoeProfileValue(thrown,
               this.learnedAoeEffectDuration_,sharedAoeEffectDuration_);
         return learned === undefined ? 0 : Number(learned);
      }

      /** Correct the SHOW_EFFECT flight clock using earlier authoritative AOE
       * impacts observed for this exact primitive/effect/source/duration. */
      public function getThrownAoeLandingOffset(thrown:ThrownProjectile) : int {
         if(thrown == null) {
            return -1;
         }
         var rawOffset:int = thrown.dodgeLandingOffset();
         if(rawOffset <= 0) {
            return rawOffset;
         }
         var learned:* = this.getThrownAoeProfileValue(thrown,
               this.learnedAoeTimingLead_,sharedAoeTimingLead_);
         var timingLead:int = learned === undefined ? 0 : int(learned);
         return Math.max(1,rawOffset - timingLead);
      }

      public function getThrownAoeTimingLead(thrown:ThrownProjectile) : int {
         var learned:* = this.getThrownAoeProfileValue(thrown,
               this.learnedAoeTimingLead_,sharedAoeTimingLead_);
         return learned === undefined ? 0 : int(learned);
      }

      /** SHOW_EFFECT THROW is also used for harmless visual arcs. It becomes a
       * movement threat only after an AOE packet has matched the same endpoint,
       * or when a source-specific profile was proven by a prior capture/map. */
      public function isThrownAoeConfirmed(thrown:ThrownProjectile) : Boolean {
         if(thrown == null) {
            return false;
         }
         return this.getThrownAoeProfileValue(thrown,this.learnedAoeRadius_,
               sharedAoeRadius_) !== undefined;
      }

      /** The thrown's profile key, cached on the instance (all four inputs are
       * fixed at construction; sourceType_ participates in the guard anyway). */
      private function thrownProfileKey(thrown:ThrownProjectile) : String {
         var key:String = thrown.dodgeProfileKey_;
         if(key == null || thrown.dodgeProfileKeySource_ != thrown.sourceType_) {
            key = this.thrownAoeKey(thrown.showEffectType_,thrown.effectType_,
                  thrown.sourceType_,thrown.lifetime_);
            thrown.dodgeProfileKey_ = key;
            thrown.dodgeProfileKeySource_ = thrown.sourceType_;
         }
         return key;
      }

      private function getThrownAoeProfileValue(thrown:ThrownProjectile,
                                                local:Dictionary,
                                                shared:Dictionary) : * {
         if(thrown == null) {
            return undefined;
         }
         var key:String = this.thrownProfileKey(thrown);
         var value:* = local[key];
         if(value === undefined && thrown.sourceType_ >= 0) {
            value = shared[key];
         }
         return value;
      }

      private function thrownAoeKey(showEffectType:int, effectType:uint,
                                    sourceType:int, lifetime:int) : String {
         // SHOW_EFFECT duration is serialized as a float and can vary by a few
         // milliseconds after conversion. A 250ms bucket keeps the same attack
         // stable while separating genuinely different telegraph timings.
         return makeThrownAoeKey(showEffectType,effectType,sourceType,
               int((lifetime + 125) / 250));
      }

      private static function makeThrownAoeKey(showEffectType:int,
                                               effectType:uint,
                                               sourceType:int,
                                               lifetimeBucket:int) : String {
         return showEffectType + ":" + effectType + ":" + sourceType + ":" +
               lifetimeBucket;
      }

      private static function initializeKnownAoeProfiles() : void {
         if(knownAoeProfilesInitialized_) {
            return;
         }
         knownAoeProfilesInitialized_ = true;
         // Exact SHOW_EFFECT -> AOE endpoint/timing matches from the July 12-15
         // Exalt captures. These profiles make the first observed bomb safe
         // without promoting unrelated visual throws.
         seedKnownAoeProfile(4,16711680,553,6,3,55,false,0,0);       // Greater Pit Viper
         seedKnownAoeProfile(4,16711680,16995,4,2,90,false,0,0);     // Insurgent Rebel Commander
         // ProdMafia's legacy THROW particle retains a two-second visual while
         // this authoritative landing arrived with ~291ms left on its physical
         // clock. Start 300ms early on the exact observed duration signature.
         seedKnownAoeProfile(4,16711680,16995,8,2,90,false,0,0,300);
         seedKnownAoeProfile(4,16711680,2327,6,2.7,100,false,0,0);   // Stheno
         seedKnownAoeProfile(4,16711680,3622,4,2,70,false,0,0);      // Snakepit Guard (1.0 s)
         seedKnownAoeProfile(4,16711680,3622,6,2,70,false,0,0);      // Snakepit Guard (1.6 s)
         seedKnownAoeProfile(4,16711680,22018,6,4,130,false,4,3);    // Pentaract, Slowed
         seedKnownAoeProfile(4,16711680,21889,6,4,150,false,0,0);    // City Medusa
         seedKnownAoeProfile(4,16711680,9826,6,3,160,false,30,2);    // Floral Dragon, Unstable
         seedKnownAoeProfile(4,16711680,552,8,3,65,false,0,0);       // Greater Pit Snake
         // Oryx 2 profiles from the 2026-07-15 Wine Cellar trace. The orange
         // eight-point ring pulses repeatedly; both red variants are ordinary
         // delayed bombs with different timings/damage.
         seedKnownAoeProfile(4,16762368,2354,10,2.8,180,false,0,0);
         seedKnownAoeProfile(4,16711680,2354,12,3,200,false,0,0);
         seedKnownAoeProfile(4,16711680,2354,10,3,250,false,0,0);
         // The Shatters' King throws several colored variants on distinct
         // clocks. These exact combinations all produced radius-2,
         // 125-damage authoritative impacts in the latest session.
         seedKnownAoeProfile(16,33318,29291,4,2,125,false,0,0);
         seedKnownAoeProfile(16,33318,29291,6,2,125,false,0,0);
         seedKnownAoeProfile(16,33318,29291,7,2,125,false,0,0);
         seedKnownAoeProfile(16,33318,29291,9,2,125,false,0,0);
         seedKnownAoeProfile(16,33320,29291,4,2,125,false,0,0);
         seedKnownAoeProfile(16,33320,29291,6,2,125,false,0,0);
         seedKnownAoeProfile(16,33320,29291,7,2,125,false,0,0);
         seedKnownAoeProfile(16,33317,29291,6,2,125,false,0,0);
         seedKnownAoeProfile(16,33317,29291,7,2,125,false,0,0);
         seedKnownAoeProfile(16,33317,29291,9,2,125,false,0,0);
         seedKnownAoeProfile(16,33319,29291,5,2,125,false,0,0);
         seedKnownAoeProfile(16,33319,29291,6,2,125,false,0,0);
         seedKnownAoeProfile(16,33319,29291,7,2,125,false,0,0);
         seedKnownAoeProfile(16,33316,29291,6,2,125,false,0,0);
         seedKnownAoeProfile(16,34521,34515,6,1.2,60,true,0,0);      // Flesh Golem -> Boulder
         // Some AOE packets identify the spawned boulder rather than its
         // thrower. Keep this alias, but the live SHOW_EFFECT lookup must use
         // the Flesh Golem source type above.
         seedKnownAoeProfile(16,34521,34521,6,1.2,60,true,0,0);
         seedKnownAoeProfile(16,2640,49902,4,3.4,125,false,6,2.4);   // Pirate Rum, Dazed
         // This session proves both Monstrous Grizzly boulders by exact landing
         // correlation. The 80-damage armor-piercing boulder also inflicted a
         // harmful status observed by the user; -1 retains that risk until the
         // next packet log captures its exact condition id and duration.
          seedKnownAoeProfile(16,1896,31508,6,4.5,230,false,0,0);
          seedKnownAoeProfile(16,24125,34518,3,3,80,true,6,0);

          // Exact authoritative matches from the 2026-07-16 long session. Keep
          // timing aliases separate: the same art/source can have attacks with
          // materially different landing times, radii and damage.
          seedKnownAoeProfile(16,1896,34518,6,3.5,80,true,0,0);
          seedKnownAoeProfile(16,226,9825,6,3,110,false,0,0);
          seedKnownAoeProfile(16,24125,31508,4,4.5,230,false,0,0);
          seedKnownAoeProfile(16,24125,34518,4,4.5,230,true,0,0);
          seedKnownAoeProfile(4,12582784,25598,8,4,85,true,5,0);
          seedKnownAoeProfile(4,14811136,13251,10,3,130,false,0,0);
          seedKnownAoeProfile(4,14811136,25533,10,3,130,false,0,0);
          seedKnownAoeProfile(4,14811136,25598,10,2.5,110,false,0,0);
          seedKnownAoeProfile(4,14811136,25598,16,4.25,150,false,0,0);
          seedKnownAoeProfile(4,16711680,21889,10,4,150,false,0,0);
          seedKnownAoeProfile(4,16711680,24106,10,3,75,false,0,0);
          seedKnownAoeProfile(4,16711680,24108,10,3,70,false,0,0);
          seedKnownAoeProfile(4,16711680,31637,10,2.5,150,false,4,0);
          seedKnownAoeProfile(4,16711680,34486,12,2.5,140,false,4,1);
          seedKnownAoeProfile(4,16711680,9826,10,3,160,false,30,2);
          seedKnownAoeProfile(4,16762368,51055,9,1,80,true,16,0);
          seedKnownAoeProfile(4,16762368,51056,9,1,80,true,16,0);
          seedKnownAoeProfile(4,9881571,13249,9,1.5,30,true,48,0);
          seedKnownAoeProfile(4,9881571,26134,9,1.5,30,true,48,0);

          // First-impact profiles recovered by joining authoritative AOE
          // packets to exact SHOW_EFFECT endpoints across the July 15/21 logs.
          // These attacks previously became safe only after the first landing
          // taught the runtime profile.
          seedKnownAoeProfile(4,16777215,14701,10,3,90,false,0,0);  // Heroic Spectral Skeleton
          seedKnownAoeProfile(4,16777215,14701,8,2.5,90,false,0,0);
          seedKnownAoeProfile(4,16711680,5952,10,2.5,220,false,0,0); // Oryx 1 bomb
          seedKnownAoeProfile(4,5775375,56387,10,5,120,false,2,4,40); // Neo Starvation outer
          seedKnownAoeProfile(4,5775375,56387,12,3,80,false,2,4);    // Neo Starvation ring
          // Gemsbok's four knife colors share one 1.6-second throw clock but
          // inflict distinct conditions. Effect 8642 is visual-only in the
          // capture and deliberately remains unconfirmed.
          seedKnownAoeProfile(16,23401,8700,6,3,140,false,5,2,42);
          seedKnownAoeProfile(16,23402,8700,6,3,140,false,6,2);
          seedKnownAoeProfile(16,23399,8700,6,3,140,false,27,2);
          seedKnownAoeProfile(16,23400,8700,6,2.5,140,false,48,2);

          // Oryx 3's four textured rock volleys. SHOW_EFFECT contains the
          // endpoint and 1.6-second flight but no radius; exact AOE matches in
          // the 2026-07-16 O3 trace proved these values. Seed all four so their
          // first volley is rendered and dodged before it reaches the ground.
          seedKnownAoeProfile(16,46108,45363,6,3,150,false,5,3);  // red, Sick
          seedKnownAoeProfile(16,46180,45363,6,3,200,false,5,3);  // blue, Sick
          seedKnownAoeProfile(16,46181,45363,6,3,150,false,5,3);  // green, Sick
          seedKnownAoeProfile(16,46212,45363,6,3,150,false,5,3);  // orange, Sick

          // Exalted O3 repeats the same four rock visuals on a faster 1.2-second
          // clock. This is a separate signature from the 1.6-second volley above:
          // the 2026-07-21 trace matched every first-volley endpoint exactly to a
          // radius-3.5, 180-damage AOE that inflicts Sick for six seconds. Without
          // bucket 5 these rocks are harmless until their first impacts teach the
          // runtime profile, so only the second exalted volley is predicted.
          seedKnownAoeProfile(16,46108,45363,5,3.5,180,false,5,6);     // red
          seedKnownAoeProfile(16,46180,45363,5,3.5,180,false,5,6);     // blue
          seedKnownAoeProfile(16,46181,45363,5,3.5,180,false,5,6);     // green
          // Orange landed consistently about 50ms before its nominal flight clock.
          seedKnownAoeProfile(16,46212,45363,5,3.5,180,false,5,6,50);  // orange

          // Archbishop Leucoryx (Oryx's Sanctuary) drops two ground bombs on a
          // 2.4-second throw clock. The 2026-07-24 Sanctuary session matched every
          // first-volley endpoint exactly: the pale bomb lands as radius-3 180 and
          // the dark bomb as radius-3 220, both non-armor-piercing. Seeding them
          // makes the first bomb of each colour dodged before it lands instead of
          // only after the runtime learns the profile. (The source's holy/chaos
          // beams are handled separately by the beam-telegraph path, and its
          // bucket-6 rock visuals spawn projectile volleys rather than ground AOEs,
          // so they are deliberately not seeded here.)
          seedKnownAoeProfile(4,16439902,6622,10,3,180,false,0,0);
          seedKnownAoeProfile(4,13041863,6622,10,3,220,false,0,0);
          loadPersistedAoeProfiles();
      }

      private static function seedKnownAoeProfile(showEffectType:int,
                                                  effectType:uint,
                                                  sourceType:int,
                                                  lifetimeBucket:int,
                                                  radius:Number,
                                                  damage:int,
                                                  armorPiercing:Boolean,
                                                  conditionEffect:int,
                                                  conditionDuration:Number,
                                                  timingLeadMs:int = 0) : void {
         var key:String = makeThrownAoeKey(showEffectType,effectType,
               sourceType,lifetimeBucket);
         var previousRadius:* = sharedAoeRadius_[key];
         var previousDamage:* = sharedAoeDamage_[key];
         sharedAoeRadius_[key] = previousRadius === undefined ? radius :
               Math.max(Number(previousRadius),radius);
         sharedAoeDamage_[key] = previousDamage === undefined ? damage :
               Math.max(int(previousDamage),damage);
         if(armorPiercing) {
            sharedAoeArmorPiercing_[key] = true;
         }
         // Merge, never downgrade: persisted profiles load AFTER the curated
         // seeds through this same function, and a plain overwrite let a
         // learned shorter duration silently weaken hand-verified condition
         // data on the next startup. Same effect -> max duration (matching
         // setLearnedAoeRadius); different effect -> the pair with the longer
         // duration wins deterministically.
         if(conditionEffect != 0) {
            var previousEffect:* = sharedAoeEffect_[key];
            if(previousEffect === undefined ||
                  int(previousEffect) == conditionEffect) {
               sharedAoeEffect_[key] = conditionEffect;
               var previousEffectDuration:* = sharedAoeEffectDuration_[key];
               sharedAoeEffectDuration_[key] = previousEffectDuration === undefined ?
                     conditionDuration :
                     Math.max(Number(previousEffectDuration),conditionDuration);
            } else if(conditionDuration > Number(sharedAoeEffectDuration_[key])) {
               sharedAoeEffect_[key] = conditionEffect;
               sharedAoeEffectDuration_[key] = conditionDuration;
            }
          }
         if(timingLeadMs > 0) {
            var previousTimingLead:* = sharedAoeTimingLead_[key];
            sharedAoeTimingLead_[key] = previousTimingLead === undefined ?
                  timingLeadMs : Math.max(int(previousTimingLead),timingLeadMs);
         }
      }

      /** Load only bounded, source-specific profiles. Unknown-source visual ids
       * and long mutated warning lifetimes are deliberately rejected so a
       * harmless throw can never become a cross-session movement threat. */
      private static function loadPersistedAoeProfiles() : void {
         if(Parameters.data == null) {
            return;
         }
         var storage:Object = Parameters.data.autoDodgeLearnedAoeProfiles;
         if(storage == null || int(storage.version) != PERSISTED_AOE_PROFILE_VERSION ||
               storage.entries == null) {
            return;
         }
         var loaded:int = 0;
         for each(var profile:Object in storage.entries) {
            if(loaded >= MAX_PERSISTED_AOE_PROFILES ||
                  !isValidPersistedAoeProfile(profile)) {
               continue;
            }
            seedKnownAoeProfile(int(profile.showEffectType),uint(profile.effectType),
                  int(profile.sourceType),int(profile.lifetimeBucket),
                  Number(profile.radius),int(profile.damage),
                  Boolean(profile.armorPiercing),int(profile.conditionEffect),
                  Number(profile.conditionDuration),
                  profile.hasOwnProperty("timingLeadMs") ?
                  int(profile.timingLeadMs) : 0);
            loaded++;
         }
         if(loaded > 0 && Parameters.data.autoDodgeDebug) {
            DebugLog.event("auto_dodge_aoe_profiles_loaded",{"count":loaded});
         }
      }

      private static function isValidPersistedAoeProfile(profile:Object) : Boolean {
         if(profile == null) {
            return false;
         }
         var showEffectType:int = int(profile.showEffectType);
         var sourceType:int = int(profile.sourceType);
         var lifetimeBucket:int = int(profile.lifetimeBucket);
         var radius:Number = Number(profile.radius);
         var damage:int = int(profile.damage);
         var conditionEffect:int = int(profile.conditionEffect);
         var conditionDuration:Number = Number(profile.conditionDuration);
         var timingLeadMs:int = profile.hasOwnProperty("timingLeadMs") ?
               int(profile.timingLeadMs) : 0;
         return (showEffectType == 4 || showEffectType == 16) &&
               sourceType > 0 && lifetimeBucket > 0 &&
               lifetimeBucket <= MAX_PERSISTED_AOE_LIFETIME_BUCKET &&
               !isNaN(radius) && radius >= 0.1 && radius <= 8 &&
               damage >= 0 && damage <= 2000 &&
               conditionEffect >= -1 && conditionEffect <= 255 &&
               !isNaN(conditionDuration) && conditionDuration >= 0 &&
               conditionDuration <= 60 && timingLeadMs >= 0 &&
               timingLeadMs <= 750;
      }

      private static function persistLearnedAoeProfile(key:String,
                                                        showEffectType:int,
                                                        effectType:uint,
                                                        sourceType:int,
                                                        lifetimeBucket:int,
                                                        radius:Number,
                                                        damage:int,
                                                        armorPiercing:Boolean,
                                                        conditionEffect:int,
                                                        conditionDuration:Number,
                                                        timingLeadMs:int) : void {
         var profile:Object = {
            "showEffectType":showEffectType,"effectType":effectType,
            "sourceType":sourceType,"lifetimeBucket":lifetimeBucket,
            "radius":radius,"damage":damage,"armorPiercing":armorPiercing,
            "conditionEffect":conditionEffect,
            "conditionDuration":conditionDuration,
            "timingLeadMs":timingLeadMs
         };
         if(Parameters.data == null || !isValidPersistedAoeProfile(profile)) {
            return;
         }
         var storage:Object = Parameters.data.autoDodgeLearnedAoeProfiles;
         if(storage == null || int(storage.version) != PERSISTED_AOE_PROFILE_VERSION ||
               storage.entries == null) {
            storage = {"version":PERSISTED_AOE_PROFILE_VERSION,"entries":{}};
            Parameters.data.autoDodgeLearnedAoeProfiles = storage;
         }
         var entries:Object = storage.entries;
         var existing:Object = entries[key];
         if(existing != null) {
            // MERGE with the stored entry instead of replacing it wholesale.
            // The old replace let a partially-better observation LOWER other
            // fields, and a signature alternating two condition effects
            // re-persisted (and flushed SharedObject to disk) on every pulse
            // because the equality gate flipped each time. With a monotonic
            // merge, the second observation of either effect converges and
            // every later repeat becomes a no-op.
            var existingTimingLead:int = existing.hasOwnProperty("timingLeadMs") ?
                  int(existing.timingLeadMs) : 0;
            profile.radius = Math.max(Number(existing.radius),radius);
            profile.damage = Math.max(int(existing.damage),damage);
            profile.armorPiercing = Boolean(existing.armorPiercing) || armorPiercing;
            profile.timingLeadMs = Math.max(existingTimingLead,timingLeadMs);
            if(int(existing.conditionEffect) == conditionEffect) {
               profile.conditionDuration = Math.max(
                     Number(existing.conditionDuration),conditionDuration);
            } else if(Number(existing.conditionDuration) >= conditionDuration) {
               // Different effects: the longer-lasting pair wins; ties keep
               // the stored pair so the outcome is stable across sessions.
               profile.conditionEffect = int(existing.conditionEffect);
               profile.conditionDuration = Number(existing.conditionDuration);
            }
            if(Number(existing.radius) == Number(profile.radius) &&
                  int(existing.damage) == int(profile.damage) &&
                  Boolean(existing.armorPiercing) == Boolean(profile.armorPiercing) &&
                  int(existing.conditionEffect) == int(profile.conditionEffect) &&
                  Number(existing.conditionDuration) == Number(profile.conditionDuration) &&
                  existingTimingLead == int(profile.timingLeadMs)) {
               return;
            }
         }
         if(existing == null) {
            var entryCount:int = 0;
            for(var existingKey:String in entries) {
               entryCount++;
            }
            if(entryCount >= MAX_PERSISTED_AOE_PROFILES) {
               return;
            }
         }
         entries[key] = profile;
         Parameters.save();
         if(Parameters.data.autoDodgeDebug) {
            DebugLog.event("auto_dodge_aoe_profile_persisted",{
                  "signature":key,"radius":radius,"damage":damage,
                  "timingLeadMs":timingLeadMs});
         }
      }

      /** Promote only the large, wide warning rings seen in delayed Sanctuary
       * barrages. Small groups of ordinary THROW particles remain short-lived
       * unconfirmed warnings and cannot masquerade as persistent AoE fields. */
      public function promoteDenseLegacyThrowCluster(newest:ThrownProjectile) : void {
         if(newest == null || newest.end_ == null) {
            return;
         }
         // O3 launches wide groups of ordinary red bombs. Density alone does
         // not make them a repeating field: extending these confirmed two-second
         // throws to twelve seconds produced the false circles observed on the
         // Sanctuary floor. Their authoritative AOE packets remain fully scored.
         if(newest.sourceType_ == 45363) {
            return;
         }
         // A THROW effect is only a visual hint until a matching server AOE
         // packet has taught us its radius. Promoting an unknown effect here
         // turned ordinary Oryx spell art into a twelve-second danger field.
         if(!this.isThrownAoeConfirmed(newest) ||
               this.isThrownAoeHarmless(newest)) {
            return;
         }
         var matching:Vector.<ThrownProjectile> = new Vector.<ThrownProjectile>();
         var centerX:Number = 0;
         var centerY:Number = 0;
         var newestKey:String = this.thrownProfileKey(newest);
         for(var index:int = 0; index < this.activeThrownProjectiles_.length; index++) {
            var thrown:ThrownProjectile = this.activeThrownProjectiles_[index];
            if(this.thrownProfileKey(thrown) != newestKey ||
                  thrown.end_ == null ||
                  thrown.persistentAoeWarning_ || thrown.timeLeft_ < thrown.lifetime_ - 100) {
               continue;
            }
            matching.push(thrown);
            centerX += thrown.end_.x;
            centerY += thrown.end_.y;
         }
         if(matching.length < 8) {
            return;
         }
         centerX /= matching.length;
         centerY /= matching.length;
         var extent:Number = 0;
         for each(thrown in matching) {
            var dx:Number = thrown.end_.x - centerX;
            var dy:Number = thrown.end_.y - centerY;
            extent = Math.max(extent,Math.sqrt(dx * dx + dy * dy));
         }
         if(extent < 8) {
            return;
         }
         for each(thrown in matching) {
            thrown.persistentAoeWarning_ = true;
            // The warning describes a repeating barrage, not one impact. Keep
            // its exact endpoint geometry for the observed twelve-second Oryx
            // pulse window; dodgeLandingOffset() separately retains the true
            // first-impact timestamp and treats later pulses as immediate.
            thrown.lifetime_ = Math.max(thrown.lifetime_,12000);
            thrown.timeLeft_ = Math.max(thrown.timeLeft_,12000);
            thrown.dx_ = (thrown.end_.x - thrown.start_.x) / thrown.timeLeft_;
            thrown.dy_ = (thrown.end_.y - thrown.start_.y) / thrown.timeLeft_;
         }
         if(Parameters.data.autoDodgeDebug) {
            DebugLog.event("auto_dodge_throw_cluster_promoted",{
               "effectType":newest.effectType_,"sourceType":newest.sourceType_,
               "lifetime":newest.lifetime_,"count":matching.length,
               "extent":extent,"map":name_
            });
         }
      }

      private function learnAoeRadius(x:Number, y:Number, radius:Number, time:int,
                                      damage:int, armorPiercing:Boolean,
                                      effect:int, effectDuration:Number,
                                      originType:int) : void {
         // Packet processing can precede the final animation update in a frame,
         // so first try throws that are still active but about to land.
         var activeBest:ThrownProjectile = null;
         // Server AOE commonly arrives roughly one second before the THROW
         // animation ends. The old 750ms gate missed those exact endpoint
         // matches, leaving the effect permanently "unknown" while Auto Dodge
         // nevertheless treated every visual throw as a bomb. Use a wider time
         // window but a much tighter spatial match to avoid unrelated effects.
         var activeBestDistanceSq:Number = 0.25;
         var activeCount:int = this.activeThrownProjectiles_.length;
         for(var activeIndex:int = 0; activeIndex < activeCount; activeIndex++) {
            var active:ThrownProjectile = this.activeThrownProjectiles_[activeIndex];
            var activeTimingWindow:int = this.isThrownAoeConfirmed(active) ?
                  750 : 250;
            if(active.end_ == null || !active.persistentAoeWarning_ &&
                  Math.abs(active.impactTimeLeft_) > activeTimingWindow) {
               continue;
            }
            var activeDx:Number = x - active.end_.x;
            var activeDy:Number = y - active.end_.y;
            var activeDistanceSq:Number = activeDx * activeDx + activeDy * activeDy;
            if(activeDistanceSq <= activeBestDistanceSq) {
               activeBestDistanceSq = activeDistanceSq;
               activeBest = active;
            }
         }
         if(activeBest != null) {
            // Preserve the SHOW_EFFECT thrower type as the primary key. The AOE
            // origin is often the spawned projectile/object type (for example,
            // Flesh Golem 34515 -> Boulder 34521); replacing the thrower made
            // every later throw miss the newly learned profile.
            var activeSourceType:int = activeBest.sourceType_;
            if(activeSourceType < 0 && originType > 0) {
               activeSourceType = originType;
            }
            this.learnAoeTimingLead(activeBest.showEffectType_,
                  activeBest.effectType_,activeSourceType,activeBest.lifetime_,
                  activeBest.impactTimeLeft_,time,"active");
            this.setLearnedAoeRadius(activeBest.showEffectType_,
                  activeBest.effectType_,activeSourceType,
                  activeBest.lifetime_,radius,damage,armorPiercing,effect,
                  effectDuration,time,"active");
            if(originType > 0 && originType != activeSourceType) {
               this.learnAoeTimingLead(activeBest.showEffectType_,
                     activeBest.effectType_,originType,activeBest.lifetime_,
                     activeBest.impactTimeLeft_,time,"active_origin_alias");
               this.setLearnedAoeRadius(activeBest.showEffectType_,
                     activeBest.effectType_,originType,activeBest.lifetime_,
                     radius,damage,armorPiercing,effect,effectDuration,time,
                     "active_origin_alias");
            }
            activeBest.aoeImpactMatched_ = true;
            if(!activeBest.persistentAoeWarning_) {
               // The impact has happened. Recent-AoE memory handles repeats;
               // retaining the warning would keep avoiding an empty circle.
               activeBest.timeLeft_ = 1;
            }
            return;
         }
         // Remove expired entries before selecting an index. Removing them
         // inside the search could swap the current last entry to an earlier
         // slot after that last entry had already become bestIndex. bestIndex
         // would then point one past the shortened vectors and the AOE handler
         // would throw RangeError #1125 before sending AOEACK.
         this.prunePendingAoe(time);
         var bestIndex:int = -1;
         var bestDistanceSq:Number = 1.0;
         for(var index:int = this.pendingAoeUntil_.length - 1; index >= 0; index--) {
            var dx:Number = x - this.pendingAoeX_[index];
            var dy:Number = y - this.pendingAoeY_[index];
            var distanceSq:Number = dx * dx + dy * dy;
            if(distanceSq <= bestDistanceSq) {
               bestDistanceSq = distanceSq;
               bestIndex = index;
            }
         }
         if(bestIndex >= 0) {
            var pendingSourceType:int = this.pendingAoeSourceType_[bestIndex];
            if(pendingSourceType < 0 && originType > 0) {
               pendingSourceType = originType;
            }
            this.setLearnedAoeRadius(this.pendingAoeShowEffectType_[bestIndex],
                  this.pendingAoeType_[bestIndex],pendingSourceType,
                  this.pendingAoeLifetime_[bestIndex],radius,damage,
                  armorPiercing,effect,effectDuration,time,"landed");
            if(originType > 0 && originType != pendingSourceType) {
               this.setLearnedAoeRadius(this.pendingAoeShowEffectType_[bestIndex],
                     this.pendingAoeType_[bestIndex],originType,
                     this.pendingAoeLifetime_[bestIndex],radius,damage,
                     armorPiercing,effect,effectDuration,time,
                     "landed_origin_alias");
            }
            this.removePendingAoe(bestIndex);
         }
      }

      /** The AOE packet is the authoritative impact. A still-positive throw
       * clock at that moment is exactly how early this signature really lands.
       * Retain the largest bounded observation so frame jitter cannot make a
       * later session start dodging too late. */
      private function learnAoeTimingLead(showEffectType:int, effectType:uint,
                                          sourceType:int, lifetime:int,
                                          observedLeadMs:int, time:int,
                                          source:String) : void {
         observedLeadMs = Math.max(0,Math.min(750,observedLeadMs));
         if(observedLeadMs < 20) {
            return;
         }
         var key:String = this.thrownAoeKey(showEffectType,effectType,
               sourceType,lifetime);
         var previous:* = this.learnedAoeTimingLead_[key];
         var learnedLead:int = previous === undefined ? observedLeadMs :
               Math.max(int(previous),observedLeadMs);
         this.learnedAoeTimingLead_[key] = learnedLead;
         if(sourceType > 0) {
            var sharedPrevious:* = sharedAoeTimingLead_[key];
            sharedAoeTimingLead_[key] = sharedPrevious === undefined ?
                  learnedLead : Math.max(int(sharedPrevious),learnedLead);
         }
         if(Parameters.data.autoDodgeDebug && (previous === undefined ||
               learnedLead > int(previous) + 10)) {
            DebugLog.event("auto_dodge_aoe_timing_learned",{
               "showEffectType":showEffectType,"effectType":effectType,
               "sourceType":sourceType,"lifetime":lifetime,
               "signature":key,"observedLeadMs":observedLeadMs,
               "timingLeadMs":learnedLead,"time":time,"source":source,
               "map":name_
            });
         }
      }

      private function setLearnedAoeRadius(showEffectType:int, effectType:uint,
                                           sourceType:int,
                                           lifetime:int, radius:Number,
                                           damage:int, armorPiercing:Boolean,
                                           effect:int, effectDuration:Number,
                                           time:int,
                                           source:String) : void {
         var key:String = this.thrownAoeKey(showEffectType,effectType,
               sourceType,lifetime);
         var previous:* = this.learnedAoeRadius_[key];
         // The same visual signature can represent multiple server radii. A
         // later small landing must never erase a previously observed larger
         // danger area; retain the safety envelope for the lifetime of the map.
         var learnedRadius:Number = previous === undefined ? radius :
               Math.max(Number(previous),radius);
         this.learnedAoeRadius_[key] = learnedRadius;
         var previousMatchTime:* = this.learnedAoeLastMatch_[key];
         var matches:int = int(this.learnedAoeMatches_[key]);
         var matchAdvanced:Boolean = false;
         if(previousMatchTime === undefined ||
               time - int(previousMatchTime) >= AOE_REPEAT_MIN_INTERVAL_MS) {
            matches++;
            matchAdvanced = true;
            this.learnedAoeLastMatch_[key] = time;
         }
         this.learnedAoeMatches_[key] = matches;
         var previousDamage:* = this.learnedAoeDamage_[key];
         this.learnedAoeDamage_[key] = previousDamage === undefined ? damage :
               Math.max(int(previousDamage),damage);
         if(armorPiercing) {
            this.learnedAoeArmorPiercing_[key] = true;
         }
         if(effect != 0) {
            this.learnedAoeEffect_[key] = effect;
            var previousEffectDuration:* = this.learnedAoeEffectDuration_[key];
            this.learnedAoeEffectDuration_[key] = previousEffectDuration === undefined ?
                  effectDuration : Math.max(Number(previousEffectDuration),
                  effectDuration);
         }
         // Only authoritative source-specific keys are shared across maps.
         // Unknown-source visual ids remain map-local to avoid reviving the
         // earlier harmless-throw false-positive regression.
          if(sourceType > 0) {
            var sharedRadius:* = sharedAoeRadius_[key];
            sharedAoeRadius_[key] = sharedRadius === undefined ? learnedRadius :
                  Math.max(Number(sharedRadius),learnedRadius);
            var sharedDamage:* = sharedAoeDamage_[key];
            sharedAoeDamage_[key] = sharedDamage === undefined ? damage :
                  Math.max(int(sharedDamage),damage);
            if(armorPiercing) {
               sharedAoeArmorPiercing_[key] = true;
            }
            if(effect != 0) {
               sharedAoeEffect_[key] = effect;
               var previousSharedEffectDuration:* = sharedAoeEffectDuration_[key];
               sharedAoeEffectDuration_[key] = previousSharedEffectDuration === undefined ?
                     effectDuration : Math.max(Number(previousSharedEffectDuration),
                     effectDuration);
             }
          }
          // Two distinct authoritative impacts are required before an observed
          // profile is trusted across process restarts. A single coincidental
          // endpoint match remains available only in this map/runtime.
          if(sourceType > 0 && matchAdvanced && matches >= 2) {
             var lifetimeBucket:int = int((lifetime + 125) / 250);
             var storedEffect:* = this.learnedAoeEffect_[key];
             var storedDuration:* = this.learnedAoeEffectDuration_[key];
             var storedTimingLead:* = this.learnedAoeTimingLead_[key];
             persistLearnedAoeProfile(key,showEffectType,effectType,sourceType,
                   lifetimeBucket,learnedRadius,int(this.learnedAoeDamage_[key]),
                   this.learnedAoeArmorPiercing_[key] === true,
                   storedEffect === undefined ? 0 : int(storedEffect),
                   storedDuration === undefined ? 0 : Number(storedDuration),
                   storedTimingLead === undefined ? 0 : int(storedTimingLead));
          }
          if(Parameters.data.autoDodgeDebug && (previous === undefined ||
               learnedRadius > Number(previous) + 0.01 ||
               previousDamage === undefined || damage > int(previousDamage) ||
               matchAdvanced && matches == 2)) {
            DebugLog.event("auto_dodge_aoe_learned",{
               "showEffectType":showEffectType,
               "effectType":effectType,"sourceType":sourceType,
               "lifetime":lifetime,"signature":key,
               "radius":learnedRadius,"observedRadius":radius,
               "damage":this.learnedAoeDamage_[key],
               "armorPiercing":this.learnedAoeArmorPiercing_[key] === true,
               "conditionEffect":effect,
               "conditionDuration":effectDuration,
               "timingLeadMs":this.learnedAoeTimingLead_[key] === undefined ?
                     0 : this.learnedAoeTimingLead_[key],
               "matches":this.learnedAoeMatches_[key],
               "source":source
            });
         }
      }

      private function prunePendingAoe(time:int) : void {
         for(var index:int = this.pendingAoeUntil_.length - 1; index >= 0; index--) {
            if(time > this.pendingAoeUntil_[index]) {
               this.removePendingAoe(index);
            }
         }
      }

      private function removePendingAoe(index:int) : void {
         var last:int = this.pendingAoeUntil_.length - 1;
         this.pendingAoeType_[index] = this.pendingAoeType_[last];
         this.pendingAoeShowEffectType_[index] = this.pendingAoeShowEffectType_[last];
         this.pendingAoeSourceType_[index] = this.pendingAoeSourceType_[last];
         this.pendingAoeLifetime_[index] = this.pendingAoeLifetime_[last];
         this.pendingAoeX_[index] = this.pendingAoeX_[last];
         this.pendingAoeY_[index] = this.pendingAoeY_[last];
         this.pendingAoeUntil_[index] = this.pendingAoeUntil_[last];
         this.pendingAoeType_.length = last;
         this.pendingAoeShowEffectType_.length = last;
         this.pendingAoeSourceType_.length = last;
         this.pendingAoeLifetime_.length = last;
         this.pendingAoeX_.length = last;
         this.pendingAoeY_.length = last;
         this.pendingAoeUntil_.length = last;
      }

      private function drawAutoDodgeDebug(camera:Camera, time:int) : void {
         if(camera == null || this.mapOverlay_ == null || this.player_ == null ||
               this.hostileProjectiles_ == null) {
            return;
         }
         var graphics:Graphics = this.mapOverlay_.graphics;
         if(graphics == null) {
            return;
         }
         graphics.clear();
         var renderPaths:Boolean = Parameters.data.autoDodgeRenderPaths;
         var renderHitboxes:Boolean = Parameters.data.autoDodgeRenderHitboxes;
         var renderAoe:Boolean = Parameters.data.autoDodgeRenderAoe;
         var renderTarget:Boolean = Parameters.data.autoDodgeRenderTarget;
         var profileRender:Boolean = Parameters.data.autoDodgeDebug;
         var renderStart:int = profileRender ? getTimer() : 0;
         var pathsDrawn:int = 0;
         var hitboxesDrawn:int = 0;
         camera.wToS_.copyRawDataTo(this.dodgeDebugMatrix_);
         this.dodgeDebugOriginWorldX_ = this.player_.x_;
         this.dodgeDebugOriginWorldY_ = this.player_.y_;
         if(this.player_.posS_ != null && this.player_.posS_.length >= 2) {
            // Anchor to the exact screen position used to render the player.
            // This absorbs letterbox/viewport translation changes after resize.
            this.dodgeDebugOriginScreenX_ = this.player_.posS_[0];
            this.dodgeDebugOriginScreenY_ = this.player_.posS_[1];
         } else {
            this.dodgeDebugOriginScreenX_ = this.player_.x_ * this.dodgeDebugMatrix_[0] +
                  this.player_.y_ * this.dodgeDebugMatrix_[4] + this.dodgeDebugMatrix_[12];
            this.dodgeDebugOriginScreenY_ = this.player_.x_ * this.dodgeDebugMatrix_[1] +
                   this.player_.y_ * this.dodgeDebugMatrix_[5] + this.dodgeDebugMatrix_[13];
         }

         // Modern laser projectiles use an intentionally transparent sprite;
         // Exalt renders their <Laser> distance as a world-space line. Keep
         // lethal beams visible even when Auto Dodge diagnostics are disabled.
         this.drawProjectileLasers(graphics,time);
         if(!(renderPaths || renderHitboxes || renderAoe || renderTarget)) {
            return;
         }

         var projectile:Projectile;
         var dx:Number;
         var dy:Number;
         var index:int;
         var count:int = this.hostileProjectiles_.length;
         var rendered:int = 0;
         if(renderPaths) {
            graphics.lineStyle(1,0xFF4D4D,0.38);
            for(index = 0; index < count && rendered < 80; index++) {
               projectile = this.hostileProjectiles_[index];
               if(projectile == null || projectile.projProps == null ||
                     !projectile.isThreatTo(this.player_,time)) {
                  continue;
               }
               dx = projectile.x_ - this.player_.x_;
               dy = projectile.y_ - this.player_.y_;
               if(projectile.isLaser() ?
                     projectile.laserClearanceTo(this.player_.x_,this.player_.y_) > 18 :
                     dx * dx + dy * dy > 324) {
                  continue;
               }
               if(projectile.isLaser()) {
                  this.projectDebugPoint(projectile.startX,projectile.startY);
                  graphics.moveTo(this.dodgeDebugPoint_.x,this.dodgeDebugPoint_.y);
                  projectile.laserEnd(this.dodgeLaserEndPoint_);
                  this.projectDebugPoint(this.dodgeLaserEndPoint_.x,
                        this.dodgeLaserEndPoint_.y);
                  graphics.lineTo(this.dodgeDebugPoint_.x,this.dodgeDebugPoint_.y);
                  rendered++;
                  continue;
               }
               var started:Boolean = false;
               for(var offset:int = 0; offset <= 450; offset += 45) {
                  if(!projectile.isAliveAt(time + offset)) {
                     break;
                  }
                  projectile.predictPositionAt(time + offset,this.dodgeDebugPoint_);
                  this.projectDebugPoint(this.dodgeDebugPoint_.x,this.dodgeDebugPoint_.y);
                  if(started) {
                     graphics.lineTo(this.dodgeDebugPoint_.x,this.dodgeDebugPoint_.y);
                  } else {
                     graphics.moveTo(this.dodgeDebugPoint_.x,this.dodgeDebugPoint_.y);
                     started = true;
                  }
               }
               rendered++;
            }
            pathsDrawn = rendered;
         }

         if(renderHitboxes) {
            var playerHitboxScale:Number = Number(Parameters.data.autoDodgePlayerHitbox);
            if(isNaN(playerHitboxScale) || playerHitboxScale < 0 || playerHitboxScale > 100) {
               playerHitboxScale = 92;
            }
            var playerHitboxHalfSize:Number = 0.5 * playerHitboxScale / 100;
            graphics.lineStyle(1,0xFFB347,0.68);
            rendered = 0;
            for(index = 0; index < count && rendered < 100; index++) {
               projectile = this.hostileProjectiles_[index];
               if(projectile == null || projectile.projProps == null ||
                     !projectile.isThreatTo(this.player_,time)) {
                  continue;
               }
               dx = projectile.x_ - this.player_.x_;
               dy = projectile.y_ - this.player_.y_;
               if(projectile.isLaser() ?
                     projectile.laserClearanceTo(this.player_.x_,this.player_.y_) > 18 :
                     dx * dx + dy * dy > 324) {
                  continue;
               }
                // Draw the exact CollisionMult box around each projectile. This
                // is equivalent to the target-centered getHit comparison and
                // remains accurate for small/large modern projectile hitboxes.
                var projectileHalfSize:Number = projectile.collisionHalfSize();
                if(projectile.isLaser()) {
                   projectile.laserEnd(this.dodgeLaserEndPoint_);
                   var pixelsPerTile:Number = Math.sqrt(
                         this.dodgeDebugMatrix_[0] * this.dodgeDebugMatrix_[0] +
                         this.dodgeDebugMatrix_[1] * this.dodgeDebugMatrix_[1]);
                   graphics.lineStyle(Math.max(1,projectileHalfSize * 2 * pixelsPerTile),
                         0xFFB347,0.24);
                   this.projectDebugPoint(projectile.startX,projectile.startY);
                   graphics.moveTo(this.dodgeDebugPoint_.x,this.dodgeDebugPoint_.y);
                   this.projectDebugPoint(this.dodgeLaserEndPoint_.x,
                         this.dodgeLaserEndPoint_.y);
                   graphics.lineTo(this.dodgeDebugPoint_.x,this.dodgeDebugPoint_.y);
                   graphics.lineStyle(1,0xFFB347,0.68);
                   this.drawDebugBox(graphics,projectile.startX,projectile.startY,
                         projectileHalfSize);
                   this.drawDebugBox(graphics,this.dodgeLaserEndPoint_.x,
                         this.dodgeLaserEndPoint_.y,projectileHalfSize);
                } else if(projectileHalfSize > 0.02) {
                   this.drawDebugBox(graphics,projectile.x_,projectile.y_,
                         projectileHalfSize);
                } else {
                   this.drawDebugCircle(graphics,projectile.x_,projectile.y_,0.04,8);
                }
               rendered++;
            }
            hitboxesDrawn = rendered;
            graphics.lineStyle(2,0x45D9FF,0.9);
            this.drawDebugBox(graphics,this.player_.x_,this.player_.y_,playerHitboxHalfSize);
         }

         if(renderTarget && this.player_.getAutoDodgeDebugVelocity(this.dodgeDebugVelocity_)) {
            var targetX:Number = this.player_.x_ + this.dodgeDebugVelocity_.x * 100;
            var targetY:Number = this.player_.y_ + this.dodgeDebugVelocity_.y * 100;
            graphics.lineStyle(2,0x55FF88,0.9);
            this.projectDebugPoint(this.player_.x_,this.player_.y_);
            graphics.moveTo(this.dodgeDebugPoint_.x,this.dodgeDebugPoint_.y);
            this.projectDebugPoint(targetX,targetY);
            graphics.lineTo(this.dodgeDebugPoint_.x,this.dodgeDebugPoint_.y);
            this.drawDebugCircle(graphics,targetX,targetY,0.16,12);
            var targetHitboxScale:Number = Number(Parameters.data.autoDodgePlayerHitbox);
            if(isNaN(targetHitboxScale) || targetHitboxScale < 0 || targetHitboxScale > 100) {
               targetHitboxScale = 92;
            }
            this.drawDebugBox(graphics,targetX,targetY,0.5 * targetHitboxScale / 100);
         }

         if(renderAoe) {
            this.pruneRecentAoe(time);
            var telegraphCount:int = this.getTelegraphedAoeCount(time);
            graphics.lineStyle(2,0x66FFEE,0.9);
            for(var telegraphIndex:int = 0; telegraphIndex < telegraphCount;
                  telegraphIndex++) {
               this.drawDebugCircle(graphics,this.telegraphAoeX_[telegraphIndex],
                     this.telegraphAoeY_[telegraphIndex],
                     this.telegraphAoeRadius_[telegraphIndex],32);
            }
            var thrownCount:int = this.activeThrownProjectiles_.length;
            for(var thrownIndex:int = 0; thrownIndex < thrownCount; thrownIndex++) {
               var thrown:ThrownProjectile = this.activeThrownProjectiles_[thrownIndex];
               if(thrown != null && thrown.end_ != null) {
                  var confirmedThrow:Boolean = this.isThrownAoeConfirmed(thrown);
                  graphics.lineStyle(confirmedThrow ? 2 : 1,
                        confirmedThrow ? 0xFF55DD : 0xFFCC55,
                        confirmedThrow ? 0.85 : 0.55);
                  // Unconfirmed visual throws remain visible for diagnosis but
                  // are dots, not misleading bomb-radius circles.
                  this.drawDebugCircle(graphics,thrown.end_.x,thrown.end_.y,
                        confirmedThrow ? this.getThrownAoeRadius(thrown) : 0.18,20);
               }
            }
            var movingEmitterCount:int = this.activeMovingAoeEmitters_.length;
            for(var movingEmitterIndex:int = 0; movingEmitterIndex <
                  movingEmitterCount; movingEmitterIndex++) {
               var movingEmitter:MovingAoeEmitter =
                     this.activeMovingAoeEmitters_[movingEmitterIndex];
               if(movingEmitter == null || movingEmitter.object_ == null ||
                     !movingEmitter.isActive(time)) {
                  continue;
               }
               var emitterImpactOffset:int = movingEmitter.impactOffset(time);
               var emitterX:Number = movingEmitter.predictedX(emitterImpactOffset);
               var emitterY:Number = movingEmitter.predictedY(emitterImpactOffset);
               graphics.lineStyle(2,movingEmitter.confirmed_ ? 0xFF3344 :
                     0xFFAA33,movingEmitter.confirmed_ ? 0.9 : 0.75);
               this.drawDebugCircle(graphics,emitterX,emitterY,
                     movingEmitter.radius_,32);
               // Mark the actual invisible/moving object separately from its
               // predicted pulse position so bad velocity estimates are visible.
               this.drawDebugCircle(graphics,movingEmitter.object_.x_,
                     movingEmitter.object_.y_,0.14,10);
            }
            graphics.lineStyle(2,0xFF55DD,0.85);
            index = this.dodgeAoeUntil_.length - 1;
            while(index >= 0) {
               this.drawDebugCircle(graphics,this.dodgeAoeX_[index],this.dodgeAoeY_[index],
                     this.dodgeAoeRadius_[index],32);
               index--;
            }
         }
         if(profileRender) {
            this.recordDodgeRenderTelemetry(time,getTimer() - renderStart,pathsDrawn,hitboxesDrawn);
         }
      }

      private function recordDodgeRenderTelemetry(time:int, elapsed:int,
                                                  paths:int, hitboxes:int) : void {
         this.dodgeRenderFrames_++;
         this.dodgeRenderTotalMs_ += elapsed;
         this.dodgeRenderPaths_ += paths;
         this.dodgeRenderHitboxes_ += hitboxes;
         if(elapsed > this.dodgeRenderMaxMs_) {
            this.dodgeRenderMaxMs_ = elapsed;
         }
         if(time - this.dodgeRenderLogTime_ < 1000) {
            return;
         }
         DebugLog.event("auto_dodge_render",{
            "frames":this.dodgeRenderFrames_,
            "averageMs":this.dodgeRenderFrames_ > 0 ?
                  this.dodgeRenderTotalMs_ / this.dodgeRenderFrames_ : 0,
            "maxMs":this.dodgeRenderMaxMs_,
            "paths":this.dodgeRenderPaths_,
            "hitboxes":this.dodgeRenderHitboxes_,
            "activeThrown":this.activeThrownProjectiles_.length,
            "activeTelegraphs":this.telegraphAoeUntil_.length,
            "activeMovingEmitters":this.activeMovingAoeEmitters_.length
         });
         this.dodgeRenderLogTime_ = time;
         this.dodgeRenderFrames_ = 0;
         this.dodgeRenderTotalMs_ = 0;
         this.dodgeRenderMaxMs_ = 0;
         this.dodgeRenderPaths_ = 0;
         this.dodgeRenderHitboxes_ = 0;
      }

      private function drawProjectileLasers(graphics:Graphics, time:int) : void {
         if(!Parameters.drawProj_ || graphics == null || this.player_ == null ||
               this.hostileProjectiles_ == null) {
            return;
         }
         var count:int = this.hostileProjectiles_.length;
         for(var index:int = 0; index < count; index++) {
            var projectile:Projectile = this.hostileProjectiles_[index];
            if(projectile == null || projectile.projProps == null ||
                  !projectile.isLaser() || !projectile.isAliveAt(time) ||
                  projectile.laserClearanceTo(this.player_.x_,this.player_.y_) > 24) {
               continue;
            }
            projectile.laserEnd(this.dodgeLaserEndPoint_);
            this.projectDebugPoint(projectile.startX,projectile.startY);
            var startScreenX:Number = this.dodgeDebugPoint_.x;
            var startScreenY:Number = this.dodgeDebugPoint_.y;
            this.projectDebugPoint(this.dodgeLaserEndPoint_.x,this.dodgeLaserEndPoint_.y);
            var endScreenX:Number = this.dodgeDebugPoint_.x;
            var endScreenY:Number = this.dodgeDebugPoint_.y;
            var visualSize:Number = projectile.projProps.size_ >= 0 ?
                  projectile.projProps.size_ : 100;
            var outerWidth:Number = Math.max(2,Math.min(10,visualSize * 0.045));
            var color:uint = projectile.projProps.glowColor_;
            var damaging:Boolean = projectile.damage_ > 0 ||
                  projectile.projProps.effects_ != null;
            graphics.lineStyle(outerWidth,color,damaging ? 0.55 : 0.28);
            graphics.moveTo(startScreenX,startScreenY);
            graphics.lineTo(endScreenX,endScreenY);
            graphics.lineStyle(Math.max(1,outerWidth * 0.34),0xFFFFFF,
                  damaging ? 0.88 : 0.48);
            graphics.moveTo(startScreenX,startScreenY);
            graphics.lineTo(endScreenX,endScreenY);
         }
      }

      private function projectDebugPoint(worldX:Number, worldY:Number) : void {
         var matrix:Vector.<Number> = this.dodgeDebugMatrix_;
         var relativeX:Number = worldX - this.dodgeDebugOriginWorldX_;
         var relativeY:Number = worldY - this.dodgeDebugOriginWorldY_;
         this.dodgeDebugPoint_.x = this.dodgeDebugOriginScreenX_ +
               relativeX * matrix[0] + relativeY * matrix[4];
         this.dodgeDebugPoint_.y = this.dodgeDebugOriginScreenY_ +
               relativeX * matrix[1] + relativeY * matrix[5];
      }

      private function drawDebugBox(graphics:Graphics, x:Number, y:Number, halfSize:Number) : void {
         this.projectDebugPoint(x - halfSize,y - halfSize);
         graphics.moveTo(this.dodgeDebugPoint_.x,this.dodgeDebugPoint_.y);
         this.projectDebugPoint(x + halfSize,y - halfSize);
         graphics.lineTo(this.dodgeDebugPoint_.x,this.dodgeDebugPoint_.y);
         this.projectDebugPoint(x + halfSize,y + halfSize);
         graphics.lineTo(this.dodgeDebugPoint_.x,this.dodgeDebugPoint_.y);
         this.projectDebugPoint(x - halfSize,y + halfSize);
         graphics.lineTo(this.dodgeDebugPoint_.x,this.dodgeDebugPoint_.y);
         this.projectDebugPoint(x - halfSize,y - halfSize);
         graphics.lineTo(this.dodgeDebugPoint_.x,this.dodgeDebugPoint_.y);
      }

      private function drawDebugCircle(graphics:Graphics, x:Number, y:Number,
                                       radius:Number, segments:int) : void {
         for(var segment:int = 0; segment <= segments; segment++) {
            var angle:Number = segment * Math.PI * 2 / segments;
            this.projectDebugPoint(x + Math.cos(angle) * radius,y + Math.sin(angle) * radius);
            if(segment == 0) {
               graphics.moveTo(this.dodgeDebugPoint_.x,this.dodgeDebugPoint_.y);
            } else {
               graphics.lineTo(this.dodgeDebugPoint_.x,this.dodgeDebugPoint_.y);
            }
         }
      }
      
      public function internalAddObj(obj:BasicObject) : void {
         if(obj == null || goDict_ == null || boDict_ == null) {
            return;
         }
         if(!obj.addTo(this,obj.x_,obj.y_)) {
            return;
         }
         var dict:Dictionary = obj is GameObject?goDict_:boDict_;
         if(dict[obj.objectId_] != null) {
            if(!isPetYard) {
               return;
            }
            if(dict[obj.objectId_] is GameObject) {
               this.unregisterUpdateGameObject(dict[obj.objectId_] as GameObject);
               this.unregisterInteractiveObject(dict[obj.objectId_] as GameObject);
               this.unregisterMoonlightLantern(dict[obj.objectId_] as GameObject);
            }
            // The overwrite below drops the dict entry; without this the OLD
            // object would stay on the draw list forever (drawn but unowned).
            this.unregisterDrawObject(dict[obj.objectId_] as BasicObject);
         }
         if(name_ == "Oryx\'s Chamber" && this.oryxObjectId == 0) {
            if(obj is Character && (obj as Character).getName() == "Oryx the Mad God") {
               this.oryxObjectId = obj.objectId_;
            }
         }
         dict[obj.objectId_] = obj;
         this.registerDrawObject(obj);
         // Keep shooter type knowledge for the whole map. ENEMYSHOOT can arrive
         // long after an off-screen owner was removed; object ids are map-scoped
         // and a reused id is safely overwritten here.
         if(obj is GameObject) {
            this.recentObjectType_[obj.objectId_] = (obj as GameObject).objectType_;
            this.registerUpdateGameObject(obj as GameObject);
            this.registerInteractiveObject(obj as GameObject);
            this.registerMoonlightLantern(obj as GameObject);
            this.registerMovingAoeEmitter(obj as GameObject);
         }
         if(obj is Projectile && (obj as Projectile).damagesPlayers_) {
            this.registerHostileProjectile(obj as Projectile);
         }
         if(obj is ThrownProjectile) {
            this.registerThrownProjectile(obj as ThrownProjectile);
         }
      }

      public function internalRemoveObj(objectId:int) : void {
         if(goDict_ == null || boDict_ == null) {
            return;
         }
         var dict:Dictionary = goDict_;
         var obj:BasicObject = dict[objectId];
         if(obj == null) {
            dict = boDict_;
            obj = dict[objectId];
            if(obj == null) {
               return;
            }
            delete boDict_[objectId];
         } else {
            delete goDict_[objectId];
         }
         this.unregisterDrawObject(obj);
         if(obj is GameObject) {
            this.recentObjectType_[objectId] = (obj as GameObject).objectType_;
            this.unregisterMovingAoeEmitter(obj as GameObject);
            this.unregisterUpdateGameObject(obj as GameObject);
            this.unregisterInteractiveObject(obj as GameObject);
            this.unregisterMoonlightLantern(obj as GameObject);
         }
         if(obj is Projectile) {
            this.unregisterHostileProjectile(obj as Projectile);
         }
         if(obj is ThrownProjectile) {
            this.unregisterThrownProjectile(obj as ThrownProjectile);
         }
         obj.removeFromMap();
         if(name_ == "Oryx\'s Chamber" && objectId == this.oryxObjectId) {
            StaticInjectorContext.getInjector().getInstance(RealmOryxSignal).dispatch();
         }
      }

      private function registerInteractiveObject(object:GameObject) : void {
         if(object == null || !(object is IInteractiveObject) ||
               this.interactiveObjectIndices_[object.objectId_] !== undefined) {
            return;
         }
         this.interactiveObjectIndices_[object.objectId_] =
               this.interactiveObjects_.length;
         this.interactiveObjects_.push(object);
      }

      private function unregisterInteractiveObject(object:GameObject) : void {
         if(object == null) {
            return;
         }
         var stored:* = this.interactiveObjectIndices_[object.objectId_];
         if(stored === undefined) {
            return;
         }
         var index:int = int(stored);
         var lastIndex:int = this.interactiveObjects_.length - 1;
         if(index < 0 || index > lastIndex ||
               this.interactiveObjects_[index] != object) {
            delete this.interactiveObjectIndices_[object.objectId_];
            return;
         }
         if(index != lastIndex) {
            var moved:GameObject = this.interactiveObjects_[lastIndex];
            this.interactiveObjects_[index] = moved;
            this.interactiveObjectIndices_[moved.objectId_] = index;
         }
         this.interactiveObjects_.pop();
         delete this.interactiveObjectIndices_[object.objectId_];
      }

      private function registerMoonlightLantern(object:GameObject) : void {
         if(object == null || !isMoonlightLanternType(object.objectType_) ||
               this.moonlightLanternIndices_[object.objectId_] !== undefined) {
            return;
         }
         this.moonlightLanternIndices_[object.objectId_] =
               this.moonlightLanterns_.length;
         this.moonlightLanterns_.push(object);
      }

      private function unregisterMoonlightLantern(object:GameObject) : void {
         if(object == null) {
            return;
         }
         var stored:* = this.moonlightLanternIndices_[object.objectId_];
         if(stored === undefined) {
            return;
         }
         var index:int = int(stored);
         var lastIndex:int = this.moonlightLanterns_.length - 1;
         if(index < 0 || index > lastIndex ||
               this.moonlightLanterns_[index] != object) {
            delete this.moonlightLanternIndices_[object.objectId_];
            return;
         }
         if(index != lastIndex) {
            var moved:GameObject = this.moonlightLanterns_[lastIndex];
            this.moonlightLanterns_[index] = moved;
            this.moonlightLanternIndices_[moved.objectId_] = index;
         }
         this.moonlightLanterns_.pop();
         delete this.moonlightLanternIndices_[object.objectId_];
      }

      /** Nearest live, visible encounter lantern in Moonlight Village. */
      public function getMoonlightLanternTarget(x:Number, y:Number) : GameObject {
         if(this.name_ != MOONLIGHT_VILLAGE || this.goDict_ == null) {
            return null;
         }
         var closest:GameObject = null;
         var closestDistanceSq:Number = Number.POSITIVE_INFINITY;
         for(var index:int = 0; index < this.moonlightLanterns_.length; index++) {
            var lantern:GameObject = this.moonlightLanterns_[index];
            if(lantern == null || lantern.dead_ ||
                  this.goDict_[lantern.objectId_] != lantern) {
               continue;
            }
            var dx:Number = lantern.x_ - x;
            var dy:Number = lantern.y_ - y;
            var distanceSq:Number = dx * dx + dy * dy;
            if(distanceSq < closestDistanceSq) {
               closest = lantern;
               closestDistanceSq = distanceSq;
            }
         }
         return closest;
      }

      private static function isMoonlightLanternType(objectType:int) : Boolean {
         return objectType == MV_LANTERN_SYSTEM ||
               objectType == MV_TUTORIAL_LANTERN ||
               objectType == MV_EVENT_LANTERN;
      }

      private function registerUpdateGameObject(object:GameObject) : void {
         if(object == null || object.mapUpdateListIndex_ >= 0 ||
               object.props_ == null) {
            return;
         }
         // Base GameObject.update only interpolates movement and while-moving
         // height. Truly static scenery does neither. Merchant is the sole
         // static GameObject subclass with its own time-dependent update.
         if(object.props_.static_ && !object.props_.isEnemy_ &&
               object.props_.whileMoving_ == null && !(object is Merchant)) {
            return;
         }
         object.mapUpdateListIndex_ = this.updateGameObjects_.length;
         this.updateGameObjects_.push(object);
      }

      private function unregisterUpdateGameObject(object:GameObject) : void {
         if(object == null || this.updateGameObjects_ == null) {
            return;
         }
         var index:int = object.mapUpdateListIndex_;
         var lastIndex:int = this.updateGameObjects_.length - 1;
         if(index < 0 || index > lastIndex || this.updateGameObjects_[index] != object) {
            object.mapUpdateListIndex_ = -1;
            return;
         }
         if(index != lastIndex) {
            var moved:GameObject = this.updateGameObjects_[lastIndex];
            this.updateGameObjects_[index] = moved;
            moved.mapUpdateListIndex_ = index;
         }
         this.updateGameObjects_.pop();
         object.mapUpdateListIndex_ = -1;
      }

      /** Every object in goDict_/boDict_ is also on exactly one draw list. */
      private function registerDrawObject(obj:BasicObject) : void {
         if(obj == null || obj.mapDrawListIndex_ >= 0) {
            return;
         }
         if(obj is GameObject) {
            if(this.drawGameObjects_ == null) {
               return;
            }
            obj.mapDrawListIndex_ = this.drawGameObjects_.length;
            this.drawGameObjects_.push(obj as GameObject);
         } else {
            if(this.drawBasicObjects_ == null) {
               return;
            }
            obj.mapDrawListIndex_ = this.drawBasicObjects_.length;
            this.drawBasicObjects_.push(obj);
         }
      }

      private function unregisterDrawObject(obj:BasicObject) : void {
         if(obj == null) {
            return;
         }
         var list:* = obj is GameObject ? this.drawGameObjects_ : this.drawBasicObjects_;
         if(list == null) {
            obj.mapDrawListIndex_ = -1;
            return;
         }
         var index:int = obj.mapDrawListIndex_;
         var lastIndex:int = list.length - 1;
         if(index < 0 || index > lastIndex || list[index] != obj) {
            obj.mapDrawListIndex_ = -1;
            return;
         }
         if(index != lastIndex) {
            var moved:BasicObject = list[lastIndex];
            list[index] = moved;
            moved.mapDrawListIndex_ = index;
         }
         list.pop();
         obj.mapDrawListIndex_ = -1;
      }

      private function registerHostileProjectile(projectile:Projectile) : void {
         if(projectile.hostileListIndex_ >= 0) {
            return;
         }
         projectile.hostileListIndex_ = this.hostileProjectiles_.length;
         this.hostileProjectiles_.push(projectile);
      }

      private function unregisterHostileProjectile(projectile:Projectile) : void {
         var index:int = projectile.hostileListIndex_;
         var lastIndex:int = this.hostileProjectiles_.length - 1;
         if(index < 0 || index > lastIndex || this.hostileProjectiles_[index] != projectile) {
            // An exceptional index desynchronisation must not leave a pooled
            // projectile in the hot list. Once FreeList clears/reuses it, the
            // stale entry causes debug-render #1009 loops and phantom threats.
            // Pay the O(n) search only on this already exceptional path.
            index = this.hostileProjectiles_.indexOf(projectile);
            if(index < 0) {
               projectile.hostileListIndex_ = -1;
               return;
            }
            lastIndex = this.hostileProjectiles_.length - 1;
         }
         this.rememberRemovedHostileProjectile(projectile);
         if(index != lastIndex) {
            var moved:Projectile = this.hostileProjectiles_[lastIndex];
            this.hostileProjectiles_[index] = moved;
            moved.hostileListIndex_ = index;
         }
         this.hostileProjectiles_.pop();
         projectile.hostileListIndex_ = -1;
      }

      private function rememberRemovedHostileProjectile(projectile:Projectile) : void {
         if(projectile == null || !projectile.damagesPlayers_ || gs_ == null ||
               !Parameters.data.hpDebugLog) {
            return;
         }
         var removedAt:int = gs_.lastUpdate_;
         var segmentEnd:int = Math.min(removedAt,int(projectile.startTime_ + projectile.lifetime));
         var segmentStart:int = Math.max(projectile.startTime_,segmentEnd - 300);
         if(segmentEnd < segmentStart || !projectile.isAliveAt(segmentStart)) {
            return;
         }
         if(projectile.isLaser()) {
            this.recentProjectileStartPoint_.setTo(projectile.startX,projectile.startY);
            projectile.laserEnd(this.recentProjectileEndPoint_);
         } else {
            projectile.predictPositionAt(segmentStart,this.recentProjectileStartPoint_);
            projectile.predictPositionAt(segmentEnd,this.recentProjectileEndPoint_);
         }
         this.recentProjectileOwner_.push(projectile.ownerId_);
         this.recentProjectileBullet_.push(projectile.bulletId_);
         this.recentProjectileType_.push(projectile.containerType_);
         this.recentProjectileBulletType_.push(projectile.bulletType_);
         this.recentProjectileDamage_.push(projectile.damage_);
         this.recentProjectileArmorPiercing_.push(projectile.projProps != null &&
               projectile.projProps.armorPiercing_);
         this.recentProjectileLaser_.push(projectile.isLaser());
         this.recentProjectileRemovedAt_.push(removedAt);
         this.recentProjectileStartAt_.push(segmentStart);
         this.recentProjectileStartX_.push(this.recentProjectileStartPoint_.x);
         this.recentProjectileStartY_.push(this.recentProjectileStartPoint_.y);
         this.recentProjectileEndX_.push(this.recentProjectileEndPoint_.x);
         this.recentProjectileEndY_.push(this.recentProjectileEndPoint_.y);
         this.pruneRecentProjectileTraces(removedAt);
      }

      private function pruneRecentProjectileTraces(now:int) : void {
         var length:int = this.recentProjectileRemovedAt_.length;
         while(this.recentProjectileHead_ < length &&
               (length - this.recentProjectileHead_ > MAX_RECENT_PROJECTILE_TRACES ||
                now - this.recentProjectileRemovedAt_[this.recentProjectileHead_] >
                RECENT_PROJECTILE_TRACE_MS)) {
            this.recentProjectileHead_++;
         }
         // Vector.shift() copies every surviving element. The old implementation
         // did that on thirteen parallel vectors for every projectile removed,
         // creating an O(projectiles * history) burst exactly when combat was
         // densest. Advance a logical head instead and compact occasionally.
         if(this.recentProjectileHead_ >= RECENT_PROJECTILE_COMPACT_HEAD &&
               this.recentProjectileHead_ * 2 >= length) {
            this.compactRecentProjectileTraces();
         }
      }

      private function compactRecentProjectileTraces() : void {
         var removeCount:int = this.recentProjectileHead_;
         if(removeCount <= 0) {
            return;
         }
         this.recentProjectileOwner_.splice(0,removeCount);
         this.recentProjectileBullet_.splice(0,removeCount);
         this.recentProjectileType_.splice(0,removeCount);
         this.recentProjectileBulletType_.splice(0,removeCount);
         this.recentProjectileDamage_.splice(0,removeCount);
         this.recentProjectileArmorPiercing_.splice(0,removeCount);
         this.recentProjectileLaser_.splice(0,removeCount);
         this.recentProjectileRemovedAt_.splice(0,removeCount);
         this.recentProjectileStartAt_.splice(0,removeCount);
         this.recentProjectileStartX_.splice(0,removeCount);
         this.recentProjectileStartY_.splice(0,removeCount);
         this.recentProjectileEndX_.splice(0,removeCount);
         this.recentProjectileEndY_.splice(0,removeCount);
         this.recentProjectileHead_ = 0;
      }

      private function clearRecentProjectileTraces() : void {
         this.recentProjectileOwner_.length = 0;
         this.recentProjectileBullet_.length = 0;
         this.recentProjectileType_.length = 0;
         this.recentProjectileBulletType_.length = 0;
         this.recentProjectileDamage_.length = 0;
         this.recentProjectileArmorPiercing_.length = 0;
         this.recentProjectileLaser_.length = 0;
         this.recentProjectileRemovedAt_.length = 0;
         this.recentProjectileStartAt_.length = 0;
         this.recentProjectileStartX_.length = 0;
         this.recentProjectileStartY_.length = 0;
         this.recentProjectileEndX_.length = 0;
         this.recentProjectileEndY_.length = 0;
         this.recentProjectileHead_ = 0;
      }

      public function getRecentProjectileCount(now:int) : int {
         this.pruneRecentProjectileTraces(now);
         return this.recentProjectileRemovedAt_.length - this.recentProjectileHead_;
      }

      public function getRecentProjectileOwner(index:int) : int { return this.recentProjectileOwner_[index + this.recentProjectileHead_]; }
      public function getRecentProjectileBullet(index:int) : int { return this.recentProjectileBullet_[index + this.recentProjectileHead_]; }
      public function getRecentProjectileType(index:int) : int { return this.recentProjectileType_[index + this.recentProjectileHead_]; }
      public function getRecentProjectileBulletType(index:int) : int { return this.recentProjectileBulletType_[index + this.recentProjectileHead_]; }
      public function getRecentProjectileDamage(index:int) : int { return this.recentProjectileDamage_[index + this.recentProjectileHead_]; }
      public function getRecentProjectileArmorPiercing(index:int) : Boolean { return this.recentProjectileArmorPiercing_[index + this.recentProjectileHead_]; }
      public function getRecentProjectileLaser(index:int) : Boolean { return this.recentProjectileLaser_[index + this.recentProjectileHead_]; }
      public function getRecentProjectileStartAt(index:int) : int { return this.recentProjectileStartAt_[index + this.recentProjectileHead_]; }
      public function getRecentProjectileRemovedAt(index:int) : int { return this.recentProjectileRemovedAt_[index + this.recentProjectileHead_]; }
      public function getRecentProjectileStartX(index:int) : Number { return this.recentProjectileStartX_[index + this.recentProjectileHead_]; }
      public function getRecentProjectileStartY(index:int) : Number { return this.recentProjectileStartY_[index + this.recentProjectileHead_]; }
      public function getRecentProjectileEndX(index:int) : Number { return this.recentProjectileEndX_[index + this.recentProjectileHead_]; }
      public function getRecentProjectileEndY(index:int) : Number { return this.recentProjectileEndY_[index + this.recentProjectileHead_]; }
      
      public function getSquare(x:Number, y:Number) : Square {
         if(x < 0 || x >= mapWidth || y < 0 || y >= mapHeight) {
            return null;
         }
         var index:int = int(x) + int(y) * mapWidth;
         var square:Square = squares[index];
         if(square == null) {
            square = new Square(this,int(x),int(y));
            squares[index] = square;
         }
         return square;
      }

      public function lookupSquare(x:int, y:int) : Square {
         if(x < 0 || x >= mapWidth || y < 0 || y >= mapHeight) {
            return null;
         }
         return squares[x + y * mapWidth];
      }

      /** Object type retained for this map's lifetime for late ENEMYSHOOT. */
      public function cacheObjectType(objectId:int, objectType:int) : void {
         if(objectId >= 0 && objectType >= 0) {
            this.recentObjectType_[objectId] = objectType;
         }
      }

      public function getRecentObjectType(objectId:int) : int {
         var objectType:* = this.recentObjectType_[objectId];
         return objectType === undefined ? -1 : int(objectType);
      }

      private static function isMovingAoeEmitterType(objectType:int) : Boolean {
         switch(objectType) {
            case O2_BOMB_ARTIFACT:
            case O2_BOMB_ARTIFACT_2:
            case O3_BOMB_ARTIFACT_H:
            case O3_BOMB_ARTIFACT_1:
            case O3_BOMB_ARTIFACT_2:
            case O3_BOMB_ARTIFACT:
            case O3_ORYX_PORTAL:
            case O3_PORTAL_OFFENSIVE:
            case BANESERPENT_IMPACT_TELEGRAPH:
            case BONE_TOWER_2:
            case BONE_TOWER_3:
            case HUDL_CONSTRUCT_COLOSSUS:
            case MAMMOTH_CITY_RAT_BOULDER:
            case SMALL_KOGBOLD_3:
            case KSW_CRUSHER:
            case KSW_STEMWALKER_HARD:
               return true;
            default:
               return false;
         }
      }

      /** Track source-specific live objects whose AOE geometry is present in
       * authoritative packet history. Ordinary enemies remain radius zero until
       * their first pulse confirms the active attack, so merely approaching an
       * enemy sprite never creates an invented hazard. */
      private function registerMovingAoeEmitter(object:GameObject) : void {
         if(object == null || !isMovingAoeEmitterType(object.objectType_) ||
               this.movingAoeEmitterIndices_[object.objectId_] !== undefined) {
            return;
         }
         var radius:Number = 0;
         var damage:int = -1;
         var armorPiercing:Boolean = false;
         var effect:int = 0;
         var effectDuration:Number = 0;
         var interval:int = 610;
         var silenceTimeout:int = 1800;
         switch(object.objectType_) {
            case O2_BOMB_ARTIFACT:
            case O2_BOMB_ARTIFACT_2:
               radius = 2.8;
               damage = 180;
               interval = 410;
               silenceTimeout = 1500;
               break;
            case O3_BOMB_ARTIFACT_1:
            case O3_BOMB_ARTIFACT_2:
               radius = 2;
               damage = 200;
               break;
            case O3_BOMB_ARTIFACT:
               radius = 1.75;
               damage = 150;
               break;
            case O3_BOMB_ARTIFACT_H:
               // 144 historical packets: radius 1.75, raw damage 210, roughly
               // 410ms between expanding pulse groups.
               radius = 1.75;
               damage = 210;
               interval = 410;
               silenceTimeout = 1200;
               break;
            case BANESERPENT_IMPACT_TELEGRAPH:
               radius = 1.75;
               damage = 170;
               interval = 410;
               silenceTimeout = 1200;
               break;
            case MAMMOTH_CITY_RAT_BOULDER:
               radius = 1.5;
               damage = 50;
               armorPiercing = true;
               effect = 16;
               effectDuration = 2;
               interval = 410;
               silenceTimeout = 1200;
               break;
            case O3_ORYX_PORTAL:
            case O3_PORTAL_OFFENSIVE:
               interval = 200;
               silenceTimeout = 1000;
               break;
            case BONE_TOWER_2:
            case BONE_TOWER_3:
               interval = 1220;
               silenceTimeout = 3000;
               break;
            case HUDL_CONSTRUCT_COLOSSUS:
               interval = 1010;
               silenceTimeout = 2500;
               break;
            case SMALL_KOGBOLD_3:
               interval = 200;
               silenceTimeout = 800;
               break;
            case KSW_STEMWALKER_HARD:
               interval = 200;
               silenceTimeout = 2000;
               break;
            case KSW_CRUSHER:
               interval = 3000;
               silenceTimeout = 5000;
               break;
         }
         var emitter:MovingAoeEmitter = new MovingAoeEmitter(object,radius,
               damage,armorPiercing,effect,effectDuration,interval,
               silenceTimeout);
         // Both O3 portal variants can emit a point-blank volley before the
         // first projectile is visible. This is a deliberately small,
         // source-specific launch guard—not generic enemy-body avoidance.
         if(object.objectType_ == O3_ORYX_PORTAL) {
            emitter.projectileGuardRadius_ = 1.10;
            emitter.projectileGuardDamage_ = 225;
            emitter.projectileGuardShots_ = 3;
         } else if(object.objectType_ == O3_PORTAL_OFFENSIVE) {
            emitter.projectileGuardRadius_ = 1.10;
            emitter.projectileGuardDamage_ = 200;
            emitter.projectileGuardShots_ = 1;
         }
         this.movingAoeEmitterIndices_[object.objectId_] =
               this.activeMovingAoeEmitters_.length;
         this.activeMovingAoeEmitters_.push(emitter);
         if(Parameters.data.autoDodgeDebug) {
            DebugLog.event("auto_dodge_moving_aoe_spawn",{
                  "objectId":object.objectId_,"sourceType":object.objectType_,
                  "x":object.x_,"y":object.y_,"radius":radius,
                  "damage":damage,"intervalMs":interval,
                  "silenceTimeoutMs":silenceTimeout,
                  "preImpactActive":radius > 0,"map":name_});
         }
      }

      private function unregisterMovingAoeEmitter(object:GameObject) : void {
         if(object == null) {
            return;
         }
         var stored:* = this.movingAoeEmitterIndices_[object.objectId_];
         if(stored === undefined) {
            return;
         }
         var index:int = int(stored);
         var removed:MovingAoeEmitter = this.activeMovingAoeEmitters_[index];
         delete this.movingAoeEmitterIndices_[object.objectId_];
         var retiredAt:int = gs_ != null ? gs_.lastUpdate_ : getTimer();
         removed.retire(retiredAt);
         if(Parameters.data.autoDodgeDebug) {
            DebugLog.event("auto_dodge_moving_aoe_removed",{
                  "objectId":object.objectId_,"sourceType":object.objectType_,
                  "confirmed":removed.confirmed_,"pulses":removed.pulseCount_,
                  "intervalMs":removed.interval_,"map":name_});
         }
      }

      /** Keep a removed source briefly because its final AOE packet can trail
       * the object deletion by several hundred milliseconds. */
      private function refreshMovingAoeEmitters(time:int) : void {
         for(var index:int = this.activeMovingAoeEmitters_.length - 1;
               index >= 0; index--) {
            var emitter:MovingAoeEmitter = this.activeMovingAoeEmitters_[index];
            if(emitter != null && emitter.isRetained(time)) {
               emitter.capturePosition(time);
               continue;
            }
            var lastIndex:int = this.activeMovingAoeEmitters_.length - 1;
            if(index != lastIndex) {
               var moved:MovingAoeEmitter =
                     this.activeMovingAoeEmitters_[lastIndex];
               this.activeMovingAoeEmitters_[index] = moved;
               if(moved.object_ != null &&
                     this.movingAoeEmitterIndices_[moved.objectId] !== undefined) {
                  this.movingAoeEmitterIndices_[moved.objectId] = index;
               }
            }
            this.activeMovingAoeEmitters_.pop();
         }
      }

      /** Associate an origin-type AOE with the nearest retained trajectory. */
      private function recordMovingAoeEmitterImpact(x:Number, y:Number,
                                                    radius:Number, time:int,
                                                    damage:int,
                                                    armorPiercing:Boolean,
                                                    effect:int,
                                                    effectDuration:Number,
                                                    originType:int) : MovingAoeEmitter {
         if(!isMovingAoeEmitterType(originType)) {
            return null;
         }
         var best:MovingAoeEmitter = null;
         var bestDistanceSq:Number = MOVING_AOE_MATCH_DISTANCE_SQ;
         var count:int = this.activeMovingAoeEmitters_.length;
         for(var index:int = 0; index < count; index++) {
            var emitter:MovingAoeEmitter = this.activeMovingAoeEmitters_[index];
            if(emitter == null || !emitter.isRetained(time) ||
                  emitter.objectType != originType) {
               continue;
            }
            var distanceSq:Number = emitter.distanceSqToTrajectory(x,y,time);
            if(distanceSq <= bestDistanceSq) {
               bestDistanceSq = distanceSq;
               best = emitter;
            }
         }
         if(best == null) {
            return null;
         }
         best.recordImpact(time,radius,damage,armorPiercing,effect,effectDuration,
               movingAoeNextInterval(originType,damage));
         if(Parameters.data.autoDodgeDebug) {
            DebugLog.event("auto_dodge_moving_aoe_pulse",{
                  "objectId":best.objectId,"sourceType":originType,
                  "x":x,"y":y,"radius":radius,"damage":damage,
                  "matchDistance":Math.sqrt(bestDistanceSq),
                  "retiredSource":best.retired,
                  "intervalMs":best.interval_,"pulse":best.pulseCount_,
                  "nextImpact":best.nextImpact_,"map":name_});
         }
         return best;
      }

      /** The next stage of these proven attacks is more useful than an average
       * of unrelated prior stages (notably Stemwalker's travelling core followed
       * by 2/3/4-tile expansions). */
      private static function movingAoeNextInterval(originType:int,
                                                    damage:int) : int {
         switch(originType) {
            case O2_BOMB_ARTIFACT:
            case O2_BOMB_ARTIFACT_2:
            case O3_BOMB_ARTIFACT_H:
            case BANESERPENT_IMPACT_TELEGRAPH:
            case MAMMOTH_CITY_RAT_BOULDER:
               return 410;
            case O3_BOMB_ARTIFACT_1:
            case O3_BOMB_ARTIFACT_2:
            case O3_BOMB_ARTIFACT:
               return 610;
            case O3_ORYX_PORTAL:
            case O3_PORTAL_OFFENSIVE:
            case SMALL_KOGBOLD_3:
               return 200;
            case BONE_TOWER_2:
            case BONE_TOWER_3:
               return 1220;
            case HUDL_CONSTRUCT_COLOSSUS:
               return 1010;
            case KSW_CRUSHER:
               return 3000;
            case KSW_STEMWALKER_HARD:
               if(damage == 120) {
                  return 400;
               }
               if(damage >= 150) {
                  return 800;
               }
               return 200;
            default:
               return 0;
         }
      }

      private function registerThrownProjectile(thrown:ThrownProjectile) : void {
         if(thrown.dodgeListIndex_ >= 0) {
            return;
         }
         thrown.dodgeListIndex_ = this.activeThrownProjectiles_.length;
         this.activeThrownProjectiles_.push(thrown);
         if(Parameters.data.autoDodgeDebug && thrown.end_ != null) {
            var confirmed:Boolean = this.isThrownAoeConfirmed(thrown);
            DebugLog.event("auto_dodge_throw_seen",{
               "showEffectType":thrown.showEffectType_,
               "effectType":thrown.effectType_,"sourceType":thrown.sourceType_,
               "lifetime":thrown.lifetime_,"x":thrown.end_.x,"y":thrown.end_.y,
               "rawImpactMs":thrown.dodgeLandingOffset(),
               "timingLeadMs":this.getThrownAoeTimingLead(thrown),
               "correctedImpactMs":this.getThrownAoeLandingOffset(thrown),
               "startX":thrown.start_ != null ? thrown.start_.x : 0,
               "startY":thrown.start_ != null ? thrown.start_.y : 0,
               "confirmed":confirmed,
               "radius":confirmed ? this.getThrownAoeRadius(thrown) : -1,
               "damage":confirmed ? this.getThrownAoeDamage(thrown) : -1,
               "conditionEffect":confirmed ? this.getThrownAoeEffect(thrown) : 0,
               "active":this.activeThrownProjectiles_.length,"map":name_
            });
         }
      }

      private function unregisterThrownProjectile(thrown:ThrownProjectile) : void {
         var index:int = thrown.dodgeListIndex_;
         var lastIndex:int = this.activeThrownProjectiles_.length - 1;
         if(index < 0 || index > lastIndex || this.activeThrownProjectiles_[index] != thrown) {
            thrown.dodgeListIndex_ = -1;
            return;
         }
         if(index != lastIndex) {
            var moved:ThrownProjectile = this.activeThrownProjectiles_[lastIndex];
            this.activeThrownProjectiles_[index] = moved;
            moved.dodgeListIndex_ = index;
         }
         this.activeThrownProjectiles_.pop();
         thrown.dodgeListIndex_ = -1;
      }

      /** Pure position check used by auto-dodge candidate simulation. */
      public function isDamagingGround(x:Number, y:Number) : Boolean {
         var square:Square = this.lookupSquare(int(x),int(y));
         return square != null && square.props_ != null && square.props_.maxDamage_ > 0 &&
               !(square.obj_ != null && square.obj_.props_ != null &&
               square.obj_.props_.protectFromGroundDamage_);
      }

      public function canOccupyForDodge(x:Number, y:Number, safeWalk:Boolean) : Boolean {
         if(Parameters.data.noClip) {
            return true;
         }
         var square:Square = this.lookupSquare(int(x),int(y));
         if(square == null || !square.isWalkable() || safeWalk &&
               this.isDamagingGround(x,y) &&
               (this.player_ == null || !this.isDamagingGround(this.player_.x_,this.player_.y_) ||
               square != this.player_.square)) {
            return false;
         }
         var fracX:Number = x - int(x);
         var fracY:Number = y - int(y);
         var hitboxPercent:Number = Number(Parameters.data.autoDodgePlayerHitbox);
         if(isNaN(hitboxPercent)) {
            hitboxPercent = 92;
         }
         hitboxPercent = Math.max(0,Math.min(100,hitboxPercent));
         var collisionHalfSize:Number = 0.5 * hitboxPercent / 100;
         var collisionUpperBound:Number = 1 - collisionHalfSize;
         var minX:int = fracX < collisionHalfSize ? int(x) - 1 : int(x);
         var maxX:int = fracX > collisionUpperBound ? int(x) + 1 : int(x);
         var minY:int = fracY < collisionHalfSize ? int(y) - 1 : int(y);
         var maxY:int = fracY > collisionUpperBound ? int(y) + 1 : int(y);
         for(var tileX:int = minX; tileX <= maxX; tileX++) {
            for(var tileY:int = minY; tileY <= maxY; tileY++) {
               if(tileX == int(x) && tileY == int(y)) {
                  continue;
               }
               var neighbor:Square = this.lookupSquare(tileX,tileY);
               if(neighbor == null || neighbor.tileType == 255 ||
                     neighbor.obj_ != null && neighbor.obj_.props_ != null &&
                     neighbor.obj_.props_.fullOccupy_) {
                  return false;
               }
            }
         }
         return true;
      }

      /** Whether a predicted hostile projectile survives to this position.
       * Mirrors the authoritative flight in Projectile.update: a shot dies
       * outside the map bounds or on a blocking cover object -- never on an
       * undiscovered tile. The old lookupSquare-null => closed treated the
       * unexplored edge as a wall (and its tileType==65535 sentinel was dead:
       * a Square's no-ground value is 255), so real threats crossing unseen
       * tiles were silently dropped from the dodge model. */
      public function isProjectilePathOpen(x:Number, y:Number, projectile:Projectile) : Boolean {
         if(x < 0 || x >= mapWidth || y < 0 || y >= mapHeight) {
            return false;
         }
         var square:Square = this.lookupSquare(int(x),int(y));
         if(square == null || square.obj_ == null) {
            return true;
         }
         var props:ObjectProperties = square.obj_.props_;
         return !(props.enemyOccupySquare_ || !projectile.projProps.passesCover_ && props.occupySquare_);
      }

      /** Sample a projectile segment densely enough that fast shots cannot skip cover. */
      public function isProjectileSegmentOpen(fromX:Number, fromY:Number, toX:Number, toY:Number,
                                              projectile:Projectile) : Boolean {
         var dx:Number = toX - fromX;
         var dy:Number = toY - fromY;
         var steps:int = Math.ceil(Math.max(Math.abs(dx),Math.abs(dy)) / 0.25);
         if(steps < 1) {
            return this.isProjectilePathOpen(toX,toY,projectile);
         }
         for(var step:int = 1; step <= steps; step++) {
            var ratio:Number = step / steps;
            if(!this.isProjectilePathOpen(fromX + dx * ratio,fromY + dy * ratio,projectile)) {
               return false;
            }
         }
         return true;
      }
      
      private function forceSoftwareRenderCheck(mapName:String) : void {
         forceSoftwareRender = this.forceSoftwareMap[mapName] != null || Main.STAGE != null && Main.STAGE.stage3Ds[0].context3D == null;
      }

      private function getFilterIndex() : uint {
         var filterIndex:int = 0;
         // Low CPU: no drunk/blind post-process (each is an extra full-screen
         // render-to-texture + shader pass) — cheaper and clearer.
         if(Parameters.lowCPUMode) {
            return 0;
         }
         if(player_ != null && (player_.condition_[0] & 1049216) != 0) {
            if(player_.isBlind) {
               filterIndex = 2;
            } else if(player_.isDrunk) {
               filterIndex = 3;
            }
         }
         return filterIndex;
      }
   }
}
