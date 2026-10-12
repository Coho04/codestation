import { describe, expect, it, vi } from 'vitest';
import { CoalescingQueue } from './coalescing-queue.js';
import { FakeClock } from '../ports/clock.js';

describe('CoalescingQueue', () => {
  it('collapses repeated events for the same key', async () => {
    vi.useFakeTimers();
    const clock = new FakeClock(0);
    const flushed: string[][] = [];
    const queue = new CoalescingQueue<string>(100, 1000, clock, (items) => flushed.push([...items]));

    queue.push('a', 'v1');
    queue.push('a', 'v2');
    queue.push('b', 'v3');
    await vi.advanceTimersByTimeAsync(150);

    expect(flushed).toEqual([['v2', 'v3']]);
    vi.useRealTimers();
  });

  it('flushes within the max wait even under a constant stream', async () => {
    // The case a plain trailing debounce starves: the transcript of the session
    // the user is watching right now is written to continuously.
    vi.useFakeTimers();
    const clock = new FakeClock(0);
    const flushed: string[][] = [];
    const queue = new CoalescingQueue<string>(100, 300, clock, (items) => flushed.push([...items]));

    for (let elapsed = 0; elapsed < 500; elapsed += 50) {
      clock.set(elapsed);
      queue.push('busy', `v${String(elapsed)}`);
      await vi.advanceTimersByTimeAsync(50);
    }

    expect(flushed.length).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  it('does nothing when nothing was pushed', async () => {
    vi.useFakeTimers();
    const flushed: string[][] = [];
    const queue = new CoalescingQueue<string>(50, 100, new FakeClock(0), (items) => flushed.push([...items]));
    await vi.advanceTimersByTimeAsync(200);
    expect(flushed).toEqual([]);
    queue.dispose();
    vi.useRealTimers();
  });
});
