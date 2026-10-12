import type { IndexPhase, IndexProgress, ProjectId } from '@cs/shared';
import type { ClaudeHome } from '../claude-home.js';
import { encodeProjectDir } from '../claude-home.js';
import type { Db } from '../db/connection.js';
import type { CursorRepository } from '../db/repositories/cursor-repository.js';
import type { DiagnosticsRepository } from '../db/repositories/diagnostics-repository.js';
import type { TombstoneRepository } from '../db/repositories/tombstone-repository.js';
import type { ProjectRepository } from '../db/repositories/project-repository.js';
import type { SessionRepository } from '../db/repositories/session-repository.js';
import type { ClockPort } from '../ports/clock.js';
import type { ClaudeJsonIngestor } from './claude-json-ingestor.js';
import type { HistoryIngestor } from './history-ingestor.js';
import type { SkeletonIngestor } from './skeleton-ingestor.js';
import type { TranscriptIngestor } from './transcript-ingestor.js';
import type { DiscoveredTranscript, TranscriptScanner } from './transcript-scanner.js';

export interface SchedulerDeps {
  readonly db: Db;
  readonly clock: ClockPort;
  readonly home: ClaudeHome;
  readonly scanner: TranscriptScanner;
  readonly registry: ClaudeJsonIngestor;
  readonly history: HistoryIngestor;
  readonly skeleton: SkeletonIngestor;
  readonly transcripts: TranscriptIngestor;
  readonly projects: ProjectRepository;
  readonly sessions: SessionRepository;
  readonly cursors: CursorRepository;
  readonly diagnostics: DiagnosticsRepository;
  readonly tombstones: TombstoneRepository;
  readonly onProgress: (progress: IndexProgress) => void;
}

const PROGRESS_INTERVAL_MS = 250;

/**
 * Drives the three import phases and the incremental updates after them.
 *
 * Phase order is chosen so the app is useful before it is finished: registry in
 * under a second, a complete titled session list in a few seconds, and only then
 * the message bodies — newest sessions first, because those are the ones about
 * to be opened. Watcher work always preempts the backfill.
 */
export class IngestScheduler {
  #phase: IndexPhase = 'idle';
  #filesTotal = 0;
  #filesDone = 0;
  #bytesTotal = 0;
  #bytesDone = 0;
  #currentPath: string | null = null;
  #lastEmit = 0;
  #decodeErrors = 0;
  readonly #unknownTypes = new Set<string>();
  readonly #priority: DiscoveredTranscript[] = [];
  #cancel = { cancelled: false };
  #running: Promise<void> | null = null;

  constructor(private readonly deps: SchedulerDeps) {}

  get progress(): IndexProgress {
    return {
      phase: this.#phase,
      filesTotal: this.#filesTotal,
      filesDone: this.#filesDone,
      bytesTotal: this.#bytesTotal,
      bytesDone: this.#bytesDone,
      currentPath: this.#currentPath,
      etaMs: this.#eta(),
      cancellable: this.#phase === 'full',
      unknownRecordTypes: [...this.#unknownTypes],
      decodeErrors: this.#decodeErrors,
    };
  }

  #eta(): number | null {
    if (this.#bytesDone === 0 || this.#bytesTotal === 0) return null;
    const ratio = this.#bytesDone / this.#bytesTotal;
    if (ratio <= 0 || ratio >= 1) return null;
    const elapsed = this.deps.clock.now() - this.#startedAt;
    return Math.max(0, Math.round(elapsed / ratio - elapsed));
  }

  #startedAt = 0;

  #emit(force = false): void {
    const now = this.deps.clock.now();
    if (!force && now - this.#lastEmit < PROGRESS_INTERVAL_MS) return;
    this.#lastEmit = now;
    this.deps.onProgress(this.progress);
  }

  /** Phase 0: registry, prompt history. Under half a second in practice. */
  async runRegistryPhase(force = false): Promise<void> {
    this.#phase = 'registry';
    this.#emit(true);
    await this.deps.registry.sync(force);
    await this.deps.history.sync();
    this.deps.projects.refreshAllAggregates();
    this.#phase = 'idle';
    this.#emit(true);
  }

  /** Runs phases 1 and 2; safe to call again, it resumes rather than restarts. */
  async runFullImport(): Promise<void> {
    if (this.#running !== null) return this.#running;
    this.#cancel = { cancelled: false };
    this.#running = this.#doFullImport().finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  cancel(): void {
    this.#cancel.cancelled = true;
  }

  /** Jumps the queue — a live session must not wait behind a backfill. */
  enqueuePriority(item: DiscoveredTranscript): void {
    this.#priority.push(item);
  }

  async #doFullImport(): Promise<void> {
    const { scanner, projects, sessions, clock } = this.deps;
    this.#startedAt = clock.now();

    await this.runRegistryPhase();

    const known = new Map<string, string>();
    for (const project of projects.list({ includeArchived: true })) {
      known.set(encodeProjectDir(project.path), project.path);
    }

    const discovered = await scanner.scan(known, this.deps.tombstones.paths());
    this.#filesTotal = discovered.length;
    this.#filesDone = 0;
    this.#bytesTotal = discovered.reduce((sum, item) => sum + item.size, 0);
    this.#bytesDone = 0;

    const projectIdFor = new Map<string, ProjectId>();
    const resolveProject = (item: DiscoveredTranscript): ProjectId => {
      const cached = projectIdFor.get(item.cwd);
      if (cached !== undefined) return cached;
      const id = projects.ensure(item.cwd, item.encodedDir, clock.now());
      projectIdFor.set(item.cwd, id);
      return id;
    };

    // Phase 1 — head+tail only. A complete, sorted, titled session list in
    // seconds, before any message row exists.
    this.#phase = 'skeleton';
    this.#emit(true);
    for (const item of discovered) {
      if (this.#cancel.cancelled) break;
      this.#currentPath = item.path;
      await this.deps.skeleton.ingest({
        path: item.path,
        projectId: resolveProject(item),
        sessionId: item.sessionId,
        kind: item.kind,
        encodedDir: item.encodedDir,
        fallbackCwd: item.cwd,
      });
      if (item.kind === 'subagent') {
        sessions.patch(item.sessionId, {
          parent_session_id: item.parentSessionId,
          spawn_tool_use_id: item.spawnToolUseId,
          agent_type: item.agentType,
          spawn_depth: item.spawnDepth,
        });
      }
      this.#filesDone += 1;
      this.#emit();
    }

    // Phase 2 — full bodies, newest first.
    this.#phase = 'full';
    this.#filesDone = 0;
    this.#emit(true);
    const queue = [...discovered].sort((a, b) => b.mtimeMs - a.mtimeMs);

    while (queue.length > 0 || this.#priority.length > 0) {
      if (this.#cancel.cancelled) break;
      const item = this.#priority.shift() ?? queue.shift();
      if (item === undefined) break;

      this.#currentPath = item.path;
      const outcome = await this.deps.transcripts.ingest(
        {
          path: item.path,
          projectId: resolveProject(item),
          sessionId: item.sessionId,
          kind: item.kind,
          cwd: item.cwd,
          encodedDir: item.encodedDir,
        },
        this.#cancel,
      );
      this.#decodeErrors += outcome.decodeErrors;
      for (const type of outcome.unknownTypes) this.#unknownTypes.add(type);
      this.#bytesDone += item.size;
      this.#filesDone += 1;
      this.#emit();
    }

    projects.refreshAllAggregates();
    this.#phase = 'idle';
    this.#currentPath = null;
    this.#emit(true);
  }

  /** A single file changed on disk; used by the watcher. */
  async ingestOne(item: DiscoveredTranscript): Promise<void> {
    const projectId = this.deps.projects.ensure(item.cwd, item.encodedDir, this.deps.clock.now());
    const outcome = await this.deps.transcripts.ingest({
      path: item.path,
      projectId,
      sessionId: item.sessionId,
      kind: item.kind,
      cwd: item.cwd,
      encodedDir: item.encodedDir,
    });
    for (const type of outcome.unknownTypes) this.#unknownTypes.add(type);
    this.#decodeErrors += outcome.decodeErrors;
    if (!outcome.skipped) this.deps.projects.refreshAggregates(projectId);
  }
}
