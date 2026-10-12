import { sessionId as toSessionId, type LiveSession, type PaneId, type SessionId } from '@cs/shared';
import type { PtyManager } from '../terminal/pty-manager.js';

/** How long a forked pane may stay unbound before it is reported as such. */
export const BIND_TIMEOUT_MS = 10_000;
/** Tolerance for clock skew between our spawn and the CLI's own startedAt. */
const SPAWN_SKEW_MS = 2000;

export interface CorrelationResult {
  readonly bound: readonly { paneId: PaneId; pid: number; sessionId: SessionId }[];
  readonly timedOut: readonly PaneId[];
}

/**
 * Binds panes to the sessions they are actually running.
 *
 * Claude panes spawn the binary directly rather than through a shell, so
 * `pty.pid` is exactly the pid in `~/.claude/sessions/<pid>.json`. The remaining
 * risk is pid reuse, which is why a session file is only accepted when its
 * `startedAt` is not older than the pane's own spawn — otherwise a recycled pid
 * could attach a pane to a session that ended weeks ago.
 */
export function correlate(
  panes: PtyManager,
  live: readonly LiveSession[],
  now: number,
): CorrelationResult {
  const byPid = new Map<number, LiveSession>();
  for (const session of live) {
    if (session.pid !== null) byPid.set(session.pid, session);
  }

  const bound: { paneId: PaneId; pid: number; sessionId: SessionId }[] = [];
  const timedOut: PaneId[] = [];

  for (const pane of panes.registry.unbound()) {
    const pid = pane.state.type === 'binding' ? pane.state.pid : null;
    if (pid === null) continue;

    const candidate = byPid.get(pid);
    if (candidate !== undefined) {
      const startedAt = candidate.startedAt ?? 0;
      if (startedAt === 0 || startedAt >= pane.spawnedAt - SPAWN_SKEW_MS) {
        bound.push({ paneId: pane.paneId, pid, sessionId: toSessionId(candidate.sessionId) });
        continue;
      }
    }

    // A forked session's id is only knowable once the CLI writes it. Reporting
    // the timeout beats an indefinite spinner.
    if (now - pane.spawnedAt > BIND_TIMEOUT_MS) timedOut.push(pane.paneId);
  }

  return { bound, timedOut };
}
