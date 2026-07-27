export { Client } from './client';
export type {
  ClientEventMap,
  ClientDamageTakenEvent,
  ClientDodgeDiagnostic,
  ClientPartyMember,
  ClientShotFiredEvent,
  ContainerSlotRef,
  ItemContainer,
  NavigationState,
  PacketContext,
  PacketTraffic,
  ViewerAoeSnapshot,
} from './client';
export { ClientEvent } from './events';
export {
  AppEngineError,
  deleteCharacter,
  getCharAndServers,
  login,
  resolveClassType,
} from './account-service';
export type {
  Account,
  AppEngineErrorKind,
  CharInfo,
  CreateCharOptions,
  Credentials,
  RequestOptions,
  ServerInfo,
} from './account-service';
export type {
  ClientOptions,
  ClientServer,
  RealmPortal,
  TrackedObject,
  TrackedTile,
} from './models';
export {
  connectThroughProxy,
  createProxyAgent,
  parseProxyConfig,
  proxyConfigToUrl,
  testProxy,
} from './proxy';
export type { ProxyConfig, ProxyProtocol, ProxyTestResult } from './proxy';
export {
  AutoNexusMonitor,
  calculateAutoNexusDamage,
  isAutoNexusSafeMap,
  predictAutoNexusRouteDamage,
} from './auto-nexus';
export type {
  AutoNexusConfig,
  AutoNexusDamageOptions,
  AutoNexusRoutePrediction,
  AutoNexusRoutePredictionOptions,
  AutoNexusState,
  AutoNexusTrigger,
  AutoNexusTriggerSource,
  PredictiveAutoNexusOptions,
} from './auto-nexus';
export { CombatTracker, isNonlinearProjectile } from './combat-tracker';
export type {
  CombatDataProvider,
  CombatEntity,
  CombatObjectDefinition,
  CombatPlayerHit,
  CombatProjectileSide,
  CombatProjectileSnapshot,
  CombatProjectileDefinition,
  CombatTile,
  CombatWorldSnapshot,
} from './combat-tracker';
export {
  DodgeCollisionWorld,
  ENEMY_AVOID_RADIUS,
  ENEMY_SOFT_AVOID_RADIUS,
  isEnemyProximityThreat,
} from './dodge-collision-world';
export type { LocalDodgeCollisionSnapshot } from './dodge-collision-world';
export {
  cloneDodgeMovementIntent,
  normalizeDodgeMovementIntent,
} from './dodge-movement-intent';
export type {
  CombatRangeDodgeIntent,
  DodgeMovementIntent,
  DodgeMovementIntentId,
  DodgeMovementIntentMode,
  GoalDodgeIntent,
} from './dodge-movement-intent';
export {
  DODGE_COST_WEIGHTS,
  SpaceTimeDodgePlanner,
  sweptRelativeMotion,
} from './dodge-trajectory-planner';
export type {
  DodgeFallback,
  DodgeCostWeights,
  DodgePlannerMetrics,
  DodgePlannerOptions,
  DodgePlanningAoe,
  DodgePlanningEnvironment,
  DodgePlanningInput,
  DodgePlanningResult,
  DodgeReplanReason,
  DodgeTrajectory,
  DodgeTrajectoryAssessment,
  TimedDodgeWaypoint,
} from './dodge-trajectory-planner';
export {
  AoeRepeatObserver,
  DodgeAoeThreatTracker,
  MovingAoeEmitterTracker,
  PredictiveAutoDodgeController,
  ThrownAoeTracker,
  beamAoeArmorPiercing,
  beamAoeDamage,
  beamAoeRadius,
  beamAoeWarningMs,
} from './predictive-auto-dodge';
export type {
  AutoDodgeOptions,
  AutoDodgeRoute,
  AutoDodgeSnapshot,
  AutoDodgeState,
  DodgeReplanCause,
  DodgeSafetyState,
  TrackedRecentAoe,
  TrackedTelegraphedAoe,
  TrackedThrownAoe,
} from './predictive-auto-dodge';
export {
  ExplorativePathfinder,
  MAX_LOCAL_GOAL_DISTANCE,
  NAVIGATION_PATH_SEARCH_BUDGET,
  SYNC_PATH_SEARCH_BUDGET,
} from './explorative-pathfinder';
export { ProdMafiaAutoDodgeController, collectTelegraphLasers } from './prodmafia-auto-dodge';
export {
  compareDodgeRouteCost,
  dodgeConditionRisk,
  isLethalDodgeCondition,
  projectileConditionRisk,
  resolveProdMafiaDodgeConfig,
  PRODMAFIA_DODGE_CONFIG_DEFAULTS,
  UNKNOWN_HARMFUL_CONDITION,
} from './prodmafia-auto-dodge';
export type {
  DodgeConditionEffect,
  DodgeConditionEffectSpec,
  DodgeMovingAoeEmitter,
  DodgeRecentAoe,
  DodgeRouteCost,
  DodgeTelegraphLaser,
  DodgeTelegraphedAoe,
  ProdMafiaDodgeAoe,
  ProdMafiaDodgeConfig,
  ProdMafiaDodgeSnapshot,
} from './prodmafia-auto-dodge';
export { ProdMafiaAutoPlayController } from './prodmafia-autoplay';
export type {
  ProdMafiaAutoPlayDecision,
  ProdMafiaAutoPlayNavigationMode,
  ProdMafiaAutoPlayObject,
  ProdMafiaAutoPlayOptions,
  ProdMafiaAutoPlaySnapshot,
} from './prodmafia-autoplay';
export {
  ProdMafiaPathfinder,
  PROD_MAFIA_MAX_LOCAL_GOAL_DISTANCE,
  PROD_MAFIA_PATH_SEARCH_BUDGET,
} from './prodmafia-pathfinder';
export { runIncrementalPathSearch, runSyncPathSearch } from './path-search-adapters';
export {
  pathSearchStatusToNavigationStatus,
} from './navigation-status';
export type {
  NavigationStatus,
  PathSearchDerivedNavigationStatus,
} from './navigation-status';
export type {
  CombatPathfindingRange,
  PathfindingDataProvider,
  PathfindingStep,
  PathfindingIntentRevisions,
  PathPoint,
  PathSearchHandle,
  PathSearchStatus,
  PathSearchStepBudget,
  PathTarget,
} from './explorative-pathfinder';
export {
  AutoCombatController,
  PRODMAFIA_AUTO_ABILITY_DEFAULTS,
  TOMB_BOSS_CYCLE,
} from './auto-combat';
export type {
  AutoAbilityOptions,
  AutoAimMode,
  AutoAimOptions,
  AutoCombatActions,
  AutoCombatSnapshot,
  AutoCombatState,
  TombBossPhase,
} from './auto-combat';
export {
  AutoConsumablesController,
  DEFAULT_AUTO_CONSUMABLES,
  HP_POTION_TYPES,
  LIFE_MANA_POTION_TYPES,
  MP_DRINK_TYPES,
  MP_POTION_TYPES,
  RAINBOW_POTION_TYPES,
  potionStatType,
  shouldDrinkStatPotion,
} from './auto-consumables';
export type {
  AutoConsumablesActions,
  AutoConsumablesBag,
  AutoConsumablesOptions,
  AutoConsumablesQuickSlot,
  AutoConsumablesSnapshot,
  AutoConsumablesState,
  PotionStat,
  PotionStatSnapshot,
} from './auto-consumables';
export {
  ABILITY_SLOT_TYPES,
  ARMOR_SLOT_TYPES,
  AutoLootController,
  DEFAULT_AUTO_LOOT,
  DEFAULT_AUTO_LOOT_INCLUDES,
  PET_STONE_TYPES,
  RING_SLOT_TYPE,
  TIER_OPTION_OFF,
  WEAPON_SLOT_TYPES,
  autoLootBagTier,
  isDesiredLoot,
  isDesiredPotion,
  itemCatalogLootData,
} from './auto-loot';
export type {
  AutoLootAction,
  AutoLootActions,
  AutoLootBag,
  AutoLootBlockReason,
  AutoLootDataProvider,
  AutoLootItemInfo,
  AutoLootOptions,
  AutoLootQuickSlot,
  AutoLootSnapshot,
  AutoLootState,
} from './auto-loot';
export {
  AUTO_SYNC_CLIENT_HP_DELTA,
  AUTO_SYNC_CLIENT_HP_TICKS,
  AutoSyncClientHpTracker,
  calculateIgnoreBitmasks,
  clampSuppressThreshold,
  damageIsLethal,
  DEFAULT_HIT_SUPPRESSION_OPTIONS,
  DEFAULT_IGNORE_DEBUFF_OPTIONS,
  playerHitSuppressionReason,
  projectileConditionEffectIds,
  projectileMatchesIgnoredDebuff,
  shouldSuppressStrategicHit,
  strategicSurvivalHp,
} from './hit-suppression';
export type {
  HitSuppressionOptions,
  IgnoreDebuffBitmasks,
  IgnoreDebuffOptions,
  PlayerHitSuppressionReason,
} from './hit-suppression';
export {
  BossPhaseTracker,
  CLOTH_BAZAAR_MAP,
  CLOTH_BAZAAR_PHASE,
  PERSISTENT_PHASE_NAMES,
  SERVER_MESSAGE_STARS,
  TIMER_PHASES,
  autoResponderReply,
  bossPhaseForText,
  getSplinterReply,
  isServerDialogue,
} from './boss-dialogue';
export type { BossPhase, BossPhaseSnapshot, DialogueMessage } from './boss-dialogue';
export {
  DEFAULT_PORTAL_AUTO_ENTER,
  PORTAL_OBJECT_TYPES,
  PortalAutoEnterController,
  isAutoEnterCandidate,
  isDungeonWhitelisted,
  isHubPortal,
  looksLikePortal,
  normalizeDungeonName,
  parseDungeonWhitelist,
} from './portal-automation';
export type {
  PortalAutoEnterDecision,
  PortalAutoEnterOptions,
  PortalAutoEnterSnapshot,
  PortalCandidate,
} from './portal-automation';
export {
  portalCandidates,
  portalNameCatalog,
  resolveObjectName,
  setPortalNameCatalog,
} from './portal-lookup';
export {
  DEFAULT_FOLLOW_OPTIONS,
  FollowController,
  anchorTeleportCommand,
  selectClosestPlayerTeleport,
  selectQuestTeleportTarget,
} from './follow-controller';
export type {
  FollowDecision,
  FollowOptions,
  FollowPlayer,
  FollowSnapshot,
  PlayerTeleportSelection,
  QuestTeleportSelection,
} from './follow-controller';
export {
  VAULT_SWEEP_STAGGER_MS,
  planVaultDepositAll,
} from './inventory';
export type { VaultSweepStep } from './inventory';
export { ItemCatalog, loadItemCatalog } from './item-metadata';
export type { ItemInfo, ItemRef, PlayerStatMaximums } from './item-metadata';
export {
  AcceptTradePacket,
  CancelTradePacket,
  ChangeTradePacket,
  CreatePartyMessagePacket,
  IncomingPartyMemberInfoPacket,
  PacketType,
  PartyActionPacket,
  PartyActionResultPacket,
  PartyJoinRequestPacket,
  PartyListMessagePacket,
  PartyMemberAddedPacket,
  QuestObjectIdPacket,
  RequestTradePacket,
  parseEnchantments,
  TextPacket,
  TradeAcceptedPacket,
  TradeChangedPacket,
  TradeDonePacket,
  TradeRequestedPacket,
  TradeStartPacket,
} from 'realmlib';
export type { PartyInfoData, PartyPlayerData, SlotEnchantments, TradeItem } from 'realmlib';
