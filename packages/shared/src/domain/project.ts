import type { Millis, ProjectId, SessionId } from './ids.js';

export interface ProjectSummary {
  readonly id: ProjectId;
  /**
   * The real absolute cwd. Never derived from the encoded directory name under
   * `~/.claude/projects` — that encoding replaces `/`, `_`, `.` and spaces with
   * `-` and is not injective (`acme.de` and `acme-de` collide).
   */
  readonly path: string;
  /** User-chosen label, falling back to the last path segment. */
  readonly displayName: string;
  readonly group: string | null;
  readonly pinned: boolean;
  /** Out of the lists and out of full-text search; fully reversible. */
  readonly archived: boolean;
  /** False once the directory no longer exists; the archive stays readable. */
  readonly pathExists: boolean;
  /** Present as a key under `.projects` in ~/.claude.json. */
  readonly inRegistry: boolean;
  readonly sessionCount: number;
  readonly lastActivityAt: Millis | null;
  readonly totalCostUsd: number;
  readonly liveSessionCount: number;
  readonly needsAttentionCount: number;
}

export interface ProjectDetail extends ProjectSummary {
  readonly encodedDir: string | null;
  readonly firstSeenAt: Millis;
  readonly lastSessionId: SessionId | null;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalLinesAdded: number;
  readonly totalLinesRemoved: number;
  /** Tool results indexed for full-text search (tier 3, opt-in per project). */
  readonly deepIndexed: boolean;
}

export interface ProjectQuery {
  readonly includeArchived?: boolean;
  readonly onlyArchived?: boolean;
  readonly search?: string;
}

export interface ProjectPatch {
  readonly displayName?: string | null;
  readonly group?: string | null;
  readonly pinned?: boolean;
  readonly archived?: boolean;
  readonly deepIndexed?: boolean;
}
