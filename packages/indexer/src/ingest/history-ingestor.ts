import { createHash } from 'node:crypto';
import type { ClaudeHome } from '../claude-home.js';
import type { Db } from '../db/connection.js';
import type { CursorRepository } from '../db/repositories/cursor-repository.js';
import type { FileSystemPort } from '../ports/file-system.js';
import { readJsonlLines, type ReadResult } from '../parsing/jsonl-line-reader.js';
import { decideCursor, HEAD_HASH_BYTES, initialCursor } from './file-cursor.js';

/**
 * history.jsonl holds every prompt the user typed, with the real (unencoded)
 * cwd. It is accumulated rather than mirrored: Claude Code prunes this file
 * too, and once a transcript is gone these rows are the only remaining trace of
 * what was asked in that session.
 */
export class HistoryIngestor {
  readonly #insert;

  constructor(
    private readonly db: Db,
    private readonly fs: FileSystemPort,
    private readonly home: ClaudeHome,
    private readonly cursors: CursorRepository,
  ) {
    this.#insert = db.prepare(`
      INSERT INTO prompt_history (ts, project_path, session_id, display, pasted_count, pasted_bytes, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ts, hash) DO NOTHING
    `);
  }

  async sync(): Promise<number> {
    const path = this.home.historyJsonl;
    const stat = await this.fs.stat(path);
    const cursor = this.cursors.get(path) ?? initialCursor(path, 'history');
    const decision = await decideCursor(this.cursors.get(path), stat, () =>
      this.fs.sha256(path, HEAD_HASH_BYTES),
    );

    if (stat === null || decision.kind === 'skip' || decision.kind === 'vanished') return 0;

    const from = decision.kind === 'append' ? decision.from : 0;
    const fromLine = decision.kind === 'append' ? decision.fromLine : 0;

    const rows: { ts: number; project: string; session: string | null; display: string; pasted: unknown }[] = [];
    let result: ReadResult = { nextOffset: from, nextLineNo: fromLine, sawOversizedLine: false };

    for await (const line of readJsonlLines(this.fs.readStream(path, from), from, fromLine, (r) => (result = r))) {
      try {
        const entry = JSON.parse(line.text) as Record<string, unknown>;
        const ts = typeof entry['timestamp'] === 'number' ? entry['timestamp'] : null;
        const project = typeof entry['project'] === 'string' ? entry['project'] : null;
        const display = typeof entry['display'] === 'string' ? entry['display'] : null;
        if (ts === null || project === null || display === null) continue;
        rows.push({
          ts,
          project,
          session: typeof entry['sessionId'] === 'string' ? entry['sessionId'] : null,
          display,
          pasted: entry['pastedContents'],
        });
      } catch {
        // A single malformed line is not worth abandoning the file for.
      }
    }

    const headSha = await this.fs.sha256(path, HEAD_HASH_BYTES);
    let written = 0;

    this.db.transaction(() => {
      for (const row of rows) {
        const hash = createHash('sha256').update(`${row.project}\u0000${row.display}`).digest('hex').slice(0, 32);
        const pasted = typeof row.pasted === 'object' && row.pasted !== null ? row.pasted : {};
        const pastedJson = JSON.stringify(pasted);
        const info = this.#insert.run(
          row.ts,
          row.project,
          row.session,
          row.display,
          Object.keys(pasted).length,
          pastedJson.length,
          hash,
        );
        written += info.changes;
      }
      this.cursors.save(
        {
          ...cursor,
          byteOffset: result.nextOffset,
          lineNo: result.nextLineNo,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          inode: stat.inode,
          headSha256: headSha,
          state: 'complete',
        },
        null,
        Date.now(),
      );
    })();

    return written;
  }
}
