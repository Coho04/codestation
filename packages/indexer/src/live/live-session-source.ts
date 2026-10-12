import { join } from 'node:path';
import type { ClaudeStatus } from '@cs/shared';
import type { ClaudeHome } from '../claude-home.js';
import type { FileSystemPort } from '../ports/file-system.js';

export interface SessionFileEntry {
  readonly pid: number;
  readonly sessionId: string;
  readonly cwd: string;
  readonly name: string | null;
  readonly status: ClaudeStatus | null;
  readonly waitingFor: string | null;
  readonly startedAt: number | null;
  readonly statusUpdatedAt: number | null;
  /** Compared against `ps -o lstart=` to rule out PID reuse. */
  readonly procStart: string | null;
  readonly version: string | null;
}

/**
 * Reads ~/.claude/sessions/<pid>.json.
 *
 * The matching <pid>.<sha>.key files hold a peer auth token for Claude Code's
 * own IPC socket. They are never opened — reading another process's credentials
 * is not something a read-only dashboard has any business doing.
 */
export class LiveSessionSource {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly home: ClaudeHome,
  ) {}

  async read(): Promise<SessionFileEntry[]> {
    const entries = await this.fs.readdir(this.home.sessionsDir);
    const result: SessionFileEntry[] = [];

    for (const entry of entries) {
      if (!entry.isFile || !/^\d+\.json$/.test(entry.name)) continue;
      const raw = await this.fs.readFile(join(this.home.sessionsDir, entry.name));
      if (raw === null) continue;

      try {
        const data = JSON.parse(raw) as Record<string, unknown>;
        const pid = typeof data['pid'] === 'number' ? data['pid'] : null;
        const sessionId = typeof data['sessionId'] === 'string' ? data['sessionId'] : null;
        if (pid === null || sessionId === null) continue;

        const status = typeof data['status'] === 'string' ? data['status'] : null;
        result.push({
          pid,
          sessionId,
          cwd: typeof data['cwd'] === 'string' ? data['cwd'] : '',
          name: typeof data['name'] === 'string' ? data['name'] : null,
          status: status === 'idle' || status === 'busy' || status === 'waiting' ? status : null,
          waitingFor: typeof data['waitingFor'] === 'string' ? data['waitingFor'] : null,
          startedAt: typeof data['startedAt'] === 'number' ? data['startedAt'] : null,
          statusUpdatedAt:
            typeof data['statusUpdatedAt'] === 'number'
              ? data['statusUpdatedAt']
              : typeof data['updatedAt'] === 'number'
                ? data['updatedAt']
                : null,
          procStart: typeof data['procStart'] === 'string' ? data['procStart'] : null,
          version: typeof data['version'] === 'string' ? data['version'] : null,
        });
      } catch {
        // A file being rewritten mid-read is expected; it will be picked up on
        // the next pass.
      }
    }

    return result;
  }
}
