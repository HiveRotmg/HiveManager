import { Client } from '../client';
import { config } from '../config';
import { ClientEvent } from '../events';
import type { TrackedObject } from '../models';
import {
  PortalAutoEnterController,
  PortalAutoEnterOptions,
  PortalCandidate,
  isAutoEnterCandidate,
  parseDungeonWhitelist,
} from '../portal-automation';
import { portalCandidates, portalNameCatalog } from '../portal-lookup';
import { EventHook, Plugin } from './decorators';

/**
 * Walk-in portal auto-enter with a named-dungeon whitelist. Ports
 * `Parameters.data.autoEnterPortals` (Portal.as:33-41) and
 * `Parameters.data.AutoDungeonEnterList` (Parameters.as:984); configure it with
 * `config.autoEnterPortals` / `config.autoEnterPortalWhitelist`, or per client
 * via `setEnabled` / `setWhitelist`.
 */
@Plugin({
  name: 'PortalAutomation',
  description: 'Walks into nearby dungeon portals and enters them, filtered by a dungeon whitelist.',
  author: 'headless-client',
  version: '1.0.0',
})
export class PortalAutomation {
  private readonly controller = new PortalAutoEnterController();
  private appliedWhitelistText: string | undefined;
  private appliedEnabled: boolean | undefined;
  private lastState = 'idle';

  @EventHook(ClientEvent.MapChange)
  onMapChange(): void {
    this.controller.reset();
  }

  /** `Portal.addTo`: a portal appearing within the trigger radius is walked into. */
  @EventHook(ClientEvent.ObjectAdded)
  onObjectAdded(client: Client, object: TrackedObject): void {
    this.syncConfig();
    if (!this.controller.getOptions().enabled) {
      return;
    }
    const candidate = this.asPortal(object);
    if (!candidate) {
      return;
    }
    const position = client.getServerPosition() ?? client.getPosition();
    if (!this.controller.notice(candidate, position)) {
      return;
    }
    console.log(
      `[${client.alias}] PortalAutomation: walking into ${candidate.name ?? `#${candidate.type}`} ` +
        `(${candidate.x.toFixed(1)}, ${candidate.y.toFixed(1)})`,
    );
  }

  @EventHook(ClientEvent.Tick)
  onTick(client: Client): void {
    this.syncConfig();
    if (!this.controller.getOptions().enabled) {
      return;
    }
    const decision = this.controller.tick({
      time: Date.now(),
      position: client.getServerPosition() ?? client.getPosition(),
      portals: this.visiblePortals(client),
    });
    this.lastState = decision.state;
    if (decision.state === 'abandoned') {
      console.warn(`[${client.alias}] PortalAutomation: giving up on portal ${decision.targetObjectId}`);
      return;
    }
    if (decision.target && decision.state === 'walking') {
      client.moveTo(decision.target, this.controller.getOptions().usePortalDistance);
    }
    if (decision.usePortalObjectId !== null) {
      console.log(`[${client.alias}] PortalAutomation: UsePortal(${decision.usePortalObjectId})`);
      client.usePortal(decision.usePortalObjectId);
    }
  }

  /** Turns walk-in auto-enter on or off for this client. */
  setEnabled(enabled: boolean): PortalAutoEnterOptions {
    this.appliedEnabled = enabled;
    return this.controller.configure({ enabled });
  }

  /** Replaces the dungeon whitelist. An empty list admits every dungeon portal. */
  setWhitelist(dungeons: readonly string[]): PortalAutoEnterOptions {
    this.appliedWhitelistText = dungeons.join(', ');
    return this.controller.configure({ dungeonWhitelist: [...dungeons] });
  }

  configure(options: Partial<PortalAutoEnterOptions>): PortalAutoEnterOptions {
    return this.controller.configure(options);
  }

  /** Portals currently visible, and whether each one passes the filters. */
  visibleCandidates(client: Client): (PortalCandidate & { eligible: boolean })[] {
    const options = this.controller.getOptions();
    return this.visiblePortals(client).map((portal) => ({
      ...portal,
      eligible: isAutoEnterCandidate(portal, options),
    }));
  }

  status(): ReturnType<PortalAutoEnterController['status']> & { state: string } {
    return { ...this.controller.status(), state: this.lastState };
  }

  private visiblePortals(client: Client): PortalCandidate[] {
    return portalCandidates(client.visibleObjects());
  }

  private asPortal(object: TrackedObject): PortalCandidate | undefined {
    return portalCandidates([object], portalNameCatalog())[0];
  }

  /**
   * Applies `config.autoEnterPortals` / `config.autoEnterPortalWhitelist` when
   * they change, so editing global config takes effect live without clobbering
   * a per-client `setEnabled` / `setWhitelist`.
   */
  private syncConfig(): void {
    if (this.appliedEnabled !== config.autoEnterPortals) {
      this.appliedEnabled = config.autoEnterPortals;
      this.controller.configure({ enabled: config.autoEnterPortals });
    }
    if (this.appliedWhitelistText !== config.autoEnterPortalWhitelist) {
      this.appliedWhitelistText = config.autoEnterPortalWhitelist;
      this.controller.configure({
        dungeonWhitelist: parseDungeonWhitelist(config.autoEnterPortalWhitelist),
      });
    }
  }
}
