/**
 * Keeps the tail of a pane's raw output.
 *
 * A tab that is not being rendered still has a running process. The buffer lets
 * the child keep writing without the renderer attached, and lets a tab switch
 * restore the visible screen in one write instead of replaying from the start.
 */
export class RingBuffer {
  #chunks: string[] = [];
  #bytes = 0;

  constructor(private readonly maxBytes: number) {}

  push(chunk: string): void {
    this.#chunks.push(chunk);
    this.#bytes += chunk.length;
    while (this.#bytes > this.maxBytes && this.#chunks.length > 1) {
      const dropped = this.#chunks.shift();
      this.#bytes -= dropped?.length ?? 0;
    }
  }

  read(): string {
    return this.#chunks.join('');
  }

  get bytes(): number {
    return this.#bytes;
  }

  clear(): void {
    this.#chunks = [];
    this.#bytes = 0;
  }
}
