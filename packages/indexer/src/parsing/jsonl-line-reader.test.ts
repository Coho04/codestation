import { describe, expect, it } from 'vitest';
import { MAX_LINE_BYTES, readJsonlLines, type RawLine, type ReadResult } from './jsonl-line-reader.js';

const enc = new TextEncoder();

/** Feeds the reader in arbitrary chunk sizes, as a real stream would. */
async function* chunked(bytes: Uint8Array, size: number): AsyncIterable<Uint8Array> {
  for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
}

async function read(
  input: string | Uint8Array,
  { chunkSize = 7, startOffset = 0, startLineNo = 0 } = {},
): Promise<{ lines: RawLine[]; result: ReadResult }> {
  const bytes = typeof input === 'string' ? enc.encode(input) : input;
  let result: ReadResult | null = null;
  const lines: RawLine[] = [];
  for await (const line of readJsonlLines(
    chunked(bytes, chunkSize),
    startOffset,
    startLineNo,
    (r) => (result = r),
  )) {
    lines.push(line);
  }
  return { lines, result: result! };
}

describe('readJsonlLines', () => {
  it('reports byte offsets that match the real byte positions', async () => {
    const text = '{"a":1}\n{"b":2}\n';
    const { lines } = await read(text);
    expect(lines.map((l) => l.byteOffset)).toEqual([0, 8]);
    expect(lines.map((l) => l.byteLength)).toEqual([8, 8]);
    const bytes = enc.encode(text);
    for (const line of lines) {
      const slice = bytes.subarray(line.byteOffset, line.byteOffset + line.byteLength);
      expect(new TextDecoder().decode(slice).trimEnd()).toBe(line.text);
    }
  });

  it('keeps offsets byte-exact across multi-byte characters', async () => {
    // The whole reason splitting happens on bytes: 'ü' is two bytes, an emoji
    // four. String-level splitting would make every later offset wrong, and the
    // offsets are what let the UI seek into an 83 MB transcript.
    const text = '{"t":"Prüfung 🚀"}\n{"t":"zwei"}\n';
    const bytes = enc.encode(text);
    const { lines } = await read(text, { chunkSize: 3 });
    expect(lines).toHaveLength(2);
    expect(lines[1]!.byteOffset).toBe(bytes.indexOf(enc.encode('{"t":"zwei"}')[0]!, 1));
    const second = bytes.subarray(lines[1]!.byteOffset, lines[1]!.byteOffset + lines[1]!.byteLength);
    expect(new TextDecoder().decode(second)).toBe('{"t":"zwei"}\n');
  });

  it('does not consume a line that has no newline yet', async () => {
    // Claude Code appends while we read; a half-written last line must be left
    // alone so the next pass picks it up whole.
    const { lines, result } = await read('{"done":1}\n{"half":');
    expect(lines).toHaveLength(1);
    expect(result.nextOffset).toBe(11);
    expect(result.nextLineNo).toBe(1);
  });

  it('resumes exactly where the previous pass stopped', async () => {
    const full = '{"a":1}\n{"b":2}\n{"c":3}\n';
    const first = await read('{"a":1}\n{"b":2}\n');
    const rest = enc.encode(full).subarray(first.result.nextOffset);
    const second = await read(rest, {
      startOffset: first.result.nextOffset,
      startLineNo: first.result.nextLineNo,
    });
    expect(second.lines).toHaveLength(1);
    expect(second.lines[0]!.lineNo).toBe(2);
    expect(second.lines[0]!.byteOffset).toBe(16);
    expect(second.lines[0]!.text).toBe('{"c":3}');
  });

  it('survives a chunk boundary falling inside a multi-byte character', async () => {
    const text = '{"t":"äöü"}\n{"t":"x"}\n';
    const { lines } = await read(text, { chunkSize: 1 });
    expect(lines.map((l) => l.text)).toEqual(['{"t":"äöü"}', '{"t":"x"}']);
  });

  it('skips blank lines without disturbing offsets', async () => {
    const { lines } = await read('{"a":1}\n\n{"b":2}\n');
    expect(lines.map((l) => l.text)).toEqual(['{"a":1}', '{"b":2}']);
    expect(lines[1]!.byteOffset).toBe(9);
  });

  it('keeps a trailing \\r so the raw line stays byte-faithful', async () => {
    const { lines } = await read('{"a":1}\r\n');
    expect(lines[0]!.text).toBe('{"a":1}\r');
    expect(lines[0]!.byteLength).toBe(9);
  });

  it('drops an oversized line instead of exhausting memory, and keeps going', async () => {
    const huge = `{"x":"${'a'.repeat(MAX_LINE_BYTES + 16)}"}`;
    const { lines, result } = await read(`${huge}\n{"after":1}\n`, { chunkSize: 1 << 16 });
    expect(result.sawOversizedLine).toBe(true);
    expect(lines.map((l) => l.text)).toEqual(['{"after":1}']);
    // The offset must still account for the bytes that were skipped.
    expect(lines[0]!.byteOffset).toBe(enc.encode(huge).length + 1);
  });

  it('handles an empty stream', async () => {
    const { lines, result } = await read('');
    expect(lines).toEqual([]);
    expect(result.nextOffset).toBe(0);
  });
});
