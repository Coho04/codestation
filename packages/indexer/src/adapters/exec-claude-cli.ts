import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CliAgent, CliProbePort } from '../ports/process-probe.js';

const run = promisify(execFile);

/**
 * `claude agents --json --all` is undocumented surface, so every failure mode
 * degrades to "source unavailable" rather than breaking the dashboard. It is
 * still a required source, not a fallback: background agents that have failed
 * appear only here — they have no file under ~/.claude/sessions.
 */
export class ExecClaudeCli implements CliProbePort {
  constructor(
    private readonly binaryPath: () => string | null,
    private readonly env: () => NodeJS.ProcessEnv,
  ) {}

  async listAgents(): Promise<readonly CliAgent[] | null> {
    const binary = this.binaryPath();
    if (binary === null) return null;

    try {
      const { stdout } = await run(binary, ['agents', '--json', '--all'], {
        env: this.env(),
        timeout: 5000,
        maxBuffer: 4 * 1024 * 1024,
      });
      const parsed: unknown = JSON.parse(stdout);
      if (!Array.isArray(parsed)) return null;

      return parsed.flatMap((entry): CliAgent[] => {
        if (typeof entry !== 'object' || entry === null) return [];
        const agent = entry as Record<string, unknown>;
        const sessionId = typeof agent['sessionId'] === 'string' ? agent['sessionId'] : null;
        if (sessionId === null) return [];
        const kind = agent['kind'] === 'background' ? 'background' : 'interactive';
        return [
          {
            sessionId,
            cwd: typeof agent['cwd'] === 'string' ? agent['cwd'] : '',
            kind,
            startedAt: typeof agent['startedAt'] === 'number' ? agent['startedAt'] : null,
            name: typeof agent['name'] === 'string' ? agent['name'] : null,
            pid: typeof agent['pid'] === 'number' ? agent['pid'] : null,
            id: typeof agent['id'] === 'string' ? agent['id'] : null,
            status: typeof agent['status'] === 'string' ? agent['status'] : null,
            state: typeof agent['state'] === 'string' ? agent['state'] : null,
            waitingFor: typeof agent['waitingFor'] === 'string' ? agent['waitingFor'] : null,
          },
        ];
      });
    } catch {
      return null;
    }
  }
}
