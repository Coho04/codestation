import type { MessageId, PlanId, ProjectId, SessionId } from '../domain/ids.js';
import type { Page, PageSpec } from '../domain/page.js';
import type { ProjectDetail, ProjectPatch, ProjectQuery, ProjectSummary } from '../domain/project.js';
import type { CostByModel, SessionDetail, SessionQuery, SessionSummary } from '../domain/session.js';
import type { SessionTree, TranscriptPage } from '../domain/message.js';
import type { FileTouch, ToolResultBody, ToolUseRow } from '../domain/tool-use.js';
import type { IndexProgress, LiveSession } from '../domain/live-session.js';
import type { SearchHit, SearchQuery } from '../domain/search.js';
import type { PlanDoc } from '../domain/plan.js';
import type { DailyCost } from '../domain/cost.js';
import type { ProjectPaths, SessionPaths, Tombstone } from '../domain/archive.js';

/**
 * Everything the renderer may ask the indexer process.
 *
 * One interface is the single source of truth: the RPC client is a typed Proxy
 * over it, and the handler registry is a `Record<keyof IndexApi, …>`, so adding
 * a method without a handler fails to compile.
 */
export interface IndexApi {
  listProjects(query?: ProjectQuery): Promise<ProjectSummary[]>;
  getProject(id: ProjectId): Promise<ProjectDetail | null>;
  patchProject(id: ProjectId, patch: ProjectPatch): Promise<ProjectDetail | null>;
  /** Registers a directory the user picked that Claude Code has never seen. */
  addProject(path: string): Promise<ProjectDetail | null>;

  listSessions(query: SessionQuery): Promise<Page<SessionSummary>>;
  getSession(id: SessionId): Promise<SessionDetail | null>;
  getSessionCosts(id: SessionId): Promise<CostByModel[]>;

  getTranscript(id: SessionId, page: PageSpec, mainPathOnly: boolean): Promise<TranscriptPage>;
  getSessionTree(id: SessionId): Promise<SessionTree>;
  /** Original JSONL line, seeked by byte offset — never loads the whole file. */
  getRawLine(id: SessionId, messageId: MessageId): Promise<string | null>;
  getToolUses(id: SessionId, page: PageSpec): Promise<Page<ToolUseRow>>;
  /** Result bodies are not stored; this reads them back from disk on demand. */
  getToolResult(id: SessionId, toolUseId: string): Promise<ToolResultBody | null>;
  getFileTouches(id: SessionId): Promise<FileTouch[]>;

  search(query: SearchQuery): Promise<Page<SearchHit>>;

  listPlans(): Promise<PlanDoc[]>;
  getPlan(id: PlanId): Promise<(PlanDoc & { readonly body: string }) | null>;

  getLiveSessions(): Promise<LiveSession[]>;
  getProgress(): Promise<IndexProgress>;
  getDailyCosts(days: number, projectId?: ProjectId): Promise<DailyCost[]>;

  setProjectArchived(id: ProjectId, archived: boolean): Promise<ProjectDetail | null>;
  setSessionArchived(id: SessionId, archived: boolean): Promise<SessionDetail | null>;

  /**
   * Removes rows from the index and writes a tombstone so the next sweep does
   * not bring them back. Nothing under ~/.claude is touched.
   */
  forgetProject(id: ProjectId): Promise<void>;
  forgetSession(id: SessionId): Promise<void>;
  listTombstones(): Promise<Tombstone[]>;
  /** Lifts a tombstone; the next sweep re-indexes whatever is still on disk. */
  restoreTombstone(path: string): Promise<void>;

  /** Paths the destructive operations in the main process need. */
  resolveProjectPaths(id: ProjectId): Promise<ProjectPaths | null>;
  resolveSessionPaths(id: SessionId): Promise<SessionPaths | null>;

  /** Drops and rebuilds derived tables. User data (pins, names) survives. */
  rebuildIndex(): Promise<void>;
  /** Forces a reconcile sweep instead of waiting for the 60 s timer. */
  refresh(): Promise<void>;
}

export type IndexApiMethod = keyof IndexApi;
