import type { Db } from '../db/connection.js';

/**
 * Resolves conversation edges that cross file boundaries.
 *
 * 47 of 359 transcripts on this machine have no root node at all: their first
 * message's parent lives in a different file, because the session was resumed or
 * compacted. Without this pass those sessions look like fragments; with it the
 * UI can say "this continues that".
 *
 * The global uuid index makes the lookup a join rather than a scan, so the whole
 * pass is milliseconds over 130k rows.
 */
export class SessionLinker {
  constructor(private readonly db: Db) {}

  link(): number {
    const resolved = this.db
      .prepare<[], { child: string; parent_session: string; parent_uuid: string }>(
        `SELECT DISTINCT m.session_id AS child, p.session_id AS parent_session, m.parent_uuid AS parent_uuid
         FROM message m
         JOIN message p ON p.uuid = m.parent_uuid AND p.session_id != m.session_id
         WHERE m.parent_uuid IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM message s WHERE s.session_id = m.session_id AND s.uuid = m.parent_uuid
           )`,
      )
      .all();

    const update = this.db.prepare(
      `UPDATE session SET continued_from_session = ?, continued_from_uuid = ?
       WHERE id = ? AND continued_from_session IS NULL`,
    );

    let count = 0;
    this.db.transaction(() => {
      for (const row of resolved) {
        // A subagent already has a parent link of its own; do not overwrite it.
        count += update.run(row.parent_session, row.parent_uuid, row.child).changes;
      }
    })();

    return count;
  }
}
