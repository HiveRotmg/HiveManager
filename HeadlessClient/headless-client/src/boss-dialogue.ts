/**
 * Server-dialogue automation ported from ProdMafia's
 * `TextHandler.execute` (src/kabam/rotmg/chat/control/TextHandler.as:240-261).
 *
 * Both features hang off the same trigger: a TEXT packet that the server sent
 * itself (`numStars_ == -1`), whose `name` is the speaking boss. The Auto
 * Responder answers dialogue gates that otherwise stall a run forever; the
 * phase table turns the same lines into boss countdowns.
 */

/**
 * `numStars` on a server/system TEXT. ProdMafia tests `numStars_ == -1`;
 * realmlib reads the field as an unsigned short, so the same value arrives
 * here as 65535.
 */
export const SERVER_MESSAGE_STARS = 65535;

/** The fields of a TEXT packet the dialogue matchers look at. */
export interface DialogueMessage {
  /** Sender. Boss dialogue is prefixed with `#`, e.g. `#Master Rat`. */
  name: string;
  text: string;
  numStars: number;
}

/** True when the TEXT came from the server rather than a player. */
export function isServerDialogue(message: Pick<DialogueMessage, 'numStars'>): boolean {
  return message.numStars === SERVER_MESSAGE_STARS || message.numStars === -1;
}

/**
 * Master Rat's (Splinter's) riddles: the reply is computed from the question
 * rather than fixed. Exact port of `TextHandler.getSplinterReply`
 * (TextHandler.as:304-319); an unknown question yields `''`, which the caller
 * treats as "say nothing".
 */
export function getSplinterReply(question: string): string {
  switch (question) {
    case 'What time is it?':
      return "It's pizza time!";
    case 'Where is the safest place in the world?':
      return 'Inside my shell.';
    case 'What is fast, quiet and hidden by the night?':
      return 'A ninja of course!';
    case 'How do you like your pizza?':
      return 'Extra cheese, hold the anchovies.';
    case 'Who did this to me?':
      return 'Dr. Terrible, the mad scientist.';
    default:
      return '';
  }
}

/**
 * The Auto Responder reply for a server dialogue line, or undefined when the
 * message is not a gate we answer. Sender and text matching are exactly
 * ProdMafia's, including the else-if ordering (TextHandler.as:240-255).
 */
export function autoResponderReply(message: DialogueMessage): string | undefined {
  if (!isServerDialogue(message)) {
    return undefined;
  }
  if (message.name === '#Thessal the Mermaid Goddess' && message.text === 'Is King Alexander alive?') {
    return 'He lives and reigns and conquers the world';
  }
  if (message.name === '#Ghost of Skuld' && message.text.indexOf("'READY'") !== -1) {
    return 'ready';
  }
  if (message.name === '#Craig, Intern of the Mad God' && message.text.indexOf('say SKIP and') !== -1) {
    return 'skip';
  }
  if (message.name === '#Computer' && message.text.indexOf('Password:') !== -1) {
    return 'Dr Terrible';
  }
  if (message.name === '#Master Rat') {
    const splinterReply = getSplinterReply(message.text);
    return splinterReply === '' ? undefined : splinterReply;
  }
  return undefined;
}

/** A boss phase countdown: its label and how long it runs for. */
export interface BossPhase {
  name: string;
  durationMs: number;
}

/**
 * `Parameters.timerPhaseTimes` / `Parameters.timerPhaseNames`
 * (Parameters.as:333-338), keyed by the exact server TEXT. The two Oryx lines
 * arrive as unresolved localization JSON, which is why the keys are braces.
 */
export const TIMER_PHASES: ReadonlyMap<string, BossPhase> = new Map<string, BossPhase>([
  ['{"k":"s.oryx_closed_realm"}', { name: 'Realm Closed', durationMs: 120_000 }],
  ['{"k":"s.oryx_minions_failed"}', { name: 'Oryx Shake', durationMs: 12_000 }],
  ['DIE! DIE! DIE!!!', { name: 'Vulnerable', durationMs: 23_000 }],
]);

/**
 * Phases that survive leaving the map. GameSprite tears the timer down on map
 * unload unless it is one of these (GameSprite.as:558) — the realm-close
 * countdown has to keep running across the Nexus hop it triggers.
 */
export const PERSISTENT_PHASE_NAMES: readonly string[] = ['Realm Closed', 'Oryx Shake'];

/** Entering the Cloth Bazaar starts a 30s portal-entry countdown (GameSprite.as:335-338). */
export const CLOTH_BAZAAR_PHASE: BossPhase = { name: 'Portal Entry', durationMs: 30_000 };

/** Map whose entry starts `CLOTH_BAZAAR_PHASE`. */
export const CLOTH_BAZAAR_MAP = 'Cloth Bazaar';

/** Phase state readable by scripts and the web panel. */
export interface BossPhaseSnapshot {
  /** `Parameters.timerActive`. */
  active: boolean;
  /** `Parameters.phaseName`, or null when no phase has been seen. */
  phaseName: string | null;
  /** `Parameters.phaseChangeAt` in the caller's clock, or null. */
  phaseChangeAt: number | null;
  /** Milliseconds until the phase change; 0 once elapsed. */
  remainingMs: number;
  /** Full length of the running phase, for progress display. */
  durationMs: number;
  /** When the phase started, in the caller's clock. */
  startedAt: number | null;
  /** The dialogue line (or map name) that started the phase. */
  trigger: string | null;
}

/** The phase for a server dialogue line, or undefined when it starts no timer. */
export function bossPhaseForText(text: string): BossPhase | undefined {
  return TIMER_PHASES.get(text);
}

/**
 * Tracks the active boss phase countdown. Mirrors the `Parameters.timerActive`
 * / `phaseChangeAt` / `phaseName` triple and GameSprite's expiry and map-unload
 * handling (GameSprite.as:558-562, 1337-1343).
 */
export class BossPhaseTracker {
  private active = false;
  private phaseName: string | null = null;
  private phaseChangeAt: number | null = null;
  private durationMs = 0;
  private startedAt: number | null = null;
  private trigger: string | null = null;

  /**
   * Applies a server dialogue line. Returns the started phase, or undefined
   * when the line starts no timer.
   */
  onServerText(text: string, now: number): BossPhase | undefined {
    const phase = bossPhaseForText(text);
    if (!phase || phase.durationMs <= 0) {
      return undefined;
    }
    this.start(phase, text, now);
    return phase;
  }

  /** Applies a map entry; only the Cloth Bazaar starts a phase. */
  onMapEnter(mapName: string, now: number): BossPhase | undefined {
    if (mapName !== CLOTH_BAZAAR_MAP) {
      return undefined;
    }
    this.start(CLOTH_BAZAAR_PHASE, mapName, now);
    return CLOTH_BAZAAR_PHASE;
  }

  /** Clears the countdown on map unload unless the phase is a persistent one. */
  onMapUnload(): void {
    if (this.phaseName !== null && PERSISTENT_PHASE_NAMES.includes(this.phaseName)) {
      return;
    }
    this.active = false;
  }

  /** Current state, expiring the countdown when its deadline has passed. */
  snapshot(now: number): BossPhaseSnapshot {
    if (this.active && this.phaseChangeAt !== null && now >= this.phaseChangeAt) {
      this.active = false;
    }
    return {
      active: this.active,
      phaseName: this.phaseName,
      phaseChangeAt: this.phaseChangeAt,
      remainingMs: this.active && this.phaseChangeAt !== null
        ? Math.max(0, this.phaseChangeAt - now)
        : 0,
      durationMs: this.durationMs,
      startedAt: this.startedAt,
      trigger: this.trigger,
    };
  }

  private start(phase: BossPhase, trigger: string, now: number): void {
    this.active = true;
    this.phaseName = phase.name;
    this.phaseChangeAt = now + phase.durationMs;
    this.durationMs = phase.durationMs;
    this.startedAt = now;
    this.trigger = trigger;
  }
}
