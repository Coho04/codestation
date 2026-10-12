import type { Db } from '../connection.js';
import type { CursorState, IngestCursor } from '../../ingest/file-cursor.js';

interface Row {
  path: string;
  kind: string;
  byte_offset: number;
  line_no: number;
  size: number;
  mtime_ms: number;
  inode: string | null;
  head_sha256: string | null;
  state: string;
  error_count: number;
}

const toCursor = (row: Row): IngestCursor => ({
  path: row.path,
  kind: row.kind,
  byteOffset: row.byte_offset,
  lineNo: row.line_no,
  size: row.size,
  mtimeMs: row.mtime_ms,
  inode: row.inode,
  headSha256: row.head_sha256,
  state: row.state as CursorState,
  errorCount: row.error_count,
});

export class CursorRepository {
  readonly #get;
  readonly #upsert;
  readonly #markState;
  readonly #listByKind;
  readonly #allPaths;

  constructor(private readonly db: Db) {
    this.#get = db.prepare<[string], Row>('SELECT * FROM ingest_cursor WHERE path = ?');
    this.#upsert = db.prepare(`
      INSERT INTO ingest_cursor
        (path, kind, byte_offset, line_no, size, mtime_ms, inode, head_sha256, state, error_count, last_error, last_ok_at)
      VALUES
        (@path, @kind, @byteOffset, @lineNo, @size, @mtimeMs, @inode, @headSha256, @state, @errorCount, @lastError, @lastOkAt)
      ON CONFLICT(path) DO UPDATE SET
        kind = excluded.kind, byte_offset = excluded.byte_offset, line_no = excluded.line_no,
        size = excluded.size, mtime_ms = excluded.mtime_ms, inode = excluded.inode,
        head_sha256 = excluded.head_sha256, state = excluded.state,
        error_count = excluded.error_count, last_error = excluded.last_error,
        last_ok_at = excluded.last_ok_at
    `);
    this.#markState = db.prepare(
      'UPDATE ingest_cursor SET state = ?, last_error = ?, error_count = error_count + ? WHERE path = ?',
    );
    this.#listByKind = db.prepare<[string], Row>('SELECT * FROM ingest_cursor WHERE kind = ?');
    this.#allPaths = db.prepare<[string], { path: string }>(
      'SELECT path FROM ingest_cursor WHERE kind = ?',
    );
  }

  get(path: string): IngestCursor | null {
    const row = this.#get.get(path);
    return row === undefined ? null : toCursor(row);
  }

  listByKind(kind: string): IngestCursor[] {
    return this.#listByKind.all(kind).map(toCursor);
  }

  pathsByKind(kind: string): string[] {
    return this.#allPaths.all(kind).map((r) => r.path);
  }

  /**
   * Written inside the same transaction as the rows it describes, which is what
   * makes an interrupted import resumable rather than merely restartable.
   */
  save(cursor: IngestCursor, lastError: string | null, lastOkAt: number | null): void {
    this.#upsert.run({
      path: cursor.path,
      kind: cursor.kind,
      byteOffset: cursor.byteOffset,
      lineNo: cursor.lineNo,
      size: cursor.size,
      mtimeMs: cursor.mtimeMs,
      inode: cursor.inode,
      headSha256: cursor.headSha256,
      state: cursor.state,
      errorCount: cursor.errorCount,
      lastError,
      lastOkAt,
    });
  }

  markError(path: string, message: string): void {
    this.#markState.run('error', message.slice(0, 500), 1, path);
  }

  markVanished(path: string): void {
    this.#markState.run('vanished', null, 0, path);
  }

  /**
   * Drops progress for a path entirely.
   *
   * Required when forgetting a session: leaving the cursor behind would make the
   * reconcile sweep see an unchanged file and skip it forever, so restoring the
   * tombstone would appear to do nothing.
   */
  remove(path: string): void {
    this.db.prepare('DELETE FROM ingest_cursor WHERE path = ?').run(path);
  }

  removeUnder(prefix: string): void {
    this.db.prepare('DELETE FROM ingest_cursor WHERE path LIKE ?').run(`${prefix}%`);
  }

  /** Used by "rebuild index": forget progress without forgetting the files. */
  resetAll(): void {
    this.db.prepare("UPDATE ingest_cursor SET byte_offset = 0, line_no = 0, state = 'pending'").run();
  }
}
