import { describe, expect, it, vi } from 'vitest';
import { FlowControl } from './flow-control.js';
import { OutputCoalescer } from './output-coalescer.js';
import { RingBuffer } from './ring-buffer.js';

describe('FlowControl', () => {
  it('pauses the child once the renderer falls far enough behind', () => {
    const pause = vi.fn();
    const resume = vi.fn();
    const flow = new FlowControl(pause, resume, 1000, 200);

    flow.sent(900);
    expect(pause).not.toHaveBeenCalled();
    flow.sent(200);
    expect(pause).toHaveBeenCalledOnce();
    expect(flow.paused).toBe(true);
  });

  it('resumes only once the backlog has drained to the low water mark', () => {
    const pause = vi.fn();
    const resume = vi.fn();
    const flow = new FlowControl(pause, resume, 1000, 200);

    flow.sent(1100);
    flow.acknowledged(500);
    expect(resume).not.toHaveBeenCalled();
    flow.acknowledged(450);
    expect(resume).toHaveBeenCalledOnce();
    expect(flow.paused).toBe(false);
  });

  it('does not pause repeatedly while already paused', () => {
    const pause = vi.fn();
    const flow = new FlowControl(pause, vi.fn(), 100, 50);
    flow.sent(200);
    flow.sent(200);
    expect(pause).toHaveBeenCalledOnce();
  });

  it('never goes negative when acknowledgements overshoot', () => {
    const flow = new FlowControl(vi.fn(), vi.fn(), 100, 50);
    flow.sent(10);
    flow.acknowledged(999);
    expect(flow.outstandingBytes).toBe(0);
  });

  it('unblocks the child when the renderer detaches mid-flood', () => {
    // Otherwise closing a tab mid-`npm install` would leave the process stopped
    // with nobody left to acknowledge anything.
    const resume = vi.fn();
    const flow = new FlowControl(vi.fn(), resume, 100, 50);
    flow.sent(500);
    flow.reset();
    expect(resume).toHaveBeenCalledOnce();
    expect(flow.outstandingBytes).toBe(0);
  });
});

describe('OutputCoalescer', () => {
  const makeTimers = () => {
    let pending: (() => void) | null = null;
    return {
      setTimer: (fn: () => void) => {
        pending = fn;
        return 1;
      },
      clearTimer: () => {
        pending = null;
      },
      fire: () => {
        const fn = pending;
        pending = null;
        fn?.();
      },
      get armed() {
        return pending !== null;
      },
    };
  };

  it('flushes as soon as the byte threshold is reached', () => {
    const timers = makeTimers();
    const flushed: string[] = [];
    const coalescer = new OutputCoalescer({
      maxBytes: 10,
      maxDelayMs: 8,
      onFlush: (chunk) => flushed.push(chunk),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    coalescer.push('12345');
    expect(flushed).toEqual([]);
    coalescer.push('67890');
    expect(flushed).toEqual(['1234567890']);
  });

  it('flushes a small trickle on the timer so output is not held back', () => {
    const timers = makeTimers();
    const flushed: string[] = [];
    const coalescer = new OutputCoalescer({
      maxBytes: 1000,
      maxDelayMs: 8,
      onFlush: (chunk) => flushed.push(chunk),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    coalescer.push('a');
    expect(flushed).toEqual([]);
    timers.fire();
    expect(flushed).toEqual(['a']);
  });

  it('turns a flood into few large messages rather than many small ones', () => {
    const timers = makeTimers();
    const flushed: string[] = [];
    const coalescer = new OutputCoalescer({
      maxBytes: 8192,
      maxDelayMs: 8,
      onFlush: (chunk) => flushed.push(chunk),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    for (let i = 0; i < 5000; i += 1) coalescer.push('x'.repeat(64));
    coalescer.flush();

    expect(flushed.length).toBeLessThan(60);
    expect(flushed.join('')).toHaveLength(5000 * 64);
  });

  it('does not emit an empty flush', () => {
    const timers = makeTimers();
    const flushed: string[] = [];
    const coalescer = new OutputCoalescer({
      maxBytes: 10,
      maxDelayMs: 8,
      onFlush: (chunk) => flushed.push(chunk),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    coalescer.flush();
    expect(flushed).toEqual([]);
  });
});

describe('RingBuffer', () => {
  it('keeps the tail within its budget', () => {
    const buffer = new RingBuffer(100);
    for (let i = 0; i < 50; i += 1) buffer.push('x'.repeat(10));
    expect(buffer.bytes).toBeLessThanOrEqual(110);
    expect(buffer.read().endsWith('xxxxxxxxxx')).toBe(true);
  });

  it('never drops the most recent chunk, even if it is oversized', () => {
    const buffer = new RingBuffer(10);
    buffer.push('y'.repeat(500));
    expect(buffer.read()).toHaveLength(500);
  });
});
