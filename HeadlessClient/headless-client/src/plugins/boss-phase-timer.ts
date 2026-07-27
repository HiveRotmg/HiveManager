import { TextPacket } from 'realmlib';
import { BossPhaseSnapshot, BossPhaseTracker, isServerDialogue } from '../boss-dialogue';
import { Client } from '../client';
import { ClientEvent } from '../events';
import { Plugin, EventHook, PacketHook } from './decorators';

/**
 * Derives boss phase countdowns from server dialogue, so scripts can time the
 * Oryx realm-close window, the minion-failure shake and the vulnerable phase.
 * Port of the `Parameters.timerPhaseTimes` lookup in `TextHandler.execute`
 * (src/kabam/rotmg/chat/control/TextHandler.as:256-261) plus GameSprite's
 * expiry, map-unload and Cloth Bazaar handling (GameSprite.as:335-338, 558-562,
 * 1337-1343).
 */
@Plugin({
  name: 'BossPhaseTimer',
  description: 'Tracks boss phase countdowns derived from boss dialogue.',
  author: 'headless-client',
  version: '1.0.0',
})
export class BossPhaseTimer {
  private readonly tracker = new BossPhaseTracker();

  @PacketHook()
  onText(client: Client, text: TextPacket): void {
    if (!isServerDialogue(text)) {
      return;
    }
    const phase = this.tracker.onServerText(text.text, Date.now());
    if (phase) {
      console.log(`[${client.alias}] BossPhaseTimer: ${phase.name} for ${phase.durationMs}ms`);
    }
  }

  @EventHook(ClientEvent.MapChange)
  onMapChange(client: Client, mapName: string): void {
    this.tracker.onMapUnload();
    const phase = this.tracker.onMapEnter(mapName, Date.now());
    if (phase) {
      console.log(`[${client.alias}] BossPhaseTimer: ${phase.name} for ${phase.durationMs}ms`);
    }
  }

  /** Current phase and countdown. */
  status(): BossPhaseSnapshot {
    return this.tracker.snapshot(Date.now());
  }
}
