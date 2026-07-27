import type { CombatObjectDefinition, CombatProjectileDefinition } from './combat-tracker';
import type { TrackedObject } from './models';
import { ConditionEffectBits, StatType } from 'realmlib';

const REALM_DISCOVERY_MS = 1500;
const ORIGINAL_REALM_DISCOVERY_MS = 3500;
const BAG_MIN_HOLD_MS = 1000;
const BAG_MAX_HOLD_MS = 5000;
const BAG_SCAN_INTERVAL_MS = 200;
const BAG_STALL_TIMEOUT_MS = 6000;
const BAG_LOCATION_COOLDOWN_MS = 2000;
const BAG_PROGRESS_DISTANCE = 0.10;
const BAG_MAX_DISTANCE_SQUARED = 26 * 26;
const TARGET_SCAN_INTERVAL_MS = 100;
const CROWD_SEPARATION_ENTER = 1.15;
const CROWD_SEPARATION_EXIT = 1.45;
const SEPARATION_BASE_SPEED = 0.0065;
const SEPARATION_RESERVE_MS = 100;
const SEPARATION_MAX_RESERVE = 1;
const CLOSE_SHOT_SEPARATION_ENTER = 5.5;
const CLOSE_SHOT_SEPARATION_EXIT = 6.25;
const SMART_SEPARATION_MIN = 2;
const SMART_SEPARATION_MAX = 6;
const SMART_SEPARATION_BAND = 0.9;
const SPACING_PROBE_TILES = 2.25;
const SPACING_STEP_TILES = 0.45;
const SPACING_MIN_GAIN_TILES = 0.7;
const CROWD_SEPARATION_MIN_HOLD_MS = 250;
const CROWD_SEPARATION_RELEASE_MS = 150;
const SEPARATION_TARGET_REPLAN_MS = 250;
const EMPTY_FIXED_INSTANCE_MS = 90_000;
const CASTLE_ROUTE_WAIT_GIVEUP = 12;
const CASTLE_EXPLORE_STALL_GIVEUP = 3;
const DODGE_YIELD_MS = 250;

const CASTLE_LEFT_ROUTE = [
  [79.5, 170.5], [86.5, 140.5], [86.5, 118.5], [86.5, 97.5],
  [54.5, 97.5], [54.5, 82.5], [86.5, 82.5], [100.5, 66.5], [128.5, 60.5],
] as const;
const CASTLE_RIGHT_ROUTE = [
  [176.5, 170.5], [169.5, 140.5], [169.5, 118.5], [169.5, 97.5],
  [201.5, 97.5], [201.5, 82.5], [169.5, 82.5], [155.5, 66.5], [128.5, 60.5],
] as const;
const CASTLE_LEFT_SIDE_ROUTE = [
  [46.5, 170.5], [46.5, 140.5], [50.5, 118.5], [86.5, 118.5],
  [86.5, 97.5], [54.5, 97.5], [54.5, 82.5], [86.5, 82.5],
  [100.5, 66.5], [128.5, 60.5],
] as const;
const CASTLE_RIGHT_SIDE_ROUTE = [
  [209.5, 170.5], [209.5, 140.5], [205.5, 118.5], [169.5, 118.5],
  [169.5, 97.5], [201.5, 97.5], [201.5, 82.5], [169.5, 82.5],
  [155.5, 66.5], [128.5, 60.5],
] as const;

const GUARDIAN_TYPES = new Set([0x0d78, 0x0d79, 0xb536, 0xb537, 0x1fda, 0x1fdb]);
const BAG_TIERS = new Map<number, number>([
  [0x0508, 3], [0x06bb, 3], [0x0509, 4], [0x06bd, 4],
  [0x050b, 5], [0x06be, 5], [0x050c, 6], [0x0510, 6],
  [0x050e, 7], [0x06bc, 7], [0x050f, 8], [0x06bf, 8],
  [0x06ac, 9], [0x06c0, 9],
]);

export interface ProdMafiaAutoPlayOptions {
  dungeons?: boolean;
  stopAtVisibleQuest?: boolean;
  collectSoulbound?: boolean;
  smartSpacing?: boolean;
  nexusRecovery?: boolean;
  autoAim?: boolean;
  autoAbility?: boolean;
}

export interface ProdMafiaAutoPlayObject extends TrackedObject {
  definition?: CombatObjectDefinition;
  equipment?: readonly number[];
}

export interface ProdMafiaAutoPlaySnapshot {
  time: number;
  mapName: string;
  safeMap: boolean;
  inRealmQueue: boolean;
  position: { x: number; y: number };
  level: number;
  weaponRange: number;
  moveSpeed: number;
  questObjectId: number;
  combatAimTargetObjectId: number | null;
  objects: readonly ProdMafiaAutoPlayObject[];
  hostileProjectileCount: number;
  dodgeOverrideActive: boolean;
  teleportAllowed: boolean;
  pathStuckCount: number;
  pathRouteEmpty: boolean;
  currentServerHost: string;
  serverHosts: readonly string[];
  canOccupy(x: number, y: number, safeWalk: boolean): boolean;
  canTraverse(fromX: number, fromY: number, toX: number, toY: number): boolean;
  hasExactPathTo(toX: number, toY: number): boolean;
  projectile(objectType: number, projectileId: number): CombatProjectileDefinition | undefined;
  /**
   * Auto Loot's desirability filter (`Player.hasDesiredAutoLootItem` per item).
   * When supplied, a bag is only worth walking to while it still holds something
   * Auto Loot wants; without it any item counts, as before.
   */
  wantsLoot?(itemType: number): boolean;
}

export type ProdMafiaAutoPlayNavigationMode = 'stop' | 'direct' | 'path';

export interface ProdMafiaAutoPlayDecision {
  enabled: boolean;
  state: string;
  navigationMode: ProdMafiaAutoPlayNavigationMode;
  target: { x: number; y: number } | null;
  targetObjectId: number | null;
  arriveThreshold: number;
  allowWallEscape: boolean;
  usePortalObjectId: number | null;
  teleportObjectId: number | null;
  nexus: boolean;
  autoAim: boolean;
  autoAbility: boolean;
  combatTargetObjectId: number | null;
  reconnectServerHost: string | null;
  movementSpeedScale: number;
  /**
   * Bag currently being serviced, i.e. we are standing on it and holding for
   * the service window. Auto Loot drives its swaps off this.
   */
  heldBagObjectId: number | null;
}

const DEFAULT_OPTIONS: Required<ProdMafiaAutoPlayOptions> = {
  dungeons: true,
  stopAtVisibleQuest: true,
  collectSoulbound: true,
  smartSpacing: true,
  nexusRecovery: true,
  autoAim: true,
  autoAbility: true,
};

/**
 * Stateful TypeScript translation of GameSprite.autoPilot and its ap* helpers.
 * Flash rendering/logging concerns are omitted; target arbitration, timing,
 * Castle macro routes, bag service, separation, portal flow and exploration
 * retain ProdMafia's constants and ordering.
 */
export class ProdMafiaAutoPlayController {
  private enabled = false;
  private options = { ...DEFAULT_OPTIONS };
  private mapName = '';
  private mapEnteredAt = 0;
  private selectedRealmPortal = -1;
  private realmSelectionReadyAt = 0;
  private originalRealmName: string | null = null;
  private pendingRealmName: string | null = null;
  private dodgeYieldUntil = 0;
  private lastPortalAt = 0;
  private lastQuestId = -2;
  private dungeonSawQuest = false;
  private dungeonQuestCompleted = false;
  private dungeonLastActivityAt = 0;
  private beaconEntryDone = false;
  private nexusNoRealmSince = 0;
  private lastNexusRecovery = 0;
  private stuckRegionX = Number.NaN;
  private stuckRegionY = Number.NaN;
  private stuckRegionHits = 0;
  private lastObservedStuckCount = 0;
  private exploreHeading = 0;
  private exploreAt = 0;
  private exploreGoal = { x: Number.MIN_SAFE_INTEGER, y: Number.MIN_SAFE_INTEGER };
  private exploreGoalRevision = 0;
  private castleRouteSide = 0;
  private castleRouteIndex = 0;
  private castleLowerSpawn = false;
  private castleGuardianSeen = false;
  private castleGuardiansCompleted = false;
  private castleHandledStuckCount = 0;
  private readonly castleGuardianIds = new Set<number>();
  private followPlayerId = -1;
  private followPlayerX = 0;
  private followPlayerY = 0;
  private groupFollowAt = 0;
  private separationEnemyId = -1;
  private separationStartedAt = 0;
  private separationLastThreatAt = 0;
  private separationDirection = Number.NaN;
  private separationTarget = { x: Number.NaN, y: Number.NaN, at: 0 };
  private lastEnemyScanAt = 0;
  private cachedEnemyId = -1;
  private lastBagScanAt = 0;
  private cachedBagId = -1;
  private bagHoldId = -1;
  private bagHoldStarted = 0;
  private bagHoldLocationKey: string | null = null;
  private bagApproachId = -1;
  private bagApproachBestDistance = Infinity;
  private bagLastProgressAt = 0;
  private readonly servicedBagIds = new Set<number>();
  private readonly servicedBagLocations = new Map<string, number>();
  private state = disabledDecision();

  setEnabled(enabled: boolean, options: ProdMafiaAutoPlayOptions = {}): void {
    const wasEnabled = this.enabled;
    this.enabled = enabled;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    if (!enabled) {
      this.state = disabledDecision();
      if (wasEnabled) {
        this.originalRealmName = null;
        this.pendingRealmName = null;
      }
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getState(): ProdMafiaAutoPlayDecision {
    return cloneDecision(this.state);
  }

  tick(snapshot: ProdMafiaAutoPlaySnapshot): ProdMafiaAutoPlayDecision {
    if (!this.enabled) {
      this.state = disabledDecision();
      return this.getState();
    }
    if (snapshot.mapName !== this.mapName) this.resetForMap(snapshot);
    if (snapshot.dodgeOverrideActive) {
      this.dodgeYieldUntil = snapshot.time + DODGE_YIELD_MS;
      return this.commit(snapshot, 'dodge_yield', 'stop');
    }
    if (snapshot.time < this.dodgeYieldUntil) {
      return this.commit(snapshot, 'dodge_yield', 'stop');
    }

    const objects = snapshot.objects;
    const questCandidate = objects.find((object) => object.objectId === snapshot.questObjectId);
    let quest = questCandidate && !isStructural(questCandidate) ? questCandidate : undefined;
    let questId = quest?.objectId ?? -1;
    const dungeonMode = this.options.dungeons && snapshot.mapName !== 'Realm of the Mad God';
    const castleMode = isOryxCastle(snapshot.mapName);
    if (castleMode) {
      if (snapshot.pathStuckCount < this.castleHandledStuckCount) {
        this.castleHandledStuckCount = 0;
      } else {
        const stallLimit = quest && isStoneGuardian(quest)
          ? CASTLE_ROUTE_WAIT_GIVEUP
          : CASTLE_EXPLORE_STALL_GIVEUP;
        if (snapshot.pathStuckCount - this.castleHandledStuckCount >= stallLimit) {
          this.castleRouteIndex++;
          this.castleHandledStuckCount = snapshot.pathStuckCount;
        }
      }
    }

    if (snapshot.safeMap) return this.safeMapDecision(snapshot, objects);
    if (snapshot.mapName === 'Realm of the Mad God' && !this.beaconEntryDone
      && snapshot.time - this.mapEnteredAt >= 2500) {
      const beacon = selectBeacon(snapshot, objects);
      if (beacon && snapshot.teleportAllowed) {
        this.beaconEntryDone = true;
        return this.commit(snapshot, 'beacon_teleport', 'stop', {
          teleportObjectId: beacon.objectId,
        });
      }
      if (snapshot.time - this.mapEnteredAt >= 15_000) this.beaconEntryDone = true;
    }

    if (castleMode) {
      const chamber = progressionPortal(snapshot, objects);
      this.updateCastlePhase(snapshot, objects, quest, chamber);
      if (this.castleGuardiansCompleted && quest && !isStoneGuardian(quest)) quest = undefined;
      questId = quest?.objectId ?? -1;
    }
    if (dungeonMode && quest) this.dungeonSawQuest = true;
    if (questId !== this.lastQuestId) {
      if (dungeonMode && !castleMode && this.dungeonSawQuest && this.lastQuestId > 0 && questId <= 0) {
        this.dungeonQuestCompleted = true;
      }
      this.lastQuestId = questId;
    }

    const enemy = this.nearestEnemy(snapshot, objects);
    const bag = this.nearestSoulboundBag(snapshot, objects);
    const portal = !bag && dungeonMode && this.dungeonQuestCompleted
      ? progressionPortal(snapshot, objects)
      : undefined;
    if (dungeonMode && (quest || enemy || bag || portal || snapshot.hostileProjectileCount > 0)) {
      this.dungeonLastActivityAt = snapshot.time;
    }
    if (dungeonMode && isFixedOryxFlowMap(snapshot.mapName)
      && snapshot.time - this.dungeonLastActivityAt >= EMPTY_FIXED_INSTANCE_MS
      && this.options.nexusRecovery) {
      return this.commit(snapshot, 'empty_instance_recovery', 'stop', { nexus: true });
    }

    const combatTarget = quest && quest.definition?.isEnemy
      && distanceSquared(snapshot.position, quest) <= 196 ? quest : enemy;
    const recovery = quest ? this.questTeleportRecovery(snapshot, objects, quest) : undefined;
    if (recovery) return recovery;
    if (bag) {
      return this.commit(snapshot, 'soulbound_bag', 'path', {
        target: bag,
        targetObjectId: bag.objectId,
        arriveThreshold: 0.1,
        combatTargetObjectId: combatTarget?.objectId ?? null,
      });
    }

    const crowdEnemy = this.updateSeparation(snapshot, objects, quest);
    if (crowdEnemy) {
      const retreat = this.retreatTarget(snapshot, objects, crowdEnemy);
      return this.commit(snapshot, retreat ? 'enemy_separation' : 'enemy_separation_blocked',
        retreat ? 'direct' : 'stop', {
          target: retreat,
          targetObjectId: crowdEnemy.objectId,
          arriveThreshold: 0.12,
          combatTargetObjectId: combatTarget?.objectId ?? null,
        });
    }
    if (this.separationEnemyId >= 0
      && snapshot.time - this.separationLastThreatAt < CROWD_SEPARATION_RELEASE_MS
      && Number.isFinite(this.separationTarget.x)) {
      return this.commit(snapshot, 'enemy_separation_hold', 'direct', {
        target: this.separationTarget,
        arriveThreshold: 0.12,
        combatTargetObjectId: combatTarget?.objectId ?? null,
      });
    }
    if (portal) {
      const close = distanceSquared(snapshot.position, portal) <= 0.25;
      const usePortalObjectId = close && snapshot.time - this.lastPortalAt > 1500
        ? portal.objectId : null;
      if (usePortalObjectId !== null) this.lastPortalAt = snapshot.time;
      return this.commit(snapshot, 'dungeon_progression_portal', 'path', {
        target: portal,
        targetObjectId: portal.objectId,
        arriveThreshold: 0.08,
        usePortalObjectId,
        combatTargetObjectId: combatTarget?.objectId ?? null,
      });
    }

    if (quest && this.options.stopAtVisibleQuest
      && snapshot.canOccupy(snapshot.position.x, snapshot.position.y, true)
      && distance(snapshot.position, quest) <= questEngageDistance(snapshot.weaponRange)) {
      const questDistance = distance(snapshot.position, quest);
      const minimum = questMinimumDistance(snapshot.weaponRange);
      if (questDistance < minimum) {
        const retreat = this.retreatTarget(snapshot, objects, quest);
        return this.commit(snapshot, 'quest_minimum_range', retreat ? 'direct' : 'stop', {
          target: retreat,
          arriveThreshold: 0.12,
          combatTargetObjectId: combatTarget?.objectId ?? null,
        });
      }
      if (questDistance > minimum + 0.35
        && (isInvulnerable(quest) || snapshot.combatAimTargetObjectId === null)) {
        return this.commit(snapshot, 'visible_quest_engage', 'direct', {
          target: quest,
          targetObjectId: quest.objectId,
          arriveThreshold: minimum,
          combatTargetObjectId: combatTarget?.objectId ?? null,
        });
      }
      if (isInvulnerable(quest) || snapshot.combatAimTargetObjectId === null) {
        const spacing = proactiveSpacingTarget(snapshot);
        if (spacing) {
          return this.commit(snapshot, 'visible_quest_spacing', 'direct', {
            target: spacing,
            arriveThreshold: 0.12,
            movementSpeedScale: 0.45,
            combatTargetObjectId: combatTarget?.objectId ?? null,
          });
        }
      }
      return this.commit(snapshot, 'visible_quest_hold', 'stop', {
        combatTargetObjectId: combatTarget?.objectId ?? null,
      });
    }

    const castleSeekingGuardian = castleMode && !this.castleGuardiansCompleted && !quest;
    const moveTarget = quest ?? (!dungeonMode
      || !this.dungeonQuestCompleted && !castleSeekingGuardian ? enemy : undefined);
    if (moveTarget) {
      const castleWaypoint = castleMode && quest && isStoneGuardian(quest)
        ? this.castleWaypoint(snapshot.position)
        : undefined;
      if (castleWaypoint && !snapshot.hasExactPathTo(castleWaypoint.x, castleWaypoint.y)) {
        const group = this.groupFollowTarget(snapshot, objects);
        if (group) {
          return this.commit(snapshot, 'group_follow', 'path', {
            target: group,
            targetObjectId: group.objectId,
            arriveThreshold: 0.35,
            allowWallEscape: false,
            combatTargetObjectId: combatTarget?.objectId ?? null,
          });
        }
      }
      const target = castleWaypoint ?? moveTarget;
      return this.commit(snapshot, quest ? 'quest_path' : 'enemy_path', 'path', {
        target,
        targetObjectId: castleWaypoint ? -200_000 - this.castleRouteIndex : moveTarget.objectId,
        arriveThreshold: castleWaypoint ? 1.5 : questEngageDistance(snapshot.weaponRange),
        allowWallEscape: !castleWaypoint,
        combatTargetObjectId: combatTarget?.objectId ?? null,
      });
    }

    if (dungeonMode) {
      const group = this.groupFollowTarget(snapshot, objects);
      if (group) {
        return this.commit(snapshot, 'group_follow', 'path', {
          target: group,
          targetObjectId: group.objectId,
          arriveThreshold: 0.35,
          allowWallEscape: false,
          combatTargetObjectId: combatTarget?.objectId ?? null,
        });
      }
      const goal = this.explorationGoal(snapshot);
      return this.commit(snapshot, 'dungeon_explore', 'path', {
        target: goal,
        targetObjectId: -100_000 - this.exploreGoalRevision,
        arriveThreshold: 0.35,
        allowWallEscape: !castleMode,
        combatTargetObjectId: combatTarget?.objectId ?? null,
      });
    }

    const angle = snapshot.time / 2500;
    return this.commit(snapshot, 'realm_wander', 'direct', {
      target: {
        x: snapshot.position.x + Math.cos(angle) * 30,
        y: snapshot.position.y + Math.sin(angle) * 30,
      },
      arriveThreshold: 0.6,
      combatTargetObjectId: combatTarget?.objectId ?? null,
    });
  }

  private resetForMap(snapshot: ProdMafiaAutoPlaySnapshot): void {
    if (snapshot.mapName === 'Realm of the Mad God' && this.pendingRealmName !== null) {
      if (this.originalRealmName === null) this.originalRealmName = this.pendingRealmName;
      this.pendingRealmName = null;
    }
    this.mapName = snapshot.mapName;
    this.mapEnteredAt = snapshot.time;
    this.selectedRealmPortal = -1;
    this.realmSelectionReadyAt = 0;
    this.dodgeYieldUntil = 0;
    this.lastQuestId = -2;
    this.dungeonSawQuest = false;
    this.dungeonQuestCompleted = false;
    this.dungeonLastActivityAt = snapshot.time;
    this.beaconEntryDone = false;
    this.nexusNoRealmSince = 0;
    this.lastNexusRecovery = 0;
    this.stuckRegionX = Number.NaN;
    this.stuckRegionY = Number.NaN;
    this.stuckRegionHits = 0;
    this.lastObservedStuckCount = 0;
    this.exploreHeading = Math.random() * Math.PI * 2;
    this.exploreAt = 0;
    this.exploreGoal = { x: Number.MIN_SAFE_INTEGER, y: Number.MIN_SAFE_INTEGER };
    this.exploreGoalRevision = 0;
    this.castleRouteSide = snapshot.position.x < 128 ? -1 : 1;
    this.castleRouteIndex = 0;
    this.castleLowerSpawn = snapshot.position.y > 200;
    this.castleGuardianSeen = false;
    this.castleGuardiansCompleted = false;
    this.castleHandledStuckCount = 0;
    this.castleGuardianIds.clear();
    this.followPlayerId = -1;
    this.groupFollowAt = 0;
    this.clearSeparation();
    this.lastEnemyScanAt = 0;
    this.cachedEnemyId = -1;
    this.lastBagScanAt = 0;
    this.cachedBagId = -1;
    this.bagHoldId = -1;
    this.bagHoldLocationKey = null;
    this.bagApproachId = -1;
    this.servicedBagIds.clear();
    this.servicedBagLocations.clear();
  }

  private safeMapDecision(
    snapshot: ProdMafiaAutoPlaySnapshot,
    objects: readonly ProdMafiaAutoPlayObject[],
  ): ProdMafiaAutoPlayDecision {
    if (snapshot.inRealmQueue) {
      return this.commit(snapshot, 'realm_queue_wait', 'stop');
    }
    const portal = this.bestHubPortal(snapshot, objects);
    const hasRealmPortal = objects.some(isRealmPortal);
    if (snapshot.mapName === 'Nexus' && !portal && !hasRealmPortal) {
      if (this.nexusNoRealmSince === 0) this.nexusNoRealmSince = snapshot.time;
      else if (snapshot.time - this.nexusNoRealmSince >= 20_000) {
        const choices = snapshot.serverHosts.filter((host) =>
          host !== snapshot.currentServerHost
          && host !== '127.0.0.1'
          && host.toLowerCase() !== 'localhost');
        if (choices.length > 0) {
          this.nexusNoRealmSince = snapshot.time;
          return this.commit(snapshot, 'empty_server_switch', 'stop', {
            reconnectServerHost: choices[Math.floor(Math.random() * choices.length)]!,
          });
        }
      }
    } else {
      this.nexusNoRealmSince = 0;
    }
    if (portal) {
      const use = distanceSquared(snapshot.position, portal) <= 0.25
        && snapshot.time - this.lastPortalAt > 1500;
      if (use) this.lastPortalAt = snapshot.time;
      return this.commit(snapshot, 'hub_portal', 'path', {
        target: portal,
        targetObjectId: portal.objectId,
        arriveThreshold: 0.08,
        usePortalObjectId: use ? portal.objectId : null,
      });
    }
    if (snapshot.mapName !== 'Nexus'
      && this.options.nexusRecovery
      && snapshot.time - this.mapEnteredAt > 8000
      && snapshot.time - this.lastNexusRecovery > 10_000) {
      this.lastNexusRecovery = snapshot.time;
      return this.commit(snapshot, 'safe_map_nexus_recovery', 'stop', { nexus: true });
    }
    return this.commit(snapshot, 'hub_explore_north', 'direct', {
      target: { x: snapshot.position.x, y: snapshot.position.y - 30 },
      arriveThreshold: 0.6,
    });
  }

  private bestHubPortal(
    snapshot: ProdMafiaAutoPlaySnapshot,
    objects: readonly ProdMafiaAutoPlayObject[],
  ): ProdMafiaAutoPlayObject | undefined {
    const portals = objects.filter(isPortal);
    const realms = portals.filter(isRealmPortal);
    const originalRealm = this.originalRealmName === null
      ? undefined
      : realms.find((portal) => stableRealmName(portal) === this.originalRealmName);
    if (originalRealm) {
      this.selectedRealmPortal = originalRealm.objectId;
      this.pendingRealmName = stableRealmName(originalRealm);
      return originalRealm;
    }
    const retained = realms.find((portal) => portal.objectId === this.selectedRealmPortal);
    if (retained) return retained;
    if (realms.length > 0) {
      if (this.realmSelectionReadyAt === 0) {
        this.realmSelectionReadyAt = snapshot.time + (this.originalRealmName === null
          ? REALM_DISCOVERY_MS
          : ORIGINAL_REALM_DISCOVERY_MS);
        return undefined;
      }
      if (snapshot.time < this.realmSelectionReadyAt) return undefined;
      const selected = [...realms].sort((first, second) => {
        const population = portalPopulation(second) - portalPopulation(first);
        return population || distanceSquared(snapshot.position, first)
          - distanceSquared(snapshot.position, second);
      })[0];
      if (selected) {
        this.selectedRealmPortal = selected.objectId;
        this.pendingRealmName = stableRealmName(selected);
      }
      return selected;
    }
    if (snapshot.mapName !== 'Nexus') {
      return portals.filter((portal) => objectName(portal).includes('s.nexus'))
        .sort((first, second) => distanceSquared(snapshot.position, first)
          - distanceSquared(snapshot.position, second))[0];
    }
    return undefined;
  }

  private nearestEnemy(
    snapshot: ProdMafiaAutoPlaySnapshot,
    objects: readonly ProdMafiaAutoPlayObject[],
  ): ProdMafiaAutoPlayObject | undefined {
    if (snapshot.time - this.lastEnemyScanAt < TARGET_SCAN_INTERVAL_MS) {
      const cached = objects.find((object) => object.objectId === this.cachedEnemyId);
      if (cached && isCharacterEnemy(cached)) return cached;
    }
    const best = objects.filter(isCharacterEnemy)
      .sort((first, second) => distanceSquared(snapshot.position, first)
        - distanceSquared(snapshot.position, second))[0];
    this.lastEnemyScanAt = snapshot.time;
    this.cachedEnemyId = best?.objectId ?? -1;
    return best;
  }

  private nearestSoulboundBag(
    snapshot: ProdMafiaAutoPlaySnapshot,
    objects: readonly ProdMafiaAutoPlayObject[],
  ): ProdMafiaAutoPlayObject | undefined {
    if (!this.options.collectSoulbound) return undefined;
    if (this.bagHoldId >= 0) {
      const held = objects.find((object) => object.objectId === this.bagHoldId);
      const heldMs = snapshot.time - this.bagHoldStarted;
      const desiredLootRemaining = held?.equipment?.some(
        (itemType) => itemType > 0 && (snapshot.wantsLoot?.(itemType) ?? true),
      ) ?? false;
      if (held && (heldMs < BAG_MIN_HOLD_MS
        || heldMs < BAG_MAX_HOLD_MS && desiredLootRemaining)) return held;
      this.servicedBagIds.add(this.bagHoldId);
      const locationKey = held ? bagLocationKey(held) : this.bagHoldLocationKey;
      if (locationKey) this.servicedBagLocations.set(locationKey,
        snapshot.time + BAG_LOCATION_COOLDOWN_MS);
      this.bagHoldId = -1;
      this.bagHoldLocationKey = null;
    }
    if (snapshot.time - this.lastBagScanAt < BAG_SCAN_INTERVAL_MS) {
      return objects.find((object) => object.objectId === this.cachedBagId
        && isEligibleBag(object, snapshot, this.servicedBagIds, this.servicedBagLocations));
    }
    const candidates = objects.filter((object) =>
      isEligibleBag(object, snapshot, this.servicedBagIds, this.servicedBagLocations)
      && distanceSquared(snapshot.position, object) <= BAG_MAX_DISTANCE_SQUARED);
    const best = candidates.sort((first, second) =>
      bagTier(second) - bagTier(first)
      || distanceSquared(snapshot.position, first) - distanceSquared(snapshot.position, second))[0];
    this.lastBagScanAt = snapshot.time;
    this.cachedBagId = best?.objectId ?? -1;
    if (!best) {
      this.bagApproachId = -1;
      return undefined;
    }
    const currentDistance = distance(snapshot.position, best);
    if (this.bagApproachId !== best.objectId) {
      this.bagApproachId = best.objectId;
      this.bagApproachBestDistance = currentDistance;
      this.bagLastProgressAt = snapshot.time;
    } else if (currentDistance <= this.bagApproachBestDistance - BAG_PROGRESS_DISTANCE) {
      this.bagApproachBestDistance = currentDistance;
      this.bagLastProgressAt = snapshot.time;
    } else if (snapshot.time - this.bagLastProgressAt >= BAG_STALL_TIMEOUT_MS) {
      this.servicedBagIds.add(best.objectId);
      this.servicedBagLocations.set(bagLocationKey(best), snapshot.time + BAG_LOCATION_COOLDOWN_MS);
      this.bagApproachId = -1;
      this.cachedBagId = -1;
      return undefined;
    }
    if (currentDistance * currentDistance <= 0.09) {
      this.bagHoldId = best.objectId;
      this.bagHoldStarted = snapshot.time;
      this.bagHoldLocationKey = bagLocationKey(best);
      this.bagApproachId = -1;
    }
    return best;
  }

  private updateSeparation(
    snapshot: ProdMafiaAutoPlaySnapshot,
    objects: readonly ProdMafiaAutoPlayObject[],
    quest: ProdMafiaAutoPlayObject | undefined,
  ): ProdMafiaAutoPlayObject | undefined {
    let active = objects.find((object) => object.objectId === this.separationEnemyId);
    const replacement = objects.filter((object) => isCharacterEnemy(object)
      && object.objectId !== quest?.objectId
      && distance(snapshot.position, object) < this.separationRadius(snapshot, object, !!active))
      .sort((first, second) => distanceSquared(snapshot.position, first)
        - distanceSquared(snapshot.position, second))[0];
    if (active && active.objectId !== quest?.objectId
      && distance(snapshot.position, active) < this.separationRadius(snapshot, active, true)) {
      this.separationLastThreatAt = snapshot.time;
    } else if (active && replacement) {
      active = replacement;
      this.separationEnemyId = replacement.objectId;
      this.separationLastThreatAt = snapshot.time;
    } else if (active && snapshot.time - this.separationStartedAt >= CROWD_SEPARATION_MIN_HOLD_MS
      && snapshot.time - this.separationLastThreatAt >= CROWD_SEPARATION_RELEASE_MS) {
      this.clearSeparation();
      active = undefined;
    } else if (active) {
      active = undefined;
    }
    if (this.separationEnemyId < 0 && replacement) {
      active = replacement;
      this.separationEnemyId = replacement.objectId;
      this.separationStartedAt = snapshot.time;
      this.separationLastThreatAt = snapshot.time;
      this.separationTarget = { x: Number.NaN, y: Number.NaN, at: 0 };
    }
    return active;
  }

  private separationRadius(
    snapshot: ProdMafiaAutoPlaySnapshot,
    enemy: ProdMafiaAutoPlayObject,
    exiting: boolean,
  ): number {
    if (enemy.type === 0x4266) {
      return exiting ? CLOSE_SHOT_SEPARATION_EXIT : CLOSE_SHOT_SEPARATION_ENTER;
    }
    let base = exiting ? CROWD_SEPARATION_EXIT : CROWD_SEPARATION_ENTER;
    if (this.options.smartSpacing) {
      const smart = shooterSeparationRadius(snapshot, enemy);
      if (smart > 0) {
        const reach = Math.max(SMART_SEPARATION_MIN,
          snapshot.weaponRange - SMART_SEPARATION_BAND - 0.5);
        const bounded = Math.min(smart, reach);
        base = exiting ? bounded + SMART_SEPARATION_BAND : bounded;
      }
    }
    const reserve = Math.max(0, snapshot.moveSpeed - SEPARATION_BASE_SPEED)
      * SEPARATION_RESERVE_MS;
    return base + Math.min(SEPARATION_MAX_RESERVE, reserve);
  }

  private retreatTarget(
    snapshot: ProdMafiaAutoPlaySnapshot,
    objects: readonly ProdMafiaAutoPlayObject[],
    enemy: ProdMafiaAutoPlayObject,
  ): { x: number; y: number } | undefined {
    if (Number.isFinite(this.separationTarget.x)
      && snapshot.time - this.separationTarget.at < SEPARATION_TARGET_REPLAN_MS
      && snapshot.canOccupy(this.separationTarget.x, this.separationTarget.y, true)) {
      return { x: this.separationTarget.x, y: this.separationTarget.y };
    }
    const crowd = objects.filter((object) => isCharacterEnemy(object)
      && distance(snapshot.position, object) <= this.separationRadius(snapshot, object, true));
    let repulsionX = 0;
    let repulsionY = 0;
    for (const member of crowd) {
      const dx = snapshot.position.x - member.x;
      const dy = snapshot.position.y - member.y;
      const squared = dx * dx + dy * dy;
      if (squared < 0.0001) continue;
      const length = Math.sqrt(squared);
      const weight = 1 / Math.max(0.25, squared);
      repulsionX += dx / length * weight;
      repulsionY += dy / length * weight;
    }
    const away = repulsionX * repulsionX + repulsionY * repulsionY > 0.000001
      ? Math.atan2(repulsionY, repulsionX)
      : Math.atan2(snapshot.position.y - enemy.y, snapshot.position.x - enemy.x);
    let bestAngle = Number.NaN;
    let bestScore = -1;
    for (let offsetStep = 0; offsetStep < 16; offsetStep++) {
      const signedStep = offsetStep === 0 ? 0
        : (offsetStep & 1) === 1 ? (offsetStep + 1) / 2 : -offsetStep / 2;
      const angle = away + signedStep * Math.PI / 16;
      const testX = snapshot.position.x + Math.cos(angle) * 0.8;
      const testY = snapshot.position.y + Math.sin(angle) * 0.8;
      if (!snapshot.canOccupy(testX, testY, true)
        || !snapshot.canTraverse(snapshot.position.x, snapshot.position.y, testX, testY)) continue;
      let minimumDistance = distanceSquared({ x: testX, y: testY }, enemy);
      for (const member of crowd) {
        minimumDistance = Math.min(minimumDistance,
          distanceSquared({ x: testX, y: testY }, member));
      }
      const stableBonus = Number.isNaN(this.separationDirection) ? 0
        : 0.2 * (1 + Math.cos(angle - this.separationDirection));
      if (minimumDistance + stableBonus > bestScore) {
        bestScore = minimumDistance + stableBonus;
        bestAngle = angle;
      }
    }
    if (Number.isNaN(bestAngle)) return undefined;
    this.separationDirection = bestAngle;
    this.separationTarget = {
      x: snapshot.position.x + Math.cos(bestAngle) * 0.8,
      y: snapshot.position.y + Math.sin(bestAngle) * 0.8,
      at: snapshot.time,
    };
    return { x: this.separationTarget.x, y: this.separationTarget.y };
  }

  private updateCastlePhase(
    snapshot: ProdMafiaAutoPlaySnapshot,
    objects: readonly ProdMafiaAutoPlayObject[],
    quest: ProdMafiaAutoPlayObject | undefined,
    chamber: ProdMafiaAutoPlayObject | undefined,
  ): void {
    if (this.castleGuardiansCompleted) return;
    const guardians = objects.filter(isStoneGuardian);
    for (const guardian of guardians) {
      this.castleGuardianSeen = true;
      this.castleGuardianIds.add(guardian.objectId);
    }
    const nearRoom = distanceSquared(snapshot.position, { x: 128.5, y: 60.5 }) <= 35 * 35;
    const routeNearEnd = this.castleRouteIndex >= Math.max(0, this.castleRoute().length - 1);
    if (chamber
      || this.castleGuardianIds.size >= 2 && guardians.length === 0 && nearRoom
      || quest && objectName(quest).includes('janus') && nearRoom && routeNearEnd) {
      this.castleGuardiansCompleted = true;
      this.dungeonQuestCompleted = true;
    }
  }

  private castleRoute(): readonly (readonly [number, number])[] {
    if (this.castleLowerSpawn) {
      return this.castleRouteSide < 0 ? CASTLE_LEFT_ROUTE : CASTLE_RIGHT_ROUTE;
    }
    return this.castleRouteSide < 0 ? CASTLE_LEFT_SIDE_ROUTE : CASTLE_RIGHT_SIDE_ROUTE;
  }

  private castleWaypoint(position: { x: number; y: number }): { x: number; y: number } | undefined {
    const route = this.castleRoute();
    let closestIndex = this.castleRouteIndex;
    let closestDistance = Infinity;
    for (let index = this.castleRouteIndex; index < route.length; index++) {
      const [x, y] = route[index]!;
      const candidateDistance = distanceSquared(position, { x, y });
      if (candidateDistance < closestDistance) {
        closestDistance = candidateDistance;
        closestIndex = index;
      }
    }
    if (closestIndex > this.castleRouteIndex && closestDistance <= 36) {
      this.castleRouteIndex = closestIndex;
    }
    while (this.castleRouteIndex < route.length) {
      const [x, y] = route[this.castleRouteIndex]!;
      if (distanceSquared(position, { x, y }) > 16) return { x, y };
      this.castleRouteIndex++;
    }
    return undefined;
  }

  private groupFollowTarget(
    snapshot: ProdMafiaAutoPlaySnapshot,
    objects: readonly ProdMafiaAutoPlayObject[],
  ): ProdMafiaAutoPlayObject | undefined {
    if (!isGroupFollowMap(snapshot.mapName)) return undefined;
    if (snapshot.time - this.groupFollowAt < 2000 && this.followPlayerId >= 0) {
      const retained = objects.find((object) => object.objectId === this.followPlayerId);
      if (retained) return {
        ...retained,
        x: this.followPlayerX,
        y: this.followPlayerY,
      };
    }
    const players = objects.filter((object) => object.definition?.isPlayer
      && distance(snapshot.position, object) >= 2 && distance(snapshot.position, object) <= 60);
    const castle = isOryxCastle(snapshot.mapName);
    const selfFinalDistance = distance(snapshot.position, { x: 128.5, y: 60.5 });
    const ranked = players.map((player) => {
      const playerDistance = distance(snapshot.position, player);
      let score: number;
      if (castle) {
        const finalDistance = distance(player, { x: 128.5, y: 60.5 });
        if (finalDistance + 5 >= selfFinalDistance) return { player, score: Infinity };
        score = playerDistance + finalDistance * 0.25;
      } else {
        const neighbours = players.filter((other) => other !== player
          && distanceSquared(other, player) <= 36).length;
        score = playerDistance - neighbours * 8;
      }
      if (player.objectId === this.followPlayerId) score -= 1000;
      return { player, score };
    }).filter((entry) => Number.isFinite(entry.score))
      .sort((first, second) => first.score - second.score);
    const selected = ranked.slice(0, 3)
      .map((entry) => entry.player)
      .find((player) => snapshot.hasExactPathTo(player.x, player.y));
    this.followPlayerId = selected?.objectId ?? -1;
    this.groupFollowAt = snapshot.time;
    if (selected) {
      this.followPlayerX = selected.x;
      this.followPlayerY = selected.y;
    }
    return selected;
  }

  private explorationGoal(snapshot: ProdMafiaAutoPlaySnapshot): { x: number; y: number } {
    const elapsed = snapshot.time - this.exploreAt;
    const refreshMs = isGroupFollowMap(snapshot.mapName) ? 2000 : 8000;
    if (elapsed < refreshMs
      && (!snapshot.pathRouteEmpty || elapsed < 1000)
      && this.exploreGoal.x !== Number.MIN_SAFE_INTEGER) {
      return { ...this.exploreGoal };
    }
    const castle = isOryxCastle(snapshot.mapName);
    const castlePoint = castle ? this.castleWaypoint(snapshot.position) : undefined;
    if (castlePoint) {
      this.exploreGoal = castlePoint;
    } else {
      this.exploreHeading += 2.399963229728653;
      this.exploreGoal = {
        x: Math.trunc(snapshot.position.x + Math.cos(this.exploreHeading) * 80),
        y: Math.trunc(snapshot.position.y + Math.sin(this.exploreHeading) * 80),
      };
    }
    this.exploreAt = snapshot.time;
    this.exploreGoalRevision++;
    return { ...this.exploreGoal };
  }

  private questTeleportRecovery(
    snapshot: ProdMafiaAutoPlaySnapshot,
    objects: readonly ProdMafiaAutoPlayObject[],
    quest: ProdMafiaAutoPlayObject,
  ): ProdMafiaAutoPlayDecision | undefined {
    if (snapshot.pathStuckCount <= this.lastObservedStuckCount) return undefined;
    this.lastObservedStuckCount = snapshot.pathStuckCount;
    if (Number.isNaN(this.stuckRegionX)
      || distanceSquared(snapshot.position, {
        x: this.stuckRegionX,
        y: this.stuckRegionY,
      }) > 576) {
      this.stuckRegionX = snapshot.position.x;
      this.stuckRegionY = snapshot.position.y;
      this.stuckRegionHits = 1;
    } else {
      this.stuckRegionHits++;
    }
    if (this.stuckRegionHits < 3 && snapshot.pathStuckCount < 3) return undefined;
    if (!snapshot.teleportAllowed) {
      this.stuckRegionHits = 2;
      return undefined;
    }
    const failed = { x: this.stuckRegionX, y: this.stuckRegionY };
    const players = objects.filter((object) =>
      !!object.definition?.isPlayer
      && distanceSquared(snapshot.position, object) >= 16
      && distanceSquared(failed, object) > 6.5 * 6.5)
      .sort((first, second) =>
        distanceSquared(first, quest) - distanceSquared(second, quest));
    const destination = players[0] ?? selectBeacon(snapshot, objects);
    if (!destination) {
      this.stuckRegionHits = 2;
      return undefined;
    }
    this.stuckRegionHits = 0;
    this.stuckRegionX = Number.NaN;
    this.stuckRegionY = Number.NaN;
    return this.commit(snapshot, 'stuck_quest_teleport_recovery', 'stop', {
      teleportObjectId: destination.objectId,
    });
  }

  private clearSeparation(): void {
    this.separationEnemyId = -1;
    this.separationDirection = Number.NaN;
    this.separationTarget = { x: Number.NaN, y: Number.NaN, at: 0 };
  }

  private commit(
    snapshot: ProdMafiaAutoPlaySnapshot,
    state: string,
    navigationMode: ProdMafiaAutoPlayNavigationMode,
    patch: Partial<ProdMafiaAutoPlayDecision> = {},
  ): ProdMafiaAutoPlayDecision {
    this.state = {
      enabled: true,
      state,
      navigationMode,
      target: null,
      targetObjectId: null,
      arriveThreshold: 0.6,
      allowWallEscape: !isOryxCastle(snapshot.mapName),
      usePortalObjectId: null,
      teleportObjectId: null,
      nexus: false,
      autoAim: this.options.autoAim,
      autoAbility: this.options.autoAbility,
      combatTargetObjectId: null,
      reconnectServerHost: null,
      movementSpeedScale: 1,
      heldBagObjectId: this.bagHoldId >= 0 ? this.bagHoldId : null,
      ...patch,
      ...(patch.target
        ? { target: { x: patch.target.x, y: patch.target.y } }
        : {}),
    };
    return this.getState();
  }
}

function disabledDecision(): ProdMafiaAutoPlayDecision {
  return {
    enabled: false,
    state: 'disabled',
    navigationMode: 'stop',
    target: null,
    targetObjectId: null,
    arriveThreshold: 0.6,
    allowWallEscape: true,
    usePortalObjectId: null,
    teleportObjectId: null,
    nexus: false,
    autoAim: false,
    autoAbility: false,
    combatTargetObjectId: null,
    reconnectServerHost: null,
    movementSpeedScale: 1,
    heldBagObjectId: null,
  };
}

function cloneDecision(decision: ProdMafiaAutoPlayDecision): ProdMafiaAutoPlayDecision {
  return { ...decision, target: decision.target ? { ...decision.target } : null };
}

function objectName(object: ProdMafiaAutoPlayObject): string {
  return String(object.name ?? object.definition?.displayId ?? object.definition?.id ?? '').toLowerCase();
}

function isPortal(object: ProdMafiaAutoPlayObject): boolean {
  return object.type === 0x0712
    || object.definition?.objectClass?.toLowerCase() === 'portal'
    || !!object.definition?.dungeonName;
}

function isRealmPortal(object: ProdMafiaAutoPlayObject): boolean {
  const name = objectName(object);
  return object.type === 0x0712 || name.includes('(') && name.includes('/');
}

function portalPopulation(object: ProdMafiaAutoPlayObject): number {
  const match = objectName(object).match(/\((\d+)\//);
  return match ? Number(match[1]) : -1;
}

function isCharacterEnemy(object: ProdMafiaAutoPlayObject): boolean {
  return !!object.definition?.isEnemy && object.definition.isCharacter !== false
    && !object.definition.invincible && !isInvulnerable(object);
}

function isInvulnerable(object: ProdMafiaAutoPlayObject): boolean {
  const condition = Number(
    object.player?.condition
    ?? object.rawStats?.[String(StatType.CONDITION_STAT)]
    ?? 0,
  ) >>> 0;
  return !!object.definition?.invincible
    || (condition & ConditionEffectBits.INVINCIBLE) !== 0
    || (condition & ConditionEffectBits.INVULNERABLE) !== 0;
}

function isStructural(object: ProdMafiaAutoPlayObject): boolean {
  const definition = object.definition;
  if (!definition || definition.isCharacter) return false;
  const name = objectName(object);
  return name.includes('wall') || !!definition.fullOccupy
    || !!definition.occupySquare || !!definition.static;
}

function isStoneGuardian(object: ProdMafiaAutoPlayObject): boolean {
  if (GUARDIAN_TYPES.has(object.type)) return true;
  const name = objectName(object);
  return name.includes('stone guardian') && !name.includes('support') && !name.includes('sword');
}

function progressionPortal(
  snapshot: ProdMafiaAutoPlaySnapshot,
  objects: readonly ProdMafiaAutoPlayObject[],
): ProdMafiaAutoPlayObject | undefined {
  const lower = snapshot.mapName.toLowerCase();
  const castle = lower.includes("oryx's castle");
  const chamber = lower.includes("oryx's chamber");
  return objects.filter(isPortal).filter((portal) => {
    const name = objectName(portal);
    if (castle) return portal.type === 0x0d7b || portal.type === 0x0634
      || name.includes("oryx's chamber");
    if (chamber) return name.includes('wine cellar');
    if (lower.includes('wine cellar')) return name.includes('sanctuary');
    return true;
  }).sort((first, second) => {
    const priority = (portal: ProdMafiaAutoPlayObject): number => {
      const name = objectName(portal);
      if (castle || chamber || lower.includes('wine cellar') && name.includes('sanctuary')) return 0;
      if (!name.includes('nexus') && !name.includes('realm')) return 10;
      return 50;
    };
    return priority(first) * 100_000 + distanceSquared(snapshot.position, first)
      - (priority(second) * 100_000 + distanceSquared(snapshot.position, second));
  })[0];
}

function selectBeacon(
  snapshot: ProdMafiaAutoPlaySnapshot,
  objects: readonly ProdMafiaAutoPlayObject[],
): ProdMafiaAutoPlayObject | undefined {
  const tier = snapshot.level >= 20 ? 'veteran' : snapshot.level > 10 ? 'adept' : 'rookie';
  const beacons = objects.filter((object) => objectName(object).includes('beacon'));
  const tierMatches = beacons.filter((beacon) => objectName(beacon).includes(tier));
  const pool = tierMatches.length > 0 ? tierMatches : beacons;
  return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : undefined;
}

function shooterSeparationRadius(
  snapshot: ProdMafiaAutoPlaySnapshot,
  enemy: ProdMafiaAutoPlayObject,
): number {
  if (!enemy.definition?.hasProjectiles) return 0;
  let fastest = 0;
  const projectileIds = new Set<number>([0]);
  for (const subattack of enemy.definition.subattacks ?? []) {
    for (const pattern of subattack.patterns) projectileIds.add(pattern.projectileId);
  }
  for (const id of projectileIds) fastest = Math.max(fastest, snapshot.projectile(enemy.type, id)?.speed ?? 0);
  if (fastest <= 0) return 0;
  return Math.max(SMART_SEPARATION_MIN,
    Math.min(SMART_SEPARATION_MAX, fastest / 10_000 * 400));
}

function isEligibleBag(
  object: ProdMafiaAutoPlayObject,
  snapshot: ProdMafiaAutoPlaySnapshot,
  servicedIds: ReadonlySet<number>,
  servicedLocations: ReadonlyMap<string, number>,
): boolean {
  return !!object.definition?.isContainer
    && !!object.definition.isLoot
    && bagTier(object) >= 3
    && !!object.equipment?.some(
      (itemType) => itemType > 0 && (snapshot.wantsLoot?.(itemType) ?? true),
    )
    && !servicedIds.has(object.objectId)
    && (servicedLocations.get(bagLocationKey(object)) ?? 0) <= snapshot.time;
}

function bagTier(object: ProdMafiaAutoPlayObject): number {
  const match = object.definition?.id?.match(/^Loot Bag (\d+)/);
  if (match) return Number(match[1]);
  return BAG_TIERS.get(object.type) ?? -1;
}

function bagLocationKey(object: ProdMafiaAutoPlayObject): string {
  return `${object.type}:${Math.trunc(object.x * 4)}:${Math.trunc(object.y * 4)}`;
}

function stableRealmName(object: ProdMafiaAutoPlayObject): string {
  const name = String(object.name ?? object.definition?.displayId ?? object.definition?.id ?? '');
  const suffix = name.indexOf(' (');
  return (suffix >= 0 ? name.slice(0, suffix) : name).toLowerCase();
}

function proactiveSpacingTarget(
  snapshot: ProdMafiaAutoPlaySnapshot,
): { x: number; y: number } | undefined {
  let bestAngle = Number.NaN;
  let bestOpen = -1;
  let worstOpen = SPACING_PROBE_TILES;
  for (let index = 0; index < 32; index++) {
    const angle = index * Math.PI * 2 / 32;
    let open = SPACING_PROBE_TILES;
    for (
      let travelled = SPACING_STEP_TILES;
      travelled <= SPACING_PROBE_TILES + 0.001;
      travelled += SPACING_STEP_TILES
    ) {
      const x = snapshot.position.x + Math.cos(angle) * travelled;
      const y = snapshot.position.y + Math.sin(angle) * travelled;
      if (!snapshot.canOccupy(x, y, true)
        || !snapshot.canTraverse(snapshot.position.x, snapshot.position.y, x, y)) {
        open = travelled - SPACING_STEP_TILES;
        break;
      }
    }
    worstOpen = Math.min(worstOpen, open);
    if (open > bestOpen) {
      bestOpen = open;
      bestAngle = angle;
    }
  }
  if (Number.isNaN(bestAngle)
    || worstOpen >= SPACING_PROBE_TILES
    || bestOpen < worstOpen + SPACING_MIN_GAIN_TILES) return undefined;
  return {
    x: snapshot.position.x + Math.cos(bestAngle) * SPACING_PROBE_TILES,
    y: snapshot.position.y + Math.sin(bestAngle) * SPACING_PROBE_TILES,
  };
}

function questEngageDistance(weaponRange: number): number {
  return Math.max(4, (weaponRange > 0 ? weaponRange : 4) - 0.8);
}

function questMinimumDistance(weaponRange: number): number {
  return Math.max(3.25, questEngageDistance(weaponRange) * 0.65);
}

function isOryxCastle(mapName: string): boolean {
  return mapName.toLowerCase().includes("oryx's castle");
}

function isGroupFollowMap(mapName: string): boolean {
  const lower = mapName.toLowerCase();
  return lower.includes("oryx's castle")
    || lower.includes('wine cellar')
    || lower.includes("oryx's sanctuary");
}

function isFixedOryxFlowMap(mapName: string): boolean {
  const lower = mapName.toLowerCase();
  return isGroupFollowMap(mapName) || lower.includes("oryx's chamber");
}

function distance(first: { x: number; y: number }, second: { x: number; y: number }): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function distanceSquared(first: { x: number; y: number }, second: { x: number; y: number }): number {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  return dx * dx + dy * dy;
}
