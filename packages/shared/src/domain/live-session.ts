import type { Millis, PaneId, ProjectId, SessionId } from './ids.js';

/** As written by Claude Code into `~/.claude/sessions/<pid>.json`. */
export type ClaudeStatus = 'idle' | 'busy' | 'waiting';

/**
 * What the user should do about a session, derived rather than read.
 *
 * `needs-you` is deliberately broader than `status === 'waiting'`: the status
 * file carries no heartbeat (observed: a process running since 3 Sep whose
 * status was last written on 23 Sep), so a session claiming to be `busy` while
 * neither its status nor its transcript has moved for ten minutes is almost
 * always sitting on a permission prompt.
 */
export type AttentionLevel = 'needs-you' | 'working' | 'idle' | 'stale' | 'dead';

export interface LiveSession {
  readonly sessionId: SessionId;
  readonly pid: number | null;
  /** Short id for background agents (`claude attach <id>`); null when interactive. */
  readonly backgroundId: string | null;
  readonly cwd: string;
  readonly projectId: ProjectId | null;
  readonly name: string | null;
  readonly kind: 'interactive' | 'background';
  readonly status: ClaudeStatus | null;
  readonly waitingFor: string | null;
  readonly backgroundState: string | null;
  readonly attention: AttentionLevel;
  readonly startedAt: Millis | null;
  readonly statusUpdatedAt: Millis | null;
  /** The substitute heartbeat: mtime of the transcript. */
  readonly transcriptMtime: Millis | null;
  readonly ccVersion: string | null;
  /** Set when this session is running in one of our own panes. */
  readonly paneId: PaneId | null;
}

export type IndexPhase = 'idle' | 'registry' | 'skeleton' | 'full';

export interface IndexProgress {
  readonly phase: IndexPhase;
  readonly filesTotal: number;
  readonly filesDone: number;
  readonly bytesTotal: number;
  readonly bytesDone: number;
  readonly currentPath: string | null;
  readonly etaMs: number | null;
  readonly cancellable: boolean;
  /** Unknown record types seen since startup — the schema-drift alarm. */
  readonly unknownRecordTypes: readonly string[];
  readonly decodeErrors: number;
}
