export interface CoalescerOptions {
  readonly maxBytes: number;
  readonly maxDelayMs: number;
  readonly onFlush: (chunk: string) => void;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

/**
 * Batches PTY output before it crosses the process boundary.
 *
 * Output is carried as strings: node-pty already decodes UTF-8 correctly across
 * chunk boundaries, and redoing that over raw bytes risks splitting codepoints
 * for no gain. The cost that actually hurts is the number of IPC messages — a
 * flooding `npm install` drops from roughly 5000 a second to about 125.
 */
export class OutputCoalescer {
  #buffer: string[] = [];
  #bytes = 0;
  #timer: unknown = null;

  constructor(private readonly options: CoalescerOptions) {}

  push(chunk: string): void {
    this.#buffer.push(chunk);
    this.#bytes += chunk.length;

    if (this.#bytes >= this.options.maxBytes) {
      this.flush();
      return;
    }
    if (this.#timer === null) {
      this.#timer = this.options.setTimer(() => {
        this.#timer = null;
        this.flush();
      }, this.options.maxDelayMs);
    }
  }

  flush(): void {
    if (this.#timer !== null) {
      this.options.clearTimer(this.#timer);
      this.#timer = null;
    }
    if (this.#buffer.length === 0) return;
    const chunk = this.#buffer.join('');
    this.#buffer = [];
    this.#bytes = 0;
    this.options.onFlush(chunk);
  }

  get pendingBytes(): number {
    return this.#bytes;
  }

  dispose(): void {
    if (this.#timer !== null) this.options.clearTimer(this.#timer);
    this.#timer = null;
    this.#buffer = [];
    this.#bytes = 0;
  }
}
