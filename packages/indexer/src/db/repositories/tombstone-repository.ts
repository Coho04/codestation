import type { Db } from '../connection.js';

export type TombstoneKind = 'project' | 'session';

export interface Tombstone {
  readonly path: string;
  readonly kind: TombstoneKind;
  readonly label: string | null;
  readonly sessionId: string | null;
  readonly createdAt: number;
}

/**
 * Paths the user asked the index to forget.
 *
 * Without this the reconcile sweep rediscovers everything within a minute and
 * "remove from the index" would appear to do nothing. The entries are listed in
 * the archive view so forgetting stays reversible.
 */
export class TombstoneRepository {
  readonly #add;
  readonly #remove;
  readonly #all;

  constructor(db: Db) {
    this.#add = db.prepare(`
      INSERT INTO tombstone (path, kind, label, session_id, created_at)
      VALUES (@path, @kind, @label, @sessionId, @createdAt)
      ON CONFLICT(path) DO UPDATE SET
        kind = excluded.kind, label = excluded.label,
        session_id = excluded.session_id, created_at = excluded.created_at
    `);
    this.#remove = db.prepare('DELETE FROM tombstone WHERE path = ?');
    this.#all = db.prepare<[], {
      path: string;
      kind: string;
      label: string | null;
      session_id: string | null;
      created_at: number;
    }>('SELECT * FROM tombstone ORDER BY created_at DESC');
  }

  add(tombstone: Tombstone): void {
    this.#add.run(tombstone);
  }

  remove(path: string): void {
    this.#remove.run(path);
  }

  list(): Tombstone[] {
    return this.#all.all().map((row) => ({
      path: row.path,
      kind: row.kind as TombstoneKind,
      label: row.label,
      sessionId: row.session_id,
      createdAt: row.created_at,
    }));
  }

  /** Read once per scan; a Set keeps the scanner's inner loop cheap. */
  paths(): Set<string> {
    return new Set(this.#all.all().map((row) => row.path));
  }
}
