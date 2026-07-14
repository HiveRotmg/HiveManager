import { format } from 'node:util';
import type { PacketTraffic } from 'headless-client';
import { getScriptExecutionSession } from '../scripts/ScriptExecutionContext.js';

export type RuntimeLogLevel = 'debug' | 'info' | 'warning' | 'error';

export interface RuntimeLogEntry {
  seq: number;
  timestamp: number;
  level: RuntimeLogLevel;
  source: 'runtime' | 'script';
  message: string;
  accountId?: string;
  scriptId?: string;
}

export interface RuntimeLogQuery {
  afterSeq?: number;
  limit?: number;
  accountId?: string;
  levels?: RuntimeLogLevel[];
  contains?: string;
}

export interface PacketDiagnosticEntry {
  seq: number;
  timestamp: number;
  accountId: string;
  direction: 'incoming' | 'outgoing';
  id: number;
  type: string;
  size: number;
  payload: Buffer;
  payloadTruncated: boolean;
}

export interface PacketDiagnosticQuery {
  afterSeq?: number;
  limit?: number;
  accountId?: string;
  direction?: 'incoming' | 'outgoing';
  types?: string[];
}

const LOG_HISTORY_LIMIT = 2_000;
const PACKET_HISTORY_LIMIT = 500;
const PACKET_PAYLOAD_LIMIT = 16 * 1024;

type LogListener = (entry: RuntimeLogEntry) => void;
type AccountResolver = (message: string) => string | undefined;

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(value!)));
}

function renderConsoleArgs(args: unknown[]): string {
  try {
    return format(...args);
  } catch {
    return args.map((value) => {
      try { return String(value); } catch { return '[unprintable]'; }
    }).join(' ');
  }
}

export class RuntimeDiagnostics {
  private readonly logs: RuntimeLogEntry[] = [];
  private readonly packets: PacketDiagnosticEntry[] = [];
  private readonly logListeners = new Set<LogListener>();
  private logSequence = 0;
  private packetSequence = 0;
  private restoreConsoleCapture?: () => void;

  installConsoleCapture(resolveAccount?: AccountResolver): void {
    if (this.restoreConsoleCapture) return;

    const original = {
      debug: console.debug.bind(console),
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    };
    const capture = (level: RuntimeLogLevel, args: unknown[]): void => {
      const message = renderConsoleArgs(args);
      const session = getScriptExecutionSession();
      this.appendLog({
        level,
        source: session?.scriptId ? 'script' : 'runtime',
        message,
        accountId: session?.accountId ?? resolveAccount?.(message),
        scriptId: session?.scriptId,
      });
    };

    console.debug = (...args: unknown[]) => { original.debug(...args); capture('debug', args); };
    console.log = (...args: unknown[]) => { original.log(...args); capture('info', args); };
    console.warn = (...args: unknown[]) => { original.warn(...args); capture('warning', args); };
    console.error = (...args: unknown[]) => { original.error(...args); capture('error', args); };

    this.restoreConsoleCapture = () => {
      console.debug = original.debug;
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
      this.restoreConsoleCapture = undefined;
    };
  }

  stopConsoleCapture(): void {
    this.restoreConsoleCapture?.();
  }

  appendScriptLog(
    scriptId: string,
    message: string,
    level: 'info' | 'warn' | 'error',
    accountId?: string,
  ): RuntimeLogEntry {
    return this.appendLog({
      level: level === 'warn' ? 'warning' : level,
      source: 'script',
      message,
      scriptId,
      accountId,
    });
  }

  appendPacket(accountId: string, traffic: PacketTraffic): PacketDiagnosticEntry {
    const payload = Buffer.from(traffic.payload.subarray(0, PACKET_PAYLOAD_LIMIT));
    const entry: PacketDiagnosticEntry = {
      seq: ++this.packetSequence,
      timestamp: traffic.timestamp,
      accountId,
      direction: traffic.direction,
      id: traffic.id,
      type: String(traffic.type ?? `UNKNOWN_${traffic.id}`),
      size: traffic.size,
      payload,
      payloadTruncated: traffic.payload.length > payload.length,
    };
    this.packets.push(entry);
    if (this.packets.length > PACKET_HISTORY_LIMIT) {
      this.packets.splice(0, this.packets.length - PACKET_HISTORY_LIMIT);
    }
    return entry;
  }

  recentLogs(query: RuntimeLogQuery = {}): RuntimeLogEntry[] {
    const afterSeq = Number.isFinite(query.afterSeq) ? Math.trunc(query.afterSeq!) : 0;
    const accountId = query.accountId?.trim();
    const contains = query.contains?.trim().toLowerCase();
    const levels = query.levels?.length ? new Set(query.levels) : undefined;
    const filtered = this.logs.filter((entry) => (
      entry.seq > afterSeq
      && (!accountId || entry.accountId === accountId)
      && (!levels || levels.has(entry.level))
      && (!contains || entry.message.toLowerCase().includes(contains))
    ));
    return filtered.slice(-clampLimit(query.limit, 200, 1_000));
  }

  recentPackets(query: PacketDiagnosticQuery = {}): PacketDiagnosticEntry[] {
    const afterSeq = Number.isFinite(query.afterSeq) ? Math.trunc(query.afterSeq!) : 0;
    const accountId = query.accountId?.trim();
    const types = query.types?.length
      ? new Set(query.types.map((type) => type.trim().toUpperCase()).filter(Boolean))
      : undefined;
    const filtered = this.packets.filter((entry) => (
      entry.seq > afterSeq
      && (!accountId || entry.accountId === accountId)
      && (!query.direction || entry.direction === query.direction)
      && (!types || types.has(entry.type.toUpperCase()))
    ));
    return filtered.slice(-clampLimit(query.limit, 100, PACKET_HISTORY_LIMIT));
  }

  clear(accountId?: string): { logsRemoved: number; packetsRemoved: number } {
    const normalized = accountId?.trim();
    if (!normalized) {
      const result = { logsRemoved: this.logs.length, packetsRemoved: this.packets.length };
      this.logs.length = 0;
      this.packets.length = 0;
      return result;
    }

    const logsBefore = this.logs.length;
    const packetsBefore = this.packets.length;
    this.removeWhere(this.logs, (entry) => entry.accountId === normalized);
    this.removeWhere(this.packets, (entry) => entry.accountId === normalized);
    return {
      logsRemoved: logsBefore - this.logs.length,
      packetsRemoved: packetsBefore - this.packets.length,
    };
  }

  onLog(listener: LogListener): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  private appendLog(input: Omit<RuntimeLogEntry, 'seq' | 'timestamp'>): RuntimeLogEntry {
    const entry: RuntimeLogEntry = {
      seq: ++this.logSequence,
      timestamp: Date.now(),
      ...input,
    };
    this.logs.push(entry);
    if (this.logs.length > LOG_HISTORY_LIMIT) {
      this.logs.splice(0, this.logs.length - LOG_HISTORY_LIMIT);
    }
    for (const listener of this.logListeners) {
      try { listener(entry); } catch { /* diagnostics must not affect the Manager */ }
    }
    return entry;
  }

  private removeWhere<T>(items: T[], predicate: (item: T) => boolean): void {
    for (let index = items.length - 1; index >= 0; index--) {
      if (predicate(items[index]!)) items.splice(index, 1);
    }
  }
}
