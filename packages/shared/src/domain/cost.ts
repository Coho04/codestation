import type { ProjectId } from './ids.js';

export interface DailyCost {
  /** `YYYY-MM-DD` in local time — the unit people actually think in. */
  readonly day: string;
  readonly projectId: ProjectId | null;
  readonly model: string;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly sessionCount: number;
}

export interface ModelPrice {
  readonly model: string;
  readonly effectiveFrom: number;
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
  readonly cacheReadPerMTok: number;
  readonly cacheWrite5mPerMTok: number;
  readonly cacheWrite1hPerMTok: number;
}
