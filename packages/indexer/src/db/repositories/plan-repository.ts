import { planId as toPlanId, sessionId as toSessionId, type PlanDoc, type PlanId } from '@cs/shared';
import type { Db } from '../connection.js';

interface PlanRow {
  id: number;
  file_path: string;
  slug: string;
  title: string | null;
  mtime: number;
  size: number;
  body: string | null;
  file_present: number;
}

export class PlanRepository {
  readonly #upsert;

  constructor(private readonly db: Db) {
    this.#upsert = db.prepare(`
      INSERT INTO plan (file_path, slug, title, mtime, size, content_hash, body, file_present)
      VALUES (@filePath, @slug, @title, @mtime, @size, @hash, @body, 1)
      ON CONFLICT(file_path) DO UPDATE SET
        title = excluded.title, mtime = excluded.mtime, size = excluded.size,
        content_hash = excluded.content_hash, body = excluded.body, file_present = 1
    `);
  }

  upsert(input: {
    filePath: string;
    slug: string;
    title: string | null;
    mtime: number;
    size: number;
    hash: string;
    body: string;
  }): PlanId {
    this.#upsert.run(input);
    const row = this.db
      .prepare<[string], { id: number }>('SELECT id FROM plan WHERE file_path = ?')
      .get(input.filePath);
    const id = toPlanId(row?.id ?? 0);

    // fts_plan is a plain FTS table (no external content), so it is maintained
    // here rather than by a trigger.
    this.db.prepare('DELETE FROM fts_plan WHERE rowid = ?').run(id);
    this.db
      .prepare('INSERT INTO fts_plan (rowid, title, body) VALUES (?, ?, ?)')
      .run(id, input.title ?? '', input.body);
    return id;
  }

  markMissing(presentPaths: readonly string[]): void {
    if (presentPaths.length === 0) {
      this.db.prepare('UPDATE plan SET file_present = 0').run();
      return;
    }
    const placeholders = presentPaths.map(() => '?').join(',');
    this.db
      .prepare(`UPDATE plan SET file_present = 0 WHERE file_path NOT IN (${placeholders})`)
      .run(...(presentPaths as string[]));
  }

  /**
   * Links a plan to the sessions that wrote it.
   *
   * Plan files carry no front matter and no session reference, so the only hard
   * evidence is a `file-history-delta` whose trackingPath points at the file.
   * An mtime window is kept as a weaker signal, flagged by its confidence.
   */
  relink(): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM plan_link').run();
      this.db
        .prepare(
          `INSERT OR IGNORE INTO plan_link (plan_id, session_id, method, confidence)
           SELECT p.id, f.session_id, 'tracking-path', 1.0
           FROM plan p JOIN file_touch f ON f.abs_path = p.file_path`,
        )
        .run();
      this.db
        .prepare(
          `INSERT OR IGNORE INTO plan_link (plan_id, session_id, method, confidence)
           SELECT p.id, s.id, 'mtime', 0.5
           FROM plan p JOIN session s
             ON p.mtime BETWEEN coalesce(s.started_at, 0) AND coalesce(s.ended_at, 0) + 300000
           WHERE NOT EXISTS (SELECT 1 FROM plan_link l WHERE l.plan_id = p.id)`,
        )
        .run();
    })();
  }

  list(): PlanDoc[] {
    return this.db
      .prepare<[], PlanRow>('SELECT * FROM plan ORDER BY mtime DESC')
      .all()
      .map((row) => this.#toDoc(row));
  }

  get(id: PlanId): (PlanDoc & { body: string }) | null {
    const row = this.db.prepare<[number], PlanRow>('SELECT * FROM plan WHERE id = ?').get(id);
    if (row === undefined) return null;
    return { ...this.#toDoc(row), body: row.body ?? '' };
  }

  #toDoc(row: PlanRow): PlanDoc {
    const links = this.db
      .prepare<[number], { session_id: string; title: string | null; method: string; confidence: number }>(
        `SELECT l.session_id, s.title, l.method, l.confidence
         FROM plan_link l LEFT JOIN session s ON s.id = l.session_id
         WHERE l.plan_id = ? ORDER BY l.confidence DESC`,
      )
      .all(row.id)
      .map((link) => ({
        sessionId: toSessionId(link.session_id),
        sessionTitle: link.title ?? '(ohne Titel)',
        confidence: link.confidence,
        method: link.method as 'tracking-path' | 'mtime',
      }));

    return {
      id: toPlanId(row.id),
      filePath: row.file_path,
      slug: row.slug,
      title: row.title ?? row.slug,
      mtime: row.mtime,
      size: row.size,
      filePresent: row.file_present === 1,
      links,
    };
  }
}
