import { Classes, ConditionEffectBits, QuestObjectIdPacket, StatType } from 'realmlib';
import { Client } from '../client';
import { config } from '../config';
import { ClientEvent } from '../events';
import {
  FollowController,
  FollowOptions,
  FollowPlayer,
  QuestTeleportSelection,
  anchorTeleportCommand,
  selectQuestTeleportTarget,
} from '../follow-controller';
import type { TrackedObject } from '../models';
import { portalCandidates } from '../portal-lookup';
import { EventHook, PacketHook, Plugin } from './decorators';

const PLAYER_TYPES: ReadonlySet<number> = new Set<number>(
  Object.values(Classes).filter((value): value is number => typeof value === 'number'),
);

/**
 * `/follow <name>`, follow-into-portals, named-anchor teleport and quest
 * teleport. Ports `ParseChatMessageCommand.cmdFollow` (:486-505),
 * `Player.update`'s follow block (Player.as:944-960),
 * `Player.removeFromMap`'s portal follow (Player.as:1467-1474), the
 * `anchorName` / `anchorTeleport` hotkey (MapUserInput.as:799-800) and
 * `MapUserInput.teleQuest` (:196-226).
 */
@Plugin({
  name: 'FollowTeleport',
  description: 'Follows a named player (optionally into portals), teleports to an anchor or to your quest.',
  author: 'headless-client',
  version: '1.0.0',
})
export class FollowTeleport {
  private readonly controller = new FollowController();
  private anchorName = '';
  private questObjectId = -1;
  private appliedFollowIntoPortals: boolean | undefined;
  private lastState = 'idle';

  onLoad(): void {
    this.anchorName = config.anchorName;
    this.syncConfig();
  }

  /** Starts following a player by name. An empty name stops following. */
  follow(client: Client, name: string): boolean {
    const started = this.controller.follow(name);
    if (!started) {
      client.stopMoving();
      console.log(`[${client.alias}] FollowTeleport: no longer following`);
      return false;
    }
    console.log(`[${client.alias}] FollowTeleport: now following ${this.controller.getFollowName()}`);
    return true;
  }

  stopFollowing(client: Client): void {
    this.controller.stop();
    client.stopMoving();
  }

  /** Sets the anchor player (`Parameters.data.anchorName`, PlayerMenu.as:124). */
  setAnchor(name: string): string {
    this.anchorName = name.trim();
    return this.anchorName;
  }

  getAnchor(): string {
    return this.anchorName;
  }

  /**
   * Teleports to the anchored player. ProdMafia's hotkey sends the
   * `/teleport <name>` chat command rather than a TELEPORT packet
   * (MapUserInput.as:800), which also works while the name is off-screen.
   */
  anchorTeleport(client: Client): boolean {
    const command = anchorTeleportCommand(this.anchorName);
    if (!command) {
      console.warn(`[${client.alias}] FollowTeleport: no anchor set`);
      return false;
    }
    console.log(`[${client.alias}] FollowTeleport: ${command}`);
    client.say(command);
    return true;
  }

  /** Teleports to the visible player closest to your quest. */
  questTeleport(client: Client): QuestTeleportSelection {
    const quest = this.questObjectId > 0 ? client.getVisibleObject(this.questObjectId) : undefined;
    const selection = selectQuestTeleportTarget({
      questObjectId: this.questObjectId,
      questPosition: quest ? { x: quest.x, y: quest.y } : undefined,
      players: this.players(client),
      selfObjectId: client.getObjectId(),
    });
    switch (selection.kind) {
      case 'no_quest':
        console.log(`[${client.alias}] FollowTeleport: you have no quest!`);
        break;
      case 'quest_not_visible':
        console.log(`[${client.alias}] FollowTeleport: quest object ${this.questObjectId} is not visible`);
        break;
      case 'self_closest':
        console.log(`[${client.alias}] FollowTeleport: you are closest!`);
        break;
      case 'none':
        console.log(`[${client.alias}] FollowTeleport: no player to teleport to`);
        break;
      default:
        console.log(`[${client.alias}] FollowTeleport: teleporting to ${selection.name ?? selection.objectId}`);
        client.teleportTo(selection.objectId);
    }
    return selection;
  }

  configure(options: Partial<FollowOptions>): FollowOptions {
    if (options.followIntoPortals !== undefined) {
      this.appliedFollowIntoPortals = options.followIntoPortals;
    }
    return this.controller.configure(options);
  }

  @PacketHook()
  onQuestObjectId(client: Client, packet: QuestObjectIdPacket): void {
    this.questObjectId = packet.objectId;
  }

  @EventHook(ClientEvent.MapChange)
  onMapChange(): void {
    // The follow name survives a map change (ProdMafia keeps `followName` and
    // re-acquires the player), which is what makes follow-into-portals useful.
    this.questObjectId = -1;
  }

  @EventHook(ClientEvent.Tick)
  onTick(client: Client): void {
    this.syncConfig();
    if (!this.controller.isFollowing()) {
      return;
    }
    const decision = this.controller.tick({
      time: Date.now(),
      position: client.getServerPosition() ?? client.getPosition(),
      selfObjectId: client.getObjectId(),
      players: this.players(client),
      teleportAllowed: client.canTeleport(),
    });
    this.lastState = decision.state;
    if (decision.teleportObjectId !== null) {
      client.teleportTo(decision.teleportObjectId);
    }
    if (decision.state === 'arrived') {
      if (client.isMoving()) {
        client.stopMoving();
      }
      return;
    }
    if (decision.target) {
      client.moveTo(decision.target, this.controller.getOptions().arriveThreshold);
    }
  }

  /** `Player.removeFromMap`: take the portal the followed player just used. */
  @EventHook(ClientEvent.ObjectRemoved)
  onObjectRemoved(client: Client, object: TrackedObject): void {
    if (!this.controller.isFollowing() || !PLAYER_TYPES.has(object.type)) {
      return;
    }
    const portal = this.controller.portalToFollow(
      { objectId: object.objectId, name: object.name, x: object.x, y: object.y },
      portalCandidates(client.visibleObjects()),
    );
    if (!portal) {
      return;
    }
    console.log(
      `[${client.alias}] FollowTeleport: following ${object.name ?? object.objectId} into ` +
        `${portal.name ?? `#${portal.type}`} (UsePortal ${portal.objectId})`,
    );
    client.usePortal(portal.objectId);
  }

  status(): ReturnType<FollowController['status']> & {
    state: string;
    anchorName: string;
    questObjectId: number;
  } {
    return {
      ...this.controller.status(),
      state: this.controller.isFollowing() ? this.lastState : 'idle',
      anchorName: this.anchorName,
      questObjectId: this.questObjectId,
    };
  }

  /** Visible players plus this client's own player, as `teleQuest` iterates them. */
  private players(client: Client): FollowPlayer[] {
    const position = client.getServerPosition() ?? client.getPosition();
    const players: FollowPlayer[] = [
      {
        objectId: client.getObjectId(),
        name: client.alias,
        x: position.x,
        y: position.y,
        invisible: false,
      },
    ];
    for (const object of client.visibleObjects()) {
      if (!PLAYER_TYPES.has(object.type)) {
        continue;
      }
      players.push({
        objectId: object.objectId,
        name: object.name,
        x: object.x,
        y: object.y,
        invisible: isInvisible(object),
      });
    }
    return players;
  }

  private syncConfig(): void {
    if (this.appliedFollowIntoPortals !== config.followIntoPortals) {
      this.appliedFollowIntoPortals = config.followIntoPortals;
      this.controller.configure({ followIntoPortals: config.followIntoPortals });
    }
  }
}

function isInvisible(object: TrackedObject): boolean {
  const condition = Number(
    object.player?.condition ?? object.rawStats?.[String(StatType.CONDITION_STAT)] ?? 0,
  ) >>> 0;
  return (condition & ConditionEffectBits.INVISIBLE) !== 0;
}
