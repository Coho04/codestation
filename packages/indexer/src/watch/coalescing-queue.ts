import type { ClockPort } from '../ports/clock.js';

/**
 * Debounce with a maximum wait.
 *
 * A plain trailing debounce starves exactly the case that matters: a transcript
 * being written to continuously is the session the user is watching right now,
 * and it would never settle. The max wait forces a flush at least that often.
 */
export class CoalescingQueue<T> {
  readonly #pending = new Map<string, { value: T; firstSeen: number }>();
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly debounceMs: number,
    private readonly maxWaitMs: number,
    private readonly clock: ClockPort,
    private readonly flush: (items: readonly T[]) => void,
  ) {}

  push(key: string, value: T): void {
    const now = this.clock.now();
    const existing = this.#pending.get(key);
    this.#pending.set(key, { value, firstSeen: existing?.firstSeen ?? now });
    this.#schedule();
  }

  #schedule(): void {
    if (this.#timer !== null) return;
    const now = this.clock.now();
    const oldest = Math.min(...[...this.#pending.values()].map((entry) => entry.firstSeen));
    const waited = now - oldest;
    const delay = Math.max(0, Math.min(this.debounceMs, this.maxWaitMs - waited));

    this.#timer = setTimeout(() => {
      this.#timer = null;
      const items = [...this.#pending.values()].map((entry) => entry.value);
      this.#pending.clear();
      if (items.length > 0) this.flush(items);
    }, delay);
    this.#timer.unref?.();
  }

  get size(): number {
    return this.#pending.size;
  }

  dispose(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#pending.clear();
  }
}
