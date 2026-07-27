import { TextPacket } from 'realmlib';
import { autoResponderReply } from '../boss-dialogue';
import { Client } from '../client';
import { config } from '../config';
import { Plugin, PacketHook } from './decorators';

/**
 * Repeat window for an identical reply. The bosses re-ask until answered, so
 * retries must keep working; this only swallows the duplicate TEXT packets that
 * arrive in the same instant.
 */
const REPLY_REPEAT_MS = 750;

/**
 * Answers the dungeon dialogue gates that otherwise stall a bot forever:
 * Thessal, the Ghost of Skuld, Craig, the Computer and Master Rat. Port of the
 * `Parameters.data.AutoResponder` branch of ProdMafia's `TextHandler.execute`
 * (src/kabam/rotmg/chat/control/TextHandler.as:240-255).
 */
@Plugin({
  name: 'AutoResponder',
  description: 'Answers dungeon dialogue gates (Thessal, Skuld, Craig, the Computer, Master Rat).',
  author: 'headless-client',
  version: '1.0.0',
})
export class AutoResponder {
  private enabled = true;
  private lastReply: string | undefined;
  private lastReplyAt = 0;
  private replyCount = 0;

  @PacketHook()
  onText(client: Client, text: TextPacket): void {
    if (!this.enabled || !config.autoResponder) {
      return;
    }
    const reply = autoResponderReply({ name: text.name, text: text.text, numStars: text.numStars });
    if (reply === undefined) {
      return;
    }
    const now = Date.now();
    if (reply === this.lastReply && now - this.lastReplyAt < REPLY_REPEAT_MS) {
      return;
    }
    this.lastReply = reply;
    this.lastReplyAt = now;
    this.replyCount++;
    console.log(`[${client.alias}] AutoResponder: ${text.name} -> "${reply}"`);
    client.say(reply);
  }

  /** Turns replying on or off without unloading the plugin. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Reply state for console inspection, the web panel and tests. */
  status(): { enabled: boolean; replyCount: number; lastReply?: string; lastReplyAt: number } {
    return {
      enabled: this.enabled && config.autoResponder,
      replyCount: this.replyCount,
      lastReply: this.lastReply,
      lastReplyAt: this.lastReplyAt,
    };
  }
}
