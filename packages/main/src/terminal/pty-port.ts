export interface PtyHandle {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  pause(): void;
  resume(): void;
  kill(signal?: string): void;
  onData(listener: (chunk: string) => void): void;
  onExit(listener: (exitCode: number, signal: number | null) => void): void;
}

export interface SpawnOptions {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly cols: number;
  readonly rows: number;
}

/**
 * The seam that keeps PTY logic unit-testable.
 *
 * node-pty is rebuilt against the Electron ABI, which makes it unusable from a
 * plain `node` test runner. Everything above this interface is therefore tested
 * with a fake, and the real adapter is exercised through Playwright inside
 * Electron.
 */
export interface PtyPort {
  spawn(options: SpawnOptions): PtyHandle;
}
