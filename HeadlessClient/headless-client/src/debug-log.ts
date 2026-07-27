import fs from 'node:fs';
import path from 'node:path';

/**
 * Structured NDJSON diagnostic log — one JSON object per line, appended to
 * `<cwd>/logs/debug-YYYY-MM-DD.ndjson` (a new file per day, appended across
 * runs so every process start that day lands in the same file).
 *
 * Each line: `{"ts":<epoch ms>,"iso":"<utc>","ms":<uptime ms>,"sid":"<session>",
 * "ev":"<event>","data":{...}}`. `sid` is unique per process, so lines group by
 * run when reading a shared file later.
 *
 * Port of ProdMafia's `DebugLog` (src/kabam/lib/net/impl/DebugLog.as), which
 * defines this format and its retention rules; keeping the shape identical means
 * the same analysis scripts read logs from either client. Writes are
 * exception-safe — logging must never break a client — and intended for
 * low-rate diagnostics, not per-frame spam.
 */
class DebugLog {
  /** Set false to make every `event` call a no-op. */
  enabled = true;

  private directory = path.resolve(process.cwd(), 'logs');
  private sessionId: string | undefined;
  private currentPath = '';
  private prunedThisRun = false;

  /** Redirects the log directory. Only affects lines written after the call. */
  setDirectory(directory: string): void {
    this.directory = directory;
    this.currentPath = '';
    this.prunedThisRun = false;
  }

  /** Path of today's file, or `''` before the first successful write. */
  get path(): string {
    return this.currentPath;
  }

  /** Appends one event line. Safe to call from anywhere, at any time. */
  event(name: string, data?: Record<string, unknown>): void {
    if (!this.enabled) return;
    try {
      const now = new Date();
      const line: Record<string, unknown> = {
        ts: now.getTime(),
        iso: now.toISOString(),
        ms: Math.round(process.uptime() * 1000),
        sid: this.session(now),
        ev: name,
      };
      if (data !== undefined) line.data = data;
      this.write(`${JSON.stringify(line)}\n`, now);
    } catch {
      // Logging must never break the caller.
    }
  }

  private session(now: Date): string {
    this.sessionId ??= `${now.getTime().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(16)}`;
    return this.sessionId;
  }

  private write(chunk: string, now: Date): void {
    const stamp = now.toISOString().slice(0, 10);
    const file = path.join(this.directory, `debug-${stamp}.ndjson`);
    if (this.currentPath !== file) {
      fs.mkdirSync(this.directory, { recursive: true });
      this.currentPath = file;
      // Rotating on the first write of a run (and on a day roll) is cheap and
      // keeps the directory bounded; the source found 335MB of stale ndjson
      // without it.
      this.prune(stamp);
    }
    fs.appendFileSync(file, chunk);
  }

  /** Deletes `debug-*.ndjson` older than three days, at most once per run. */
  private prune(todayStamp: string): void {
    if (this.prunedThisRun) return;
    this.prunedThisRun = true;
    try {
      const cutoff = Date.now() - 3 * 86_400_000;
      for (const name of fs.readdirSync(this.directory)) {
        if (!name.startsWith('debug-') || !name.endsWith('.ndjson')) continue;
        if (name.includes(todayStamp)) continue; // never the file we write
        const file = path.join(this.directory, name);
        if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
      }
    } catch {
      // A failed prune must never stop logging.
    }
  }
}

/** Process-wide NDJSON diagnostic log. */
export const debugLog = new DebugLog();
