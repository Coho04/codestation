export interface FileStat {
  readonly size: number;
  readonly mtimeMs: number;
  /** "dev:ino" — changes when a file is replaced by rename. */
  readonly inode: string;
  readonly isDirectory: boolean;
}

export interface DirEntry {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
}

/**
 * Every filesystem touch goes through here, so ingest logic is testable without
 * a real ~/.claude — and so the one place that can read the user's data is
 * explicit and auditable.
 */
export interface FileSystemPort {
  /** Null rather than throwing on ENOENT: a vanished file is an expected state. */
  stat(path: string): Promise<FileStat | null>;
  readdir(path: string): Promise<DirEntry[]>;
  readFile(path: string): Promise<string | null>;
  readRange(path: string, start: number, end: number): Promise<Uint8Array | null>;
  /** Streams from `start` to EOF, in chunks. */
  readStream(path: string, start: number): AsyncIterable<Uint8Array>;
  sha256(path: string, maxBytes: number): Promise<string | null>;
  exists(path: string): Promise<boolean>;
  homedir(): string;
}
