import type { MessageId, Millis, ProjectId, SessionId } from './ids.js';

/**
 * `prompts` are what a human typed, `assistant` what Claude wrote back,
 * `tools` the summarised tool invocations (tier 2), `plans` the markdown under
 * `~/.claude/plans`. Tool result bodies (tier 3) are only searched in projects
 * where the user switched deep indexing on.
 */
export type SearchScope = 'prompts' | 'assistant' | 'tools' | 'plans';

export interface SearchQuery {
  readonly text: string;
  readonly scopes?: readonly SearchScope[];
  readonly projectId?: ProjectId;
  readonly sessionId?: SessionId;
  readonly since?: Millis;
  readonly until?: Millis;
  readonly offset?: number;
  readonly limit?: number;
}

export interface SearchHit {
  readonly messageId: MessageId | null;
  readonly sessionId: SessionId | null;
  readonly sessionTitle: string;
  readonly projectId: ProjectId | null;
  readonly projectPath: string;
  readonly scope: SearchScope;
  readonly ts: Millis | null;
  /** Highlighted excerpt; delimiters are the two marker constants below. */
  readonly snippet: string;
  readonly score: number;
}

export const SNIPPET_OPEN = '\u0002';
export const SNIPPET_CLOSE = '\u0003';
