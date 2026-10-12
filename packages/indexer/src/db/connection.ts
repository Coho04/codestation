import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export type Db = Database.Database;

export interface OpenOptions {
  /** `:memory:` in tests. */
  readonly path: string;
  readonly readonly?: boolean;
}

/**
 * `mmap_size` and a 64 MB page cache matter here: the index is ~150 MB and the
 * session list touches it constantly. `synchronous=NORMAL` is the right trade
 * under WAL for a derived database — a crash can cost the last transaction, and
 * the last transaction is re-derivable from the transcript.
 */
export function openDatabase(options: OpenOptions): Db {
  if (options.path !== ':memory:') mkdirSync(dirname(options.path), { recursive: true });

  const db = new Database(options.path, { readonly: options.readonly ?? false });

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('temp_store = MEMORY');
  db.pragma('cache_size = -64000');
  db.pragma('mmap_size = 268435456');
  db.pragma('busy_timeout = 5000');

  return db;
}

/** Fails loudly at startup rather than at the first search. */
export function assertFts5(db: Db): void {
  const row = db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled").get() as
    | { enabled: number }
    | undefined;
  if (row?.enabled !== 1) {
    throw new Error('SQLite was built without FTS5; full-text search cannot work');
  }
}
