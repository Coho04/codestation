export interface RawLine {
  /** Byte offset of the line's first byte, from the start of the file. */
  readonly byteOffset: number;
  /** Length of the line including its trailing newline. */
  readonly byteLength: number;
  /** Zero-based ordinal, counted from `startLineNo`. */
  readonly lineNo: number;
  readonly text: string;
}

export interface ReadResult {
  /**
   * Byte offset to resume from — always just past a newline. A partially
   * written last line is simply not consumed, so "Claude is mid-write" needs no
   * special case: the next pass re-reads it once it is complete.
   */
  readonly nextOffset: number;
  readonly nextLineNo: number;
  readonly sawOversizedLine: boolean;
}

export const MAX_LINE_BYTES = 16 * 1024 * 1024;

const NEWLINE = 0x0a;

/**
 * Splits JSONL on the *byte* level.
 *
 * String-level splitting would be simpler and wrong: the byte offsets stored
 * per message are what lets the UI show an original line out of an 83 MB file
 * without loading it, and any multi-byte character before a newline would skew
 * them.
 *
 * The largest line observed in the real corpus is 1.33 MB; the 16 MiB cap only
 * exists so a corrupted file cannot exhaust memory.
 */
export async function* readJsonlLines(
  chunks: AsyncIterable<Uint8Array>,
  startOffset: number,
  startLineNo: number,
  onResult: (result: ReadResult) => void,
): AsyncGenerator<RawLine> {
  const decoder = new TextDecoder('utf-8');
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let offset = startOffset;
  let lineNo = startLineNo;
  let oversized = false;
  /** Set once a line has blown the cap; its remaining bytes are counted, not kept. */
  let skippedBytes = 0;

  const dropPending = (): void => {
    oversized = true;
    skippedBytes += pendingBytes;
    pending = [];
    pendingBytes = 0;
  };

  for await (const chunk of chunks) {
    let searchFrom = 0;
    while (searchFrom < chunk.length) {
      const newlineAt = chunk.indexOf(NEWLINE, searchFrom);

      if (newlineAt === -1) {
        const tail = chunk.subarray(searchFrom);
        pendingBytes += tail.length;
        pending.push(tail);
        if (pendingBytes > MAX_LINE_BYTES) dropPending();
        break;
      }

      const segment = chunk.subarray(searchFrom, newlineAt);
      const lineBytes = skippedBytes + pendingBytes + segment.length + 1;

      // The cap has to be checked here as well, not only when a chunk ends
      // without a newline: a line can cross the limit and terminate inside the
      // very same chunk.
      if (skippedBytes > 0 || pendingBytes + segment.length + 1 > MAX_LINE_BYTES) {
        oversized = true;
      } else {
        const whole =
          pending.length === 0
            ? segment
            : concat([...pending, segment], pendingBytes + segment.length);
        const text = decoder.decode(whole);
        if (text.trim().length > 0) {
          yield { byteOffset: offset, byteLength: lineBytes, lineNo, text };
        }
      }

      pending = [];
      pendingBytes = 0;
      skippedBytes = 0;
      offset += lineBytes;
      lineNo += 1;
      searchFrom = newlineAt + 1;
    }
  }

  // Whatever is left has no newline yet: leave the offset before it, so the
  // next pass reads the line once it is complete.
  onResult({ nextOffset: offset, nextLineNo: lineNo, sawOversizedLine: oversized });
}

function concat(parts: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
