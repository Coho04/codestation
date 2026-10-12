import { describe, expect, it, vi } from 'vitest';
import { decideCursor, initialCursor, type IngestCursor } from './file-cursor.js';
import type { FileStat } from '../ports/file-system.js';

const stat = (over: Partial<FileStat> = {}): FileStat => ({
  size: 1000,
  mtimeMs: 500,
  inode: '1:42',
  isDirectory: false,
  ...over,
});

const cursor = (over: Partial<IngestCursor> = {}): IngestCursor => ({
  ...initialCursor('/t.jsonl', 'transcript'),
  byteOffset: 1000,
  lineNo: 10,
  size: 1000,
  mtimeMs: 500,
  inode: '1:42',
  headSha256: 'HEAD',
  state: 'complete',
  ...over,
});

const noHash = vi.fn(async () => null);
const sameHash = vi.fn(async () => 'HEAD');
const otherHash = vi.fn(async () => 'DIFFERENT');

describe('decideCursor', () => {
  it('skips an unchanged file without reading a byte', async () => {
    const read = vi.fn(async () => 'HEAD');
    await expect(decideCursor(cursor(), stat(), read)).resolves.toEqual({ kind: 'skip' });
    // This is the property that keeps an 83 MB transcript cheap on every sweep.
    expect(read).not.toHaveBeenCalled();
  });

  it('appends from the stored offset when the file has grown', async () => {
    const decision = await decideCursor(cursor(), stat({ size: 4000, mtimeMs: 900 }), noHash);
    expect(decision).toEqual({ kind: 'append', from: 1000, fromLine: 10 });
  });

  it('reindexes a file that was truncated', async () => {
    const decision = await decideCursor(cursor(), stat({ size: 200, mtimeMs: 900 }), otherHash);
    expect(decision).toEqual({ kind: 'reindex' });
  });

  it('still appends after a replace-by-rename whose prefix is unchanged', async () => {
    // Claude Code rewrites a transcript when compacting; if the first 64 KiB are
    // identical the conversation is the same one and re-reading 83 MB would be
    // pure waste.
    const decision = await decideCursor(
      cursor(),
      stat({ inode: '1:99', size: 5000, mtimeMs: 900 }),
      sameHash,
    );
    expect(decision).toEqual({ kind: 'append', from: 1000, fromLine: 10 });
  });

  it('reindexes when a replaced file has a different prefix', async () => {
    const decision = await decideCursor(
      cursor(),
      stat({ inode: '1:99', size: 5000, mtimeMs: 900 }),
      otherHash,
    );
    expect(decision).toEqual({ kind: 'reindex' });
  });

  it('reports a vanished file rather than treating it as empty', async () => {
    // Claude Code prunes its own data; the rows must survive, so the caller
    // needs to tell "gone" apart from "nothing new".
    await expect(decideCursor(cursor(), null, noHash)).resolves.toEqual({ kind: 'vanished' });
  });

  it('does nothing for a file that never existed', async () => {
    await expect(decideCursor(null, null, noHash)).resolves.toEqual({ kind: 'skip' });
  });

  it('indexes a file it has never seen', async () => {
    await expect(decideCursor(null, stat(), noHash)).resolves.toEqual({ kind: 'reindex' });
  });

  it('retries a file that previously failed, even if unchanged', async () => {
    const decision = await decideCursor(cursor({ state: 'error' }), stat(), noHash);
    expect(decision).toEqual({ kind: 'reindex' });
  });

  it('re-reads a file that reappeared after vanishing', async () => {
    const decision = await decideCursor(cursor({ state: 'vanished' }), stat(), noHash);
    expect(decision).toEqual({ kind: 'reindex' });
  });

  it('ignores directories', async () => {
    const decision = await decideCursor(cursor(), stat({ isDirectory: true }), noHash);
    expect(decision).toEqual({ kind: 'skip' });
  });

  it('appends when only the mtime moved but the size matches the offset', async () => {
    const decision = await decideCursor(cursor(), stat({ mtimeMs: 777 }), noHash);
    expect(decision).toEqual({ kind: 'append', from: 1000, fromLine: 10 });
  });
});
