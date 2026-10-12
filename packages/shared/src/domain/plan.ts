import type { Millis, PlanId, SessionId } from './ids.js';

/**
 * Markdown under `~/.claude/plans`. The files carry no front matter and no
 * reference to a session; the only hard link is a `file-history-delta` record
 * whose `trackingPath` points at the file.
 */
export interface PlanDoc {
  readonly id: PlanId;
  readonly filePath: string;
  readonly slug: string;
  readonly title: string;
  readonly mtime: Millis;
  readonly size: number;
  readonly filePresent: boolean;
  readonly links: readonly PlanLink[];
}

export interface PlanLink {
  readonly sessionId: SessionId;
  readonly sessionTitle: string;
  /** 1.0 from a trackingPath record, 0.5 from an mtime window. */
  readonly confidence: number;
  readonly method: 'tracking-path' | 'mtime';
}
