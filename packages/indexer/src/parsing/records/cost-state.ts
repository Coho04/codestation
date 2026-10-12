import { asObject, int, num, str, timestamp, type Json } from './field-readers.js';
import type { CostStateRecord, UsageRecord } from './types.js';

/**
 * Present in only 31 of 359 sessions, and often zeroed. It is treated as an
 * override for computed costs, never as the source of truth.
 */
export function decodeCostState(line: Json): CostStateRecord {
  const usage = new Map<string, UsageRecord>();
  for (const [model, raw] of Object.entries(asObject(line['modelUsage']))) {
    const entry = asObject(raw);
    usage.set(model, {
      inputTokens: int(entry['inputTokens']),
      outputTokens: int(entry['outputTokens']),
      cacheReadTokens: int(entry['cacheReadInputTokens']),
      cacheCreationTokens: int(entry['cacheCreationInputTokens']),
      webSearchRequests: int(entry['webSearchRequests']),
    });
  }

  return {
    kind: 'cost-state',
    sessionId: str(line['sessionId']) ?? str(line['session_id']),
    totalCostUsd: num(line['totalCostUSD']) ?? 0,
    totalDurationMs: num(line['totalDuration']),
    apiDurationMs: num(line['totalAPIDurationWithoutRetries']) ?? num(line['totalAPIDuration']),
    toolDurationMs: num(line['totalToolDuration']),
    linesAdded: int(line['totalLinesAdded']),
    linesRemoved: int(line['totalLinesRemoved']),
    startTime: timestamp(line['startTime']),
    modelUsage: usage,
  };
}
