import type { FileStat } from '../ports/file-system.js';

export type CursorState = 'pending' | 'partial' | 'complete' | 'error' | 'vanished';

export interface IngestCursor {
  readonly path: string;
  readonly kind: string;
  readonly byteOffset: number;
  readonly lineNo: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly inode: string | null;
  readonly headSha256: string | null;
  readonly state: CursorState;
  readonly errorCount: number;
}

export type CursorDecision =
  /** Nothing changed — the common case for ~580 of 585 files on every sweep. */
  | { readonly kind: 'skip' }
  | { readonly kind: 'append'; readonly from: number; readonly fromLine: number }
  /** Content before our offset changed; everything for this file must be redone. */
  | { readonly kind: 'reindex' }
  | { readonly kind: 'vanished' };

export const HEAD_HASH_BYTES = 64 * 1024;

/**
 * Decides how much of a transcript needs reading.
 *
 * Transcripts are append-only in normal operation, but three abnormal things
 * happen in practice and each has to be told apart:
 *  - the file is replaced by rename (inode changes, content may still be a
 *    superset — Claude Code rewrites a transcript when compacting);
 *  - the file is rewritten in place and is now shorter;
 *  - the file is removed entirely by Claude Code's own housekeeping.
 *
 * `headSha256` over the first 64 KiB is what separates "replaced but still the
 * same conversation" from "genuinely different file", so a compaction does not
 * force a full re-read of 83 MB.
 */
export async function decideCursor(
  cursor: IngestCursor | null,
  stat: FileStat | null,
  readHeadHash: () => Promise<string | null>,
): Promise<CursorDecision> {
  if (stat === null) return cursor === null ? { kind: 'skip' } : { kind: 'vanished' };
  if (stat.isDirectory) return { kind: 'skip' };
  if (cursor === null || cursor.state === 'vanished') return { kind: 'reindex' };

  const sameInode = cursor.inode === null || cursor.inode === stat.inode;

  if (sameInode && stat.size === cursor.size && stat.mtimeMs === cursor.mtimeMs) {
    // Nothing to do, and crucially no read at all.
    return cursor.state === 'error' ? { kind: 'reindex' } : { kind: 'skip' };
  }

  if (sameInode && stat.size >= cursor.byteOffset) {
    return { kind: 'append', from: cursor.byteOffset, fromLine: cursor.lineNo };
  }

  // Either shorter than where we stopped, or a different inode: only the head
  // hash can say whether the prefix we already consumed is still intact.
  const head = await readHeadHash();
  const prefixIntact =
    head !== null && cursor.headSha256 !== null && head === cursor.headSha256;

  if (prefixIntact && stat.size >= cursor.byteOffset) {
    return { kind: 'append', from: cursor.byteOffset, fromLine: cursor.lineNo };
  }
  return { kind: 'reindex' };
}

export function initialCursor(path: string, kind: string): IngestCursor {
  return {
    path,
    kind,
    byteOffset: 0,
    lineNo: 0,
    size: 0,
    mtimeMs: 0,
    inode: null,
    headSha256: null,
    state: 'pending',
    errorCount: 0,
  };
}
