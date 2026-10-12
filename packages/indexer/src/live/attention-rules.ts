import type { AttentionLevel, ClaudeStatus } from '@cs/shared';

export interface AttentionInput {
  readonly alive: boolean;
  readonly status: ClaudeStatus | null;
  readonly waitingFor: string | null;
  readonly statusUpdatedAt: number | null;
  /** mtime of the session's transcript — the substitute heartbeat. */
  readonly transcriptMtime: number | null;
  readonly backgroundState: string | null;
  readonly hasSessionFile: boolean;
  readonly startedAt: number | null;
}

/** A session claiming to work with nothing moving for this long is stuck. */
export const SILENT_BUSY_MS = 10 * 60 * 1000;
/** Recent transcript activity that still counts as actively working. */
export const RECENT_ACTIVITY_MS = 2 * 60 * 1000;
/**
 * How long a failed background agent keeps demanding attention.
 *
 * A failure from three weeks ago is a fact, not a task. Counting it forever
 * gives a dock badge that never returns to zero, and a badge that is always on
 * has stopped being a signal.
 */
export const STALE_FAILURE_MS = 24 * 60 * 60 * 1000;

/**
 * Derives what the user should do about a session.
 *
 * The non-obvious rule is the second one. `~/.claude/sessions/<pid>.json` has no
 * heartbeat — on this machine a process running since 3 September still carried
 * a status written on 23 September. So "busy" alone proves nothing. A session
 * that claims to be busy while neither its status nor its transcript has moved
 * for ten minutes is, in practice, sitting on a permission prompt or has died
 * mid-turn. The transcript mtime is the heartbeat the format does not provide,
 * and the indexer already has it.
 */
export function deriveAttention(input: AttentionInput, now: number): AttentionLevel {
  if (input.backgroundState === 'failed') {
    const lastSign = input.transcriptMtime ?? input.startedAt;
    const age = lastSign === null ? Infinity : now - lastSign;
    return age <= STALE_FAILURE_MS ? 'needs-you' : 'stale';
  }

  if (!input.alive) return input.hasSessionFile ? 'stale' : 'dead';

  if (input.status === 'waiting' || (input.waitingFor !== null && input.waitingFor.length > 0)) {
    return 'needs-you';
  }

  if (input.status === 'busy') {
    const statusAge = input.statusUpdatedAt === null ? Infinity : now - input.statusUpdatedAt;
    const transcriptAge = input.transcriptMtime === null ? Infinity : now - input.transcriptMtime;
    if (transcriptAge <= RECENT_ACTIVITY_MS) return 'working';
    if (statusAge > SILENT_BUSY_MS && transcriptAge > SILENT_BUSY_MS) return 'needs-you';
    return 'working';
  }

  return 'idle';
}
