/**
 * Global, runtime-mutable configuration. A single shared object that every
 * client reads from live — mutate it while the program is running (e.g. via
 * the console in index.ts) and the change takes effect on the next use.
 */
export interface AppConfig {
  /** Delay before reconnecting after a rate-limit / ban, in milliseconds. */
  rateLimitReconnectMs: number;
  /** Base delay for exponential reconnect backoff after an unexpected drop, in ms. */
  reconnectBaseMs: number;
  /** Ceiling for the reconnect backoff delay, in ms. */
  reconnectMaxMs: number;
  /** How long to wait for the handshake (socket connect → first MapInfo) before giving up, in ms. */
  connectTimeoutMs: number;
  /**
   * Max time in-world without a single incoming packet before the connection is
   * treated as dead and force-reconnected, in ms. Guards the "TCP open but silent"
   * zombie case. 0 disables the liveness watchdog.
   */
  livenessTimeoutMs: number;
  /** How often the connection watchdog checks for connect/liveness timeouts, in ms. */
  watchdogIntervalMs: number;
  /** Default for walking into the vault on reaching the nexus (per-account `enterVault` overrides). */
  autoEnterVault: boolean;
  /**
   * Default for Auto Loot (per-client `autoLoot` overrides). Requires object XML;
   * see `loadItemCatalog`. Tunables live on the controller — `configureAutoLoot`.
   */
  autoLoot: boolean;
  /** Default for auto HP/MP potions and auto heal (per-client `autoConsumables` overrides). */
  autoConsumables: boolean;
  /**
   * Answer dungeon dialogue gates (Thessal, Skuld, Craig, the Computer, Master
   * Rat). Read live by the `AutoResponder` plugin, which must also be loaded.
   */
  autoResponder: boolean;
  /**
   * Walk into and enter portals that appear next to the player. Read live by
   * the `PortalAutomation` plugin (ProdMafia `autoEnterPortals`).
   */
  autoEnterPortals: boolean;
  /**
   * Comma-separated dungeon whitelist for `autoEnterPortals`, e.g.
   * `"Ocean Trench, Shatters"`. Empty admits every dungeon portal (ProdMafia
   * `AutoDungeonEnterList`).
   */
  autoEnterPortalWhitelist: string;
  /** Take the portal a followed player just entered (ProdMafia `followIntoPortals`). */
  followIntoPortals: boolean;
  /** Player name used by the `FollowTeleport` anchor teleport (ProdMafia `anchorName`). */
  anchorName: string;
  /**
   * Drop a chat payload once three distinct senders have used it inside five
   * minutes, the RMT spam signature. Read live by the `AntiSpam` plugin
   * (ProdMafia `chatSpamFilter`); its keyword list is always active.
   */
  chatSpamFilter: boolean;
  /**
   * Write Oryx 3 guard-state capture lines to `logs/debug-<date>.ndjson`. Read
   * live by the `O3Guard` plugin, which must also be loaded.
   */
  o3GuardCapture: boolean;
  /**
   * Let `O3Guard` add an alt-texture id to Auto Aim's `o3GuardAltTextureIds`
   * when our own hit claims land on Oryx 3 with his HP flat — the guard tell the
   * reference never captured. Off leaves the plugin purely diagnostic; run
   * `o3guard` to see what it would have learned.
   */
  o3GuardLearnFromStalls: boolean;
  /**
   * Known Oryx 3 guard alt-texture ids, comma separated (e.g. `"7, 9"`). Applied
   * to Auto Aim by `O3Guard` whenever Oryx 3 comes into view, so a captured id
   * survives a restart without editing a script.
   */
  o3GuardAltTextureIds: string;
  /** How close (in tiles) to a navigation target before it counts as reached. */
  arriveThreshold: number;
  /** Max listeners before Node warns about possible leaks. Keeps plugin leaks visible without being too noisy. */
  maxEventListeners: number;
  /** Max packets buffered while the socket is intentionally stalled. */
  stalledPacketQueueCap: number;
}

export const config: AppConfig = {
  rateLimitReconnectMs: 5 * 60 * 1000,
  reconnectBaseMs: 1000,
  reconnectMaxMs: 60 * 1000,
  connectTimeoutMs: 20 * 1000,
  livenessTimeoutMs: 30 * 1000,
  watchdogIntervalMs: 5 * 1000,
  autoEnterVault: false,
  autoLoot: false,
  autoConsumables: false,
  autoResponder: true,
  autoEnterPortals: false,
  autoEnterPortalWhitelist: '',
  followIntoPortals: true,
  anchorName: '',
  chatSpamFilter: true,
  o3GuardCapture: true,
  o3GuardLearnFromStalls: true,
  o3GuardAltTextureIds: '',
  arriveThreshold: 0.5,
  maxEventListeners: 100,
  stalledPacketQueueCap: 20000,
};

/**
 * Updates a config key from a string (e.g. console input), coercing to the
 * existing field's type. Returns true if the key exists and the value applied.
 */
export function setConfig(key: string, raw: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(config, key)) {
    return false;
  }
  const store = config as unknown as Record<string, unknown>;
  const current = store[key];
  if (typeof current === 'number') {
    const value = Number(raw);
    if (Number.isNaN(value)) {
      return false;
    }
    store[key] = value;
  } else if (typeof current === 'boolean') {
    store[key] = raw === 'true' || raw === '1';
  } else {
    store[key] = raw;
  }
  return true;
}
