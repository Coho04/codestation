import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import type { ClaudeBinaryInfo, CliCapabilities } from '@cs/shared';

const run = promisify(execFile);

const CANDIDATES = [
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  join(homedir(), '.local/bin/claude'),
  join(homedir(), '.claude/local/claude'),
];

const VERSION_RE = /(\d+)\.(\d+)\.(\d+)/;

/** Everything version-dependent is decided once, here. */
export function capabilitiesFor(version: string | null): CliCapabilities {
  const match = version === null ? null : VERSION_RE.exec(version);
  const major = match === null ? 0 : Number.parseInt(match[1] ?? '0', 10);
  const minor = match === null ? 0 : Number.parseInt(match[2] ?? '0', 10);
  const atLeast = (ma: number, mi: number): boolean => major > ma || (major === ma && minor >= mi);

  return {
    supportsSessionId: atLeast(1, 0),
    supportsBackground: atLeast(2, 0),
    supportsEffort: atLeast(2, 1),
    supportsForkSession: atLeast(1, 0),
    supportsAgentsJson: atLeast(2, 0),
  };
}

/**
 * Finds the claude binary and reads its version.
 *
 * `/opt/homebrew/bin/claude` is a symlink into a versioned Caskroom directory,
 * so the resolved real path plus its mtime is what tells us an upgrade happened.
 * A failure here blocks the setup screen rather than producing an app that looks
 * fine and cannot start anything.
 */
export class ClaudeBinaryResolver {
  #cached: ClaudeBinaryInfo | null = null;
  #realPath: string | null = null;
  #mtimeMs = 0;

  constructor(private readonly envProvider: () => Promise<Readonly<Record<string, string>>>) {}

  get current(): ClaudeBinaryInfo | null {
    return this.#cached;
  }

  async resolve(override: string | null, force = false): Promise<ClaudeBinaryInfo> {
    if (!force && this.#cached !== null && !(await this.#changedOnDisk())) return this.#cached;

    const env = await this.envProvider();

    if (override !== null) {
      const info = await this.#inspect(override, 'setting', env);
      this.#cached = info;
      return info;
    }

    const fromWhich = await this.#which(env);
    if (fromWhich !== null) {
      const info = await this.#inspect(fromWhich, 'which', env);
      if (info.version !== null) {
        this.#cached = info;
        return info;
      }
    }

    for (const candidate of CANDIDATES) {
      const info = await this.#inspect(candidate, 'candidate', env);
      if (info.version !== null) {
        this.#cached = info;
        return info;
      }
    }

    this.#cached = {
      path: null,
      version: null,
      source: 'missing',
      capabilities: capabilitiesFor(null),
      error:
        'Die Claude-CLI wurde nicht gefunden. Erwartet in PATH oder unter /opt/homebrew/bin/claude.',
    };
    return this.#cached;
  }

  async #changedOnDisk(): Promise<boolean> {
    if (this.#realPath === null) return false;
    try {
      const info = await stat(this.#realPath);
      return Math.round(info.mtimeMs) !== this.#mtimeMs;
    } catch {
      return true;
    }
  }

  async #which(env: Readonly<Record<string, string>>): Promise<string | null> {
    try {
      const { stdout } = await run('/usr/bin/which', ['claude'], {
        env,
        timeout: 5000,
      });
      const path = stdout.trim();
      return path.length > 0 ? path : null;
    } catch {
      return null;
    }
  }

  async #inspect(
    path: string,
    source: ClaudeBinaryInfo['source'],
    env: Readonly<Record<string, string>>,
  ): Promise<ClaudeBinaryInfo> {
    try {
      const { stdout } = await run(path, ['--version'], {
        env,
        timeout: 5000,
      });
      const match = VERSION_RE.exec(stdout);
      if (match === null) {
        return {
          path,
          version: null,
          source,
          capabilities: capabilitiesFor(null),
          error: `Unerwartete Versionsausgabe: ${stdout.trim().slice(0, 120)}`,
        };
      }
      const version = match[0];
      this.#realPath = await realpath(path).catch(() => path);
      this.#mtimeMs = Math.round((await stat(this.#realPath).catch(() => ({ mtimeMs: 0 }))).mtimeMs);
      return { path, version, source, capabilities: capabilitiesFor(version), error: null };
    } catch (error) {
      return {
        path,
        version: null,
        source,
        capabilities: capabilitiesFor(null),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
