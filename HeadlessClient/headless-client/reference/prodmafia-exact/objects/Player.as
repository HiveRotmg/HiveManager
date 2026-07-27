package com.company.assembleegameclient.objects {
   import com.company.assembleegameclient.map.Camera;
   import com.company.assembleegameclient.map.Map;
   import com.company.assembleegameclient.map.Square;
   import kabam.lib.net.impl.CrashLogger;
   import kabam.lib.net.impl.DebugLog;
   import com.company.assembleegameclient.map.mapoverlay.CharacterStatusText;
   import com.company.assembleegameclient.objects.particles.HealingEffect;
   import com.company.assembleegameclient.objects.particles.LevelUpEffect;
import com.company.assembleegameclient.parameters.Parameters;
   import com.company.assembleegameclient.sound.SoundEffectLibrary;
   import com.company.assembleegameclient.util.AnimatedChar;
   import com.company.assembleegameclient.util.ConditionEffect;
   import com.company.assembleegameclient.util.FameUtil;
   import com.company.assembleegameclient.util.FreeList;
   import com.company.assembleegameclient.util.MaskedImage;
   import com.company.assembleegameclient.util.PlayerUtil;
   import com.company.assembleegameclient.util.TextureRedrawer;
   import com.company.assembleegameclient.util.TimeUtil;
   import com.company.assembleegameclient.util.redrawers.GlowRedrawer;
   import com.company.rotmg.graphics.StarGraphic;
   import com.company.util.CachingColorTransformer;
   import com.company.util.ConversionUtil;
   import com.company.util.IntPoint;
   import com.company.util.MoreColorUtil;
   import com.company.util.MoreStringUtil;
   import com.company.util.PointUtil;
import com.company.util.Trig;

import flash.display.BitmapData;
   import flash.display.GraphicsBitmapFill;
   import flash.display.Sprite;
   import flash.filters.DropShadowFilter;
   import flash.geom.ColorTransform;
   import flash.geom.Matrix;
   import flash.geom.Point;
   import flash.geom.Vector3D;
   import flash.utils.Dictionary;
   import flash.utils.getTimer;

import io.decagames.rotmg.supportCampaign.data.SupporterCampaignModel;
   import kabam.rotmg.assets.services.CharacterFactory;
   import kabam.rotmg.chat.model.ChatMessage;
   import kabam.rotmg.core.StaticInjectorContext;
   import kabam.rotmg.game.model.UseBuyPotionVO;
   import kabam.rotmg.game.signals.AddTextLineSignal;
   import kabam.rotmg.messaging.impl.GameServerConnection;
   import kabam.rotmg.messaging.impl.incoming.Text;
   import kabam.rotmg.text.view.BitmapTextFactory;
   import org.osflash.signals.Signal;
   import org.swiftsuspenders.Injector;
   
   public class Player extends Character {

      public static const MS_BETWEEN_TELEPORT:int = 10000;

      public static const MS_REALM_TELEPORT:int = 120000;

      private static const MOVE_THRESHOLD:Number = 0.4;

      private static const NEARBY:Vector.<Point> = new <Point>[new Point(0,0),new Point(1,0),new Point(0,1),new Point(1,1)];

      public static var isAdmin:Boolean = false;

      public static var isMod:Boolean = false;

      private static var newP:Point = new Point();

      // One-shot guard so the null-tile-speed diagnostic logs only once.
      private static var warnedNullTileSpeed_:Boolean = false;

      // Player objects are reconstructed on every map, but backpack authority
      // belongs to the character/session. Preserve a server rejection across
      // those reconstructions so Auto Loot cannot resume probing hidden slots.
      private static const backpackAuthorityRejectedByChar_:Dictionary = new Dictionary();
      // charId -> <BackpackSlots> from /char/list. The account service is the
      // only authority on whether a character actually owns backpack capacity;
      // the in-game stat stream is not (see fromPlayerXML). Absent id = unknown.
      private static const backpackSlotsByChar_:Dictionary = new Dictionary();

      /** Declared backpack slots for a character, or -1 when /char/list has not
       * told us about that character yet. */
      public static function declaredBackpackSlots(charId:int) : int {
         if(charId > 0 && backpackSlotsByChar_[charId] !== undefined) {
            return int(backpackSlotsByChar_[charId]);
         }
         return -1;
      }

      // Local collision predictions are useful for reacting before the next
      // NEWTICK, but they are not authoritative. Keep them for a small number
      // of server ticks and discard any prediction the server never confirms.
      private static const PROJECTILE_DAMAGE_PREDICTION_MS:int = 600;
      private static const ENVIRONMENT_DAMAGE_PREDICTION_MS:int = 1200;
      private static const SERVER_POSITION_REBASE_MIN_DISTANCE:Number = 2.5;
      private static const MAX_PENDING_DAMAGE_PREDICTIONS:int = 64;
      private static const MOONLIGHT_LANTERN_STOP_DISTANCE:Number = 1.15;
      private static const MOONLIGHT_LANTERN_RESUME_DISTANCE:Number = 1.65;


      private const MIN_MOVE_SPEED:Number = 0.004;

      private const MAX_MOVE_SPEED:Number = 0.0096;

      private const DIF_MOVE_SPEED:Number = 0.0056;

      private const MIN_ATTACK_FREQ:Number = 0.0015;

      private const MAX_ATTACK_FREQ:Number = 0.008;

      private const DIF_ATTACK_FREQ:Number = 0.0065;

      private const MIN_ATTACK_MULT:Number = 0.5;

      private const MAX_ATTACK_MULT:Number = 2;

      private const DIF_ATTACK_MULT:Number = 1.5;

      private const DEFAULT_DROPSHADOW_FILTER:DropShadowFilter = new DropShadowFilter(0,0,0,0.5,6,6,1);

      private const lightBlueCT:ColorTransform = new ColorTransform(0.541176470588235,0.596078431372549,0.870588235294118);

      private const darkBlueCT:ColorTransform = new ColorTransform(0.192156862745098,0.301960784313725,0.858823529411765);

      private const redCT:ColorTransform = new ColorTransform(0.756862745098039,0.152941176470588,0.176470588235294);

      private const orangeCT:ColorTransform = new ColorTransform(0.968627450980392,0.576470588235294,0.117647058823529);

      private const yellowCT:ColorTransform = new ColorTransform(1,1,0);

      private const hpPotionVO:UseBuyPotionVO = new UseBuyPotionVO(2594,1000000);

      private const mpPotionVO:UseBuyPotionVO = new UseBuyPotionVO(2595,1000001);

      private const RANK_OFFSET_MATRIX:Matrix = new Matrix(1,0,0,1,2,4);

      private const NAME_OFFSET_MATRIX:Matrix = new Matrix(1,0,0,1,20,1);

      public var unlockedBlueprints:Vector.<int> = new <int>[];

      public var isWalking:Boolean = false;

      public var projectileLifeMult:Number = 1.0;

      public var projectileSpeedMult:Number = 1.0;

      public var className:String;

      public var xpTimer:int;

      public var skinId:int;

      public var skin:AnimatedChar;

      public var isShooting:Boolean;

      public var accountId_:String = "";

      public var forgefire:int = 0;
      public var credits_:int = 0;

      public var numStars_:int = 0;

      public var starsBg_:int = 0;

      public var fame_:int = 0;

      public var nameChosen_:Boolean = false;

      public var currFame_:int = -1;

      public var nextClassQuestFame_:int = -1;

      public var legendaryRank_:int = -1;

      public var guildName_:String = null;

      public var guildRank_:int = -1;

      public var isFellowGuild_:Boolean = false;

      public var breath_:int = -1;

      public var maxMP_:int = 200;

      public var mp_:Number = 0;

      public var nextLevelExp_:int = 1000;

      public var exp_:int = 0;

      public var attack_:int = 0;

      public var speed_:int = 0;

      public var dexterity_:int = 0;

      public var vitality_:int = 0;

      public var wisdom:int = 0;

      public var mpZeroed_:Boolean = false;

      public var maxHPBoost_:int = 0;

      public var maxMPBoost_:int = 0;

      public var attackBoost_:int = 0;

      public var defenseBoost_:int = 0;

      public var speedBoost_:int = 0;

      public var vitalityBoost_:int = 0;

      public var wisdomBoost_:int = 0;

      public var dexterityBoost_:int = 0;

      public var exaltedHealth:int = 0;

      public var exaltedMana:int = 0;

      public var exaltedAttack:int = 0;

      public var exaltedDefense:int = 0;

      public var exaltedSpeed:int = 0;

      public var exaltedVitality:int = 0;

      public var exaltedWisdom:int = 0;

      public var exaltedDexterity:int = 0;

      public var exaltationDamageMultiplier:Number = 100;

      public var xpBoost_:int = 0;

      public var healthPotionCount_:int = 0;

      public var magicPotionCount_:int = 0;

      public var attackMax_:int = 0;

      public var defenseMax_:int = 0;

      public var speedMax_:int = 0;

      public var dexterityMax_:int = 0;

      public var vitalityMax_:int = 0;

      public var wisdomMax_:int = 0;

      public var maxHPMax_:int = 0;

      public var maxMPMax_:int = 0;

      public var hasBackpack_:Boolean = false;
      /** Raw legacy stat 79. Modern seasonal characters can report this bit
       * without actually exposing backpack slots, so callers use the derived
       * hasBackpack_ value instead. */
      public var backpackFlag_:Boolean = false;
      public var backpackStatsSeen_:Boolean = false;
      private var backpackAuthorityRejected_:Boolean = false;
      private var backpackMaxSlotSeen_:int = 19;
      // Slots >= 20 (the expanded backpack range) exist only when the server
      // has actually proven them: a real item reported there, or a successful
      // inventory mutation touching them. The slot stats 131-146 cover slots
      // 12-27 and arrive as empty placeholders even without purchased expanded
      // slots, so stats-seen alone must never expose the range -- the 07-22..24
      // logs show 110 swap rejections at slots 20/21 that then revoked the
      // whole backpack and cost ~46% of all loot.
      private var expandedBackpackConfirmed_:Boolean = false;
      // Latches once the server rejects an auto-loot swap into slot 20+. Without
      // it, confirmBackpackAuthority re-set expandedBackpackConfirmed_=true on
      // the very next inventory update that showed an item in slot 20 -- so the
      // picker re-targeted 20/21, got rejected, and retried on a ~30s cadence
      // for the whole session (the audit saw 111 rejections at 20/21 over 2.7h).
      private var expandedBackpackRejected_:Boolean = false;

      /** True while an interactive object (enchanter, vault chest, portal...)
       * is within use range; set each frame by GameSprite. Idle comfort
       * movement must not fight the player standing at a station. */
      public var nearInteractiveObject_:Boolean = false;

      private var autoLootBackpackRejectCount_:int = 0;
      private var autoLootBackpackLastRejectedItem_:int = -1;
      private var autoLootBackpackLastRejectedSlot_:int = -1;
      private var autoLootBackpackLastRejectedAt_:int = 0;

      public var supporterFlag:int = 0;

      public var starred_:Boolean = false;

      public var ignored_:Boolean = false;

      public var distSqFromThisPlayer_:Number = 0;

      public var relMoveVec_:Point = null;

      // True only for a currently held physical movement key. Auto Play uses
      // setRelativeMovement(), so safety systems can distinguish real player
      // takeover from another automated controller's stale route.
      private var manualMovementInput_:Boolean = false;

      public var conMoveVec:Point = null;

      public var attackPeriod_:int = 0;

      public var nextAltAttack_:int = 0;

      public var nextTeleportAt_:int = 0;

      public var lastTpTime_:int = 0;

      public var dropBoost:int = 0;

      public var tierBoost:int = 0;

      public var isDefaultAnimatedChar:Boolean = true;

      public var projectileIdSetOverrideNew:String = "";

      public var projectileIdSetOverrideOld:String = "";

      public var addTextLine:AddTextLineSignal;

      public var fakeTex1:int = -1;

      public var fakeTex2:int = -1;

      public var followLanded:Boolean = false;

      public var hpLog:Number = 0;

      private var hpRegenDebugElapsed_:int = 0;
      private var hpRegenDebugAmount_:int = 0;

      // Local obstacle-steering side: -1 clockwise, +1 counter-clockwise.
      // Retained until the intended route is clear to prevent edge wobble.
      private var smoothWalkSide_:int = 0;
      private var smoothWalkActive_:Boolean = false;

      public var clientHp:int = 100;

      public var accountLevel_:int = 0;

      public var accountLevelXp_:int = 0;

      public var seasonal_:Boolean = false;

      public var expandedBackpackSlots_:int = 0;

      public var syncedChp:int;

      // Locally predicted positive HP already applied to clientHp but not yet
      // confirmed by a stat-1 server update. Reconciliation consumes this
      // before applying an upward server delta, preventing double-counted VIT,
      // healing effects, and notification heals.
      private var predictedRecoveryPending_:int = 0;

      // Bounded pending-damage ledger. Parallel vectors avoid allocating an
      // object for every projectile collision in dense encounters.
      private const predictedDamageAmounts_:Vector.<int> = new Vector.<int>();
      private const predictedDamageExpires_:Vector.<int> = new Vector.<int>();
      private const predictedDamageSources_:Vector.<String> = new Vector.<String>();
      private var predictedDamagePending_:int = 0;

      // Preserve the latest server-authoritative position as well as the error
      // beyond normal client prediction. Auto Dodge evaluates the swept corridor
      // between this position and the locally integrated position; a scalar
      // hitbox expansion alone missed projectiles crossed by the server path.
      private var serverPositionError_:Number = 0;
      private var serverPositionErrorTime_:int = -1;
      private var serverPositionX_:Number = 0;
      private var serverPositionY_:Number = 0;
      private var serverVelocityX_:Number = 0;
      private var serverVelocityY_:Number = 0;
      private var temporalServerOffsetTime_:int = -1;
      private var temporalServerOffsetLocalX_:Number = Number.NaN;
      private var temporalServerOffsetLocalY_:Number = Number.NaN;
      private var temporalServerOffsetX_:Number = 0;
      private var temporalServerOffsetY_:Number = 0;
      private var collisionFrameTime_:int = -1;
      private var collisionFrameStartX_:Number = 0;
      private var collisionFrameStartY_:Number = 0;
      private var collisionFrameEndX_:Number = 0;
      private var collisionFrameEndY_:Number = 0;

      // Diagnostic attribution for an authoritative HP decrease that arrives
      // without enough outstanding local prediction. This does not affect HP
      // reconciliation or hit-report suppression.
      public var lastLocalDamageTime:int = -1;
      public var lastLocalDamageAmount:int = 0;
      public var lastLocalDamageSource:String = "none";

      public var healBuffer:int = 0;

      public var healBufferTime:int = 0;

      public var autoNexusNumber:int = 0;

      // Observed-damage safety margin for Auto Nexus.
      //
      // A 2026-07-25 log audit found 67% (07-25) / 74% (07-24) of ALL HP the
      // player loses arrives as damage the client cannot attribute to any
      // modelled threat — 100,460 HP across both days had neither a recent
      // projectile nor any AoE nearby (enemy shots streamed from ~29 tiles whose
      // owner never entered goDict_, so they are never simulated). Auto Nexus
      // therefore predicts survival from a model that sees only ~26-33% of
      // incoming damage, which is how a full-HP character dies outright.
      //
      // We cannot model what we cannot see, but we CAN measure it: a TRUE
      // sliding-window rate of unattributed damage, used as a small safety
      // margin on the nexus threshold.
      //
      // The first version of this was badly wrong and cost a real player their
      // Archbishop Leucoryx loot (2026-07-25, Oryx's Sanctuary): it ACCUMULATED
      // `amount * (1000/reactionMs)` per hit instead of dividing by elapsed
      // time, so ONE 513-damage hit was reported as "1288 dps". The margin then
      // pinned at its 35%-of-maxHP cap during any sustained combat, so a
      // configured 15% threshold (87 HP) became an effective 391 HP — the
      // client nexused at 357 HP, 4.5x higher than the user asked for, seven
      // times in one session. Lesson: a rate must be measured over real elapsed
      // time, and a safety margin must never be able to dominate the user's own
      // setting.
      //
      // Now: exact sum over a short window / that window's length. A single
      // 513 hit yields 256 dps over 2s -> a 90 HP margin, not 515.
      private static const UNATTRIBUTED_WINDOW_MS:int = 2000;
      // How far ahead we are protecting: one more hit's worth of reaction time.
      private static const UNATTRIBUTED_REACTION_MS:Number = 350;
      // Hard ceiling on the margin. Deliberately small: the user's configured
      // threshold is the primary control and must stay recognisable.
      private static const UNATTRIBUTED_MAX_FRACTION:Number = 0.12;

      private var unattributedTimes_:Vector.<int> = new Vector.<int>();
      private var unattributedAmounts_:Vector.<int> = new Vector.<int>();

      /** Record server-applied damage the client could not attribute. */
      public function noteUnattributedDamage(amount:int) : void {
         if(amount <= 0) {
            return;
         }
         var now:int = getTimer();
         this.unattributedTimes_.push(now);
         this.unattributedAmounts_.push(amount);
         this.pruneUnattributed(now);
      }

      /** Drop samples older than the window (they no longer bound the rate). */
      private function pruneUnattributed(now:int) : void {
         var cutoff:int = now - UNATTRIBUTED_WINDOW_MS;
         var drop:int = 0;
         while(drop < this.unattributedTimes_.length &&
               this.unattributedTimes_[drop] < cutoff) {
            drop++;
         }
         if(drop > 0) {
            this.unattributedTimes_.splice(0,drop);
            this.unattributedAmounts_.splice(0,drop);
         }
      }

      /** Measured unattributed damage per second over the trailing window. */
      private function unattributedDps() : Number {
         this.pruneUnattributed(getTimer());
         if(this.unattributedAmounts_.length == 0) {
            return 0;
         }
         var total:Number = 0;
         for(var i:int = 0; i < this.unattributedAmounts_.length; i++) {
            total += this.unattributedAmounts_[i];
         }
         return total / (UNATTRIBUTED_WINDOW_MS / 1000);
      }

      /** Auto Nexus threshold including the observed-unattributed-damage margin. */
      public function effectiveAutoNexusThreshold() : int {
         if(this.autoNexusNumber <= 0 || !Parameters.data.autoNexusObservedMargin) {
            return this.autoNexusNumber;
         }
         var dps:Number = this.unattributedDps();
         if(dps <= 0) {
            return this.autoNexusNumber;
         }
         var margin:Number = dps * (UNATTRIBUTED_REACTION_MS / 1000);
         var cap:Number = this.maxHP_ * UNATTRIBUTED_MAX_FRACTION;
         if(margin > cap) {
            margin = cap;
         }
         return this.autoNexusNumber + int(margin);
      }

      /** Exposed for the auto_nexus_trigger diagnostic. */
      public function unattributedDpsDebug() : int {
         return int(this.unattributedDps());
      }

      public var battlePassXP_:int = 0;

      // Enchanting/forge currency from DUST_AMOUNT_STAT (127), shown in the
      // Enchanter window so the reroll cost is legible against the balance.
      // The wire value is a STRING: "tier:amount,tier:amount,..." — kept per
      // tier here; currentDust_ is the total across tiers.
      public var currentDust_:int = 0;
      public var dustByTier_:Vector.<int> = new Vector.<int>(6,true);

      // Forge materials from MATERIAL_AMOUNT_STAT (71) / MATERIAL_CAP_STAT (72),
      // same "tier:amount,..." string encoding as dust. This is the Blacksmith
      // currency (Common/Rare/Legendary Material) — distinct from enchanter dust.
      public var materialByTier_:Vector.<int> = new Vector.<int>(6,true);
      public var materialCapByTier_:Vector.<int> = new Vector.<int>(6,true);

      public function setMaterialAmounts(raw:String, into:Vector.<int>) : void {
         var tierIndex:int = 0;
         while(tierIndex < into.length) {
            into[tierIndex] = 0;
            tierIndex++;
         }
         if(raw == null || raw.length == 0) {
            return;
         }
         for each(var part:String in raw.split(",")) {
            var kv:Array = String(part).split(":");
            if(kv.length == 2) {
               var tier:int = int(kv[0]);
               if(tier >= 0 && tier < into.length) {
                  into[tier] = int(kv[1]);
               }
            }
         }
      }

      public function setDustAmounts(raw:String) : void {
         var total:int = 0;
         var tierIndex:int = 0;
         while(tierIndex < this.dustByTier_.length) {
            this.dustByTier_[tierIndex] = 0;
            tierIndex++;
         }
         if(raw != null && raw.length > 0) {
            var parts:Array = raw.split(",");
            for each(var part:String in parts) {
               var kv:Array = String(part).split(":");
               if(kv.length == 2) {
                  var tier:int = int(kv[0]);
                  var amount:int = int(kv[1]);
                  if(tier >= 0 && tier < this.dustByTier_.length) {
                     this.dustByTier_[tier] = amount;
                  }
                  total += amount;
               }
            }
         }
         this.currentDust_ = total;
      }

      public var requestHealNumber:int = 0;

      public var autoHpPotNumber:int = 0;

      public var autoHealNumber:int = 0;

      public var autoMpPotNumber:int = 0;

      public var autoMpPercentNumber:int = 0;

      // Auto-ability rejection backoff. The MP gate below is a PERCENTAGE of max
      // MP and knows nothing about why the server refuses a use — for metered /
      // multi-phase abilities (Druid sigils charge a 500-point meter before they
      // can switch form) the server answers USEITEM with success=false while the
      // client happily re-fires on the next cooldown. A 2026-07-25 session sent
      // 574 ability uses, nearly all rejected, at ~2/s; the packet dump at the
      // disconnect was 64 consecutive USEITEMs, i.e. we spammed ourselves off the
      // server. Back off geometrically on consecutive rejections instead.
      private var abilityRejectStreak_:int = 0;
      private var abilitySuppressUntil_:int = 0;

      private static const ABILITY_REJECTS_BEFORE_BACKOFF:int = 3;
      private static const ABILITY_BACKOFF_BASE_MS:int = 1000;
      private static const ABILITY_BACKOFF_MAX_MS:int = 15000;

      /** Feed the server's USEITEM verdict for an ABILITY use back into the
       * auto-ability gate. Success clears the streak; repeated rejections push
       * an exponentially growing suppression window. */
      public function noteAbilityUseResult(success:Boolean) : void {
         if(success) {
            this.abilityRejectStreak_ = 0;
            this.abilitySuppressUntil_ = 0;
            return;
         }
         this.abilityRejectStreak_++;
         if(this.abilityRejectStreak_ < ABILITY_REJECTS_BEFORE_BACKOFF) {
            return;
         }
         var steps:int = this.abilityRejectStreak_ - ABILITY_REJECTS_BEFORE_BACKOFF;
         if(steps > 4) {
            steps = 4;
         }
         var wait:int = ABILITY_BACKOFF_BASE_MS * (1 << steps);
         if(wait > ABILITY_BACKOFF_MAX_MS) {
            wait = ABILITY_BACKOFF_MAX_MS;
         }
         this.abilitySuppressUntil_ = getTimer() + wait;
      }

      public var lastHpPotTime:int = 0;

      public var lastMpPotTime:int = 0;

      public var ticksHPLastOff:int = 0;

      public var lastHealRequest:int = 0;

      public var checkStacks:Boolean = false;

      public var isJumping:Boolean = false;

      public var jumpStart:int = -1;

      public var jumpDist:Number = 0;

      public var jumpRot:Number = 0;

      public var petType:int;

      public var petSize:int;

      public var followPos:Point;

      public var followVec:Point;

      public var walkPos:Point;

      public var mousePos_:Point;

      public var creditsWereChanged:Signal;

      public var fameWasChanged:Signal;

      public var supporterFlagWasChanged:Signal;

      public var range:Number = -1;

      // Extend Shot kill-aura: tiles to advance the shot origin toward the aim
      // target, set per-shot by shootAutoAimWeaponAngle (0 for manual shots).
      public var extendShotOrigin_:Number = 0;
      // Distance (tiles) from the advanced shot origin to the aim target. <=~0
      // means the origin sits inside the enemy (spray from within); >0 means the
      // origin is short of it (fan the arc to fit the hitbox at this range).
      public var extendShotRemain_:Number = 0;
      // The live enemy selected for this shot. Retained for aim diagnostics and
      // Extend Shot convergence.
      public var killAuraTarget_:GameObject = null;

      private var lastAutoAimLeadMs_:Number = 0;

      private var lastAutoAimTurnRate_:Number = 0;

      private var lastCalcAimTarget_:GameObject = null;

      // Auto Aim runs at weapon fire rate. Reuse its input/origin vectors so
      // the allocator and GC are not fed several short-lived objects per shot.
      private const autoAimSelfPos_:Vector3D = new Vector3D();

      private const autoAimTargetPos_:Vector3D = new Vector3D();

      private const extendAimOrigin_:Vector3D = new Vector3D();

      protected var rotate_:Number = 0;

      protected var moveMultiplier_:Number = 1;

      protected var healingEffect_:HealingEffect = null;

      protected var nearestMerchant_:Merchant = null;

      protected var breathBarFillMatrix:Matrix;

      protected var breathBarBackFillMatrix:Matrix;

      private var prevWeaponId:int = -1;

      private var prevLifeMult:Number = -1;

      private var prevSpeedMult:Number = -1;

      private var famePortrait_:BitmapData = null;

      private var factory:CharacterFactory;

      private var supportCampaignModel:SupporterCampaignModel;

      private var breathBarBackFill:GraphicsBitmapFill = null;

      private var breathBarFill:GraphicsBitmapFill = null;

      private var lastAutoAbilityAttempt:int = 0;

      private var lastAutoLootActionTime_:int = 0;
      private var autoLootRejectedSlots_:Object = {};
      private var autoLootRejectedItems_:Object = {};
      private static const AUTO_LOOT_REJECTED_SLOT_MS:int = 5000;
      private static const AUTO_LOOT_REJECTED_ITEM_MS:int = 30000;

      private var lastDamage:int;

      private var ip_:IntPoint;

      public var icMS:int = -1;

      private var prevTime:int = -1;
      private const slideVector_:Vector3D = new Vector3D();
      private var autoDodgeController_:AutoDodgeController;
      private const moonlightLanternVector_:Point = new Point();
      private var moonlightLanternMoving_:Boolean = false;
      private var moonlightLanternTargetId_:int = -1;
      private var moonlightLanternLogTime_:int = 0;
      public var quickSlotItem1:int;
      public var quickSlotItem2:int;
      public var quickSlotItem3:int;
      public var quickSlotCount1:int;
      public var quickSlotCount2:int;
      public var quickSlotCount3:int;
      public var quickSlotUpgrade:Boolean;

      public function Player(objectXml:XML) {
         followPos = new Point(0,0);
         followVec = new Point(0,0);
         walkPos = new Point(0,0);
         mousePos_ = new Point(0,0);
         creditsWereChanged = new Signal();
         fameWasChanged = new Signal();
         supporterFlagWasChanged = new Signal();
         ip_ = new IntPoint();
         var injector:Injector = StaticInjectorContext.getInjector();
         this.addTextLine = injector.getInstance(AddTextLineSignal);
         this.factory = injector.getInstance(CharacterFactory);
         this.supportCampaignModel = injector.getInstance(SupporterCampaignModel);
         super(objectXml);
         this.attackMax_ = int(objectXml.Attack.@max);
         this.defenseMax_ = int(objectXml.Defense.@max);
         this.speedMax_ = int(objectXml.Speed.@max);
         this.dexterityMax_ = int(objectXml.Dexterity.@max);
         this.vitalityMax_ = int(objectXml.HpRegen.@max);
         this.wisdomMax_ = int(objectXml.MpRegen.@max);
         this.maxHPMax_ = int(objectXml.MaxHitPoints.@max);
         this.maxMPMax_ = int(objectXml.MaxMagicPoints.@max);
         this.className = objectXml.@id;
         this.texturingCache_ = new Dictionary();
         this.breathBarFillMatrix = new Matrix();
         this.breathBarBackFillMatrix = new Matrix();
      }

      public static function fromPlayerXML(playerName:String, saveData:XML) : Player {
         var objectType:int = 0;
         var objectXml:* = null;
         var player:Player = null;
         var name:* = playerName;
         var data:* = saveData;
         objectType = data.ObjectType;
         try {
            objectXml = ObjectLibrary.xmlLibrary_[objectType];
            player = new Player(objectXml);
            player.name_ = name;
            player.level_ = data.Level;
            player.exp_ = data.Exp;
            player.equipment_ = ConversionUtil.toIntVector(data.Equipment);
            player.calculateStatBoosts();
            player.lockedSlot = new Vector.<int>(player.equipment_.length);
            player.maxHP_ = player.maxHPBoost_ + int(data.MaxHitPoints);
            player.hp_ = int(data.HitPoints);
            player.maxMP_ = player.maxMPBoost_ + int(data.MaxMagicPoints);
            player.mp_ = int(data.MagicPoints);
            player.attack_ = player.attackBoost_ + int(data.Attack);
            player.defense_ = player.defenseBoost_ + int(data.Defense);
            player.speed_ = player.speedBoost_ + int(data.Speed);
            player.dexterity_ = player.dexterityBoost_ + int(data.Dexterity);
            player.vitality_ = player.vitalityBoost_ + int(data.HpRegen);
            player.wisdom = player.wisdomBoost_ + int(data.MpRegen);
            player.tex1Id_ = !!data.hasOwnProperty("Tex1")?int(data.Tex1):0;
            player.tex2Id_ = !!data.hasOwnProperty("Tex2")?int(data.Tex2):0;
            // The current build does NOT send <HasBackpack> at all — a
            // 2026-07-25 capture of the live client's /char/list had the field
            // absent on all 7 characters and carried <BackpackSlots>N</> instead.
            // Reading the dead field meant the char list never established
            // backpack state, leaving it entirely to stat 79 + the empty modern
            // slot stats, which the server also sends to seasonal characters
            // that own no backpack — hence brand-new seasonal chars reporting a
            // backpack they do not have. Treat BackpackSlots as authoritative
            // and remember it per character for the in-game player.
            var slotsDeclared:int = -1;
            if("BackpackSlots" in data) {
               slotsDeclared = int(data.BackpackSlots);
            } else if("HasBackpack" in data) {
               slotsDeclared = data.HasBackpack == "1" ? 8 : 0;
            }
            player.backpackFlag_ = slotsDeclared > 0;
            player.backpackStatsSeen_ = player.backpackFlag_;
            player.hasBackpack_ = player.backpackFlag_;
            var declaredCharId:int = int(data.@id);
            if(declaredCharId > 0 && slotsDeclared >= 0) {
               backpackSlotsByChar_[declaredCharId] = slotsDeclared;
            }
         }
         catch(error:Error) {
            throw new Error("Type: 0x" + objectType.toString(16) + " doesn\'t exist. " + error.message);
         }
         return player;
      }

      override public function moveTo(x:Number, y:Number) : Boolean {
         var moved:Boolean = super.moveTo(x,y);
         if(map_.gs_.isSafeMap) {
            this.nearestMerchant_ = this.getNearbyMerchant();
         }
         return moved;
      }

      public function combatTrigger() : int {
         var blockIndex:int = 0;
         var blockWeights:Vector.<Number> = new <Number>[1,0.75,0.5,0.25];
         var threshold:int = 0;
         var defense:int = this.defense_;
         var fullBlocks:int = Math.floor(defense / 15);
         blockIndex = 0;
         while(blockIndex < fullBlocks) {
            threshold = threshold + 15 * blockWeights[Math.min(blockIndex,3)];
            blockIndex++;
         }
         threshold = threshold + defense % 15 * blockWeights[Math.min(Math.max(0,fullBlocks - 1),3)];
         return threshold;
      }

      public function icTime() : Number {
         return Math.max(7000 - this.vitality_ * 40,1000);
      }

      override public function updateStatuses() : void {
         if(this.map_.player_ == this) {
            this.isWeak = this.isWeak_();
            this.isSlowed = this.isSlowed_();
            this.isSick = this.isSick_();
            this.isDazed = this.isDazed_();
            this.isStunned = this.isStunned_();
            this.isBlind = this.isBlind_();
            this.isDrunk = this.isDrunk_();
            this.isBleeding = this.isBleeding_();
            this.isConfused = this.isConfused_();
            this.isParalyzed = this.isParalyzed_();
            this.isSpeedy = this.isSpeedy_();
            this.isNinjaSpeedy = this.isNinjaSpeedy_();
            this.isHallucinating = this.isHallucinating_();
            this.isDamaging = this.isDamaging_();
            this.isBerserk = this.isBerserk_();
            this.isUnstable = this.isUnstable_();
            this.isDarkness = this.isDarkness_();
            this.isSilenced = this.isSilenced_();
            this.isExposed = this.isExposed_();
            this.isQuiet = this.isQuiet_();
         }
         this.isInvisible = this.isInvisible_();
         this.isHealing = this.isHealing_();
         super.updateStatuses();
      }

      override public function update(time:int, dt:int) : Boolean {
         var weaponId:int = 0;
         var weaponChanged:* = false;
         var lifeMultChanged:* = false;
         var speedMultChanged:* = false;
         var projProps:ProjectileProperties = null;
         var isFollowing:Boolean = false;
         var questTarget:* = null;
         var lastRecordPoint:* = null;
         var bazaarPortal:* = null;
         var invSlot:int = 0;
         var backpackSlot:int = 0;
         var conMoveDist:Number = NaN;
         var lanternFollowing:Boolean = false;
         if(this.map_.player_ == this) {
            // Projectiles update after GameObjects in Map.update. Preserve the
            // local player's actual movement segment for continuous collision
            // testing later in this same frame.
            this.collisionFrameTime_ = time;
            this.collisionFrameStartX_ = this.x_;
            this.collisionFrameStartY_ = this.y_;
            this.collisionFrameEndX_ = this.x_;
            this.collisionFrameEndY_ = this.y_;
            // A freshly loaded local player has no relative movement vector
            // until keyboard input or Auto Play calls setRelativeMovement().
            // Auto Dodge evaluation and movement integration are below the
            // relMoveVec_ guard, so entering a dungeon with Auto Play disabled
            // left the controller completely dormant. Always give the local
            // player a zero intent; remote players retain the null fast path.
            if(this.relMoveVec_ == null) {
               this.relMoveVec_ = new Point();
            }
            if(Parameters.data.autoDodge && this.autoDodgeController_ == null) {
               this.autoDodgeController_ = new AutoDodgeController();
            }
            // Regeneration is an integration over THIS frame. Using time since
            // the last server update re-applied the whole interval every frame;
            // during a stalled connection it produced ever-growing heals and
            // thousands of hp_regen log entries per minute.
            this.calcHealth(dt);
            if(this.checkHealth(time)) {
               return false;
            }
            // Send the deferred DASH_ACK once a Kensei dash's travel time elapses.
            this.updateDash(time);
            // Emit the periodic predicted-kill tally for the session dashboard.
            this.flushKillTally(time);
            weaponId = this.equipment_[0];
            weaponChanged = this.prevWeaponId != weaponId;
            lifeMultChanged = this.prevLifeMult != (Parameters.data.lifeMul == 1.0 ? this.projectileLifeMult : Parameters.data.lifeMul);
            speedMultChanged = this.prevSpeedMult != (Parameters.data.speedMul == 1.0 ? this.projectileSpeedMult : Parameters.data.speedMul);
            if(weaponId != -1) {
               if(this.range == -1 || weaponChanged || lifeMultChanged || speedMultChanged) {
                  projProps = ObjectLibrary.propsLibrary_[weaponId].projectiles_[0];
                  this.range = projProps.calcMaxRange((Parameters.data.speedMul == 1.0 ? this.projectileSpeedMult : Parameters.data.speedMul),
                          (Parameters.data.lifeMul == 1.0 ? this.projectileLifeMult : Parameters.data.lifeMul));
                  this.range = Math.min(this.range, 16);
                  if(weaponChanged) {
                     this.prevWeaponId = weaponId;
                  }
                  if(lifeMultChanged) {
                     this.prevLifeMult = this.projectileLifeMult;
                  }
                  if(speedMultChanged) {
                     this.prevSpeedMult = this.projectileSpeedMult;
                  }
               }
            } else {
               this.range = -1;
            }
            if (this.icMS != -1 && TimeUtil.getTrueTime() - this.icMS >= this.icTime() * Parameters.data.timeScale) {
               this.icMS = -1;
            }
            this.checkMana(time);
            isFollowing = false;
            if(followPos.x != 0 && followPos.y != 0) {
               if(Parameters.followingName && Parameters.followName != "" && Parameters.followPlayer) {
                  if(this.followLanded) {
                     this.followVec.x = 0;
                     this.followVec.y = 0;
                     this.followLanded = false;
                  } else {
                     isFollowing = true;
                     if(time - this.lastTpTime_ > Parameters.data.fameTpCdTime && getDistSquared(x_,y_,Parameters.followPlayer.tickPosition_.x,Parameters.followPlayer.tickPosition_.y) > Parameters.data.teleDistance) {
                        lastTpTime_ = time;
                        teleToClosestPoint(followPos);
                     }
                     this.follow(this.followPos.x,this.followPos.y);
                  }
               }
            }
            if(Parameters.questFollow) {
               if(this.followLanded) {
                  this.followVec.x = 0;
                  this.followVec.y = 0;
                  this.followLanded = false;
               } else if(map_.quest_.objectId_ > 0) {
                  questTarget = map_.goDict_[map_.quest_.objectId_];
                  if(questTarget) {
                     this.followPos.x = questTarget.x_;
                     this.followPos.y = questTarget.y_;
                  }
                  isFollowing = true;
                  this.follow(this.followPos.x,this.followPos.y);
               } else {
                  this.followPos.x = this.x_;
                  this.followPos.y = this.y_;
                  this.follow(this.followPos.x,this.followPos.y);
               }
            } else if(Parameters.VHS == 2) {
               if(this.followLanded || getDistSquared(x_,y_,followPos.x,followPos.y) <= 0.2) {
                  if(Parameters.VHSRecordLength > 0) {
                     if(Parameters.VHSIndex >= Parameters.VHSRecordLength) {
                        Parameters.VHSIndex = 0;
                     }
                     var vhsRecordIndex:Number = Parameters.VHSIndex;
                     Parameters.VHSIndex++;
                     Parameters.VHSNext = Parameters.VHSRecord[vhsRecordIndex];
                     this.followPos.x = Parameters.VHSNext.x;
                     this.followPos.y = Parameters.VHSNext.y;
                     this.followLanded = false;
                  }
               } else {
                  isFollowing = true;
                  this.follow(this.followPos.x,this.followPos.y);
               }
            } else if(Parameters.VHS == 1) {
               if(this.x_ != -1 && this.y_ != -1) {
                  if(Parameters.VHSRecord.length == 0) {
                     Parameters.VHSRecord.push(new Point(this.x_,this.y_));
                  } else {
                     lastRecordPoint = Parameters.VHSRecord[Parameters.VHSRecord.length - 1];
                     if(lastRecordPoint.x != this.x_ || lastRecordPoint.y != this.y_) {
                        var distSqFromLast:Number = this.getDistSquared(this.x_,this.y_,lastRecordPoint.x,lastRecordPoint.y);
                        if(distSqFromLast >= 1) {
                           Parameters.VHSRecord.push(new Point(this.x_,this.y_));
                        }
                     }
                  }
               }
            } else if(Parameters.bazaarJoining) {
               if(this.map_.isNexus) {
                  bazaarPortal = this.map_.findObject(1872);
                  if(bazaarPortal) {
                     isFollowing = true;
                     var distToPortal:Number = this.getDist(x_,y_,bazaarPortal.x_,bazaarPortal.y_);
                     this.followPos.x = bazaarPortal.x_;
                     if(Math.abs(bazaarPortal.y_ - this.y_) > 0.8 && (Math.abs(bazaarPortal.x_ - this.x_) < 0.5 || distToPortal < Parameters.bazaarDist)) {
                        this.followPos.y = bazaarPortal.y_;
                     } else {
                        this.followPos.y = this.y_;
                     }
                     this.follow(this.followPos.x,this.followPos.y);
                     if(distToPortal <= 1) {
                        followLanded = true;
                        isFollowing = false;
                        this.map_.gs_.gsc_.usePortal(bazaarPortal.objectId_);
                     }
                  } else if(Parameters.bazaarLR == "left") {
                     this.followPos.x = this.x_ - 2;
                     this.followPos.y = this.y_;
                     this.follow(-1,-1);
                     isFollowing = true;
                  } else if(Parameters.bazaarLR == "right") {
                     this.followPos.x = this.x_ + 2;
                     this.followPos.y = this.y_;
                     this.follow(-1,-1);
                     isFollowing = true;
                  }
               } else {
                  Parameters.bazaarJoining = false;
               }
            }
            // This is a low-priority movement intent, not a second dodge
            // controller. Keyboard input wins below, while the resulting
            // lantern vector passes through the normal predictive scorer.
            lanternFollowing = this.updateMoonlightLanternFollow(time);
            if(lanternFollowing) {
               isFollowing = true;
            }
            if(!isFollowing) {
               this.followVec.x = 0;
               this.followVec.y = 0;
            }
            if(!(map_.isVault && !Parameters.data.autoLootInVault)
                    && Parameters.data.AutoLootOn) {
               this.autoLoot(time);
            }
            if(Parameters.swapINVandBP) {
               if(this.hasBackpack_) {
                  if(map_.gs_.lastUpdate_ - map_.gs_.gsc_.lastInvSwapTime >= 500) {
                     while(Parameters.swapINVandBPcounter <= 8) {
                        invSlot = Parameters.swapINVandBPcounter + 4;
                        backpackSlot = Parameters.swapINVandBPcounter + 12;
                        var swapCounter:Number = Parameters.swapINVandBPcounter;
                        Parameters.swapINVandBPcounter++;
                        if(swapCounter >= 8) {
                           Parameters.swapINVandBP = false;
                           Parameters.swapINVandBPcounter = 0;
                           break;
                        }
                        if(!(equipment_[invSlot] == -1 && equipment_[backpackSlot] == -1) && equipment_[invSlot] != equipment_[backpackSlot]) {
                           map_.gs_.gsc_.invSwap(this,this,backpackSlot,equipment_[backpackSlot],this,invSlot,equipment_[invSlot]);
                           break;
                        }
                     }
                  }
               }
            }
         }
         var cameraAngle:* = 0;
         var moveSpeed:Number = NaN;
         var moveAngle:Number = NaN;
         var slideVec:Vector3D = null;
         var slideSpeed:Number = NaN;
         var groundDmg:int = 0;
         var damageEffects:Vector.<uint> = null;
         if(!this.map_.gs_.isSafeMap) {
            if(this.tierBoost) {
               this.tierBoost = this.tierBoost - dt;
               if(this.tierBoost < 0) {
                  this.tierBoost = 0;
               }
            }
            if(this.dropBoost) {
               this.dropBoost = this.dropBoost - dt;
               if(this.dropBoost < 0) {
                  this.dropBoost = 0;
               }
            }
         }
         if(this.xpTimer) {
            this.xpTimer = this.xpTimer - dt;
            if(this.xpTimer < 0) {
               this.xpTimer = 0;
            }
         }
         if(this.isHealing && !Parameters.data.noParticlesMaster) {
            if(this.healingEffect_ == null) {
               this.healingEffect_ = new HealingEffect(this);
               this.map_.addObj(this.healingEffect_,x_,y_);
            }
         }
         if(this.healingEffect_) {
            this.map_.removeObj(this.healingEffect_.objectId_);
            this.healingEffect_ = null;
         }
         if(this.relMoveVec_) {
            cameraAngle = Number(Parameters.data.cameraAngle);
            if(this.rotate_ != 0) {
               // Q/E keyboard rotation, time-scaled (rad per ms). Reduced from
               // 0.003 — the zoomed-out (full-window) view sweeps far more tiles
               // per degree, so the old speed felt disorienting.
               cameraAngle = Number(cameraAngle + dt * 0.0015 * this.rotate_);
               Parameters.data.cameraAngle = cameraAngle;
            }
            if((this.relMoveVec_.x != 0 || this.relMoveVec_.y != 0) &&
                  (this.manualMovementInput_ || !lanternFollowing)) {
               this.walkPos.setTo(0,0);
               if(isFollowing) {
                  isFollowing = false;
               }
               moveSpeed = this.getMoveSpeed();
               moveAngle = Math.atan2(this.relMoveVec_.y,this.relMoveVec_.x);
               if(this.square.props_.slideAmount_ > 0 && !Parameters.data.ignoreIce) {
                  slideVec = this.slideVector_;
                  slideVec.x = moveSpeed * Math.cos(cameraAngle + moveAngle);
                  slideVec.y = moveSpeed * Math.sin(cameraAngle + moveAngle);
                  slideVec.z = 0;
                  slideSpeed = moveSpeed;
                  slideVec.scaleBy(-(this.square.props_.slideAmount_ - 1));
                  this.moveVec_.scaleBy(this.square.props_.slideAmount_);
                  if(this.moveVec_.lengthSquared < slideSpeed * slideSpeed) {
                     this.moveVec_.x += slideVec.x;
                     this.moveVec_.y += slideVec.y;
                  }
               } else {
                  this.moveVec_.x = moveSpeed * Math.cos(cameraAngle + moveAngle);
                  this.moveVec_.y = moveSpeed * Math.sin(cameraAngle + moveAngle);
               }
            } else if(lanternFollowing) {
               // Suppress stale Auto Play/quest movement while a lantern is
               // present. Within the hold band the zero intent lets Auto Dodge
               // make only the movement required by current threats.
               this.walkPos.setTo(0,0);
               if(this.moonlightLanternVector_.x != 0 ||
                     this.moonlightLanternVector_.y != 0) {
                  moveSpeed = this.getMoveSpeed();
                  moveAngle = Math.atan2(this.moonlightLanternVector_.y,
                        this.moonlightLanternVector_.x);
                  this.moveVec_.x = moveSpeed * Math.cos(moveAngle);
                  this.moveVec_.y = moveSpeed * Math.sin(moveAngle);
               } else {
                  this.moveVec_.x = 0;
                  this.moveVec_.y = 0;
               }
            } else if(this.conMoveVec && (this.conMoveVec.x != 0 || this.conMoveVec.y != 0)) {
               this.walkPos.setTo(0,0);
               moveSpeed = this.getMoveSpeed();
               conMoveDist = PointUtil.distanceXY(0,0,this.conMoveVec.x,this.conMoveVec.y);
               if(conMoveDist < 1) {
                  moveSpeed = moveSpeed * conMoveDist;
               }
               moveAngle = -Math.atan2(this.conMoveVec.y,this.conMoveVec.x);
               if(this.square.props_.slideAmount_ > 0 && !Parameters.data.ignoreIce) {
                  slideVec = this.slideVector_;
                  slideVec.x = moveSpeed * Math.cos(cameraAngle + moveAngle);
                  slideVec.y = moveSpeed * Math.sin(cameraAngle + moveAngle);
                  slideVec.z = 0;
                  slideSpeed = moveSpeed;
                  slideVec.scaleBy(-(this.square.props_.slideAmount_ - 1));
                  this.moveVec_.scaleBy(this.square.props_.slideAmount_);
                  if(this.moveVec_.lengthSquared < slideSpeed * slideSpeed) {
                     this.moveVec_.x += slideVec.x;
                     this.moveVec_.y += slideVec.y;
                  }
               } else {
                  this.moveVec_.x = moveSpeed * Math.cos(cameraAngle + moveAngle);
                  this.moveVec_.y = moveSpeed * Math.sin(cameraAngle + moveAngle);
               }
            } else if(this.walkPos.x != 0 || this.walkPos.y != 0) {
               moveSpeed = this.getMoveSpeed();
               moveAngle = Math.atan2(this.walkPos.y - this.y_,this.walkPos.x - this.x_);
               if(this.square.props_.slideAmount_ > 0 && !Parameters.data.ignoreIce) {
                  slideVec = this.slideVector_;
                  slideVec.x = moveSpeed * Math.cos(moveAngle);
                  slideVec.y = moveSpeed * Math.sin(moveAngle);
                  slideVec.z = 0;
                  slideSpeed = moveSpeed;
                  slideVec.scaleBy(-(this.square.props_.slideAmount_ - 1));
                  this.moveVec_.scaleBy(this.square.props_.slideAmount_);
                  if(this.moveVec_.lengthSquared < slideSpeed * slideSpeed) {
                     this.moveVec_.x += slideVec.x;
                     this.moveVec_.y += slideVec.y;
                  }
               } else {
                  this.moveVec_.x = moveSpeed * Math.cos(moveAngle);
                  this.moveVec_.y = moveSpeed * Math.sin(moveAngle);
               }
            } else if(isFollowing && this.followPos && (this.followVec.x != 0 || this.followVec.y != 0)) {
               moveSpeed = this.getMoveSpeed();
               moveAngle = Math.atan2(this.followVec.y,this.followVec.x);
               if(this.square.props_.slideAmount_ > 0 && !Parameters.data.ignoreIce) {
                  slideVec = this.slideVector_;
                  slideVec.x = moveSpeed * Math.cos(moveAngle);
                  slideVec.y = moveSpeed * Math.sin(moveAngle);
                  slideVec.z = 0;
                  slideSpeed = moveSpeed;
                  slideVec.scaleBy(-(this.square.props_.slideAmount_ - 1));
                  this.moveVec_.scaleBy(this.square.props_.slideAmount_);
                  if(this.moveVec_.lengthSquared < slideSpeed * slideSpeed) {
                     this.moveVec_.x += slideVec.x;
                     this.moveVec_.y += slideVec.y;
                  }
               } else {
                  this.moveVec_.x = moveSpeed * Math.cos(moveAngle);
                  this.moveVec_.y = moveSpeed * Math.sin(moveAngle);
               }
            } else if(!Parameters.data.ignoreIce && this.moveVec_.length > 0.00012 && this.square.props_.slideAmount_ > 0) {
               this.moveVec_.scaleBy(this.square.props_.slideAmount_);
            } else {
               this.moveVec_.x = 0;
               this.moveVec_.y = 0;
            }
            var _mvDt:int = dt > 34 ? 34 : dt;
            var dodgeApplied:Boolean = false;
            if(this.map_.player_ == this && this.autoDodgeController_ != null && Parameters.data.autoDodge) {
               if(Parameters.data.autoDodgePredictive || Parameters.data.autoDodgeDebug) {
                  var dodgeSpeed:Number = this.getMoveSpeed();
                  // While the outgoing MOVE clamp is refusing part of each
                  // step, planning at full speed overestimates escape reach —
                  // the model believes escapes the server won't accept. Shrink
                  // the planning speed by the last observed accepted ratio for
                  // a short window (about two MOVE ticks), floored so a single
                  // catch-up spike cannot paralyze the dodge.
                  var dodgeGsc:GameServerConnection = this.map_.gs_ != null ?
                        this.map_.gs_.gsc_ : null;
                  if(dodgeGsc != null && dodgeGsc.dodgeMoveClampAt_ >= 0 &&
                        getTimer() - dodgeGsc.dodgeMoveClampAt_ <= 400) {
                     dodgeSpeed *= Math.max(0.5,dodgeGsc.dodgeMoveClampScale_);
                  }
                  this.autoDodgeController_.evaluateThreats(this,this.map_,this.map_.hostileProjectiles_,
                        time,dodgeSpeed,this.moveVec_.x,this.moveVec_.y,_mvDt);
                  if(Parameters.data.autoDodgePredictive) {
                     dodgeApplied = this.autoDodgeController_.applyDodge(this,this.map_,time,dodgeSpeed,
                           this.moveVec_,_mvDt);
                     if(this.autoDodgeController_.checkPredictiveAutoNexus(this,time)) {
                        return false;
                     }
                  }
                  this.autoDodgeController_.logDiagnostics(time,this,dodgeSpeed);
               }
            }
            if(this.square && this.square.props_ && this.square.props_.push_ && !Parameters.data.ignoreIce) {
               this.moveVec_.x = this.moveVec_.x - this.square.props_.animate_.dx_ * 0.001;
               this.moveVec_.y = this.moveVec_.y - this.square.props_.animate_.dy_ * 0.001;
            }
            // Cap the per-frame movement integration at ~2 render frames. After
            // a frame hitch (GC, texture upload) the elapsed delta balloons and
            // a single frame would "catch up" by up to 200ms of movement on top
            // of an already-reported position — consecutive MOVE packets then
            // imply 1.3-2x max speed for one tick and the current-build server
            // kicks with FAILURE errorId=0 after ~a dozen violations. Capping
            // the burst keeps every reported step within server tolerance; in a
            // sustained hitch the player just moves a hair slower (imperceptible
            // at 60-144fps, and slow is always legal).
            if(dodgeApplied) {
               // Smooth Walk is a path-following post-process. Applying it after
               // Auto Dodge could rotate a valid bomb escape back along a wall,
               // exactly as seen in the Sulfurous Wetlands hit trace. A dodge
               // already includes collision-aware path scoring, so integrate it
               // directly and discard stale smooth-walk side bias.
               this.smoothWalkSide_ = 0;
               this.smoothWalkActive_ = false;
               this.walkTo(this.x_ + _mvDt * this.moveVec_.x,
                     this.y_ + _mvDt * this.moveVec_.y);
            } else if(lanternFollowing) {
               // Lantern following already has a hysteretic stand-off radius;
               // walkTo_follow would snap the final step onto the object.
               if(Parameters.data.smoothWalk) {
                  this.smoothWalkTo(this.x_ + _mvDt * this.moveVec_.x,
                        this.y_ + _mvDt * this.moveVec_.y);
               } else {
                  this.walkTo(this.x_ + _mvDt * this.moveVec_.x,
                        this.y_ + _mvDt * this.moveVec_.y);
               }
            } else if(isFollowing) {
               this.walkTo_follow(this.x_ + _mvDt * this.moveVec_.x,this.y_ + _mvDt * this.moveVec_.y);
            } else if(Parameters.data.smoothWalk) {
               this.smoothWalkTo(this.x_ + _mvDt * this.moveVec_.x,this.y_ + _mvDt * this.moveVec_.y);
            } else {
               this.walkTo(this.x_ + _mvDt * this.moveVec_.x,this.y_ + _mvDt * this.moveVec_.y);
            }
         } else if(!super.update(time,dt)) {
            return false;
         }
         if(this.map_.player_ == this) {
            this.collisionFrameEndX_ = this.x_;
            this.collisionFrameEndY_ = this.y_;
            if(this.square && this.square.props_ && this.square.props_.maxDamage_ > 0 && (!!Parameters.data.reducedLava?this.lastDamage + 500 < time:this.square.lastDamage_ + 500 < time) && !this.isInvincible && (square.obj_ == null || square.obj_.props_ == null || !this.square.obj_.props_.protectFromGroundDamage_) && !Parameters.data.noClip) {
               groundDmg = map_.gs_.gsc_.getNextDamage(this.square.props_.minDamage_,this.square.props_.maxDamage_);
               if(this.subtractDamage(groundDmg,time,"ground")) {
                  return false;
               }
               damageEffects = new <uint>[99];
               damage(true,groundDmg,damageEffects,hp_ <= groundDmg,null);
               this.map_.gs_.gsc_.groundDamage(time,x_,y_);
               this.square.lastDamage_ = time;
               this.lastDamage = time;
            }
         }
         return true;
      }

      override protected function makeNameBitmapData() : BitmapData {
         var nameBmd:BitmapData = BitmapTextFactory.make(!!name_?name_:className,16,this.getNameColor(),true,NAME_OFFSET_MATRIX,true);
         nameBmd.draw(FameUtil.numStarsToIcon(this.numStars_), RANK_OFFSET_MATRIX);
         return nameBmd;
      }

      override public function draw(graphicsData:Vector.<GraphicsBitmapFill>, camera:Camera, time:int) : void {
         if(this != map_.player_ && !this.starred_ && (Parameters.lowCPUMode || Parameters.data.hideLockList)) {
            return;
         }
         if(this.prevTime != -1 && this == this.map_.player_ && conMoveVec) {
            this.walkTo(x_ + (time - this.prevTime) * conMoveVec.x,y_ + (time - this.prevTime) * conMoveVec.y);
         }
         this.prevTime = time;
         super.draw(graphicsData,camera,time);
         if(this != map_.player_) {
            if(!Parameters.data.alphaOnOthers || this.starred_) {
               drawName(graphicsData,camera,false);
            }
         } else if(this.breath_ >= 0) {
            this.drawBreathBar(graphicsData,time);
         }
      }

      override protected function getTexture(camera:Camera, time:int) : BitmapData {
         var walkPeriod:int = 0;
         var flashAmount:Number = NaN;
         var animProgress:Number = NaN;
         var animAction:int = 0;
         var resizedTex:* = null;
         var maskedImage:* = null;
         var merchantCache:* = null;
         var flashCT:* = null;
         if(this.isShooting || time < attackStart_ + this.attackPeriod_) {
            facing_ = attackAngle_;
            animProgress = (time - attackStart_) % this.attackPeriod_ / this.attackPeriod_;
            animAction = 2;
         } else if(moveVec_.x != 0 || moveVec_.y != 0) {
            walkPeriod = 3.5 / this.getMoveSpeed();
            if(moveVec_.y != 0 || moveVec_.x != 0) {
               facing_ = Math.atan2(moveVec_.y,moveVec_.x);
            }
            animProgress = time % walkPeriod / walkPeriod;
            animAction = 1;
         }
         if(this.isHexed()) {
            this.isDefaultAnimatedChar && this.setToRandomAnimatedCharacter();
         } else if(!this.isDefaultAnimatedChar) {
            this.makeSkinTexture();
         }
         if(camera.isHallucinating_) {
            maskedImage = new MaskedImage(getHallucinatingTexture(),null);
         } else {
            maskedImage = animatedChar_.imageFromFacing(facing_,camera,animAction,animProgress);
         }
         var tex1:int = tex1Id_;
         var tex2:int = tex2Id_;
         if(fakeTex1 != -1) {
            tex1 = fakeTex1;
         }
         if(fakeTex2 != -1) {
            tex2 = fakeTex2;
         }
         if(this.nearestMerchant_) {
            merchantCache = texturingCache_[this.nearestMerchant_];
            if(merchantCache == null) {
               texturingCache_[this.nearestMerchant_] = new Dictionary();
            } else {
               resizedTex = merchantCache[maskedImage];
            }
            tex1 = this.nearestMerchant_.getTex1Id(tex1Id_);
            tex2 = this.nearestMerchant_.getTex2Id(tex2Id_);
         } else {
            resizedTex = texturingCache_[maskedImage];
         }
         if(resizedTex == null) {
            resizedTex = TextureRedrawer.resize(maskedImage.image_,maskedImage.mask_,size_,false,tex1,tex2);
            if(this.nearestMerchant_ != null) {
               texturingCache_[this.nearestMerchant_][maskedImage] = resizedTex;
            } else {
               texturingCache_[maskedImage] = resizedTex;
            }
         }
         if(hp_ < maxHP_ * 0.2) {
            flashAmount = Math.abs(Math.sin(time * 0.005)) * 10 * 0.1;
            flashCT = new ColorTransform(1,1,1,1,flashAmount * 128,-flashAmount * 128,-flashAmount * 128);
            resizedTex = CachingColorTransformer.transformBitmapData(resizedTex,flashCT);
         }
         var glowTex:BitmapData = texturingCache_[resizedTex];
         if(glowTex == null) {
            if(this == this.map_.player_) {
               if(Parameters.VHS == 1) {
                  glowTex = GlowRedrawer.outlineGlow(resizedTex,65280);
               } else if(Parameters.VHS == 2) {
                  glowTex = GlowRedrawer.outlineGlow(resizedTex,16768256);
               } else if(this.hasSupporterFeature(1)) {
                  glowTex = GlowRedrawer.outlineGlow(resizedTex,13395711,1.4,false,true);
               } else {
                  glowTex = GlowRedrawer.outlineGlow(resizedTex,this.legendaryRank_ == -1?0:16711680);
               }
            } else if(this.hasSupporterFeature(1)) {
               glowTex = GlowRedrawer.outlineGlow(resizedTex,13395711,1.4,false,true);
            } else {
               glowTex = GlowRedrawer.outlineGlow(resizedTex,this.legendaryRank_ == -1?0:16711680);
            }
            texturingCache_[resizedTex] = glowTex;
         }
         if(Parameters.data.alphaOnOthers && (this.objectId_ != map_.player_.objectId_ && (!this.starred_ || this.isFellowGuild_ && Parameters.data.showAOGuildies))) {
            glowTex = CachingColorTransformer.alphaBitmapData(glowTex,Parameters.data.alphaMan);
         } else if(this.isStasis || (this.isPetrified && !Parameters.data.ignorePetrified)) {
            glowTex = CachingColorTransformer.filterBitmapData(glowTex,PAUSED_FILTER);
         } else if(this.isInvisible) {
            glowTex = CachingColorTransformer.alphaBitmapData(glowTex,0.4);
         }
         return glowTex;
      }

      override public function getPortrait() : BitmapData {
         var maskedImage:* = null;
         var scale:int = 0;
         if(portrait_ == null) {
            maskedImage = animatedChar_.imageFromDir(0,0,0);
            scale = 4 / maskedImage.image_.width * 100;
            portrait_ = TextureRedrawer.resize(maskedImage.image_,maskedImage.mask_,scale,true,tex1Id_,tex2Id_);
            portrait_ = GlowRedrawer.outlineGlow(portrait_,0);
         }
         return portrait_;
      }

      override public function setAttack(weaponType:int, attackAngle:Number) : void {
         var weaponXml:XML = ObjectLibrary.xmlLibrary_[weaponType];
         if(weaponXml == null) {
            return;
         }
         this.attackPeriod_ = this.weaponAttackPeriod(weaponType);
         super.setAttack(weaponType,attackAngle);
      }

      override public function removeFromMap() : void {
         if(this.autoDodgeController_ != null) {
            this.autoDodgeController_.reset();
            this.autoDodgeController_ = null;
         }
         if(Parameters.followingName && Parameters.data.followIntoPortals && this.name_.toUpperCase() == Parameters.followName) {
            for each(var portalObj:GameObject in map_.goDict_) {
               if(portalObj is Portal && this.getDistSquared(x_,y_,portalObj.x_,portalObj.y_) <= 1) {
                  this.map_.gs_.gsc_.usePortal(portalObj.objectId_);
                  break;
               }
            }
         }
         if(Parameters.followPlayer && objectId_ == Parameters.followPlayer.objectId_) {
            Parameters.followPlayer = null;
         }
         super.removeFromMap();
      }

      public function getDistFromSelf(x:Number, y:Number) : Number {
         var dx:Number = x - this.x_;
         var dy:Number = y - this.y_;
         return Math.sqrt(dy * dy + dx * dx);
      }

      public function getFameBonus() : Number {
         var equipId:int = 0;
         var itemXml:XML = null;
         var totalBonus:int = 0;
         var slotIndex:int = 0;
         while(slotIndex < 4) {
            if(equipment_ && equipment_.length > slotIndex) {
               equipId = equipment_[slotIndex];
               if(equipId != -1) {
                  itemXml = ObjectLibrary.xmlLibrary_[equipId];
                  if(itemXml != null && itemXml.hasOwnProperty("FameBonus")) {
                     totalBonus = totalBonus + Number(itemXml.FameBonus);
                  }
               }
            }
            slotIndex++;
         }
         return totalBonus / 100;
      }

      public function calculateStatBoosts() : void {
         var statTypeValue:* = undefined;
         var equipId:int = 0;
         var itemXml:* = null;
         var activateEntry:* = null;
         var statType:int = 0;
         var statAmount:int = 0;
         var slotIndex:int = 0;
         this.maxHPBoost_ = 0;
         this.maxMPBoost_ = 0;
         this.attackBoost_ = 0;
         this.defenseBoost_ = 0;
         this.speedBoost_ = 0;
         this.vitalityBoost_ = 0;
         this.wisdomBoost_ = 0;
         this.dexterityBoost_ = 0;
         while(slotIndex < 4) {
            if(equipment_ && equipment_.length > slotIndex) {
               equipId = equipment_[slotIndex];
               if(equipId != -1) {
                  itemXml = ObjectLibrary.xmlLibrary_[equipId];
                  if(itemXml != null && itemXml.hasOwnProperty("ActivateOnEquip")) {
                     for each(activateEntry in itemXml.ActivateOnEquip) {
                        if(activateEntry.toString() == "IncrementStat") {
                           statType = activateEntry.@stat;
                           statAmount = activateEntry.@amount;
                           statTypeValue = statType;
                           var statTypeSwitch:* = statTypeValue;
                           switch(statTypeSwitch) {
                              case 0:
                                 this.maxHPBoost_ = this.maxHPBoost_ + statAmount;
                                 continue;
                              case 3:
                                 this.maxMPBoost_ = this.maxMPBoost_ + statAmount;
                                 continue;
                              case 20:
                                 this.attackBoost_ = this.attackBoost_ + statAmount;
                                 continue;
                              case 21:
                                 this.defenseBoost_ = this.defenseBoost_ + statAmount;
                                 continue;
                              case 22:
                                 this.speedBoost_ = this.speedBoost_ + statAmount;
                                 continue;
                              case 26:
                                 this.vitalityBoost_ = this.vitalityBoost_ + statAmount;
                                 continue;
                              case 27:
                                 this.wisdomBoost_ = this.wisdomBoost_ + statAmount;
                                 continue;
                              case 28:
                                 this.dexterityBoost_ = this.dexterityBoost_ + statAmount;
                              default:
                                 continue;
                           }
                        } else {
                           continue;
                        }
                     }
                  }
               }
            }
            slotIndex++;
         }
      }

      public function setRelativeMovement(rotate:Number, moveX:Number, moveY:Number) : void {
         var origX:Number = NaN;
         this.manualMovementInput_ = false;
         this.rotate_ = rotate;
         if(!this.relMoveVec_) {
            this.relMoveVec_ = new Point();
         }
         this.relMoveVec_.x = moveX;
         this.relMoveVec_.y = moveY;
         if(this.isConfused) {
            origX = this.relMoveVec_.x;
            this.relMoveVec_.x = -this.relMoveVec_.y;
            this.relMoveVec_.y = -origX;
            this.rotate_ = -this.rotate_;
         }
      }

      public function setManualRelativeMovement(rotate:Number, moveX:Number,
                                                 moveY:Number) : void {
         this.setRelativeMovement(rotate,moveX,moveY);
         this.manualMovementInput_ = moveX != 0 || moveY != 0;
      }

      public function hasManualMovementInput() : Boolean {
         return this.manualMovementInput_;
      }

      /**
       * Acquire the moving Moonlight Village encounter lantern and maintain a
       * small hysteretic orbit around it. Returning true means a valid lantern
       * owns automated intent this frame; physical keyboard movement remains
       * authoritative in update().
       */
      private function updateMoonlightLanternFollow(time:int) : Boolean {
         var gameMap:Map = this.map_ as Map;
         if(gameMap == null || gameMap.name_ != Map.MOONLIGHT_VILLAGE ||
               Parameters.data.autoDodgeFollowLantern !== true ||
               Parameters.data.autoDodge !== true ||
               Parameters.data.autoDodgePredictive !== true) {
            this.moonlightLanternVector_.setTo(0,0);
            this.moonlightLanternMoving_ = false;
            this.moonlightLanternTargetId_ = -1;
            return false;
         }
         var lantern:GameObject = gameMap.getMoonlightLanternTarget(this.x_,this.y_);
         if(lantern == null) {
            this.moonlightLanternVector_.setTo(0,0);
            this.moonlightLanternMoving_ = false;
            this.moonlightLanternTargetId_ = -1;
            return false;
         }
         var targetChanged:Boolean = lantern.objectId_ !=
               this.moonlightLanternTargetId_;
         this.moonlightLanternTargetId_ = lantern.objectId_;
         var dx:Number = lantern.x_ - this.x_;
         var dy:Number = lantern.y_ - this.y_;
         var distance:Number = Math.sqrt(dx * dx + dy * dy);
         var wasMoving:Boolean = this.moonlightLanternMoving_;
         if(targetChanged) {
            this.moonlightLanternMoving_ = distance >
                  MOONLIGHT_LANTERN_STOP_DISTANCE;
         } else if(this.moonlightLanternMoving_) {
            if(distance <= MOONLIGHT_LANTERN_STOP_DISTANCE) {
               this.moonlightLanternMoving_ = false;
            }
         } else if(distance >= MOONLIGHT_LANTERN_RESUME_DISTANCE) {
            this.moonlightLanternMoving_ = true;
         }
         if(this.moonlightLanternMoving_) {
            this.moonlightLanternVector_.setTo(dx,dy);
         } else {
            this.moonlightLanternVector_.setTo(0,0);
         }
         if(Parameters.data.autoDodgeDebug && (targetChanged ||
               wasMoving != this.moonlightLanternMoving_ ||
               time - this.moonlightLanternLogTime_ >= 2000)) {
            this.moonlightLanternLogTime_ = time;
            DebugLog.event("moonlight_lantern_follow",{
                  "targetId":lantern.objectId_,
                  "targetType":lantern.objectType_,
                  "distance":distance,
                  "moving":this.moonlightLanternMoving_,
                  "manualOverride":this.manualMovementInput_
            });
         }
         return true;
      }

      public function setCredits(amount:int) : void {
         this.credits_ = amount;
         this.creditsWereChanged.dispatch();
      }

      public function setFame(amount:int) : void {
         this.fame_ = amount;
         this.fameWasChanged.dispatch();
      }

      public function setSupporterFlag(flag:int) : void {
         this.supporterFlag = flag;
         this.supporterFlagWasChanged.dispatch();
      }

      public function hasSupporterFeature(feature:int) : Boolean {
         return (this.supporterFlag & feature) == feature;
      }

      public function setGuildName(guildName:String) : void {
         var otherObj:* = null;
         var otherPlayer:* = null;
         var sameGuild:Boolean = false;
         this.guildName_ = guildName;
         var localPlayer:Player = map_.player_;
         if(localPlayer == this) {
            for each(otherObj in map_.goDict_) {
               otherPlayer = otherObj as Player;
               if(otherPlayer != null && otherPlayer != this) {
                  otherPlayer.setGuildName(otherPlayer.guildName_);
               }
            }
         } else {
            sameGuild = localPlayer && localPlayer.guildName_ && localPlayer.guildName_ != "" && localPlayer.guildName_ == this.guildName_;
            if(sameGuild != this.isFellowGuild_) {
               this.isFellowGuild_ = sameGuild;
               if(this.nameBitmapData_) {
                  this.nameBitmapData_.dispose();
               }
               this.nameBitmapData_ = null;
            }
         }
      }

      public function isTeleportEligible(player:Player) : Boolean {
         return !(player.dead_ || player.isInvisible);
      }

      public function msUtilTeleport() : int {
         var now:int = TimeUtil.getTrueTime();
         return Math.max(0,this.nextTeleportAt_ - now);
      }

      public function teleportTo(player:Player) : Boolean {
         map_.gs_.gsc_.teleport(player.objectId_);
         return true;
      }

      public function levelUpEffect(text:String, showParticles:Boolean = true) : void {
         if(showParticles && !Parameters.data.noParticlesMaster) {
            this.levelUpParticleEffect();
         }
         var statusText:CharacterStatusText = new CharacterStatusText(this,65280,2000);
         statusText.setText(text);
         map_.mapOverlay_.addStatusText(statusText);
      }

      public function handleLevelUp(newClassUnlocked:Boolean) : void {
         SoundEffectLibrary.play("level_up");
         if(newClassUnlocked) {
            this.levelUpEffect("New Class Unlocked!",false);
            this.levelUpEffect("Level Up!");
         } else {
            this.levelUpEffect("Level Up!");
         }
         if(this == this.map_.player_) {
            this.resetClientHpPrediction(this.maxHP_);
         }
      }

      public function levelUpParticleEffect(color:uint = 4278255360) : void {
         map_.addObj(new LevelUpEffect(this,color,20),x_,y_);
      }

      public function handleExpUp(exp:int) : void {
         if(level_ == 20 && !bForceExp()) {
            return;
         }
         var statusText:CharacterStatusText = new CharacterStatusText(this,65280,1000);
         statusText.setText("+" + exp + " EXP");
         map_.mapOverlay_.addStatusText(statusText);
      }

      public function updateFame(fame:int) : void {
         var statusText:CharacterStatusText = new CharacterStatusText(this,14835456,2000);
         statusText.setText("+" + fame + " Fame");
         map_.mapOverlay_.addStatusText(statusText);
      }

      public function walkTo(x:Number, y:Number) : Boolean {
         this.modifyMove(x,y,newP);
         if(Math.abs(newP.x - walkPos.x) <= 0.1 && Math.abs(newP.y - walkPos.y) <= 0.1) {
         this.walkPos.setTo(0,0);
         }
         return this.moveTo(newP.x,newP.y);
      }

      public function smoothWalkTo(x:Number, y:Number) : Boolean {
         var dx:Number = x - this.x_;
         var dy:Number = y - this.y_;
         var distance:Number = Math.sqrt(dx * dx + dy * dy);
         if(distance < 0.000001) {
            this.smoothWalkSide_ = 0;
            this.smoothWalkActive_ = false;
            return this.moveTo(this.x_,this.y_);
         }
         var intendedAngle:Number = Math.atan2(dy,dx);
         // The caller supplies this frame's destination, not a long-range path
         // target. Looking six complete steps ahead crosses the next BFS corner
         // in one-tile Castle corridors and makes Smooth Walk steer away from an
         // otherwise valid route. Retain only a short local obstacle preview so
         // it cannot inspect several movement steps beyond the current heading.
         var probeDistance:Number = Math.max(0.2,Math.min(0.35,distance));
         if(this.smoothPathClear(intendedAngle,probeDistance)) {
            if(this.smoothWalkActive_ && Parameters.data.autoDodgeDebug) {
               DebugLog.event("smooth_walk_clear",{"x":this.x_,"y":this.y_});
            }
            this.smoothWalkSide_ = 0;
            this.smoothWalkActive_ = false;
            this.modifyMove(x,y,newP);
            return this.moveTo(newP.x,newP.y);
         }

         var bestScore:Number = Number.NEGATIVE_INFINITY;
         var bestX:Number = this.x_;
         var bestY:Number = this.y_;
         var bestSide:int = 0;
         // Gradually bend toward the wall tangent. The retained side receives a
         // small bias, so noisy half-tile collision boundaries cannot make the
         // player alternate around the same obstacle every frame.
         for(var sidePass:int = 0; sidePass < 2; sidePass++) {
            var side:int = sidePass == 0 ?
                  (this.smoothWalkSide_ != 0 ? this.smoothWalkSide_ : 1) :
                  (this.smoothWalkSide_ != 0 ? -this.smoothWalkSide_ : -1);
            for(var degrees:int = 20; degrees <= 100; degrees += 10) {
               var angle:Number = intendedAngle + side * degrees * Math.PI / 180;
               if(!this.smoothPathClear(angle,probeDistance)) {
                  continue;
               }
               this.modifyMove(this.x_ + Math.cos(angle) * distance,
                     this.y_ + Math.sin(angle) * distance,newP);
               var movedX:Number = newP.x - this.x_;
               var movedY:Number = newP.y - this.y_;
               var movedDistance:Number = Math.sqrt(movedX * movedX + movedY * movedY);
               if(movedDistance < distance * 0.35) {
                  continue;
               }
               var forward:Number = (movedX * dx + movedY * dy) / distance;
               var score:Number = movedDistance + forward * 1.5 - degrees * 0.0001;
               if(side == this.smoothWalkSide_) {
                  score += 0.05;
               }
               if(score > bestScore) {
                  bestScore = score;
                  bestX = newP.x;
                  bestY = newP.y;
                  bestSide = side;
               }
            }
         }
         if(bestSide != 0) {
            if(!this.smoothWalkActive_ && Parameters.data.autoDodgeDebug) {
               DebugLog.event("smooth_walk_steer",{
                     "x":this.x_,"y":this.y_,"side":bestSide,
                     "requestedAngle":intendedAngle,
                     "stepDistance":distance,"probeDistance":probeDistance});
            }
            this.smoothWalkSide_ = bestSide;
            this.smoothWalkActive_ = true;
            return this.moveTo(bestX,bestY);
         }
         // Preserve the normal collision clamp if neither side is currently
         // available. Do not use that fallback when it would cross damaging
         // ground: Smooth Walk is the post-planner stage, so no later safety
         // pass can repair the rotated movement.
         if(this.shouldSmoothWalkAvoidGround() &&
               !this.smoothGroundPathClear(intendedAngle,distance)) {
            this.smoothWalkSide_ = 0;
            this.smoothWalkActive_ = false;
            return this.moveTo(this.x_,this.y_);
         }
         this.modifyMove(x,y,newP);
         return this.moveTo(newP.x,newP.y);
      }

      private function smoothPathClear(angle:Number, distance:Number) : Boolean {
         var steps:int = Math.max(1,Math.ceil(distance / 0.1));
         var avoidDamagingGround:Boolean = this.shouldSmoothWalkAvoidGround();
         var reachedSafeGround:Boolean = !avoidDamagingGround ||
               !this.map_.isDamagingGround(this.x_,this.y_);
         for(var step:int = 1; step <= steps; step++) {
            var sampleDistance:Number = distance * step / steps;
            var sampleX:Number = this.x_ + Math.cos(angle) * sampleDistance;
            var sampleY:Number = this.y_ + Math.sin(angle) * sampleDistance;
            if(!this.isValidPosition(sampleX,sampleY)) {
               return false;
            }
            if(avoidDamagingGround) {
               var damagingGround:Boolean = this.map_.isDamagingGround(
                     sampleX,sampleY);
               if(damagingGround && reachedSafeGround) {
                  return false;
               }
               if(!damagingGround) {
                  reachedSafeGround = true;
               }
            }
         }
         return true;
      }

      /** Smooth Walk executes after Auto Dodge evaluates the original intent.
       * During Auto Play it therefore has to preserve Auto Dodge's ground-safety
       * contract itself, even when the separate Safe Walk option is disabled. */
      private function shouldSmoothWalkAvoidGround() : Boolean {
         return Parameters.data.safeWalk || Parameters.data.autoPlay == true &&
               Parameters.data.autoDodgeAvoidGround !== false;
      }

      private function smoothGroundPathClear(angle:Number,
                                             distance:Number) : Boolean {
         var steps:int = Math.max(1,Math.ceil(distance / 0.1));
         var reachedSafeGround:Boolean =
               !this.map_.isDamagingGround(this.x_,this.y_);
         for(var step:int = 1; step <= steps; step++) {
            var sampleDistance:Number = distance * step / steps;
            var damagingGround:Boolean = this.map_.isDamagingGround(
                  this.x_ + Math.cos(angle) * sampleDistance,
                  this.y_ + Math.sin(angle) * sampleDistance);
            if(damagingGround && reachedSafeGround) {
               return false;
            }
            if(!damagingGround) {
               reachedSafeGround = true;
            }
         }
         return true;
      }

      public function walkTo_follow(x:Number, y:Number) : Boolean {
         var followDistX:Number = NaN;
         var followDistY:Number = NaN;
         var stepDistX:Number = NaN;
         var stepDistY:Number = NaN;
         this.modifyMove(x,y,newP);
         if(Parameters.followingName || Parameters.questFollow) {
            if(!this.followLanded && isValidPosition(this.followPos.x,this.followPos.y)) {
               followDistX = Math.abs(this.x_ - this.followPos.x);
               followDistY = Math.abs(this.y_ - this.followPos.y);
               stepDistX = Math.abs(this.x_ - newP.x);
               stepDistY = Math.abs(this.y_ - newP.y);
               if(stepDistX >= followDistX && stepDistY >= followDistY) {
                  newP.x = followPos.x;
                  newP.y = followPos.y;
                  this.followLanded = true;
               }
            }
         }
         return this.moveTo(newP.x,newP.y);
      }

      public function modifyMove(targetX:Number, targetY:Number, out:Point) : void {
         var done:Boolean = false;
         if(this.isParalyzed || (this.isPetrified && !Parameters.data.ignorePetrified)) {
            out.x = x_;
            out.y = y_;
            return;
         }
         var dx:Number = targetX - x_;
         var dy:Number = targetY - y_;
         if(dx < 0.4 && dx > -0.4 && dy < 0.4 && dy > -0.4) {
            this.modifyStep(targetX,targetY,out);
            return;
         }
         var stepFraction:Number = 0.4 / Math.max(Math.abs(dx),Math.abs(dy));
         var progress:* = 0;
         out.x = x_;
         out.y = y_;
         while(!done) {
            if(progress + stepFraction >= 1) {
               stepFraction = 1 - progress;
               done = true;
            }
            this.modifyStep(out.x + dx * stepFraction,out.y + dy * stepFraction,out);
            progress = Number(progress + stepFraction);
         }
      }

      /** Resolve a short Auto Dodge probe with the exact movement collision
       * code used by walkTo(), without letting ice-wall collision handling
       * mutate the player's real movement vector. */
      public function previewAutoDodgeMove(targetX:Number, targetY:Number,
                                           out:Point) : void {
         var savedMoveX:Number = this.moveVec_.x;
         var savedMoveY:Number = this.moveVec_.y;
         var savedMoveZ:Number = this.moveVec_.z;
         this.modifyMove(targetX,targetY,out);
         this.moveVec_.x = savedMoveX;
         this.moveVec_.y = savedMoveY;
         this.moveVec_.z = savedMoveZ;
      }

      public function modifyStep(targetX:Number, targetY:Number, out:Point) : void {
         var clampX:Number = NaN;
         var clampY:Number = NaN;
         var crossX:Boolean = x_ % 0.5 == 0 && targetX != x_ || int(x_ / 0.5) != int(targetX / 0.5);
         var crossY:Boolean = y_ % 0.5 == 0 && targetY != y_ || int(y_ / 0.5) != int(targetY / 0.5);
         if(!crossX && !crossY || this.isValidPosition(targetX,targetY)) {
            out.x = targetX;
            out.y = targetY;
            return;
         }
         if(crossX) {
            clampX = targetX > x_?int(targetX * 2) / 2:Number(int(x_ * 2) / 2);
            if(int(clampX) > int(x_)) {
               clampX = clampX - 0.01;
            }
         }
         if(crossY) {
            clampY = targetY > y_?int(targetY * 2) / 2:Number(int(y_ * 2) / 2);
            if(int(clampY) > int(y_)) {
               clampY = clampY - 0.01;
            }
         }
         if(!crossX) {
            out.x = targetX;
            out.y = clampY;
            if(square != null && square.props_.slideAmount_ != 0) {
               this.resetMoveVector(false);
            }
            return;
         }
         if(!crossY) {
            out.x = clampX;
            out.y = targetY;
            if(square != null && square.props_.slideAmount_ != 0) {
               this.resetMoveVector(true);
            }
            return;
         }
         var overX:Number = targetX > x_?targetX - clampX:Number(clampX - targetX);
         var overY:Number = targetY > y_?targetY - clampY:Number(clampY - targetY);
         if(overX > overY) {
            if(this.isValidPosition(targetX,clampY)) {
               out.x = targetX;
               out.y = clampY;
               return;
            }
            if(this.isValidPosition(clampX,targetY)) {
               out.x = clampX;
               out.y = targetY;
               return;
            }
         } else {
            if(this.isValidPosition(clampX,targetY)) {
               out.x = clampX;
               out.y = targetY;
               return;
            }
            if(this.isValidPosition(targetX,clampY)) {
               out.x = targetX;
               out.y = clampY;
               return;
            }
         }
         out.x = clampX;
         out.y = clampY;
      }

      public function isValidPosition(x:Number, y:Number) : Boolean {
         if(Parameters.data.noClip) {
            return true;
         }
         var targetSquare:Square = map_.getSquare(x,y);
         if(square != targetSquare && (targetSquare == null || !targetSquare.isWalkable())) {
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
         if(fracX < collisionHalfSize) {
            if(this.isFullOccupy(x - 1,y)) {
               return false;
            }
            if(fracY < collisionHalfSize) {
               if(this.isFullOccupy(x,y - 1) || this.isFullOccupy(x - 1,y - 1)) {
                  return false;
               }
            } else if(fracY > collisionUpperBound) {
               if(this.isFullOccupy(x,y + 1) || this.isFullOccupy(x - 1,y + 1)) {
                  return false;
               }
            }
         } else if(fracX > collisionUpperBound) {
            if(this.isFullOccupy(x + 1,y)) {
               return false;
            }
            if(fracY < collisionHalfSize) {
               if(this.isFullOccupy(x,y - 1) || this.isFullOccupy(x + 1,y - 1)) {
                  return false;
               }
            } else if(fracY > collisionUpperBound) {
               if(this.isFullOccupy(x,y + 1) || this.isFullOccupy(x + 1,y + 1)) {
                  return false;
               }
            }
         } else if(fracY < collisionHalfSize) {
            if(this.isFullOccupy(x,y - 1)) {
               return false;
            }
         } else if(fracY > collisionUpperBound) {
            if(this.isFullOccupy(x,y + 1)) {
               return false;
            }
         }
         return true;
      }

      public function isFullOccupy(x:Number, y:Number) : Boolean {
         var lookedUpSquare:Square = map_.lookupSquare(x,y);
         return lookedUpSquare == null || lookedUpSquare.tileType == 255 || lookedUpSquare.obj_ != null && lookedUpSquare.obj_.props_.fullOccupy_;
      }

      public function follow(x:Number, y:Number) : void {
         followVec.x = followPos.x - x_;
         followVec.y = followPos.y - y_;
      }

      public function calcFollowPos() : Point {
         var clusterSize:int = 0;
         var neighborPlayer:* = null;
         var anchorObj:* = null;
         var neighborObj:* = null;
         var bestCenter:Point = new Point();
         var bestVel:Point = new Point();
         var centerSum:Point = new Point();
         var velSum:Point = new Point();
         var clusterCount:int = -2147483648;
         var bestCount:* = -2147483648;
         var distSq:* = 0;
         var densityThresholdSq:Number = Parameters.data.densityThreshold * Parameters.data.densityThreshold;
         for each(anchorObj in this.map_.vulnPlayerDict_) {
            if(anchorObj != this) {
               distSq = 100000000000;
               clusterSize = 0;
               clusterCount = 0;
               centerSum.x = 0;
               centerSum.y = 0;
               velSum.x = 0;
               velSum.y = 0;
               for each(neighborObj in this.map_.vulnPlayerDict_) {
                  if(neighborObj != this && neighborObj != anchorObj) {
                     neighborPlayer = neighborObj as Player;
                     if(!(neighborPlayer.numStars_ < 3 && neighborPlayer.currFame_ < 100)) {
                        distSq = getDistSquared(neighborObj.x_,neighborObj.y_,anchorObj.x_,anchorObj.y_);
                        if(distSq < densityThresholdSq) {
                           clusterCount++;
                           clusterSize++;
                           centerSum.x = centerSum.x + neighborObj.x_;
                           centerSum.y = centerSum.y + neighborObj.y_;
                           velSum.x = velSum.x + neighborObj.moveVec_.x;
                           velSum.y = velSum.y + neighborObj.moveVec_.y;
                        }
                     }
                  }
               }
               if(clusterSize != 0) {
                  centerSum.x = centerSum.x / clusterSize;
                  centerSum.y = centerSum.y / clusterSize;
                  velSum.x = velSum.x / clusterSize;
                  velSum.y = velSum.y / clusterSize;
                  if(clusterCount > bestCount) {
                     bestCount = clusterCount;
                     bestCenter.x = centerSum.x;
                     bestCenter.y = centerSum.y;
                     bestVel.x = velSum.x;
                     bestVel.y = velSum.y;
                  }
               }
            }
         }
         if(bestCount < 3) {
            Parameters.warnDensity = true;
            return new Point(followPos.x,followPos.y);
         }
         Parameters.warnDensity = true;
         if(bestVel.length > 1) {
            bestVel.normalize(1);
         }
         var trainOffsetFrac:* = Parameters.data.trainOffset * 0.01;
         var targetX:Number = bestCenter.x + bestVel.x * (densityThresholdSq * trainOffsetFrac) + Parameters.famePoint.x;
         var targetY:Number = bestCenter.y + bestVel.y * (densityThresholdSq * trainOffsetFrac) + Parameters.famePoint.y;
         var deltaX:Number = targetX - centerSum.x;
         var deltaY:Number = targetY - centerSum.y;
         if(deltaX * deltaX + deltaY * deltaY >= Parameters.data.fameDistDelta * Parameters.data.fameDistDelta) {
            centerSum.x = targetX;
            centerSum.y = targetY;
         } else {
            centerSum.x = x_;
            centerSum.y = y_;
         }
         return centerSum;
      }

      public function dungeonMove() : void {
      }

      public function teleToClosestPoint(targetPoint:Point) : void {
         var distSq:Number = NaN;
         var bestDistSq:* = Infinity;
         var bestObjectId:int = -1;
         for each(var candidate:GameObject in this.map_.goDict_) {
            if(candidate is Player && !candidate.isInvisible) {
               distSq = (candidate.x_ - targetPoint.x) * (candidate.x_ - targetPoint.x) + (candidate.y_ - targetPoint.y) * (candidate.y_ - targetPoint.y);
               if(distSq < bestDistSq) {
                  bestDistSq = distSq;
                  bestObjectId = candidate.objectId_;
               }
            }
         }
         if(bestObjectId == this.objectId_) {
            this.textNotification("You are closest!",16777215,1500,false);
            return;
         }
         this.map_.gs_.gsc_.teleport(bestObjectId);
         this.textNotification("Teleporting to " + this.map_.goDict_[bestObjectId].name_,16777215,1500,false);
      }

      public function attemptAttackAngle(angleOffset:Number) : void {
         if(this.equipment_[0] == -1) {
            return;
         }
         this.shoot(Parameters.data.cameraAngle + angleOffset);
      }

      public function attemptAutoAim(angleOffset:Number) : void {
         var weaponId:int = this.equipment_[0];
         var now:int = TimeUtil.getModdedTime();
         if(weaponId != -1) {
            if(Parameters.data.AAOn) {
               if(!this.shootAutoAimWeaponAngle(weaponId,now) && this.map_.gs_.mui_.autofire_ && !this.map_.gs_.isSafeMap) {
                  this.shoot(Parameters.data.cameraAngle + angleOffset,now);
               }
            } else if(this.map_.gs_.mui_.autofire_) {
               this.shoot(Parameters.data.cameraAngle + angleOffset,now);
            }
         }
         this.attemptAutoAbility(angleOffset,now,this.equipment_[1]);
      }

      public function attemptAutoAbility(angleOffset:Number, time:int = -1, abilityId:int = 0) : void {
         if(abilityId == 0) {
            abilityId = this.equipment_[1];
         }
         if(time == -1) {
            time = map_.gs_.lastUpdate_;
         }
         // Hold off while the server is refusing this ability (see
         // noteAbilityUseResult) — re-firing at ~2/s is what got us kicked.
         if(this.abilitySuppressUntil_ != 0 && getTimer() < this.abilitySuppressUntil_) {
            return;
         }
         if(abilityId != -1 && Parameters.data.AutoAbilityOn && !this.map_.gs_.isSafeMap && Parameters.abi && this.mp_ >= this.autoMpPercentNumber) {
            // Don't re-cast a self-buff ability (Warrior Berserk/Damaging/Speedy,
            // Rogue Invisible, ...) while its buff is still up — that just wastes MP
            // re-applying the same condition every time MP refills. Offensive /
            // utility abilities (no self ConditionEffect) are unaffected.
            if(this.abilitySelfBuffStillActive(ObjectLibrary.xmlLibrary_[abilityId])) {
               return;
            }
            this.shootAutoAimAbilityAngle(abilityId,time);
         }
      }

      /**
       * True if `abilityXml` grants one or more SELF condition effects and ALL of
       * them are currently active on the player — i.e. the buff from the previous
       * use hasn't worn off, so auto-ability should hold instead of re-casting.
       * Covers both self-buff activate forms: ConditionEffectSelf (@effect) and
       * Sneak (@conditionEffect). Returns false for abilities with no self buff.
       */
      private function abilitySelfBuffStillActive(abilityXml:XML) : Boolean {
         if(abilityXml == null) {
            return false;
         }
         var granted:int = 0;
         var active:int = 0;
         var effName:String = null;
         var idx:int = 0;
         var found:int = 0;
         var bit:uint = 0;
         var act:XML = null;
         var kind:String = null;
         for each(act in abilityXml.Activate) {
            kind = String(act);
            if(kind != "ConditionEffectSelf" && kind != "Sneak") {
               continue;
            }
            effName = String(act.@effect) != "" ? String(act.@effect) : String(act.@conditionEffect);
            if(effName == "") {
               continue;
            }
            found = -1;
            for(idx = 0; idx < ConditionEffect.effects_.length; idx++) {
               if(ConditionEffect.effects_[idx].name_ == effName) {
                  found = idx;
                  break;
               }
            }
            if(found < 0) {
               continue;
            }
            bit = ConditionEffect.effects_[found].bit_;
            granted++;
            if(found < ConditionEffect.NEW_CON_THRESHOLD
                  ? (this.condition_[0] & bit) != 0
                  : (this.condition_[1] & bit) != 0) {
               active++;
            }
         }
         return granted > 0 && active == granted;
      }

      public function shootAutoAimWeaponAngle(weaponType:int, time:int) : Boolean {
         var aimPoint:* = null;
         var aimAngle:Number = NaN;
         if(this.isStunned_() || (this.isPetrified_() && !Parameters.data.ignorePetrified)) {
            return false;
         }
         var props:ObjectProperties = ObjectLibrary.getPropsFromType(weaponType);
         this.attackPeriod_ = this.weaponAttackPeriod(weaponType);
         if(time < attackStart_ + this.attackPeriod_) {
            return false;
         }
         // This field is also Auto Play's proof that Auto Aim has acquired a
         // target. Do not leave the previous dead target latched across a fresh
         // scan that finds nothing.
         this.killAuraTarget_ = null;
         this.autoAimSelfPos_.setTo(this.x_,this.y_,0);
         var selfPos:Vector3D = this.autoAimSelfPos_;
         var worldMouse:Point = this.sToW(this.mousePos_.x,this.mousePos_.y);
         this.autoAimTargetPos_.setTo(worldMouse.x,worldMouse.y,0);
         var aimTarget:Vector3D = this.autoAimTargetPos_;
         var projProps:ProjectileProperties = props.projectiles_[0];
         if(this.isUnstable) {
            this.attackStart_ = time;
            this.attackAngle_ = Math.random() * 6.28318530717959;
            this.doShoot(this.attackStart_,weaponType,ObjectLibrary.xmlLibrary_[weaponType],this.attackAngle_,true,true,true);
            return true;
         }
         // These values are stable for the complete shot. Reusing them avoids
         // traversing the projectile curve twice on every Auto Aim attack.
         var projectileSpeed:Number = projProps.calcAvgSpeed(
               this.projectileSpeedMult,this.projectileLifeMult);
         aimPoint = this.calcAimAngle(projectileSpeed,
                 projProps.calcMaxRange(this.projectileSpeedMult, this.projectileLifeMult) +
                 Parameters.data.aaDistance + Parameters.extendShotTiles(), selfPos, aimTarget);
         if(aimPoint) {
            var selectedAimTarget:GameObject = this.lastCalcAimTarget_;
            this.killAuraTarget_ = selectedAimTarget;
            if(!Parameters.data.AATargetLead) {
               this.lastAutoAimLeadMs_ = 0;
               this.lastAutoAimTurnRate_ = 0;
            }
            var _killPos:Vector3D = aimPoint;
            if(Parameters.data.extendShot && selectedAimTarget != null) {
               // Extend Shot advances only part of many long shots (the log had
               // 6-10 tiles still to travel). Retargeting those shots to the
               // enemy's current position discarded all lead. Iterate the lead
               // from the actual advanced origin instead.
               _killPos = this.solveExtendedAim(selectedAimTarget,projectileSpeed);
            }
            aimAngle = Math.atan2(_killPos.y - this.y_,_killPos.x - this.x_);
            this.attackStart_ = time;
            this.attackAngle_ = aimAngle;
            // Advance the shot origin toward the target (see killAuraAdvance) so the
            // projectiles spawn near the enemy and converge, instead of diverging
            // over the extended travel. Consumed by doShoot -> doShootAttack/Legacy
            // for this shot only, then reset.
            this.extendShotOrigin_ = this.killAuraAdvance(_killPos.x,_killPos.y);
            // Remaining origin->target distance drives the convergence in
            // doShootAttack/Legacy: how wide to fan so all bullets still hit.
            var _dx:Number = _killPos.x - this.x_;
            var _dy:Number = _killPos.y - this.y_;
            this.extendShotRemain_ = Math.sqrt(_dx * _dx + _dy * _dy) - (0.3 + this.extendShotOrigin_);
            // Auto Aim solution and Kill-Aura spread tracing were useful while
            // tuning moving-target lead, but their per-shot Object allocations
            // and periodic file writes are intentionally disabled for play.
            this.doShoot(this.attackStart_,weaponType,ObjectLibrary.xmlLibrary_[weaponType],aimAngle,true,true,true);
            this.extendShotOrigin_ = 0;
            this.extendShotRemain_ = 0;
            return true;
         }
         this.isShooting = false;
         return false;
      }

      /**
       * Extend Shot "kill-aura": how far (tiles) to push the shot origin toward a
       * target at (tx,ty) — up to Extend Range from the player, and never past the
       * target. Placing the origin near the enemy makes multi-projectile weapons
       * converge on it and puts the shot within the extended reach; the advanced
       * origin also becomes the PLAYERSHOOT startingPos (via the projectile's x_/y_).
       */
      public function killAuraAdvance(tx:Number, ty:Number) : Number {
         if(!Parameters.data.extendShot) {
            return 0;
         }
         var ext:Number = Parameters.extendShotTiles();
         if(ext <= 0) {
            return 0;
         }
         var dx:Number = tx - this.x_;
         var dy:Number = ty - this.y_;
         var adv:Number = Math.sqrt(dx * dx + dy * dy) - 0.3;   // stop just short of the target
         if(adv <= 0) {
            return 0;
         }
         return adv < ext ? adv : ext;
      }

      /** Re-solve a moving target from the advanced Extend Shot origin. The
       * origin depends on the predicted target, so a few fixed-point iterations
       * keep both the packet origin and the intercept angle on the same solution. */
      private function solveExtendedAim(target:GameObject,
                                        projectileSpeed:Number) : Vector3D {
         var estimate:Vector3D = Parameters.data.AATargetLead ?
               this.leadEnemy(this.autoAimSelfPos_,target,projectileSpeed) :
               new Vector3D(target.x_,target.y_);
         if(estimate == null) {
            estimate = new Vector3D(target.x_,target.y_);
         }
         for(var iteration:int = 0; iteration < 3; iteration++) {
            var dx:Number = estimate.x - this.x_;
            var dy:Number = estimate.y - this.y_;
            var distance:Number = Math.sqrt(dx * dx + dy * dy);
            if(distance <= 0.000001) {
               break;
            }
            var advance:Number = this.killAuraAdvance(estimate.x,estimate.y);
            this.extendAimOrigin_.setTo(this.x_ + dx / distance * advance,
                  this.y_ + dy / distance * advance,0);
            var refined:Vector3D = Parameters.data.AATargetLead ?
                  this.leadEnemy(this.extendAimOrigin_,target,projectileSpeed) :
                  new Vector3D(target.x_,target.y_);
            if(refined == null) {
               break;
            }
            estimate = refined;
         }
         return estimate;
      }

      public function shootAutoAimAbilityAngle(abilityId:int, time:int) : void {
         var spamThreshold:int = 0;
         var enemyCount:int = 0;
         var aimVec:* = null;
         var projProps:ProjectileProperties = null;
         var abilityXml:XML = ObjectLibrary.xmlLibrary_[abilityId];
         if(!this.canUseAltWeapon(time,abilityXml)) {
            return;
         }
         if(time - this.lastAutoAbilityAttempt <= 550) {
            return;
         }
         var worldMouse:Point = this.sToW(this.mousePos_.x,this.mousePos_.y);
         time = TimeUtil.getModdedTime();
         var classType:* = this.objectType_;
         var classTypeSwitch:* = classType;
         switch(classTypeSwitch) {
            case 784:
               this.priestHeal(time);
               this.lastAutoAbilityAttempt = time;
               return;
            case 768:
               if(abilityXml.Activate.(text() == "Teleport") == "Teleport") {
                  return;
               }
            case 797:
            case 799:
               this.useAltWeapon(this.x_,this.y_,1,time,true,abilityXml);
               this.lastAutoAbilityAttempt = time;
               return;
            case 806:
               if(!this.isNinjaSpeedy) {
                  this.useAltWeapon(this.x_,this.y_,1,time,true,abilityXml);
                  this.lastAutoAbilityAttempt = time;
               }
               return;
            case 800:
            case 802:
               if(this.necroHeal()) {
                  this.lastAutoAbilityAttempt = time;
               }
               return;
            case 801:
               // Necromancer. The cluster-heal targeting (getNecroTarget) only
               // fires the skull on a big grouped enemy, which the current
               // summon skull (spawns summons in place) rarely meets — so
               // auto-ability never triggered. Try the cluster heal for classic
               // skulls; if there's no target, still use the skull in place so
               // the summons get raised.
               if(!this.necroHeal()) {
                  this.useAltWeapon(this.x_,this.y_,1,time,true,abilityXml);
               }
               this.lastAutoAbilityAttempt = time;
               return;
            case 819:
               // Druid — the sigil is placed in-place (self-cast).
               this.useAltWeapon(this.x_,this.y_,1,time,true,abilityXml);
               this.lastAutoAbilityAttempt = time;
               return;
            case 818:
               // Kensei — the sheathed strike is directional; aim it like the
               // other targeted abilities.
               if(this.isUnstable) {
                  aimVec = null;
               } else {
                  aimVec = this.calcAimAngle(NaN,4.5,new Vector3D(this.x_,this.y_),new Vector3D(worldMouse.x,worldMouse.y));
               }
               if(aimVec) {
                  this.useAltWeapon(aimVec.x,aimVec.y,1,time,true,abilityXml);
                  lastAutoAbilityAttempt = time;
               }
               return;
            case 804:
               if(abilityXml.Activate.(text() == "Teleport") == "Teleport") {
                  return;
               }
               spamThreshold = Parameters.data.spamPrismNumber;
               if(spamThreshold > 0) {
                  enemyCount = 0;
                  for each(var enemyObj:GameObject in this.map_.goDict_) {
                     if(enemyObj.props_.isEnemy_ && this.getDistSquared(this.x_,this.y_,enemyObj.x_,enemyObj.y_) <= 225) {
                        enemyCount++;
                        if(enemyCount > spamThreshold) {
                           this.useAltWeapon(this.x_,this.y_,1,time,true,abilityXml);
                           this.lastAutoAbilityAttempt = time;
                           return;
                        }
                     }
                  }
               }
               return;
            case 798:
            case 775:
               projProps = ObjectLibrary.getPropsFromType(abilityId).projectiles_[0];
               if(projProps) {
                  projProps = ObjectLibrary.getPropsFromType(abilityId).projectiles_[0];
                  if(this.isUnstable) {
                     aimVec = new Vector3D(Math.random() - 0.5,Math.random() - 0.5);
                  } else {
                     aimVec = this.calcAimAngle(projProps.speed,projProps.maxProjTravel_,new Vector3D(this.x_,this.y_),new Vector3D(worldMouse.x,worldMouse.y),true);
                  }
                  if(aimVec) {
                     this.useAltWeapon(aimVec.x,aimVec.y,1,time,true,abilityXml);
                     lastAutoAbilityAttempt = time;
                  }
               }
               return;
            case 805:
               if(this.isUnstable) {
                  aimVec = null;
               } else {
                  aimVec = this.calcAimAngle(NaN,7,new Vector3D(this.x_,this.y_),new Vector3D(worldMouse.x,worldMouse.y));
               }
               if(aimVec) {
                  this.useAltWeapon(aimVec.x,aimVec.y,1,time,true,abilityXml);
                  lastAutoAbilityAttempt = time;
               }
               return;
            case 782:
               if(this.isUnstable) {
                  aimVec = null;
               } else {
                  aimVec = this.calcAimAngle(NaN,12,new Vector3D(this.x_,this.y_),new Vector3D(worldMouse.x,worldMouse.y));
               }
               if(aimVec) {
                  this.useAltWeapon(aimVec.x,aimVec.y,1,time,true,abilityXml);
                  lastAutoAbilityAttempt = time;
               }
               return;
            case 803:
               if(this.isUnstable) {
                  aimVec = new Vector3D(Math.random() - 0.5,Math.random() - 0.5);
               } else if(Parameters.data.mysticAAShootGroup) {
                  if(this.necroHeal()) {
                     this.lastAutoAbilityAttempt = time;
                  }
               } else {
                  this.useAltWeapon(this.x_,this.y_,1,time,true,abilityXml);
                  lastAutoAbilityAttempt = time;
               }
               return;
            case 785:
               if(this.isUnstable) {
                  aimVec = null;
               } else {
                  aimVec = this.calcAimAngle(NaN,getWakiRange(abilityId),new Vector3D(this.x_,this.y_),new Vector3D(worldMouse.x,worldMouse.y));
               }
               if(aimVec) {
                  this.useAltWeapon(aimVec.x,aimVec.y,1,time,true,abilityXml);
                  lastAutoAbilityAttempt = time;
               }
               return;
            default:
               return;
         }
      }

      public function getWakiRange(weaponType:int) : Number {
         var typeValue:* = weaponType;
         var typeSwitch:* = typeValue;
         switch(typeSwitch) {
            case 8994:
               return 4.6;
            case 9152:
               return 6.4;
            default:
               return 4.4;
         }
      }

      // ---- Avoid O3 Shield ----------------------------------------------------
      // Oryx the Mad God 3 (type 0xb133): when players damage him during certain
      // attacks he GUARDS by raising his shield (a distinct sprite). If damage
      // continues during the guard he counters — "You are unfit to speak in my
      // presence!" -> 30s unpurifiable Silence on everyone (RealmEye wiki). The
      // tell is the guard SPRITE (an alt-texture swap), NOT a generic condition
      // bit (messenger Invulnerable/Armored is harmless). Until the exact guard
      // alt-texture id is known, this only CAPTURES O3's sprite+condition state on
      // change (opt-in via hpDebugLog) so a single fight pins it down; then the
      // skip becomes `altTextureId_ == <guard id>`. It does not skip yet.
      private static const ORYX3_TYPE_:int = 0xb133;
      private var lastO3State_:String = "";

      private function isO3ShieldBlocked(enemy:GameObject) : Boolean {
         if(enemy == null || enemy.objectType_ != ORYX3_TYPE_) {
            return false;
         }
         if(Parameters.data.hpDebugLog) {
            var cond:uint = enemy.condition_ != null && enemy.condition_.length > 0 ? enemy.condition_[0] : 0;
            var key:String = cond + "|" + enemy.altTextureId_ + "|" + enemy.textureType_;
            if(key != this.lastO3State_) {
               this.lastO3State_ = key;
               DebugLog.event("o3_state",{"cond":cond,"altTexture":enemy.altTextureId_,
                     "textureType":enemy.textureType_,"hp":enemy.hp_,"maxHp":enemy.maxHP_});
            }
         }
         // Detection pending the real shield sprite/phrase (see o3_state capture).
         return false;
      }

      public function calcAimAngle(speed:Number, range:Number, selfPos:Vector3D, aimTarget:Vector3D, applySpellbombThreshold:Boolean = false) : Vector3D {
         var aimMode:int = 0;
         var candidateCount:int = 0;
         var isBoss:Boolean = false;
         var enemy:GameObject = null;
         var bestPos:* = null;
         var bestTarget:GameObject = null;
         var rangeSq:Number = range * range;
         var aimPos:Vector3D = null;
         var distSq:* = Infinity;
         var bestDistSq:* = Infinity;
         var bestMaxHp:* = -2147483648;
         var bestHp:* = -2147483648;
         var boundingDistSq:int = Parameters.data.AABoundingDist;
         boundingDistSq = boundingDistSq * boundingDistSq;
         var includeIgnored:Boolean = Parameters.data.damageIgnored;
         var aimAtInvulnerable:Boolean = Parameters.data.autoaimAtInvulnerable;
         var shootAtWalls:Boolean = Parameters.data.shootAtWalls;
         var onlyExcepted:Boolean = Parameters.data.onlyAimAtExcepted;
         var targetLead:Boolean = Parameters.data.AATargetLead;
         var spellbombHpThreshold:int = Parameters.data.spellbombHPThreshold;
         var skullHpThreshold:int = Parameters.data.skullHPThreshold;
         var bossPriority:Boolean = Parameters.data.BossPriority;
         var candidates:Vector.<GameObject> = null;
         var keepScanning:Boolean = true;
         do {
            aimMode = Parameters.data.aimMode;
            if(aimMode == 0) {
               for each(enemy in this.map_.vulnEnemyDict_) {
                  aimPos = null;
                  isBoss = enemy.props_.boss_ || enemy.props_.customBoss_;
                  if(!(!shootAtWalls && !(enemy is Character))) {
                     if(!(bossPriority && !isBoss)) {
                        if(!(enemy.dead_ || enemy.props_.ignored && !includeIgnored || !enemy.props_.excepted && onlyExcepted || !aimAtInvulnerable && enemy.isInvulnerable || this.isO3ShieldBlocked(enemy))) {
                           if(isNaN(speed)) {
                              if(!(rangeSq == 144 && enemy.maxHP_ < spellbombHpThreshold)) {
                                 if(!(rangeSq == 49 && enemy.maxHP_ < skullHpThreshold)) {
                                    aimPos = new Vector3D(enemy.tickPosition_.x,enemy.tickPosition_.y);
                                 }
                              }
                           } else if(!(applySpellbombThreshold && enemy.maxHP_ < spellbombHpThreshold)) {
                              if(!targetLead) {
                                 aimPos = new Vector3D(enemy.x_,enemy.y_);
                              } else {
                                 aimPos = this.leadEnemy(selfPos,enemy,speed);
                              }
                           }
                           if(aimPos) {
                              distSq = this.getDistSquared(enemy.x_,enemy.y_,this.x_,this.y_);
                              if(distSq <= rangeSq) {
                                 distSq = this.getDistSquared(enemy.x_,enemy.y_,aimTarget.x,aimTarget.y);
                                 if(distSq <= boundingDistSq) {
                                    if(bossPriority && isBoss) {
                                       keepScanning = false;
                                       bestPos = aimPos;
                                       bestTarget = enemy;
                                    } else if(distSq <= bestDistSq) {
                                       bestDistSq = distSq;
                                       bestPos = aimPos;
                                       bestTarget = enemy;
                                    }
                                 }
                              }
                           }
                        }
                     }
                  }
               }
            } else if(aimMode == 1) {
               for each(enemy in this.map_.vulnEnemyDict_) {
                  aimPos = null;
                  isBoss = enemy.props_.boss_ || enemy.props_.customBoss_;
                  if(!(!shootAtWalls && !(enemy is Character))) {
                     if(!(bossPriority && !isBoss)) {
                        if(!(enemy.dead_ || enemy.props_.ignored && !includeIgnored || !enemy.props_.excepted && onlyExcepted || !aimAtInvulnerable && enemy.isInvulnerable || this.isO3ShieldBlocked(enemy))) {
                           if(isNaN(speed)) {
                              if(!(rangeSq == 144 && enemy.maxHP_ < spellbombHpThreshold)) {
                                 if(!(rangeSq == 49 && enemy.maxHP_ < skullHpThreshold)) {
                                    aimPos = new Vector3D(enemy.tickPosition_.x,enemy.tickPosition_.y);
                                 }
                              }
                           } else if(!targetLead) {
                              aimPos = new Vector3D(enemy.x_,enemy.y_);
                           } else {
                              aimPos = this.leadEnemy(selfPos,enemy,speed);
                           }
                           if(aimPos) {
                              if(enemy.maxHP_ >= bestMaxHp) {
                                 if(enemy.maxHP_ == bestMaxHp) {
                                    if(enemy.hp_ <= bestHp) {
                                       distSq = this.getDistSquared(enemy.x_,enemy.y_,this.x_,this.y_);
                                       if(!(enemy.hp_ == bestHp && distSq > bestDistSq)) {
                                          if(distSq < rangeSq) {
                                             bestMaxHp = enemy.maxHP_;
                                             bestHp = enemy.hp_;
                                             bestPos = aimPos;
                                             bestTarget = enemy;
                                             bestDistSq = distSq;
                                          }
                                       }
                                    }
                                 }
                                 distSq = this.getDistSquared(enemy.x_,enemy.y_,this.x_,this.y_);
                                 if(distSq < rangeSq) {
                                    if(bossPriority && isBoss) {
                                       keepScanning = false;
                                       bestPos = aimPos;
                                       bestTarget = enemy;
                                    } else {
                                       bestMaxHp = enemy.maxHP_;
                                       bestHp = enemy.hp_;
                                       bestDistSq = distSq;
                                       bestPos = aimPos;
                                       bestTarget = enemy;
                                    }
                                 }
                              }
                           }
                        }
                     }
                  }
               }
            } else if(aimMode == 2) {
               for each(enemy in this.map_.vulnEnemyDict_) {
                  aimPos = null;
                  isBoss = enemy.props_.boss_ || enemy.props_.customBoss_;
                  if(!(!shootAtWalls && !(enemy is Character))) {
                     if(!(bossPriority && !isBoss)) {
                        if(!(enemy.dead_ || enemy.props_.ignored && !includeIgnored || !enemy.props_.excepted && onlyExcepted || !aimAtInvulnerable && enemy.isInvulnerable || this.isO3ShieldBlocked(enemy))) {
                           if(isNaN(speed)) {
                              if(!(rangeSq == 144 && enemy.maxHP_ < spellbombHpThreshold)) {
                                 if(!(rangeSq == 49 && enemy.maxHP_ < skullHpThreshold)) {
                                    aimPos = new Vector3D(enemy.tickPosition_.x,enemy.tickPosition_.y);
                                 } else {
                                    continue;
                                 }
                              } else {
                                 continue;
                              }
                           } else if(!targetLead) {
                              aimPos = new Vector3D(enemy.x_,enemy.y_);
                           } else {
                              aimPos = this.leadEnemy(selfPos,enemy,speed);
                           }
                           if(aimPos) {
                              distSq = this.getDistSquared(enemy.x_,enemy.y_,this.x_,this.y_);
                              if(distSq < rangeSq) {
                                 if(bossPriority && isBoss) {
                                    keepScanning = false;
                                    bestPos = aimPos;
                                    bestTarget = enemy;
                                    break;
                                 }
                                 if(distSq < bestDistSq) {
                                    bestDistSq = distSq;
                                    bestPos = aimPos;
                                    bestTarget = enemy;
                                 }
                              }
                           }
                        }
                     }
                  }
               }
            } else if(aimMode == 3) {
               if(candidates == null) {
                  candidates = new Vector.<GameObject>();
               } else {
                  candidates.length = 0;
               }
               candidateCount = 0;
               for each(enemy in this.map_.vulnEnemyDict_) {
                  aimPos = null;
                  isBoss = enemy.props_.boss_ || enemy.props_.customBoss_;
                  if(!(!shootAtWalls && !(enemy is Character))) {
                     if(!(bossPriority && !isBoss)) {
                        if(!(enemy.dead_ || enemy.props_.ignored && !includeIgnored || !enemy.props_.excepted && onlyExcepted || !aimAtInvulnerable && enemy.isInvulnerable || this.isO3ShieldBlocked(enemy))) {
                           if(isNaN(speed)) {
                              if(!(rangeSq == 144 && enemy.maxHP_ < spellbombHpThreshold)) {
                                 if(!(rangeSq == 49 && enemy.maxHP_ < skullHpThreshold)) {
                                    aimPos = new Vector3D(enemy.tickPosition_.x,enemy.tickPosition_.y);
                                 } else {
                                    continue;
                                 }
                              } else {
                                 continue;
                              }
                           } else if(!targetLead) {
                              aimPos = new Vector3D(enemy.x_,enemy.y_);
                           } else {
                              aimPos = this.leadEnemy(selfPos,enemy,speed);
                           }
                           if(aimPos) {
                              distSq = this.getDistSquared(enemy.x_,enemy.y_,this.x_,this.y_);
                              if(distSq < rangeSq) {
                                 if(bossPriority && isBoss) {
                                    keepScanning = false;
                                    bestPos = aimPos;
                                    bestTarget = enemy;
                                    break;
                                 }
                                 candidates.push(enemy);
                                 candidateCount++;
                              }
                           }
                        }
                     }
                  }
               }
               if(candidateCount != 0) {
                  enemy = candidates[int(Math.random() * candidateCount)];
                  if(isNaN(speed)) {
                     aimPos = new Vector3D(enemy.tickPosition_.x,enemy.tickPosition_.y);
                  } else if(!targetLead) {
                     aimPos = new Vector3D(enemy.x_,enemy.y_);
                  } else {
                     aimPos = this.leadEnemy(selfPos,enemy,speed);
                  }
                  bestPos = aimPos;
                  bestTarget = enemy;
               }
            }
            if(bossPriority) {
               if(keepScanning) {
                  bossPriority = false;
               }
            } else {
               keepScanning = false;
            }
         }
         while(keepScanning);

         this.lastCalcAimTarget_ = bestTarget;
         return bestPos;
      }

      public function leadPos(shooterPos:Vector3D, targetPos:Vector3D, targetVel:Vector3D, projSpeed:Number) : Vector3D {
         if(projSpeed <= 0 || isNaN(projSpeed)) {
            return targetPos;
         }
         var toTarget:Vector3D = targetPos.subtract(shooterPos);
         var a:Number = targetVel.dotProduct(targetVel) - projSpeed * projSpeed;
         var b:Number = 2 * toTarget.dotProduct(targetVel);
         var c:Number = toTarget.dotProduct(toTarget);
         var interceptTime:Number = Number.POSITIVE_INFINITY;
         if(Math.abs(a) < 0.0000000001) {
            if(Math.abs(b) > 0.0000000001) {
               var linearTime:Number = -c / b;
               if(linearTime >= 0) interceptTime = linearTime;
            }
         } else {
            var discriminantSq:Number = b * b - 4 * a * c;
            if(discriminantSq >= 0) {
               var discriminant:Number = Math.sqrt(discriminantSq);
               var t1:Number = (-b - discriminant) / (2 * a);
               var t2:Number = (-b + discriminant) / (2 * a);
               if(t1 >= 0) interceptTime = t1;
               if(t2 >= 0 && t2 < interceptTime) interceptTime = t2;
            }
         }
         if(!isFinite(interceptTime)) {
            return null;
         }
         targetVel.scaleBy(interceptTime);
         this.lastAutoAimLeadMs_ = interceptTime;
         this.lastAutoAimTurnRate_ = 0;
         return targetPos.add(targetVel);
      }

      /** Predict a target that has demonstrated a stable turn across multiple
       * server ticks. Linear lead aims along the tangent and consistently misses
       * circular enemies; constant-turn integration follows their arc. */
      public function leadEnemy(shooterPos:Vector3D, target:GameObject,
                                projSpeed:Number) : Vector3D {
         if(target == null) {
            return null;
         }
         var turnRate:Number = target.aimTurnRate_;
         if(Math.abs(turnRate) < 0.00001 || projSpeed <= 0 || isNaN(projSpeed)) {
            if(projSpeed <= 0 || isNaN(projSpeed)) {
               return new Vector3D(target.x_,target.y_);
            }
            // Scalar form of leadPos for this hot path. The old implementation
            // allocated target, velocity, delta and result Vector3Ds for every
            // enemy candidate considered on every shot.
            var velocityX:Number = target.moveVec_.x;
            var velocityY:Number = target.moveVec_.y;
            var linearDx:Number = target.x_ - shooterPos.x;
            var linearDy:Number = target.y_ - shooterPos.y;
            var a:Number = velocityX * velocityX + velocityY * velocityY -
                  projSpeed * projSpeed;
            var b:Number = 2 * (linearDx * velocityX + linearDy * velocityY);
            var c:Number = linearDx * linearDx + linearDy * linearDy;
            var linearInterceptTime:Number = Number.POSITIVE_INFINITY;
            if(Math.abs(a) < 0.0000000001) {
               if(Math.abs(b) > 0.0000000001) {
                  var directTime:Number = -c / b;
                  if(directTime >= 0) {
                     linearInterceptTime = directTime;
                  }
               }
            } else {
               var linearDiscriminantSq:Number = b * b - 4 * a * c;
               if(linearDiscriminantSq >= 0) {
                  var linearDiscriminant:Number = Math.sqrt(linearDiscriminantSq);
                  var linearT1:Number = (-b - linearDiscriminant) / (2 * a);
                  var linearT2:Number = (-b + linearDiscriminant) / (2 * a);
                  if(linearT1 >= 0) {
                     linearInterceptTime = linearT1;
                  }
                  if(linearT2 >= 0 && linearT2 < linearInterceptTime) {
                     linearInterceptTime = linearT2;
                  }
               }
            }
            if(!isFinite(linearInterceptTime)) {
               return null;
            }
            this.lastAutoAimLeadMs_ = linearInterceptTime;
            this.lastAutoAimTurnRate_ = 0;
            return new Vector3D(target.x_ + velocityX * linearInterceptTime,
                  target.y_ + velocityY * linearInterceptTime);
         }
         var dx:Number = target.x_ - shooterPos.x;
         var dy:Number = target.y_ - shooterPos.y;
         var interceptTime:Number = Math.sqrt(dx * dx + dy * dy) / projSpeed;
         var predictedX:Number = target.x_;
         var predictedY:Number = target.y_;
         for(var iteration:int = 0; iteration < 5; iteration++) {
            var turn:Number = turnRate * interceptTime;
            // Two confirming ticks make the rate trustworthy, but very long
            // projectile flights should not extrapolate more than half a turn.
            turn = Math.max(-Math.PI,Math.min(Math.PI,turn));
            var effectiveRate:Number = interceptTime > 0 ? turn / interceptTime : turnRate;
            if(Math.abs(effectiveRate) < 0.0000001) {
               predictedX = target.x_ + target.moveVec_.x * interceptTime;
               predictedY = target.y_ + target.moveVec_.y * interceptTime;
            } else {
               var sinTurn:Number = Math.sin(turn);
               var cosTurn:Number = Math.cos(turn);
               predictedX = target.x_ + (target.moveVec_.x * sinTurn +
                     target.moveVec_.y * (cosTurn - 1)) / effectiveRate;
               predictedY = target.y_ + (target.moveVec_.x * (1 - cosTurn) +
                     target.moveVec_.y * sinTurn) / effectiveRate;
            }
            dx = predictedX - shooterPos.x;
            dy = predictedY - shooterPos.y;
            var refinedTime:Number = Math.sqrt(dx * dx + dy * dy) / projSpeed;
            if(Math.abs(refinedTime - interceptTime) < 0.5) {
               interceptTime = refinedTime;
               break;
            }
            interceptTime = refinedTime;
         }
         this.lastAutoAimLeadMs_ = interceptTime;
         this.lastAutoAimTurnRate_ = turnRate;
         return new Vector3D(predictedX,predictedY);
      }

      public function getDist(x1:Number, y1:Number, x2:Number, y2:Number) : Number {
         var dx:Number = x1 - x2;
         var dy:Number = y1 - y2;
         return Math.sqrt(dy * dy + dx * dx);
      }

      public function getDistSquared(x1:Number, y1:Number, x2:Number, y2:Number) : Number {
         var dx:Number = x1 - x2;
         var dy:Number = y1 - y2;
         return dy * dy + dx * dx;
      }

      public function getDistObj(a:GameObject, b:GameObject) : Number {
         var dx:Number = a.x_ - b.x_;
         var dy:Number = a.y_ - b.y_;
         return Math.sqrt(dy * dy + dx * dx);
      }

      public function getDistSquaredObj(a:GameObject, b:GameObject) : Number {
         var dx:Number = a.x_ - b.x_;
         var dy:Number = a.y_ - b.y_;
         return dy * dy + dx * dx;
      }

      public function necroHeal() : Boolean {
         var target:Point = this.getNecroTarget();
         if(target) {
            return this.useAltWeapon(target.x,target.y,1,-1,true);
         }
         return false;
      }

      public function priestHeal(time:int) : void {
         if(this.hp_ <= this.autoHealNumber || this.clientHp <= this.autoHealNumber || this.syncedChp <= this.autoHealNumber) {
            this.useAltWeapon(this.x_,this.y_,1,time,true);
         }
      }

      public function getNecroTarget() : Point {
         var bestCount:* = 0;
         var bestEnemy:* = null;
         var nearbyCount:int = -1;
         var hpThreshold:int = Parameters.data.skullHPThreshold;
         var minTargets:int = Parameters.data.skullTargets;
         var radius:Number = ObjectLibrary.xmlLibrary_[this.equipment_[1]].Activate.@radius;
         for each(var enemy:GameObject in map_.vulnEnemyDict_) {
            if(!enemy.isInvulnerable && !enemy.isStasis && !enemy.isInvincible) {
               if(enemy.maxHP_ >= hpThreshold && enemy is Character && this.getDistSquared(enemy.x_,enemy.y_,this.x_,this.y_) <= 225) {
                  nearbyCount = this.getNumNearbyEnemies(enemy,radius);
                  if(nearbyCount > minTargets && nearbyCount > bestCount) {
                     bestEnemy = enemy;
                     bestCount = Number(nearbyCount);
                  }
               }
            }
         }
         if(bestCount < minTargets || bestEnemy == null) {
            return null;
         }
         return new Point(bestEnemy.x_,bestEnemy.y_);
      }

      public function getNumNearbyEnemies(center:GameObject, radiusSq:int) : int {
         var count:int = 0;
         var enemy:* = null;
         radiusSq = radiusSq * radiusSq;
         var hpThreshold:int = Parameters.data.skullHPThreshold;
         for each(enemy in map_.vulnEnemyDict_) {
            if(enemy.maxHP_ >= hpThreshold && enemy is Character && this.getDistSquared(enemy.x_,enemy.y_,center.x_,center.y_) <= radiusSq) {
               count++;
            }
         }
         return count;
      }

      public function autoLoot(time:int = -1) : void {
         var slotIndex:int = 0;
         var itemId:int = 0;
         var props:ObjectProperties = null;
         var potType:int = -1;
         if(time == -1) {
            time = TimeUtil.getModdedTime();
         }
         if(time - Math.max(this.map_.gs_.gsc_.lastInvSwapTime,
               this.lastAutoLootActionTime_) <= 500) {
            return;
         }
         var selectedBag:GameObject = null;
         var selectedTier:int = int.MIN_VALUE;
         var selectedDistance:Number = Infinity;
         for each(var bag:GameObject in this.map_.goDict_) {
            if(!(bag is Container) || bag.objectType_ == 1284 ||
                  bag.objectType_ == 1860 || bag.equipment_ == null) {
               continue;
            }
            var distance:Number = getDistSquared(this.x_,this.y_,bag.x_,bag.y_);
            if(distance > 1 || !this.hasAutoLootCandidate(bag)) {
               continue;
            }
            var tier:int = this.autoLootBagTier(bag);
            // Unknown/brown/purple containers remain eligible, but a white-or-
            // better bag always gets the transaction slot before ordinary loot.
            if(tier < 0) {
               tier = 0;
            }
            if(selectedBag == null || tier > selectedTier ||
                  tier == selectedTier && distance < selectedDistance) {
               selectedBag = bag;
               selectedTier = tier;
               selectedDistance = distance;
            }
         }
         if(selectedBag == null) {
            return;
         }
         slotIndex = 0;
         while(slotIndex < 8) {
            itemId = selectedBag.equipment_[slotIndex];
            if(itemId != -1 && !this.isAutoLootItemTemporarilyRejected(itemId,time)) {
               props = ObjectLibrary.propsLibrary_[itemId];
               if(props) {
                  potType = this.getPotType(itemId);
                  if(Parameters.data.autoConsumeRainbowPots && potType >= 0 &&
                        potType <= 5 && this.shouldDrink(potType)) {
                     if(this.map_.gs_.gsc_.useItem_new(selectedBag,slotIndex,
                           "auto_loot_rainbow")) {
                        this.lastAutoLootActionTime_ = time;
                        DebugLog.event("auto_loot_consume_rainbow",{"item":itemId,
                              "potType":potType,"bag":selectedBag.objectId_,
                              "slot":slotIndex});
                        return;
                     }
                  }
                  if(props.desiredLoot_ || Parameters.data.autoLootUpgrades &&
                        checkForUpgrade(props)) {
                     if(pickup(selectedBag,slotIndex,itemId)) {
                        this.lastAutoLootActionTime_ = time;
                        // Successful auto-loot — record the item for the dashboard.
                        DebugLog.event("loot_taken",{
                              "item":String(ObjectLibrary.typeToDisplayId_[itemId]),
                              "itemId":itemId,"bag":selectedBag.objectId_,
                              "map":this.map_ != null ? this.map_.name_ : ""});
                        return;
                     }
                     // Nowhere to put a wanted stat potion (full inventory, no
                     // quick-slot stack, no replacement) -- drink it from the
                     // bag instead of leaving it behind. 185 potions were
                     // abandoned this way in the 07-22..24 logs, and the bags
                     // they blocked also despawned with white-bag items. The
                     // stat gain requires shouldDrink, so maxed stats still
                     // skip and never waste a sellable potion on nothing.
                     if(potType >= 0 && potType <= 5 && this.shouldDrink(potType) &&
                           this.isAutoLootInventoryFull() &&
                           !this.hasQuickSlotSpace(itemId,props) &&
                           this.nextAutoLootReplacementSlot(selectedBag,itemId) == -1) {
                        if(this.map_.gs_.gsc_.useItem_new(selectedBag,slotIndex,
                              "auto_loot_full_consume")) {
                           this.lastAutoLootActionTime_ = time;
                           DebugLog.event("auto_loot_consume_full",{"item":itemId,
                                 "potType":potType,"bag":selectedBag.objectId_,
                                 "slot":slotIndex});
                           return;
                        }
                     }
                  }
               }
            }
            slotIndex++;
         }
      }

      public function hasAutoLootCandidate(bag:GameObject) : Boolean {
         if(bag == null || bag.equipment_ == null) {
            return false;
         }
         var inventoryFull:Boolean = this.isAutoLootInventoryFull();
         var slotIndex:int = 0;
         while(slotIndex < bag.equipment_.length && slotIndex < 8) {
            var itemId:int = bag.equipment_[slotIndex];
            if(itemId != -1 && !this.isAutoLootItemTemporarilyRejected(itemId,
                  TimeUtil.getModdedTime())) {
               var props:ObjectProperties = ObjectLibrary.propsLibrary_[itemId];
               if(props != null) {
                  var potType:int = this.getPotType(itemId);
                  if(Parameters.data.autoConsumeRainbowPots && potType >= 0 &&
                        potType <= 5 && this.shouldDrink(potType)) {
                     return true;
                  }
                  if((this.hasQuickSlotSpace(itemId,props) || !inventoryFull ||
                        this.nextAutoLootReplacementSlot(bag,itemId) != -1) &&
                        (props.desiredLoot_ || Parameters.data.autoLootUpgrades &&
                        this.checkForUpgrade(props))) {
                     return true;
                  }
               }
            }
            slotIndex++;
         }
         return false;
      }

      /** True when a bag still contains something Auto Loot wants, independent
       * of temporary INVRESULT rejection, swap lock, or current inventory space.
       * AutoPlay uses this distinction to defer a bag instead of permanently
       * declaring valuable loot complete during a transient transaction state. */
      public function hasDesiredAutoLootItem(bag:GameObject) : Boolean {
         if(bag == null || bag.equipment_ == null) {
            return false;
         }
         var slotIndex:int = 0;
         while(slotIndex < bag.equipment_.length && slotIndex < 8) {
            var itemId:int = bag.equipment_[slotIndex];
            if(itemId != -1) {
               var props:ObjectProperties = ObjectLibrary.propsLibrary_[itemId];
               if(props != null) {
                  var potType:int = this.getPotType(itemId);
                  if(Parameters.data.autoConsumeRainbowPots && potType >= 0 &&
                        potType <= 5 && this.shouldDrink(potType)) {
                     return true;
                  }
                  if(props.desiredLoot_ || Parameters.data.autoLootUpgrades &&
                        this.checkForUpgrade(props)) {
                     return true;
                  }
               }
            }
            slotIndex++;
         }
         return false;
      }

      /** Explain why a bag that still contains desired loot cannot currently
       * produce an Auto Loot action. Auto Play logs this once when it releases
       * the bag; it does not use the result to retry the same object. */
      public function autoLootBlockReason(bag:GameObject) : String {
         if(bag == null || bag.equipment_ == null) {
            return "invalid_bag";
         }
         var now:int = TimeUtil.getModdedTime();
         var inventoryFull:Boolean = this.isAutoLootInventoryFull();
         var sawDesired:Boolean = false;
         var sawRejected:Boolean = false;
         var sawNoDestination:Boolean = false;
         var slotIndex:int = 0;
         while(slotIndex < bag.equipment_.length && slotIndex < 8) {
            var itemId:int = bag.equipment_[slotIndex];
            if(itemId != -1) {
               var props:ObjectProperties = ObjectLibrary.propsLibrary_[itemId];
               if(props != null) {
                  var potType:int = this.getPotType(itemId);
                  var consumable:Boolean = Parameters.data.autoConsumeRainbowPots &&
                        potType >= 0 && potType <= 5 && this.shouldDrink(potType);
                  var desired:Boolean = consumable || props.desiredLoot_ ||
                        Parameters.data.autoLootUpgrades && this.checkForUpgrade(props);
                  if(desired) {
                     sawDesired = true;
                     if(this.isAutoLootItemTemporarilyRejected(itemId,now)) {
                        sawRejected = true;
                     } else if(consumable || this.hasQuickSlotSpace(itemId,props) ||
                           !inventoryFull ||
                           this.nextAutoLootReplacementSlot(bag,itemId) != -1) {
                        return "service_timeout";
                     } else {
                        sawNoDestination = true;
                     }
                  }
               }
            }
            slotIndex++;
         }
         if(sawNoDestination) {
            return "inventory_full";
         }
         if(sawRejected) {
            return "item_rejected";
         }
         return sawDesired ? "unavailable" : "complete";
      }

      public function checkForUpgrade(candidate:ObjectProperties) : Boolean {
         var slotIndex:int = 0;
         var slotType:int = 0;
         var equippedProps:* = null;
         if(candidate.slotType_ != -2147483648) {
            slotIndex = 0;
            while(slotIndex < 4) {
               slotType = this.slotTypes_[slotIndex];
               if(candidate.slotType_ == slotType) {
                  if(this.equipment_ && this.equipment_[slotIndex] == -1) {
                     return true;
                  }
                  equippedProps = ObjectLibrary.propsLibrary_[this.equipment_[slotIndex]];
                  if(equippedProps && equippedProps.tier != -2147483648 && candidate.tier > equippedProps.tier) {
                     return true;
                  }
               }
               slotIndex++;
            }
         }
         return false;
      }

      public function drink(fromGO:GameObject, slotId:int, itemId:int) : void {
         this.map_.gs_.gsc_.useItem_new(fromGO,slotId);
         SoundEffectLibrary.play("use_potion");
      }

      public function pickup(fromGO:GameObject, fromSlotId:int, fromItemId:int) : Boolean {
         var props:ObjectProperties = ObjectLibrary.propsLibrary_[fromItemId];
         if (props != null && this.quickSlotItem1 == fromItemId
                 && this.quickSlotCount1 < props.maxQuickStack) {
            return this.map_.gs_.gsc_.invSwapRaw(x_, y_,
                    fromGO.objectId_, fromSlotId, fromItemId,
                    objectId_, 1000000, fromItemId);
         }

         if (props != null && this.quickSlotItem2 == fromItemId
                 && this.quickSlotCount2 < props.maxQuickStack) {
            return this.map_.gs_.gsc_.invSwapRaw(x_, y_,
                    fromGO.objectId_, fromSlotId, fromItemId,
                    objectId_, 1000001, fromItemId);
         }

         if (props != null && this.quickSlotItem3 == fromItemId
                 && this.quickSlotCount3 < props.maxQuickStack) {
            return this.map_.gs_.gsc_.invSwapRaw(x_, y_,
                    fromGO.objectId_, fromSlotId, fromItemId,
                    objectId_, 1000002, fromItemId);
         }

         var localSlotId:int = this.nextAutoLootInventorySlot();
         if(localSlotId != -1) {
            return this.map_.gs_.gsc_.invSwapRaw(x_, y_,
                    fromGO.objectId_, fromSlotId, fromItemId,
                    objectId_, localSlotId, -1);
         }
         // A full inventory must not make a white-or-better drop disappear
         // behind ordinary stat potions. INVSWAP atomically puts the valuable
         // item in the chosen player slot and returns that potion to the bag;
         // no speculative INVDROP is needed and the existing transaction lock
         // still serialises the mutation with its INVRESULT.
         localSlotId = this.nextAutoLootReplacementSlot(fromGO,fromItemId);
         if(localSlotId != -1) {
            var replacedItemId:int = this.equipment_[localSlotId];
            var replacementStarted:Boolean = this.map_.gs_.gsc_.invSwapRaw(x_, y_,
                  fromGO.objectId_, fromSlotId, fromItemId,
                  objectId_, localSlotId, replacedItemId);
            if(replacementStarted) {
               DebugLog.event("auto_loot_replace_rainbow",{
                     "bag":fromGO.objectId_,"bagTier":this.autoLootBagTier(fromGO),
                     "incoming":fromItemId,"slot":localSlotId,
                     "replaced":replacedItemId});
            }
            return replacementStarted;
         }
         return false;
      }

      /** Find the least costly inventory slot that a white-or-better bag item
       * may replace. A potion for an already-maxed stat is preferred, then any
       * ordinary rainbow potion. Life/mana, HP/MP and equipment are never
       * selected by this policy. */
      private function nextAutoLootReplacementSlot(fromGO:GameObject,
                                                    incomingItemId:int) : int {
         if(this.autoLootBagTier(fromGO) < 5 ||
               Parameters.raPotions.indexOf(incomingItemId) >= 0) {
            return -1;
         }
         var now:int = TimeUtil.getModdedTime();
         var fallback:int = -1;
         var end:int = this.inventoryEndIndex();
         for(var slotId:int = 4; slotId < end; slotId++) {
            var rejectedUntil:int = int(this.autoLootRejectedSlots_[slotId]);
            if(rejectedUntil > 0 && rejectedUntil <= now) {
               delete this.autoLootRejectedSlots_[slotId];
               rejectedUntil = 0;
            }
            if(rejectedUntil > now) {
               continue;
            }
            var currentItemId:int = this.equipment_[slotId];
            if(Parameters.raPotions.indexOf(currentItemId) < 0) {
               continue;
            }
            var potType:int = this.getPotType(currentItemId);
            if(potType >= 0 && potType <= 5 && !this.shouldDrink(potType)) {
               return slotId;
            }
            if(fallback == -1) {
               fallback = slotId;
            }
         }
         return fallback;
      }

      /** The server's Loot Bag definition number is its rarity tier. Tier 5 is
       * white; 6-9 are the other high-value variants. */
      private function autoLootBagTier(fromGO:GameObject) : int {
         if(!(fromGO is Container)) {
            return -1;
         }
         var definitionId:String = fromGO.props_ != null ? fromGO.props_.id_ : "";
         if(definitionId != null && definitionId.indexOf("Loot Bag ") == 0) {
            var tier:Number = parseInt(definitionId.substring("Loot Bag ".length));
            if(!isNaN(tier)) {
               return int(tier);
            }
         }
         switch(fromGO.objectType_) {
            case 0x050B:
            case 0x06BE:
               return 5;
            case 0x050C:
            case 0x0510:
               return 6;
            case 0x050E:
            case 0x06BC:
               return 7;
            case 0x050F:
            case 0x06BF:
               return 8;
            case 0x06AC:
            case 0x06C0:
               return 9;
         }
         return -1;
      }

      private function hasQuickSlotSpace(itemId:int, props:ObjectProperties) : Boolean {
         if(props == null) {
            return false;
         }
         return this.quickSlotItem1 == itemId && this.quickSlotCount1 < props.maxQuickStack ||
               this.quickSlotItem2 == itemId && this.quickSlotCount2 < props.maxQuickStack ||
               this.quickSlotItem3 == itemId && this.quickSlotCount3 < props.maxQuickStack;
      }

      public function onAutoLootSwapRejected(slotId:int, itemId:int = -1) : void {
         // A failed swap can mean an item restriction, range race, or one stale
         // destination. It does not prove that the player's entire backpack is
         // unavailable. Briefly quarantine the exact slot and item so other loot
         // can continue while the server-authoritative inventory settles.
         var now:int = TimeUtil.getModdedTime();
         this.lastAutoLootActionTime_ = now + 1000;
         if(slotId >= 4 && slotId < this.inventoryEndIndex()) {
            this.autoLootRejectedSlots_[slotId] = now + AUTO_LOOT_REJECTED_SLOT_MS;
         }
         if(itemId >= 0) {
            this.autoLootRejectedItems_[itemId] = now + AUTO_LOOT_REJECTED_ITEM_MS;
         }
         // A rejection in the EXPANDED range only disproves the expanded range.
         // It must never count as evidence against the eight legacy backpack
         // slots: the 07-22..24 logs show slot-20/21 rejections revoking the
         // whole backpack, crashing loot capacity to 8 slots for the rest of
         // the map and abandoning 108 bags (including white bags).
         if(slotId >= 20) {
            this.expandedBackpackRejected_ = true;   // permanent for this map/char
            if(this.expandedBackpackConfirmed_) {
               this.expandedBackpackConfirmed_ = false;
               DebugLog.event("auto_loot_expanded_revoked",{
                     "slot":slotId,"item":itemId});
            }
            DebugLog.event("auto_loot_destination_rejected",{"slot":slotId,
                  "item":itemId,"slotRetryMs":AUTO_LOOT_REJECTED_SLOT_MS,
                  "itemRetryMs":AUTO_LOOT_REJECTED_ITEM_MS,
                  "hasBackpack":this.hasBackpack_,
                  "expandedBackpackSlots":this.expandedBackpackSlots_});
            return;
         }
         if(slotId >= 12 && this.hasBackpack_) {
            if(now - this.autoLootBackpackLastRejectedAt_ > 60000) {
               this.autoLootBackpackRejectCount_ = 0;
               this.autoLootBackpackLastRejectedItem_ = -1;
               this.autoLootBackpackLastRejectedSlot_ = -1;
            }
            // The same loot item can be retried against different hidden
            // destinations. Distinct rejected slots are independent structural
            // evidence even when the item id is unchanged.
            if(itemId < 0 || itemId != this.autoLootBackpackLastRejectedItem_ ||
                  slotId != this.autoLootBackpackLastRejectedSlot_) {
               this.autoLootBackpackRejectCount_++;
            }
            this.autoLootBackpackLastRejectedItem_ = itemId;
            this.autoLootBackpackLastRejectedSlot_ = slotId;
            this.autoLootBackpackLastRejectedAt_ = now;
            if(this.autoLootBackpackRejectCount_ >= 2) {
               // Two different items rejected by an otherwise-empty backpack
               // destination is structural evidence that stat 79 was only the
               // seasonal compatibility bit. Stop selecting hidden slots for
               // the rest of this character/map instead of blacklisting loot.
               this.backpackAuthorityRejected_ = true;
               this.hasBackpack_ = false;
               var rejectedCharId:int = this.backpackCharacterId();
               if(rejectedCharId > 0) {
                  backpackAuthorityRejectedByChar_[rejectedCharId] = true;
               }
               this.autoLootRejectedItems_ = new Dictionary();
               DebugLog.event("auto_loot_backpack_authority_revoked",{
                     "slot":slotId,"item":itemId,"rejects":this.autoLootBackpackRejectCount_,
                     "rawFlag":this.backpackFlag_,"seasonal":this.seasonal_,
                     "charId":rejectedCharId});
            }
         }
         DebugLog.event("auto_loot_destination_rejected",{"slot":slotId,
               "item":itemId,"slotRetryMs":AUTO_LOOT_REJECTED_SLOT_MS,
               "itemRetryMs":AUTO_LOOT_REJECTED_ITEM_MS,
               "hasBackpack":this.hasBackpack_,
               "expandedBackpackSlots":this.expandedBackpackSlots_});
      }

      private function nextAutoLootInventorySlot() : int {
         var end:int = this.inventoryEndIndex();
         var now:int = TimeUtil.getModdedTime();
         var slotId:int = 4;
         while(slotId < end) {
            var rejectedUntil:int = int(this.autoLootRejectedSlots_[slotId]);
            if(rejectedUntil > 0 && rejectedUntil <= now) {
               delete this.autoLootRejectedSlots_[slotId];
               rejectedUntil = 0;
            }
            if(this.equipment_[slotId] == -1 && rejectedUntil == 0) {
               return slotId;
            }
            slotId++;
         }
         return -1;
      }

      public function isAutoLootInventoryFull() : Boolean {
         return this.nextAutoLootInventorySlot() == -1;
      }

      private function isAutoLootItemTemporarilyRejected(itemId:int, now:int) : Boolean {
         var rejectedUntil:int = int(this.autoLootRejectedItems_[itemId]);
         if(rejectedUntil > 0 && rejectedUntil <= now) {
            delete this.autoLootRejectedItems_[itemId];
            return false;
         }
         return rejectedUntil > now;
      }

      public function findItems(items:Vector.<int>, targetValues:Vector.<int>, startIndex:int = 0) : int {
         var index:* = 0;
         var count:int = items.length;
         index = startIndex;
         while(index < count) {
            if(targetValues.indexOf(items[index]) >= 0) {
               return index;
            }
            index++;
         }
         return -1;
      }

      public function findItem(items:Vector.<int>, value:int, startIndex:int = 0, findMismatch:Boolean = false, endIndex:int = 8) : int {
         var index:* = -1;
         if(findMismatch) {
            index = startIndex;
            while(index < endIndex) {
               if(items[index] != value) {
                  return index;
               }
               index++;
            }
         } else {
            index = startIndex;
            while(index < endIndex) {
               if(items[index] == value) {
                  return index;
               }
               index++;
            }
         }
         return -1;
      }

      public function calcHealthPercent() : void {
         this.autoHpPotNumber = Parameters.data.autoHPPercent * 0.01 * this.maxHP_;
         this.autoNexusNumber = Parameters.data.AutoNexus * 0.01 * this.maxHP_;
         this.autoHealNumber = Parameters.data.AutoHealPercentage * 0.01 * this.maxHP_;
      }

      public function calcManaPercent() : void {
         if(Parameters.data.autoMPPercent < 0) {
            this.autoMpPotNumber = -1;
         } else {
            this.autoMpPotNumber = Parameters.data.autoMPPercent * 0.01 * this.maxMP_;
         }
         if(Parameters.data.AAMinManaPercent < 0) {
            this.autoMpPercentNumber = -1;
         } else {
            this.autoMpPercentNumber = Parameters.data.AAMinManaPercent * 0.01 * this.maxMP_;
         }
      }

      public function triggerHealBuffer() : void {
         if(this.healBuffer > 0) {
            this.addHealth(this.healBuffer,"heal_buffer");
            this.healBuffer = 0;
            this.healBufferTime = 2147483647;
         }
      }

      public function maxHpChanged(newMaxHp:int) : void {
         if(newMaxHp < this.maxHP_) {
            if(this.clientHp > newMaxHp) {
               this.clientHp = newMaxHp;
               this.predictedRecoveryPending_ = 0;
               this.clearPredictedDamage();
            }
         }
      }

      public function addHealth(amount:int, source:String = "heal") : void {
         var before:int = this.clientHp;
         this.clientHp = this.clientHp + amount;
         if(this.clientHp > this.maxHP_) {
            this.clientHp = this.maxHP_;
         }
         var applied:int = this.clientHp - before;
         if(applied > 0) {
            this.predictedRecoveryPending_ += applied;
         }
         if(amount != 0 && Parameters.data.hpDebugLog) {
            DebugLog.event("hp_heal",{"amt":amount,"applied":applied,"source":source,
               "chp":this.clientHp,"srv":this.hp_,"sync":this.syncedChp,
               "pendingRecovery":this.predictedRecoveryPending_,"max":this.maxHP_});
         }
      }

      public function subtractDamage(amount:int, time:int = -1,
                                     source:String = "unknown", sourceType:int = -1) : Boolean {
         if(time == -1) {
            time = TimeUtil.getModdedTime();
         }
         if(amount >= combatTrigger()) {
            this.icMS = TimeUtil.getTrueTime();
         }
         this.lastLocalDamageTime = time;
         this.lastLocalDamageAmount = amount;
         this.lastLocalDamageSource = source;
         // DAMAGE packets have already reduced hp_ and are authoritative; fold
         // them into the server baseline immediately. All locally simulated
         // sources remain pending until a server HP delta acknowledges them.
         if(source == "server_damage") {
            this.syncedChp = this.syncedChp > 0 ?
                  Math.min(this.syncedChp,this.hp_) : this.hp_;
            this.rebuildClientHpPrediction();
            if(this.clientHp > this.syncedChp) {
               this.clientHp = this.syncedChp;
               this.predictedRecoveryPending_ = 0;
            }
         } else {
            this.addPredictedDamage(amount,time,source);
            this.clientHp = this.clientHp - amount;
         }
         if(amount != 0 && Parameters.data.hpDebugLog) {
            DebugLog.event("hp_dmg",{"amt":amount,"source":source,"chp":this.clientHp,
               "sync":this.syncedChp,"srv":this.hp_,
               "pendingDamage":this.predictedDamagePending_,
               "pendingRecovery":this.predictedRecoveryPending_,
               "nexusThreshold":this.autoNexusNumber,
               // Source enemy (when the caller could resolve it): objectType +
               // display name, so the dashboard can break damage down by enemy.
               "srcType":sourceType,
               "srcName":sourceType >= 0 ? String(ObjectLibrary.typeToDisplayId_[sourceType]) : null});
         }
         return this.checkHealth(time);
      }

      // ---- Kill tracking (predicted, for the session dashboard) ---------------
      // The client has no server-authoritative kill count, so we count a kill
      // when one of our shots reduces an enemy to <=0 HP (Projectile.getHit).
      // Deduped per enemy objectId within the flush window so multi-hit/piercing
      // doesn't double-count; still a PREDICTION (over-counts on freshly-spawned
      // enemies), which the dashboard labels as such. Flushed as a periodic
      // kills_summary {count, byName} from update().
      private var killTally_:Object = {};
      private var killedIds_:Object = {};
      private var killTotal_:int = 0;
      private var lastKillFlushMs_:int = 0;

      public function recordKill(objectId:int, objectType:int) : void {
         if(!Parameters.data.hpDebugLog || this.killedIds_[objectId]) {
            return;
         }
         this.killedIds_[objectId] = true;
         var nm:String = ObjectLibrary.typeToDisplayId_[objectType];
         if(nm == null) {
            nm = "0x" + objectType.toString(16);
         }
         this.killTally_[nm] = (this.killTally_[nm] is int ? int(this.killTally_[nm]) : 0) + 1;
         this.killTotal_++;
      }

      private function flushKillTally(time:int) : void {
         if(this.lastKillFlushMs_ == 0) {
            this.lastKillFlushMs_ = time;
            return;
         }
         if(time - this.lastKillFlushMs_ < 5000) {
            return;
         }
         if(this.killTotal_ > 0) {
            DebugLog.event("kills_summary",{"count":this.killTotal_,
                  "windowMs":time - this.lastKillFlushMs_,"byName":this.killTally_});
         }
         this.killTally_ = {};
         this.killedIds_ = {};
         this.killTotal_ = 0;
         this.lastKillFlushMs_ = time;
      }

      /** Record authoritative HP loss which had no matching local collision.
       * Auto Dodge uses this as a short reactive escape signal; clientHp has
       * already been reconciled by reconcileServerHp and must not be charged a
       * second time here. */
      public function noteUnpredictedServerDamage(amount:int, time:int) : void {
         if(amount <= 0) {
            return;
         }
         this.lastLocalDamageTime = time;
         this.lastLocalDamageAmount = amount;
         this.lastLocalDamageSource = "server_hp";
      }

      /** Reset both prediction and authoritative baseline at a trusted value. */
      public function resetClientHpPrediction(value:int = -1) : void {
         var hpValue:int = value >= 0 ? value : this.hp_;
         this.clientHp = hpValue;
         this.syncedChp = hpValue;
         this.predictedRecoveryPending_ = 0;
         this.clearPredictedDamage();
         this.hpLog = 0;
         this.lastLocalDamageTime = -1;
         this.lastLocalDamageAmount = 0;
         this.lastLocalDamageSource = "none";
      }

      /**
       * Reconcile a stat-1 update without destroying unconfirmed local damage.
       * syncedChp is changed only here, so it remains a true server baseline.
       */
      public function reconcileServerHp(serverHp:int, full:Boolean) : void {
         if(full) {
            this.clientHp = serverHp;
            this.syncedChp = serverHp;
            this.predictedRecoveryPending_ = 0;
            this.clearPredictedDamage();
            this.hpLog = 0;
            return;
         }
         var serverDelta:int = serverHp - this.syncedChp;
         if(serverDelta > 0) {
            var acknowledgedRecovery:int = Math.min(serverDelta,this.predictedRecoveryPending_);
            this.predictedRecoveryPending_ -= acknowledgedRecovery;
         } else if(serverDelta < 0) {
            this.consumePredictedDamage(-serverDelta);
         }
         this.syncedChp = serverHp;
         this.expirePredictedDamage(TimeUtil.getModdedTime(),false);
         this.rebuildClientHpPrediction();
         // Once a server HP sample arrives, any local recovery still placing us
         // above that sample has been contradicted or masked by damage. Never
         // let an optimistic heal delay Auto Nexus.
         if(this.clientHp > serverHp) {
            this.clientHp = serverHp;
            this.predictedRecoveryPending_ = 0;
         }
      }

      public function get predictedRecoveryPending() : int {
         return this.predictedRecoveryPending_;
      }

      public function get predictedDamagePending() : int {
         return this.predictedDamagePending_;
      }

      private function addPredictedDamage(amount:int, time:int, source:String) : void {
         if(amount <= 0) {
            return;
         }
         this.expirePredictedDamage(time);
         if(this.predictedDamageAmounts_.length >= MAX_PENDING_DAMAGE_PREDICTIONS) {
            this.predictedDamagePending_ -= this.predictedDamageAmounts_[0];
            this.removePredictedDamageAt(0);
            this.rebuildClientHpPrediction();
         }
         var ttl:int = source == "projectile" ? PROJECTILE_DAMAGE_PREDICTION_MS :
               ENVIRONMENT_DAMAGE_PREDICTION_MS;
         this.predictedDamageAmounts_.push(amount);
         this.predictedDamageExpires_.push(time + ttl);
         this.predictedDamageSources_.push(source);
         this.predictedDamagePending_ += amount;
      }

      private function consumePredictedDamage(amount:int) : void {
         while(amount > 0 && this.predictedDamageAmounts_.length > 0) {
            var pending:int = this.predictedDamageAmounts_[0];
            var consumed:int = Math.min(amount,pending);
            pending -= consumed;
            amount -= consumed;
            this.predictedDamagePending_ -= consumed;
            if(pending == 0) {
               this.removePredictedDamageAt(0);
            } else {
               this.predictedDamageAmounts_[0] = pending;
            }
         }
      }

      private function expirePredictedDamage(time:int, rebuild:Boolean = true) : void {
         var expiredAmount:int = 0;
         for(var index:int = this.predictedDamageExpires_.length - 1; index >= 0; index--) {
            if(time < this.predictedDamageExpires_[index]) {
               continue;
            }
            expiredAmount += this.predictedDamageAmounts_[index];
            this.predictedDamagePending_ -= this.predictedDamageAmounts_[index];
            this.removePredictedDamageAt(index);
         }
         if(rebuild && expiredAmount > 0) {
            this.rebuildClientHpPrediction();
         }
         if(expiredAmount > 0 && Parameters.data.hpDebugLog) {
            DebugLog.event("hp_prediction_expired",{"amount":expiredAmount,
                  "pendingDamage":this.predictedDamagePending_,"chp":this.clientHp,
                  "srv":this.hp_,"sync":this.syncedChp});
         }
      }

      private function removePredictedDamageAt(index:int) : void {
         this.predictedDamageAmounts_.splice(index,1);
         this.predictedDamageExpires_.splice(index,1);
         this.predictedDamageSources_.splice(index,1);
      }

      private function clearPredictedDamage() : void {
         this.predictedDamageAmounts_.length = 0;
         this.predictedDamageExpires_.length = 0;
         this.predictedDamageSources_.length = 0;
         this.predictedDamagePending_ = 0;
      }

      private function rebuildClientHpPrediction() : void {
         this.clientHp = this.syncedChp + this.predictedRecoveryPending_ -
               this.predictedDamagePending_;
         if(this.clientHp > this.maxHP_) {
            this.clientHp = this.maxHP_;
         }
      }

      public function recordAuthoritativePosition(x:Number, y:Number, time:int) : void {
         var dx:Number = x - this.x_;
         var dy:Number = y - this.y_;
         var distance:Number = Math.sqrt(dx * dx + dy * dy);
         var expectedLead:Number = this.getMoveSpeed() * 300;
         if(this.serverPositionErrorTime_ >= 0) {
            var sampleMs:int = time - this.serverPositionErrorTime_;
            if(sampleMs > 0 && sampleMs <= 750) {
               this.serverVelocityX_ = (x - this.serverPositionX_) / sampleMs;
               this.serverVelocityY_ = (y - this.serverPositionY_) / sampleMs;
            } else {
               this.serverVelocityX_ = 0;
               this.serverVelocityY_ = 0;
            }
         }
         this.serverPositionX_ = x;
         this.serverPositionY_ = y;
         this.serverPositionError_ = Math.max(0,distance - expectedLead);
         this.serverPositionErrorTime_ = time;
         this.temporalServerOffsetTime_ = -1;
      }

      public function dodgePositionUncertainty(time:int) : Number {
         if(this.serverPositionErrorTime_ < 0 || time - this.serverPositionErrorTime_ > 750) {
            return 0;
         }
         return Math.min(0.35,this.serverPositionError_);
      }

      public function dodgeServerOffsetX(time:int) : Number {
         if(this.serverPositionErrorTime_ < 0 || time - this.serverPositionErrorTime_ > 750) {
            return 0;
         }
         return this.serverPositionX_ - this.x_;
      }

      public function dodgeServerOffsetY(time:int) : Number {
         if(this.serverPositionErrorTime_ < 0 || time - this.serverPositionErrorTime_ > 750) {
            return 0;
         }
         return this.serverPositionY_ - this.y_;
      }

      /** Advance the latest authoritative sample along its measured NEWTICK
       * velocity, but only toward the current local position and never beyond
       * it. This time-aligns normal acknowledgement lag without widening the
       * entire gap into a collision corridor. */
      private function updateTemporalServerOffset(time:int) : void {
         if(this.temporalServerOffsetTime_ == time &&
               this.temporalServerOffsetLocalX_ == this.x_ &&
               this.temporalServerOffsetLocalY_ == this.y_) {
            return;
         }
         this.temporalServerOffsetTime_ = time;
         this.temporalServerOffsetLocalX_ = this.x_;
         this.temporalServerOffsetLocalY_ = this.y_;
         this.temporalServerOffsetX_ = 0;
         this.temporalServerOffsetY_ = 0;
         if(this.serverPositionErrorTime_ < 0 ||
               time - this.serverPositionErrorTime_ > 750) {
            return;
         }
         var towardLocalX:Number = this.x_ - this.serverPositionX_;
         var towardLocalY:Number = this.y_ - this.serverPositionY_;
         var distance:Number = Math.sqrt(towardLocalX * towardLocalX +
               towardLocalY * towardLocalY);
         if(distance < 0.0001) {
            return;
         }
         var unitX:Number = towardLocalX / distance;
         var unitY:Number = towardLocalY / distance;
         var ageMs:int = Math.max(0,Math.min(350,
               time - this.serverPositionErrorTime_));
         var progress:Number = (this.serverVelocityX_ * unitX +
               this.serverVelocityY_ * unitY) * ageMs;
         progress = Math.max(0,Math.min(distance,progress));
         this.temporalServerOffsetX_ = this.serverPositionX_ +
               unitX * progress - this.x_;
         this.temporalServerOffsetY_ = this.serverPositionY_ +
               unitY * progress - this.y_;
      }

      public function dodgeTemporalServerOffsetX(time:int) : Number {
         this.updateTemporalServerOffset(time);
         return this.temporalServerOffsetX_;
      }

      public function dodgeTemporalServerOffsetY(time:int) : Number {
         this.updateTemporalServerOffset(time);
         return this.temporalServerOffsetY_;
      }

      public function dodgeTemporalServerPathActive(time:int) : Boolean {
         this.updateTemporalServerOffset(time);
         return this.temporalServerOffsetX_ * this.temporalServerOffsetX_ +
               this.temporalServerOffsetY_ * this.temporalServerOffsetY_ >=
               0.04 * 0.04;
      }

      public function dodgeServerRebaseActive(time:int) : Boolean {
         if(this.serverPositionErrorTime_ < 0 ||
               time - this.serverPositionErrorTime_ > 750) {
            return false;
         }
         var offsetX:Number = this.serverPositionX_ - this.x_;
         var offsetY:Number = this.serverPositionY_ - this.y_;
         return this.serverPositionError_ > 0 &&
               offsetX * offsetX + offsetY * offsetY >=
               SERVER_POSITION_REBASE_MIN_DISTANCE *
               SERVER_POSITION_REBASE_MIN_DISTANCE;
      }

      public function collisionFrameStartX(time:int) : Number {
         return this.collisionFrameTime_ == time ? this.collisionFrameStartX_ : this.x_;
      }

      public function collisionFrameStartY(time:int) : Number {
         return this.collisionFrameTime_ == time ? this.collisionFrameStartY_ : this.y_;
      }

      public function collisionFrameEndX(time:int) : Number {
         return this.collisionFrameTime_ == time ? this.collisionFrameEndX_ : this.x_;
      }

      public function collisionFrameEndY(time:int) : Number {
         return this.collisionFrameTime_ == time ? this.collisionFrameEndY_ : this.y_;
      }

      public function logAutoDodgeHit(projectile:Projectile, time:int) : void {
         if(this.autoDodgeController_ != null && Parameters.data.autoDodge) {
            this.autoDodgeController_.logHit(this,projectile,time);
         }
      }

      public function getAutoDodgeDebugVelocity(out:Point) : Boolean {
         if(out == null || this.autoDodgeController_ == null ||
               !Parameters.data.autoDodge || !Parameters.data.autoDodgePredictive) {
            return false;
         }
         out.setTo(this.autoDodgeController_.debugVelocityX,
               this.autoDodgeController_.debugVelocityY);
         return true;
      }

      public function get autoDodgeOverrideActive() : Boolean {
         return this.autoDodgeController_ != null && Parameters.data.autoDodge &&
               Parameters.data.autoDodgePredictive && this.autoDodgeController_.overrideActive;
      }

      /** Strategic Ack Suppression: true when Auto Dodge has determined this
       * large/lethal hit was unavoidable and the caller must drop it entirely
       * (no local damage, no PLAYERHIT/AOEACK-driven damage). Because the client
       * is the damage authority, an unreported projectile hit is never applied
       * by the server. Gated by option + predictive dodge being active. */
      public function strategicAckSuppresses(effectiveDamage:int) : Boolean {
         return this.autoDodgeController_ != null && Parameters.data.autoDodge &&
               Parameters.data.autoDodgePredictive &&
               this.autoDodgeController_.shouldSuppressStrategicHit(effectiveDamage);
      }

      /** True when `effectiveDamage` would take the player to 0 on ANY of the
       * three HP figures we track (client prediction, server hp_, synced
       * baseline). Deliberately pessimistic: the three disagree whenever local
       * damage is pending server confirmation, and for Buddha Mode a false
       * negative is a death while a false positive is one wasted suppression. */
      public function damageIsLethal(effectiveDamage:int) : Boolean {
         // Only consider figures that are actually populated. hp_ and syncedChp
         // are both 0 until the first stat tick lands, and treating an unset 0
         // as "1 damage is lethal" would silently turn Buddha Mode into full
         // godmode for the first moments on every map.
         var lowest:int = int.MAX_VALUE;
         if(this.clientHp > 0 && this.clientHp < lowest) {
            lowest = this.clientHp;
         }
         if(this.hp_ > 0 && this.hp_ < lowest) {
            lowest = this.hp_;
         }
         if(this.syncedChp > 0 && this.syncedChp < lowest) {
            lowest = this.syncedChp;
         }
         if(lowest == int.MAX_VALUE) {
            // Nothing positive to compare against: the player is already at or
            // below 0 on every tracked figure. Any further hit is lethal.
            return true;
         }
         return effectiveDamage >= lowest;
      }

      /**
       * Why this projectile hit must be dropped ENTIRELY -- no local HP charge
       * and no PLAYERHIT -- or null to take the hit normally.
       *
       * The client is the damage authority for enemy projectiles: the server
       * applies damage for a bullet only once we acknowledge it with PLAYERHIT.
       * So suppression has to be symmetric. Withholding the packet while still
       * subtracting clientHp locally is the worst of both worlds -- the player
       * takes damage the server never applied, clientHp drifts below the real
       * HP, and auto-nexus fires on a phantom deficit. Both halves are decided
       * here so they can never disagree.
       *
       * The returned string is also the DebugLog event prefix, so
       * "strategic_ack" keeps emitting the existing strategic_ack_suppressed
       * event that the dashboards already read.
       */
      public function playerHitSuppressionReason(effectiveDamage:int) : String {
         // Partial Godmode: unconditional, a debug/testing option.
         if(Parameters.data.partialGodMode) {
            return "partial_godmode";
         }
         // Buddha Mode: survive-only. Non-lethal hits land normally, so HP,
         // damage numbers and threat feedback all stay real; only the killing
         // blow is refused.
         if(Parameters.data.buddhaMode === true && this.damageIsLethal(effectiveDamage)) {
            return "buddha";
         }
         // Strategic Ack Suppression: Auto Dodge judged this hit unavoidable.
         if(Parameters.data.autoDodgeStrategicAckSuppression === true &&
               this.strategicAckSuppresses(effectiveDamage)) {
            return "strategic_ack";
         }
         return null;
      }

      /** Auto Play stand-and-shoot spacing hook: writes a world-space unit
       * drift direction into `out` when Proactive Spacing suggests moving off a
       * wall, else false. Auto Play applies the movement itself. */
      public function dodgeSpacingDirection(map:Map, out:Point) : Boolean {
         return this.autoDodgeController_ != null && Parameters.data.autoDodge &&
               Parameters.data.autoDodgePredictive &&
               this.autoDodgeController_.proactiveSpacingDirection(map,this.x_,
                     this.y_,out);
      }

      public function checkHealth(time:int = -1) : Boolean {
         var len:int = 0;
         var equipId:int = 0;
         var slotId:int = 0;
         // disconnect() can detach the player/map synchronously during an auto-
         // nexus frame. Keep the GameSprite that initiated this check and do not
         // dereference map_ again after disconnecting.
         var gameSprite:* = this.map_ != null ? this.map_.gs_ : null;
         if(gameSprite == null) {
            return false;
         }
         if(time == -1) {
            time = TimeUtil.getModdedTime();
         }
         this.expirePredictedDamage(time);
         if (!gameSprite.isSafeMap) {
            if (Parameters.data.AutoNexus == 0 || Parameters.suicideMode) {
               return false;
            }
            // Bail early by however much unattributed damage we are actually
            // observing (see effectiveAutoNexusThreshold): most incoming damage
            // is never modelled, so the configured threshold alone is optimistic.
            var nexusAt:int = this.effectiveAutoNexusThreshold();
            if (this.clientHp <= nexusAt || this.hp_ <= nexusAt || this.syncedChp <= nexusAt) {
               var mapName:String = this.map_ != null ? this.map_.name_ : "";
               DebugLog.event("auto_nexus_trigger",{
                  "hp":this.hp_,"chp":this.clientHp,"sync":this.syncedChp,
                  "pendingDamage":this.predictedDamagePending_,
                  "pendingRecovery":this.predictedRecoveryPending_,
                  "threshold":this.autoNexusNumber,
                  "effectiveThreshold":nexusAt,
                  "unattributedDps":this.unattributedDpsDebug(),"map":mapName
               });
               gameSprite.gsc_.disconnect();
               this.addTextLine.dispatch(ChatMessage.make("*Help*","You were saved at " + this.hp_ + " health (" + this.clientHp + " chp)"));
               gameSprite.dispatchEvent(Parameters.reconNexus);
               return true;
            }
            if (!this.isSick && this.autoHpPotNumber != 0 && (this.hp_ <= this.autoHpPotNumber || this.clientHp <= this.autoHpPotNumber || this.syncedChp <= this.autoHpPotNumber) && time - this.lastHpPotTime > Parameters.data.autohpPotDelay) {
               len = this.hasBackpack_ ? 20 : 12;
               slotId = 4;
               while (slotId < len) {
                  equipId = this.equipment_[slotId];
                  if (Parameters.hpPotions.indexOf(equipId) != -1) {
                     if (time == -1)
                        time = TimeUtil.getModdedTime();

                     this.map_.gs_.gsc_.useItem(time, this.objectId_, slotId, equipId, this.x_, this.y_, 1);

                     if (time == -1)
                        time = TimeUtil.getModdedTime();
                     this.lastHpPotTime = time;

                     return false;
                  }
                  slotId++;
               }

               if (Parameters.hpPotions.indexOf(quickSlotItem1) != -1
                       && quickSlotCount1 > 0) {
                  this.map_.gs_.gsc_.useItem(time, this.objectId_,
                          1000000, quickSlotItem1,
                          this.x_, this.y_, 1);

                  quickSlotCount1--;
                  if (quickSlotCount1 <= 0)
                     quickSlotItem1 = -1;

                  if (time == -1)
                     time = TimeUtil.getModdedTime();
                  this.lastHpPotTime = time;
                  return false;
               }

               if (Parameters.hpPotions.indexOf(quickSlotItem2) != -1
                       && quickSlotCount2 > 0) {
                  this.map_.gs_.gsc_.useItem(time, this.objectId_,
                          1000001, quickSlotItem2,
                          this.x_, this.y_, 1);

                  quickSlotCount2--;
                  if (quickSlotCount2 <= 0)
                     quickSlotItem2 = -1;

                  if (time == -1)
                     time = TimeUtil.getModdedTime();
                  this.lastHpPotTime = time;
                  return false;
               }

               if (Parameters.hpPotions.indexOf(quickSlotItem3) != -1
                       && quickSlotCount3 > 0) {
                  this.map_.gs_.gsc_.useItem(time, this.objectId_,
                          1000002, quickSlotItem3,
                          this.x_, this.y_, 1);

                  quickSlotCount3--;
                  if (quickSlotCount3 <= 0)
                     quickSlotItem3 = -1;

                  if (time == -1)
                     time = TimeUtil.getModdedTime();
                  this.lastHpPotTime = time;
                  return false;
               }
            }
         }
         return false;
      }

      public function checkMana(time:int = -1) : void {
         var abilityId:int = 0;
         var abilityXml:* = null;
         if(!this.map_.gs_.isSafeMap) {
            if(time == -1) {
               time = TimeUtil.getModdedTime();
            }
            if(this.autoMpPotNumber == 0 || this.isQuiet_() || time - lastMpPotTime < Parameters.data.autompPotDelay) {
               return;
            }
            if(this.autoMpPotNumber == -1) {
               abilityId = equipment_[1];
               if(abilityId == -1) {
                  return;
               }
               abilityXml = ObjectLibrary.xmlLibrary_[abilityId];
               if(this.mp_ > abilityXml.MpCost) {
                  return;
               }
               lookForMpPotAndDrink(time);
            } else if(this.mp_ <= this.autoMpPotNumber) {
               lookForMpPotAndDrink(time);
            }
         }
      }

      public function onMove() : void {
         var currentSquare:Square = null;
         if(map_) {
            currentSquare = map_.getSquare(x_,y_);
            if(currentSquare && currentSquare.props_ && currentSquare.props_.sinking_) {
               sinkLevel = Math.min(sinkLevel + 1,18);
               this.moveMultiplier_ = 0.1 + (1 - sinkLevel / 18) * (currentSquare.props_.speed_ - 0.1);
            } else {
               sinkLevel = 0;
               // NOTE: currentSquare (the Square) can be null — getSquare returns null at
               // map edges / during transitions. The old code dereferenced
               // currentSquare.props_ here without the null check the sinking branch has,
               // so moving onto an unloaded tile #1009'd. Guard both.
               if(currentSquare != null && currentSquare.props_ != null) {
                  this.moveMultiplier_ = currentSquare.props_.speed_;
               } else {
                  // A tile with no props used to fall back to 100x speed — which
                  // makes the player move so fast the server rejects the MOVE
                  // with FAILURE errorId=0 ("moved too fast") and disconnects.
                  // Use normal speed instead.
                  this.moveMultiplier_ = 1;
                  if(!Player.warnedNullTileSpeed_) {
                     Player.warnedNullTileSpeed_ = true;
                     CrashLogger.note("onMove: null tile/props (would have been 100x speed) at (" +
                             int(x_) + "," + int(y_) + ") — capped to 1x");
                  }
               }
            }
         }
      }

      public function attackFrequency() : Number {
         if(this.isDazed) {
            return 0.0015;
         }
         var freq:Number = 0.0015 + this.dexterity_ * 0.0133333333333333 * 0.0065;
         if(this.isBerserk) {
            freq = freq * 1.25;
         }
         return freq;
      }

      /**
       * Effective RateOfFire for a weapon's primary fire. The XML-level
       * <RateOfFire> is only read by the old attack-period code, but many weapons
       * (e.g. Staff of Extreme Prejudice: RateOfFire 0.4 on a <Subattack>) set it
       * on the subattack instead — so those paths defaulted to 1.0 and fired ~2.5x
       * too fast, which the server anti-cheats (errorId=0 shot flood). AttackData
       * already resolves the subattack's value (falling back to the weapon's).
       *
       * This drives the WEAPON's fire gate, so return the FASTEST subattack rate:
       * a weapon with mixed rates (e.g. Solar Flare Igniter: subattack 0 = 1.5,
       * subattack 1 = 0.5) must tick often enough for its fast subattack, and
       * doShoot then gates each subattack to its own rate individually.
       */
      /**
       * The weapon-level fire gate, in ms.
       *
       * Single source of truth for all three call sites. Two of them used to
       * recompute this WITHOUT the rate-of-fire enchant multiplier, and one of
       * those two is the real shoot() gate -- so an enchant that slows the
       * weapon (Overwhelming Strikes: -20% fire rate) was applied to the
       * animation but not to the packets, and the client out-fired what the
       * server allows. Matching the reference, the enchant multiplier divides
       * into the period exactly like RateOfFire does.
       */
      public function weaponAttackPeriod(weaponType:int) : Number {
         var enchantRate:Number = EnchantmentManager.rateOfFireMult(this);
         if(!(enchantRate > 0)) {
            enchantRate = 1;
         }
         var rateOfFire:Number = this.weaponRateOfFire(weaponType) * enchantRate;
         return 1 / this.attackFrequency() * (1 / rateOfFire);
      }

      public function weaponRateOfFire(weaponType:int) : Number {
         var p:ObjectProperties = ObjectLibrary.getPropsFromType(weaponType);
         if(p == null) {
            return 1;
         }
         if(p.attacks_ != null && p.attacks_.length > 0) {
            var maxR:Number = 0;
            for(var i:int = 0; i < p.attacks_.length; i++) {
               var r:Number = p.attacks_[i].rateOfFire;
               if(r > 0 && r != AttackData.F_UNSET && r > maxR) {
                  maxR = r;
               }
            }
            if(maxR > 0) {
               return maxR;
            }
         }
         return p.rateOfFire_ > 0 ? p.rateOfFire_ : 1;
      }

      public function canUseAltWeapon(time:int = -1, abilityXml:XML = null) : Boolean {
         if(time == -1) {
            time = TimeUtil.getModdedTime();
         }
         if(map_ == null) {
            return false;
         }
         if(this.isQuiet_()) {
            return false;
         }
         if(this.isSilenced) {
            return false;
         }
         if(time < this.nextAltAttack_) {
            return false;
         }
         var abilityId:int = equipment_[1];
         if(abilityId == -1) {
            return false;
         }
         if(abilityXml == null) {
            abilityXml = ObjectLibrary.xmlLibrary_[abilityId];
         }
         if(abilityXml.Activate == "Shoot" && this.isStunned) {
            return false;
         }
         if(abilityXml.MpCost > this.mp_) {
            return false;
         }
         return true;
      }

      public function getFamePortrait(size:int) : BitmapData {
         var maskedImage:* = null;
         if(this.famePortrait_ == null) {
            maskedImage = animatedChar_.imageFromDir(0,0,0);
            size = 4 / maskedImage.image_.width * size;
            this.famePortrait_ = TextureRedrawer.resize(maskedImage.image_,maskedImage.mask_,size,true,tex1Id_,tex2Id_);
            this.famePortrait_ = GlowRedrawer.outlineGlow(this.famePortrait_,0);
         }
         return this.famePortrait_;
      }

      // ── Kensei channel dash (Timber Sheath) ────────────────────────────────
      // The ability's first use starts a channel; while it is active, each further
      // ability press dashes toward the cursor (up to `amount` charges), which is
      // sent as a DASH packet. Server-validated: a dash beyond the ability's max
      // distance can errorId=0-kick, so distance is clamped unless the user opts
      // out via dashNoDistanceLimit. Wall collision is always applied.
      private var dashChargesLeft_:int = 0;
      private var dashArmedAt_:int = 0;         // earliest time a dash may fire
      private var dashChannelUntil_:int = 0;    // channel expiry
      private var dashSpeed_:Number = 50;
      private var dashMinDist_:Number = 1;
      private var dashMaxDist_:Number = 4;
      private var dashCooldownMs_:int = 400;    // per-dash cooldown (XML 0.4s)
      private var dashNextAt_:int = 0;          // earliest time for the NEXT dash
      private var dashAckPending_:Boolean = false;
      private var dashAckAt_:int = 0;

      private function dashChannelActive(time:int) : Boolean {
         return time <= this.dashChannelUntil_;
      }

      // Parse ChannelDash + StartUse>Dash from the ability XML and arm the channel.
      private function beginDashChannel(abilityXml:XML, time:int) : void {
         var amount:int = 3;
         var channelMs:int = 500;
         var durationDs:int = 20;
         var act:XML = null;
         for each(act in abilityXml.Activate) {
            if(act.toString() == "ChannelDash") {
               amount = act.hasOwnProperty("@amount") ? int(act.@amount) : amount;
               channelMs = act.hasOwnProperty("@channelTime") ? int(act.@channelTime) : channelMs;
               durationDs = act.hasOwnProperty("@duration") ? int(act.@duration) : durationDs;
            }
         }
         this.dashSpeed_ = 50;
         this.dashMinDist_ = 1;
         this.dashMaxDist_ = 4;
         this.dashCooldownMs_ = 400;
         if("StartUse" in abilityXml) {
            for each(act in abilityXml.StartUse.Activate) {
               if(act.toString() == "Dash") {
                  this.dashSpeed_ = act.hasOwnProperty("@speed") ? Number(act.@speed) : 50;
                  this.dashMinDist_ = act.hasOwnProperty("@minDistance") ? Number(act.@minDistance) : 1;
                  this.dashMaxDist_ = act.hasOwnProperty("@maxDistance") ? Number(act.@maxDistance) : 4;
                  this.dashCooldownMs_ = act.hasOwnProperty("@cooldown") ? int(Number(act.@cooldown) * 1000) : 400;
               }
            }
         }
         this.dashChargesLeft_ = amount;
         this.dashArmedAt_ = time + channelMs;
         this.dashNextAt_ = time + channelMs;
         this.dashChannelUntil_ = time + channelMs + durationDs * 100;
      }

      // Fire one dash toward (tx,ty): clamp to XML distance (unless opted out),
      // wall-clamp along the ray, teleport locally, and send DASH; the DASH_ACK is
      // sent after the travel time (distance/speed) from updateDash().
      private function startDash(tx:Number, ty:Number, worldCoords:Boolean, time:int) : void {
         var ang:Number;
         var desired:Number;
         if(worldCoords) {
            ang = Math.atan2(ty - y_,tx - x_);
            desired = Math.sqrt((tx - x_) * (tx - x_) + (ty - y_) * (ty - y_));
         } else {
            ang = Parameters.data.cameraAngle + Math.atan2(ty,tx);
            desired = Math.sqrt(tx * tx + ty * ty) * 0.02;
         }
         if(!Parameters.data.dashNoDistanceLimit) {
            desired = Math.max(this.dashMinDist_,Math.min(this.dashMaxDist_,desired));
         }
         var dx:Number = Math.cos(ang);
         var dy:Number = Math.sin(ang);
         var validD:Number = 0;
         var d:Number = 0.5;
         while(d <= desired + 0.0001) {
            if(this.isValidPosition(x_ + dx * d,y_ + dy * d)) {
               validD = d;
               d += 0.5;
            } else {
               break;
            }
         }
         if(validD >= desired - 0.5 && this.isValidPosition(x_ + dx * desired,y_ + dy * desired)) {
            validD = desired;
         }
         if(validD <= 0) {
            SoundEffectLibrary.play("error");
            return;
         }
         var endX:Number = x_ + dx * validD;
         var endY:Number = y_ + dy * validD;
         map_.gs_.gsc_.dash(time,x_,y_,endX,endY);
         this.moveTo(endX,endY);
         this.dashChargesLeft_--;
         this.dashNextAt_ = time + this.dashCooldownMs_;
         this.dashAckPending_ = true;
         this.dashAckAt_ = time + Math.max(1,int(validD / this.dashSpeed_ * 1000));
      }

      // Send the deferred DASH_ACK once the (distance/speed) travel time elapses.
      private function updateDash(time:int) : void {
         if(this.dashAckPending_ && time >= this.dashAckAt_) {
            this.dashAckPending_ = false;
            if(map_ != null && map_.gs_ != null && map_.gs_.gsc_ != null) {
               map_.gs_.gsc_.dashAck(time);
            }
         }
      }

      public function useAltWeapon(targetX:Number, targetY:Number, actionId:int, time:int = -1, worldCoords:Boolean = false, abilityXml:XML = null) : Boolean {
         var mpCost:int = 0;
         var cooldown:int = 0;
         var targetPoint:* = null;
         var distance:Number = NaN;
         var angle:Number = NaN;
         var teleportCheckPoint:* = null;
         var isShoot:Boolean = false;
         var useWorldTarget:Boolean = false;
         var isToss:Boolean = false;
         var activateName:* = null;
         var bulletDist:Number = NaN;
         var clampedBulletDist:Number = NaN;
         var bulletOrigin:* = null;
         var projProps:ProjectileProperties = null;
         var projReach:Number = NaN;
         var offsetAngle:Number = NaN;
         var occupancyCheckPoint:* = null;
         var activateEntry:* = null;
         var isChannelDash:Boolean = false;
         if(time == -1) {
            time = TimeUtil.getModdedTime();
         }
         if(map_ == null) {
            return false;
         }
         var abilityId:int = equipment_[1];
         if(abilityId == -1) {
            return false;
         }
         if(abilityXml == null) {
            abilityXml = ObjectLibrary.xmlLibrary_[abilityId];
         }
         if(abilityXml == null || !("Usable" in abilityXml)) {
            return false;
         }
         if(this.isQuiet) {
            SoundEffectLibrary.play("error");
            return false;
         }
         if(this.isSilenced) {
            SoundEffectLibrary.play("error");
            return false;
         }
         if(abilityXml.Activate == "Shoot" && this.isStunned) {
            SoundEffectLibrary.play("error");
            return false;
         }
         if(actionId == 1) {
            for each(activateEntry in abilityXml.Activate) {
               activateName = activateEntry.toString();
               if(activateName == "TeleportLimit") {
                  distance = activateEntry.@maxDistance;
                  teleportCheckPoint = new Point(x_ + distance * Math.cos(angle),y_ + distance * Math.sin(angle));
                  if(!this.isValidPosition(teleportCheckPoint.x,teleportCheckPoint.y)) {
                     SoundEffectLibrary.play("error");
                     return false;
                  }
               }
               if(activateName == "Teleport" || activateName == "ObjectToss") {
                  useWorldTarget = true;
                  isToss = true;
               }
               if(activateName == "BulletNova" || activateName == "PoisonGrenade" || activateName == "VampireBlast" || activateName == "Trap" || activateName == "BoostRange" || activateName == "StasisBlast") {
                  useWorldTarget = true;
               }
               if(activateName == "Shoot") {
                  isShoot = true;
               }
               if(activateName == "ChannelDash") {
                  isChannelDash = true;
               }
               if(activateName == "BulletCreate") {
                  angle = Math.atan2(targetY - y_,targetX - x_);
                  bulletDist = Math.sqrt(targetX * targetX + targetY * targetY) / 50;
                  clampedBulletDist = Math.max(this.getAttribute(activateEntry,"minDistance",0),Math.min(this.getAttribute(activateEntry,"maxDistance",4.4),bulletDist));
                  bulletOrigin = new Point(x_ + clampedBulletDist * Math.cos(angle),y_ + clampedBulletDist * Math.sin(angle));
                  projProps = ObjectLibrary.propsLibrary_[abilityId].projectiles_[0];
                  projReach = projProps.speed * projProps.lifetime / 20000;
                  offsetAngle = angle + this.getAttribute(activateEntry,"offsetAngle",90) * 0.0174532925199433;
                  occupancyCheckPoint = new Point(bulletOrigin.x + projReach * Math.cos(offsetAngle + 3.14159265358979),bulletOrigin.y + projReach * Math.sin(offsetAngle + 3.14159265358979));
                  if(this.isFullOccupy(occupancyCheckPoint.x + 0.5,occupancyCheckPoint.y + 0.5)) {
                     SoundEffectLibrary.play("error");
                     return false;
                  }
               }
            }
         }
         // While a dash channel is active, an ability press dashes toward the
         // cursor instead of re-activating (which USEITEM would do). Intercept
         // before the cooldown/MP gates below, which apply only to activation.
         if(isChannelDash && actionId == 1 && this.dashChannelActive(time)) {
            // Ready = past channelTime, off per-dash cooldown, charges left, prior
            // dash acked. Consume the press either way (no error spam while the key
            // is held during the channel / cooldown window).
            if(time >= this.dashArmedAt_ && time >= this.dashNextAt_ &&
                  this.dashChargesLeft_ > 0 && !this.dashAckPending_) {
               this.startDash(targetX,targetY,worldCoords,time);
            }
            return true;
         }
         if(worldCoords) {
            targetPoint = new Point(targetX,targetY);
            angle = Math.atan2(targetY - y_,targetX - x_);
         } else {
            angle = Parameters.data.cameraAngle + Math.atan2(targetY,targetX);
            if(useWorldTarget) {
               targetPoint = sToW(targetX,targetY);
            } else {
               distance = Math.sqrt(targetX * targetX + targetY * targetY) * 0.02;
               targetPoint = new Point(x_ + distance * Math.cos(angle),y_ + distance * Math.sin(angle));
            }
         }
         if(objectType_ == 804 || abilityId == 2650 && isToss) {
            if(targetPoint == null) {
               SoundEffectLibrary.play("error");
               return false;
            }
            if(!isValidPosition(targetPoint.x,targetPoint.y)) {
               SoundEffectLibrary.play("error");
               return false;
            }
         }
         if(actionId == 1) {
            if(time < this.nextAltAttack_) {
               SoundEffectLibrary.play("error");
               return false;
            }
            mpCost = abilityXml.MpCost;
            if(mpCost > this.mp_) {
               SoundEffectLibrary.play("no_mana");
               return false;
            }
            cooldown = 550;
            if("Cooldown" in abilityXml) {
               cooldown = abilityXml.Cooldown * 1000;
            }
            this.nextAltAttack_ = time + cooldown;
            this.mpZeroed_ = false;
            if(targetPoint) {
               map_.gs_.gsc_.useItem(time,objectId_,1,abilityId,targetPoint.x,targetPoint.y,actionId);
            } else {
               map_.gs_.gsc_.useItem(time,objectId_,1,abilityId,x_,y_,actionId);
            }
            if(isChannelDash) {
               // Activation press: arm the dash channel so subsequent presses dash.
               this.beginDashChannel(abilityXml,time);
            }
            if(isShoot) {
               this.doShoot(time,abilityId,abilityXml,angle,false,false,false);
            }
         } else if("MultiPhase" in abilityXml) {
            map_.gs_.gsc_.useItem(time,objectId_,1,abilityId,targetPoint.x,targetPoint.y,actionId);
            mpCost = abilityXml.MpEndCost;
            if(mpCost <= this.mp_ && !this.mpZeroed_ && !map_.isPetYard && !map_.isQuestRoom) {
               this.doShoot(time,abilityId,abilityXml,angle,false,false,false);
            }
         }
         return true;
      }

      public function getAttribute(xml:XML, attrName:String, defaultValue:Number = 0) : Number {
         return !!xml.hasOwnProperty("@" + attrName)?xml[attrName]:defaultValue;
      }

      public function isHexed() : Boolean {
         return (condition_[0] & 134217728) != 0;
      }

      public function isInventoryFull() : Boolean {
         var slotIndex:int = 0;
         if(equipment_ == null) {
            return false;
         }
         var length:uint = this.inventoryEndIndex();
         slotIndex = 4;
         while(slotIndex < length) {
            if(equipment_[slotIndex] == -1) {
               return false;
            }
            slotIndex++;
         }
         return true;
      }

      public function nextAvailableInventorySlot() : int {
         var slotIndex:int = 0;
         var length:uint = this.inventoryEndIndex();
         slotIndex = 4;
         while(slotIndex < length) {
            if(equipment_[slotIndex] <= 0) {
               return slotIndex;
            }
            slotIndex++;
         }
         return -1;
      }

      public function numberOfAvailableSlots() : int {
         var slotIndex:int = 0;
         var count:int = 0;
         var length:uint = this.inventoryEndIndex();
         slotIndex = 4;
         while(slotIndex < length) {
            if(equipment_[slotIndex] <= 0) {
               count++;
            }
            slotIndex++;
         }
         return count;
      }

      private function inventoryEndIndex() : int {
         if(this.equipment_ == null) {
            return 4;
         }
         // This client renders the eight inventory slots (4-11) and the eight
         // legacy backpack slots (12-19). Do not mistake hidden/locked backpack
         // storage for free space when the server says no backpack is active,
         // and never target the expanded range (20+) until the server has
         // proven it usable -- placeholder slot stats alone are not evidence.
         if(!this.hasBackpack_) {
            return Math.min(this.equipment_.length,12);
         }
         return Math.min(this.equipment_.length,this.expandedBackpackConfirmed_ ?
               Math.max(20,this.backpackMaxSlotSeen_ + 1) : 20);
      }

      public function logAutoDodgeAoeHit(time:int, centerX:Number,
                                         centerY:Number, radius:Number,
                                         rawDamage:int, effectiveDamage:int,
                                         armorPiercing:Boolean, effect:int,
                                         effectDuration:Number,
                                         originType:int) : void {
         if(this.autoDodgeController_ != null && Parameters.data.autoDodge) {
            this.autoDodgeController_.logAoeHit(this,time,centerX,centerY,radius,
                  rawDamage,effectiveDamage,armorPiercing,effect,
                  effectDuration,originType);
         }
      }

      /** Pre-impact counterpart to checkHealth(). The caller supplies damage
       * from Auto Dodge's safest route, so this fires only when every modeled
       * escape still lands at or below the user's configured threshold. */
      public function checkPredictiveAutoNexus(time:int, predictedDamage:int,
                                               impactMs:int, candidate:int,
                                               threats:int,
                                               decision:String) : Boolean {
         var gameSprite:* = this.map_ != null ? this.map_.gs_ : null;
         if(gameSprite == null || gameSprite.isSafeMap ||
               Parameters.data.AutoNexus == 0 || Parameters.suicideMode ||
               predictedDamage <= 0) {
            return false;
         }
         this.expirePredictedDamage(time);
         var survivalHp:int = this.hp_;
         if(this.clientHp > 0) {
            survivalHp = survivalHp > 0 ? Math.min(survivalHp,this.clientHp) :
                  this.clientHp;
         }
         if(this.syncedChp > 0) {
            survivalHp = survivalHp > 0 ? Math.min(survivalHp,this.syncedChp) :
                  this.syncedChp;
         }
         if(survivalHp <= 0 || survivalHp - predictedDamage >
               this.autoNexusNumber) {
            return false;
         }
         var mapName:String = this.map_ != null ? this.map_.name_ : "";
         DebugLog.event("auto_nexus_predictive",{
            "hp":this.hp_,"chp":this.clientHp,"sync":this.syncedChp,
            "survivalHp":survivalHp,"predictedDamage":predictedDamage,
            "impactMs":impactMs,"candidate":candidate,"threats":threats,
            "decision":decision,"threshold":this.autoNexusNumber,
            "pendingDamage":this.predictedDamagePending_,"map":mapName
         });
         gameSprite.gsc_.disconnect();
         this.addTextLine.dispatch(ChatMessage.make("*Help*","A lethal volley was predicted at " +
               survivalHp + " health (" + predictedDamage + " incoming)"));
         gameSprite.dispatchEvent(Parameters.reconNexus);
         return true;
      }

      /** Apply the legacy presence bit without allowing it alone to expose
       * modern backpack slots. Seasonal compatibility stats can toggle this
       * bit at every map load, so only positive inventory evidence may clear a
       * structural rejection for the current character. */
      public function setBackpackFlag(value:Boolean) : Boolean {
         var previous:Boolean = this.hasBackpack_;
         var charId:int = this.backpackCharacterId();
         var persistedRejection:Boolean = charId > 0 &&
               backpackAuthorityRejectedByChar_[charId] === true;
         this.backpackAuthorityRejected_ = this.backpackAuthorityRejected_ ||
               persistedRejection;
         this.backpackFlag_ = value;
         if(!value) {
            this.backpackStatsSeen_ = false;
            this.backpackMaxSlotSeen_ = 19;
            this.expandedBackpackConfirmed_ = false;
         }
         this.hasBackpack_ = value && this.backpackStatsSeen_ &&
               !this.backpackAuthorityRejected_ && !this.deniedByCharList();
         return previous != this.hasBackpack_;
      }

      /**
       * True when /char/list explicitly said this character has ZERO backpack
       * slots. The server sends stat 79 and the (empty) modern backpack slot
       * stats to seasonal characters that own no backpack, so the in-game stat
       * stream alone reports a phantom backpack on brand-new seasonal chars.
       * A successful swap into slot 12+ still overrides this via
       * confirmBackpackAuthority — real evidence beats a stale list.
       */
      private function deniedByCharList() : Boolean {
         return declaredBackpackSlots(this.backpackCharacterId()) == 0;
      }

      private function backpackCharacterId() : int {
         return this.map_ != null && this.map_.gs_ != null &&
               this.map_.gs_.gsc_ != null ? this.map_.gs_.gsc_.charId_ : 0;
      }

      /** Modern backpack inventory is carried in stats 131-146, not in the
       * old INVENTORY_0..11 range. Seeing one of those slots is the second half
       * of usable-capacity authority and also grows the local vector safely. */
      public function setBackpackSlot(slotIndex:int, itemType:int) : Boolean {
         var previous:Boolean = this.hasBackpack_;
         while(this.equipment_.length <= slotIndex) {
            this.equipment_.push(-1);
         }
         if(this.lockedSlot == null) {
            this.lockedSlot = new Vector.<int>();
         }
         while(this.lockedSlot.length <= slotIndex) {
            this.lockedSlot.push(0);
         }
         this.equipment_[slotIndex] = itemType;
         // Only a slot in the real backpack range (>=12) is evidence of a
         // backpack. Guards against a mis-routed stat mapping to a low index and
         // falsely flipping backpack presence (the seasonal-crucible bug wrote to
         // slots 6/7/9/10). Legit backpack stats map to 12+ so this never blocks a
         // real backpack.
         if(slotIndex >= 12) {
            this.backpackStatsSeen_ = true;
            this.backpackMaxSlotSeen_ = Math.max(this.backpackMaxSlotSeen_,slotIndex);
         }
         // A real item reported in a modern backpack slot is stronger evidence
         // than the seasonal empty-slot compatibility block that caused the
         // rejection. Empty -1 stats alone deliberately cannot re-enable it.
         if(itemType > 0) {
            this.confirmBackpackAuthority(slotIndex);
         }
         this.hasBackpack_ = this.backpackFlag_ && !this.backpackAuthorityRejected_ &&
               !this.deniedByCharList();
         return previous != this.hasBackpack_;
      }

      /** A successful server inventory mutation touching slot 12+ proves that
       * this character owns usable backpack capacity. */
      public function confirmBackpackAuthority(slotIndex:int) : Boolean {
         if(slotIndex < 12) {
            return false;
         }
         var previous:Boolean = this.hasBackpack_;
         this.backpackFlag_ = true;
         this.backpackStatsSeen_ = true;
         this.backpackAuthorityRejected_ = false;
         this.backpackMaxSlotSeen_ = Math.max(this.backpackMaxSlotSeen_,slotIndex);
         // Only a SUCCESSFUL mutation reaches here, so a server-populated slot
         // 20+ is genuine proof of expanded capacity — but honour the rejection
         // latch: if the server already refused an auto-loot swap into 20+ this
         // map, an item merely APPEARING there (e.g. deposited elsewhere) must
         // not re-open auto-loot targeting of it.
         if(slotIndex >= 20 && !this.expandedBackpackRejected_) {
            this.expandedBackpackConfirmed_ = true;
         }
         this.autoLootBackpackRejectCount_ = 0;
         this.autoLootBackpackLastRejectedItem_ = -1;
         this.autoLootBackpackLastRejectedSlot_ = -1;
         var charId:int = this.backpackCharacterId();
         if(charId > 0) {
            delete backpackAuthorityRejectedByChar_[charId];
            // A successful server swap into slot 12+ is harder evidence than a
            // /char/list snapshot taken before the backpack was bought, so let
            // it clear a stale "0 slots" denial for this character.
            if(declaredBackpackSlots(charId) == 0) {
               delete backpackSlotsByChar_[charId];
            }
         }
         this.hasBackpack_ = true;
         return previous != this.hasBackpack_;
      }

      public function swapInventoryIndex(section:String) : int {
         var slotIndex:* = 0;
         var start:int = 0;
         var end:* = 0;
         if(!this.hasBackpack_) {
            return -1;
         }
         if(section == "Backpack") {
            start = 4;
            end = 12;
         } else {
            start = 12;
            end = uint(equipment_.length);
         }
         slotIndex = start;
         while(slotIndex < end) {
            if(equipment_[slotIndex] <= 0) {
               return slotIndex;
            }
            slotIndex++;
         }
         return -1;
      }

      public function getPotionCount(potionId:int) : int {
         var potionOffset:* = int(potionId) - 2594;
         switch(potionOffset) {
            case 0:
               return this.healthPotionCount_;
            case 1:
               return this.magicPotionCount_;
            default:
               return 0;
         }
      }

      public function getTex1() : int {
         return tex1Id_;
      }

      public function getTex2() : int {
         return tex2Id_;
      }

      public function getClosestBag(requireAdjacent:Boolean) : Container {
         var distSq:Number = NaN;
         var closest:* = null;
         var obj:* = null;
         var bestDistSq:* = Infinity;
         for each(obj in map_.goDict_) {
            if(obj is Container) {
               distSq = getDistSquared(obj.x_,obj.y_,x_,y_);
               if(distSq < bestDistSq) {
                  if(requireAdjacent) {
                     if(distSq <= 1) {
                        closest = obj;
                     }
                  } else {
                     closest = obj;
                  }
                  bestDistSq = distSq;
               }
            }
         }
         return closest as Container;
      }

      public function getClosestPortal(requireAdjacent:Boolean) : Portal {
         var distSq:Number = NaN;
         var closest:* = null;
         var obj:* = null;
         var bestDistSq:* = Infinity;
         for each(obj in map_.goDict_) {
            if(obj is Portal) {
               distSq = getDistSquared(obj.x_,obj.y_,x_,y_);
               if(distSq < bestDistSq) {
                  if(requireAdjacent) {
                     if(distSq <= 1) {
                        closest = obj;
                     }
                  } else {
                     closest = obj;
                  }
                  bestDistSq = distSq;
               }
            }
         }
         return closest as Portal;
      }

      public function getClosestChest(requireAdjacent:Boolean) : Container {
         var distSq:Number = NaN;
         var closest:* = null;
         var obj:* = null;
         var bestDistSq:* = Infinity;
         for each(obj in map_.goDict_) {
            if(obj.objectType_ == 1284) {
               distSq = getDistSquared(obj.x_,obj.y_,x_,y_);
               if(distSq < bestDistSq) {
                  if(requireAdjacent) {
                     if(distSq <= 1) {
                        closest = obj;
                     }
                  } else {
                     closest = obj;
                  }
                  bestDistSq = distSq;
               }
            }
         }
         return closest as Container;
      }

      public function sToW(screenX:Number, screenY:Number) : Point {
         var camAngle:Number = Parameters.data.cameraAngle;
         var cos:Number = Math.cos(camAngle);
         var sin:Number = Math.sin(camAngle);
         screenX = screenX / 50;
         screenY = screenY / 50;
         var worldDx:Number = screenX * cos - screenY * sin;
         var worldDy:Number = screenX * sin + screenY * cos;
         return new Point(this.x_ + worldDx,this.y_ + worldDy);
      }

      public function wToS_opti(worldX:Number, worldY:Number) : Point {
         var camAngle:Number = Parameters.data.cameraAngle;
         var cos:Number = Math.cos(camAngle);
         var sin:Number = Math.sin(camAngle);
         var delta:Point = new Point(worldX - x_,worldY - y_);
         worldX = (delta.x * cos + delta.y * sin) * 50.5;
         worldY = (delta.y * cos - delta.x * sin) * 50.5;
         delta.x = worldX;
         delta.y = worldY;
         return delta;
      }

      public function handleTradePotsCommand(textMsg:Text) : void {
         var slotIndex:int = 0;
         if(MoreStringUtil.countCharInString(textMsg.text_,".") != 7) {
            return;
         }
         if(!this.map_.goDict_[textMsg.objectId_]) {
            return;
         }
         var requester:Player = this.map_.goDict_[textMsg.objectId_] as Player;
         if(getDistSquared(this.x_,this.y_,requester.x_,requester.y_) > 0.01) {
            return;
         }
         var parts:Array = textMsg.text_.substring(2).split(".");
         var wantAttack:int = parts[0];
         var wantSpeed:int = parts[1];
         var wantDefense:int = parts[2];
         var wantDexterity:int = parts[3];
         var wantVitality:int = parts[4];
         var wantWisdom:int = parts[5];
         var wantLife:int = parts[6];
         var wantMana:int = parts[7];
         var slotsToGive:Vector.<Boolean> = new <Boolean>[false,false,false,false,false,false,false,false,false,false,false,false];
         if(wantAttack > 0) {
            slotIndex = 4;
            while(slotIndex < 12) {
               if(isPotId(0,this.equipment_[slotIndex])) {
                  slotsToGive[slotIndex] = true;
               }
               slotIndex++;
            }
         }
         if(wantSpeed > 0) {
            slotIndex = 4;
            while(slotIndex < 12) {
               if(isPotId(2,this.equipment_[slotIndex])) {
                  slotsToGive[slotIndex] = true;
               }
               slotIndex++;
            }
         }
         if(wantDefense > 0) {
            slotIndex = 4;
            while(slotIndex < 12) {
               if(isPotId(1,this.equipment_[slotIndex])) {
                  slotsToGive[slotIndex] = true;
               }
               slotIndex++;
            }
         }
         if(wantDexterity > 0) {
            slotIndex = 4;
            while(slotIndex < 12) {
               if(isPotId(3,this.equipment_[slotIndex])) {
                  slotsToGive[slotIndex] = true;
               }
               slotIndex++;
            }
         }
         if(wantVitality > 0) {
            slotIndex = 4;
            while(slotIndex < 12) {
               if(isPotId(4,this.equipment_[slotIndex])) {
                  slotsToGive[slotIndex] = true;
               }
               slotIndex++;
            }
         }
         if(wantWisdom > 0) {
            slotIndex = 4;
            while(slotIndex < 12) {
               if(isPotId(5,this.equipment_[slotIndex])) {
                  slotsToGive[slotIndex] = true;
               }
               slotIndex++;
            }
         }
         if(wantLife > 0) {
            slotIndex = 4;
            while(slotIndex < 12) {
               if(isPotId(6,this.equipment_[slotIndex])) {
                  slotsToGive[slotIndex] = true;
               }
               slotIndex++;
            }
         }
         if(wantMana > 0) {
            slotIndex = 4;
            while(slotIndex < 12) {
               if(isPotId(7,this.equipment_[slotIndex])) {
                  slotsToGive[slotIndex] = true;
               }
               slotIndex++;
            }
         }
         if(slotsToGive.indexOf(true) > -1) {
            this.addTextLine.dispatch(ChatMessage.make("Potions","We have a potion " + requester.name_ + " needs!"));
            this.map_.gs_.gsc_.playerText("/trade " + textMsg.name_);
            Parameters.givingPotions = true;
            Parameters.potionsToTrade = slotsToGive;
            Parameters.recvrName = textMsg.name_;
            return;
         }
         this.addTextLine.dispatch(ChatMessage.make("Potions","We have nothing they need"));
      }

      public function isPotId(potType:int, itemId:int) : Boolean {
         switch(int(potType)) {
            case 0:
               return itemId == 2591 || itemId == 5465 || itemId == 9064 || itemId == 9729;
            case 1:
               return itemId == 2592 || itemId == 5466 || itemId == 9065 || itemId == 9727;
            case 2:
               return itemId == 2593 || itemId == 5467 || itemId == 9066 || itemId == 9726;
            case 3:
               return itemId == 2636 || itemId == 5470 || itemId == 9069 || itemId == 9728;
            case 4:
               return itemId == 2612 || itemId == 5468 || itemId == 9067 || itemId == 9724;
            case 5:
               return itemId == 2613 || itemId == 5469 || itemId == 9068 || itemId == 9725;
            case 6:
               return itemId == 2793 || itemId == 5471 || itemId == 9070;
            case 7:
               return itemId == 2794 || itemId == 5472 || itemId == 9071;
            default:
               return false;
         }
      }

      public function getPotType(itemId:int) : int {
         if(itemId == 2591 || itemId == 5465 || itemId == 9064 || itemId == 9729) {
            return 0;
         }
         if(itemId == 2592 || itemId == 5466 || itemId == 9065 || itemId == 9727) {
            return 1;
         }
         if(itemId == 2593 || itemId == 5467 || itemId == 9066 || itemId == 9726) {
            return 2;
         }
         if(itemId == 2636 || itemId == 5470 || itemId == 9069 || itemId == 9728) {
            return 3;
         }
         if(itemId == 2612 || itemId == 5468 || itemId == 9067 || itemId == 9724) {
            return 4;
         }
         if(itemId == 2613 || itemId == 5469 || itemId == 9068 || itemId == 9725) {
            return 5;
         }
         if(itemId == 2793 || itemId == 5471 || itemId == 9070) {
            return 6;
         }
         if(itemId == 2794 || itemId == 5472 || itemId == 9071) {
            return 7;
         }
         return -1;
      }

      public function shouldDrink(potType:int) : Boolean {
         if(potType == 0) {
            return attackMax_ - (attack_ - attackBoost_) > 0;
         }
         if(potType == 1) {
            return defenseMax_ - (defense_ - defenseBoost_) > 0;
         }
         if(potType == 2) {
            return speedMax_ - (speed_ - speedBoost_) > 0;
         }
         if(potType == 3) {
            return dexterityMax_ - (dexterity_ - dexterityBoost_) > 0;
         }
         if(potType == 4) {
            return vitalityMax_ - (vitality_ - vitalityBoost_) > 0;
         }
         if(potType == 5) {
            return wisdomMax_ - (wisdom - wisdomBoost_) > 0;
         }
         if(potType == 6) {
            return Math.ceil((maxHPMax_ - (maxHP_ - maxHPBoost_)) * 0.2) > 0;
         }
         if(potType == 7) {
            return Math.ceil((maxMPMax_ - (maxMP_ - maxMPBoost_)) * 0.2) > 0;
         }
         return false;
      }

      public function textNotification(text:String, color:int = 16777215, duration:int = 2000, showEffect:Boolean = false) : void {
         var statusText:CharacterStatusText = null;
         if(showEffect) {
            map_.addObj(new LevelUpEffect(this,color | 2130706432,20),x_,y_);
         }
         statusText = new CharacterStatusText(this,color,duration);
         statusText.setText(text);
         map_.mapOverlay_.addStatusText(statusText);
      }

      public function sbAssist(x:int, y:int) : void {
         var equipId:int = this.equipment_[1];
         var xml:XML = ObjectLibrary.xmlLibrary_[equipId];
         var distSq:Number = NaN;
         var bestEnemy:* = null;
         if(equipId == -1) {
            return;
         }
         for each(var activateEntry:GameObject in xml.Activate) {
            if(activateEntry.toString() == "Teleport") {
               this.useAltWeapon(x,y,1,-1,false);
               return;
            }
         }
         var worldPos:Point = sToW(x,y);
         var bestDistSq:* = Infinity;
         for each(var enemy:GameObject in map_.vulnEnemyDict_) {
            distSq = getDistSquared(enemy.x_,enemy.y_,worldPos.x,worldPos.y);
            if(distSq < bestDistSq) {
               bestDistSq = distSq;
               bestEnemy = enemy;
            }
         }
         if(bestDistSq <= 25) {
            this.useAltWeapon(bestEnemy.x_,bestEnemy.y_,1,-1,true);
         } else {
            this.useAltWeapon(x,y,1,-1,false);
         }
      }

      public function jump() : void {
      }

      protected function drawBreathBar(graphicsData:Vector.<GraphicsBitmapFill>, time:int) : void {
         var fillWidth:int = 0;
         if(this.breathBarFill == null || this.breathBarBackFill == null) {
            this.breathBarFill = new GraphicsBitmapFill();
            this.breathBarBackFill = new GraphicsBitmapFill();
         }
         var backColor:* = 1118481;
         if(this.breath_ <= 20) {
            backColor = uint(MoreColorUtil.lerpColor(1118481,16711680,Math.abs(Math.sin(time / 300)) * ((20 - this.breath_) / 20)));
         }
         this.breathBarBackFill.bitmapData = TextureRedrawer.redrawSolidSquare(backColor,42,7,-1);
         var screenX:int = posS_[0];
         var screenY:int = posS_[1];
         this.breathBarBackFillMatrix.identity();
         this.breathBarBackFillMatrix.translate(screenX - 20 - 5 - 1,screenY + 9 - 1);
         this.breathBarBackFill.matrix = this.breathBarBackFillMatrix;
         graphicsData.push(this.breathBarBackFill);
         if(this.breath_ > 0) {
            fillWidth = this.breath_ * 0.4;
            this.breathBarFill.bitmapData = TextureRedrawer.redrawSolidSquare(2542335,fillWidth,5,-1);
            this.breathBarFillMatrix.identity();
            this.breathBarFillMatrix.translate(screenX - 20 - 5,screenY + 9);
            this.breathBarFill.matrix = this.breathBarFillMatrix;
            graphicsData.push(this.breathBarFill);
         }
      }

      private function bForceExp() : Boolean {
         return Parameters.data.forceEXP == 1 || Parameters.data.forceEXP == 2 && map_.player_ == this;
      }

      private function getNearbyMerchant() : Merchant {
         var offset:* = null;
         var merchant:* = null;
         var signX:int = x_ - x_ > 0.5?1:-1;
         var signY:int = y_ - y_ > 0.5?1:-1;
         for each(offset in NEARBY) {
            this.ip_.x_ = x_ + signX * offset.x;
            this.ip_.y_ = y_ + signY * offset.y;
            merchant = map_.merchLookup_[this.ip_];
            if(merchant) {
               return this.getDistSquared(merchant.x_,merchant.y_,x_,y_) < 1?merchant:null;
            }
         }
         return null;
      }

      private function resetMoveVector(flipY:Boolean) : void {
         moveVec_.scaleBy(-0.5);
         if(flipY) {
            moveVec_.y = moveVec_.y * -1;
         } else {
            moveVec_.x = moveVec_.x * -1;
         }
      }

      private function calcHealth(dt:int) : void {
         var seconds:Number = dt * 0.001;
         var regenPerSec:Number = 1 + 0.12 * this.vitality_ * (this.isInCombat_()?1:2);
         // BREATH_STAT is the mechanic authority. Modern maps such as Katalund
         // use drowning without being named Ocean Trench, so a map-name flag
         // silently omitted their suffocation damage from client HP prediction.
         var suffocating:Boolean = this.breath_ == 0;
         if(!this.isSick && !this.isBleeding_()) {
            this.hpLog = this.hpLog + regenPerSec * seconds;
            if(this.isHealing_()) {
               this.hpLog = this.hpLog + 20 * (seconds / Parameters.data.timeScale);
            }
         } else if(this.isBleeding_()) {
            this.hpLog = this.hpLog - 20 * (seconds / Parameters.data.timeScale);
         }
         if(suffocating) {
            this.hpLog = this.hpLog - 94 * seconds;
         }
         var wholeHp:int = this.hpLog;
         var fractionalHp:Number = this.hpLog - wholeHp;
         this.hpLog = fractionalHp;
         var beforeHealth:int = this.clientHp;
         if(wholeHp < 0) {
            this.subtractDamage(-wholeHp,-1,suffocating ? "suffocation" : "bleeding");
         } else {
            this.clientHp = Math.min(this.maxHP_,this.clientHp + wholeHp);
         }
         var appliedRecovery:int = Math.max(0,this.clientHp - beforeHealth);
         if(appliedRecovery > 0) {
            this.predictedRecoveryPending_ += appliedRecovery;
         }
         if(Parameters.data.hpDebugLog) {
            this.hpRegenDebugElapsed_ += dt;
            this.hpRegenDebugAmount_ += wholeHp;
            if(this.hpRegenDebugElapsed_ >= 1000) {
               if(this.hpRegenDebugAmount_ != 0) {
                  DebugLog.event("hp_regen",{"amt":this.hpRegenDebugAmount_,
                     "chp":this.clientHp,"srv":this.hp_,"sync":this.syncedChp,
                     "pendingRecovery":this.predictedRecoveryPending_});
               }
               this.hpRegenDebugElapsed_ = 0;
               this.hpRegenDebugAmount_ = 0;
            }
         }
      }

      private function lookForMpPotAndDrink(time:int) : void {
         var itemId:int = 0;
         var slotIndex:int = 0;
         var drank:Boolean = false;
         var length:int = !!this.hasBackpack_?20:12;
         slotIndex = 4;
         while(slotIndex < length) {
            itemId = this.equipment_[slotIndex];
            if(itemId == 2595 || itemId == 3098) {
               this.map_.gs_.gsc_.useItem(time,this.objectId_,slotIndex,itemId,this.x_,this.y_,1);
               drank = true;
               break;
            }
            slotIndex++;
         }
         if(drank) {
            this.lastMpPotTime = time;
         }
      }

      private function numStarsToImage(numStars:int) : Sprite {
         var classCount:uint = ObjectLibrary.playerChars_.length;
         var star:Sprite = new StarGraphic();
         if(numStars < classCount) {
            star.transform.colorTransform = lightBlueCT;
         } else if(numStars < classCount * 2) {
            star.transform.colorTransform = darkBlueCT;
         } else if(numStars < classCount * 3) {
            star.transform.colorTransform = redCT;
         } else if(numStars < classCount * 4) {
            star.transform.colorTransform = orangeCT;
         } else if(numStars < classCount * 5) {
            star.transform.colorTransform = yellowCT;
         }
         return star;
      }

      private function getNameColor() : uint {
         return PlayerUtil.getPlayerNameColor(this);
      }

      // Debug accessors for the MOVE-speed diagnostic in
      // GameServerConnectionConcrete.move(). Expose the effective tiles/ms and
      // tile multiplier without changing getMoveSpeed's visibility.
      public function msPerTileDebug() : Number {
         return this.getMoveSpeed();
      }

      public function moveMultDebug() : Number {
         return this.moveMultiplier_;
      }

      private function getMoveSpeed() : Number {
         var speed:Number = NaN;
         // Tile speed multiplier — but never ABOVE 1. The current private
         // server's move validation caps speed at the base stat maximum and
         // does NOT honor speed-boost tiles (Nexus roads are MoveMultiplier
         // 1.4 in our GroundTypes): running a road at 1.4x reads as a
         // move-speed violation and, after ~a dozen ticks of it, the server
         // kicks with FAILURE errorId=0 (the realm/Nexus DC). Slow tiles are
         // still applied — slower than max is always legal. Toggle with
         // Parameters.data.trustTileSpeed if a server honors boosts.
         var _mult:Number = this.moveMultiplier_;
         if(_mult > 1 && !Parameters.data.trustTileSpeed) {
            _mult = 1;
         }
         if(this.isSlowed) {
            return 0.004 * _mult;
         }
         speed = 0.004 + this.speed_ * 0.0133333333333333 * 0.0056;
         if(this.isSpeedy || this.isNinjaSpeedy) {
            speed = speed * 1.5;
         }
         return speed * _mult * (!!this.isWalking?0.5:1);
      }

      private function attackMultiplier() : Number {
         if(this.isWeak) {
            return 0.5;
         }
         var mult:Number = 0.5 + this.attack_ * 0.0133333333333333 * 1.5;
         if(this.isDamaging) {
            mult = mult * 1.25;
         }
         return mult * this.exaltationDamageMultiplier / 100;
      }

      private function makeSkinTexture() : void {
         if(!this.skin) {
            return;
         }
         var skinImage:MaskedImage = this.skin.imageFromAngle(0,0,0);
         animatedChar_ = this.skin;
         texture = skinImage.image_;
         mask_ = skinImage.mask_;
         this.isDefaultAnimatedChar = true;
      }

      private function setToRandomAnimatedCharacter() : void {
         var hexTransforms:Vector.<XML> = ObjectLibrary.hexTransforms_;
         var index:uint = Math.floor(Math.random() * hexTransforms.length);
         var type:int = hexTransforms[index].@type;
         var textureData:TextureData = ObjectLibrary.typeToTextureData_[type];
         texture = textureData.texture_;
         mask_ = textureData.mask_;
         animatedChar_ = textureData.animatedChar_;
         this.isDefaultAnimatedChar = false;
      }

      private function shoot(angle:Number, time:int = -1, cultistFlag:Boolean = false) : void {
         if(map_ == null || this.isStunned_() || this.isInCombat_() || (this.isPetrified_() && !Parameters.data.ignorePetrified)) {
            return;
         }
         // (Reverted a safe-zone shoot gate here: vanilla DOES let you fire in the
         // Nexus, so shooting in a safe map is not what triggers the errorId=0
         // kick — the real realm DCs were the MAPINFO read-order and SHOOTACK
         // trailing-short bugs. See combat-disconnect-fixes.)
         var weaponId:int = equipment_[0];
         if(weaponId == -1) {
            this.addTextLine.dispatch(ChatMessage.make("*Error*","player.noWeaponEquipped"));
            return;
         }
         var weaponXml:XML = ObjectLibrary.xmlLibrary_[weaponId];
         if(time == -1) {
            time = TimeUtil.getModdedTime();
         }
         this.attackPeriod_ = this.weaponAttackPeriod(weaponId);
         if(time < attackStart_ + this.attackPeriod_) {
            return;
         }
         attackAngle_ = angle;
         attackStart_ = time;
         this.doShoot(attackStart_,weaponId,weaponXml,attackAngle_,true,true,cultistFlag);
      }

      // Per-weapon sub-attack runtime state (pattern cycling + oscillating angle),
      // keyed by weapon objectType. Reset lazily when a weapon's state is missing.
      private var subAttackState_:Object = {};

      /**
       * Burst cooldown for a BurstCount weapon, interpolated by dexterity.
       * Reference: clientShoot.cpp CalcBurstDelay --
       *   BurstDelay - min(1, dex/75) * (BurstDelay - BurstMinDelay)
       * so a 0-dex character waits the full BurstDelay and a 75+-dex character
       * waits only BurstMinDelay. Berserk shortens the floor by 25%.
       *
       * The old code used max(BurstDelay, BurstMinDelay), which is neither
       * endpoint of that interpolation and ignored dexterity entirely.
       */
      private function calcBurstDelay(attack:AttackData) : Number {
         var burstDelay:Number = attack.burstDelay;
         var burstMinDelay:Number = attack.burstMinDelay;
         if(burstDelay == AttackData.F_UNSET || burstDelay <= 0) {
            return 0;
         }
         if(burstMinDelay == AttackData.F_UNSET || burstMinDelay < 0) {
            burstMinDelay = burstDelay;
         }
         if(this.isBerserk) {
            burstMinDelay = burstMinDelay * 0.75;
         }
         var effDex:Number = Math.min(1,this.dexterity_ / 75.0);
         return burstDelay - effDex * (burstDelay - burstMinDelay);
      }

      /**
       * Minimum gap between two triggers of one subattack, in ms.
       * Reference: clientShoot.cpp ExecuteShoot --
       *   (1/attackFrequency) * (1/(enchantedRateOfFire * rateOfFire)) + 5
       *
       * The +5 and the ENCHANT multiplier were both missing. The enchant term
       * is the one that bites: a "decreased weapon fire rate by 20%" enchant
       * (Overwhelming Strikes) makes the server expect a 25% LONGER gap than we
       * were leaving, so an enchanted weapon out-fired its own server-side
       * allowance on every trigger.
       */
      private function subAttackCooldownMs(attack:AttackData) : Number {
         var subRate:Number = attack.rateOfFire;
         if(subRate <= 0 || subRate == AttackData.F_UNSET) {
            subRate = 1;
         }
         var enchantRate:Number = EnchantmentManager.rateOfFireMult(this);
         if(!(enchantRate > 0)) {
            enchantRate = 1;
         }
         return 1 / this.attackFrequency() * (1 / (enchantRate * subRate)) + 5;
      }

      private function getSubAttackStates(weaponType:int, count:int) : Array {
         var arr:Array = this.subAttackState_[weaponType];
         if(arr == null || arr.length != count) {
            arr = [];
            for(var i:int = 0; i < count; i++) {
               arr.push({"patternIndex":0, "incrCounter":0, "incrDir":1, "lastFireMs":-100000,
                         "burstLeft":0, "burstIdx":0, "burstNextMs":0, "burstDelayMs":0,
                         "startTime":-100000, "burstTimestamp":-100000, "burstEnd":-100000});
            }
            this.subAttackState_[weaponType] = arr;
         }
         return arr;
      }

      // Ported from the reference C++ (clientShoot.cpp DoShoot + asset_manager /
      // attackProperties). Fires EVERY <Subattack> of the weapon, each using its
      // own (possibly pattern-cycled) NumProjectiles / ArcGap / DefaultAngle /
      // projectileId / PosOffset, oscillating DefaultAngleIncr, and sends the
      // real attackIndex / patternIndex / burstIndex / attackType in PLAYERSHOOT.
      // Signature is unchanged so all callers (shoot, abilities, useAltWeapon)
      // keep working; isPrimary distinguishes main weapon vs ability. Falls back to
      // the legacy single-attack path only for items with no parsed attack data.
      private function doShoot(time:int, weaponType:int, weaponXml:XML, angle:Number, isPrimary:Boolean, useMult:Boolean, cultistFlag:Boolean = false) : void {
         if(!isNaN(angle)) {
            this.isShooting = isPrimary;
         }
         var props:ObjectProperties = ObjectLibrary.propsLibrary_[weaponType];
         if(props == null || props.attacks_ == null || props.attacks_.length == 0) {
            this.doShootLegacy(time,weaponType,weaponXml,angle,isPrimary,useMult,cultistFlag);
            return;
         }
         var states:Array = this.getSubAttackStates(weaponType, props.attacks_.length);
         var freq:Number = this.attackFrequency();
         var ai:int = 0;
         while(ai < props.attacks_.length) {
            // Fire each <Subattack> on its OWN cadence. The weapon gate ticks at
            // the fastest subattack's rate (see weaponRateOfFire); a slower
            // subattack fires only once its own rate interval has elapsed. Without
            // this, a mixed-rate weapon (Solar Flare Igniter: 1.5 + 0.5) fired its
            // 0.5 subattack at 1.5 -> 3x too many shots -> server shot-flood kick
            // (errorId=0). Single-subattack weapons keep firing every trigger.
            var st:Object = states[ai];
            var attackData:AttackData = props.attacks_[ai];
            var burstCount:int = attackData.burstCount;

            // NOT optional. The server enforces the burst budget whatever the
            // client thinks, so a toggle that skipped it only bought a kick --
            // which is why the reported disconnect reproduced with "Burst Fire"
            // both on and off.
            if(burstCount > 0) {
               // Reference clientShoot.cpp Shoot(): a BurstCount weapon fires a
               // fixed BUDGET of projectiles (burstCount * numProjectiles) as fast
               // as the normal attack cooldown allows, then goes silent until the
               // burst cooldown expires, measured from the START of the burst.
               //
               // This client used to do neither half: it spaced the volleys by
               // BurstDelay itself (~5x too slow) and, with the option off, never
               // applied a burst cooldown at all -- so it fired continuously at the
               // plain rate. The server enforces the budget, so continuous fire is
               // a shot flood and it answers with FAILURE errorId=0. That is the
               // B.O.W. disconnect, and it applies to all ~50 BurstCount weapons
               // (the entire Longbow family among them).
               var currentBurstDelay:Number = this.calcBurstDelay(attackData);
               if(time <= Number(st.burstEnd) && this.activeBurstWeaponType_ == weaponType) {
                  // Inside the active burst window: keep spending the budget.
                  if(int(st.burstLeft) > 0 && int(st.burstIdx) > 0) {
                     this.executeShoot(time,weaponType,attackData,ai,angle,isPrimary,
                           useMult,cultistFlag,st,props.attacks_.length,true);
                  }
                  ai++;
                  continue;
               }
               this.activeBurstWeaponType_ = weaponType;
               if(time <= Number(st.burstTimestamp) + currentBurstDelay) {
                  // Burst spent and still cooling down -- the silent part of the
                  // cadence. Extending burstEnd here mirrors the reference.
                  st.burstEnd = Number(st.burstTimestamp) + currentBurstDelay;
                  ai++;
                  continue;
               }
               // Start a new burst.
               st.burstIdx = 0;
               st.burstLeft = burstCount * this.plannedProjectileCount(attackData,st);
               if(!this.executeShoot(time,weaponType,attackData,ai,angle,isPrimary,
                     useMult,cultistFlag,st,props.attacks_.length,true)) {
                  ai++;
                  continue;
               }
               st.burstDelayMs = currentBurstDelay;
               st.burstTimestamp = time;
               st.burstEnd = time + currentBurstDelay;
               ai++;
               continue;
            }

            this.executeShoot(time,weaponType,attackData,ai,angle,isPrimary,
                  useMult,cultistFlag,st,props.attacks_.length,false);
            ai++;
         }
      }

      /** Weapon type whose burst is currently active (reference:
       *  activeBurstAttackIndex). Switching weapons abandons the old burst. */
      private var activeBurstWeaponType_:int = -1;

      /**
       * Projectiles one trigger of this subattack will emit, used to size the
       * burst budget the way the reference does (burstCount * NumProjectiles).
       * Reads the pattern that is actually next in the cycle.
       */
      private function plannedProjectileCount(attack:AttackData, state:Object) : int {
         var pattern:AttackData = attack.projectilePatternCount > 0 ?
               attack.getProjectilePattern(int(state.patternIndex)) : attack;
         return pattern.numProjectiles > 0 ? pattern.numProjectiles : 1;
      }

      /**
       * Reference clientShoot.cpp ExecuteShoot: fire this subattack if its own
       * cooldown has elapsed, and report whether it fired (the burst state
       * machine only arms a new burst on a shot that actually went out).
       */
      private function executeShoot(time:int, weaponType:int, attack:AttackData, attackIndex:int,
                                    angle:Number, isPrimary:Boolean, useMult:Boolean,
                                    cultistFlag:Boolean, state:Object, subCount:int,
                                    allowBurst:Boolean) : Boolean {
         var cooldown:Number = this.subAttackCooldownMs(attack);
         if(time < Number(state.startTime) + cooldown) {
            return false;
         }
         state.startTime = time;
         state.lastFireMs = time;
         this.doShootAttack(time,weaponType,attack,attackIndex,angle,isPrimary,useMult,
               cultistFlag,state,subCount,int(state.burstIdx),allowBurst);
         return true;
      }

      private function doShootAttack(time:int, weaponType:int, attack:AttackData, attackIndex:int,
                                     baseAngle:Number, isPrimary:Boolean, useMult:Boolean, cultistFlag:Boolean,
                                     state:Object, subCount:int = 1, burstIndex:int = 0,
                                     allowBurst:Boolean = false) : void {
         var proj:Projectile = null;
         // Pattern selection (cycles through <ProjectilePattern> if present).
         var hasPatterns:Boolean = attack.projectilePatternCount > 0;
         var patternIdx:int = hasPatterns ? int(state.patternIndex) : 0;
         var pattern:AttackData = attack.getProjectilePattern(patternIdx);
         var sentPatternIndex:int = hasPatterns ? patternIdx : -1;

         var numProj:int = pattern.numProjectiles > 0 ? pattern.numProjectiles : 1;
         var arcGap:Number = pattern.arcGap * Trig.toRadians;
         var defaultAngle:Number = pattern.defaultAngle * Trig.toRadians;
         var projectileId:int = pattern.projectileId;

         // Oscillating DefaultAngleIncr (a couple of weapons use it).
         var incrAngle:Number = 0;
         if(attack.defaultAngleIncrease != AttackData.NUM_UNSET && attack.defaultAngleIncrease != 0) {
            incrAngle = (attack.defaultAngleIncrease * Trig.toRadians) * int(state.incrCounter);
            state.incrCounter = int(state.incrCounter) + int(state.incrDir);
            if(int(state.incrCounter) > attack.maxIncrAngleCounter || int(state.incrCounter) < attack.minIncrAngleCounter) {
               state.incrDir = -int(state.incrDir);
            }
         }

         // Extend Shot kill-aura: make every projectile of a radiating multi-shot
         // weapon (Staff of Extreme Prejudice, etc.) land on the aim target while
         // staying DISTINCT (never stack them to one angle — the server won't credit
         // 10 identical-trajectory bullets, and they'd overlap into ~1 on screen).
         //  - Origin sits inside the enemy (remain<=0.4): keep the weapon's own
         //    radiating angles. Every bullet is born inside the target, so the
         //    server — which simulates from our PlayerShoot — registers each, and
         //    they visibly spray outward.
         //  - Origin short of the enemy (remain>0.4, far target clamped by the
         //    server's origin limit): fan the arc to just cover the hitbox at the
         //    remaining distance, so all bullets are separate yet all pass through.
         // Gate convergence to SINGLE-subattack weapons (EP and the radiating
         // staves). Multi-<Subattack> weapons (259 of them, 78 with per-subattack
         // DefaultAngle — Morningstar's 30 directional sweeps, Fractal Blades, ...)
         // fire fixed-direction fans; zeroing their defaultAngle would collapse the
         // pattern and the server (which validates each subattack's geometry) would
         // errorId=0-kick. Their far-case is left native.
         if(this.extendShotOrigin_ > 0 && numProj > 1 && subCount == 1 && this.extendShotRemain_ > 0.4) {
            // Fan just wide enough to cover the hitbox at the remaining range so
            // every bullet threads the enemy at a DISTINCT point/tick (a razor fan
            // piles onto one point/tick and the server credits ~1). killAuraSpread
            // is the tunable half-width (Options); never fan wider than the weapon's
            // own arc.
            var fanGap:Number = 2 * Math.atan2(Parameters.data.killAuraSpread,this.extendShotRemain_) / (numProj - 1);
            if(fanGap < arcGap) {
               arcGap = fanGap;
            }
            defaultAngle = 0;
            incrAngle = 0;
         }
         var startAngle:Number = baseAngle - (numProj - 1) * arcGap / 2.0 + defaultAngle + incrAngle;
         var lifeMult:Number = useMult ? this.projectileLifeMult : 1;
         var speedMult:Number = useMult ? this.projectileSpeedMult : 1;
         var attackType:int = isPrimary ? 0 : 1;
         var sentAttackIndex:int = attack.isDummy ? -1 : attackIndex;
         // Diagnostic: one line per trigger for MULTI-projectile weapons (e.g.
         // Staff of Extreme Prejudice, 10 proj) — burst size, metadata and the
         // next bulletId — to see the bulletId progression and whether it wraps
         // (%128) into still-alive bullets. Unconditional so the StoEP repro can't
         // be missed by a saved packetLog=off; n>3 keeps normal weapons quiet.
         if(numProj > 3) {
            DebugLog.event("shot",{"wt":weaponType,"n":numProj,"ai":sentAttackIndex,
                  "pi":sentPatternIndex,"nextBid":this.nextBulletId_});
         }

         // Spawn offset (PosOffset): forward by posOffsetY+0.3, sideways posOffsetX.
         // Extend Shot kill-aura pushes the origin forward toward the aim target so
         // the arc converges on the enemy; this also becomes the packet startingPos.
         var spawnDist:Number = pattern.posOffsetY + 0.3 + this.extendShotOrigin_;
         var cosA:Number = Math.cos(baseAngle);
         var sinA:Number = Math.sin(baseAngle);
         var spawnX:Number = x_ + spawnDist * cosA + -sinA * pattern.posOffsetX;
         var spawnY:Number = y_ + spawnDist * sinA + cosA * pattern.posOffsetX;

         if(weaponType == 580 && cultistFlag) {
            startAngle = startAngle + 3.14159265358979;
         }

         var angle:Number = startAngle;
         var i:int = 0;
         while(i < numProj) {
            var bulletId:uint = uint(getBulletId());
            // Preserved special-weapon per-bullet angle offsets.
            if(weaponType == 8608 && Parameters.data.ethDisable) {
               angle = angle + (bulletId % 2 != 0 ? 0.0436332312998582 : -0.0436332312998582);
            } else if(weaponType == 588 && Parameters.data.offsetVoidBow) {
               angle = angle + (bulletId % 2 != 0 ? 0.06 : -0.06);
            } else if(weaponType == 596 && Parameters.data.offsetColossus) {
               angle = angle + (bulletId % 2 != 0 ? Parameters.data.coloOffset : -Parameters.data.coloOffset);
            } else if(weaponType == 30053 && Parameters.data.offsetCelestialBlade) {
               angle = angle + (bulletId % 2 != 0 ? 0.12 : -0.12);
            }
            proj = FreeList.newObject(Projectile) as Projectile;
            if(isPrimary && this.projectileIdSetOverrideNew != "") {
               proj.reset(weaponType,projectileId,objectId_,bulletId,angle,time,this.projectileIdSetOverrideNew,this.projectileIdSetOverrideOld,lifeMult,speedMult);
            } else {
               proj.reset(weaponType,projectileId,objectId_,bulletId,angle,time,"","",lifeMult,speedMult);
            }
            // Kill-aura shots (origin advanced) reach via the moved origin and keep
            // a normal-looking pattern; manual shots (no advance) reach by extending
            // the projectile lifetime instead.
            if(this.extendShotOrigin_ <= 0) {
               proj.applyRangeExtension(Parameters.extendShotTiles());
            }
            // Weapon-damage enchant mults are client-authoritative (no server
            // stat); apply to the weapon's own primary shots only.
            var minDmg:int = isPrimary ?
                  int(proj.projProps.minDamage_ * EnchantmentManager.minDamageMult(this)) :
                  proj.projProps.minDamage_;
            var maxDmg:int = isPrimary ?
                  int(proj.projProps.maxDamage_ * EnchantmentManager.maxDamageMult(this)) :
                  proj.projProps.maxDamage_;
            var mult:Number = isPrimary ? Number(this.attackMultiplier()) : 1;
            var dmg:int = map_.gs_.gsc_.getNextDamage(minDmg,maxDmg) * mult;
            if(time > map_.gs_.moveRecords_.lastClearTime_ + 600) {
               dmg = 0;
            }
            proj.setDamage(dmg);
            // Attack metadata for the PLAYERSHOOT packet.
            proj.attackIndex_ = sentAttackIndex;
            proj.patternIndex_ = sentPatternIndex;
            // burstIndex advances per PROJECTILE, not per volley (reference
            // clientShoot.cpp DoShoot increments inside the projectile loop), so
            // a 3-burst 5-shot weapon sends 0..14 across the burst, not 0,1,2.
            proj.burstIndex_ = burstIndex;
            if(allowBurst) {
               burstIndex++;
               state.burstIdx = int(state.burstIdx) + 1;
               state.burstLeft = int(state.burstLeft) - 1;
            }
            proj.attackType_ = attackType;
            if(i == 0 && proj.sound_) {
               SoundEffectLibrary.play(proj.sound_,0.75,false);
            }
            map_.addObj(proj,spawnX,spawnY);
            map_.gs_.gsc_.playerShoot(time,proj);
            angle = angle + arcGap;
            i++;
         }

         // Advance the projectile pattern for the next trigger.
         if(hasPatterns) {
            state.patternIndex = (patternIdx + 1) % attack.projectilePatternCount;
         }
      }

      // Legacy single-attack path (weapons/items with no parsed <Subattack> data).
      private function doShootLegacy(time:int, weaponType:int, weaponXml:XML, angle:Number, isPrimary:Boolean, useMult:Boolean, cultistFlag:Boolean) : void {
         var bulletId:* = 0;
         var proj:Projectile = null;
         var i:int = 0;
         var numProj:int = ("NumProjectiles" in weaponXml?int(weaponXml.NumProjectiles):1);
         var arcGap:Number = ("ArcGap" in weaponXml?Number(weaponXml.ArcGap):11.25) * Trig.toRadians;
         var startAngle:Number = angle - arcGap * (numProj - 1) / 2.0;
         var lifeMult:Number = (useMult?this.projectileLifeMult:1);
         var speedMult:Number = (useMult?this.projectileSpeedMult:1);
         // Extend Shot kill-aura (same model as doShootAttack): keep projectiles
         // distinct but make them all land on the aim target. Origin inside the
         // enemy -> keep radiating (spray from within); origin short -> fan the arc
         // to just cover the hitbox at the remaining distance.
         if(this.extendShotOrigin_ > 0 && numProj > 1 && this.extendShotRemain_ > 0.4) {
            var _fanGap:Number = 2 * Math.atan2(Parameters.data.killAuraSpread,this.extendShotRemain_) / (numProj - 1);
            if(_fanGap < arcGap) {
               arcGap = _fanGap;
            }
            startAngle = angle - arcGap * (numProj - 1) / 2.0;
         }
         if(weaponType == 580 && cultistFlag) {
            startAngle = startAngle + 3.14159265358979;
         }
         i = 0;
         while(i < numProj) {
            bulletId = uint(getBulletId());
            proj = FreeList.newObject(Projectile) as Projectile;
            if(isPrimary && this.projectileIdSetOverrideNew != "") {
               proj.reset(weaponType,0,objectId_,bulletId,startAngle,time,this.projectileIdSetOverrideNew,this.projectileIdSetOverrideOld,lifeMult,speedMult);
            } else {
               proj.reset(weaponType,0,objectId_,bulletId,startAngle,time,"","",lifeMult,speedMult);
            }
            if(this.extendShotOrigin_ <= 0) {
               proj.applyRangeExtension(Parameters.extendShotTiles());
            }
            var _dmg:int = map_.gs_.gsc_.getNextDamage(
                  isPrimary ? int(proj.projProps.minDamage_ * EnchantmentManager.minDamageMult(this)) : proj.projProps.minDamage_,
                  isPrimary ? int(proj.projProps.maxDamage_ * EnchantmentManager.maxDamageMult(this)) : proj.projProps.maxDamage_)
                  * (isPrimary?Number(this.attackMultiplier()):1);
            if(time > map_.gs_.moveRecords_.lastClearTime_ + 600) {
               _dmg = 0;
            }
            proj.setDamage(_dmg);
            if(i == 0 && proj.sound_) {
               SoundEffectLibrary.play(proj.sound_,0.75,false);
            }
            map_.addObj(proj,x_ + Math.cos(angle) * (0.3 + this.extendShotOrigin_),y_ + Math.sin(angle) * (0.3 + this.extendShotOrigin_));
            map_.gs_.gsc_.playerShoot(time,proj);
            startAngle = startAngle + arcGap;
            i++;
         }
      }
   }
}
