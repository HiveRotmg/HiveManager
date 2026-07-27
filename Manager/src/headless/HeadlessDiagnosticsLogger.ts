import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, type WriteStream } from 'fs';
import { join } from 'path';
import type { ClientDodgeDiagnostic, PacketTraffic } from 'headless-client';
import { Logger } from '../util/Logger.js';

export interface HeadlessLoggingSettings {
  dodge: boolean;
  packets: boolean;
}

export interface HeadlessLogContext {
  accountId: string;
  alias: string;
  serverName: string;
  /** Unique per connected-client lifetime, allowing reconnects to be separated in one file. */
  sessionId: string;
}

const DEFAULT_SETTINGS: HeadlessLoggingSettings = {
  dodge: false,
  packets: false,
};

function jsonLine(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item instanceof Set) return [...item];
    if (item instanceof Map) return Object.fromEntries(item);
    if (typeof item === 'bigint') return item.toString();
    if (typeof item === 'number' && !Number.isFinite(item)) return String(item);
    return item;
  }) + '\n';
}

/**
 * Owns Hive's opt-in, append-only diagnostics files. Write streams preserve
 * event order and buffer bursts without blocking the movement loop.
 */
export class HeadlessDiagnosticsLogger {
  readonly logsDir: string;
  readonly dodgeDir: string;
  readonly packetsDir: string;
  readonly dodgeFile: string;
  readonly packetsFile: string;
  readonly settingsFile: string;

  private settings: HeadlessLoggingSettings;
  private dodgeStream?: WriteStream;
  private packetsStream?: WriteStream;

  constructor(hiveDocumentsDir: string) {
    this.logsDir = join(hiveDocumentsDir, 'logs');
    this.dodgeDir = join(this.logsDir, 'dodge');
    this.packetsDir = join(this.logsDir, 'packets');
    this.dodgeFile = join(this.dodgeDir, 'dodge.txt');
    this.packetsFile = join(this.packetsDir, 'packets.txt');
    this.settingsFile = join(this.logsDir, 'settings.json');

    mkdirSync(this.dodgeDir, { recursive: true });
    mkdirSync(this.packetsDir, { recursive: true });
    if (!existsSync(this.dodgeFile)) writeFileSync(this.dodgeFile, '', 'utf8');
    if (!existsSync(this.packetsFile)) writeFileSync(this.packetsFile, '', 'utf8');
    this.settings = this.loadSettings();
    this.persistSettings();
  }

  getSettings(): HeadlessLoggingSettings {
    return { ...this.settings };
  }

  setSettings(update: Partial<HeadlessLoggingSettings>): HeadlessLoggingSettings {
    this.settings = {
      dodge: typeof update.dodge === 'boolean' ? update.dodge : this.settings.dodge,
      packets: typeof update.packets === 'boolean' ? update.packets : this.settings.packets,
    };
    if (!this.settings.dodge) this.closeStream('dodge');
    if (!this.settings.packets) this.closeStream('packets');
    this.persistSettings();
    return this.getSettings();
  }

  logPacket(context: HeadlessLogContext, traffic: PacketTraffic): void {
    if (!this.settings.packets) return;
    this.write('packets', jsonLine({
      timestamp: traffic.timestamp,
      timestampIso: new Date(traffic.timestamp).toISOString(),
      ...context,
      direction: traffic.direction,
      packetId: traffic.id,
      packetType: traffic.type == null ? null : String(traffic.type),
      size: traffic.size,
      connectionGeneration: traffic.connectionGeneration ?? null,
      payloadHex: traffic.payload.toString('hex'),
      dodgeCorrelation: traffic.dodgeCorrelation ?? null,
    }));
  }

  logDodge(context: HeadlessLogContext, diagnostic: ClientDodgeDiagnostic): void {
    if (!this.settings.dodge) return;
    this.write('dodge', jsonLine({
      ...context,
      ...diagnostic,
      timestampIso: new Date(diagnostic.timestamp).toISOString(),
    }));
  }

  close(): void {
    this.closeStream('dodge');
    this.closeStream('packets');
  }

  private loadSettings(): HeadlessLoggingSettings {
    try {
      if (!existsSync(this.settingsFile)) return { ...DEFAULT_SETTINGS };
      const raw = readFileSync(this.settingsFile, 'utf8').replace(/^\uFEFF/, '');
      const value = JSON.parse(raw) as Partial<HeadlessLoggingSettings>;
      return {
        dodge: value.dodge === true,
        packets: value.packets === true,
      };
    } catch (error) {
      Logger.warn('Diagnostics', `Could not read logging settings: ${(error as Error).message}`);
      return { ...DEFAULT_SETTINGS };
    }
  }

  private persistSettings(): void {
    writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2) + '\n', 'utf8');
  }

  private write(kind: 'dodge' | 'packets', line: string): void {
    let stream = kind === 'dodge' ? this.dodgeStream : this.packetsStream;
    if (!stream) {
      const path = kind === 'dodge' ? this.dodgeFile : this.packetsFile;
      stream = createWriteStream(path, { flags: 'a', encoding: 'utf8' });
      stream.on('error', (error) => Logger.warn('Diagnostics', `${kind} log write failed: ${error.message}`));
      if (kind === 'dodge') this.dodgeStream = stream;
      else this.packetsStream = stream;
    }
    stream.write(line);
  }

  private closeStream(kind: 'dodge' | 'packets'): void {
    const stream = kind === 'dodge' ? this.dodgeStream : this.packetsStream;
    if (!stream) return;
    stream.end();
    if (kind === 'dodge') this.dodgeStream = undefined;
    else this.packetsStream = undefined;
  }
}
