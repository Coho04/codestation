import type { Db } from '../connection.js';

/**
 * Counters that make schema drift visible instead of silent.
 *
 * `unknown_record` rows are capped per type so a future high-volume record
 * cannot bloat the database, but the counts here stay complete — otherwise a
 * capped table would also cap the alarm.
 */
export class DiagnosticsRepository {
  readonly #bump;
  readonly #all;
  readonly #countUnknownOfType;
  readonly #insertUnknown;

  static readonly UNKNOWN_SAMPLE_CAP = 50;

  constructor(private readonly db: Db) {
    this.#bump = db.prepare(`
      INSERT INTO diagnostics (key, count, last_seen_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET count = count + excluded.count, last_seen_at = excluded.last_seen_at
    `);
    this.#all = db.prepare<[], { key: string; count: number; last_seen_at: number | null }>(
      'SELECT key, count, last_seen_at FROM diagnostics ORDER BY count DESC',
    );
    this.#countUnknownOfType = db.prepare<[string], { n: number }>(
      'SELECT count(*) AS n FROM unknown_record WHERE record_type = ?',
    );
    this.#insertUnknown = db.prepare(
      'INSERT INTO unknown_record (session_id, record_type, seq, ts, raw, app_version) VALUES (?, ?, ?, ?, ?, ?)',
    );
  }

  bump(key: string, by = 1, at: number = Date.now()): void {
    this.#bump.run(key, by, at);
  }

  recordUnknown(
    recordType: string,
    raw: string,
    sessionId: string | null,
    seq: number,
    ts: number | null,
    appVersion: string,
  ): void {
    this.bump(`unknown:${recordType}`);
    const existing = this.#countUnknownOfType.get(recordType)?.n ?? 0;
    if (existing >= DiagnosticsRepository.UNKNOWN_SAMPLE_CAP) return;
    this.#insertUnknown.run(sessionId, recordType, seq, ts, raw, appVersion);
  }

  all(): { key: string; count: number; lastSeenAt: number | null }[] {
    return this.#all.all().map((r) => ({ key: r.key, count: r.count, lastSeenAt: r.last_seen_at }));
  }

  unknownTypes(): string[] {
    return (
      this.db
        .prepare<[], { record_type: string }>(
          'SELECT DISTINCT record_type FROM unknown_record ORDER BY record_type',
        )
        .all()
    ).map((r) => r.record_type);
  }
}
