import type { MessageId, Millis, SessionId } from './ids.js';

export type MessageRole = 'user' | 'assistant' | 'system' | 'meta';

export interface MessageRow {
  readonly id: MessageId;
  readonly sessionId: SessionId;
  readonly uuid: string;
  readonly parentUuid: string | null;
  /** Line ordinal in the transcript — stable ordering even when edges dangle. */
  readonly seq: number;
  readonly role: MessageRole;
  readonly recordType: string;
  readonly ts: Millis | null;
  /**
   * True when `message.content` was a plain string, i.e. something the human
   * actually typed. Only ~8% of `user` records qualify; the rest are tool
   * results that happen to use the same role.
   */
  readonly isUserPrompt: boolean;
  readonly isMeta: boolean;
  readonly onMainPath: boolean;
  readonly childCount: number;
  readonly model: string | null;
  readonly stopReason: string | null;
  readonly gitBranch: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costUsd: number | null;
  /** Remaining context budget, parsed out of a `total_tokens_reminder`. */
  readonly contextTokensLeft: number | null;
  readonly blocks: readonly ContentBlock[];
}

/**
 * `thinking` is deliberately absent: the blocks on disk carry an empty
 * `thinking` field and a ~3 KB base64 `signature`. 38.7 MB of the corpus, with
 * 0.01 MB of actual text in it.
 */
export type ContentBlock =
  | { readonly kind: 'text'; readonly text: string; readonly truncated: boolean }
  | { readonly kind: 'tool-use'; readonly toolUseId: string; readonly name: string; readonly summary: string; readonly targetPath: string | null }
  | { readonly kind: 'tool-result'; readonly toolUseId: string; readonly bytes: number; readonly isError: boolean; readonly preview: string; readonly truncated: boolean }
  | { readonly kind: 'attachment'; readonly attachmentType: string }
  | { readonly kind: 'thinking-elided'; readonly signatureBytes: number };

export interface TranscriptPage {
  readonly sessionId: SessionId;
  readonly items: readonly MessageRow[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

export interface TreeNode {
  readonly id: MessageId;
  readonly uuid: string;
  readonly parentUuid: string | null;
  readonly seq: number;
  readonly role: MessageRole;
  readonly ts: Millis | null;
  readonly preview: string;
  readonly childCount: number;
}

export interface SessionTree {
  readonly nodes: readonly TreeNode[];
  /** Message ids from root to `leafUuid`, the conversation as it stands now. */
  readonly mainPath: readonly MessageId[];
  readonly forkPoints: readonly { readonly uuid: string; readonly childUuids: readonly string[] }[];
  /** Parents referenced but not present in this file — resumes and compactions. */
  readonly danglingRoots: readonly string[];
  readonly subagents: readonly {
    readonly sessionId: SessionId;
    readonly toolUseId: string;
    readonly agentType: string;
    readonly spawnDepth: number;
  }[];
}
