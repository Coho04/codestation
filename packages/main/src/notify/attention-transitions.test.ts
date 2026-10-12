import { describe, expect, it } from 'vitest';
import { computeTransitions, emptyTransitionState, STABLE_FOR_MS } from './attention-transitions.js';
import type { AttentionLevel, LiveSession, SessionId } from '@cs/shared';

const NOW = 1_800_000_000_000;

const session = (id: string, attention: AttentionLevel): LiveSession =>
  ({
    sessionId: id as SessionId,
    pid: 1,
    backgroundId: null,
    cwd: '/p',
    projectId: null,
    name: id,
    kind: 'interactive',
    status: attention === 'needs-you' ? 'waiting' : 'idle',
    waitingFor: attention === 'needs-you' ? 'input needed' : null,
    backgroundState: null,
    attention,
    startedAt: NOW,
    statusUpdatedAt: NOW,
    transcriptMtime: NOW,
    ccVersion: null,
    paneId: null,
  }) as LiveSession;

describe('computeTransitions', () => {
  it('never announces a wait that was already in progress at startup', () => {
    // Otherwise every waiting session fires at once when the app opens, about
    // things that may have happened hours ago.
    const state = emptyTransitionState();
    const first = computeTransitions(state, [session('a', 'needs-you')], NOW);
    expect(first.announce).toEqual([]);
    expect(first.needsAttentionCount).toBe(1);

    const later = computeTransitions(state, [session('a', 'needs-you')], NOW + 60_000);
    expect(later.announce).toEqual([]);
  });

  it('announces once the session changes into waiting and holds there', () => {
    const state = emptyTransitionState();
    computeTransitions(state, [session('a', 'working')], NOW);
    const immediate = computeTransitions(state, [session('a', 'needs-you')], NOW + 100);
    // The status file flutters while a turn is composed; a brief flicker is not
    // worth interrupting anyone for.
    expect(immediate.announce).toEqual([]);

    const settled = computeTransitions(state, [session('a', 'needs-you')], NOW + STABLE_FOR_MS + 100);
    expect(settled.announce).toEqual(['a']);
  });

  it('never announces the same wait twice', () => {
    const state = emptyTransitionState();
    computeTransitions(state, [session('a', 'working')], NOW);
    // The episode begins here; the stability window runs from this sample.
    computeTransitions(state, [session('a', 'needs-you')], NOW + 1000);
    const announced = computeTransitions(state, [session('a', 'needs-you')], NOW + 1000 + STABLE_FOR_MS);
    expect(announced.announce).toEqual(['a']);

    // A session parked at "waiting" must not notify once per poll afterwards.
    for (const at of [NOW + 5_000, NOW + 10_000, NOW + 60_000]) {
      expect(computeTransitions(state, [session('a', 'needs-you')], at).announce).toEqual([]);
    }
  });

  it('announces again after the session resumed and waits anew', () => {
    const state = emptyTransitionState();
    computeTransitions(state, [session('a', 'working')], NOW);
    computeTransitions(state, [session('a', 'needs-you')], NOW + 2000);
    computeTransitions(state, [session('a', 'working')], NOW + 3000);
    const second = computeTransitions(state, [session('a', 'needs-you')], NOW + 4000);
    expect(second.announce).toEqual([]);
    const settled = computeTransitions(state, [session('a', 'needs-you')], NOW + 4000 + STABLE_FOR_MS);
    expect(settled.announce).toEqual(['a']);
  });

  it('counts every waiting session for the dock badge', () => {
    const state = emptyTransitionState();
    const result = computeTransitions(
      state,
      [session('a', 'needs-you'), session('b', 'needs-you'), session('c', 'idle')],
      NOW,
    );
    expect(result.needsAttentionCount).toBe(2);
  });

  it('forgets sessions that have gone away', () => {
    const state = emptyTransitionState();
    computeTransitions(state, [session('a', 'needs-you')], NOW);
    computeTransitions(state, [], NOW + 1000);
    expect(state.waitingSince.size).toBe(0);
    expect(state.announced.size).toBe(0);
  });
});
