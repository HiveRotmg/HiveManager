import { TextPacket } from 'realmlib';
import {
  RepeatSpamTracker,
  isFilterableChat,
  isServerMessage,
  normalizeChatPayload,
} from '../chat-spam-filter';
import { Client, PacketContext } from '../client';
import { config } from '../config';
import { Plugin, PacketHook } from './decorators';

/**
 * Domains and handles seen in RMT adverts. Kept from this plugin's first version:
 * a keyword hit is decided on the first message, where the repeat filter needs
 * three senders first. Mirrors the reference's separate `Parameters.filtered`
 * pass (TextHandler.as:185-194), which likewise runs only on player chat.
 */
const SPAM_MARKERS = [
  'realm i stock i com',
  'r0tmg ar$3nal',
  'r0tmg-ar$3nal',
  'r0tmgar$3nal',
  'rotmg ar$3nal',
  'r.e.a.i.m.s.h.o.p',
  'rpg(put a dot)rlp',
];

/**
 * Drops spam from incoming TEXT packets two ways: the keyword list above, and
 * ProdMafia's repeat-payload filter, which drops a normalized payload once three
 * distinct senders have used it inside five minutes (`TextHandler.isRepeatSpam`).
 * Server, guild, party and other `#`/`*` channel messages, tells addressed to us,
 * plus our own lines, are never touched by either.
 */
@Plugin({
  name: 'AntiSpam',
  description: 'Blocks spam-bot chat by keyword and by repeated payloads from rotating senders.',
  author: 'realmlib',
  version: '1.1.0',
})
export class AntiSpam {
  private readonly repeats = new RepeatSpamTracker();
  private keywordBlocked = 0;
  private repeatBlocked = 0;

  @PacketHook({ priority: 100 })
  onText(client: Client, text: TextPacket, ctx: PacketContext): void {
    if (isServerMessage(text)) return;
    if (this.isKeywordSpam(text.text)) {
      this.keywordBlocked++;
      ctx.cancel('spam text');
      return;
    }
    if (!config.chatSpamFilter) return;
    if (!isFilterableChat(text, client.getPlayer()?.name)) return;
    const normalized = normalizeChatPayload(text.text);
    if (!this.repeats.isRepeatSpam(normalized, text.name, Date.now())) return;
    this.repeatBlocked++;
    ctx.cancel('repeat spam');
  }

  /** Filter counters and table size for the console, web panel and tests. */
  status(): { enabled: boolean; keywordBlocked: number; repeatBlocked: number; trackedPayloads: number } {
    return {
      enabled: config.chatSpamFilter,
      keywordBlocked: this.keywordBlocked,
      repeatBlocked: this.repeatBlocked,
      trackedPayloads: this.repeats.size(),
    };
  }

  private isKeywordSpam(message: string): boolean {
    const normalized = message.toLowerCase();
    return SPAM_MARKERS.some((marker) => normalized.includes(marker));
  }
}
