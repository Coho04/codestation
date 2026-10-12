import { readFile } from 'node:fs/promises';
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REFRESH_INTERVAL_MS = 30_000;

/**
 * Decides which directories a pane may be started in.
 *
 * Deliberately implemented in main rather than asked of the indexer: this is the
 * check that keeps a compromised renderer — one that has been fed hostile
 * transcript text or terminal output — from spawning a process in an arbitrary
 * directory. A security decision should not depend on another process being
 * healthy.
 *
 * The set is Claude Code's own project registry plus directories the user picked
 * through a native dialog in this session.
 */
export class ProjectAllowList {
  #registry = new Set<string>();
  #picked = new Set<string>();
  #lastRead = 0;

  constructor(
    private readonly home: string = homedir(),
    private extraPaths: readonly string[] = [],
  ) {}

  setExtraPaths(paths: readonly string[]): void {
    this.extraPaths = paths;
  }

  allow(path: string): void {
    this.#picked.add(path);
  }

  get pickedPaths(): string[] {
    return [...this.#picked];
  }

  async has(path: string): Promise<boolean> {
    await this.#refresh();
    const resolved = await realpath(path).catch(() => path);
    return (
      this.#registry.has(resolved) ||
      this.#picked.has(resolved) ||
      this.#picked.has(path) ||
      this.extraPaths.includes(resolved)
    );
  }

  async #refresh(): Promise<void> {
    const now = Date.now();
    if (now - this.#lastRead < REFRESH_INTERVAL_MS && this.#registry.size > 0) return;
    this.#lastRead = now;

    try {
      const raw = await readFile(join(this.home, '.claude.json'), 'utf8');
      const parsed = JSON.parse(raw) as { projects?: Record<string, unknown> };
      const projects = parsed.projects ?? {};
      const resolved = await Promise.all(
        Object.keys(projects).map(async (path) => realpath(path).catch(() => path)),
      );
      this.#registry = new Set(resolved);
    } catch {
      // Keep whatever we had; failing closed on a transient read error would
      // make the app unusable for no gain.
    }
  }
}
