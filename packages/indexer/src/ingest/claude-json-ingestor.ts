import { createHash } from 'node:crypto';
import type { ProjectId } from '@cs/shared';
import type { ClaudeHome } from '../claude-home.js';
import { encodeProjectDir } from '../claude-home.js';
import type { ProjectRepository } from '../db/repositories/project-repository.js';
import type { ClockPort } from '../ports/clock.js';
import type { FileSystemPort } from '../ports/file-system.js';

/** Deliberately narrow: the rest of ~/.claude.json must not be reachable. */
export interface ProjectRegistryEntry {
  readonly path: string;
  readonly lastSessionId: string | null;
  readonly lastCost: number | null;
  readonly lastStartTime: number | null;
  readonly hasTrustDialogAccepted: boolean;
}

export interface RegistryResult {
  readonly changed: boolean;
  readonly projects: readonly { readonly id: ProjectId; readonly path: string }[];
}

/**
 * Reads the project registry out of ~/.claude.json.
 *
 * The file is rewritten about once a minute, but the `.projects` subtree almost
 * never changes — so the parse is gated on a hash of just that subtree. Without
 * the gate this is the single busiest piece of pointless work in the app.
 *
 * It also contains userID, machineID and cached auth material. The return type
 * is narrowed here so the rest of the codebase cannot even see those fields.
 */
export class ClaudeJsonIngestor {
  #lastHash: string | null = null;

  constructor(
    private readonly fs: FileSystemPort,
    private readonly home: ClaudeHome,
    private readonly projects: ProjectRepository,
    private readonly clock: ClockPort,
  ) {}

  async read(): Promise<ProjectRegistryEntry[]> {
    const raw = await this.fs.readFile(this.home.configJson);
    if (raw === null) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }

    const projects = (parsed as { projects?: unknown }).projects;
    if (typeof projects !== 'object' || projects === null) return [];

    return Object.entries(projects as Record<string, unknown>).map(([path, value]) => {
      const entry = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
      return {
        path,
        lastSessionId: typeof entry['lastSessionId'] === 'string' ? entry['lastSessionId'] : null,
        lastCost: typeof entry['lastCost'] === 'number' ? entry['lastCost'] : null,
        lastStartTime: typeof entry['lastStartTime'] === 'number' ? entry['lastStartTime'] : null,
        hasTrustDialogAccepted: entry['hasTrustDialogAccepted'] === true,
      };
    });
  }

  async sync(force = false): Promise<RegistryResult> {
    const entries = await this.read();
    const hash = createHash('sha256')
      .update(JSON.stringify(entries.map((e) => [e.path, e.lastSessionId])))
      .digest('hex');

    if (!force && hash === this.#lastHash) return { changed: false, projects: [] };
    this.#lastHash = hash;

    const now = this.clock.now();
    const result: { id: ProjectId; path: string }[] = [];

    for (const entry of entries) {
      const id = this.projects.ensure(entry.path, encodeProjectDir(entry.path), now, true);
      this.projects.setRegistryData(id, JSON.stringify(entry), entry.lastSessionId);
      this.projects.setPathExists(id, await this.fs.exists(entry.path));
      result.push({ id, path: entry.path });
    }

    return { changed: true, projects: result };
  }
}
