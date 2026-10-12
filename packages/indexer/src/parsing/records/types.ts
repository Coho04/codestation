import type { NormalisedBlock } from '../content-blocks.js';

export interface DecodeContext {
  readonly byteOffset: number;
  readonly byteLength: number;
  readonly lineNo: number;
}

export interface MessageRecord {
  readonly kind: 'message';
  readonly uuid: string;
  readonly parentUuid: string | null;
  readonly sessionId: string | null;
  readonly role: 'user' | 'assistant' | 'system';
  readonly recordType: string;
  readonly ts: number | null;
  readonly cwd: string | null;
  readonly gitBranch: string | null;
  readonly ccVersion: string | null;
  readonly entrypoint: string | null;
  readonly isMeta: boolean;
  readonly isSidechain: boolean;
  readonly isUserPrompt: boolean;
  readonly promptSource: string | null;
  readonly model: string | null;
  readonly stopReason: string | null;
  readonly requestId: string | null;
  readonly effort: string | null;
  readonly text: string;
  readonly blocks: readonly NormalisedBlock[];
  readonly usage: UsageRecord | null;
  readonly toolResultFor: string | null;
}

export interface UsageRecord {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly webSearchRequests: number;
}

/** Title, resume pointer, worktree moves — session-level facts, not messages. */
export interface SessionMetaRecord {
  readonly kind: 'session-meta';
  readonly recordType: string;
  readonly sessionId: string | null;
  readonly title?: string;
  readonly titleSource?: 'ai-title' | 'custom-title' | 'agent-name';
  readonly leafUuid?: string;
  readonly relocatedCwd?: string;
  readonly worktreePath?: string;
  readonly worktreeBranch?: string;
  readonly bridgeSessionId?: string;
  readonly prUrl?: string;
  readonly prNumber?: number;
  readonly ts?: number;
}

export interface CostStateRecord {
  readonly kind: 'cost-state';
  readonly sessionId: string | null;
  readonly totalCostUsd: number;
  readonly totalDurationMs: number | null;
  readonly apiDurationMs: number | null;
  readonly toolDurationMs: number | null;
  readonly linesAdded: number;
  readonly linesRemoved: number;
  readonly startTime: number | null;
  readonly modelUsage: ReadonlyMap<string, UsageRecord>;
}

export interface FileHistoryRecord {
  readonly kind: 'file-history';
  readonly sessionId: string | null;
  readonly trackingPath: string;
  readonly version: number | null;
  readonly backupFileName: string | null;
  readonly ts: number | null;
}

/**
 * Attachments are nodes in the conversation tree, not side notes: they carry
 * their own uuid and parentUuid and sit between user and assistant records. They
 * must be stored — as metadata, without their 50 MB of bodies — or every chain
 * that passes through one breaks, and the "current conversation" path collapses.
 */
export interface AttachmentRecord {
  readonly kind: 'attachment';
  readonly attachmentType: string;
  readonly sessionId: string | null;
  readonly uuid: string;
  readonly parentUuid: string | null;
  readonly ts: number | null;
  /** The only thing worth keeping out of those bodies. */
  readonly contextTokensLeft: number | null;
}

/**
 * Recognised, but carrying nothing the index needs beyond its position.
 *
 * Position still matters: the conversation tree is defined by uuid/parentUuid,
 * not by record type, so anything that carries a uuid is a node in it. Dropping
 * such a record severs every chain that passes through it — 'system' records
 * alone sit between a prompt and its answer often enough to leave the current
 * conversation path almost empty.
 */
export interface IgnoredRecord {
  readonly kind: 'ignored';
  readonly recordType: string;
  readonly uuid: string | null;
  readonly parentUuid: string | null;
  readonly ts: number | null;
}

/** The forward-compatibility escape hatch; never a thrown error. */
export interface UnknownRecord {
  readonly kind: 'unknown';
  readonly recordType: string;
  readonly raw: string;
  readonly sessionId: string | null;
  readonly uuid: string | null;
  readonly parentUuid: string | null;
  readonly ts: number | null;
}

export type DecodedRecord =
  | MessageRecord
  | SessionMetaRecord
  | CostStateRecord
  | FileHistoryRecord
  | AttachmentRecord
  | IgnoredRecord
  | UnknownRecord;
