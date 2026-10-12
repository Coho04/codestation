import { join } from 'node:path';
import type { IndexProgress } from '@cs/shared';
import { ClaudeHome } from './claude-home.js';
import { assertFts5, openDatabase, type Db } from './db/connection.js';
import { migrate } from './db/migrator.js';
import { CostRepository } from './db/repositories/cost-repository.js';
import { CursorRepository } from './db/repositories/cursor-repository.js';
import { DiagnosticsRepository } from './db/repositories/diagnostics-repository.js';
import { MessageRepository } from './db/repositories/message-repository.js';
import { PlanRepository } from './db/repositories/plan-repository.js';
import { ProjectRepository } from './db/repositories/project-repository.js';
import { SearchRepository } from './db/repositories/search-repository.js';
import { SessionRepository } from './db/repositories/session-repository.js';
import { TombstoneRepository } from './db/repositories/tombstone-repository.js';
import { ToolResultReader } from './db/repositories/tool-result-reader.js';
import { ClaudeJsonIngestor } from './ingest/claude-json-ingestor.js';
import { HistoryIngestor } from './ingest/history-ingestor.js';
import { IngestScheduler } from './ingest/ingest-scheduler.js';
import { PlansIngestor } from './ingest/plans-ingestor.js';
import { SessionLinker } from './ingest/session-linker.js';
import { SkeletonIngestor } from './ingest/skeleton-ingestor.js';
import { TranscriptIngestor } from './ingest/transcript-ingestor.js';
import { TranscriptScanner } from './ingest/transcript-scanner.js';
import { LiveSessionSource } from './live/live-session-source.js';
import { LiveStatusService } from './live/live-status-service.js';
import { NodeFileSystem } from './adapters/node-file-system.js';
import { PsProcessProbe } from './adapters/ps-process-probe.js';
import { ExecClaudeCli } from './adapters/exec-claude-cli.js';
import { FsRecursiveWatcher } from './adapters/fs-recursive-watcher.js';
import { systemClock, type ClockPort } from './ports/clock.js';
import { ReconcileSweep } from './watch/reconcile-sweep.js';

export interface IndexerConfig {
  readonly dbPath: string;
  readonly home: string;
  readonly appVersion: string;
  readonly claudeBinaryPath: string | null;
  readonly onProgress: (progress: IndexProgress) => void;
}

/** Named explicitly so the type does not depend on better-sqlite3's internals. */
export interface Indexer {
  readonly db: Db;
  readonly home: ClaudeHome;
  readonly fs: NodeFileSystem;
  readonly clock: ClockPort;
  readonly projects: ProjectRepository;
  readonly sessions: SessionRepository;
  readonly messages: MessageRepository;
  readonly cursors: CursorRepository;
  readonly diagnostics: DiagnosticsRepository;
  readonly search: SearchRepository;
  readonly tombstones: TombstoneRepository;
  readonly plans: PlanRepository;
  readonly costs: CostRepository;
  readonly toolResults: ToolResultReader;
  readonly scanner: TranscriptScanner;
  readonly registry: ClaudeJsonIngestor;
  readonly history: HistoryIngestor;
  readonly plansIngestor: PlansIngestor;
  readonly linker: SessionLinker;
  readonly scheduler: IngestScheduler;
  readonly live: LiveStatusService;
  readonly watcher: FsRecursiveWatcher;
  readonly sweep: ReconcileSweep;
  /**
   * Filled in by the watch controller. Lets a request handler ask for an
   * immediate reconcile instead of leaving the user to wait out the 60-second
   * timer after an action they just took.
   */
  readonly reconcile: { run: (() => Promise<void>) | null };
}

/**
 * The one place that wires concrete adapters to ports. Everything else receives
 * its collaborators and can be constructed against fakes in a test.
 */
export function buildIndexer(config: IndexerConfig): Indexer {
  const db: Db = openDatabase({ path: config.dbPath });
  migrate(db);
  assertFts5(db);

  const home = new ClaudeHome(config.home);
  const fs = new NodeFileSystem();
  const clock = systemClock;

  const projects = new ProjectRepository(db);
  const sessions = new SessionRepository(db);
  const messages = new MessageRepository(db);
  const cursors = new CursorRepository(db);
  const diagnostics = new DiagnosticsRepository(db);
  const search = new SearchRepository(db);
  const tombstones = new TombstoneRepository(db);
  const plans = new PlanRepository(db);
  const costs = new CostRepository(db, diagnostics);
  const toolResults = new ToolResultReader(db, fs);

  const scanner = new TranscriptScanner(fs, home);
  const registry = new ClaudeJsonIngestor(fs, home, projects, clock);
  const history = new HistoryIngestor(db, fs, home, cursors);
  const skeleton = new SkeletonIngestor(db, fs, sessions);
  const plansIngestor = new PlansIngestor(fs, home, plans);
  const linker = new SessionLinker(db);

  const transcripts = new TranscriptIngestor({
    db,
    fs,
    clock,
    cursors,
    sessions,
    messages,
    diagnostics,
    appVersion: config.appVersion,
  });

  const scheduler = new IngestScheduler({
    db,
    clock,
    home,
    scanner,
    registry,
    history,
    skeleton,
    transcripts,
    projects,
    sessions,
    cursors,
    diagnostics,
    tombstones,
    onProgress: config.onProgress,
  });

  const live = new LiveStatusService({
    db,
    fs,
    clock,
    sessionFiles: new LiveSessionSource(fs, home),
    processes: new PsProcessProbe(),
    cli: new ExecClaudeCli(
      () => config.claudeBinaryPath,
      () => process.env,
    ),
  });

  return {
    db,
    home,
    fs,
    clock,
    projects,
    sessions,
    messages,
    cursors,
    diagnostics,
    search,
    tombstones,
    plans,
    costs,
    toolResults,
    scanner,
    registry,
    history,
    plansIngestor,
    linker,
    scheduler,
    live,
    reconcile: { run: null },
    watcher: new FsRecursiveWatcher(),
    sweep: new ReconcileSweep(scanner, cursors, fs),
  };
}

export const defaultDbPath = (userDataDir: string): string => join(userDataDir, 'index.db');

