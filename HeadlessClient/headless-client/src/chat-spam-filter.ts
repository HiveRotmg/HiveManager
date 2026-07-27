/**
 * Chat spam filtering ported from ProdMafia's `TextHandler`
 * (src/kabam/rotmg/chat/control/TextHandler.as:83-94, 137-194, 271-302, 349-351,
 * 420-440).
 *
 * RMT spam rotates the *sender* rather than the payload — the same advert
 * arrives from a stream of throwaway accounts, which defeats muting by name and
 * (with leetspeak) a fair share of a keyword list. The reference therefore keys
 * on the normalized payload and drops it once it has been seen from
 * `SPAM_SENDER_LIMIT` distinct senders inside `SPAM_WINDOW_MS`.
 */

/** Source `SPAM_WINDOW_MS` (TextHandler.as:91): five minutes. */
export const SPAM_WINDOW_MS = 300_000;

/** Source `SPAM_SENDER_LIMIT` (TextHandler.as:92): three distinct senders. */
export const SPAM_SENDER_LIMIT = 3;

/**
 * Source `isRepeatSpam` exempts payloads shorter than 20 normalized characters
 * (TextHandler.as:279), which is what keeps a guild repeating "gz" out of it.
 */
export const MIN_SPAM_PAYLOAD_LENGTH = 20;

/**
 * `numStars` on a server/system TEXT. ProdMafia tests `numStars_ == -1`;
 * realmlib reads the field as an unsigned short, so the same value arrives as
 * 65535 (see `SERVER_MESSAGE_STARS` in boss-dialogue.ts).
 */
export const SERVER_MESSAGE_STARS = 65535;

/**
 * Homoglyphs the source folds before normalizing (TextHandler.as:102-134). Only
 * r/w/t/g are covered, because those are the letters the spam it was written
 * against substituted.
 */
const SIMILAR_LETTERS: Readonly<Record<string, string>> = {
  'ŕ': 'r', 'ŗ': 'r', 'ř': 'r',
  'ŵ': 'w',
  'ţ': 't', 'ť': 't', 'ŧ': 't', 'ț': 't', '†': 't', '‡': 't',
  'ĝ': 'g', 'ğ': 'g', 'ġ': 'g', 'ģ': 'g',
};

/**
 * Source `getCustomMultiColors` (TextHandler.as:420-440): lowercase, fold the
 * known homoglyphs, then keep only `0-9` and `a-z`. Punctuation, spacing and
 * colour markup all vanish, so "R.E.A.L.M  $H0P" and "realm sh0p" collapse
 * together.
 */
export function normalizeChatPayload(text: string): string {
  const lowered = String(text ?? '').toLowerCase();
  let result = '';
  for (const character of lowered) {
    const folded = SIMILAR_LETTERS[character] ?? character;
    const code = folded.charCodeAt(0);
    if ((code >= 48 && code <= 57) || (code >= 97 && code <= 122)) result += folded;
  }
  return result;
}

/** The TEXT fields the channel rules look at. */
export interface ChatMessage {
  name: string;
  text: string;
  recipient: string;
  numStars: number;
}

/** True when the TEXT came from the server rather than a player. */
export function isServerMessage(message: Pick<ChatMessage, 'numStars'>): boolean {
  return message.numStars === SERVER_MESSAGE_STARS || message.numStars === -1;
}

/**
 * Source `isSpecialRecipientChat` (TextHandler.as:349-351): a recipient starting
 * with `#` or `*` is a channel rather than a person — `*Guild*`, `*Party*`,
 * `*Client*`, `*Help*`, `*Error*` and the `#`-prefixed NPC channels.
 */
export function isSpecialRecipientChat(recipient: string): boolean {
  const first = String(recipient ?? '').charAt(0);
  return first === '#' || first === '*';
}

/**
 * Source `isFilterableChat` (TextHandler.as:152): the spam filter only ever sees
 * player chat from someone else on a non-channel recipient. Server messages, our
 * own lines and every `#`/`*` channel are exempt.
 *
 * Note that a whisper is NOT exempt in the reference: a tell carries the
 * recipient's plain player name, which is not a special recipient, so
 * `isFilterableChat` is true for tells and `isRepeatSpam` does examine them.
 * Only an identical 20+ character payload from three different senders inside
 * five minutes is dropped, which is the RMT tell pattern.
 */
export function isFilterableChat(message: ChatMessage, ownName: string | undefined): boolean {
  if (isServerMessage(message)) return false;
  if (ownName !== undefined && ownName !== '' && message.name === ownName) return false;
  return !isSpecialRecipientChat(message.recipient);
}

export interface RepeatSpamOptions {
  windowMs: number;
  senderLimit: number;
  /**
   * Hard cap on tracked payloads. The reference's `Dictionary` only shrinks on
   * its five-minute prune, so a server that emits a stream of distinct 20+
   * character payloads can grow it without bound; the least recently seen entry
   * is evicted instead.
   */
  maxEntries: number;
  /**
   * Hard cap on remembered senders per payload. Once `senderLimit` is reached the
   * entry filters regardless, so names past this cap carry no information.
   */
  maxSendersPerEntry: number;
  /**
   * Payload keys are truncated to this many normalized characters, bounding the
   * memory one entry can occupy. Two payloads sharing a long prefix therefore
   * count as one, which only makes the filter marginally more eager on very long
   * messages.
   */
  maxKeyLength: number;
}

export const DEFAULT_REPEAT_SPAM_OPTIONS: Readonly<RepeatSpamOptions> = {
  windowMs: SPAM_WINDOW_MS,
  senderLimit: SPAM_SENDER_LIMIT,
  maxEntries: 512,
  maxSendersPerEntry: 8,
  maxKeyLength: 256,
};

interface Entry {
  senders: Set<string>;
  senderCount: number;
  lastMs: number;
}

/**
 * Port of `TextHandler.isRepeatSpam` (TextHandler.as:271-302) with a bounded
 * table. Like the reference the tracker is shared across messages, and the third
 * distinct sender's copy is itself dropped, because the count is incremented
 * before the comparison.
 */
export class RepeatSpamTracker {
  private readonly options: RepeatSpamOptions;
  private readonly entries = new Map<string, Entry>();
  private lastPruneMs = 0;

  constructor(options: Partial<RepeatSpamOptions> = {}) {
    this.options = { ...DEFAULT_REPEAT_SPAM_OPTIONS, ...options };
  }

  /**
   * Records `normalized` from `sender` and reports whether it is now repeat
   * spam. Payloads shorter than `MIN_SPAM_PAYLOAD_LENGTH` are never tracked.
   */
  isRepeatSpam(normalized: string, sender: string, now = Date.now()): boolean {
    if (!normalized || normalized.length < MIN_SPAM_PAYLOAD_LENGTH) return false;
    if (now - this.lastPruneMs > this.options.windowMs) this.prune(now);

    const key = normalized.slice(0, this.options.maxKeyLength);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { senders: new Set(), senderCount: 0, lastMs: now };
      this.entries.set(key, entry);
    } else {
      // Re-insert so iteration order stays least-recently-seen first, which is
      // what the size cap evicts on.
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    entry.lastMs = now;
    if (entry.senderCount < this.options.senderLimit && !entry.senders.has(sender)) {
      if (entry.senders.size < this.options.maxSendersPerEntry) entry.senders.add(sender);
      entry.senderCount++;
    }
    this.evictOverflow();
    return entry.senderCount >= this.options.senderLimit;
  }

  /** Number of payloads currently tracked. */
  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.lastPruneMs = 0;
  }

  /** Source prune: drop every entry untouched for a whole window. */
  private prune(now: number): void {
    this.lastPruneMs = now;
    for (const [key, entry] of this.entries) {
      if (now - entry.lastMs > this.options.windowMs) this.entries.delete(key);
    }
  }

  private evictOverflow(): void {
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      this.entries.delete(oldest.value);
    }
  }
}
