import { EnemyHitPacket, PacketType, Reader, StatType, TextPacket, type PlayerData } from 'realmlib';
import type { Client, PacketTraffic } from '../client';
import { config } from '../config';
import { debugLog } from '../debug-log';
import { ClientEvent } from '../events';
import type { TrackedObject } from '../models';
import {
  ALT_TEXTURE_STAT,
  O3GuardObserver,
  ORYX3_TYPE,
  isSilenced,
  type O3GuardStatus,
} from '../o3-guard';
import { EventHook, PacketHook, Plugin } from './decorators';

/** Heartbeat interval for capture lines when nothing about O3's state changed. */
const HEARTBEAT_MS = 1_000;

/**
 * Captures Oryx the Mad God 3's guard state to the NDJSON debug log so one
 * fight can populate Auto Aim's `o3GuardAltTextureIds`. ProdMafia's
 * `avoidO3Shield` needs those ids but never captured them (`Player.as:2600-2628`).
 *
 * Every line lands in `logs/debug-YYYY-MM-DD.ndjson` via `debugLog.event`
 * (same shape as ProdMafia `DebugLog`):
 *
 * - `o3_enter` / `o3_exit` — O3 came into or left view, with the map name.
 * - `o3_state` — his alt texture, either condition word or the damage-blocked
 *   diagnostic flag changed.
 * - `o3_sample` — a once-a-second heartbeat of the same record, so HP over time
 *   is in the file even while nothing else moves.
 * - `o3_text` — any TEXT received while he is in view, which is how the counter
 *   line ("You are unfit to speak in my presence!") gets timestamped next to the
 *   sprite that was showing when it fired.
 * - `o3_silence` — our own character gained or lost Silence while he is in view.
 *
 * Each state/sample record carries the alt texture, both condition words with
 * their bit names, HP and HP fraction, the ENEMYHIT claims we have outstanding,
 * and `damageRegistering`. After a run, grep `o3_silence` / the counter
 * `o3_text` and read the surrounding `altTexture` values into
 * `config.o3GuardAltTextureIds` (or `o3guard ids …`).
 *
 * HP-stall auto-learning is deliberately not shipped — see `o3-guard.ts`.
 */
@Plugin({
  name: 'O3Guard',
  description: "Captures Oryx 3's guard state to NDJSON so a fight can pin the guard sprite ids.",
  author: 'headless-client',
  version: '1.0.0',
})
export class O3GuardCapture {
  private readonly observer = new O3GuardObserver();
  private tracking = false;
  private lastHeartbeatAt = 0;
  private lastStateKey = '';
  private silenced = false;
  private appliedConfigIds = '';

  @EventHook(ClientEvent.Tick)
  onTick(client: Client, player: PlayerData | undefined): void {
    const oryx = client.visibleObjects().find((object) => object.type === ORYX3_TYPE);
    if (!oryx) {
      if (this.tracking) {
        this.tracking = false;
        this.log('o3_exit', { map: client.getMapName(), ...this.observer.status() });
      }
      return;
    }
    if (!this.tracking) {
      this.tracking = true;
      this.lastStateKey = '';
      this.log('o3_enter', { map: client.getMapName(), objectId: oryx.objectId, alias: client.alias });
    }
    this.applyConfiguredIds(client);
    this.observeSilence(client, player);

    const now = Date.now();
    const sample = this.observer.observe(now, {
      objectId: oryx.objectId,
      hp: stat(oryx, StatType.HP_STAT, oryx.player?.hp ?? 0),
      maxHp: stat(oryx, StatType.MAX_HP_STAT, oryx.player?.maxHP ?? 0),
      altTexture: stat(oryx, ALT_TEXTURE_STAT, -1),
      condition: stat(oryx, StatType.CONDITION_STAT, oryx.player?.condition ?? 0),
      condition2: stat(oryx, StatType.NEW_CON_STAT, oryx.player?.condition2 ?? 0),
      x: oryx.x,
      y: oryx.y,
    });

    const key = `${sample.altTexture}|${sample.condition}|${sample.condition2}|${sample.damageBlocked}`;
    if (key !== this.lastStateKey) {
      this.lastStateKey = key;
      this.log('o3_state', { ...sample });
    } else if (now - this.lastHeartbeatAt >= HEARTBEAT_MS) {
      this.lastHeartbeatAt = now;
      this.log('o3_sample', { ...sample });
    }
  }

  /**
   * Counts the ENEMYHIT claims we send at O3. Plugins only receive incoming
   * packets, so the claims are read back off the raw outgoing traffic feed.
   */
  @EventHook(ClientEvent.PacketTraffic)
  onPacketTraffic(_client: Client, traffic: PacketTraffic): void {
    if (!this.tracking) return;
    if (traffic.direction !== 'outgoing' || traffic.type !== PacketType.ENEMYHIT) return;
    const packet = new EnemyHitPacket();
    const reader = new Reader(traffic.payload.length);
    traffic.payload.copy(reader.buffer);
    packet.read(reader);
    this.observer.onEnemyHit(Date.now(), packet.targetId);
  }

  /** Timestamps every line spoken while O3 is in view, counter line included. */
  @PacketHook()
  onText(_client: Client, text: TextPacket): void {
    if (!this.tracking) return;
    this.log('o3_text', {
      name: text.name,
      text: text.text,
      recipient: text.recipient,
      numStars: text.numStars,
      state: this.observer.status().altTexture,
      damageBlocked: this.observer.status().damageBlocked,
    });
  }

  @EventHook(ClientEvent.ObjectRemoved)
  onObjectRemoved(_client: Client, object: TrackedObject): void {
    if (object.type === ORYX3_TYPE) this.observer.removeObject(object.objectId);
  }

  @EventHook(ClientEvent.MapChange)
  onMapChange(): void {
    this.tracking = false;
    this.silenced = false;
    this.observer.clear();
  }

  /** Capture state for the console, the web panel and tests. */
  status(): O3GuardStatus & { capturing: boolean } {
    return {
      ...this.observer.status(),
      capturing: config.o3GuardCapture,
    };
  }

  /**
   * Applies guard alt-texture ids to Auto Aim by hand. Returns the ids Auto Aim
   * ended up with, so a console command can echo them back.
   */
  applyIds(client: Client, ids: readonly number[]): number[] {
    const merged = new Set(client.getAutoCombatState()?.autoAim.o3GuardAltTextureIds ?? []);
    for (const id of ids) if (Number.isInteger(id) && id > 0) merged.add(id);
    const next = [...merged].sort((a, b) => a - b);
    client.configureAutoAim({ o3GuardAltTextureIds: next });
    return next;
  }

  /** Mirrors `config.o3GuardAltTextureIds` into Auto Aim when it changes. */
  private applyConfiguredIds(client: Client): void {
    const raw = config.o3GuardAltTextureIds;
    if (raw === this.appliedConfigIds) return;
    this.appliedConfigIds = raw;
    const ids = parseAltTextureIds(raw);
    if (ids.length === 0) return;
    const applied = this.applyIds(client, ids);
    console.log(`[${client.alias}] O3Guard: Auto Aim avoids guard alt-textures [${applied.join(', ')}]`);
  }

  /**
   * Our own Silence is the counter's fingerprint: whatever sprite was showing
   * when this flips is the guard, so it belongs in the capture file.
   */
  private observeSilence(client: Client, player: PlayerData | undefined): void {
    const silenced = isSilenced(player?.condition2);
    if (silenced === this.silenced) return;
    this.silenced = silenced;
    const status = this.observer.status();
    this.log('o3_silence', {
      silenced,
      map: client.getMapName(),
      altTexture: status.altTexture,
      hp: status.hp,
      hpFraction: status.hpFraction,
      damageBlocked: status.damageBlocked,
    });
    if (silenced) {
      console.warn(
        `[${client.alias}] O3Guard: SILENCED while Oryx 3 is in view — his alt texture is ` +
          `${status.altTexture}; see the capture log for the surrounding samples.`,
      );
    }
  }

  private log(event: string, data: Record<string, unknown>): void {
    if (!config.o3GuardCapture) return;
    debugLog.event(event, data);
  }
}

/** Reads a numeric wire stat, falling back when the server never sent it. */
function stat(object: TrackedObject, statType: number, fallback: number): number {
  const value = object.rawStats?.[String(statType)];
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

/** Parses `config.o3GuardAltTextureIds` ("7, 9") into ids. */
export function parseAltTextureIds(raw: string): number[] {
  return [...new Set(
    String(raw ?? '')
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((value) => Number.isInteger(value) && value > 0),
  )].sort((a, b) => a - b);
}
