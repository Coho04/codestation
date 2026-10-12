import { describe, expect, it } from 'vitest';
import {
  deriveAttention,
  RECENT_ACTIVITY_MS,
  SILENT_BUSY_MS,
  STALE_FAILURE_MS,
  type AttentionInput,
} from './attention-rules.js';

const NOW = 1_800_000_000_000;

const input = (over: Partial<AttentionInput> = {}): AttentionInput => ({
  alive: true,
  status: 'idle',
  waitingFor: null,
  statusUpdatedAt: NOW - 1000,
  transcriptMtime: NOW - 1000,
  backgroundState: null,
  hasSessionFile: true,
  startedAt: NOW - 1000,
  ...over,
});

describe('deriveAttention', () => {
  it('flags an explicit wait', () => {
    expect(deriveAttention(input({ status: 'waiting', waitingFor: 'input needed' }), NOW)).toBe('needs-you');
  });

  it('trusts waitingFor even if the status field lags behind', () => {
    expect(deriveAttention(input({ status: 'busy', waitingFor: 'input needed' }), NOW)).toBe('needs-you');
  });

  it('calls a busy session with fresh transcript activity working', () => {
    const level = deriveAttention(
      input({ status: 'busy', transcriptMtime: NOW - RECENT_ACTIVITY_MS / 2 }),
      NOW,
    );
    expect(level).toBe('working');
  });

  it('flags a busy session where nothing has moved for ten minutes', () => {
    // The rule that earns its keep: the status file has no heartbeat, so only
    // the transcript mtime can tell a working session from a stuck one.
    const level = deriveAttention(
      input({
        status: 'busy',
        statusUpdatedAt: NOW - SILENT_BUSY_MS - 1000,
        transcriptMtime: NOW - SILENT_BUSY_MS - 1000,
      }),
      NOW,
    );
    expect(level).toBe('needs-you');
  });

  it('does not flag a long-busy session that is still writing', () => {
    const level = deriveAttention(
      input({ status: 'busy', statusUpdatedAt: NOW - 86_400_000, transcriptMtime: NOW - 5_000 }),
      NOW,
    );
    expect(level).toBe('working');
  });

  it('reports a dead process with a leftover file as stale, not running', () => {
    // These files linger for weeks; treating them as live would make the
    // dashboard lie about what is running.
    expect(deriveAttention(input({ alive: false }), NOW)).toBe('stale');
  });

  it('reports a dead process with no file as dead', () => {
    expect(deriveAttention(input({ alive: false, hasSessionFile: false }), NOW)).toBe('dead');
  });

  it('flags a background agent that failed recently', () => {
    const level = deriveAttention(
      input({ backgroundState: 'failed', alive: false, transcriptMtime: NOW - 60_000 }),
      NOW,
    );
    expect(level).toBe('needs-you');
  });

  it('stops demanding attention for a failure from weeks ago', () => {
    // A badge that never returns to zero has stopped being a signal.
    const level = deriveAttention(
      input({
        backgroundState: 'failed',
        alive: false,
        transcriptMtime: NOW - STALE_FAILURE_MS - 1000,
      }),
      NOW,
    );
    expect(level).toBe('stale');
  });

  it('falls back to the start time when no transcript mtime is known', () => {
    expect(
      deriveAttention(
        input({ backgroundState: 'failed', alive: false, transcriptMtime: null, startedAt: NOW - 1000 }),
        NOW,
      ),
    ).toBe('needs-you');
  });

  it('leaves an idle session alone', () => {
    expect(deriveAttention(input({ status: 'idle' }), NOW)).toBe('idle');
  });

  it('flags a busy session with no timestamps at all', () => {
    const level = deriveAttention(
      input({ status: 'busy', statusUpdatedAt: null, transcriptMtime: null }),
      NOW,
    );
    // Nothing to go on in either source. A freshly started session does not land
    // here — its status file is written with a current timestamp — so this means
    // a session whose writer stopped updating, which is worth looking at.
    expect(level).toBe('needs-you');
  });
});
