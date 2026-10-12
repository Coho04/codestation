import type { Millis, ProjectId, SessionId } from './ids.js';

/**
 * `subagent` sessions live in their own transcript files under
 * `<sessionId>/subagents/agent-*.jsonl`. They are not inline sidechains:
 * `isSidechain` is false in every main transcript on disk.
 */
export type SessionKind = 'interactive' | 'background' | 'subagent';

/** How far the indexer has processed a transcript. */
export type IndexState = 'skeleton' | 'partial' | 'complete' | 'error';

/** Where the display title came from, in precedence order. */
export type TitleSource = 'custom-title' | 'ai-title' | 'agent-name' | 'first-prompt' | 'fallback';

export interface SessionSummary {
  readonly id: SessionId;
  readonly projectId: ProjectId;
  readonly projectPath: string;
  readonly title: string;
  readonly titleSource: TitleSource;
  readonly kind: SessionKind;
  readonly startedAt: Millis | null;
  readonly endedAt: Millis | null;
  /** Real user input only — tool results are excluded. */
  readonly userPromptCount: number;
  readonly messageCount: number;
  readonly gitBranch: string | null;
  readonly costUsd: number | null;
  readonly indexState: IndexState;
  /**
   * False once Claude Code removed the transcript from disk; the rows are kept.
   * Distinct from `archived`, which is the user's own decision.
   */
  readonly filePresent: boolean;
  readonly archived: boolean;
}

export interface SessionDetail extends SessionSummary {
  readonly cwd: string;
  /** Differs from `cwd` after a `relocated` record (worktree entry). */
  readonly currentCwd: string;
  readonly transcriptPath: string | null;
  readonly ccVersion: string | null;
  readonly entrypoint: string | null;
  readonly models: readonly string[];
  readonly toolUseCount: number;
  readonly assistantCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly costSource: 'cost-state' | 'computed' | null;
  readonly linesAdded: number;
  readonly linesRemoved: number;
  readonly totalDurationMs: number | null;
  readonly apiDurationMs: number | null;
  readonly leafUuid: string | null;
  readonly rootUuid: string | null;
  /** Set when this session resumes a conversation that began in another file. */
  readonly continuedFrom: { readonly sessionId: SessionId; readonly uuid: string } | null;
  readonly parentSessionId: SessionId | null;
  readonly spawnToolUseId: string | null;
  readonly agentType: string | null;
  readonly worktreePath: string | null;
  readonly prUrl: string | null;
  readonly archivedAt: Millis | null;
}

export type SessionSort = 'recent' | 'oldest' | 'cost' | 'messages';

export interface SessionQuery {
  readonly projectId?: ProjectId;
  readonly kinds?: readonly SessionKind[];
  readonly search?: string;
  readonly since?: Millis;
  readonly until?: Millis;
  /** Sessions whose transcript Claude Code removed. */
  readonly includeVanished?: boolean;
  /** Sessions the user archived. */
  readonly includeArchived?: boolean;
  readonly onlyArchived?: boolean;
  /** Subagent transcripts are noise in the main list; excluded unless asked for. */
  readonly includeSubagents?: boolean;
  readonly sort?: SessionSort;
  readonly offset?: number;
  readonly limit?: number;
}

export interface CostByModel {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly costUsd: number;
  readonly source: 'cost-state' | 'computed';
}
