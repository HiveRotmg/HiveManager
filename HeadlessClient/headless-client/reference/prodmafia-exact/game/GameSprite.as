package com.company.assembleegameclient.game {
   import com.company.assembleegameclient.game.events.ReconnectEvent;
   import com.company.assembleegameclient.map.Map;
   import com.company.assembleegameclient.map.Square;
   import com.company.assembleegameclient.objects.Character;
   import com.company.assembleegameclient.objects.Container;
   import com.company.assembleegameclient.objects.GameObject;
   import com.company.assembleegameclient.objects.IInteractiveObject;
   import com.company.assembleegameclient.objects.ObjectLibrary;
   import com.company.assembleegameclient.objects.ObjectProperties;
   import com.company.assembleegameclient.objects.ProjectileProperties;
   import com.company.assembleegameclient.objects.Pet;
   import com.company.assembleegameclient.objects.Player;
   import com.company.assembleegameclient.objects.Portal;
   import com.company.assembleegameclient.objects.Projectile;
   import com.company.assembleegameclient.parameters.Parameters;
   import com.company.assembleegameclient.ui.options.Options;
   import com.company.util.KeyCodes;
   import flash.events.KeyboardEvent;
   import com.company.assembleegameclient.ui.CharacterSwitcher;
   import com.company.assembleegameclient.ui.ConvertSeasonalButton;
   import com.company.assembleegameclient.ui.VaultButton;
   import com.company.assembleegameclient.ui.GuildText;
   import com.company.assembleegameclient.ui.RankText;
   import com.company.assembleegameclient.ui.StatusBar;
   import com.company.assembleegameclient.ui.menu.PlayerMenu;
   import com.company.assembleegameclient.util.AssetLoader;
   import com.company.assembleegameclient.util.TextureRedrawer;
   import com.company.assembleegameclient.util.TileRedrawer;
   import com.company.assembleegameclient.util.TimeUtil;
   import com.company.assembleegameclient.util.redrawers.GlowRedrawer;
   import com.company.util.CachingColorTransformer;
   import com.company.util.Hit;
   import com.company.util.PointUtil;

import flash.display.DisplayObject;
   import flash.display.Sprite;
   import flash.events.Event;
   import flash.events.MouseEvent;
   import flash.filters.DropShadowFilter;
   import flash.geom.Point;
   import flash.geom.Vector3D;
   import flash.system.System;
   import flash.utils.ByteArray;
   import flash.utils.Dictionary;
   import io.decagames.rotmg.seasonalEvent.SeasonalLeaderBoard.SeasonalLeaderBoardButton;
   import io.decagames.rotmg.seasonalEvent.buttons.SeasonalInfoButton;
   import io.decagames.rotmg.seasonalEvent.data.SeasonalEventModel;
   import kabam.rotmg.arena.view.ArenaTimer;
   import kabam.rotmg.arena.view.ArenaWaveCounter;
import kabam.lib.net.impl.CrashLogger;
import kabam.lib.net.impl.DebugLog;
import kabam.lib.net.impl.PerfMonitor;
import kabam.rotmg.chat.view.Chat;
   import kabam.rotmg.core.StaticInjectorContext;
   import kabam.rotmg.core.model.MapModel;
   import kabam.rotmg.core.model.PlayerModel;
   import kabam.rotmg.core.view.Layers;
   import kabam.rotmg.dailyLogin.signal.ShowDailyCalendarPopupSignal;
   import kabam.rotmg.dailyLogin.view.DailyLoginModal;
   import kabam.rotmg.dialogs.control.AddPopupToStartupQueueSignal;
   import kabam.rotmg.dialogs.control.FlushPopupStartupQueueSignal;
   import kabam.rotmg.dialogs.control.OpenDialogSignal;
   import kabam.rotmg.dialogs.model.DialogsModel;
   import kabam.rotmg.game.model.QuestModel;
import kabam.rotmg.game.view.CreditDisplay;
   import kabam.rotmg.game.view.GiftStatusDisplay;
   import kabam.rotmg.game.view.NewsModalButton;
   import kabam.rotmg.game.view.RealmQuestsDisplay;
   import kabam.rotmg.game.view.ShopDisplay;
   import flash.filesystem.File;
   import flash.utils.getTimer;
   import kabam.rotmg.messaging.impl.GameServerConnectionConcrete;
import kabam.rotmg.messaging.impl.incoming.MapInfo;
   import kabam.rotmg.news.model.NewsModel;
   import kabam.rotmg.news.view.NewsTicker;
   import kabam.rotmg.packages.services.PackageModel;
   import kabam.rotmg.promotions.model.BeginnersPackageModel;
   import kabam.rotmg.promotions.signals.ShowBeginnersPackageSignal;
   import kabam.rotmg.promotions.view.BeginnersPackageButton;
   import kabam.rotmg.promotions.view.SpecialOfferButton;
   import kabam.rotmg.servers.api.Server;
   import kabam.rotmg.servers.api.ServerModel;
   import kabam.rotmg.stage3D.Renderer;
   import kabam.rotmg.stage3D.graphic3D.TextureFactory;
   import kabam.rotmg.text.view.TextFieldDisplayConcrete;
   import kabam.rotmg.text.view.stringBuilder.StaticStringBuilder;
   import kabam.rotmg.ui.signals.ShowHideKeyUISignal;
   import kabam.rotmg.ui.view.HUDView;
   import org.osflash.signals.Signal;
   
   public class GameSprite extends AGameSprite {
      
      public static const NON_COMBAT_MAPS:Vector.<String> = new <String>["Nexus","Vault","Guild Hall","Cloth Bazaar","Nexus Explanation","Daily Quest Room"];
      
      public static const DISPLAY_AREA_Y_SPACE:int = 32;
      
      protected const EMPTY_FILTER:DropShadowFilter = new DropShadowFilter(0,0,0);
      
      public const monitor:Signal = new Signal(String,int);
      
      public const modelInitialized:Signal = new Signal();
      
      public const drawCharacterWindow:Signal = new Signal(Player);
      
      public const nexusFountains:Point = new Point(129.5,116.5);
      
      public const nexusRealms:Point = new Point(nexusFountains.x,nexusFountains.y - 18);
      
      public const nexusHallway:Point = new Point(nexusFountains.x,nexusFountains.y - 10);
      
      public const vaultFountain:Point = new Point(56,67.1);
      
      public var chatBox_:Chat;
      
      public var isNexus_:Boolean = false;
      
      public var idleWatcher_:IdleWatcher;
      
      public var rankText_:RankText;
      
      public var guildText_:GuildText;
      
      public var shopDisplay:ShopDisplay;
      
      public var challengerLeaderBoard:SeasonalLeaderBoardButton;
      
      public var challengerInfoButton:SeasonalInfoButton;
      
      public var creditDisplay_:CreditDisplay;

      public var charSwitcher_:CharacterSwitcher;

      public var vaultButton_:VaultButton;

      public var convertButton_:ConvertSeasonalButton;
      
      public var realmQuestsDisplay:RealmQuestsDisplay;
      
      public var giftStatusDisplay:GiftStatusDisplay;
      
      public var newsModalButton:NewsModalButton;
      
      public var newsTicker:NewsTicker;
      
      public var arenaTimer:ArenaTimer;
      
      public var arenaWaveCounter:ArenaWaveCounter;
      
      public var mapModel:MapModel;
      
      public var beginnersPackageModel:BeginnersPackageModel;
      
      public var dialogsModel:DialogsModel;
      
      public var showBeginnersPackage:ShowBeginnersPackageSignal;
      
      public var openDailyCalendarPopupSignal:ShowDailyCalendarPopupSignal;
      
      public var openDialog:OpenDialogSignal;
      
      public var showPackage:Signal;
      
      public var packageModel:PackageModel;
      
      public var addToQueueSignal:AddPopupToStartupQueueSignal;
      
      public var flushQueueSignal:FlushPopupStartupQueueSignal;
      
      public var showHideKeyUISignal:ShowHideKeyUISignal;
      
      public var chatPlayerMenu:PlayerMenu;
      
      public var packageOffer:BeginnersPackageButton;
      
      public var questBar:StatusBar;
      
      public var stats:TextFieldDisplayConcrete;
      
      public var statsStringBuilder:StaticStringBuilder;
      
      private var focus:GameObject;

      private var isGameStarted:Boolean;
      
      private var displaysPosY:uint = 4;
      
      private var currentPackage:DisplayObject;

      private var specialOfferButton:SpecialOfferButton;
      
      private var timerCounter:TextFieldDisplayConcrete;
      
      private var timerCounterStringBuilder:StaticStringBuilder;
      
      private var enemyCounter:TextFieldDisplayConcrete;
      
      private var enemyCounterStringBuilder:StaticStringBuilder;
      
      private var lastUpdateInteractiveTime:int = 0;

      // The HUD/minimap redraw (drawCharacterWindow -> UpdateHUDSignal) rebuilds
      // ~1,100 minimap vector fills plus every inventory/stat mediator. Running
      // it at the full 110-144Hz render rate is pure waste — data displays don't
      // need to update faster than ~30Hz. Throttled to HUD_INTERVAL_MS.
      private var lastHudDrawTime_:int = 0;
      private static const HUD_INTERVAL_MS:int = 33;   // ~30 Hz

      private var questModel:QuestModel;
      
      private var seasonalEventModel:SeasonalEventModel;
      
      private var mapName:String;
      
      public function GameSprite(server:Server, gameId:int, createCharacter:Boolean, charId:int, keyTime:int, key:ByteArray, playerModel:PlayerModel, mapJSON:String, isFromArena:Boolean) {
         showPackage = new Signal();
         currentPackage = new Sprite();
         super();
         // Map/ground/particle assets are parsed lazily on first game entry (they
         // are deferred out of startup so the menu loads faster). Must run before
         // Map is built below, since it draws ground tiles. No-op after the first.
         AssetLoader.loadMapAssets();
         this.model = playerModel;
         map = new Map(this);
         addChild(map);
         gsc_ = new GameServerConnectionConcrete(this,server,gameId,createCharacter,charId,keyTime,key,mapJSON,isFromArena);
         mui_ = new MapUserInput(this);
         this.chatBox_ = new Chat();
         this.chatBox_.list.addEventListener("mouseDown",this.onChatDown,false,0,true);
         this.chatBox_.list.addEventListener("mouseUp",this.onChatUp,false,0,true);
         addChild(this.chatBox_);
         this.hitQueue.length = 0;
         addEventListener(Event.ADDED_TO_STAGE,this.onAddedToStage,false,0,true);
      }
      
      public static function toTimeCode(milliseconds:Number) : String {
         var seconds:int = Math.floor(milliseconds * 0.001 % 60);
         var secondsText:String = seconds < 10?"0" + seconds:String(seconds);
         var minutes:int = Math.round(Math.floor(milliseconds * 0.001 * 0.0166666666666667));
         var minutesText:String = String(minutes);
         var timeCode:String = minutesText + ":" + secondsText;
         return timeCode;
      }

      override public function setFocus(focusObject:GameObject) : void {
         focusObject = focusObject || map.player_;
         this.focus = focusObject;
      }

      override public function applyMapInfo(mapInfo:MapInfo) : void {
         map.setProps(mapInfo.width_,mapInfo.height_,mapInfo.name_,mapInfo.background_,mapInfo.allowPlayerTeleport_,mapInfo.showDisplays_,mapInfo.maxPlayers_);
         Parameters.savingMap_ = false;
         // Portal object ids and displayed population counts are Nexus-local.
         // Promote the normalized pending name only after MAPINFO proves that
         // this was the realm actually joined, then keep the first realm sticky
         // for later Nexus returns.
         if(mapInfo.name_ == "Realm of the Mad God" && apPendingRealmName_ != null) {
            if(apOriginalRealmName_ == null) {
               apOriginalRealmName_ = apPendingRealmName_;
               DebugLog.event("autoplay_state",{"state":"realm_origin_committed",
                     "realm":apOriginalRealmName_});
               CrashLogger.note("AUTOPILOT: committed original realm '" +
                     apOriginalRealmName_ + "'");
            }
            apPendingRealmName_ = null;
         }
         // A new map means whatever realm-full/queue wait we were in resolved
         // (we got in somewhere) — clear the shared state so the next portal use
         // isn't gated by a stale full/queue marker from the previous hub.
         GameServerConnectionConcrete.inRealmQueue_ = false;
         GameServerConnectionConcrete.realmQueuePosition_ = -1;
         GameServerConnectionConcrete.realmFullPortalId_ = 0;
         GameServerConnectionConcrete.realmFullUntil_ = 0;
      }
      
      override public function initialize() : void {
         this.questModel = StaticInjectorContext.getInjector().getInstance(QuestModel);
         this.seasonalEventModel = StaticInjectorContext.getInjector().getInstance(SeasonalEventModel);
         this.map.initialize();
         this.modelInitialized.dispatch();
         var currentMapName:String = this.map.name_;
         this.mapName = currentMapName;
         this.showHideKeyUISignal.dispatch(currentMapName == "Davy Jones\' Locker");
         this.isNexus_ = currentMapName == "Nexus";
         this.map.isTrench = this.map.name_ == "Ocean Trench";
         this.map.isRealm = currentMapName == "Realm of the Mad God";
         this.map.isVault = currentMapName == "Vault";
         var safeMapNames:Vector.<String> = new <String>["Nexus","Vault","Guild Hall","Guild Hall 2","Guild Hall 3","Guild Hall 4","Guild Hall 5","Cloth Bazaar","Nexus Explanation","Daily Quest Room","Daily Login Room","Pet Yard","Pet Yard 2","Pet Yard 3","Pet Yard 4","Pet Yard 5"];
         this.isSafeMap = safeMapNames.indexOf(currentMapName) != -1;
         if(this.isSafeMap) {
            this.showSafeAreaDisplays();
         } else {
            this.addQuestBar();
         }
         if(currentMapName == "Arena") {
            this.showTimer();
            this.showWaveCounter();
         }
         this.creditDisplay_ = new CreditDisplay(this,true);
         this.creditDisplay_.x = 594;
         this.creditDisplay_.y = 0;
         if(!this.isSafeMap) {
            this.creditDisplay_.mouseEnabled = false;
            this.creditDisplay_.mouseChildren = false;
         }
         addChild(this.creditDisplay_);
         // In-game character switcher (Exalt-style): a small icon button just
         // below the Shop button (Shop is at 6,40, ~30px tall). Click it for the
         // character dropdown, click a row to reconnect as that character.
         this.charSwitcher_ = new CharacterSwitcher(this.gsc_.charId_);
         this.charSwitcher_.x = 6;
         this.charSwitcher_.y = 74;
         addChild(this.charSwitcher_);
         // Vault chest button, directly below the character switcher (34px tall
         // + 4px gap). Opens the read-only Vault popup from the cached contents.
         this.vaultButton_ = new VaultButton(this);
         this.vaultButton_.x = 6;
         this.vaultButton_.y = 112;
         addChild(this.vaultButton_);
         this.convertButton_ = new ConvertSeasonalButton(this);
         this.convertButton_.x = 6;
         this.convertButton_.y = 150;
         addChild(this.convertButton_);
         if(!isSafeMap && this.canShowRealmQuestDisplay(this.mapName)) {
            this.realmQuestsDisplay = new RealmQuestsDisplay(map);
            this.realmQuestsDisplay.x = 10;
            this.realmQuestsDisplay.y = 10;
            addChild(this.realmQuestsDisplay);
            gsc_.playerText("/server");
         } else {
            this.questModel.previousRealm = "";
         }
         if(currentMapName == "Daily Quest Room") {
            this.gsc_.questFetch();
         } else if(currentMapName == "Cloth Bazaar") {
            Parameters.timerActive = true;
            Parameters.phaseName = "Portal Entry";
            Parameters.phaseChangeAt = TimeUtil.getTrueTime() + 30000;
         }
         map.setHitAreaProps(map.width,map.height);
         Parameters.save();
         this.parent.parent.setChildIndex((this.parent.parent as Layers).top,2);
         stage.dispatchEvent(new Event("resize"));
         if(Parameters.data.perfStats) {
            if(Parameters.data.liteMonitor) {
               addStats();
               statsStart = TimeUtil.getTrueTime();
               stage.dispatchEvent(new Event("resize"));
            } else {
               this.addChild(MapUserInput.stats_);
               this.gsc_.enableJitterWatcher();
               this.gsc_.jitterWatcher_.y = MapUserInput.stats_.height;
               this.addChild(this.gsc_.jitterWatcher_);
            }
         }
      }
      
      override public function fixFullScreen() : void {
         stage.scaleMode = "noScale";
      }
      
      override public function evalIsNotInCombatMapArea() : Boolean {
         return NON_COMBAT_MAPS.indexOf(map.name_) != -1;
      }
      
      override public function showDailyLoginCalendar() : void {
         this.openDialog.dispatch(new DailyLoginModal());
      }
      
      public function addChatPlayerMenu(player:Player, stageX:Number, stageY:Number, playerName:String = null, fromGuild:Boolean = false, differentServer:Boolean = false) : void {
         this.removeChatPlayerMenu();
         this.chatPlayerMenu = new PlayerMenu();
         if(playerName == null) {
            this.chatPlayerMenu.init(this,player);
         } else if(differentServer) {
            this.chatPlayerMenu.initDifferentServer(this,playerName,fromGuild,differentServer);
         } else {
            if(playerName.length > 0 && (playerName.charAt(0) == "#" || playerName.charAt(0) == "*" || playerName.charAt(0) == "@")) {
               return;
            }
            this.chatPlayerMenu.initDifferentServer(this,playerName,fromGuild);
         }
         addChild(this.chatPlayerMenu);
         chatMenuPositionFixed();
      }
      
      public function removeChatPlayerMenu() : void {
         if(this.chatPlayerMenu && this.chatPlayerMenu.parent) {
            removeChild(this.chatPlayerMenu);
            this.chatPlayerMenu = null;
         }
      }
      
      public function hudModelInitialized() : void {
         if(hudView) {
            hudView.dispose();
         }
         hudView = new HUDView();
         hudView.x = 600;
         addChild(hudView);
         if(!Parameters.data.mapHack) {
            return;
         }
         if(Parameters.needsMapCheck == 2) {
            this.hudView.miniMap.setFullMap(this.map.name_);
         }
      }
      
      public function addStats() : void {
         if(this.stats == null) {
            this.stats = new TextFieldDisplayConcrete().setSize(14).setColor(16777215);
            this.stats.mouseChildren = false;
            this.stats.mouseEnabled = false;
            this.statsStringBuilder = new StaticStringBuilder("FPS -1\nLAT -1\nMEM -1");
            this.stats.setStringBuilder(this.statsStringBuilder);
            this.stats.filters = [EMPTY_FILTER];
            this.stats.setBold(true);
            this.stats.x = 5;
            this.stats.y = 5;
            addChild(this.stats);
            stage.dispatchEvent(new Event("resize"));
         }
      }

      public function updateStats(currentTime:int) : void {
         statsFrameNumber = Number(statsFrameNumber) + 1;
         var elapsed:int = currentTime - statsStart;
         if(elapsed >= 1000) {
            statsFPS = Math.floor(statsFrameNumber / (0.001 * elapsed) * 10) * 0.1;
            statsStart = currentTime;
            statsFrameNumber = 0;
            this.stats.setText("FPS " + statsFPS + "\nDRW " + Renderer.lastDrawCalls +
                    "\nRES " + Renderer.lastBackBufferW + "x" + Renderer.lastBackBufferH +
                    "\nMEM " + Math.round(1.0e-6 * System.totalMemoryNumber));
         }
      }
      
      public function updateEnemyCounter(counterText:String) : void {
         if(!this.enemyCounter) {
            this.addEnemyCounter();
         }
         this.enemyCounter.visible = true;
         this.enemyCounter.setText(counterText);
      }

      public function chatMenuPositionFixed() : void {
         var menuX:Number = (stage.mouseX + (stage.stageWidth >> 1) - 400) / stage.stageWidth * 800;
         var menuY:Number = (stage.mouseY + (stage.stageHeight >> 1) - 300) / stage.stageHeight * 600;
         this.chatPlayerMenu.x = menuX;
         this.chatPlayerMenu.y = menuY - this.chatPlayerMenu.height;
      }

      public function positionDynamicDisplays() : void {
         var newsModel:NewsModel = StaticInjectorContext.getInjector().getInstance(NewsModel);
         var posY:int = 72;
         if(this.giftStatusDisplay && this.giftStatusDisplay.isOpen) {
            this.giftStatusDisplay.y = posY;
            posY = posY + 32;
         }
         if(this.newsModalButton && (NewsModalButton.showsHasUpdate || newsModel.hasValidModalNews())) {
            this.newsModalButton.y = posY;
            posY = posY + 32;
         }
         if(this.specialOfferButton && this.specialOfferButton.isSpecialOfferAvailable) {
            this.specialOfferButton.y = posY;
         }
         if(this.newsTicker && this.newsTicker.visible) {
            this.newsTicker.y = posY;
            posY = posY + 32;
         }
         this.onScreenResize(null);
      }
      
      public function refreshNewsUpdateButton() : void {
         this.showNewsUpdate(false);
      }
      
      public function showSpecialOfferIfSafe(available:Boolean) : void {
         if(this.evalIsNotInCombatMapArea()) {
            this.specialOfferButton = new SpecialOfferButton(available);
            this.specialOfferButton.x = 6;
            addChild(this.specialOfferButton);
            this.positionDynamicDisplays();
         }
      }
      
      public function connect() : void {
         if(!this.isGameStarted) {
            this.isGameStarted = true;
            Renderer.inGame = true;
            this.newsModalButton = null;
            this.questBar = null;
            gsc_.connect();
            lastUpdate_ = TimeUtil.getModdedTime();
            statsStart = -1;
            statsFrameNumber = -1;
            stage.addEventListener("MONEY_CHANGED",this.onMoneyChanged,false,0,true);
            stage.addEventListener("enterFrame",this.onEnterFrame,false,0,true);
            stage.addEventListener("activate",this.onFocusIn,false,0,true);
            stage.addEventListener("deactivate",this.onFocusOut,false,0,true);
            stage.addEventListener("keyDown",this.onPreWorldKeyDown,false,0,true);
            this.parent.parent.setChildIndex((this.parent.parent as Layers).top,0);
            stage.scaleMode = "noScale";
            stage.addEventListener("resize",this.onScreenResize,false,0,true);
            stage.dispatchEvent(new Event("resize"));
         }
      }
      
      /** Keyboard escape hatch while NOT yet in the world (connecting, server
       * queue, stuck load). In-world input belongs to MapUserInput; this only
       * acts while map.player_ is still null, where previously no key worked
       * at all and a queued client was stuck until admission. ESC abandons the
       * connection and returns to the previous screen; the Options key opens
       * the options overlay. */
      private function onPreWorldKeyDown(event:KeyboardEvent) : void {
         if(this.map != null && this.map.player_ != null) {
            return;
         }
         if(event.keyCode == KeyCodes.ESCAPE) {
            var concrete:GameServerConnectionConcrete =
                  gsc_ as GameServerConnectionConcrete;
            if(concrete != null) {
               concrete.abortConnectionAndClose();
            } else {
               this.closed.dispatch();
            }
         } else if(event.keyCode == Parameters.data.options) {
            addChild(new Options(this));
         }
      }

      public function disconnect() : void {
         if(this.isGameStarted) {
            this.isGameStarted = false;
            Parameters.data.noClip = false;
            Parameters.data.fakeLag = 0;
            Renderer.inGame = false;
            stage.removeEventListener("MONEY_CHANGED",this.onMoneyChanged);
            stage.removeEventListener("keyDown",this.onPreWorldKeyDown);
            stage.removeEventListener("enterFrame",this.onEnterFrame);
            stage.removeEventListener("activate",this.onFocusIn);
            stage.removeEventListener("deactivate",this.onFocusOut);
            stage.removeEventListener("resize",this.onScreenResize);
            stage.scaleMode = "exactFit";
            stage.dispatchEvent(new Event("resize"));
            contains(map) && removeChild(map);
            if(hudView) {
               hudView.dispose();
            }
            map.dispose();
            CachingColorTransformer.clear();
            TextureRedrawer.clearCache();
            TileRedrawer.clearCache();
            GlowRedrawer.clearCache();
            Projectile.dispose();
            this.newsModalButton = null;
            this.questBar = null;
            if(this.timerCounter && !(Parameters.phaseName == "Realm Closed" || Parameters.phaseName == "Oryx Shake")) {
               Parameters.timerActive = false;
               this.timerCounter.visible = false;
               this.timerCounter = null;
            }
            if(this.enemyCounter) {
               this.enemyCounter.visible = false;
               this.enemyCounterStringBuilder = null;
               this.enemyCounter = null;
            }
            Parameters.followPlayer = null;
            Parameters.player = null;
            gsc_.disconnect();
            System.pauseForGCIfCollectionImminent(0);
         }
      }
      
      // ---- GC scheduling (the Woodland Labyrinth death, 2026-07-27) ---------
      // AIR's collector defers under allocation pressure: the 03-38 session log
      // shows GC/win 0 for 20+ seconds while the heap climbed to 4.6GB, then ONE
      // 4678ms stop-the-world pass that freed ~3GB -- during which the character
      // stood frozen next to an enemy and died at what the client believed was
      // 637 HP (54 stalls >1s in that session). Post-GC live is only ~1.4-2.2GB,
      // so this is not a leak; the collector just lets garbage pile gigabytes
      // deep and then pays for all of it at once, wherever the frame happens to
      // be. The pump below spends that debt in small pauses at moments WE pick
      // -- safe maps or combat lulls -- so the monster collection mid-fight
      // never accumulates.

      /** ms between safe-window collection opportunities. */
      private static const GC_PUMP_INTERVAL_MS:int = 10000;
      /** Heap (totalMemory) above which a lull collection is forced even
       *  without a fully-safe window; below it only truly safe moments pay. */
      private static const GC_HEAP_URGENT_MB:Number = 3072;
      /** No enemy within this many tiles counts as a combat lull. */
      private static const GC_SAFE_ENEMY_DIST:Number = 12;

      private var lastGcPumpMs_:int = 0;
      private var lastStallLogMs_:int = 0;

      /** Log any raw frame gap >500ms with combat context, so the next
       *  stall-adjacent death attributes itself instead of needing forensics. */
      private function monitorFrameStall(rawDeltaMs:int, player:Player) : void {
         if(rawDeltaMs <= 500) {
            return;
         }
         var now:int = getTimer();
         if(now - this.lastStallLogMs_ < 1000) {
            return;
         }
         this.lastStallLogMs_ = now;
         var heapMb:Number = System.totalMemory / 1048576;
         DebugLog.event("frame_stall",{
               "ms":rawDeltaMs,
               "map":this.map != null ? this.map.name_ : null,
               "safe":this.isSafeMap,
               "heapMb":Math.round(heapMb),
               "freeMb":Math.round(System.freeMemory / 1048576),
               "hostileProj":this.map != null && this.map.hostileProjectiles_ != null ?
                     this.map.hostileProjectiles_.length : -1,
               "nearestEnemy":player != null ? Math.round(this.nearestEnemyDist(player) * 10) / 10 : -1,
               "hp":player != null ? player.hp_ : -1,
               "chp":player != null ? player.clientHp : -1});
      }

      /**
       * Give the collector a safe moment to run. pauseForGCIfCollectionImminent
       * collects ONLY when the allocation budget says a collection is already
       * looming, so calling it in a lull is nearly free when the heap is
       * healthy and converts the eventual multi-second pause into a smaller one
       * at a chosen moment when it is not.
       */
      private function gcPump(trueTime:int, player:Player) : void {
         if(trueTime - this.lastGcPumpMs_ < GC_PUMP_INTERVAL_MS) {
            return;
         }
         var heapMb:Number = System.totalMemory / 1048576;
         var urgent:Boolean = heapMb >= GC_HEAP_URGENT_MB;
         var lull:Boolean = false;
         if(this.isSafeMap) {
            lull = true;
         } else if(this.map != null && player != null &&
               (this.map.hostileProjectiles_ == null || this.map.hostileProjectiles_.length == 0)) {
            // No bullets in the air; require enemy standoff too unless urgent.
            lull = urgent || this.nearestEnemyDist(player) > GC_SAFE_ENEMY_DIST;
         }
         if(!lull) {
            return;
         }
         this.lastGcPumpMs_ = trueTime;
         var before:Number = System.totalMemory;
         var start:int = getTimer();
         // Urgent heap: demand the collection now (imminence 0). Healthy heap:
         // only collect if one is close anyway (0.25).
         System.pauseForGCIfCollectionImminent(urgent ? 0 : 0.25);
         var pauseMs:int = getTimer() - start;
         var freedMb:Number = (before - System.totalMemory) / 1048576;
         if(pauseMs > 5 || freedMb > 16) {
            DebugLog.event("gc_pump",{
                  "pauseMs":pauseMs,"freedMb":Math.round(freedMb),
                  "heapMbBefore":Math.round(before / 1048576),
                  "urgent":urgent,"safeMap":this.isSafeMap,
                  "map":this.map != null ? this.map.name_ : null});
         }
      }

      private function nearestEnemyDist(player:Player) : Number {
         var best:Number = Number.MAX_VALUE;
         for each(var candidate:GameObject in this.map.goDict_) {
            if(candidate == null || candidate.props_ == null || !candidate.props_.isEnemy_ || candidate.dead_) {
               continue;
            }
            var dx:Number = candidate.x_ - player.x_;
            var dy:Number = candidate.y_ - player.y_;
            var d2:Number = dx * dx + dy * dy;
            if(d2 < best) {
               best = d2;
            }
         }
         return best == Number.MAX_VALUE ? Number.MAX_VALUE : Math.sqrt(best);
      }

      private function addQuestBar() : void {
         this.questBar = new StatusBar(600,15,4294967295,4284226845,"Quest!",true);
         this.questBar.x = 0;
         this.questBar.y = 0;
         this.questBar.visible = false;
         addChild(this.questBar);
      }
      
      private var _qbLastId:int = -1;
      private var _qbLastHp:int = -1;
      private var _qbLastDmg:Number = -1;

      private function updateQuestBar() : void {
         var quest:GameObject = this.map.quest_.getObject(0);
         if(quest == null) {
            this.questBar.visible = false;
            this._qbLastId = -1;
            return;
         }
         this.questBar.visible = true;
         if(this.questBar.quest == null || quest.objectId_ != this.questBar.quest.objectId_) {
            this.questBar.quest = quest;
         }
         // Runs every frame while a quest target exists. setLabelText rebuilds
         // bitmap text and draw() re-renders the bar — skip both when nothing that
         // affects the bar changed (target, its HP, or accrued damage %).
         var _dmg:Number = Parameters.dmgCounter[quest.objectId_];
         if(quest.objectId_ == this._qbLastId && quest.hp_ == this._qbLastHp && _dmg == this._qbLastDmg) {
            return;
         }
         this._qbLastId = quest.objectId_;
         this._qbLastHp = quest.hp_;
         this._qbLastDmg = _dmg;
         var damageLabel:String = _dmg > 0?"(" + (_dmg / quest.maxHP_ * 100).toFixed(2) + "%) ":"";
         this.questBar.setLabelText(damageLabel + ObjectLibrary.typeToDisplayId_[quest.objectType_]);
         this.questBar.color_ = Character.green2red(this.questBar.quest.hp_ * 100 / this.questBar.quest.maxHP_);
         this.questBar.draw(quest.hp_,quest.maxHP_,0);
      }
      
      private function addTimer() : void {
         if(this.timerCounter == null) {
            this.timerCounter = new TextFieldDisplayConcrete().setSize(Parameters.data.uiTextSize).setColor(16777215);
            this.timerCounter.mouseChildren = false;
            this.timerCounter.mouseEnabled = false;
            this.timerCounter.setBold(true);
            this.timerCounterStringBuilder = new StaticStringBuilder("0:00");
            this.timerCounter.setStringBuilder(this.timerCounterStringBuilder);
            this.timerCounter.filters = [EMPTY_FILTER];
            this.timerCounter.x = 3;
            this.timerCounter.y = 180;
            addChild(this.timerCounter);
            stage.dispatchEvent(new Event("resize"));
         }
      }
      
      private function addEnemyCounter() : void {
         if(this.enemyCounter == null) {
            this.enemyCounter = new TextFieldDisplayConcrete().setSize(Parameters.data.uiTextSize).setColor(16777215);
            this.enemyCounter.mouseChildren = false;
            this.enemyCounter.mouseEnabled = false;
            this.enemyCounter.setBold(true);
            this.enemyCounterStringBuilder = new StaticStringBuilder("0");
            this.enemyCounter.setStringBuilder(this.enemyCounterStringBuilder);
            this.enemyCounter.filters = [EMPTY_FILTER];
            this.enemyCounter.x = 3;
            this.enemyCounter.y = 160;
            addChild(this.enemyCounter);
            stage.dispatchEvent(new Event("resize"));
         }
      }
      
      private function updateTimer(currentTime:int) : void {
         this.timerCounter.setText(Parameters.phaseName + "\n" + toTimeCode(Parameters.phaseChangeAt - currentTime));
         if(!this.timerCounter.visible) {
            this.timerCounter.visible = true;
            stage.dispatchEvent(new Event("resize"));
         }
      }

      private function canShowRealmQuestDisplay(mapName:String) : Boolean {
         var canShow:Boolean = false;
         if(mapName == "Realm of the Mad God") {
            this.questModel.previousRealm = mapName;
            this.questModel.requirementsStates[1] = false;
            this.questModel.remainingHeroes = -1;
            if(this.questModel.hasOryxBeenKilled) {
               this.questModel.hasOryxBeenKilled = false;
               this.questModel.resetRequirementsStates();
            }
            canShow = true;
         } else if(this.questModel.previousRealm == "Realm of the Mad God" && mapName.indexOf("Oryx") != -1) {
            this.questModel.requirementsStates[1] = true;
            this.questModel.remainingHeroes = 0;
            canShow = true;
         }
         return canShow;
      }
      
      private function showSafeAreaDisplays() : void {
         this.showRankText();
         this.showGuildText();
         this.showShopDisplay();
         this.setYAndPositionPackage();
         this.showGiftStatusDisplay();
         this.showNewsUpdate();
         this.showNewsTicker();
      }
      
      private function setDisplayPosY(row:Number) : void {
         var rowOffset:Number = 28 * row;
         if(row != 0) {
            this.displaysPosY = 4 + rowOffset;
         } else {
            this.displaysPosY = 2;
         }
      }
      
      private function showTimer() : void {
         this.arenaTimer = new ArenaTimer();
         this.arenaTimer.y = 5;
         addChild(this.arenaTimer);
      }
      
      private function showWaveCounter() : void {
         this.arenaWaveCounter = new ArenaWaveCounter();
         this.arenaWaveCounter.y = 5;
         this.arenaWaveCounter.x = 5;
         addChild(this.arenaWaveCounter);
      }
      
      private function showNewsTicker() : void {
         this.newsTicker = new NewsTicker();
         this.newsTicker.x = 300 - this.newsTicker.width / 2;
         addChild(this.newsTicker);
         this.positionDynamicDisplays();
      }
      
      private function showGiftStatusDisplay() : void {
         this.giftStatusDisplay = new GiftStatusDisplay();
         this.giftStatusDisplay.x = 6;
         addChild(this.giftStatusDisplay);
         this.positionDynamicDisplays();
      }
      
      private function showShopDisplay() : void {
         this.shopDisplay = new ShopDisplay(map.name_ == "Nexus");
         this.shopDisplay.x = 6;
         this.shopDisplay.y = 40;
         addChild(this.shopDisplay);
      }
      
      private function showNewsUpdate(refresh:Boolean = true) : void {
         var newButton:* = null;
         var newsModel:NewsModel = StaticInjectorContext.getInjector().getInstance(NewsModel);
         if(newsModel.hasValidModalNews()) {
            newButton = new NewsModalButton();
            if(this.newsModalButton) {
               return;
            }
            this.newsModalButton = newButton;
            addChild(this.newsModalButton);
            stage.dispatchEvent(new Event("resize"));
         }
      }

      private function setYAndPositionPackage() : void {
         this.displaysPosY = this.displaysPosY + 28;
         this.positionPackage();
      }

      private function positionPackage() : void {
         this.currentPackage.x = 80;
         this.setDisplayPosY(1);
         this.currentPackage.y = this.displaysPosY;
      }
      
      private function showGuildText() : void {
         this.guildText_ = new GuildText("",-1);
         this.guildText_.x = 76;
         this.setDisplayPosY(0);
         this.guildText_.y = this.displaysPosY;
         addChild(this.guildText_);
      }
      
      private function showRankText() : void {
         this.rankText_ = new RankText(-1,true,false);
         this.rankText_.x = 8;
         this.rankText_.y = 8;
         this.setDisplayPosY(0);
         addChild(this.rankText_);
      }
      
      private function updateNearestInteractive() : void {
         var candidateX:Number = NaN;
         var candidateY:Number = NaN;
         var distanceSquared:Number = NaN;
         var nearest:* = null;
         var obj:* = null;
         var candidate:* = null;
         if(!map || !map.player_) {
            return;
         }
         var liveMap:Map = map as Map;
         if(liveMap == null) {
            return;
         }
         var player:Player = map.player_;
         var bestDistanceSquared:* = 1;
         var playerX:Number = player.x_;
         var playerY:Number = player.y_;
         for each(obj in liveMap.interactiveObjects_) {
            candidate = obj;
            if(candidate is IInteractiveObject && (!(candidate is Pet) || this.map.isPetYard)) {
               candidateX = obj.x_;
               candidateY = obj.y_;
               if(Math.abs(playerX - candidateX) < 1 || Math.abs(playerY - candidateY) < 1) {
                  distanceSquared = PointUtil.distanceSquaredXY(candidateX,candidateY,playerX,playerY);
                  if(distanceSquared < 1 && distanceSquared < bestDistanceSquared) {
                     bestDistanceSquared = distanceSquared;
                     nearest = candidate;
                  }
               }
            }
         }
         this.mapModel.currentInteractiveTarget = nearest as IInteractiveObject;
         if(nearest == null) {
            this.mapModel.currentInteractiveTargetObjectId = -1;
         } else {
            this.mapModel.currentInteractiveTargetObjectId = nearest.objectId_;
         }
         // Mirror onto the player so movement code (proactive spacing) can
         // cheaply know an interaction is in progress without the injector.
         player.nearInteractiveObject_ = nearest != null;
      }
      
      public function onChatDown(event:MouseEvent) : void {
         if(this.chatPlayerMenu != null) {
            this.removeChatPlayerMenu();
         }
         mui_.onMouseDown(event);
      }

      public function onChatUp(event:MouseEvent) : void {
         mui_.onMouseUp(event);
      }

      public function onScreenResize(event:Event) : void {
         var uiScale:Boolean = Parameters.data.uiscale;
         var _gsc:Number = Main.gameScale();
         // The world fills the whole window; the HUD lives in the letterbox-scaled
         // 800x600 Main tree (uniform gameScale + centering). Scale every HUD
         // element UNIFORMLY (X == Y). The old code used 800/stageWidth for X and
         // 600/stageHeight for Y — different per axis on any non-4:3 window — which,
         // on top of Main's uniform gameScale, squashed the sidebar horizontally
         // and shrank/distorted the character switcher. Now:
         //   uiScale=true  -> scaleX=scaleY=1        (net on-screen = gameScale)
         //   uiScale=false -> scaleX=scaleY=1/gsc    (net on-screen = 1, native px)
         // On a 4:3 window these reduce to the previous values, so nothing changes
         // there; the map overlay scale (below) is likewise uniform = mscale/gsc.
         var scaleX:Number = 1 / _gsc;
         var scaleY:Number = 1 / _gsc;
         var aspectScale:Number = 1;
         // Window edges expressed in Main's 800x600 logical space (Main is scaled
         // by gameScale and centered); on a 4:3 window they reduce to 0/800/0/600.
         var _halfW:Number = stage.stageWidth / (2 * _gsc);
         var _halfH:Number = stage.stageHeight / (2 * _gsc);
         var edgeL:Number = 400 - _halfW;   // window left edge, logical
         var edgeR:Number = 400 + _halfW;   // window right edge
         var edgeT:Number = 300 - _halfH;   // window top edge
         var edgeB:Number = 300 + _halfH;   // window bottom edge
         if(this.map) {
            this.map.scaleX = scaleX * Parameters.data.mscale;
            this.map.scaleY = scaleY * Parameters.data.mscale;
         }
         if(this.timerCounter) {
            if(uiScale) {
               this.timerCounter.scaleX = aspectScale;
               this.timerCounter.scaleY = 1;
               this.timerCounter.y = 180;
            } else {
               this.timerCounter.scaleX = scaleX;
               this.timerCounter.scaleY = scaleY;
            }
         }
         if(this.enemyCounter) {
            if(uiScale) {
               this.enemyCounter.scaleX = aspectScale;
               this.enemyCounter.scaleY = 1;
               this.enemyCounter.y = 160;
            } else {
               this.enemyCounter.scaleX = scaleX;
               this.enemyCounter.scaleY = scaleY;
            }
         }
         if(this.stats) {
            if(uiScale) {
               this.stats.scaleX = aspectScale;
               this.stats.scaleY = 1;
            } else {
               this.stats.scaleX = scaleX;
               this.stats.scaleY = scaleY;
            }
            this.stats.x = edgeL + 5 * this.stats.scaleX;
            this.stats.y = edgeT + 5 * this.stats.scaleY;
         }
         if(this.charSwitcher_) {
            // Anchor to the real window LEFT edge (below the stats block) instead
            // of a fixed logical x, which drifted inward on wide windows.
            if(uiScale) {
               this.charSwitcher_.scaleX = aspectScale;
               this.charSwitcher_.scaleY = 1;
            } else {
               this.charSwitcher_.scaleX = scaleX;
               this.charSwitcher_.scaleY = scaleY;
            }
            this.charSwitcher_.x = edgeL + 6 * this.charSwitcher_.scaleX;
            this.charSwitcher_.y = edgeT + 74 * this.charSwitcher_.scaleY;
         }
         if(this.vaultButton_) {
            this.vaultButton_.scaleX = this.charSwitcher_ ? this.charSwitcher_.scaleX : 1;
            this.vaultButton_.scaleY = this.charSwitcher_ ? this.charSwitcher_.scaleY : 1;
            this.vaultButton_.x = edgeL + 6 * this.vaultButton_.scaleX;
            this.vaultButton_.y = edgeT + 112 * this.vaultButton_.scaleY;
         }
         if(this.convertButton_) {
            this.convertButton_.scaleX = this.charSwitcher_ ? this.charSwitcher_.scaleX : 1;
            this.convertButton_.scaleY = this.charSwitcher_ ? this.charSwitcher_.scaleY : 1;
            this.convertButton_.x = edgeL + 6 * this.convertButton_.scaleX;
            this.convertButton_.y = edgeT + 150 * this.convertButton_.scaleY;
         }
         if(this.questBar) {
            if(uiScale) {
               this.questBar.scaleX = aspectScale;
               this.questBar.scaleY = 1;
            } else {
               this.questBar.scaleX = scaleX;
               this.questBar.scaleY = scaleY;
            }
         }
         if(this.hudView) {
            if(uiScale) {
               this.hudView.scaleX = aspectScale;
               this.hudView.scaleY = 1;
            } else {
               this.hudView.scaleX = scaleX;
               this.hudView.scaleY = scaleY;
            }
            this.hudView.x = edgeR - 200 * this.hudView.scaleX;
            this.hudView.y = edgeT;   // anchor the sidebar to the window's top-right
            if(this.creditDisplay_) {
               this.creditDisplay_.x = this.hudView.x - 6 * this.creditDisplay_.scaleX;
            }
         }
         if(this.chatBox_) {
            if(uiScale) {
               this.chatBox_.scaleX = aspectScale;
               this.chatBox_.scaleY = 1;
            } else {
               this.chatBox_.scaleX = scaleX;
               this.chatBox_.scaleY = scaleY;
            }
            this.chatBox_.x = edgeL;
            this.chatBox_.y = edgeB - 300 * this.chatBox_.scaleY;
         }
         if(this.rankText_) {
            if(uiScale) {
               this.rankText_.scaleX = aspectScale;
               this.rankText_.scaleY = 1;
            } else {
               this.rankText_.scaleX = scaleX;
               this.rankText_.scaleY = scaleY;
            }
            this.rankText_.x = edgeL + 8 * this.rankText_.scaleX;
            this.rankText_.y = edgeT + 2 * this.rankText_.scaleY;
         }
         if(this.guildText_) {
            if(uiScale) {
               this.guildText_.scaleX = aspectScale;
               this.guildText_.scaleY = 1;
            } else {
               this.guildText_.scaleX = scaleX;
               this.guildText_.scaleY = scaleY;
            }
            this.guildText_.x = edgeL + 86 * this.guildText_.scaleX;
            this.guildText_.y = edgeT + 2 * this.guildText_.scaleY;
         }
         if(this.creditDisplay_) {
            if(uiScale) {
               this.creditDisplay_.scaleX = aspectScale;
               this.creditDisplay_.scaleY = 1;
            } else {
               this.creditDisplay_.scaleX = scaleX;
               this.creditDisplay_.scaleY = scaleY;
            }
         }
         if(this.shopDisplay) {
            if(uiScale) {
               this.shopDisplay.scaleX = aspectScale;
               this.shopDisplay.scaleY = 1;
            } else {
               this.shopDisplay.scaleX = scaleX;
               this.shopDisplay.scaleY = scaleY;
            }
            this.shopDisplay.x = edgeL + 6 * this.shopDisplay.scaleX;
            this.shopDisplay.y = edgeT + 40 * this.shopDisplay.scaleY;
         }
         if(this.packageOffer) {
            if(uiScale) {
               this.packageOffer.scaleX = aspectScale;
               this.packageOffer.scaleY = 1;
            } else {
               this.packageOffer.scaleX = scaleX;
               this.packageOffer.scaleY = scaleY;
            }
            this.packageOffer.x = edgeL + 6 * this.packageOffer.scaleX;
            this.packageOffer.y = edgeT + 31 * this.packageOffer.scaleY;
         }
         var posY:int = 72;
         if(this.giftStatusDisplay) {
            if(uiScale) {
               this.giftStatusDisplay.scaleX = aspectScale;
               this.giftStatusDisplay.scaleY = 1;
            } else {
               this.giftStatusDisplay.scaleX = scaleX;
               this.giftStatusDisplay.scaleY = scaleY;
            }
            this.giftStatusDisplay.x = edgeL + 6 * this.giftStatusDisplay.scaleX;
            this.giftStatusDisplay.y = edgeT + posY * this.giftStatusDisplay.scaleY;
            posY = posY + 32;
         }
         if(this.newsModalButton) {
            if(uiScale) {
               this.newsModalButton.scaleX = aspectScale;
               this.newsModalButton.scaleY = 1;
            } else {
               this.newsModalButton.scaleX = scaleX;
               this.newsModalButton.scaleY = scaleY;
            }
            this.newsModalButton.x = edgeL + 6 * this.newsModalButton.scaleX;
            this.newsModalButton.y = edgeT + posY * this.newsModalButton.scaleY;
            posY = posY + 32;
         }
         if(this.specialOfferButton) {
            if(uiScale) {
               this.specialOfferButton.scaleX = aspectScale;
               this.specialOfferButton.scaleY = 1;
            } else {
               this.specialOfferButton.scaleX = scaleX;
               this.specialOfferButton.scaleY = scaleY;
            }
            this.specialOfferButton.x = edgeL + 6 * this.specialOfferButton.scaleX;
            this.specialOfferButton.y = edgeT + posY * this.specialOfferButton.scaleY;
            posY = posY + 32;
         }
         if(this.challengerLeaderBoard) {
            if(uiScale) {
               this.challengerLeaderBoard.scaleX = aspectScale;
               this.challengerLeaderBoard.scaleY = 1;
            } else {
               this.challengerLeaderBoard.scaleX = scaleX;
               this.challengerLeaderBoard.scaleY = scaleY;
            }
            if(this.challengerLeaderBoard) {
               this.challengerLeaderBoard.x = this.hudView.x - this.challengerLeaderBoard.width - 6;
               this.challengerLeaderBoard.y = 40;
            }
         }
         if(this.challengerInfoButton) {
            if(uiScale) {
               this.challengerInfoButton.scaleX = aspectScale;
               this.challengerInfoButton.scaleY = 1;
            } else {
               this.challengerInfoButton.scaleX = scaleX;
               this.challengerInfoButton.scaleY = scaleY;
            }
            if(this.challengerInfoButton) {
               this.challengerInfoButton.x = this.hudView.x - this.challengerInfoButton.width - 6;
               this.challengerInfoButton.y = 80;
            }
         }
      }

      private function onFocusOut(event:Event) : void {
         if(Parameters.data.FocusFPS) {
            var requestedRate:Number = Number(Parameters.data.bgFPS);
            var appliedRate:Number = requestedRate;
            // AIR's low background cap is unsafe for unattended Auto Play: the
            // long Ninja session fell from ~115 FPS to ~20 FPS while unfocused,
            // reducing both path and dodge decisions to one every ~50 ms. Keep a
            // modest safety floor without exceeding the user's global FPS cap.
            if(CrashLogger.autoPlayRequested() || Parameters.data.autoDodge) {
               appliedRate = Math.min(Number(Parameters.data.customFPS),
                     Math.max(requestedRate,60));
            }
            stage.frameRate = appliedRate;
            DebugLog.event("background_fps",{"requested":requestedRate,
                  "applied":appliedRate,"autoPlay":CrashLogger.autoPlayRequested(),
                  "autoDodge":Parameters.data.autoDodge});
         }
      }

      private function onAddedToStage(event:Event) : void {
         removeEventListener(Event.ADDED_TO_STAGE,this.onAddedToStage);
         stage.frameRate = Number(Parameters.data.customFPS);
      }

      private function onFocusIn(event:Event) : void {
         if(Parameters.data.FocusFPS) {
            stage.frameRate = Number(Parameters.data.fgFPS);
         }
      }

      private function onMoneyChanged(event:Event) : void {
         gsc_.checkCredits();
      }

      // ---- Frame profiler (debug-log only; frame_perf every ~1s) ----------
      private var perfFrames_:int = 0;
      private var perfSumUpdateMs_:int = 0;
      private var perfSumDrawMs_:int = 0;
      private var perfSumPresentMs_:int = 0;
      private var perfSumIntervalMs_:int = 0;
      private var perfMaxIntervalMs_:int = 0;
      private var perfLastFrameTimer_:int = -1;
      private var perfLastLogMs_:int = 0;
      private var perfUpdateMs_:int = 0;
      private var perfDrawMs_:int = 0;

      /** Accumulate per-phase frame timing and emit frame_perf once a second.
       * avgOtherMs (frame minus update/draw/present) is the runtime's 2D
       * display-list overlay rasterization plus any vsync idle -- the number
       * that distinguishes an overlay bottleneck from VM or GPU cost. */
      private function recordFramePerf(frameStart:int) : void {
         if(this.perfLastFrameTimer_ >= 0) {
            var interval:int = frameStart - this.perfLastFrameTimer_;
            if(interval < 0) {
               interval = 0;
            }
            this.perfSumIntervalMs_ += interval;
            if(interval > this.perfMaxIntervalMs_) {
               this.perfMaxIntervalMs_ = interval;
            }
         }
         this.perfLastFrameTimer_ = frameStart;
         this.perfFrames_++;
         this.perfSumUpdateMs_ += this.perfUpdateMs_;
         this.perfSumDrawMs_ += this.perfDrawMs_;
         this.perfSumPresentMs_ += Renderer.lastPresentMs;
         var now:int = getTimer();
         if(now - this.perfLastLogMs_ >= 1000) {
            if(this.perfFrames_ > 1 && this.perfSumIntervalMs_ > 0) {
               var f:Number = this.perfFrames_;
               var other:int = this.perfSumIntervalMs_ - this.perfSumUpdateMs_ -
                     this.perfSumDrawMs_ - this.perfSumPresentMs_;
               if(other < 0) {
                  other = 0;
               }
               DebugLog.event("frame_perf",{
                  "map":this.mapName,
                  "frames":this.perfFrames_,
                  "fps":Math.round(1000 * this.perfFrames_ / this.perfSumIntervalMs_),
                  "avgFrameMs":Number((this.perfSumIntervalMs_ / f).toFixed(2)),
                  "maxFrameMs":this.perfMaxIntervalMs_,
                  "avgUpdateMs":Number((this.perfSumUpdateMs_ / f).toFixed(2)),
                  "avgDrawMs":Number((this.perfSumDrawMs_ / f).toFixed(2)),
                  "avgPresentMs":Number((this.perfSumPresentMs_ / f).toFixed(2)),
                  "avgOtherMs":Number((other / f).toFixed(2))});
            }
            this.perfFrames_ = 0;
            this.perfSumUpdateMs_ = 0;
            this.perfSumDrawMs_ = 0;
            this.perfSumPresentMs_ = 0;
            this.perfSumIntervalMs_ = 0;
            this.perfMaxIntervalMs_ = 0;
            this.perfLastLogMs_ = now;
         }
      }

      private function onEnterFrame(event:Event) : void {
         var perfFrameStart:int = getTimer();
         this.perfUpdateMs_ = 0;
         this.perfDrawMs_ = 0;
         var mouseDeltaX:int = 0;
         var mouseDeltaY:int = 0;
         var moddedTime:int = TimeUtil.getModdedTime();
         var trueTime:int = TimeUtil.getTrueTime();
         var deltaTime:int = moddedTime - lastUpdate_;
         // Clamp the per-frame delta. After a load screen, GC pause, or any
         // frame gap > a tick, lastUpdate_ is stale so this delta balloons — and
         // movement integrates speed*delta, producing a single MOVE step far
         // larger than the char's max speed allows for that interval. The 6.11+
         // server rejects that as an impossible move (FAILURE errorId=0) and
         // disconnects — reproduced in the Nexus: a ~2.85-tile step (2x the
         // physical max) immediately preceded the FAILURE. Capping the delta to
         // one tick's worth keeps every emitted MOVE within server bounds;
         // normal frames (16-100ms) are untouched.
         if(deltaTime > 200) {
            deltaTime = 200;
         }
         var frameMap:Map = this.map as Map;
         var player:Player = frameMap != null ? frameMap.player_ : null;
         this.monitorFrameStall(moddedTime - lastUpdate_,player);
         this.gcPump(trueTime,player);
         // Guard the whole render/update loop: with real current-build data our
         // old client can hit an object/tile/stat it doesn't understand and
         // throw. Logging + surviving the frame (instead of an uncaught error
         // every tick) keeps the session alive and pins the exact failure in
         // crash.log so it can be fixed. See CrashLogger.
         try {
         if(player && player.checkHealth(moddedTime)) {
            // checkHealth disconnects synchronously when Auto Nexus fires.
            // Nothing queued against the old map/session is valid afterward.
            this.hitQueue.length = 0;
            lastUpdate_ = moddedTime;
            return;
         }
         if(frameMap == null) {
            this.hitQueue.length = 0;
            lastUpdate_ = moddedTime;
            return;
         }
         if(mui_.held) {
            mouseDeltaX = Main.STAGE.mouseX - mui_.heldX;
            Parameters.data.cameraAngle = mui_.heldAngle + mouseDeltaX * 0.0174532925199433;
            if(Parameters.data.tiltCam) {
               mouseDeltaY = Main.STAGE.mouseY - mui_.heldY;
               mui_.heldY = Main.STAGE.mouseY;
               this.camera_.nonPPMatrix_.appendRotation(mouseDeltaY,Vector3D.X_AXIS,null);
            }
         }
         if(moddedTime - this.lastUpdateInteractiveTime > 100) {
            this.lastUpdateInteractiveTime = moddedTime;
            this.updateNearestInteractive();
         }
         var perfUpdateStart:int = getTimer();
         frameMap.update(moddedTime,deltaTime);
         this.perfUpdateMs_ = getTimer() - perfUpdateStart;
         this.autoPilot(moddedTime);
         if(this.map !== frameMap || frameMap.player_ == null) {
            // A reconnect can also be initiated by Auto Play while this frame is
            // active. Do not flush PLAYERHIT or render the detached map.
            this.hitQueue.length = 0;
            lastUpdate_ = moddedTime;
            return;
         }
         var hitCount:int = this.hitQueue.length;
         for(var hitIndex:int = 0; hitIndex < hitCount; hitIndex++) {
            var hit:Hit = this.hitQueue[hitIndex];
            this.gsc_.playerHit(hit.bulletId,hit.objectId);
         }
         this.hitQueue.length = 0;
         this.camera_.update(int(deltaTime / Parameters.data.timeScale));
         if(Parameters.data.showQuestBar && this.questBar) {
            updateQuestBar();
         } else if(this.questBar) {
            this.questBar.visible = false;
         }
         if(Parameters.timerActive && Parameters.data.showTimers) {
            if(this.timerCounter == null) {
               this.addTimer();
            }
            if(trueTime >= Parameters.phaseChangeAt) {
               Parameters.phaseChangeAt = 2147483647;
               Parameters.timerActive = false;
               this.timerCounter.visible = false;
            } else {
               updateTimer(trueTime);
            }
         }
         if(Parameters.data.liteMonitor) {
            if(this.stats) {
               this.updateStats(trueTime);
            }
         }
         if(this.enemyCounter && Parameters.data.showEnemyCounter) {
            this.enemyCounter.visible = true;
         }
         if(this.focus && this.camera_ && player) {
            camera_.configureCamera(this.focus,player.isHallucinating);
            var perfDrawStart:int = getTimer();
            map.draw(camera_,trueTime);
            this.perfDrawMs_ = getTimer() - perfDrawStart;
         }
         if(player) {
            // Only persist the realm IP when it actually CHANGES. This used to
            // call Parameters.save() (a SharedObject disk write) EVERY FRAME
            // while in a realm — 30-144 disk writes/second, a real perf + disk
            // wear sink.
            if(this.mapName == "Realm of the Mad God" && this.gsc_.server_.address != "127.0.0.1" && this.gsc_.server_.address != "localhost"
                    && Parameters.data.lastRealmIP != this.gsc_.server_.address) {
               Parameters.data.lastRealmIP = this.gsc_.server_.address;
               Parameters.save();
            }
            if(Parameters.followPlayer) {
               player.followPos.x = Parameters.followPlayer.x_;
               player.followPos.y = Parameters.followPlayer.y_;
            }
            if(moddedTime - this.lastHudDrawTime_ >= HUD_INTERVAL_MS) {
               this.lastHudDrawTime_ = moddedTime;
               this.drawCharacterWindow.dispatch(player);
            }
            if(Parameters.data.showFameGoldRealms) {
               this.creditDisplay_.visible = true;
               if(this.isSafeMap) {
                  this.rankText_.draw(player.numStars_,player.starsBg_);
                  this.guildText_.draw(player.guildName_,player.guildRank_);
                  this.creditDisplay_.draw(player.credits_,player.fame_,player.forgefire);
               } else {
                  this.creditDisplay_.draw(player.credits_,player.fame_,player.forgefire);
               }
            } else if(this.isSafeMap) {
               this.rankText_.draw(player.numStars_,player.starsBg_);
               this.guildText_.draw(player.guildName_,player.guildRank_);
               this.creditDisplay_.draw(player.credits_,player.fame_,player.forgefire);
            } else {
               this.creditDisplay_.visible = false;
            }
            if(!Parameters.data.noClip) {
               moveRecords_.addRecord(moddedTime,player.x_,player.y_);
            }
         }
         this.recordFramePerf(perfFrameStart);
         lastUpdate_ = moddedTime;
         } catch(_frameErr:Error) {
            CrashLogger.log("GameSprite.onEnterFrame", _frameErr);
         }
         // Perf/memory sampling: frame() is cheap every frame; the O(n) object
         // counts run only when a summary is due (~5s), so overhead is negligible.
         var _perfMap:Map = this.map as Map;
         if(_perfMap != null && PerfMonitor.frame(trueTime)) {
            var _goN:int = 0;
            var _boN:int = 0;
            var _projN:int = 0;
            var _o:*;
            for each(_o in _perfMap.goDict_) { _goN++; }
             for each(_o in _perfMap.boDict_) {
                _boN++;
                if(_o is Projectile) { _projN++; }
             }
             PerfMonitor.sampleAndLog(_goN,_boN,_projN,
                   _perfMap.hostileProjectiles_ != null ?
                   _perfMap.hostileProjectiles_.length : 0,
                   _perfMap.updateGameObjectCount,
                   TileRedrawer.cacheCount,TextureRedrawer.cacheCount,
                   TextureFactory.textureCount,this.mapName);
         }
      }

      // ---- Debug autopilot -------------------------------------------------
      // Enabled only when the "Auto Play" option is on (CrashLogger.autoPlayRequested
      // -> Parameters.data.autoPlay; Options -> Misc). Drives the client through
      // realm entry + combat so packets.log / crash.log capture the
      // map/object/projectile/combat paths that manual play would hit.
      private var apChecked_:Boolean = false;
      private var apOn_:Boolean = false;
      private var apNoShoot_:Boolean = false;
      // Mirrors apNoShoot_ for other classes (MapUserInput auto-aim gate).
      public static var apNoShootActive_:Boolean = false;
      private var apSlowShoot_:Boolean = false;
      private var apIdle_:Boolean = false;
      private var apLastPortal_:int = 0;
      private var apLastNote_:int = 0;
      private var apLastShot_:int = 0;
      private var apLastAbility_:int = 0;
      private var apSeen_:Object = {};
      private var apPath_:Vector.<Point> = new Vector.<Point>();
      private var apPathTarget_:int = -1;
      private var apLastPathBuild_:int = 0;
      private var apLastPathNote_:int = 0;
      private var apWallEscapeTarget_:int = -1;
      private var apWallEscapeUntil_:int = 0;
      private var apLastBuildWasWallEscape_:Boolean = false;
      private var apProgressX_:Number = NaN;
      private var apProgressY_:Number = NaN;
      private var apProgressAt_:int = 0;
      private var apBestTargetDistance_:Number = Infinity;
      private var apStuckCount_:int = 0;
      // A separate, spatially persistent escalation counter. apStuckCount_ is
      // intentionally reset by small route progress, which is useful for BFS
      // waypoint rejection but failed to recognize a player roaming inside a
      // sealed structure. This episode survives replans and quest-id changes
      // until the player actually leaves the local region.
      private var apStuckRegionX_:Number = NaN;
      private var apStuckRegionY_:Number = NaN;
      private var apStuckRegionHits_:int = 0;
      private var apStuckRegionLastAt_:int = 0;
      private var apLastStuckTeleportAt_:int = 0;

      /** One-shot realm-entry beacon teleport for the current map. */
      private var apBeaconEntryDone_:Boolean = false;
      private var apEscapeUntil_:int = 0;
      private var apEscapeSign_:int = 1;
      private var apBlocked_:Dictionary = new Dictionary();
      private var apLastMap_:String = null;
      private var apLastMapObject_:Object = null;
      private var apMapEnteredAt_:int = 0;
      private var apSelectedRealmPortal_:int = -1;
      // Static because reconnects can replace the GameSprite. Object ids cannot
      // survive Nexus reloads, but the normalized realm name can.
      private static var apOriginalRealmName_:String = null;
      private static var apPendingRealmName_:String = null;
      private static const AP_REALM_DISCOVERY_MS:int = 1500;
      private static const AP_ORIGINAL_REALM_DISCOVERY_MS:int = 3500;
      private var apRealmSelectionReadyAt_:int = 0;
      private var apLastQuestId_:int = -2;
      private var apCompletedQuestIds_:Object = {};
      private var apLastNexusRecovery_:int = 0;
      private var apSavedOptions_:Object = null;
      private var apManualMovementPaused_:Boolean = false;
      private var apQueueWaitLogged_:Boolean = false;
      private var apQueuePortalMissingSince_:int = 0;
      private var apVisibleQuestLogged_:int = -1;
      private var apLastBagScanLog_:int = 0;
      private var apLastBagScanAt_:int = 0;
      private var apCachedBagId_:int = -1;
      private var apBagHoldId_:int = -1;
      private var apBagHoldStarted_:int = 0;
      private static const AP_BAG_MIN_HOLD_MS:int = 1000;
      private static const AP_BAG_MAX_HOLD_MS:int = 5000;
      private static const AP_BAG_SCAN_INTERVAL_MS:int = 200;
      private static const AP_BAG_STALL_TIMEOUT_MS:int = 6000;
      private static const AP_BAG_LOCATION_COOLDOWN_MS:int = 2000;
      private static const AP_BAG_PROGRESS_DISTANCE:Number = 0.10;
      // Don't commit to a bag this far away: it is at the edge of the loaded
      // entity radius and, while the autopilot fights/dodges its way over,
      // typically despawns before arrival. The audit found 71% of missed bags
      // were >20 tiles out. Squared, since selection compares distSquared.
      private static const AP_BAG_MAX_DISTANCE_SQ:Number = 26 * 26;
      private var apBagApproachId_:int = -1;
      private var apBagApproachStarted_:int = 0;
      private var apBagApproachBestDistance_:Number = Infinity;
      private var apBagLastProgressAt_:int = 0;
      private var apBagHoldLocationKey_:String = null;
      private var apServicedBagIds_:Object = {};
      private var apServicedBagLocations_:Object = {};
      private var apNexusNoRealmSince_:int = 0;
      private var apDungeonSawQuest_:Boolean = false;
      private var apDungeonQuestCompleted_:Boolean = false;
      private var apDungeonExploreHeading_:Number = 0;
      private var apDungeonExploreAt_:int = 0;
      private var apDungeonLastActivityAt_:int = 0;
      private var apExploreGoalX_:int = int.MIN_VALUE;
      private var apExploreGoalY_:int = int.MIN_VALUE;
      private var apExploreBestDistance_:Number = Infinity;
      private var apExploreProgressAt_:int = 0;
      private var apExploreStallCount_:int = 0;
      private var apCastleRouteSide_:int = 0;
      private var apCastleRouteIndex_:int = 0;
      // Stuck ticks to tolerate on a fixed Castle route before abandoning that
      // waypoint. apStuckCount_ advances roughly per stalled path rebuild (~1/s),
      // so this is a low-teens-of-seconds wait — long enough for a group to break
      // a barrier, far short of the 42-63s freezes seen in the logs.
      private static const AP_CASTLE_ROUTE_WAIT_GIVEUP:int = 12;
      private var apCastleLowerSpawn_:Boolean = false;
      private var apCastleGuardianSeen_:Boolean = false;
      private var apCastleGuardiansCompleted_:Boolean = false;
      private var apCastleGuardianIds_:Object = {};
      private var apCastleFollowPlayerId_:int = -1;
      private var apCastleFollowPlayerX_:Number = 0;
      private var apCastleFollowPlayerY_:Number = 0;
      private var apCastleWaitLogAt_:int = 0;
      private var apLastWallEscapeFrom_:int = -1;
      private var apLastWallEscapeTo_:int = -1;
      private var apWallEscapeReverseCount_:int = 0;
      private var apWallEscapeDirectionX_:Number = 0;
      private var apWallEscapeDirectionY_:Number = 0;
      private var apSeparationEnemyId_:int = -1;
      // Retained for exit telemetry: the enemy is often dead/removed by then,
      // so the id alone cannot be resolved to a type in post-hoc log analysis.
      private var apSeparationEnemyType_:int = -1;
      private var apSeparationStartedAt_:int = 0;
      private var apSeparationDirection_:Number = NaN;
      private var apSeparationTargetX_:Number = NaN;
      private var apSeparationTargetY_:Number = NaN;
      private var apSeparationTargetAt_:int = 0;
      private var apSeparationLastThreatAt_:int = 0;
      private const apFailedRouteX_:Vector.<Number> = new Vector.<Number>();
      private const apFailedRouteY_:Vector.<Number> = new Vector.<Number>();
      private const apFailedRouteRadius_:Vector.<Number> = new Vector.<Number>();
      private var apLastEnemyScanAt_:int = 0;
      private var apCachedEnemyId_:int = -1;
      private var apLastCrowdScanAt_:int = 0;
      private var apCachedCrowdEnemyId_:int = -1;
      private var apCachedCrowdQuestId_:int = -2;
      private var apCachedCrowdRadius_:Number = -1;
      private var apObjectCacheAt_:int = 0;
      private const apCachedPortals_:Vector.<Portal> = new Vector.<Portal>();
      private const apCachedContainers_:Vector.<Container> = new Vector.<Container>();
      private const apCachedPlayers_:Vector.<Player> = new Vector.<Player>();
      private const apCachedCharacters_:Vector.<Character> = new Vector.<Character>();
      private const apNearbyCrowd_:Vector.<GameObject> = new Vector.<GameObject>();
      private static const AP_TARGET_SCAN_INTERVAL_MS:int = 100;
      private static const AP_OBJECT_CACHE_INTERVAL_MS:int = 200;
      // Ordinary enemies are navigation targets, not three-tile exclusion
      // zones.  Only intervene once their bodies are nearly overlapping the
      // player; projectile avoidance remains Auto Dodge's responsibility.
      private static const AP_CROWD_SEPARATION_ENTER:Number = 1.15;
      private static const AP_CROWD_SEPARATION_EXIT:Number = 1.45;
      // Object scans run every 100 ms. Reserve one scan interval of only the
      // distance above ordinary movement speed;
      // this keeps normal classes tight while preventing an 80-SPD/Speedy player
      // from crossing the complete separation band between scans.
      private static const AP_SEPARATION_BASE_SPEED:Number = 0.0065;
      private static const AP_SEPARATION_RESERVE_MS:int = 100;
      private static const AP_SEPARATION_MAX_RESERVE:Number = 1.0;
      private static const AP_CLOSE_SHOT_SEPARATION_ENTER:Number = 5.5;
      private static const AP_CLOSE_SHOT_SEPARATION_EXIT:Number = 6.25;
      // Physics-derived spacing (option "autoPlaySmartSpacing").
      //
      // Log evidence (1,076 auto_dodge_hit over 2026-07-24/25): 49.3% of hits
      // came from projectiles that SPAWNED within 1 tile of the player, and
      // those carry 76% of all expected damage. Median shot age at impact 12ms,
      // median lead 0ms. At ~0.0083 tiles/ms a bullet born 0.28 tiles away
      // cannot be dodged by ANY model — so this is a spacing problem, not a
      // dodge-model problem. The flat 1.15-tile ring sat far inside the
      // reaction envelope; the one enemy previously found doing this
      // (AP_CLOSE_SHOT_*) was fixed by hardcoding its type, which does not
      // generalise.
      //
      // Instead derive the ring from the shooter's own projectile physics: a
      // shot spawned at distance d travelling at speed s (tiles/ms) gives
      // d/s ms of warning, so to guarantee `reactionLeadMs` we need
      // d >= s * reactionLeadMs. Melee/contact enemies (no projectiles) keep
      // the tight default so Auto Play does not become globally timid.
      private static const AP_SMART_SEPARATION_MIN:Number = 2.0;
      private static const AP_SMART_SEPARATION_MAX:Number = 6.0;
      // Hysteresis band. The old 0.30-tile gap was narrower than one movement
      // step, producing 387 enter/exit episodes in a day with a median duration
      // of 407ms — separation was a per-frame coin flip rather than a decision.
      private static const AP_SMART_SEPARATION_BAND:Number = 0.9;
      private static const AP_CROWD_SEPARATION_MIN_HOLD_MS:int = 250;
      private static const AP_CROWD_SEPARATION_RELEASE_MS:int = 150;
      private static const AP_SEPARATION_TARGET_REPLAN_MS:int = 250;
      private static const AP_FAILED_ROUTE_RADIUS:Number = 6.5;
      private static const AP_PATH_PROGRESS_TIMEOUT_MS:int = 3500;
      private static const AP_PATH_MIN_PROGRESS:Number = 0.75;
      private static const AP_EMPTY_FIXED_INSTANCE_MS:int = 90000;
      // Auto Dodge outranks Auto Play for movement (user directive 2026-07-22).
      // After a dodge override ends, Auto Play holds still briefly and then
      // replans from the position the dodge chose, instead of immediately
      // tugging back toward the pre-dodge waypoint -- that tug-of-war made
      // the dodge look "10x worse" under Auto Play.
      private var apDodgeYieldUntil_:int = 0;
      private static const AP_DODGE_YIELD_MS:int = 250;
      private static const AP_DODGE_DISPLACED_SQ:Number = 6.25; // (2.5 tiles)^2
      // Proactive Spacing under Auto Play: while standing to shoot, drift gently
      // toward open floor if the dodge suggests it (reused scratch Point).
      private const apSpacingDir_:Point = new Point();
      private static const AP_SPACING_SPEED:Number = 0.45;

      // Oryx's Castle is a fixed, mirrored map. These macro waypoints follow the
      // two legal corridors from the random left/right spawn to the central
      // Stone Guardian room. Local BFS still handles the exact streamed tiles;
      // the macro route prevents its short frontier search from alternating
      // between opposite sides of the large castle walls.
      private static const AP_CASTLE_LEFT_ROUTE:Vector.<Point> = new <Point>[
            new Point(79.5,170.5),new Point(86.5,140.5),
            new Point(86.5,118.5),new Point(86.5,97.5),
            new Point(54.5,97.5),new Point(54.5,82.5),
            new Point(86.5,82.5),new Point(100.5,66.5),
            new Point(128.5,60.5)
      ];
      private static const AP_CASTLE_RIGHT_ROUTE:Vector.<Point> = new <Point>[
            new Point(176.5,170.5),new Point(169.5,140.5),
            new Point(169.5,118.5),new Point(169.5,97.5),
            new Point(201.5,97.5),new Point(201.5,82.5),
            new Point(169.5,82.5),new Point(155.5,66.5),
            new Point(128.5,60.5)
      ];
      // The server also uses a shortened side spawn around (43,186)/(213,186).
      // It joins the same inner corridor near (54,98)/(202,98).
      private static const AP_CASTLE_LEFT_SIDE_ROUTE:Vector.<Point> = new <Point>[
            new Point(46.5,170.5),new Point(46.5,140.5),
            new Point(50.5,118.5),new Point(86.5,118.5),
            new Point(86.5,97.5),
            new Point(54.5,97.5),new Point(54.5,82.5),
            new Point(86.5,82.5),new Point(100.5,66.5),
            new Point(128.5,60.5)
      ];
      private static const AP_CASTLE_RIGHT_SIDE_ROUTE:Vector.<Point> = new <Point>[
            new Point(209.5,170.5),new Point(209.5,140.5),
            new Point(205.5,118.5),new Point(169.5,118.5),
            new Point(169.5,97.5),
            new Point(201.5,97.5),new Point(201.5,82.5),
            new Point(169.5,82.5),new Point(155.5,66.5),
            new Point(128.5,60.5)
      ];

      private static const AP_DIR_X:Vector.<int> = new <int>[1,-1,0,0,1,1,-1,-1];
      private static const AP_DIR_Y:Vector.<int> = new <int>[0,0,1,-1,1,-1,1,-1];

      // Debug-experiment marker files: drop a file with this name into the
      // app-storage dir to flip autopilot behavior between runs without
      // recompiling. Used to bisect the realm-combat DC.
      private static function apMarker(name:String) : Boolean {
         try {
            return File.applicationStorageDirectory.resolvePath(name).exists;
         } catch(e:Error) {
         }
         return false;
      }

      private function autoPilot(now:int) : void {
         var requested:Boolean = CrashLogger.autoPlayRequested();
         if(!this.apChecked_ || requested != this.apOn_) {
            var wasAutoPlayOn:Boolean = this.apOn_;
            this.apChecked_ = true;
            // Autopilot gated on the "Auto Play" option. When on it drives realm
            // entry + combat for test runs; off (default) the client is fully manual.
            this.apOn_ = requested;
            if(this.apOn_) {
               this.apSavedOptions_ = {
                  "AAOn":Parameters.data.AAOn,
                  "autoDodge":Parameters.data.autoDodge,
                  "autoDodgePredictive":Parameters.data.autoDodgePredictive,
                  "autoDodgeDebug":Parameters.data.autoDodgeDebug,
                  "hpDebugLog":Parameters.data.hpDebugLog,
                  "partialGodMode":Parameters.data.partialGodMode,
                  "packetLog":Parameters.data.packetLog,
                  "logErrors":Parameters.data.logErrors
               };
               this.apNoShoot_ = apMarker("AP_NOSHOOT");
               this.apSlowShoot_ = apMarker("AP_SLOWSHOOT");
               this.apIdle_ = apMarker("AP_IDLE");
               Parameters.data.AAOn = true;
               // AAOn is only the enable switch. Deliberately leave aimMode and
               // every normal AutoAim targeting preference unchanged.
               if(Parameters.data.autoPlayDiagnostics) {
                  // Auto Play is primarily an unattended diagnostic loop. Force a
                  // valid damage/dodge configuration in memory without persisting
                  // over the user's saved choices after the run.
                  Parameters.data.autoDodge = true;
                  Parameters.data.autoDodgePredictive = true;
                  Parameters.data.autoDodgeDebug = true;
                  Parameters.data.hpDebugLog = true;
                  Parameters.data.partialGodMode = false;
                  Parameters.data.packetLog = true;
                  Parameters.data.logErrors = true;
               }
               // AP_IDLE must ALSO silence MapUserInput's auto-aim (AAOn defaults
               // ON), or the "idle" test keeps firing PlayerShoot on its own.
               apNoShootActive_ = this.apNoShoot_ || this.apIdle_;
               CrashLogger.note("AUTOPILOT active on map '" + this.mapName + "'" +
                       (this.apNoShoot_ ? " [NOSHOOT]" : "") +
                       (this.apSlowShoot_ ? " [SLOWSHOOT]" : "") +
                       (this.apIdle_ ? " [IDLE]" : ""));
            } else {
               if(wasAutoPlayOn) {
                  apOriginalRealmName_ = null;
                  apPendingRealmName_ = null;
               }
               apNoShootActive_ = false;
               this.apManualMovementPaused_ = false;
               if(this.apSavedOptions_ != null) {
                  Parameters.data.AAOn = this.apSavedOptions_.AAOn;
                  Parameters.data.autoDodge = this.apSavedOptions_.autoDodge;
                  Parameters.data.autoDodgePredictive = this.apSavedOptions_.autoDodgePredictive;
                  Parameters.data.autoDodgeDebug = this.apSavedOptions_.autoDodgeDebug;
                  Parameters.data.hpDebugLog = this.apSavedOptions_.hpDebugLog;
                  Parameters.data.partialGodMode = this.apSavedOptions_.partialGodMode;
                  Parameters.data.packetLog = this.apSavedOptions_.packetLog;
                  Parameters.data.logErrors = this.apSavedOptions_.logErrors;
                  this.apSavedOptions_ = null;
               }
               var stoppedPlayer:Player = this.map != null ? this.map.player_ : null;
               if(stoppedPlayer != null) {
                  stoppedPlayer.calcHealthPercent();
                  stoppedPlayer.setRelativeMovement(0,0,0);
               }
            }
         }
         if(!this.apOn_) {
            return;
         }
         try {
            var p:Player = this.map.player_;
            if(p == null) {
               return;
            }
            var autoPlayMap:Map = this.map as Map;
            var autoPlayOnDamagingGround:Boolean = autoPlayMap != null &&
                  autoPlayMap.isDamagingGround(p.x_,p.y_);
            // Blocked-tile keys and seen-portal ids are map-specific; on a map
            // change (realm/dungeon/reconnect) drop them so stale obstacles from
            // the previous map don't poison this map's pathfinding, and re-seen
            // portals get dumped again. Also cancels any stale pending path.
            if(this.map != this.apLastMapObject_) {
               this.apLastMapObject_ = this.map;
               this.apLastMap_ = this.mapName;
               this.apBlocked_ = new Dictionary();
               this.apSeen_ = {};
               this.apPath_.length = 0;
               this.apPathTarget_ = -1;
               this.apLastPathBuild_ = 0;
               this.apWallEscapeTarget_ = -1;
               this.apWallEscapeUntil_ = 0;
               this.apLastBuildWasWallEscape_ = false;
               this.apMapEnteredAt_ = now;
               this.apSelectedRealmPortal_ = -1;
               this.apRealmSelectionReadyAt_ = 0;
               this.apLastQuestId_ = -2;
               this.apCompletedQuestIds_ = {};
               this.apQueueWaitLogged_ = false;
               this.apQueuePortalMissingSince_ = 0;
                this.apVisibleQuestLogged_ = -1;
                this.apLastBagScanAt_ = 0;
                this.apCachedBagId_ = -1;
                 this.apBagHoldId_ = -1;
                this.apBagHoldStarted_ = 0;
                 this.apBagApproachId_ = -1;
                 this.apBagApproachStarted_ = 0;
                 this.apBagApproachBestDistance_ = Infinity;
                 this.apBagLastProgressAt_ = 0;
                 this.apBagHoldLocationKey_ = null;
                 this.apServicedBagIds_ = {};
                this.apServicedBagLocations_ = {};
               this.apNexusNoRealmSince_ = 0;
               this.apDungeonSawQuest_ = false;
               this.apDungeonQuestCompleted_ = false;
               this.apDungeonExploreHeading_ = Math.random() * Math.PI * 2;
               this.apDungeonExploreAt_ = 0;
               this.apDungeonLastActivityAt_ = now;
               this.apExploreGoalX_ = int.MIN_VALUE;
               this.apExploreGoalY_ = int.MIN_VALUE;
               this.apExploreBestDistance_ = Infinity;
               this.apExploreProgressAt_ = now;
               this.apExploreStallCount_ = 0;
               this.apCastleRouteSide_ = p.x_ < 128 ? -1 : 1;
               this.apCastleRouteIndex_ = 0;
               this.apCastleLowerSpawn_ = p.y_ > 200;
               this.apCastleGuardianSeen_ = false;
               this.apCastleGuardiansCompleted_ = false;
               this.apCastleGuardianIds_ = {};
               this.apCastleFollowPlayerId_ = -1;
               this.apCastleWaitLogAt_ = 0;
                 this.apLastWallEscapeFrom_ = -1;
                 this.apLastWallEscapeTo_ = -1;
                this.apWallEscapeReverseCount_ = 0;
                this.apWallEscapeDirectionX_ = 0;
                this.apWallEscapeDirectionY_ = 0;
               this.apStuckRegionX_ = NaN;
               this.apStuckRegionY_ = NaN;
               this.apStuckRegionHits_ = 0;
               this.apStuckRegionLastAt_ = 0;
               this.apLastStuckTeleportAt_ = 0;
                this.apSeparationEnemyId_ = -1;
                this.apSeparationStartedAt_ = 0;
                this.apSeparationDirection_ = NaN;
                this.apSeparationTargetX_ = NaN;
                this.apSeparationTargetY_ = NaN;
                this.apSeparationTargetAt_ = 0;
                this.apSeparationLastThreatAt_ = 0;
                this.apFailedRouteX_.length = 0;
                this.apFailedRouteY_.length = 0;
                this.apFailedRouteRadius_.length = 0;
                this.apLastEnemyScanAt_ = 0;
                this.apCachedEnemyId_ = -1;
                this.apLastCrowdScanAt_ = 0;
                this.apCachedCrowdEnemyId_ = -1;
                this.apCachedCrowdQuestId_ = -2;
                this.apCachedCrowdRadius_ = -1;
                this.apObjectCacheAt_ = 0;
                this.apCachedPortals_.length = 0;
                this.apCachedContainers_.length = 0;
                this.apCachedPlayers_.length = 0;
                this.apCachedCharacters_.length = 0;
                this.apNearbyCrowd_.length = 0;
                this.apManualMovementPaused_ = false;
                this.apBeaconEntryDone_ = false;
               DebugLog.event("autoplay_state",{"state":"map_enter","map":this.mapName,
                     "safe":this.isSafeMap,"x":p.x_,"y":p.y_});
            }
            // Auto Play writes relMoveVec_ after Player.update, so without this
            // gate its quest/crowd movement replaces a live keyboard vector for
            // the following frame. Manual input owns movement while held. Auto
            // Dodge still runs inside Player.update and may make a real safety
            // correction before this point.
            if(p.hasManualMovementInput()) {
               // Manual ownership pauses route time as well as route writes. A
               // player holding movement for six seconds must not make the
               // selected white bag immediately enter the stalled cooldown when
               // AutoPlay resumes.
               if(this.apBagApproachId_ >= 0) {
                  this.apBagLastProgressAt_ = getTimer();
               }
               if(!this.apManualMovementPaused_) {
                  this.apManualMovementPaused_ = true;
                  DebugLog.event("autoplay_state",{
                        "state":"manual_movement_pause","map":this.mapName,
                        "x":p.x_,"y":p.y_});
               }
               return;
            }
            if(this.apManualMovementPaused_) {
               this.apManualMovementPaused_ = false;
               DebugLog.event("autoplay_state",{
                     "state":"manual_movement_resume","map":this.mapName,
                     "x":p.x_,"y":p.y_});
            }
            if(now - this.apLastNote_ > 5000) {
               this.apLastNote_ = now;
               CrashLogger.note("AUTOPILOT: map='" + this.mapName + "' safe=" + this.isSafeMap +
                       " pos=(" + int(p.x_) + "," + int(p.y_) + ")");
            }
            this.apDumpPortals(p);
            // AP_IDLE bisect: in a realm/dungeon, do NOTHING — no move, no shoot,
            // just stand where we spawned. If the server still kicks us here, the
            // realm DC is periodic/incoming, not caused by our movement or
            // combat packets at all. Safe maps still navigate (to reach a realm).
            if(this.apIdle_ && !this.isSafeMap) {
               p.setRelativeMovement(0, 0, 0);
               return;
            }
            // On realm entry, jump straight to a level-appropriate waypoint
            // beacon instead of walking from spawn: Veteran at 20, Adept at
            // 11-19, Rookie below. Beacons arrive in the first UPDATE, so a
            // short settle delay suffices; if this realm has none (or teleport
            // stays unavailable), give up after 15 s and explore normally.
            if(!this.isSafeMap && !this.apBeaconEntryDone_ &&
                  this.mapName == "Realm of the Mad God" &&
                  now - this.apMapEnteredAt_ >= 2500) {
               if(this.apTeleportToBeacon(p,now,"realm_entry")) {
                  this.apBeaconEntryDone_ = true;
                  return;
               }
               if(now - this.apMapEnteredAt_ >= 15000) {
                  this.apBeaconEntryDone_ = true;
               }
            }
            // Only fight in genuinely non-safe maps (real realms/dungeons). Safe
            // maps (incl. the Daily Quest Room) reject combat via anti-cheat, so
            // navigate portals there instead. On a server with walk-in realms the
            // autopilot enters them (non-safe) and fights automatically.
            if(this.isSafeMap) {
               // Vault/pet-yard/other safe side maps are not useful combat
               // states. Prefer their Nexus portal; if none streams in, use the
               // trusted Nexus reconnect and restart realm selection.
               if(Parameters.data.autoPlayNexusRecovery && this.mapName != "Nexus" && now - this.apMapEnteredAt_ > 8000 &&
                     this.apBestHubPortal(p) == null &&
                     now - this.apLastNexusRecovery_ > 10000 && Parameters.reconNexus != null) {
                  this.apLastNexusRecovery_ = now;
                  CrashLogger.note("AUTOPILOT: safe map has no Nexus portal; reconnecting to Nexus");
                  DebugLog.event("autoplay_state",{"state":"nexus_recovery","map":this.mapName});
                  this.dispatchEvent(Parameters.reconNexus);
                  return;
               }
               // Hub navigation (per user): portal pathfinding got stuck, but in
               // the Nexus the realm portals sit in a row straight NORTH of the
               // spawn. So just walk straight up. Only when a realm portal is
               // actually close do we steer onto it and enter. If we're stuck in
               // a setpiece (vault/petyard), head back to the Nexus instead.
               // Once the server places us in a realm queue, do not re-run realm
               // selection: repeated selection was making Auto Play oscillate
               // between full portals instead of waiting for its admitted slot.
               if(Parameters.data.autoPlayWaitRealmQueue &&
                     GameServerConnectionConcrete.inRealmQueue_) {
                  var queuedPortalId:int = GameServerConnectionConcrete.realmFullPortalId_;
                  var queuedPortal:Portal = this.map.goDict_[queuedPortalId] as Portal;
                  if(queuedPortal == null) {
                     if(this.apQueuePortalMissingSince_ == 0) {
                        this.apQueuePortalMissingSince_ = now;
                     } else if(now - this.apQueuePortalMissingSince_ >= 2000) {
                        DebugLog.event("autoplay_state",{"state":"realm_queue_portal_gone",
                              "portalId":queuedPortalId});
                        CrashLogger.note("AUTOPILOT: queued realm portal disappeared; restarting selection");
                        var concreteConnection:GameServerConnectionConcrete =
                              this.gsc_ as GameServerConnectionConcrete;
                        if(concreteConnection != null) {
                           concreteConnection.abandonStaleRealmQueue();
                        }
                        this.apSelectedRealmPortal_ = -1;
                        this.apRealmSelectionReadyAt_ = 0;
                        this.apQueuePortalMissingSince_ = 0;
                        p.setRelativeMovement(0,0,0);
                        this.apPath_.length = 0;
                        this.apPathTarget_ = -1;
                        this.apProgressX_ = NaN;
                        return;
                     }
                  } else {
                     this.apQueuePortalMissingSince_ = 0;
                  }
                  p.setRelativeMovement(0,0,0);
                  this.apPath_.length = 0;
                  this.apPathTarget_ = -1;
                  this.apProgressX_ = NaN;
                  this.apSelectedRealmPortal_ = queuedPortalId;
                  if(!this.apQueueWaitLogged_) {
                     this.apQueueWaitLogged_ = true;
                     DebugLog.event("autoplay_state",{"state":"realm_queue_wait",
                           "portalId":this.apSelectedRealmPortal_});
                     CrashLogger.note("AUTOPILOT: waiting in selected realm queue id=" +
                           this.apSelectedRealmPortal_);
                  }
                  return;
               }
               this.apQueueWaitLogged_ = false;
               var portal:Portal = this.apBestHubPortal(p);
               var realmPortalVisible:Boolean = this.apHasRealmPortal();
               if(this.mapName == "Nexus" && portal == null && !realmPortalVisible &&
                     Parameters.data.autoPlaySwitchEmptyServer) {
                  if(this.apNexusNoRealmSince_ == 0) {
                     this.apNexusNoRealmSince_ = now;
                  } else if(now - this.apNexusNoRealmSince_ >= 20000 &&
                        this.apSwitchToAnotherServer()) {
                     p.setRelativeMovement(0,0,0);
                     return;
                  }
               } else if(realmPortalVisible || portal != null) {
                  this.apNexusNoRealmSince_ = 0;
               }
               var dp:Number = portal != null ?
                       (portal.x_ - p.x_) * (portal.x_ - p.x_) + (portal.y_ - p.y_) * (portal.y_ - p.y_) :
                       Infinity;
               if(portal != null) {
                  // Walk north until portals stream in, then path around Nexus
                  // setpieces/walls to the selected realm portal.
                  this.apPathToward(p,portal,now,false);
                   // This server enters reliably only when the player overlaps
                   // the portal center; do not send USEPORTAL from nearby tiles.
                   if(dp <= 0.25 && now - this.apLastPortal_ > 1500) {
                     this.apLastPortal_ = now;
                     CrashLogger.note("AUTOPILOT: entering portal " + portal.objectId_ +
                             " (" + portal.name_ + ")");
                     this.gsc_.usePortal(portal.objectId_);
                  }
               } else {
                  // Default: march straight north in a line from spawn (camera-
                  // adjusted, no side-to-side sweep that stalls on walls). Portals
                  // stream in as the map scrolls; the block above grabs one once
                  // it's near.
                  this.apMoveToward(p, p.x_, p.y_ - 30);
               }
            } else {
               // Realm/dungeon/quest room: ALWAYS fire (exercises the PlayerShoot
               // → ServerPlayerShoot → ShootAck combat path). Aim at the nearest
               // character enemy and approach it; otherwise sweep the aim and
               // wander so new tiles/objects/enemies stream in. Breakable walls
               // carry <Enemy/> so player shots can damage them, but they remain
               // structural path obstacles rather than navigation targets.
               var enemy:GameObject = this.apNearestEnemy(p);
                var quest:GameObject = this.map.quest_ != null ?
                         this.map.quest_.getObject(0) : null;
                var questId:int = this.map.quest_ != null ? this.map.quest_.objectId_ : -1;
                if(this.apIsStructuralTarget(quest)) {
                   DebugLog.event("autoplay_quest",{
                         "state":"ignored_structural","map":this.mapName,
                         "questId":questId,"type":quest.objectType_,
                         "name":quest.name_,"class":quest.props_.class_});
                   CrashLogger.note("AUTOPILOT QUEST: ignored structural target '" +
                         quest.name_ + "' id=" + questId + " type=0x" +
                         quest.objectType_.toString(16) + " class='" +
                         quest.props_.class_ + "'");
                   quest = null;
                   questId = -1;
                }
                var dungeonMode:Boolean = Parameters.data.autoPlayDungeons &&
                      this.mapName != "Realm of the Mad God";
               var castleMode:Boolean = this.apIsOryxCastle();
               var castleGuardianQuest:Boolean = castleMode &&
                      this.apIsStoneGuardian(quest);
               if(castleGuardianQuest) {
                  this.apCastleGuardianSeen_ = true;
                  this.apCastleGuardianIds_[quest.objectId_] = true;
               }
               var castleChamberPortal:Portal = castleMode ?
                     this.apDungeonProgressionPortal(p) : null;
               if(castleMode) {
                  this.apUpdateCastlePhase(p,quest,castleChamberPortal);
                  if(this.apCastleGuardiansCompleted_ && quest != null &&
                        !this.apIsStoneGuardian(quest)) {
                     // Janus/Court is optional. Once guardian completion is
                     // positively established, keep the main Oryx flow focused
                     // on the persistent Chamber portal.
                     quest = null;
                  }
               }
               if(dungeonMode && quest != null) {
                  this.apDungeonSawQuest_ = true;
               }
               if(questId != this.apLastQuestId_) {
                  var previousQuestId:int = this.apLastQuestId_;
                  // Oryx's Castle removes the final Stone Guardian quest from
                  // QUEST before its object is observed with dead_=true. Treat
                  // that positive -> none transition as completion so Auto Play
                  // advances toward the Chamber instead of selecting trash mobs.
                  if(dungeonMode && !castleMode && this.apDungeonSawQuest_ && previousQuestId > 0 &&
                        questId <= 0) {
                     this.apDungeonQuestCompleted_ = true;
                     DebugLog.event("autoplay_quest",{"state":"cleared","map":this.mapName,
                           "questId":previousQuestId});
                  }
                  this.apLastQuestId_ = questId;
                  DebugLog.event("autoplay_quest",{"state":"selected","map":this.mapName,
                        "questId":questId,"present":quest != null});
                  CrashLogger.note("AUTOPILOT QUEST: selected id=" + questId +
                        " present=" + (quest != null));
               }
               if(quest != null && quest.dead_) {
                  if(!this.apCompletedQuestIds_.hasOwnProperty(quest.objectId_)) {
                     this.apCompletedQuestIds_[quest.objectId_] = true;
                     DebugLog.event("autoplay_quest",{"state":"completed","map":this.mapName,
                           "questId":quest.objectId_,"type":quest.objectType_,"name":quest.name_});
                     CrashLogger.note("AUTOPILOT QUEST: completed '" + quest.name_ +
                           "' id=" + quest.objectId_);
                  }
                  if(dungeonMode && (!castleMode || this.apCastleGuardiansCompleted_)) {
                     this.apDungeonQuestCompleted_ = true;
                  }
                  quest = null;
               }
                var soulboundBag:Container = this.apNearestSoulboundBag(p);
                var progressionPortal:Portal = soulboundBag == null && dungeonMode &&
                      this.apDungeonQuestCompleted_ ?
                      (castleChamberPortal != null ? castleChamberPortal :
                      this.apDungeonProgressionPortal(p)) : null;
                var castleSeekingGuardian:Boolean = castleMode &&
                       !this.apCastleGuardiansCompleted_ && quest == null;
                var moveTarget:GameObject = soulboundBag != null ? soulboundBag :
                       (progressionPortal != null ? progressionPortal :
                       (quest != null ? quest :
                       (dungeonMode && (this.apDungeonQuestCompleted_ ||
                       castleSeekingGuardian) ? null : enemy)));
               if(dungeonMode && (quest != null || enemy != null || soulboundBag != null ||
                     progressionPortal != null || this.map.hostileProjectiles_ != null &&
                     this.map.hostileProjectiles_.length > 0)) {
                  this.apDungeonLastActivityAt_ = now;
               }
               if(dungeonMode && this.apIsFixedOryxFlowMap() &&
                     now - this.apDungeonLastActivityAt_ >= AP_EMPTY_FIXED_INSTANCE_MS &&
                     this.apRecoverEmptyInstance(p,now)) {
                  return;
               }
               var combatTarget:GameObject = enemy;
               if(quest != null && quest.props_ != null && quest.props_.isEnemy_ &&
                     !quest.isInvulnerable && p.getDistSquared(p.x_,p.y_,quest.x_,quest.y_) <= 196) {
                  combatTarget = quest;
               }
               var shootWorld:Number;
               if(combatTarget != null) {
                  shootWorld = Math.atan2(combatTarget.y_ - p.y_, combatTarget.x_ - p.x_);
                  // Exercise the ability path (USEITEM) too: pop the ability at the
                  // enemy every ~4s while engaged. useAltWeapon handles MP/cooldown
                  // checks itself and no-ops without an ability equipped.
                   // attemptAutoAim below already invokes the player's normal
                   // Auto Ability behavior. A second forced use here generated
                   // server "Invalid target!" responses and is intentionally gone.
               } else {
                  shootWorld = now / 400.0;
               }
               var separationEnemy:GameObject = this.apSeparationEnemyId_ >= 0 ?
                      this.map.goDict_[this.apSeparationEnemyId_] as GameObject : null;
               var separationDistance:Number = separationEnemy != null ? Math.sqrt(
                      p.getDistSquared(p.x_,p.y_,separationEnemy.x_,separationEnemy.y_)) : Infinity;
               var separationActive:Boolean = this.apSeparationEnemyId_ >= 0;
               var separationExitRadius:Number = separationEnemy != null ?
                     this.apEnemySeparationRadius(p,separationEnemy,true) :
                     AP_CROWD_SEPARATION_EXIT;
               // A short-lived loot bag must not lose target arbitration to an
               // unrelated minion. Auto Dodge and Auto Nexus remain active while
               // approaching it, and pathfinding still rejects solid tiles.
               if(soulboundBag != null && separationActive) {
                  this.apClearEnemySeparation(now,"loot_priority");
                  separationEnemy = null;
                  separationActive = false;
               }
               var crowdReplacement:GameObject = soulboundBag == null ?
                     this.apNearestCrowdEnemy(p,quest,separationActive) : null;
               if(separationEnemy != null && !separationEnemy.dead_ &&
                     separationEnemy != quest &&
                     separationDistance < separationExitRadius) {
                  this.apSeparationLastThreatAt_ = now;
               }
               if(separationActive && (separationEnemy == null || separationEnemy.dead_ ||
                     separationEnemy == quest || separationDistance >= separationExitRadius)) {
                  if(crowdReplacement != null) {
                     // Continue the same separation episode across a crowd. The
                     // old code emitted exit+enter whenever the nearest minion
                     // changed, reversing movement thousands of times per run.
                     separationEnemy = crowdReplacement;
                     this.apSeparationEnemyId_ = crowdReplacement.objectId_;
                     this.apSeparationEnemyType_ = crowdReplacement.objectType_;
                     separationDistance = Math.sqrt(p.getDistSquared(p.x_,p.y_,
                           crowdReplacement.x_,crowdReplacement.y_));
                     this.apSeparationLastThreatAt_ = now;
                  } else if(now - this.apSeparationStartedAt_ >=
                        AP_CROWD_SEPARATION_MIN_HOLD_MS &&
                        now - this.apSeparationLastThreatAt_ >=
                        AP_CROWD_SEPARATION_RELEASE_MS) {
                      DebugLog.event("autoplay_enemy_separation",{
                            "state":"exit","enemyId":this.apSeparationEnemyId_,
                            "type":this.apSeparationEnemyType_,
                            "distance":separationDistance,
                            "durationMs":now - this.apSeparationStartedAt_});
                     this.apSeparationEnemyId_ = -1;
                     this.apSeparationEnemyType_ = -1;
                     separationEnemy = null;
                     this.apSeparationDirection_ = NaN;
                     this.apSeparationTargetX_ = NaN;
                     this.apSeparationTargetY_ = NaN;
                  } else {
                     // The threat has crossed the exit radius, but retain the
                     // episode briefly at its stand-off point instead of
                     // continuing to push farther away.
                     separationEnemy = null;
                  }
               }
               if(this.apSeparationEnemyId_ < 0 && crowdReplacement != null) {
                  separationEnemy = crowdReplacement;
                  separationDistance = Math.sqrt(p.getDistSquared(p.x_,p.y_,
                        crowdReplacement.x_,crowdReplacement.y_));
                  this.apSeparationEnemyId_ = crowdReplacement.objectId_;
                  this.apSeparationEnemyType_ = crowdReplacement.objectType_;
                  this.apSeparationStartedAt_ = now;
                  this.apSeparationLastThreatAt_ = now;
                  this.apSeparationTargetX_ = NaN;
                  this.apSeparationTargetY_ = NaN;
                  var separationEnterRadius:Number =
                        this.apEnemySeparationRadius(p,crowdReplacement,false);
                  DebugLog.event("autoplay_enemy_separation",{
                         "state":"enter","enemyId":crowdReplacement.objectId_,
                         "type":crowdReplacement.objectType_,"distance":separationDistance,
                         "minimum":separationEnterRadius});
               }
               if(soulboundBag != null) {
                   // Loot has short-lived value. Reach its actual tile so Player's
                   // existing Auto Loot adjacency checks can transfer the items.
                   this.apPathToward(p,soulboundBag,now,false,0.1);
               } else if(separationEnemy != null) {
                  // Quest routes can cross through unrelated minions. The long
                  // Ninja run reached an Insurgent Commander safely, then City
                  // Djinns spawned 71 already-overlapping shots around the
                  // player. A fixed 3.25-tile entry radius avoids that overlap
                  // without inheriting the weapon-range-derived 5+ tile radius
                  // that caused the screenshot oscillation. Keep the route and
                  // stuck history intact while retreating, and use a wider exit
                  // radius as hysteresis so one boundary cannot flip each frame.
                  this.apRetreatFromEnemy(p,separationEnemy);
               } else if(this.apSeparationEnemyId_ >= 0 &&
                     now - this.apSeparationLastThreatAt_ <
                     AP_CROWD_SEPARATION_RELEASE_MS) {
                  // Hold the last reachable stand-off point through brief
                  // target loss instead of immediately resuming the quest path
                  // and crossing the same enter boundary again.
                  this.apHoldSeparationTarget(p);
               } else if(progressionPortal != null) {
                   this.apPathToward(p,progressionPortal,now,false,0.08);
                   var progressionDistance:Number = p.getDistSquared(p.x_,p.y_,
                         progressionPortal.x_,progressionPortal.y_);
                   if(!progressionPortal.lockedPortal_ && progressionDistance <= 0.25 &&
                         now - this.apLastPortal_ > 1500) {
                      this.apLastPortal_ = now;
                      DebugLog.event("autoplay_state",{"state":"dungeon_portal_enter",
                            "map":this.mapName,"portalId":progressionPortal.objectId_,
                            "name":progressionPortal.name_});
                      this.gsc_.usePortal(progressionPortal.objectId_);
                   }
                } else if(quest != null && Parameters.data.autoPlayStopAtVisibleQuest &&
                      !autoPlayOnDamagingGround &&
                      p.getDistSquared(p.x_,p.y_,quest.x_,quest.y_) <=
                      this.apQuestEngageDistance(p) * this.apQuestEngageDistance(p)) {
                   // Continue through the viewport boundary, then stop slightly
                   // inside actual weapon range without standing on the enemy.
                   this.apPath_.length = 0;
                   this.apPathTarget_ = -1;
                   var questDistance:Number = Math.sqrt(
                         p.getDistSquared(p.x_,p.y_,quest.x_,quest.y_));
                   if(questDistance < this.apQuestMinimumDistance(p)) {
                      // Enemies can advance after the route reaches weapon range.
                      // Maintain an annulus instead of merely stopping once: a
                      // stationary hold let quest objects walk directly onto the
                      // player and spawn an unavoidable shotgun at 0.18 tiles.
                      this.apRetreatFromEnemy(p,quest);
                   }
                    // Do not freeze just because the quest marker is in weapon
                    // range. Until Auto Aim has acquired a live target, close the
                    // remaining range or strafe around an invulnerable target.
                    // This keeps pre-fire phases active and prevents a stale
                    // visible-quest hold after the previous enemy dies.
                    if(questDistance >= this.apQuestMinimumDistance(p) &&
                          (quest.isInvulnerable || p.killAuraTarget_ == null)) {
                       this.apMaintainQuestEngagement(p,quest,questDistance);
                    }
                    if(this.apVisibleQuestLogged_ != quest.objectId_) {
                      this.apVisibleQuestLogged_ = quest.objectId_;
                      // Cancel the previous route exactly once. Subsequent frames
                      // do not write movement, leaving Auto Dodge's vector intact.
                      if(!p.autoDodgeOverrideActive && !quest.isInvulnerable &&
                            p.killAuraTarget_ != null &&
                            questDistance >= this.apQuestMinimumDistance(p)) {
                         p.setRelativeMovement(0,0,0);
                      }
                      DebugLog.event("autoplay_quest",{"state":"visible_hold",
                            "questId":quest.objectId_,"distance":questDistance});
                   }
                 } else if(moveTarget != null) {
                    var combatStop:Number = moveTarget is Container || moveTarget is Portal ? -1 :
                          this.apQuestEngageDistance(p);
                    var castleRoutePoint:Point = castleGuardianQuest ?
                          this.apCastleRouteWaypoint(p) : null;
                    this.apPathToward(p,moveTarget,now,quest != null,combatStop,
                          castleRoutePoint);
                } else if(dungeonMode) {
                   this.apExploreDungeon(p,now);
                } else {
                   if(!p.autoDodgeOverrideActive) {
                      var wa:Number = now / 2500.0;
                      p.setRelativeMovement(0, Math.cos(wa), Math.sin(wa));
                   }
                }
               // DC-bisect experiment hooks: AP_NOSHOOT disables firing entirely;
               // AP_SLOWSHOOT halves the fire rate (attack only every 800ms).
               if(!this.apNoShoot_ &&
                  (!this.apSlowShoot_ || now - this.apLastShot_ >= 800)) {
                  this.apLastShot_ = now;
                  // Use the normal AutoAim entry point so aimMode, target lead,
                  // boss priority and exception filters behave exactly as they do
                  // outside Auto Play. Auto Play only ensures AAOn is enabled.
                  p.attemptAutoAim(shootWorld - Number(Parameters.data.cameraAngle));
               }
            }
         } catch(e:Error) {
            CrashLogger.log("GameSprite.autoPilot", e);
         }
      }

      // Move toward (tx,ty), but STOP dead once inside `stopDist` tiles. Without
      // the deadzone the autopilot re-issued a full-speed step toward the target
      // every frame (up to 144x/sec), overshooting by a hair and correcting back
      // the next frame — which reads as the player vibrating in place. Holding a
      // zero move vector when we've arrived keeps it perfectly still.
      private function apMoveToward(p:Player, tx:Number, ty:Number, stopDist:Number = 0.6) : void {
         // Blanket movement-priority enforcement: while Auto Dodge is steering,
         // Auto Play writes NO intent (a zero vector, so the dodge plans against
         // "standing" instead of a stale strategic tug), and it stays quiet for
         // a short yield window afterward so replanning starts from wherever
         // the dodge put us. Individual callers checking autoDodgeOverrideActive
         // remain; this catches every caller that did not.
         var yieldNow:int = getTimer();
         if(p.autoDodgeOverrideActive) {
            this.apDodgeYieldUntil_ = yieldNow + AP_DODGE_YIELD_MS;
            p.setRelativeMovement(0,0,0);
            return;
         }
         if(yieldNow < this.apDodgeYieldUntil_) {
            p.setRelativeMovement(0,0,0);
            return;
         }
         var dx:Number = tx - p.x_;
         var dy:Number = ty - p.y_;
         if(dx * dx + dy * dy <= stopDist * stopDist) {
            p.setRelativeMovement(0, 0, 0);
            return;
         }
         var wa:Number = Math.atan2(dy, dx);
         var ra:Number = wa - Number(Parameters.data.cameraAngle);
         p.setRelativeMovement(0, Math.cos(ra), Math.sin(ra));
      }

      /** After a dodge override, the queued path may lead back to a position
       * the dodge deliberately left. Drop it once displacement exceeds the
       * threshold so the next build starts from where the dodge put us. */
      private function apReplanIfDisplaced(p:Player) : void {
         if(this.apPath_.length == 0) {
            return;
         }
         var head:Point = this.apPath_[0];
         var dx:Number = head.x - p.x_;
         var dy:Number = head.y - p.y_;
         if(dx * dx + dy * dy > AP_DODGE_DISPLACED_SQ) {
            this.apPath_.length = 0;
            this.apPathTarget_ = -1;
            this.apLastPathBuild_ = 0;
            this.apDungeonExploreAt_ = 0;
         }
      }

      private function apQuestEngageDistance(p:Player) : Number {
         // Player.range is derived from the equipped weapon's projectile
         // speed/lifetime and capped at 16. Keep a little range reserve for
         // target motion while enforcing a safe minimum stand-off distance.
         var weaponRange:Number = p.range > 0 ? p.range : 4;
         return Math.max(4.0,weaponRange - 0.8);
      }

      private function apQuestMinimumDistance(p:Player) : Number {
         return Math.max(3.25,this.apQuestEngageDistance(p) * 0.65);
      }

      private function apMaintainQuestEngagement(p:Player, quest:GameObject,
                                                  distance:Number) : void {
         if(p.autoDodgeOverrideActive || quest == null) {
            return;
         }
         var minimum:Number = this.apQuestMinimumDistance(p);
         if(distance > minimum + 0.35) {
            this.apMoveToward(p,quest.x_,quest.y_,minimum);
            return;
         }
         var liveMap:Map = this.map as Map;
         if(liveMap == null) {
            return;
         }
         // Boss circling removed entirely (user directive 2026-07-24): the
         // tangential orbit routinely walked into unsafe positions the dodge
         // then had to rescue. Once in range, stand and shoot everywhere —
         // Auto Dodge owns all evasive movement, and Proactive Spacing may
         // still drift us gently off a wall so a volley is entered with
         // escape room (no-op in open arenas).
         if(p.dodgeSpacingDirection(liveMap,this.apSpacingDir_)) {
            var spaceAngle:Number = Math.atan2(this.apSpacingDir_.y,
                  this.apSpacingDir_.x);
            var spaceRel:Number = spaceAngle - Number(Parameters.data.cameraAngle);
            p.setRelativeMovement(0,Math.cos(spaceRel) * AP_SPACING_SPEED,
                  Math.sin(spaceRel) * AP_SPACING_SPEED);
         } else {
            p.setRelativeMovement(0,0,0);
         }
      }

      private function apClearEnemySeparation(now:int, reason:String) : void {
         if(this.apSeparationEnemyId_ >= 0) {
            DebugLog.event("autoplay_enemy_separation",{
                  "state":"exit","enemyId":this.apSeparationEnemyId_,
                  "type":this.apSeparationEnemyType_,
                  "distance":null,"durationMs":Math.max(0,
                        now - this.apSeparationStartedAt_),"reason":reason});
         }
         this.apSeparationEnemyId_ = -1;
         this.apSeparationEnemyType_ = -1;
         this.apSeparationDirection_ = NaN;
         this.apSeparationTargetX_ = NaN;
         this.apSeparationTargetY_ = NaN;
      }

      private function apRetreatFromEnemy(p:Player, enemy:GameObject) : void {
         if(p.autoDodgeOverrideActive) {
            return;
         }
         var liveMap:Map = this.map as Map;
         if(liveMap == null) {
            return;
         }
         var now:int = getTimer();
         if(!isNaN(this.apSeparationTargetX_) &&
               now - this.apSeparationTargetAt_ <
               AP_SEPARATION_TARGET_REPLAN_MS &&
               liveMap.canOccupyForDodge(this.apSeparationTargetX_,
               this.apSeparationTargetY_,true)) {
            this.apHoldSeparationTarget(p);
            return;
         }
         var repulsionX:Number = 0;
         var repulsionY:Number = 0;
         var crowdCount:int = 0;
         this.apNearbyCrowd_.length = 0;
         for each(var crowdEnemy:GameObject in liveMap.vulnEnemyDict_) {
            if(crowdEnemy == null || crowdEnemy.dead_ || !(crowdEnemy is Character)) {
               continue;
            }
            var crowdDx:Number = p.x_ - crowdEnemy.x_;
            var crowdDy:Number = p.y_ - crowdEnemy.y_;
            var crowdDistanceSq:Number = crowdDx * crowdDx + crowdDy * crowdDy;
            var crowdRadius:Number = this.apEnemySeparationRadius(p,crowdEnemy,true);
            if(crowdDistanceSq > crowdRadius * crowdRadius ||
                  crowdDistanceSq < 0.0001) {
               continue;
            }
            var crowdDistance:Number = Math.sqrt(crowdDistanceSq);
            var crowdWeight:Number = 1 / Math.max(0.25,crowdDistanceSq);
            repulsionX += crowdDx / crowdDistance * crowdWeight;
            repulsionY += crowdDy / crowdDistance * crowdWeight;
            this.apNearbyCrowd_.push(crowdEnemy);
            crowdCount++;
         }
         var away:Number = crowdCount > 0 &&
               repulsionX * repulsionX + repulsionY * repulsionY > 0.000001 ?
               Math.atan2(repulsionY,repulsionX) :
               Math.atan2(p.y_ - enemy.y_,p.x_ - enemy.x_);
         var bestAngle:Number = Number.NaN;
         var bestScore:Number = -1;
         // Search around the direct retreat vector so a wall or hazardous tile
         // cannot turn the stand-off correction into another stuck loop.
         for(var offsetStep:int = 0; offsetStep < 16; offsetStep++) {
            var signedStep:int = offsetStep == 0 ? 0 :
                  ((offsetStep & 1) == 1 ? (offsetStep + 1) / 2 : -offsetStep / 2);
            var angle:Number = away + signedStep * Math.PI / 16;
            var testX:Number = p.x_ + Math.cos(angle) * 0.8;
            var testY:Number = p.y_ + Math.sin(angle) * 0.8;
            if(!liveMap.canOccupyForDodge(testX,testY,true) ||
                  !this.apCanTraverse(liveMap,p.x_,p.y_,testX,testY)) {
               continue;
            }
            var dx:Number = testX - enemy.x_;
            var dy:Number = testY - enemy.y_;
            // Maximise clearance from the whole nearby crowd. Retreating from
            // only the nearest enemy could step directly toward its neighbour.
            var distance:Number = dx * dx + dy * dy;
            for each(var nearby:GameObject in this.apNearbyCrowd_) {
               var nearbyX:Number = testX - nearby.x_;
               var nearbyY:Number = testY - nearby.y_;
               var nearbyDistance:Number = nearbyX * nearbyX + nearbyY * nearbyY;
               if(nearbyDistance < distance) {
                  distance = nearbyDistance;
               }
            }
            var stableBonus:Number = isNaN(this.apSeparationDirection_) ? 0 :
                  0.2 * (1 + Math.cos(angle - this.apSeparationDirection_));
            var score:Number = distance + stableBonus;
            if(score > bestScore) {
               bestScore = score;
               bestAngle = angle;
            }
         }
         if(isNaN(bestAngle)) {
            p.setRelativeMovement(0,0,0);
            return;
         }
         this.apSeparationDirection_ = bestAngle;
         // Commit to the tested short point. Re-issuing an unbounded retreat
         // vector every frame crossed the exit radius, released separation,
         // then immediately walked back toward the quest 300ms later.
         this.apSeparationTargetX_ = p.x_ + Math.cos(bestAngle) * 0.8;
         this.apSeparationTargetY_ = p.y_ + Math.sin(bestAngle) * 0.8;
         this.apSeparationTargetAt_ = now;
         this.apHoldSeparationTarget(p);
      }

      private function apHoldSeparationTarget(p:Player) : void {
         if(p.autoDodgeOverrideActive || isNaN(this.apSeparationTargetX_) ||
               isNaN(this.apSeparationTargetY_)) {
            return;
         }
         var liveMap:Map = this.map as Map;
         if(liveMap == null || !this.apCanTraverse(liveMap,p.x_,p.y_,
               this.apSeparationTargetX_,this.apSeparationTargetY_)) {
            this.apSeparationTargetX_ = NaN;
            this.apSeparationTargetY_ = NaN;
            p.setRelativeMovement(0,0,0);
            return;
         }
         this.apMoveToward(p,this.apSeparationTargetX_,
               this.apSeparationTargetY_,0.12);
      }

      private function apNearestCrowdEnemy(p:Player, quest:GameObject,
                                           exiting:Boolean) : GameObject {
         var now:int = getTimer();
         var questId:int = quest != null ? quest.objectId_ : -1;
         var radius:Number = exiting ? AP_CLOSE_SHOT_SEPARATION_EXIT :
               AP_CLOSE_SHOT_SEPARATION_ENTER;
         if(this.apCachedCrowdQuestId_ == questId &&
               this.apCachedCrowdRadius_ == radius &&
               now - this.apLastCrowdScanAt_ < AP_TARGET_SCAN_INTERVAL_MS) {
            if(this.apCachedCrowdEnemyId_ < 0) {
               return null;
            }
            var cached:GameObject = this.map.goDict_[this.apCachedCrowdEnemyId_] as GameObject;
            if(cached != null && !cached.dead_ && cached != quest &&
                  cached is Character) {
               var cachedDx:Number = cached.x_ - p.x_;
               var cachedDy:Number = cached.y_ - p.y_;
               var cachedRadius:Number = this.apEnemySeparationRadius(p,cached,exiting);
               if(cachedDx * cachedDx + cachedDy * cachedDy < cachedRadius * cachedRadius) {
                  return cached;
               }
            }
         }
         var best:GameObject = null;
         var bestDistance:Number = radius * radius;
         for each(var object:GameObject in this.map.vulnEnemyDict_) {
            if(object == null || object.dead_ || object == quest || !(object is Character)) {
               continue;
            }
            var dx:Number = object.x_ - p.x_;
            var dy:Number = object.y_ - p.y_;
            var distance:Number = dx * dx + dy * dy;
            var objectRadius:Number = this.apEnemySeparationRadius(p,object,exiting);
            if(distance < objectRadius * objectRadius && distance < bestDistance) {
               bestDistance = distance;
               best = object;
            }
         }
         this.apLastCrowdScanAt_ = now;
         this.apCachedCrowdEnemyId_ = best != null ? best.objectId_ : -1;
         this.apCachedCrowdQuestId_ = questId;
         this.apCachedCrowdRadius_ = radius;
         return best;
      }

      /** Insurgent Rebel Brawlers were observed spawning a radial shot while
       * already 0.72-1.09 tiles from the player, leaving at most 143ms warning.
       * Begin separating before that chase can collapse. Other enemies retain
       * the tighter default so Auto Play does not become globally conservative. */
      private function apEnemySeparationRadius(p:Player, enemy:GameObject,
                                                exiting:Boolean) : Number {
         if(enemy != null && enemy.objectType_ == 0x4266) {
            return exiting ? AP_CLOSE_SHOT_SEPARATION_EXIT :
                   AP_CLOSE_SHOT_SEPARATION_ENTER;
         }
         var base:Number = exiting ? AP_CROWD_SEPARATION_EXIT :
               AP_CROWD_SEPARATION_ENTER;
         if(Parameters.data.autoPlaySmartSpacing) {
            var smart:Number = this.apShooterSeparationRadius(enemy);
            // Never stand further off than we can shoot from, or Auto Play would
            // back away from a boss it can no longer damage and stall the fight.
            // Leave a margin inside our own weapon range for the exit ring too.
            if(smart > 0 && p != null && p.range > 0) {
               var reach:Number = p.range - AP_SMART_SEPARATION_BAND - 0.5;
               if(reach < AP_SMART_SEPARATION_MIN) {
                  reach = AP_SMART_SEPARATION_MIN;
               }
               if(smart > reach) {
                  smart = reach;
               }
            }
            if(smart > 0) {
               base = exiting ? smart + AP_SMART_SEPARATION_BAND : smart;
            }
         }
         var effectiveSpeed:Number = p != null ? p.msPerTileDebug() :
               AP_SEPARATION_BASE_SPEED;
         var speedReserve:Number = Math.max(0,effectiveSpeed -
               AP_SEPARATION_BASE_SPEED) * AP_SEPARATION_RESERVE_MS;
         return base + Math.min(AP_SEPARATION_MAX_RESERVE,speedReserve);
      }

      // objectType -> stand-off radius in tiles (0 = melee/contact, use default).
      private const apShooterRadiusCache_:Dictionary = new Dictionary();

      /**
       * Stand-off distance that guarantees `autoDodgeReactionLeadMs` of warning
       * against this enemy's FASTEST projectile: radius = speed * reactionLead.
       * `ProjectileProperties.speed` is tiles/ms (XML Speed / 10000), so the
       * product is already in tiles. Returns 0 for enemies with no projectiles
       * (pure melee/contact) so they keep the tight default ring.
       */
      private function apShooterSeparationRadius(enemy:GameObject) : Number {
         if(enemy == null || enemy.props_ == null || !enemy.props_.isEnemy_) {
            return 0;
         }
         var type:int = enemy.objectType_;
         var cached:* = this.apShooterRadiusCache_[type];
         if(cached !== undefined) {
            return Number(cached);
         }
         var radius:Number = 0;
         var props:ObjectProperties = ObjectLibrary.propsLibrary_[type];
         // projectiles_ is a Dictionary keyed by projectile id, not a Vector.
         var shots:Dictionary = props != null ? props.projectiles_ : null;
         if(shots != null) {
            var fastest:Number = 0;
            for each(var pp:ProjectileProperties in shots) {
               if(pp != null && pp.speed > fastest) {
                  fastest = pp.speed;
               }
            }
            if(fastest > 0) {
               var lead:Number = Number(Parameters.data.autoDodgeReactionLeadMs);
               if(!(lead > 0)) {
                  lead = 400;
               }
               radius = fastest * lead;
               if(radius < AP_SMART_SEPARATION_MIN) {
                  radius = AP_SMART_SEPARATION_MIN;
               } else if(radius > AP_SMART_SEPARATION_MAX) {
                  radius = AP_SMART_SEPARATION_MAX;
               }
            }
         }
         this.apShooterRadiusCache_[type] = radius;
         return radius;
      }

      private function apIsOryxCastle() : Boolean {
         return this.mapName != null &&
               this.mapName.toLowerCase().indexOf("oryx's castle") != -1;
      }

      /** The static maps where the player group is the default navigation
       * target (user directive 2026-07-22): the layout never changes and the
       * crowd already knows the route. Oryx's Chamber is excluded -- it is a
       * single room where quest engagement handles positioning. */
      private function apIsGroupFollowMap() : Boolean {
         if(this.mapName == null) {
            return false;
         }
         var lower:String = this.mapName.toLowerCase();
         return lower.indexOf("oryx's castle") != -1 ||
               lower.indexOf("wine cellar") != -1 ||
               lower.indexOf("oryx's sanctuary") != -1;
      }

      /** Beacon tier for the level bracket: 20 -> Veteran, 11-19 -> Adept,
       * otherwise Rookie. Matches the tier word in the beacon's DisplayId. */
      private function apBeaconTierWord(p:Player) : String {
         if(p.level_ >= 20) {
            return "Veteran";
         }
         return p.level_ > 10 ? "Adept" : "Rookie";
      }

      /** Teleport to a random realm waypoint beacon of the level-appropriate
       * tier (beacons teleport exactly like players: TELEPORT with objectId).
       * Falls back to any beacon when no tier match exists. Returns true when
       * a TELEPORT was actually sent. */
      private function apTeleportToBeacon(p:Player, now:int, reason:String) : Boolean {
         if(this.mapName != "Realm of the Mad God" || p == null ||
               !this.map.allowPlayerTeleport() || p.msUtilTeleport() > 0 ||
               now - this.apLastStuckTeleportAt_ < Player.MS_BETWEEN_TELEPORT) {
            return false;
         }
         var liveMap:Map = this.map as Map;
         if(liveMap == null) {
            return false;
         }
         var tier:String = this.apBeaconTierWord(p);
         var tierMatches:Vector.<GameObject> = new Vector.<GameObject>();
         var anyBeacon:Vector.<GameObject> = new Vector.<GameObject>();
         for each(var beacon:GameObject in liveMap.goDict_) {
            if(beacon == null || beacon.dead_ || beacon.props_ == null ||
                  beacon.props_.minimapIconColor_ == -1) {
               continue;
            }
            anyBeacon.push(beacon);
            var displayId:String = String(ObjectLibrary.typeToDisplayId_[beacon.objectType_]);
            if(displayId != null && displayId.indexOf(tier) != -1) {
               tierMatches.push(beacon);
            }
         }
         var pool:Vector.<GameObject> = tierMatches.length > 0 ? tierMatches : anyBeacon;
         if(pool.length == 0) {
            return false;
         }
         var pick:GameObject = pool[int(Math.random() * pool.length)];
         this.apLastStuckTeleportAt_ = now;
         this.apPath_.length = 0;
         this.apPathTarget_ = -1;
         this.apLastPathBuild_ = 0;
         this.apProgressX_ = NaN;
         p.setRelativeMovement(0,0,0);
         this.gsc_.teleport(pick.objectId_);
         DebugLog.event("autoplay_state",{"state":"beacon_teleport",
               "reason":reason,"tier":tier,"tierMatched":tierMatches.length > 0,
               "beaconType":pick.objectType_,"x":pick.x_,"y":pick.y_,
               "candidates":pool.length});
         CrashLogger.note("AUTOPILOT: beacon teleport (" + reason + ", " + tier +
               ") -> type " + pick.objectType_ + " at (" + int(pick.x_) + "," +
               int(pick.y_) + ")");
         return true;
      }

      private function apIsFixedOryxFlowMap() : Boolean {
         if(this.mapName == null) {
            return false;
         }
         var lower:String = this.mapName.toLowerCase();
         return lower.indexOf("oryx's castle") != -1 ||
               lower.indexOf("oryx's chamber") != -1 ||
               lower.indexOf("wine cellar") != -1 ||
               lower.indexOf("oryx's sanctuary") != -1;
      }

      /** A fixed Oryx instance with no quest, enemies, hostile projectiles,
       * loot, or progression portal for ninety seconds cannot make progress.
       * Restart the normal Nexus loop instead of wandering forever in a stale
       * or already-completed instance. */
      private function apRecoverEmptyInstance(p:Player, now:int) : Boolean {
         if(!Parameters.data.autoPlayNexusRecovery || Parameters.reconNexus == null ||
               now - this.apLastNexusRecovery_ < 10000) {
            return false;
         }
         this.apLastNexusRecovery_ = now;
         this.apPath_.length = 0;
         this.apPathTarget_ = -1;
         p.setRelativeMovement(0,0,0);
         DebugLog.event("autoplay_state",{
               "state":"empty_instance_recovery","map":this.mapName,
               "idleMs":now - this.apDungeonLastActivityAt_,
               "x":p.x_,"y":p.y_});
         CrashLogger.note("AUTOPILOT: fixed instance remained empty for " +
               (now - this.apDungeonLastActivityAt_) + "ms; reconnecting to Nexus");
         this.dispatchEvent(Parameters.reconNexus);
         return true;
      }

      private function apIsStoneGuardian(object:GameObject) : Boolean {
         if(object == null) {
            return false;
         }
         // Include the normal and event-reskinned guardian pairs. The name check
         // is retained for future variants whose object types are not yet known.
         if(object.objectType_ == 0x0D78 || object.objectType_ == 0x0D79 ||
               object.objectType_ == 0xB536 || object.objectType_ == 0xB537 ||
               object.objectType_ == 0x1FDA || object.objectType_ == 0x1FDB) {
            return true;
         }
         var id:String = object.props_ != null ? object.props_.id_ : object.name_;
         if(id == null) {
            return false;
         }
         id = id.toLowerCase();
         return id.indexOf("stone guardian") != -1 &&
               id.indexOf("support") == -1 && id.indexOf("sword") == -1;
      }

      /** QUEST can point at breakable map geometry because the server flags it
       * Enemy so shots may damage it. It must not become an Auto Play movement,
       * combat, completion or teleport-recovery target. */
      private function apIsStructuralTarget(object:GameObject) : Boolean {
         if(object == null || object.props_ == null || object is Character) {
            return false;
         }
         var className:String = object.props_.class_ == null ? "" :
               object.props_.class_.toLowerCase();
         var id:String = object.props_.id_ == null ? "" :
               object.props_.id_.toLowerCase();
         return className.indexOf("wall") != -1 || id.indexOf("wall") != -1 ||
               object.props_.fullOccupy_ || object.props_.occupySquare_ ||
               object.props_.static_;
      }

      private function apIsJanus(object:GameObject) : Boolean {
         if(object == null) {
            return false;
         }
         var id:String = object.props_ != null ? object.props_.id_ : object.name_;
         return id != null && id.toLowerCase().indexOf("janus") != -1;
      }

      /** Advance the fixed Castle state only from positive evidence. QUEST can
       * temporarily lose its object while streaming, so disappearance alone is
       * never completion. Chamber visibility is definitive; otherwise require
       * both guardian objects to have been observed and gone near their room, or
       * Janus after the macro route has reached that room. */
      private function apUpdateCastlePhase(p:Player, quest:GameObject,
                                            chamber:Portal) : void {
         if(this.apCastleGuardiansCompleted_) {
            return;
         }
         var liveGuardians:int = 0;
         this.apRefreshObjectCaches();
         for each(var object:GameObject in this.apCachedCharacters_) {
            if(this.map.goDict_[object.objectId_] != object) {
               continue;
            }
            if(!this.apIsStoneGuardian(object)) {
               continue;
            }
            this.apCastleGuardianIds_[object.objectId_] = true;
            this.apCastleGuardianSeen_ = true;
            if(!object.dead_) {
               liveGuardians++;
            }
         }
         var seenGuardians:int = 0;
         for(var guardianId:String in this.apCastleGuardianIds_) {
            seenGuardians++;
         }
         var roomDx:Number = p.x_ - 128.5;
         var roomDy:Number = p.y_ - 60.5;
         var nearGuardianRoom:Boolean = roomDx * roomDx + roomDy * roomDy <= 35 * 35;
         var routeNearEnd:Boolean = this.apCastleRouteIndex_ >=
               Math.max(0,this.apCastleRouteLength() - 1);
         if(chamber != null) {
            this.apCompleteCastleGuardians("chamber_visible",quest,chamber,seenGuardians);
         } else if(seenGuardians >= 2 && liveGuardians == 0 && nearGuardianRoom) {
            this.apCompleteCastleGuardians("guardians_removed",quest,null,seenGuardians);
         } else if(this.apIsJanus(quest) && nearGuardianRoom && routeNearEnd) {
            this.apCompleteCastleGuardians("janus_after_route",quest,null,seenGuardians);
         }
      }

      private function apCompleteCastleGuardians(reason:String, quest:GameObject,
                                                  chamber:Portal,
                                                  seenGuardians:int) : void {
         this.apCastleGuardiansCompleted_ = true;
         this.apDungeonQuestCompleted_ = true;
         this.apPath_.length = 0;
         this.apPathTarget_ = -1;
         this.apLastPathBuild_ = 0;
         this.apBlocked_ = new Dictionary();
         this.apWallEscapeTarget_ = -1;
         this.apWallEscapeUntil_ = 0;
         this.apLastWallEscapeFrom_ = -1;
         this.apLastWallEscapeTo_ = -1;
         this.apWallEscapeReverseCount_ = 0;
         DebugLog.event("autoplay_castle",{
               "state":"guardians_complete","reason":reason,
               "seenGuardians":seenGuardians,
               "nextQuestId":quest != null ? quest.objectId_ : -1,
               "nextType":quest != null ? quest.objectType_ : -1,
               "chamberId":chamber != null ? chamber.objectId_ : -1});
      }

      private function apCastleRouteLength() : int {
         if(this.apCastleLowerSpawn_) {
            return this.apCastleRouteSide_ < 0 ?
                  AP_CASTLE_LEFT_ROUTE.length : AP_CASTLE_RIGHT_ROUTE.length;
         }
         return this.apCastleRouteSide_ < 0 ?
               AP_CASTLE_LEFT_SIDE_ROUTE.length : AP_CASTLE_RIGHT_SIDE_ROUTE.length;
      }

      /** Return the next macro waypoint for the fixed Castle route. The index is
       * monotonic, but can fast-forward when the user takes over or a server
       * correction places us farther along the corridor. */
      private function apCastleRouteWaypoint(p:Player) : Point {
         if(!this.apIsOryxCastle()) {
            return null;
         }
         if(this.apCastleRouteSide_ == 0) {
            this.apCastleRouteSide_ = p.x_ < 128 ? -1 : 1;
            this.apCastleLowerSpawn_ = p.y_ > 200;
         }
         var route:Vector.<Point>;
         if(this.apCastleLowerSpawn_) {
            route = this.apCastleRouteSide_ < 0 ?
                  AP_CASTLE_LEFT_ROUTE : AP_CASTLE_RIGHT_ROUTE;
         } else {
            route = this.apCastleRouteSide_ < 0 ?
                  AP_CASTLE_LEFT_SIDE_ROUTE : AP_CASTLE_RIGHT_SIDE_ROUTE;
         }
         if(this.apCastleRouteIndex_ >= route.length) {
            return null;
         }
         // If manual movement or a GOTO already placed the player near a later
         // waypoint, never walk backward to replay earlier Castle segments.
         var closestIndex:int = this.apCastleRouteIndex_;
         var closestDistance:Number = Infinity;
         for(var index:int = this.apCastleRouteIndex_; index < route.length; index++) {
            var candidate:Point = route[index];
            var candidateDx:Number = candidate.x - p.x_;
            var candidateDy:Number = candidate.y - p.y_;
            var candidateDistance:Number = candidateDx * candidateDx + candidateDy * candidateDy;
            if(candidateDistance < closestDistance) {
               closestDistance = candidateDistance;
               closestIndex = index;
            }
         }
         // A 20-tile geometric shortcut can cross a sealed room on this map.
         // Only adopt a later waypoint when we are genuinely already on it.
         if(closestIndex > this.apCastleRouteIndex_ && closestDistance <= 36) {
            this.apCastleRouteIndex_ = closestIndex;
         }
         while(this.apCastleRouteIndex_ < route.length) {
            var waypoint:Point = route[this.apCastleRouteIndex_];
            var dx:Number = waypoint.x - p.x_;
            var dy:Number = waypoint.y - p.y_;
            if(dx * dx + dy * dy > 16) {
               return waypoint;
            }
            this.apCastleRouteIndex_++;
            this.apPath_.length = 0;
            this.apPathTarget_ = -1;
            DebugLog.event("autoplay_castle",{
                  "state":"waypoint_reached","side":this.apCastleRouteSide_,
                  "lowerSpawn":this.apCastleLowerSpawn_,
                  "index":this.apCastleRouteIndex_,"x":p.x_,"y":p.y_});
         }
         return null;
      }

      /** Follow the player group through a fixed Oryx flow map. Other players
       * are the best available pathfinding oracle in these static maps: the
       * crowd already knows the route, and in Wine Cellar / Oryx's Sanctuary
       * stacking with the group is the intended strategy, so the group is the
       * DEFAULT navigation target there, not a fallback. The Castle keeps its
       * ahead-of-us filter so a returning straggler cannot walk us backward
       * through the corridor. Only an exact BFS path to the chosen leader is
       * accepted; frontier guesses would recreate the same opposite-side
       * oscillation this logic exists to prevent. */
      private function apGroupFollowPath(p:Player) : Vector.<Point> {
         var empty:Vector.<Point> = new Vector.<Point>();
         if(p == null || !this.apIsGroupFollowMap()) {
            return empty;
         }
         this.apRefreshObjectCaches();
         var castle:Boolean = this.apIsOryxCastle();
         var finalX:Number = 128.5;
         var finalY:Number = 60.5;
         var selfFinalDistance:Number = 0;
         if(castle) {
            var selfFinalDx:Number = p.x_ - finalX;
            var selfFinalDy:Number = p.y_ - finalY;
            selfFinalDistance = Math.sqrt(selfFinalDx * selfFinalDx +
                  selfFinalDy * selfFinalDy);
         }
         var best:Player = null;
         var second:Player = null;
         var third:Player = null;
         var bestScore:Number = Infinity;
         var secondScore:Number = Infinity;
         var thirdScore:Number = Infinity;
         for each(var candidate:Player in this.apCachedPlayers_) {
            if(candidate == null || candidate == p || candidate.dead_ ||
                  this.map.goDict_[candidate.objectId_] != candidate) {
               continue;
            }
            var playerDx:Number = candidate.x_ - p.x_;
            var playerDy:Number = candidate.y_ - p.y_;
            var playerDistance:Number = Math.sqrt(playerDx * playerDx +
                  playerDy * playerDy);
            if(playerDistance < 2 || playerDistance > 60) {
               continue;
            }
            var score:Number;
            if(castle) {
               var finalDx:Number = candidate.x_ - finalX;
               var finalDy:Number = candidate.y_ - finalY;
               var finalDistance:Number = Math.sqrt(finalDx * finalDx +
                     finalDy * finalDy);
               if(finalDistance + 5 >= selfFinalDistance) {
                  continue;
               }
               score = playerDistance + finalDistance * 0.25;
            } else {
               // Wine Cellar / Sanctuary: prefer the crowd over the nearest
               // solo runner. A player with many neighbours is standing where
               // the group decided to stand; that is where we want to be.
               var neighbours:int = 0;
               for each(var other:Player in this.apCachedPlayers_) {
                  if(other == null || other == candidate || other == p ||
                        other.dead_) {
                     continue;
                  }
                  var neighbourDx:Number = other.x_ - candidate.x_;
                  var neighbourDy:Number = other.y_ - candidate.y_;
                  if(neighbourDx * neighbourDx + neighbourDy * neighbourDy <= 36) {
                     neighbours++;
                  }
               }
               score = playerDistance - neighbours * 8;
            }
            // Keep following the same reachable runner while they remain ahead.
            // Switching to whichever nearby player happened to score best on
            // every rebuild made the route bounce between opposite corridors.
            if(candidate.objectId_ == this.apCastleFollowPlayerId_) {
               score -= 1000;
            }
            if(score < bestScore) {
               third = second;
               thirdScore = secondScore;
               second = best;
               secondScore = bestScore;
               best = candidate;
               bestScore = score;
            } else if(score < secondScore) {
               third = second;
               thirdScore = secondScore;
               second = candidate;
               secondScore = score;
            } else if(score < thirdScore) {
               third = candidate;
               thirdScore = score;
            }
         }
         var leaders:Vector.<Player> = new <Player>[best,second,third];
         for each(var leader:Player in leaders) {
            if(leader == null) {
               continue;
            }
            var path:Vector.<Point> = this.apBuildPath(int(p.x_),int(p.y_),
                  int(leader.x_),int(leader.y_),false);
            if(!apPathReachesGoal(path,int(leader.x_),int(leader.y_))) {
               continue;
            }
            this.apCastleFollowPlayerId_ = leader.objectId_;
            this.apCastleFollowPlayerX_ = leader.x_;
            this.apCastleFollowPlayerY_ = leader.y_;
            return path;
         }
         this.apCastleFollowPlayerId_ = -1;
         return empty;
      }

      private static function apPathReachesGoal(path:Vector.<Point>,
                                                goalX:int, goalY:int) : Boolean {
         if(path == null || path.length == 0) {
            return false;
         }
         var end:Point = path[path.length - 1];
         return Math.abs(int(end.x) - goalX) +
               Math.abs(int(end.y) - goalY) <= 1;
      }

      /** One bounded object-dictionary pass supplies every Auto Play subsystem.
       * Realm maps retain thousands of static objects; portal, bag, player and
       * Castle scans previously walked that complete dictionary independently. */
      private function apRefreshObjectCaches() : void {
         var now:int = getTimer();
         if(now - this.apObjectCacheAt_ < AP_OBJECT_CACHE_INTERVAL_MS) {
            return;
         }
         this.apObjectCacheAt_ = now;
         this.apCachedPortals_.length = 0;
         this.apCachedContainers_.length = 0;
         this.apCachedPlayers_.length = 0;
         this.apCachedCharacters_.length = 0;
         if(this.map == null || this.map.goDict_ == null) {
            return;
         }
         for each(var object:GameObject in this.map.goDict_) {
            if(object is Portal) {
               this.apCachedPortals_.push(object as Portal);
            }
            if(object is Container) {
               this.apCachedContainers_.push(object as Container);
            }
            if(object is Player) {
               this.apCachedPlayers_.push(object as Player);
            }
            if(object is Character) {
               this.apCachedCharacters_.push(object as Character);
            }
         }
      }

      /** Select the post-boss exit. Oryx transitions are preferred by name;
       * ordinary dungeons fall back to their nearest available exit portal. */
      private function apDungeonProgressionPortal(p:Player) : Portal {
         var best:Portal = null;
         var bestScore:Number = Infinity;
         var mapLower:String = this.mapName == null ? "" : this.mapName.toLowerCase();
         var castle:Boolean = mapLower.indexOf("oryx's castle") != -1;
         var chamber:Boolean = mapLower.indexOf("oryx's chamber") != -1;
         this.apRefreshObjectCaches();
         for each(var portal:Portal in this.apCachedPortals_) {
            if(portal == null || this.map.goDict_[portal.objectId_] != portal) {
               continue;
            }
            var name:String = portal.name_ == null ? "" : portal.name_.toLowerCase();
            if(castle) {
               // Court is Janus's optional side-dungeon. It previously tied with
               // the Chamber because both names contain "oryx", then won by
               // distance while the persistent Chamber portal was off-screen.
               // Castle Auto Play advances only through the Oryx Chamber types.
               if(portal.objectType_ != 0x0D7B && portal.objectType_ != 0x0634 &&
                     name.indexOf("oryx's chamber") == -1) {
                  continue;
               }
            } else if(chamber && name.indexOf("wine cellar") == -1) {
               // Court/other event portals can coexist with the post-Oryx exit.
               // The main unattended flow must advance to Wine Cellar only.
               continue;
            } else if(mapLower.indexOf("wine cellar") != -1 &&
                  name.indexOf("sanctuary") == -1) {
               // Wine Cellar's Nexus exit is present from map entry, but the
               // Oryx's Sanctuary portal only spawns after Oryx 2 dies. Taking
               // the always-present Nexus portal skipped Sanctuary entirely
               // (2026-07-22 log). Wait for the Sanctuary portal instead, the
               // same way the Castle waits for the Chamber portal.
               continue;
            }
            var priority:Number = 50;
            if(castle || chamber) {
               priority = 0;
            } else if(mapLower.indexOf("wine cellar") != -1 &&
                  name.indexOf("sanctuary") != -1) {
               priority = 0;
            } else if(name.indexOf("nexus") == -1 && name.indexOf("realm") == -1) {
               priority = 10;
            }
            var dx:Number = portal.x_ - p.x_;
            var dy:Number = portal.y_ - p.y_;
            var score:Number = priority * 100000 + dx * dx + dy * dy;
            if(score < bestScore) {
               bestScore = score;
               best = portal;
            }
         }
         return best;
      }

      /** Explore a procedural dungeon toward a reachable streamed frontier.
       * This is deliberately conservative: combat/quest targets interrupt it,
       * and it never treats an unknown or damaging square as traversable. */
      private function apExploreDungeon(p:Player, now:int) : void {
         if(p.autoDodgeOverrideActive) {
            // Dodging is useful movement, but it must not count as failed route
            // progress or consume the Castle recovery budget.
            this.apExploreProgressAt_ = now;
            this.apDodgeYieldUntil_ = now + AP_DODGE_YIELD_MS;
            this.apReplanIfDisplaced(p);
            return;
         }
         if(this.apPathTarget_ != -100000) {
            this.apPath_.length = 0;
            this.apPathTarget_ = -100000;
            this.apDungeonExploreAt_ = 0;
         }
         var groupFollowMap:Boolean = this.apIsGroupFollowMap();
         // Following a MOVING group needs a fresh leader position: refresh
         // every 2s in the fixed Oryx maps instead of coasting on an 8s-old
         // path while the crowd moves on.
         if((this.apPath_.length == 0 && now - this.apDungeonExploreAt_ >= 1000) ||
               now - this.apDungeonExploreAt_ >= (groupFollowMap ? 2000 : 8000)) {
            var lowerMapName:String = this.mapName == null ? "" : this.mapName.toLowerCase();
            var goalX:int;
            var goalY:int;
            // The player group is the DEFAULT navigation target in the fixed
            // Oryx maps (user directive): the layout is static and the crowd
            // knows the route. The macro route / spiral is only for playing
            // the map alone.
            var groupPath:Vector.<Point> = groupFollowMap ?
                  this.apGroupFollowPath(p) : null;
            var exploreMode:String;
            if(groupPath != null && groupPath.length > 0) {
               var groupGoal:Point = groupPath[groupPath.length - 1];
               goalX = int(groupGoal.x);
               goalY = int(groupGoal.y);
               exploreMode = "group_follow";
            } else if(lowerMapName.indexOf("oryx's castle") != -1) {
               // Follow the appropriate mirrored corridor while the guardian is
               // outside the streamed region. Once the macro route is complete,
               // stay in the guardian room so the persistent Chamber portal can
               // stream in; never continue north into Janus/Court.
               var castleWaypoint:Point = this.apCastleRouteWaypoint(p);
               goalX = castleWaypoint != null ? int(castleWaypoint.x) : 128;
               goalY = castleWaypoint != null ? int(castleWaypoint.y) : 60;
               exploreMode = "castle_route";
            } else {
               this.apDungeonExploreHeading_ += 2.399963229728653;
               goalX = int(p.x_ + Math.cos(this.apDungeonExploreHeading_) * 80);
               goalY = int(p.y_ + Math.sin(this.apDungeonExploreHeading_) * 80);
               exploreMode = "spiral";
            }
            if(goalX != this.apExploreGoalX_ || goalY != this.apExploreGoalY_) {
               this.apExploreGoalX_ = goalX;
               this.apExploreGoalY_ = goalY;
               this.apExploreBestDistance_ = p.getDistSquared(p.x_,p.y_,goalX,goalY);
               this.apExploreProgressAt_ = now;
               this.apExploreStallCount_ = 0;
               this.apStuckCount_ = 0;
               this.apWallEscapeDirectionX_ = 0;
               this.apWallEscapeDirectionY_ = 0;
            }
            if(groupPath != null && groupPath.length > 0) {
               this.apPath_ = groupPath;
            } else {
               this.apPath_ = this.apBuildPath(int(p.x_),int(p.y_),goalX,goalY,
                     !this.apIsOryxCastle());
            }
            this.apDungeonExploreAt_ = now;
            DebugLog.event("autoplay_state",{"state":"dungeon_explore",
                  "map":this.mapName,"path":this.apPath_.length,
                  "mode":exploreMode,
                  "leaderId":this.apCastleFollowPlayerId_,
                  "goalX":goalX,"goalY":goalY,"sawQuest":this.apDungeonSawQuest_});
         }
         var remaining:Number = p.getDistSquared(p.x_,p.y_,
               this.apExploreGoalX_,this.apExploreGoalY_);
         var remainingLinear:Number = Math.sqrt(remaining);
         var bestLinear:Number = Math.sqrt(this.apExploreBestDistance_);
         if(remainingLinear + AP_PATH_MIN_PROGRESS < bestLinear) {
            this.apExploreBestDistance_ = remaining;
            this.apExploreProgressAt_ = now;
            this.apExploreStallCount_ = 0;
            this.apStuckCount_ = 0;
         } else if(now - this.apExploreProgressAt_ > AP_PATH_PROGRESS_TIMEOUT_MS) {
            this.apExploreProgressAt_ = now;
            this.apExploreStallCount_++;
            this.apStuckCount_ = Math.max(this.apStuckCount_,this.apExploreStallCount_);
            var rejected:int = Math.min(this.apPath_.length,
                  this.apExploreStallCount_ >= 2 ? 3 : 1);
            if(!this.apIsOryxCastle()) {
               for(var rejectIndex:int = 0; rejectIndex < rejected; rejectIndex++) {
                  this.apBlocked_[int(this.apPath_[rejectIndex].x) +
                        int(this.apPath_[rejectIndex].y) * this.map.mapWidth] = true;
               }
            }
            this.apPath_.length = 0;
            this.apDungeonExploreAt_ = 0;
            DebugLog.event("autoplay_state",{
                  "state":"dungeon_explore_stalled","map":this.mapName,
                  "stalls":this.apExploreStallCount_,"goalX":this.apExploreGoalX_,
                  "goalY":this.apExploreGoalY_,"x":p.x_,"y":p.y_});
            if(this.apIsOryxCastle()) {
               this.apBlocked_ = new Dictionary();
               // Waiting alone never recovers when the current macro waypoint
               // is unreachable — every one of the 52 explore stalls in the
               // 07-22..24 logs was in this map, standing still. After three
               // consecutive timeouts, skip to the next waypoint: the route is
               // monotonic along one corridor, so the next point continues the
               // same track rather than shortcutting a sealed room.
               if(this.apExploreStallCount_ >= 3 &&
                     this.apCastleRouteIndex_ < this.apCastleRouteLength()) {
                  this.apCastleRouteIndex_++;
                  this.apExploreStallCount_ = 0;
                  this.apPath_.length = 0;
                  this.apPathTarget_ = -1;
                  DebugLog.event("autoplay_castle",{
                        "state":"waypoint_skipped_stall",
                        "index":this.apCastleRouteIndex_,"x":p.x_,"y":p.y_});
               } else if(now - this.apCastleWaitLogAt_ >= 5000) {
                  this.apCastleWaitLogAt_ = now;
                  DebugLog.event("autoplay_castle",{
                        "state":"explore_route_wait",
                        "index":this.apCastleRouteIndex_,
                        "stalls":this.apExploreStallCount_,"x":p.x_,"y":p.y_});
               }
            }
            p.setRelativeMovement(0,0,0);
            return;
         }
         while(this.apPath_.length > 0) {
            var waypoint:Point = this.apPath_[0];
            var dx:Number = waypoint.x - p.x_;
            var dy:Number = waypoint.y - p.y_;
            if(dx * dx + dy * dy > 0.20) {
               if(!this.apCanTraverse(this.map as Map,p.x_,p.y_,waypoint.x,waypoint.y)) {
                  this.apBlocked_[int(waypoint.x) + int(waypoint.y) * this.map.mapWidth] = true;
                  this.apPath_.length = 0;
                  p.setRelativeMovement(0,0,0);
                  return;
               }
               this.apMoveToward(p,waypoint.x,waypoint.y,0.35);
               return;
            }
            this.apPath_.shift();
         }
         p.setRelativeMovement(0,0,0);
      }

      // Follow an obstacle-aware path across the portion of the map the server
      // has streamed to us. Paths are rebuilt periodically as new tiles arrive
      // or the moving quest/enemy changes.
      private function apPathToward(p:Player, target:GameObject, now:int,
                                     isQuest:Boolean, stopDistance:Number = -1,
                                     routePoint:Point = null) : void {
         // Player.update has already selected this frame's dodge vector. Auto
         // Play runs afterward, so writing a path vector here would overwrite it
         // and make the two controllers fight. Pause route/stuck accounting until
         // the dodge controller releases movement, then resume from wherever the
         // dodge put us (yield window + displacement replan) instead of tugging
         // straight back toward the pre-dodge waypoint.
         if(p.autoDodgeOverrideActive) {
            this.apProgressX_ = p.x_;
            this.apProgressY_ = p.y_;
            this.apProgressAt_ = now;
            this.apDodgeYieldUntil_ = now + AP_DODGE_YIELD_MS;
            this.apReplanIfDisplaced(p);
            return;
         }
         var routeKey:int = routePoint != null ?
               -200000 - this.apCastleRouteIndex_ : target.objectId_;
         var castleStaticRoute:Boolean = routePoint != null &&
               this.apIsOryxCastle();
         var targetX:Number = routePoint != null ? routePoint.x : target.x_;
         var targetY:Number = routePoint != null ? routePoint.y : target.y_;
         var changed:Boolean = routeKey != this.apPathTarget_;
         if(changed || isNaN(this.apProgressX_)) {
            this.apProgressX_ = p.x_;
            this.apProgressY_ = p.y_;
            this.apProgressAt_ = now;
            this.apEscapeUntil_ = 0;
            this.apBestTargetDistance_ = p.getDistSquared(p.x_,p.y_,targetX,targetY);
            this.apStuckCount_ = 0;
            this.apWallEscapeTarget_ = -1;
            this.apWallEscapeUntil_ = 0;
            this.apWallEscapeDirectionX_ = 0;
            this.apWallEscapeDirectionY_ = 0;
         }
         var targetDistance:Number = p.getDistSquared(p.x_,p.y_,targetX,targetY);
         var earlyStop:Number = routePoint != null ? 1.5 : stopDistance >= 0 ? stopDistance :
               (target is Portal ? 0.08 : 2.5);
         // Stop before consuming the remaining BFS waypoints. Previously the
         // distance check lived after the path loop, so a valid route always
         // walked all the way onto the enemy tile before the stand-off logic ran.
         var pathMap:Map = this.map as Map;
         var onDamagingGround:Boolean = pathMap != null &&
               pathMap.isDamagingGround(p.x_,p.y_);
         if(!(target is Portal) && !onDamagingGround &&
               targetDistance <= earlyStop * earlyStop) {
            this.apPath_.length = 0;
            this.apPathTarget_ = -1;
            this.apWallEscapeTarget_ = -1;
            this.apWallEscapeUntil_ = 0;
            p.setRelativeMovement(0,0,0);
            return;
         }
         // Net displacement is not progress: the old test was continually reset
         // by two-tile wall oscillations. Require a meaningful reduction in the
         // remaining target distance instead.
         var targetDistanceLinear:Number = Math.sqrt(targetDistance);
         var bestTargetDistanceLinear:Number = Math.sqrt(this.apBestTargetDistance_);
         if(targetDistanceLinear + AP_PATH_MIN_PROGRESS < bestTargetDistanceLinear) {
            this.apBestTargetDistance_ = targetDistance;
            this.apProgressX_ = p.x_;
            this.apProgressY_ = p.y_;
            this.apProgressAt_ = now;
            this.apStuckCount_ = 0;
            this.apWallEscapeDirectionX_ = 0;
            this.apWallEscapeDirectionY_ = 0;
         }
         if(now - this.apProgressAt_ > AP_PATH_PROGRESS_TIMEOUT_MS) {
            this.apStuckCount_++;
            this.apEscapeSign_ = -this.apEscapeSign_;
            // Replan around rejected waypoints immediately. The former 2.5s
            // perpendicular blind walk was itself pushing against wall edges.
            this.apEscapeUntil_ = 0;
            this.apProgressAt_ = now;
            this.apProgressX_ = p.x_;
            this.apProgressY_ = p.y_;
            var stuckWaypoint:String = this.apPath_.length > 0 ?
                    this.apPath_[0].x.toFixed(1) + "," + this.apPath_[0].y.toFixed(1) : "none";
            if(this.apPath_.length > 0 && !castleStaticRoute) {
               // Remember more of a repeatedly failed route so the next BFS
               // cannot immediately choose the same wall-facing corridor.
               var rejectCount:int = Math.min(this.apPath_.length,
                     this.apStuckCount_ >= 2 ? 3 : 1);
               for(var rejectIndex:int = 0; rejectIndex < rejectCount; rejectIndex++) {
                  this.apBlocked_[int(this.apPath_[rejectIndex].x) +
                        int(this.apPath_[rejectIndex].y) * this.map.mapWidth] = true;
               }
            }
            this.apPath_.length = 0;
            this.apLastPathBuild_ = 0;
            this.apWallEscapeTarget_ = -1;
            this.apWallEscapeUntil_ = 0;
            CrashLogger.note((castleStaticRoute ?
                  "AUTOPILOT CASTLE WAIT: pos=(" : "AUTOPILOT STUCK: pos=(") +
                  p.x_.toFixed(2) + "," + p.y_.toFixed(2) + ") waypoint=" +
                  stuckWaypoint + (castleStaticRoute ?
                  "; retaining fixed route and checking group" :
                  "; rejecting route and replanning"));
            if(castleStaticRoute) {
               // The Castle has temporary destructible barriers. Do not poison
               // a known route, teleport, nexus, or invoke generic wall escape
               // merely because the group has not opened this segment yet.
               this.apBlocked_ = new Dictionary();
               // ...but this wait MUST be bounded. It used to return
               // unconditionally forever: the 2026-07-25 logs show three
               // episodes frozen at a byte-identical position for 42.1s, 21.0s
               // and 14.0s (77s total = 21% of the time spent in the Castle),
               // each logging "waypoint=none" while standing still. When the
               // waypoint never opens, give up on this route index and let the
               // next one (or generic explore) take over — the explore branch
               // already does exactly this via apExploreStallCount_.
               if(this.apStuckCount_ >= AP_CASTLE_ROUTE_WAIT_GIVEUP) {
                  this.apStuckCount_ = 0;
                  this.apCastleRouteIndex_++;
                  this.apPath_.length = 0;
                  this.apPathTarget_ = -1;
                  DebugLog.event("autoplay_castle",{
                        "state":"route_wait_giveup",
                        "index":this.apCastleRouteIndex_,
                        "x":p.x_,"y":p.y_});
                  CrashLogger.note("AUTOPILOT CASTLE: route wait exceeded at (" +
                        p.x_.toFixed(1) + "," + p.y_.toFixed(1) +
                        "); advancing to route index " + this.apCastleRouteIndex_);
                  return;
               }
               if(now - this.apCastleWaitLogAt_ >= 5000) {
                  this.apCastleWaitLogAt_ = now;
                  DebugLog.event("autoplay_castle",{
                        "state":"route_wait","index":this.apCastleRouteIndex_,
                        "stuckCount":this.apStuckCount_,
                        "x":p.x_,"y":p.y_});
               }
               p.setRelativeMovement(0,0,0);
               return;
            }
            if(isQuest) {
               this.apTryQuestTeleportRecovery(p,target,now);
            }
            return;
         }
         // A wall escape is a committed maneuver. Rebuilding it every second
         // made the selected endpoint alternate across the player, producing
         // the exact east/west oscillation it was meant to resolve.
         var committedWallEscape:Boolean = !changed &&
               this.apWallEscapeTarget_ == routeKey &&
               now < this.apWallEscapeUntil_ && this.apPath_.length > 0;
         if(changed || !committedWallEscape && now - this.apLastPathBuild_ >= 1000) {
            this.apPathTarget_ = routeKey;
            this.apLastPathBuild_ = now;
            this.apPath_ = this.apBuildPath(int(p.x_), int(p.y_),
                    int(targetX), int(targetY),!castleStaticRoute);
            if(castleStaticRoute &&
                  !apPathReachesGoal(this.apPath_,int(targetX),int(targetY))) {
               var waitGroupPath:Vector.<Point> = this.apGroupFollowPath(p);
               if(waitGroupPath.length > 0) {
                  this.apPath_ = waitGroupPath;
                  this.apLastBuildWasWallEscape_ = false;
                  DebugLog.event("autoplay_castle",{
                        "state":"group_follow","index":this.apCastleRouteIndex_,
                        "playerId":this.apCastleFollowPlayerId_,
                        "playerX":this.apCastleFollowPlayerX_,
                        "playerY":this.apCastleFollowPlayerY_,
                        "path":this.apPath_.length});
               }
            }
            if(this.apLastBuildWasWallEscape_) {
               this.apWallEscapeTarget_ = routeKey;
               this.apWallEscapeUntil_ = now + 6000;
            } else {
               this.apWallEscapeTarget_ = -1;
               this.apWallEscapeUntil_ = 0;
            }
            if(changed) {
                if(routePoint != null) {
                   DebugLog.event("autoplay_castle",{
                         "state":"waypoint_target","side":this.apCastleRouteSide_,
                         "index":this.apCastleRouteIndex_,
                         "goalX":targetX,"goalY":targetY,
                         "path":this.apPath_.length});
                }
                var targetKind:String = isQuest ? "quest" :
                        (target is Portal ? "portal" :
                        (target is Container ? "loot" : "enemy"));
                var targetLabel:String = target.name_ != null && target.name_ != "" ?
                      target.name_ : target.props_ != null ? target.props_.id_ : "";
                var targetClass:String = target.props_ != null ? target.props_.class_ : "";
                CrashLogger.note("AUTOPILOT TARGET: " + targetKind +
                        " '" + targetLabel + "' id=" + target.objectId_ + " type=0x" +
                        target.objectType_.toString(16) + " path=" + this.apPath_.length +
                        " class='" + targetClass + "' pos=(" + int(target.x_) + "," +
                        int(target.y_) + ")");
            } else if(this.apPath_.length == 0 && now - this.apLastPathNote_ > 5000) {
               this.apLastPathNote_ = now;
               CrashLogger.note("AUTOPILOT PATH: no route yet to id=" +
                       target.objectId_ + "; exploring/retrying at (" + int(p.x_) +
                       "," + int(p.y_) + ")");
            }
         }
         while(this.apPath_.length > 0) {
            var wp:Point = this.apPath_[0];
            var dx:Number = wp.x - p.x_;
            var dy:Number = wp.y - p.y_;
            if(dx * dx + dy * dy > 0.20) {
               if(!this.apCanTraverse(this.map as Map,p.x_,p.y_,wp.x,wp.y)) {
                  if(!castleStaticRoute) {
                     this.apBlocked_[int(wp.x) + int(wp.y) * this.map.mapWidth] = true;
                     this.apLastPathBuild_ = 0;
                  }
                   this.apPath_.length = 0;
                   this.apWallEscapeTarget_ = -1;
                   this.apWallEscapeUntil_ = 0;
                  p.setRelativeMovement(0,0,0);
                  return;
               }
               this.apMoveToward(p, wp.x, wp.y, 0.35);
               return;
            }
            this.apPath_.shift();
         }
         this.apWallEscapeTarget_ = -1;
         this.apWallEscapeUntil_ = 0;
         // The target may sit on an occupied tile, or its intervening tiles may
         // not be streamed yet. Direct steering keeps exploration progressing;
         // the next 750ms rebuild will use newly available squares.
           var finalStop:Number = earlyStop;
          if(!onDamagingGround && targetDistance <= finalStop * finalStop) {
             p.setRelativeMovement(0,0,0);
             return;
          }
           // Portal squares report occupied/non-walkable but must deliberately
           // be entered. This is the sole exception to the wall guard.
           if(target is Portal && routePoint == null) {
              this.apMoveToward(p,targetX,targetY,finalStop);
              return;
           }
           // Never fall back to blindly steering through a wall. This was the
          // source of the same-tile back-and-forth loops after a route emptied.
           var directAngle:Number = Math.atan2(targetY - p.y_,targetX - p.x_);
          var directX:int = int(p.x_ + Math.cos(directAngle) * 0.8);
          var directY:int = int(p.y_ + Math.sin(directAngle) * 0.8);
          var directMap:Map = this.map as Map;
          var directSquare:Square = directMap != null ?
                directMap.lookupSquare(directX,directY) : null;
          if(directSquare != null && directSquare.isWalkable() &&
                directMap.canOccupyForDodge(directX + 0.5,directY + 0.5,true) &&
                this.apCanTraverse(directMap,p.x_,p.y_,directX + 0.5,directY + 0.5)) {
              this.apMoveToward(p,targetX,targetY,finalStop);
          } else {
             p.setRelativeMovement(0,0,0);
          }
      }

      /** Last-resort recovery for a sealed room or disconnected walkable
       * island. Three independent five-second quest stalls without meaningful
       * quest progress can send a teleport. The local-region counter remains a
       * second route to recovery, but a wall escape that oscillates more than
       * 24 tiles can no longer reset the evidence forever. Normal wall steering,
       * one failed route, portal navigation and loot collection never qualify. */
      private function apTryQuestTeleportRecovery(p:Player, quest:GameObject,
                                                    now:int) : void {
         if(p == null || quest == null || this.isSafeMap || quest.dead_) {
            return;
         }
         var regionDx:Number = p.x_ - this.apStuckRegionX_;
         var regionDy:Number = p.y_ - this.apStuckRegionY_;
         // A 24-tile radius is large enough to cover the logged four-wall
         // structure (where the player oscillated over ~20 tiles), while real
         // travel to another area starts a fresh recovery episode.
         if(isNaN(this.apStuckRegionX_) ||
               regionDx * regionDx + regionDy * regionDy > 576) {
            this.apStuckRegionX_ = p.x_;
            this.apStuckRegionY_ = p.y_;
            this.apStuckRegionHits_ = 1;
         } else {
            this.apStuckRegionHits_++;
         }
         this.apStuckRegionLastAt_ = now;
         DebugLog.event("autoplay_stuck_recovery",{
               "state":"observed","hits":this.apStuckRegionHits_,
               "questId":quest.objectId_,"x":p.x_,"y":p.y_,
               "anchorX":this.apStuckRegionX_,"anchorY":this.apStuckRegionY_});
         // apStuckCount_ resets whenever target distance genuinely improves.
         // In this session committed wall escapes crossed a long structure for
         // over a minute but alternated between its two sides; every 24-tile
         // crossing reset apStuckRegionHits_ to one. Three no-progress intervals
         // are sufficient proof even when the character itself is moving.
         if(this.apStuckRegionHits_ < 3 && this.apStuckCount_ < 3) {
            return;
         }
         if(!this.map.allowPlayerTeleport()) {
            // Oryx's Castle explicitly disables player teleport. The old recovery
            // logged two successful-looking teleports, but the server ignored
            // both and the character remained in the same wall loop.
            DebugLog.event("autoplay_stuck_recovery",{
                  "state":"map_disallows_teleport","questId":quest.objectId_,
                  "map":this.mapName,"x":p.x_,"y":p.y_});
            this.apStuckRegionHits_ = 2;
            return;
         }
         var teleportWait:int = p.msUtilTeleport();
         if(teleportWait > 0 || now - this.apLastStuckTeleportAt_ < Player.MS_BETWEEN_TELEPORT) {
            DebugLog.event("autoplay_stuck_recovery",{
                  "state":"teleport_cooldown","questId":quest.objectId_,
                  "serverWaitMs":teleportWait,
                  "localWaitMs":Math.max(0,Player.MS_BETWEEN_TELEPORT -
                        (now - this.apLastStuckTeleportAt_))});
            // Keep the episode armed, but require another full stall interval
            // after the cooldown instead of polling the server every frame.
            this.apStuckRegionHits_ = 2;
            return;
         }
         var best:Player = null;
         var bestQuestDistance:Number = Infinity;
         var failedX:Number = isNaN(this.apStuckRegionX_) ? p.x_ :
               this.apStuckRegionX_;
         var failedY:Number = isNaN(this.apStuckRegionY_) ? p.y_ :
               this.apStuckRegionY_;
         this.apRefreshObjectCaches();
         for each(var candidate:Player in this.apCachedPlayers_) {
            if(candidate == null || candidate == p ||
                  this.map.goDict_[candidate.objectId_] != candidate ||
                  !p.isTeleportEligible(candidate)) {
               continue;
            }
            // A player almost on top of us is probably trapped in the same
            // structure and would not provide a useful recovery destination.
            var playerDx:Number = candidate.x_ - p.x_;
            var playerDy:Number = candidate.y_ - p.y_;
            if(playerDx * playerDx + playerDy * playerDy < 16) {
               continue;
            }
            var failedDx:Number = candidate.x_ - failedX;
            var failedDy:Number = candidate.y_ - failedY;
            if(failedDx * failedDx + failedDy * failedDy <=
                  AP_FAILED_ROUTE_RADIUS * AP_FAILED_ROUTE_RADIUS) {
               continue;
            }
            var questDx:Number = candidate.x_ - quest.x_;
            var questDy:Number = candidate.y_ - quest.y_;
            var questDistance:Number = questDx * questDx + questDy * questDy;
            if(questDistance < bestQuestDistance) {
               bestQuestDistance = questDistance;
               best = candidate;
            }
         }
         if(best == null) {
            // No eligible player to escape to — realm waypoint beacons are the
            // second recovery anchor (user directive): reset to a random
            // level-appropriate beacon instead of staying stuck.
            if(this.apTeleportToBeacon(p,now,"stuck_recovery")) {
               this.apRememberFailedRouteRegion(failedX,failedY,
                     AP_FAILED_ROUTE_RADIUS);
               this.apStuckRegionHits_ = 0;
               this.apStuckRegionX_ = NaN;
               this.apStuckRegionY_ = NaN;
               return;
            }
            DebugLog.event("autoplay_stuck_recovery",{
                  "state":"no_eligible_player","questId":quest.objectId_,
                  "x":p.x_,"y":p.y_});
            this.apStuckRegionHits_ = 2;
            return;
         }
         this.apRememberFailedRouteRegion(failedX,failedY,
               AP_FAILED_ROUTE_RADIUS);
         this.apLastStuckTeleportAt_ = now;
         this.apStuckRegionHits_ = 0;
         this.apStuckRegionX_ = NaN;
         this.apStuckRegionY_ = NaN;
         this.apPath_.length = 0;
         this.apPathTarget_ = -1;
         this.apLastPathBuild_ = 0;
         this.apProgressX_ = NaN;
         p.setRelativeMovement(0,0,0);
         DebugLog.event("autoplay_stuck_recovery",{
               "state":"teleport","questId":quest.objectId_,
               "playerId":best.objectId_,"playerName":best.name_,
               "playerX":best.x_,"playerY":best.y_,
               "questDistance":Math.sqrt(bestQuestDistance)});
         CrashLogger.note("AUTOPILOT RECOVERY: repeatedly stuck; teleporting to " +
               "player '" + best.name_ + "' id=" + best.objectId_ +
               " closest to quest id=" + quest.objectId_);
         this.gsc_.teleport(best.objectId_);
      }

      /** Keep a compact map-lifetime exclusion around a region that required
       * teleport recovery. Individual failed waypoints were insufficient: once
       * the player teleported, a fresh BFS routed through the same structure. */
      private function apRememberFailedRouteRegion(x:Number, y:Number,
                                                    radius:Number) : void {
         for(var index:int = 0; index < this.apFailedRouteX_.length; index++) {
            var dx:Number = x - this.apFailedRouteX_[index];
            var dy:Number = y - this.apFailedRouteY_[index];
            var mergeRadius:Number = Math.max(radius,
                  this.apFailedRouteRadius_[index]);
            if(dx * dx + dy * dy <= mergeRadius * mergeRadius) {
               this.apFailedRouteRadius_[index] = mergeRadius;
               return;
            }
         }
         this.apFailedRouteX_.push(x);
         this.apFailedRouteY_.push(y);
         this.apFailedRouteRadius_.push(radius);
         DebugLog.event("autoplay_stuck_recovery",{
               "state":"region_excluded","x":x,"y":y,
               "radius":radius,"regions":this.apFailedRouteX_.length,
               "map":this.mapName});
      }

      private function apIsFailedRouteRegion(x:Number, y:Number) : Boolean {
         for(var index:int = 0; index < this.apFailedRouteX_.length; index++) {
            var dx:Number = x - this.apFailedRouteX_[index];
            var dy:Number = y - this.apFailedRouteY_[index];
            var radius:Number = this.apFailedRouteRadius_[index];
            if(dx * dx + dy * dy <= radius * radius) {
               return true;
            }
         }
         return false;
      }

      private function apNearestSoulboundBag(p:Player) : Container {
         if(!Parameters.data.AutoLootOn || !Parameters.data.autoPlayCollectSoulbound) {
            this.apBagHoldId_ = -1;
            this.apBagHoldLocationKey_ = null;
            this.apCachedBagId_ = -1;
            this.apBagApproachId_ = -1;
            this.apBagApproachStarted_ = 0;
            this.apBagApproachBestDistance_ = Infinity;
            this.apBagLastProgressAt_ = 0;
            return null;
         }
         var scanNow:int = getTimer();
         // Do not infer that a bag caused unrelated server-authoritative damage.
         // Safe Walk, Auto Dodge, and Auto Nexus already own movement safety;
         // cancelling collection here made ordinary combat discard distant and
         // even in-flight loot transactions.
         if(this.apBagHoldId_ != -1) {
            var heldBag:Container = this.map.goDict_[this.apBagHoldId_] as Container;
            var heldMs:int = scanNow - this.apBagHoldStarted_;
            var swapPending:Boolean = heldBag != null && this.gsc_ != null &&
                  this.gsc_.isAutoLootSwapPendingFor(heldBag.objectId_);
            if(heldBag == null || heldBag.dead_) {
               this.apServicedBagIds_[this.apBagHoldId_] = true;
               if(this.apBagHoldLocationKey_ != null) {
                  this.apServicedBagLocations_[this.apBagHoldLocationKey_] =
                        scanNow + AP_BAG_LOCATION_COOLDOWN_MS;
               }
               this.apCachedBagId_ = -1;
               this.apBagHoldId_ = -1;
               this.apBagHoldStarted_ = 0;
               this.apBagHoldLocationKey_ = null;
            } else if(heldMs < AP_BAG_MIN_HOLD_MS ||
                  heldMs < AP_BAG_MAX_HOLD_MS &&
                  (swapPending || p.hasAutoLootCandidate(heldBag))) {
                // Keep the player on the bag for a complete Auto Loot cycle even
                // if the first swap updates it immediately. An outstanding
                // INVRESULT retains the hold only inside the same hard five-
                // second service budget; a lost result cannot pin movement.
                return heldBag;
            } else {
               var desiredLootRemaining:Boolean = p.hasDesiredAutoLootItem(heldBag);
               var abandoned:Boolean = desiredLootRemaining || swapPending;
               var blockReason:String = swapPending ? "transaction_timeout" :
                     (desiredLootRemaining ? p.autoLootBlockReason(heldBag) : "complete");
               // One approach/hold is one service attempt. The former three-
               // second retry made Auto Play leave its route, run back to the
               // same full/unlootable bag, and repeat until despawn. Mark this
               // object id complete even when desired loot remains; newly
               // spawned bags have new ids and are still collected normally.
               this.apServicedBagIds_[this.apBagHoldId_] = true;
               if(this.apBagHoldLocationKey_ != null) {
                  this.apServicedBagLocations_[this.apBagHoldLocationKey_] =
                        scanNow + AP_BAG_LOCATION_COOLDOWN_MS;
               }
               this.apPath_.length = 0;
               this.apPathTarget_ = -1;
               DebugLog.event(abandoned ? "autoplay_bag_abandoned" :
                     "autoplay_bag_serviced",{
                     "bagId":this.apBagHoldId_,"heldMs":heldMs,
                     "reason":blockReason,
                     "map":this.mapName});
               this.apBagHoldId_ = -1;
               this.apBagHoldStarted_ = 0;
               this.apBagHoldLocationKey_ = null;
               this.apCachedBagId_ = -1;
            }
         }
         if(scanNow - this.apLastBagScanAt_ < AP_BAG_SCAN_INTERVAL_MS) {
            if(this.apCachedBagId_ < 0) {
               return null;
            }
            var cachedBag:Container = this.map.goDict_[this.apCachedBagId_] as Container;
            if(this.apIsEligibleSoulboundBag(cachedBag,scanNow)) {
               return cachedBag;
            }
         }
         var best:Container = null;
         var bestD:Number = Infinity;
         var bestTier:int = -1;
         var blueCount:int = 0;
         var interactiveCount:int = 0;
         var itemCount:int = 0;
         this.apRefreshObjectCaches();
         for each(var bag:Container in this.apCachedContainers_) {
            if(bag == null || bag.dead_ || !bag.isLoot_ || bag.fakeBag_ || bag.equipment_ == null ||
                  this.map.goDict_[bag.objectId_] != bag ||
                  !this.apIsBlueOrBetterBag(bag) || this.apServicedBagIds_[bag.objectId_]) {
               continue;
            }
            var bagLocationKey:String = this.apBagLocationKey(bag);
            var locationRetryAfter:int = int(
                  this.apServicedBagLocations_[bagLocationKey]);
            if(locationRetryAfter > scanNow) {
               continue;
            }
            if(locationRetryAfter > 0) {
               delete this.apServicedBagLocations_[bagLocationKey];
            }
            blueCount++;
            var hasItem:Boolean = false;
            for each(var itemType:int in bag.equipment_) {
               if(itemType > 0) {
                  hasItem = true;
                  break;
               }
            }
            // Container.setOwnerId already turns isInteractive_ off for another
            // account. ownerId_ is frequently empty on this server even for our
            // soulbound bags, so requiring a non-empty owner discarded all loot.
            if(hasItem) {
               itemCount++;
            }
            if(!hasItem || !bag.isInteractive_) {
               continue;
            }
            interactiveCount++;
            var d:Number = p.getDistSquared(p.x_,p.y_,bag.x_,bag.y_);
            if(d > AP_BAG_MAX_DISTANCE_SQ) {
               continue;   // too far to reach before it despawns
            }
            var bagTier:int = this.apSoulboundBagTier(bag);
            if(bagTier > bestTier || bagTier == bestTier && d < bestD) {
               bestD = d;
               best = bag;
               bestTier = bagTier;
            }
         }
         this.apLastBagScanAt_ = scanNow;
         if(best == null) {
            this.apBagApproachId_ = -1;
            this.apBagApproachStarted_ = 0;
            this.apBagApproachBestDistance_ = Infinity;
            this.apBagLastProgressAt_ = 0;
         } else if(this.apBagApproachId_ != best.objectId_) {
            this.apBagApproachId_ = best.objectId_;
            this.apBagApproachStarted_ = scanNow;
            this.apBagApproachBestDistance_ = Math.sqrt(bestD);
            this.apBagLastProgressAt_ = scanNow;
         } else {
            var bestDistance:Number = Math.sqrt(bestD);
            if(bestDistance <= this.apBagApproachBestDistance_ -
                  AP_BAG_PROGRESS_DISTANCE) {
               this.apBagApproachBestDistance_ = bestDistance;
               this.apBagLastProgressAt_ = scanNow;
            }
         }
         if(best != null && scanNow - this.apBagLastProgressAt_ >=
               AP_BAG_STALL_TIMEOUT_MS) {
            this.apServicedBagIds_[best.objectId_] = true;
            this.apServicedBagLocations_[this.apBagLocationKey(best)] =
                  scanNow + AP_BAG_LOCATION_COOLDOWN_MS;
            DebugLog.event("autoplay_bag_abandoned",{
                  "bagId":best.objectId_,"reason":"approach_stalled",
                  "distance":Math.sqrt(bestD),"bestDistance":
                        this.apBagApproachBestDistance_,"map":this.mapName});
            if(this.apPathTarget_ == best.objectId_) {
               this.apPath_.length = 0;
               this.apPathTarget_ = -1;
               this.apLastPathBuild_ = 0;
            }
            best = null;
            this.apBagApproachId_ = -1;
            this.apBagApproachStarted_ = 0;
            this.apBagApproachBestDistance_ = Infinity;
            this.apBagLastProgressAt_ = 0;
         }
         this.apCachedBagId_ = best != null ? best.objectId_ : -1;
         if(best != null && bestD <= 0.09) {
            this.apBagHoldId_ = best.objectId_;
            this.apBagHoldStarted_ = scanNow;
            this.apBagHoldLocationKey_ = this.apBagLocationKey(best);
            this.apBagApproachId_ = -1;
            this.apBagApproachStarted_ = 0;
            this.apBagApproachBestDistance_ = Infinity;
            this.apBagLastProgressAt_ = 0;
            DebugLog.event("autoplay_bag_hold",{
                  "bagId":best.objectId_,"distance":Math.sqrt(bestD),"map":this.mapName});
         }
         if(blueCount > 0 && scanNow - this.apLastBagScanLog_ >= 2000) {
            this.apLastBagScanLog_ = scanNow;
            DebugLog.event("autoplay_bag_scan",{
               "blueOrBetter":blueCount,"interactive":interactiveCount,
               "withItems":itemCount,"selectedId":best != null ? best.objectId_ : -1,
               "selectedDistance":best != null ? Math.sqrt(bestD) : -1,
               "map":this.mapName
            });
         }
         return best;
      }

      private function apIsEligibleSoulboundBag(bag:Container, scanNow:int) : Boolean {
         if(bag == null || bag.dead_ || !bag.isLoot_ || bag.fakeBag_ ||
               bag.equipment_ == null || !this.apIsBlueOrBetterBag(bag) ||
               this.apServicedBagIds_[bag.objectId_] ||
               int(this.apServicedBagLocations_[this.apBagLocationKey(bag)]) >
                     scanNow ||
               !bag.isInteractive_) {
            return false;
         }
         for each(var itemType:int in bag.equipment_) {
            if(itemType > 0) {
               return true;
            }
         }
         return false;
      }

      // Container tier 2 is the purple soulbound bag. Tier 3 is blue; later
      // tiers are cyan/white/orange/red/ST/UT and are all worth stopping for.
      private function apIsBlueOrBetterBag(bag:Container) : Boolean {
         return this.apSoulboundBagTier(bag) >= 3;
      }

      private function apSoulboundBagTier(bag:Container) : int {
         var definitionId:String = bag.props_ != null ? bag.props_.id_ : "";
         if(definitionId != null && definitionId.indexOf("Loot Bag ") == 0) {
            var tierText:String = definitionId.substring("Loot Bag ".length).split(" ")[0];
            var tier:Number = parseInt(tierText);
            if(!isNaN(tier)) {
               return int(tier);
            }
         }
         switch(bag.objectType_) {
            case 0x0508:
            case 0x06BB:
               return 3;
            case 0x0509:
            case 0x06BD:
               return 4;
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

      private function apBagLocationKey(bag:Container) : String {
         return bag.objectType_ + ":" + int(bag.x_ * 4) + ":" + int(bag.y_ * 4);
      }

      // Bounded breadth-first search. Eight-way movement is allowed only when
      // both adjacent cardinal squares are walkable, preventing corner cuts.
      private function apBuildPath(sx:int, sy:int, gx:int, gy:int,
                                   allowWallEscape:Boolean = true) : Vector.<Point> {
         var result:Vector.<Point> = new Vector.<Point>();
         this.apLastBuildWasWallEscape_ = false;
         var liveMap:Map = this.map as Map;
         if(liveMap == null) {
            return result;
         }
         var width:int = liveMap.mapWidth;
         var height:int = liveMap.mapHeight;
         if(sx < 0 || sx >= width || sy < 0 || sy >= height) {
            return result;
         }
         // Integer tile ids replace the old "x,y" strings. A 2,500-node
         // fallback search previously allocated strings for every neighbor,
         // every parent edge and again while reconstructing the route, creating
         // large periodic GC spikes during unattended pathfinding.
         var startKey:int = sx + sy * width;
         var queue:Vector.<int> = new <int>[startKey];
         var seen:Dictionary = new Dictionary();
         var parent:Dictionary = new Dictionary();
         var head:int = 0;
         var expanded:int = 0;
         var found:int = -1;
         var bestKey:int = startKey;
         var bestDistance:Number = (sx - gx) * (sx - gx) + (sy - gy) * (sy - gy);
         var fallbackKey:int = startKey;
         var fallbackDistance:Number = 0;
         var wallEscapeKey:int = startKey;
         var wallEscapeDistance:Number = 0;
         var alignedWallEscapeKey:int = startKey;
         var alignedWallEscapeDistance:Number = 0;
         var hasCommittedEscapeDirection:Boolean =
               this.apWallEscapeDirectionX_ * this.apWallEscapeDirectionX_ +
               this.apWallEscapeDirectionY_ * this.apWallEscapeDirectionY_ > 0.25;
         var startingGoalDistance:Number = bestDistance;
         var maxEscapeGoalRadius:Number = Math.sqrt(startingGoalDistance) + 8;
         var maxEscapeGoalDistance:Number = maxEscapeGoalRadius * maxEscapeGoalRadius;
         var startInFailedRegion:Boolean = this.apIsFailedRouteRegion(
               sx + 0.5,sy + 0.5);
         seen[startKey] = true;
         var queueLength:int = queue.length;
         while(head < queueLength && expanded < 2500) {
            var currentKey:int = queue[head];
            var x:int = currentKey % width;
            var y:int = int(currentKey / width);
            head++;
            expanded++;
            var goalDistance:Number = (x - gx) * (x - gx) + (y - gy) * (y - gy);
            if(goalDistance < bestDistance) {
               bestDistance = goalDistance;
               bestKey = currentKey;
            }
            var startDistance:Number = (x - sx) * (x - sx) + (y - sy) * (y - sy);
            if(startDistance > fallbackDistance) {
               fallbackDistance = startDistance;
               fallbackKey = currentKey;
            }
            // After a verified stall, prefer a substantial reachable sidestep
            // over returning to the closest point on the same wall. Permit a
            // small temporary detour away from the quest so a route can travel
            // around long Snake Pit/Castle structures.
            if(goalDistance <= maxEscapeGoalDistance &&
                  startDistance > wallEscapeDistance) {
               wallEscapeDistance = startDistance;
               wallEscapeKey = currentKey;
            }
            // Once an escape episode chooses a side of a long wall, keep
            // exploring that half-plane. The Snake Pit trace alternated between
            // opposite 20-36 tile frontiers on every timeout, producing ten
            // stalls and repeated position desyncs without revealing a route.
            // A perpendicular continuation is allowed so the path can round a
            // corner; a direct reversal is used only when no aligned frontier
            // exists at all.
            var escapeDx:Number = x - sx;
            var escapeDy:Number = y - sy;
            var escapeAlignment:Number = escapeDx * this.apWallEscapeDirectionX_ +
                  escapeDy * this.apWallEscapeDirectionY_;
            if(goalDistance <= maxEscapeGoalDistance &&
                  (!hasCommittedEscapeDirection || escapeAlignment >= -0.001) &&
                  startDistance > alignedWallEscapeDistance) {
               alignedWallEscapeDistance = startDistance;
               alignedWallEscapeKey = currentKey;
            }
            // Stop on a cardinal neighbor. A diagonal neighbor is visually
            // close but outside this server's portal interaction radius.
            if(Math.abs(x - gx) + Math.abs(y - gy) <= 1) {
               found = currentKey;
               break;
            }
            for(var dirIndex:int = 0; dirIndex < 8; dirIndex++) {
               var dirX:int = AP_DIR_X[dirIndex];
               var dirY:int = AP_DIR_Y[dirIndex];
               var nx:int = x + dirX;
               var ny:int = y + dirY;
               if(nx < 0 || nx >= width || ny < 0 || ny >= height) {
                  continue;
               }
               var key:int = nx + ny * width;
               if(seen[key] || this.apBlocked_[key] ||
                     !startInFailedRegion && this.apIsFailedRouteRegion(
                     nx + 0.5,ny + 0.5)) {
                  continue;
               }
               var square:Square = liveMap.lookupSquare(nx,ny);
               if(square == null || !square.isWalkable() ||
                     !liveMap.canOccupyForDodge(nx + 0.5,ny + 0.5,true) ||
                     !this.apCanTraverse(liveMap,x + 0.5,y + 0.5,nx + 0.5,ny + 0.5)) {
                  continue;
               }
               if(dirX != 0 && dirY != 0) {
                  var sideA:Square = liveMap.lookupSquare(x + dirX,y);
                  var sideB:Square = liveMap.lookupSquare(x,y + dirY);
                  if(sideA == null || sideB == null ||
                     !sideA.isWalkable() || !sideB.isWalkable()) {
                     continue;
                  }
               }
               seen[key] = true;
               parent[key] = currentKey;
               queue.push(key);
               queueLength++;
            }
         }
         if(found < 0) {
            // The quest is commonly outside the streamed region. Advance to the
            // closest reachable frontier so moving reveals more tiles, instead
            // of returning an empty path and repeatedly searching in place.
            // If no reachable tile improves the straight-line distance (a local
            // minimum at a wall/water boundary), deliberately walk to the most
            // distant reachable frontier. That reveals new tiles and escapes
            // the repeated stand-still/replan loop.
            if(allowWallEscape && this.apStuckCount_ > 0 &&
                  wallEscapeKey != startKey) {
               if(hasCommittedEscapeDirection && alignedWallEscapeKey != startKey) {
                  wallEscapeKey = alignedWallEscapeKey;
                  wallEscapeDistance = alignedWallEscapeDistance;
               }
               if(this.apIsOryxCastle()) {
                  if(this.apLastWallEscapeFrom_ == wallEscapeKey &&
                        this.apLastWallEscapeTo_ == startKey) {
                     this.apWallEscapeReverseCount_++;
                  } else if(this.apLastWallEscapeFrom_ != startKey ||
                        this.apLastWallEscapeTo_ != wallEscapeKey) {
                     this.apWallEscapeReverseCount_ = 0;
                  }
                  this.apLastWallEscapeFrom_ = startKey;
                  this.apLastWallEscapeTo_ = wallEscapeKey;
                  if(this.apWallEscapeReverseCount_ >= 2) {
                     var abandonedIndex:int = this.apCastleRouteIndex_;
                     this.apCastleRouteIndex_ = Math.min(this.apCastleRouteLength(),
                           this.apCastleRouteIndex_ + 1);
                     this.apBlocked_ = new Dictionary();
                     this.apStuckCount_ = 0;
                     this.apWallEscapeReverseCount_ = 0;
                     DebugLog.event("autoplay_castle",{
                           "state":"route_loop_broken","index":abandonedIndex,
                           "nextIndex":this.apCastleRouteIndex_,
                           "from":sx + "," + sy,
                           "escape":(wallEscapeKey % width) + "," +
                                 int(wallEscapeKey / width),
                           "goalX":gx,"goalY":gy});
                     return result;
                  }
               }
               found = wallEscapeKey;
               this.apLastBuildWasWallEscape_ = true;
               var escapeX:int = wallEscapeKey % width;
               var escapeY:int = int(wallEscapeKey / width);
               var selectedEscapeDx:Number = escapeX - sx;
               var selectedEscapeDy:Number = escapeY - sy;
               var selectedEscapeLength:Number = Math.sqrt(selectedEscapeDx *
                     selectedEscapeDx + selectedEscapeDy * selectedEscapeDy);
               if(selectedEscapeLength > 0.001) {
                  this.apWallEscapeDirectionX_ = selectedEscapeDx / selectedEscapeLength;
                  this.apWallEscapeDirectionY_ = selectedEscapeDy / selectedEscapeLength;
               }
               DebugLog.event("autoplay_path_fallback",{
                     "state":"wall_escape","stuckCount":this.apStuckCount_,
                     "fromX":sx,"fromY":sy,"goalX":gx,"goalY":gy,
                     "escape":escapeX + "," + escapeY,
                     "distance":Math.sqrt(wallEscapeDistance)});
            } else {
               // A deterministic Castle segment may advance only toward its
               // known goal. Generic exploration can deliberately visit a far
               // frontier, but doing that here caused the repeated 202<->224
               // wall loop in the fixed right-side corridor.
               found = bestKey != startKey ? bestKey :
                       (allowWallEscape && fallbackKey != startKey ?
                       fallbackKey : -1);
            }
            if(found < 0) {
               return result;
            }
         }
         var cursor:int = found;
         var guard:int = 0;
         while(cursor != startKey && cursor >= 0 && guard++ < 512) {
            result.push(new Point(cursor % width + 0.5,
                  int(cursor / width) + 0.5));
            cursor = int(parent[cursor]);
         }
         result.reverse();
         if(!this.apLastBuildWasWallEscape_) {
            this.apWallEscapeDirectionX_ = 0;
            this.apWallEscapeDirectionY_ = 0;
         }
         return result;
      }

      private function apCanTraverse(liveMap:Map, fromX:Number, fromY:Number,
                                     toX:Number, toY:Number) : Boolean {
         if(liveMap == null) {
            return false;
         }
         var dx:Number = toX - fromX;
         var dy:Number = toY - fromY;
         var steps:int = Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dy)) / 0.2));
         // Safe Walk must remain authoritative for Auto Play even when No Clip
         // is enabled. If the player is already standing on damaging ground,
         // permit a continuous escape from it, but never permit re-entry after
         // the sampled segment reaches a safe square.
         var reachedSafeGround:Boolean = !liveMap.isDamagingGround(fromX,fromY);
         // BFS starts at the center of int(player.x/y), while the live player
         // can be a fraction of a tile into a wall's configured clearance.
         // Rejecting that first fractional sample traps the player forever even
         // when the waypoint moves directly away from the wall into the legal
         // center of a one-tile corridor. Permit only a continuous escape from
         // the pre-existing overlap; once a valid sample is reached, no blocked
         // sample may be entered again.
         // Physical occupancy is intentionally queried with safeWalk=false.
         // Damaging-ground continuity is handled above; mixing it into this
         // result made a lava tile indistinguishable from a solid wall.
         var reachedOccupable:Boolean = liveMap.canOccupyForDodge(
               fromX,fromY,false);
         for(var step:int = 1; step <= steps; step++) {
            var ratio:Number = step / steps;
            var sampleX:Number = fromX + dx * ratio;
            var sampleY:Number = fromY + dy * ratio;
            var damagingGround:Boolean = liveMap.isDamagingGround(sampleX,sampleY);
            if(damagingGround && reachedSafeGround) {
               return false;
            }
            if(!damagingGround) {
               reachedSafeGround = true;
            }
            var occupiable:Boolean = liveMap.canOccupyForDodge(
                  sampleX,sampleY,false);
            if(!occupiable && reachedOccupable) {
               return false;
            }
            if(occupiable) {
               reachedOccupable = true;
            }
         }
         return reachedOccupable;
      }

      // Parse the live player count out of a realm portal name like
      // "Meridian (24/85)" -> 24. Returns int.MAX_VALUE when there's no count so
      // unparseable portals lose to every portal with an authoritative count.
      private function apPortalPlayerCount(name:String) : int {
         if(name == null) {
            return int.MAX_VALUE;
         }
         var open:int = name.indexOf("(");
         var slash:int = name.indexOf("/", open);
         if(open == -1 || slash == -1) {
            return int.MAX_VALUE;
         }
         var n:int = parseInt(name.substring(open + 1, slash));
         return n <= 0 && name.charAt(open + 1) != "0" ? int.MAX_VALUE : n;
      }

      // Population and queue suffixes change while the Nexus is open. Realm
      // identity is the stable name before the first " (" suffix.
      private function apRealmPortalName(name:String) : String {
         if(name == null) {
            return "";
         }
         var suffix:int = name.indexOf(" (");
         var stableName:String = suffix >= 0 ? name.substring(0,suffix) : name;
         return stableName.toLowerCase();
      }

      private function apSelectRealmPortal(portal:Portal, candidateCount:int,
                                            policy:String) : Portal {
         if(portal == null) {
            return null;
         }
         var changed:Boolean = this.apSelectedRealmPortal_ != portal.objectId_;
         this.apSelectedRealmPortal_ = portal.objectId_;
         apPendingRealmName_ = this.apRealmPortalName(portal.name_);
         if(changed) {
            var population:int = this.apPortalPlayerCount(portal.name_);
            CrashLogger.note("AUTOPILOT: selected realm portal id=" +
                  portal.objectId_ + " name='" + portal.name_ + "' policy=" + policy);
            DebugLog.event("autoplay_state",{"state":"realm_selected",
                  "portalId":portal.objectId_,"name":portal.name_,
                  "realm":apPendingRealmName_,"population":
                        population == int.MAX_VALUE ? -1 : population,
                  "policy":policy,"candidates":candidateCount});
         }
         return portal;
      }

      // Pick the best portal to advance toward a realm: nearest non-setpiece
      // (realm/dungeon) portal; else the way back to the Nexus if we're stuck in
      // a setpiece; else null (explore).
      private function apBestHubPortal(p:Player) : Portal {
         // Ranked preference: (1) a combat portal — realm/dungeon/quest room, i.e.
         // not a setpiece (s.*) and not a shop bazaar; (2) a bazaar (still exits
         // the hub and exercises a map); (3) the way back to the Nexus.
         var realmP:Portal = null;
         var originalRealmP:Portal = null;
         var realmCandidates:Array = [];
         var combatP:Portal = null;
         var combatD:Number = Infinity;
         var bazaarP:Portal = null;
         var bazaarD:Number = Infinity;
         var nexusP:Portal = null;
         var nexusD:Number = Infinity;
         this.apRefreshObjectCaches();
         for each(var portalObject:Portal in this.apCachedPortals_) {
            var o:GameObject = portalObject;
            if(o != null && this.map.goDict_[o.objectId_] == o) {
               var nm:String = o.name_ == null ? "" : String(o.name_);
               var d:Number = (o.x_ - p.x_) * (o.x_ - p.x_) + (o.y_ - p.y_) * (o.y_ - p.y_);
               var setpiece:Boolean = nm.indexOf("s.") != -1;      // {"t":"s.vault"} etc.
               var bazaar:Boolean = nm.toLowerCase().indexOf("bazaar") != -1;
               // A realm portal is type 0x712 (e.g. "Meridian (24/85)") — those
               // have enemies. Prefer them over other non-setpiece portals like
               // the (safe) Daily Quest Room so autoplay actually reaches combat.
               var realm:Boolean = o.objectType_ == 0x712 || nm.indexOf("(") != -1 && nm.indexOf("/") != -1;
               // Skip a realm portal we JUST bounced off of (s.realm_full) while
               // its backoff window is open — no point walking back to a full one.
                var isFullBackedOff:Boolean = o.objectId_ == GameServerConnectionConcrete.realmFullPortalId_ &&
                         getTimer() < GameServerConnectionConcrete.realmFullUntil_ &&
                         !GameServerConnectionConcrete.inRealmQueue_;
               if(realm && !isFullBackedOff) {
                  realmCandidates.push(o as Portal);
                  if(apOriginalRealmName_ != null &&
                        this.apRealmPortalName(nm) == apOriginalRealmName_) {
                     originalRealmP = o as Portal;
                  }
                  if(o.objectId_ == this.apSelectedRealmPortal_) {
                     realmP = o as Portal;
                  }
               }
               if(!setpiece && !bazaar && d < combatD) {
                  combatD = d;
                  combatP = o as Portal;
               }
               if(bazaar && d < bazaarD) {
                  bazaarD = d;
                  bazaarP = o as Portal;
               }
               if(nm.indexOf("s.nexus") != -1 && d < nexusD) {
                  nexusD = d;
                  nexusP = o as Portal;
               }
            }
         }
         if(originalRealmP != null) {
            return this.apSelectRealmPortal(originalRealmP,realmCandidates.length,
                  "original_realm");
         }
         if(realmP != null) {
            return realmP;   // current Nexus selection remains visible/usable
         }
         if(realmCandidates.length > 0) {
            if(this.apRealmSelectionReadyAt_ == 0) {
               // Keep moving through the portal row briefly so more than the
               // first streamed realm participates in ranking. A returning
               // session waits longer so its original portal has a fair chance
               // to stream before the populated-realm fallback is selected.
               this.apRealmSelectionReadyAt_ = getTimer() +
                     (apOriginalRealmName_ != null ?
                     AP_ORIGINAL_REALM_DISCOVERY_MS : AP_REALM_DISCOVERY_MS);
               return null;
            }
            if(getTimer() < this.apRealmSelectionReadyAt_) {
               return null;
            }
            var busiestCount:int = -1;
            var busiestDistance:Number = Infinity;
            for each(var candidate:Portal in realmCandidates) {
               var candidateCount:int = this.apPortalPlayerCount(candidate.name_);
               var candidateDx:Number = candidate.x_ - p.x_;
               var candidateDy:Number = candidate.y_ - p.y_;
               var candidateDistance:Number = candidateDx * candidateDx +
                     candidateDy * candidateDy;
               var hasPopulation:Boolean = candidateCount != int.MAX_VALUE;
               var replaceBusiest:Boolean = hasPopulation ?
                     (busiestCount < 0 || candidateCount > busiestCount ||
                     candidateCount == busiestCount &&
                     candidateDistance < busiestDistance) :
                     busiestCount < 0 && candidateDistance < busiestDistance;
               if(replaceBusiest) {
                  busiestCount = candidateCount == int.MAX_VALUE ? -1 : candidateCount;
                  busiestDistance = candidateDistance;
                  realmP = candidate;
               }
            }
            return this.apSelectRealmPortal(realmP,realmCandidates.length,
                  "most_populated");
         }
         // No realm portal in view. Do NOT fall back to a non-realm "combat"
         // portal — on this server that lands on the Daily Quest Room (0x1756, a
         // SAFE room), which the autopilot then bounces out of and re-enters
         // forever. Instead: if we're stuck in a setpiece/bazaar, head back to
         // the Nexus; if we're in the Nexus with no realm visible yet, return
         // null so the caller EXPLORES until a realm portal streams in.
         if(this.mapName != "Nexus" && nexusP != null) {
            return nexusP;
         }
         return null;
      }

      // Log every distinct portal seen (once each) so realm/dungeon access on
      // this server can be identified from the log.
      private function apDumpPortals(p:Player) : void {
         this.apRefreshObjectCaches();
         for each(var o:GameObject in this.apCachedPortals_) {
            if(o != null && this.map.goDict_[o.objectId_] == o &&
                  !this.apSeen_.hasOwnProperty(o.objectId_)) {
               this.apSeen_[o.objectId_] = true;
               CrashLogger.note("AUTOPILOT PORTAL: id=" + o.objectId_ + " type=0x" +
                       o.objectType_.toString(16) + " name='" + o.name_ + "' pos=(" +
                       int(o.x_) + "," + int(o.y_) + ")");
            }
         }
      }

      private function apHasRealmPortal() : Boolean {
         this.apRefreshObjectCaches();
         for each(var portal:Portal in this.apCachedPortals_) {
            if(portal == null || this.map.goDict_[portal.objectId_] != portal) {
               continue;
            }
            var name:String = portal.name_ == null ? "" : portal.name_;
            if(portal.objectType_ == 0x712 ||
                  name.indexOf("(") != -1 && name.indexOf("/") != -1) {
               return true;
            }
         }
         return false;
      }

      /** Reconnect directly to another healthy server's Nexus. The selected
       * server is not written into the user's Preferred Server setting. */
      private function apSwitchToAnotherServer() : Boolean {
         var serverModel:ServerModel = StaticInjectorContext.getInjector().getInstance(ServerModel);
         if(serverModel == null) {
            return false;
         }
         var current:Server = this.gsc_ != null ? this.gsc_.server_ : null;
         var normal:Array = [];
         var fallback:Array = [];
         for each(var server:Server in serverModel.getServers()) {
            if(server == null || server.address == null || server.address == "" ||
                  server.isAdminOnly || server.isFull() ||
                  current != null && server.address == current.address && server.port == current.port ||
                  server.name == "Proxy" || server.address == "127.0.0.1" || server.address == "localhost") {
               continue;
            }
            fallback.push(server);
            if(!server.isCrowded()) {
               normal.push(server);
            }
         }
         var choices:Array = normal.length > 0 ? normal : fallback;
         if(choices.length == 0) {
            DebugLog.event("autoplay_state",{"state":"empty_server_no_alternative",
                  "server":current != null ? current.name : ""});
            this.apNexusNoRealmSince_ = getTimer();
            return false;
         }
         var selected:Server = choices[int(Math.random() * choices.length)] as Server;
         DebugLog.event("autoplay_state",{"state":"empty_server_switch",
               "from":current != null ? current.name : "","to":selected.name,
               "usage":selected.usage});
         CrashLogger.note("AUTOPILOT: no realm portals after 20s; switching server " +
               (current != null ? current.name : "?") + " -> " + selected.name);
         this.apNexusNoRealmSince_ = getTimer();
         this.dispatchEvent(new ReconnectEvent(selected,-2,false,this.gsc_.charId_,0,null,false));
         return true;
      }

      private function apNearestEnemy(p:Player) : GameObject {
         var now:int = getTimer();
         if(now - this.apLastEnemyScanAt_ < AP_TARGET_SCAN_INTERVAL_MS) {
            if(this.apCachedEnemyId_ < 0) {
               return null;
            }
            var cached:GameObject = this.map.goDict_[this.apCachedEnemyId_] as GameObject;
            if(cached != null && cached is Character && cached.props_ != null &&
                  cached.props_.isEnemy_ && !cached.dead_) {
               return cached;
            }
         }
         var best:GameObject = null;
         var bd:Number = Infinity;
         for each(var o:GameObject in this.map.vulnEnemyDict_) {
            // Wall, CaveWall and other structural classes may be flagged Enemy
            // solely to receive player projectile damage. Auto Play must never
            // turn those blockers into movement targets. Player.attemptAutoAim
            // still independently honors the user's Shoot at Walls preference.
            if(o != null && o is Character && o.props_ != null &&
                  o.props_.isEnemy_ && !o.dead_) {
               var d:Number = (o.x_ - p.x_) * (o.x_ - p.x_) + (o.y_ - p.y_) * (o.y_ - p.y_);
               if(d < bd) {
                  bd = d;
                  best = o;
               }
            }
         }
         this.apLastEnemyScanAt_ = now;
         this.apCachedEnemyId_ = best != null ? best.objectId_ : -1;
         return best;
      }
   }
}
