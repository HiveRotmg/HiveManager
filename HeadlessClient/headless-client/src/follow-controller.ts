import type { PortalCandidate } from './portal-automation';

/**
 * Follow, anchor and teleport primitives ported from ProdMafia:
 *
 * - `/follow <name>` state and its per-frame movement
 *   (`ParseChatMessageCommand.cmdFollow` at :486-505, `Player.update` at
 *   :944-960).
 * - Follow into portals (`Parameters.data.followIntoPortals`,
 *   `Player.removeFromMap` at :1467-1474).
 * - Named-anchor teleport (`Parameters.data.anchorName` / `anchorTeleport`,
 *   MapUserInput.as:799-800, PlayerMenu.as:124).
 * - Quest teleport (`MapUserInput.teleQuest` at :196-226) and the shared
 *   closest-player selection it shares with `Player.teleToClosestPoint`
 *   (Player.as:2184-2203).
 */

/** A visible player considered for following or teleporting. */
export interface FollowPlayer {
  objectId: number;
  name?: string;
  x: number;
  y: number;
  /** Invisible players are never teleport destinations (Player.as:2189). */
  invisible?: boolean;
}

export interface FollowOptions {
  /**
   * Squared distance beyond which the follower teleports instead of walking
   * (`Parameters.data.teleDistance`). The reference build ships no default for
   * this key, so 100 (10 tiles) is ours.
   */
  teleportDistanceSquared: number;
  /**
   * Minimum gap between follow teleports (`Parameters.data.fameTpCdTime`).
   * Also undefaulted upstream; 6s matches the server's fame-teleport cooldown.
   */
  teleportCooldownMs: number;
  /** How close counts as caught up. */
  arriveThreshold: number;
  /**
   * `Parameters.data.followIntoPortals`: when the followed player vanishes next
   * to a portal, take the same portal.
   */
  followIntoPortals: boolean;
  /**
   * Squared distance from the followed player's last position within which a
   * portal counts as the one they took (Player.as:1469).
   */
  portalFollowDistanceSquared: number;
}

export const DEFAULT_FOLLOW_OPTIONS: FollowOptions = {
  teleportDistanceSquared: 100,
  teleportCooldownMs: 6000,
  arriveThreshold: 1.5,
  followIntoPortals: false,
  portalFollowDistanceSquared: 1,
};

export interface FollowSnapshot {
  time: number;
  position: { x: number; y: number };
  selfObjectId: number;
  /** Visible players. Include this client's own player so teleports can be skipped. */
  players: readonly FollowPlayer[];
  teleportAllowed: boolean;
}

export interface FollowDecision {
  state: 'idle' | 'searching' | 'following' | 'arrived' | 'teleporting';
  followName: string | null;
  target: { x: number; y: number } | null;
  targetObjectId: number | null;
  teleportObjectId: number | null;
}

/** Result of picking a teleport destination near a point. */
export type PlayerTeleportSelection =
  | { kind: 'none' }
  | { kind: 'self_closest' }
  | { kind: 'teleport'; objectId: number; name?: string };

/**
 * The player closest to `point`, skipping invisible ones. Exact port of
 * `Player.teleToClosestPoint` (Player.as:2184-2203): when the local player is
 * the closest, nothing is sent. `players` must include the local player.
 */
export function selectClosestPlayerTeleport(
  point: { x: number; y: number },
  players: readonly FollowPlayer[],
  selfObjectId: number,
): PlayerTeleportSelection {
  let best: FollowPlayer | undefined;
  let bestDistanceSquared = Infinity;
  for (const player of players) {
    if (player.invisible) {
      continue;
    }
    const distanceSquared = squaredDistance(player, point);
    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      best = player;
    }
  }
  if (!best) {
    return { kind: 'none' };
  }
  if (best.objectId === selfObjectId) {
    return { kind: 'self_closest' };
  }
  return { kind: 'teleport', objectId: best.objectId, name: best.name };
}

export type QuestTeleportSelection =
  | { kind: 'no_quest' }
  | { kind: 'quest_not_visible' }
  | PlayerTeleportSelection;

/**
 * Quest teleport: the visible player closest to your quest object. Exact port
 * of `MapUserInput.teleQuest` (MapUserInput.as:196-226). `players` must include
 * the local player, so "You are closest!" is reported rather than teleporting
 * to yourself.
 */
export function selectQuestTeleportTarget(input: {
  questObjectId: number;
  questPosition?: { x: number; y: number };
  players: readonly FollowPlayer[];
  selfObjectId: number;
}): QuestTeleportSelection {
  if (input.questObjectId <= 0) {
    return { kind: 'no_quest' };
  }
  if (!input.questPosition) {
    return { kind: 'quest_not_visible' };
  }
  return selectClosestPlayerTeleport(input.questPosition, input.players, input.selfObjectId);
}

/**
 * The chat command ProdMafia's anchor hotkey sends (MapUserInput.as:800), or
 * undefined when no anchor is set.
 */
export function anchorTeleportCommand(anchorName: string): string | undefined {
  const trimmed = anchorName.trim();
  return trimmed === '' ? undefined : `/teleport ${trimmed}`;
}

/** Drives `/follow <name>`, including its teleport catch-up and portal following. */
export class FollowController {
  private options: FollowOptions = { ...DEFAULT_FOLLOW_OPTIONS };
  private followName: string | null = null;
  private lastTeleportAt = 0;
  private lastSeen: { objectId: number; x: number; y: number; time: number } | undefined;

  configure(options: Partial<FollowOptions>): FollowOptions {
    this.options = { ...this.options, ...options };
    return { ...this.options };
  }

  getOptions(): FollowOptions {
    return { ...this.options };
  }

  /** `cmdFollow`: an empty or blank name stops following. */
  follow(name: string): boolean {
    const trimmed = name.trim();
    if (trimmed === '') {
      this.stop();
      return false;
    }
    this.followName = trimmed.toUpperCase();
    this.lastTeleportAt = 0;
    this.lastSeen = undefined;
    return true;
  }

  stop(): void {
    this.followName = null;
    this.lastSeen = undefined;
  }

  isFollowing(): boolean {
    return this.followName !== null;
  }

  /** The followed name, upper-cased as ProdMafia stores it. */
  getFollowName(): string | null {
    return this.followName;
  }

  tick(snapshot: FollowSnapshot): FollowDecision {
    if (this.followName === null) {
      return idleDecision();
    }
    const target = snapshot.players.find(
      (player) => player.objectId !== snapshot.selfObjectId
        && (player.name ?? '').toUpperCase() === this.followName,
    );
    if (!target) {
      return {
        state: 'searching',
        followName: this.followName,
        target: null,
        targetObjectId: null,
        teleportObjectId: null,
      };
    }
    this.lastSeen = { objectId: target.objectId, x: target.x, y: target.y, time: snapshot.time };
    const distanceSquared = squaredDistance(snapshot.position, target);
    if (
      snapshot.teleportAllowed
      && snapshot.time - this.lastTeleportAt > this.options.teleportCooldownMs
      && distanceSquared > this.options.teleportDistanceSquared
    ) {
      const selection = selectClosestPlayerTeleport(target, snapshot.players, snapshot.selfObjectId);
      if (selection.kind === 'teleport') {
        this.lastTeleportAt = snapshot.time;
        return {
          state: 'teleporting',
          followName: this.followName,
          target: { x: target.x, y: target.y },
          targetObjectId: target.objectId,
          teleportObjectId: selection.objectId,
        };
      }
    }
    if (Math.sqrt(distanceSquared) <= this.options.arriveThreshold) {
      return {
        state: 'arrived',
        followName: this.followName,
        target: null,
        targetObjectId: target.objectId,
        teleportObjectId: null,
      };
    }
    return {
      state: 'following',
      followName: this.followName,
      target: { x: target.x, y: target.y },
      targetObjectId: target.objectId,
      teleportObjectId: null,
    };
  }

  /**
   * The followed player left the map. With `followIntoPortals` on, returns the
   * portal they were standing on so the caller can take it too
   * (Player.as:1467-1474).
   */
  portalToFollow(
    removed: FollowPlayer,
    portals: readonly PortalCandidate[],
  ): PortalCandidate | undefined {
    if (!this.options.followIntoPortals || this.followName === null) {
      return undefined;
    }
    if ((removed.name ?? '').toUpperCase() !== this.followName) {
      return undefined;
    }
    const position = this.lastSeen?.objectId === removed.objectId ? this.lastSeen : removed;
    return portals.find(
      (portal) => squaredDistance(portal, position) <= this.options.portalFollowDistanceSquared,
    );
  }

  status(): {
    followName: string | null;
    lastSeen: { objectId: number; x: number; y: number; time: number } | null;
    lastTeleportAt: number;
    options: FollowOptions;
  } {
    return {
      followName: this.followName,
      lastSeen: this.lastSeen ? { ...this.lastSeen } : null,
      lastTeleportAt: this.lastTeleportAt,
      options: { ...this.options },
    };
  }
}

function idleDecision(): FollowDecision {
  return { state: 'idle', followName: null, target: null, targetObjectId: null, teleportObjectId: null };
}

function squaredDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
