import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { opendir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { DirEntry, FileStat, FileSystemPort } from '../ports/file-system.js';

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '');

export class NodeFileSystem implements FileSystemPort {
  constructor(private readonly chunkBytes = 1 << 20) {}

  async stat(path: string): Promise<FileStat | null> {
    try {
      const s = await stat(path);
      return {
        size: s.size,
        mtimeMs: Math.round(s.mtimeMs),
        inode: `${String(s.dev)}:${String(s.ino)}`,
        isDirectory: s.isDirectory(),
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async readdir(path: string): Promise<DirEntry[]> {
    try {
      const entries: DirEntry[] = [];
      const dir = await opendir(path);
      for await (const entry of dir) {
        entries.push({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
        });
      }
      return entries;
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  async readFile(path: string): Promise<string | null> {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async readRange(path: string, start: number, end: number): Promise<Uint8Array | null> {
    if (end <= start) return new Uint8Array(0);
    try {
      const chunks: Uint8Array[] = [];
      // `end` is inclusive for createReadStream.
      for await (const chunk of createReadStream(path, { start, end: end - 1 })) {
        chunks.push(chunk as Uint8Array);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async *readStream(path: string, start: number): AsyncIterable<Uint8Array> {
    const stream = createReadStream(path, { start, highWaterMark: this.chunkBytes });
    try {
      for await (const chunk of stream) yield chunk as Uint8Array;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  async sha256(path: string, maxBytes: number): Promise<string | null> {
    const bytes = await this.readRange(path, 0, maxBytes);
    if (bytes === null) return null;
    return createHash('sha256').update(bytes).digest('hex');
  }

  async exists(path: string): Promise<boolean> {
    return (await this.stat(path)) !== null;
  }

  homedir(): string {
    return homedir();
  }
}
