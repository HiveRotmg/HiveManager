import { PortalType } from 'realmlib';

/**
 * Generic portal automation ported from ProdMafia:
 *
 * - `Parameters.data.autoEnterPortals` — walking into a portal that appears
 *   next to you (`Portal.addTo`, src/com/company/assembleegameclient/objects/
 *   Portal.as:33-41).
 * - `Parameters.data.AutoDungeonEnterList` — the named-dungeon whitelist
 *   (Parameters.as:984).
 *
 * Flash's walk-in relies on the portal panel appearing once you overlap the
 * portal; headless has no panel, so the controller finishes the job with
 * USE_PORTAL from the overlap position, which is how ProdMafia's own Auto Play
 * enters portals (GameSprite.as:1998-2005).
 */

/** The portal fields the controller needs. */
export interface PortalCandidate {
  objectId: number;
  type: number;
  x: number;
  y: number;
  /** Resolved display name (NAME stat, else object XML id). */
  name?: string;
}

/** Object types that are always portals. */
export const PORTAL_OBJECT_TYPES: ReadonlySet<number> = new Set<number>(
  Object.values(PortalType).filter((value): value is number => typeof value === 'number'),
);

/** Portals that lead out of content rather than into it; never auto-entered. */
const HUB_PORTAL_PATTERN =
  /\b(nexus|vault|guild\s*hall|pet\s*yard|bazaar|daily\s*quest|realm\s*of\s*the\s*mad\s*god)\b/;

/** `"Ocean Trench (12/85)"` — a realm portal's population suffix. */
const REALM_PORTAL_POPULATION = /\(\d+\/\d+\)/;

export interface PortalAutoEnterOptions {
  /** Master switch (`Parameters.data.autoEnterPortals`). */
  enabled: boolean;
  /**
   * How close a portal must appear to be walked into. `Portal.addTo` uses 4
   * tiles (Portal.as:36).
   */
  triggerRadius: number;
  /**
   * Overlap distance at which USE_PORTAL is sent. This server only enters
   * reliably from the portal centre (GameSprite.as:1998-2000).
   */
  usePortalDistance: number;
  /** Minimum gap between USE_PORTAL attempts (GameSprite.as:2000). */
  usePortalCooldownMs: number;
  /** Attempts before the portal is abandoned. */
  usePortalMaxAttempts: number;
  /**
   * Named-dungeon whitelist (`Parameters.data.AutoDungeonEnterList`). Empty
   * means every dungeon portal qualifies, matching the stock empty list.
   */
  dungeonWhitelist: readonly string[];
  /** Skip Nexus / vault / realm style hub portals. */
  ignoreHubPortals: boolean;
}

export const DEFAULT_PORTAL_AUTO_ENTER: PortalAutoEnterOptions = {
  enabled: false,
  triggerRadius: 4,
  usePortalDistance: 0.5,
  usePortalCooldownMs: 1500,
  usePortalMaxAttempts: 5,
  dungeonWhitelist: [],
  ignoreHubPortals: true,
};

export interface PortalAutoEnterSnapshot {
  time: number;
  position: { x: number; y: number };
  portals: readonly PortalCandidate[];
}

export interface PortalAutoEnterDecision {
  state: 'idle' | 'walking' | 'entering' | 'abandoned';
  /** Where to walk, when a portal is being approached. */
  target: { x: number; y: number } | null;
  targetObjectId: number | null;
  /** Portal to send USE_PORTAL for on this tick. */
  usePortalObjectId: number | null;
}

/**
 * Collapses a portal or whitelist entry to a comparable form: lower case, no
 * punctuation, no `portal` suffix and no realm population suffix, so
 * `"Ocean Trench Portal"`, `"ocean trench"` and `"Ocean Trench (5/85)"` all
 * normalize to `ocean trench`.
 */
export function normalizeDungeonName(raw: string | undefined): string {
  return (raw ?? '')
    .replace(REALM_PORTAL_POPULATION, ' ')
    // Object XML ids are sometimes dotted, e.g. `s.nexus_portal`.
    .replace(/[._]+/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\bportals?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parses a comma or semicolon separated whitelist (e.g. from config). */
export function parseDungeonWhitelist(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * The `AutoDungeonEnterList` filter. An empty whitelist admits every dungeon;
 * otherwise the portal name has to equal or contain a listed dungeon.
 */
export function isDungeonWhitelisted(name: string | undefined, whitelist: readonly string[]): boolean {
  if (whitelist.length === 0) {
    return true;
  }
  const normalized = normalizeDungeonName(name);
  if (normalized === '') {
    return false;
  }
  return whitelist.some((entry) => {
    const wanted = normalizeDungeonName(entry);
    return wanted !== '' && (normalized === wanted || normalized.includes(wanted));
  });
}

/**
 * True for Nexus / vault / realm portals, which lead out of content. Every
 * member of `PortalType` is such a portal.
 */
export function isHubPortal(portal: PortalCandidate): boolean {
  if (PORTAL_OBJECT_TYPES.has(portal.type)) {
    return true;
  }
  const name = portal.name ?? '';
  return REALM_PORTAL_POPULATION.test(name) || HUB_PORTAL_PATTERN.test(normalizeDungeonName(name));
}

/**
 * Whether a visible object is a portal. `className` comes from the object XML
 * (`<Class>Portal</Class>`); the name checks cover assets we have no XML for.
 */
export function looksLikePortal(type: number, name?: string, className?: string): boolean {
  if (PORTAL_OBJECT_TYPES.has(type)) {
    return true;
  }
  if ((className ?? '').toLowerCase() === 'portal') {
    return true;
  }
  return /portal/i.test(name ?? '');
}

/** True when a portal may be auto-entered under these options. */
export function isAutoEnterCandidate(
  portal: PortalCandidate,
  options: Pick<PortalAutoEnterOptions, 'dungeonWhitelist' | 'ignoreHubPortals'>,
): boolean {
  if (options.ignoreHubPortals && isHubPortal(portal)) {
    return false;
  }
  return isDungeonWhitelisted(portal.name, options.dungeonWhitelist);
}

/**
 * Walk-in auto-enter with a dungeon whitelist. Feed it portals as they become
 * visible (`notice`) and drive it per tick (`tick`).
 */
export class PortalAutoEnterController {
  private options: PortalAutoEnterOptions = { ...DEFAULT_PORTAL_AUTO_ENTER };
  private pendingObjectId = -1;
  private pendingName: string | undefined;
  private attempts = 0;
  /** -Infinity so the first USE_PORTAL is never held back by the cooldown. */
  private lastUseAt = Number.NEGATIVE_INFINITY;
  private readonly abandoned = new Set<number>();
  private enteredCount = 0;

  configure(options: Partial<PortalAutoEnterOptions>): PortalAutoEnterOptions {
    this.options = { ...this.options, ...options };
    if (!this.options.enabled) {
      this.clearPending();
    }
    return { ...this.options, dungeonWhitelist: [...this.options.dungeonWhitelist] };
  }

  getOptions(): PortalAutoEnterOptions {
    return { ...this.options, dungeonWhitelist: [...this.options.dungeonWhitelist] };
  }

  /** Clears per-map state; call on every map change. */
  reset(): void {
    this.clearPending();
    this.abandoned.clear();
  }

  /**
   * A portal became visible. Selects it when it is inside the trigger radius
   * and passes the whitelist, mirroring `Portal.addTo`'s distance check.
   * Returns true when this portal is now the approach target.
   */
  notice(portal: PortalCandidate, position: { x: number; y: number }): boolean {
    if (!this.options.enabled || this.abandoned.has(portal.objectId)) {
      return false;
    }
    if (this.pendingObjectId >= 0 && this.pendingObjectId !== portal.objectId) {
      return false;
    }
    if (Math.hypot(portal.x - position.x, portal.y - position.y) > this.options.triggerRadius) {
      return false;
    }
    if (!isAutoEnterCandidate(portal, this.options)) {
      return false;
    }
    if (this.pendingObjectId !== portal.objectId) {
      this.pendingObjectId = portal.objectId;
      this.pendingName = portal.name;
      this.attempts = 0;
      this.lastUseAt = Number.NEGATIVE_INFINITY;
    }
    return true;
  }

  tick(snapshot: PortalAutoEnterSnapshot): PortalAutoEnterDecision {
    if (!this.options.enabled || this.pendingObjectId < 0) {
      return idleDecision();
    }
    const portal = snapshot.portals.find((candidate) => candidate.objectId === this.pendingObjectId);
    if (!portal) {
      // The portal closed, or we already went through it.
      this.clearPending();
      return idleDecision();
    }
    const distance = Math.hypot(portal.x - snapshot.position.x, portal.y - snapshot.position.y);
    if (distance > this.options.usePortalDistance) {
      return {
        state: 'walking',
        target: { x: portal.x, y: portal.y },
        targetObjectId: portal.objectId,
        usePortalObjectId: null,
      };
    }
    if (this.attempts >= this.options.usePortalMaxAttempts) {
      this.abandoned.add(portal.objectId);
      this.clearPending();
      return { state: 'abandoned', target: null, targetObjectId: portal.objectId, usePortalObjectId: null };
    }
    if (snapshot.time - this.lastUseAt < this.options.usePortalCooldownMs) {
      return {
        state: 'entering',
        target: { x: portal.x, y: portal.y },
        targetObjectId: portal.objectId,
        usePortalObjectId: null,
      };
    }
    this.attempts++;
    this.lastUseAt = snapshot.time;
    this.enteredCount++;
    return {
      state: 'entering',
      target: { x: portal.x, y: portal.y },
      targetObjectId: portal.objectId,
      usePortalObjectId: portal.objectId,
    };
  }

  status(): {
    enabled: boolean;
    pendingObjectId: number | null;
    pendingName?: string;
    attempts: number;
    usePortalCount: number;
    abandoned: number[];
    dungeonWhitelist: string[];
  } {
    return {
      enabled: this.options.enabled,
      pendingObjectId: this.pendingObjectId >= 0 ? this.pendingObjectId : null,
      pendingName: this.pendingName,
      attempts: this.attempts,
      usePortalCount: this.enteredCount,
      abandoned: [...this.abandoned],
      dungeonWhitelist: [...this.options.dungeonWhitelist],
    };
  }

  private clearPending(): void {
    this.pendingObjectId = -1;
    this.pendingName = undefined;
    this.attempts = 0;
    this.lastUseAt = Number.NEGATIVE_INFINITY;
  }
}

function idleDecision(): PortalAutoEnterDecision {
  return { state: 'idle', target: null, targetObjectId: null, usePortalObjectId: null };
}
