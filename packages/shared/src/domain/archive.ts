import type { Millis, ProjectId, SessionId } from './ids.js';

export type TombstoneKind = 'project' | 'session';

/** A path the user removed from the index; listed so it can be taken back. */
export interface Tombstone {
  readonly path: string;
  readonly kind: TombstoneKind;
  readonly label: string | null;
  readonly sessionId: SessionId | null;
  readonly createdAt: Millis;
}

/**
 * What deleting from disk would actually remove.
 *
 * Resolved by the indexer, which knows the layout, and acted on by the main
 * process, which is the only part allowed to write to the user's data. The
 * confirmation dialog quotes these numbers, so a deletion is never a leap of
 * faith.
 */
export interface ProjectPaths {
  readonly projectId: ProjectId;
  readonly label: string;
  readonly projectPath: string;
  /** ~/.claude/projects/<encoded> — the directory that would be removed. */
  readonly transcriptDir: string | null;
  readonly sessionCount: number;
}

export interface SessionPaths {
  readonly sessionId: SessionId;
  readonly label: string;
  readonly transcriptPath: string | null;
  /** <sessionId>/ beside the transcript: tool-results and subagent logs. */
  readonly sidecarDir: string | null;
}

export interface DeletionResult {
  /** False when the user cancelled, or when nothing was eligible. */
  readonly confirmed: boolean;
  readonly deletedFiles: number;
  readonly deletedBytes: number;
  readonly error: string | null;
}
