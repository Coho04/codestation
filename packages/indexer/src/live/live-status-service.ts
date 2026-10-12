import { projectId as toProjectId, sessionId as toSessionId, type LiveSession, type PaneId } from '@cs/shared';
import type { Db } from '../db/connection.js';
import type { ClockPort } from '../ports/clock.js';
import type { CliAgent, CliProbePort, ProcessProbePort } from '../ports/process-probe.js';
import type { FileSystemPort } from '../ports/file-system.js';
import { deriveAttention } from './attention-rules.js';

/**
 * How long a cached CLI answer stays usable. Generous: the alternative is
 * entries blinking out of existence, which is worse than a slightly stale list.
 */
const CLI_CACHE_TTL_MS = 5 * 60_000;
import type { LiveSessionSource } from './live-session-source.js';

export interface LiveStatusDeps {
  readonly db: Db;
  readonly fs: FileSystemPort;
  readonly clock: ClockPort;
  readonly sessionFiles: LiveSessionSource;
  readonly processes: ProcessProbePort;
  readonly cli: CliProbePort;
}

interface Merged {
  sessionId: string;
  pid: number | null;
  backgroundId: string | null;
  cwd: string;
  name: string | null;
  kind: 'interactive' | 'background';
  status: LiveSession['status'];
  waitingFor: string | null;
  backgroundState: string | null;
  startedAt: number | null;
  statusUpdatedAt: number | null;
  procStart: string | null;
  ccVersion: string | null;
  hasSessionFile: boolean;
}

/**
 * Merges the three sources that each know something the others do not.
 *
 * The merge key is the session id, never the pid: pids are recycled, session ids
 * are not. Pid is only used to ask the OS whether that exact process — same
 * start time — is still the one the file describes.
 */
export class LiveStatusService {
  #cache: LiveSession[] = [];
  #lastCliRun = 0;
  /**
   * The last answer from `claude agents`.
   *
   * The CLI is polled far less often than the status files because each call
   * starts the whole binary. Skipping a poll must mean "do not refresh this",
   * not "forget it" — dropping these entries on every fast pass made the dock
   * badge oscillate between the file-only count and the full one.
   */
  #cliAgents: readonly CliAgent[] = [];
  #cliAgentsAt = 0;

  constructor(private readonly deps: LiveStatusDeps) {}

  get current(): readonly LiveSession[] {
    return this.#cache;
  }

  async refresh(options: { useCli?: boolean; paneBindings?: ReadonlyMap<string, PaneId> } = {}): Promise<LiveSession[]> {
    const { clock, processes, cli, sessionFiles } = this.deps;
    const now = clock.now();

    const merged = new Map<string, Merged>();

    for (const file of await sessionFiles.read()) {
      merged.set(file.sessionId, {
        sessionId: file.sessionId,
        pid: file.pid,
        backgroundId: null,
        cwd: file.cwd,
        name: file.name,
        kind: 'interactive',
        status: file.status,
        waitingFor: file.waitingFor,
        backgroundState: null,
        startedAt: file.startedAt,
        statusUpdatedAt: file.statusUpdatedAt,
        procStart: file.procStart,
        ccVersion: file.version,
        hasSessionFile: true,
      });
    }

    if (options.useCli !== false) {
      const agents = await cli.listAgents();
      this.#lastCliRun = now;
      // A failed call leaves the previous answer in place rather than wiping
      // out everything the CLI knows.
      if (agents !== null) {
        this.#cliAgents = agents;
        this.#cliAgentsAt = now;
      }
    }

    if (now - this.#cliAgentsAt <= CLI_CACHE_TTL_MS) {
      for (const agent of this.#cliAgents) {
        const existing = merged.get(agent.sessionId);
        if (existing !== undefined) {
          existing.backgroundId ??= agent.id;
          existing.backgroundState ??= agent.state;
          existing.name ??= agent.name;
          continue;
        }
        // Background agents — including failed ones — have no file under
        // ~/.claude/sessions, so without this source they would be invisible.
        merged.set(agent.sessionId, {
          sessionId: agent.sessionId,
          pid: agent.pid,
          backgroundId: agent.id,
          cwd: agent.cwd,
          name: agent.name,
          kind: agent.kind,
          status: agent.status === 'idle' || agent.status === 'busy' || agent.status === 'waiting' ? agent.status : null,
          waitingFor: agent.waitingFor,
          backgroundState: agent.state,
          startedAt: agent.startedAt,
          statusUpdatedAt: null,
          procStart: null,
          ccVersion: null,
          hasSessionFile: false,
        });
      }
    }

    const pids = [...merged.values()].map((entry) => entry.pid).filter((pid): pid is number => pid !== null);
    const alivePids = await processes.probe(pids);

    const transcriptMtimes = await this.#transcriptMtimes([...merged.keys()]);
    const projectIds = this.#projectIds([...merged.values()].map((entry) => entry.cwd));

    const result: LiveSession[] = [];
    for (const entry of merged.values()) {
      const alive = this.#isAlive(entry, alivePids);
      const transcriptMtime = transcriptMtimes.get(entry.sessionId) ?? null;

      result.push({
        sessionId: toSessionId(entry.sessionId),
        pid: entry.pid,
        backgroundId: entry.backgroundId,
        cwd: entry.cwd,
        projectId: projectIds.get(entry.cwd) ?? null,
        name: entry.name,
        kind: entry.kind,
        status: entry.status,
        waitingFor: entry.waitingFor,
        backgroundState: entry.backgroundState,
        attention: deriveAttention(
          {
            alive,
            status: entry.status,
            waitingFor: entry.waitingFor,
            statusUpdatedAt: entry.statusUpdatedAt,
            transcriptMtime,
            backgroundState: entry.backgroundState,
            hasSessionFile: entry.hasSessionFile,
            startedAt: entry.startedAt,
          },
          now,
        ),
        startedAt: entry.startedAt,
        statusUpdatedAt: entry.statusUpdatedAt,
        transcriptMtime,
        ccVersion: entry.ccVersion,
        paneId: options.paneBindings?.get(entry.sessionId) ?? null,
      });
    }

    result.sort((a, b) => rank(a.attention) - rank(b.attention) || (b.startedAt ?? 0) - (a.startedAt ?? 0));
    this.#cache = result;
    return result;
  }

  get lastCliRun(): number {
    return this.#lastCliRun;
  }

  #isAlive(entry: Merged, alivePids: ReadonlyMap<number, string>): boolean {
    if (entry.kind === 'background') return entry.backgroundState !== 'failed' && entry.backgroundState !== 'stopped';
    if (entry.pid === null) return false;
    const observed = alivePids.get(entry.pid);
    if (observed === undefined) return false;
    // The pid exists — but is it the same process? Without this check a recycled
    // pid would resurrect a session that ended weeks ago.
    if (entry.procStart === null) return true;
    return normalise(observed) === normalise(entry.procStart);
  }

  async #transcriptMtimes(sessionIds: readonly string[]): Promise<Map<string, number>> {
    const mtimes = new Map<string, number>();
    if (sessionIds.length === 0) return mtimes;

    const placeholders = sessionIds.map(() => '?').join(',');
    const rows = this.deps.db
      .prepare<string[], { id: string; transcript_path: string | null }>(
        `SELECT id, transcript_path FROM session WHERE id IN (${placeholders})`,
      )
      .all(...sessionIds);

    for (const row of rows) {
      if (row.transcript_path === null) continue;
      const stat = await this.deps.fs.stat(row.transcript_path);
      if (stat !== null) mtimes.set(row.id, stat.mtimeMs);
    }
    return mtimes;
  }

  #projectIds(paths: readonly string[]): Map<string, ReturnType<typeof toProjectId>> {
    const unique = [...new Set(paths.filter((path) => path.length > 0))];
    const map = new Map<string, ReturnType<typeof toProjectId>>();
    if (unique.length === 0) return map;
    const rows = this.deps.db
      .prepare<string[], { id: number; path: string }>(
        `SELECT id, path FROM project WHERE path IN (${unique.map(() => '?').join(',')})`,
      )
      .all(...unique);
    for (const row of rows) map.set(row.path, toProjectId(row.id));
    return map;
  }
}

const ORDER: Record<LiveSession['attention'], number> = {
  'needs-you': 0,
  working: 1,
  idle: 2,
  stale: 3,
  dead: 4,
};
const rank = (level: LiveSession['attention']): number => ORDER[level];

/** `ps` pads single-digit days differently from Claude Code's own formatting. */
const normalise = (value: string): string => value.replace(/\s+/g, ' ').trim();
