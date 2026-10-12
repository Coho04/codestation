import type { LiveSession, SessionId } from '@cs/shared';

/** The status file flutters; a wait must hold this long before it is announced. */
export const STABLE_FOR_MS = 1500;

export interface TransitionState {
  /** When the current waiting episode began, per session. */
  readonly waitingSince: Map<string, number>;
  /** Episodes already announced, so a parked session does not notify again. */
  readonly announced: Set<string>;
  /** False until the first sample has been seen. */
  primed: boolean;
}

export interface TransitionResult {
  /** Sessions whose wait just became worth interrupting the user for. */
  readonly announce: readonly SessionId[];
  readonly needsAttentionCount: number;
}

export const emptyTransitionState = (): TransitionState => ({
  waitingSince: new Map(),
  announced: new Set(),
  primed: false,
});

/**
 * Decides which sessions are worth interrupting the user for.
 *
 * The unit is a *waiting episode*, not a sample-to-sample change. That
 * distinction is the whole difficulty: a wait must first persist for a moment,
 * because the status file flutters while a turn is composed — and by the time it
 * has persisted, any sample-to-sample edge is long gone. Keying off the previous
 * sample would mean never announcing anything at all.
 *
 * An episode begins when a session enters `needs-you`, is announced once after
 * it has held, and ends when the session leaves that state. Waits already in
 * progress at startup are counted for the badge but never announced: a
 * notification about something that began an hour ago is noise.
 *
 * Pure, so it can be tested without Electron — which is where these mistakes
 * would otherwise hide.
 */
export function computeTransitions(
  state: TransitionState,
  sessions: readonly LiveSession[],
  now: number,
): TransitionResult {
  const announce: SessionId[] = [];
  const firstSample = !state.primed;
  state.primed = true;
  let needsAttentionCount = 0;

  for (const session of sessions) {
    const key = session.sessionId;

    if (session.attention !== 'needs-you') {
      state.waitingSince.delete(key);
      state.announced.delete(key);
      continue;
    }

    needsAttentionCount += 1;

    if (!state.waitingSince.has(key)) {
      state.waitingSince.set(key, now);
      if (firstSample) state.announced.add(key);
    }

    const since = state.waitingSince.get(key) ?? now;
    if (!state.announced.has(key) && now - since >= STABLE_FOR_MS) {
      state.announced.add(key);
      announce.push(session.sessionId);
    }
  }

  // Sessions that disappeared must not keep state alive forever.
  const present = new Set(sessions.map((session) => session.sessionId as string));
  for (const key of [...state.waitingSince.keys()]) {
    if (!present.has(key)) state.waitingSince.delete(key);
  }
  for (const key of [...state.announced]) {
    if (!present.has(key)) state.announced.delete(key);
  }

  return { announce, needsAttentionCount };
}
