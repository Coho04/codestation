export const HIGH_WATER_BYTES = 2 * 1024 * 1024;
export const LOW_WATER_BYTES = 512 * 1024;

/**
 * Credit-based backpressure between the PTY and the renderer.
 *
 * The renderer acknowledges from xterm's write callback, which fires only once
 * a chunk has actually been parsed — the only honest signal that the terminal
 * has kept up. Without this loop a `npm install` in a tab nobody is looking at
 * grows the IPC queue faster than xterm drains it and stalls the renderer's main
 * thread.
 */
export class FlowControl {
  #outstanding = 0;
  #paused = false;

  constructor(
    private readonly pause: () => void,
    private readonly resume: () => void,
    private readonly highWater = HIGH_WATER_BYTES,
    private readonly lowWater = LOW_WATER_BYTES,
  ) {}

  sent(bytes: number): void {
    this.#outstanding += bytes;
    if (!this.#paused && this.#outstanding >= this.highWater) {
      this.#paused = true;
      this.pause();
    }
  }

  acknowledged(bytes: number): void {
    this.#outstanding = Math.max(0, this.#outstanding - bytes);
    if (this.#paused && this.#outstanding <= this.lowWater) {
      this.#paused = false;
      this.resume();
    }
  }

  /** A detached renderer must not leave the child blocked forever. */
  reset(): void {
    this.#outstanding = 0;
    if (this.#paused) {
      this.#paused = false;
      this.resume();
    }
  }

  get outstandingBytes(): number {
    return this.#outstanding;
  }

  get paused(): boolean {
    return this.#paused;
  }
}
