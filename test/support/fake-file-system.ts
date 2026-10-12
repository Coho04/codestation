import { createHash } from 'node:crypto';
import type { DirEntry, FileStat, FileSystemPort } from '../../packages/indexer/src/ports/file-system.js';

/**
 * In-memory filesystem with explicit control over inode and mtime, so the
 * cursor's replace/truncate/append decisions can be exercised without touching
 * a real disk or sleeping for mtime granularity.
 */
export class FakeFileSystem implements FileSystemPort {
  readonly #files = new Map<string, { bytes: Uint8Array; mtimeMs: number; inode: string }>();
  readonly #dirs = new Map<string, Set<string>>();
  #nextInode = 1;
  chunkSize = 64 * 1024;

  constructor(private readonly home = '/Users/dev') {}

  write(path: string, content: string | Uint8Array, options: { mtimeMs?: number; newInode?: boolean } = {}): void {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    const previous = this.#files.get(path);
    const inode =
      options.newInode === true || previous === undefined
        ? `1:${String(this.#nextInode++)}`
        : previous.inode;
    this.#files.set(path, { bytes, mtimeMs: options.mtimeMs ?? (previous?.mtimeMs ?? 0) + 1000, inode });
    this.#register(path);
  }

  append(path: string, content: string, options: { mtimeMs?: number } = {}): void {
    const previous = this.#files.get(path);
    const addition = new TextEncoder().encode(content);
    const bytes =
      previous === undefined ? addition : concat(previous.bytes, addition);
    this.write(path, bytes, { ...options, newInode: false });
  }

  remove(path: string): void {
    this.#files.delete(path);
    for (const children of this.#dirs.values()) children.delete(path);
  }

  mkdir(path: string): void {
    if (!this.#dirs.has(path)) this.#dirs.set(path, new Set());
  }

  #register(path: string): void {
    const parent = path.slice(0, path.lastIndexOf('/')) || '/';
    this.mkdir(parent);
    this.#dirs.get(parent)!.add(path);
  }

  async stat(path: string): Promise<FileStat | null> {
    const file = this.#files.get(path);
    if (file !== undefined) {
      return { size: file.bytes.length, mtimeMs: file.mtimeMs, inode: file.inode, isDirectory: false };
    }
    if (this.#dirs.has(path)) return { size: 0, mtimeMs: 0, inode: `d:${path}`, isDirectory: true };
    return null;
  }

  async readdir(path: string): Promise<DirEntry[]> {
    const children = this.#dirs.get(path);
    if (children === undefined) return [];
    const entries: DirEntry[] = [];
    for (const child of children) {
      const name = child.slice(child.lastIndexOf('/') + 1);
      entries.push({ name, isFile: this.#files.has(child), isDirectory: this.#dirs.has(child) });
    }
    for (const dir of this.#dirs.keys()) {
      if (dir !== path && dir.startsWith(`${path}/`) && !dir.slice(path.length + 1).includes('/')) {
        entries.push({ name: dir.slice(path.length + 1), isFile: false, isDirectory: true });
      }
    }
    return dedupe(entries);
  }

  async readFile(path: string): Promise<string | null> {
    const file = this.#files.get(path);
    return file === undefined ? null : new TextDecoder().decode(file.bytes);
  }

  async readRange(path: string, start: number, end: number): Promise<Uint8Array | null> {
    const file = this.#files.get(path);
    return file === undefined ? null : file.bytes.subarray(start, end);
  }

  async *readStream(path: string, start: number): AsyncIterable<Uint8Array> {
    const file = this.#files.get(path);
    if (file === undefined) return;
    for (let at = start; at < file.bytes.length; at += this.chunkSize) {
      yield file.bytes.subarray(at, Math.min(at + this.chunkSize, file.bytes.length));
    }
  }

  async sha256(path: string, maxBytes: number): Promise<string | null> {
    const file = this.#files.get(path);
    if (file === undefined) return null;
    return createHash('sha256').update(file.bytes.subarray(0, maxBytes)).digest('hex');
  }

  async exists(path: string): Promise<boolean> {
    return this.#files.has(path) || this.#dirs.has(path);
  }

  homedir(): string {
    return this.home;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function dedupe(entries: DirEntry[]): DirEntry[] {
  const seen = new Map<string, DirEntry>();
  for (const entry of entries) seen.set(entry.name, entry);
  return [...seen.values()];
}
