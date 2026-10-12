import { asObject, int, num, str, timestamp, type Json } from './field-readers.js';
import type { FileHistoryRecord } from './types.js';

/**
 * The only record that says which files a session touched — and the only hard
 * link from a session to a plan under ~/.claude/plans, via `trackingPath`.
 */
export function decodeFileHistoryDelta(line: Json): FileHistoryRecord | null {
  const trackingPath = str(line['trackingPath']);
  if (trackingPath === null) return null;
  const backup = asObject(line['backup']);
  return {
    kind: 'file-history',
    sessionId: str(line['sessionId']) ?? str(line['session_id']),
    trackingPath,
    version: num(backup['version']) === null ? null : int(backup['version']),
    backupFileName: str(backup['backupFileName']),
    ts: timestamp(line['timestamp']) ?? timestamp(backup['backupTime']),
  };
}
