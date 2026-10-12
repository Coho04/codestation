import { asObject, str, timestamp, type Json } from './records/field-readers.js';
import { decodeMessage } from './records/message.js';
import {
  decodeAgentName,
  decodeAiTitle,
  decodeBridgeSession,
  decodeCustomTitle,
  decodeLastPrompt,
  decodePrLink,
  decodeRelocated,
  decodeWorktreeState,
} from './records/session-meta.js';
import { decodeCostState } from './records/cost-state.js';
import { decodeFileHistoryDelta } from './records/file-history.js';
import { decodeAttachment } from './records/attachment.js';
import type { DecodedRecord } from './records/types.js';

export type RecordDecoder = (line: Json) => DecodedRecord | null;

/**
 * A registry, not a switch.
 *
 * Schema drift is not hypothetical: 28 record types exist on this machine,
 * six of which a careful survey of the same installation missed. An unknown
 * type therefore produces an `unknown` record — visible in diagnostics — and
 * never an exception that would abort a whole file.
 */
const DECODERS = new Map<string, RecordDecoder>([
  ['user', (line) => decodeMessage(line, 'user')],
  ['assistant', (line) => decodeMessage(line, 'assistant')],
  ['attachment', decodeAttachment],
  ['ai-title', decodeAiTitle],
  ['custom-title', decodeCustomTitle],
  ['agent-name', decodeAgentName],
  ['last-prompt', decodeLastPrompt],
  ['relocated', decodeRelocated],
  ['worktree-state', decodeWorktreeState],
  ['bridge-session', decodeBridgeSession],
  ['pr-link', decodePrLink],
  ['cost-state', decodeCostState],
  ['file-history-delta', decodeFileHistoryDelta],
]);

/**
 * Types we recognise and deliberately drop. Listing them keeps them out of the
 * unknown-record alarm, so that alarm only fires for genuinely new shapes.
 */
const IGNORED = new Set([
  'mode',
  'permission-mode',
  'atis-latch',
  'queue-operation',
  'file-history-snapshot',
  'system',
  'history-suppression',
  'frame-link',
  'artifact-autoreact-ledger',
  'artifact-comment-monitor',
  'summary',
]);

export interface DecodeOutcome {
  readonly record: DecodedRecord | null;
  readonly parseError: boolean;
}

/** The conversation tree is defined by these fields, whatever the record type. */
function chainPosition(line: Json): { uuid: string | null; parentUuid: string | null; ts: number | null } {
  return {
    uuid: str(line['uuid']),
    parentUuid: str(line['parentUuid']),
    ts: timestamp(line['timestamp']),
  };
}

export function decodeLine(text: string): DecodeOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // One bad line never aborts a file; it is counted and skipped.
    return { record: null, parseError: true };
  }

  const line = asObject(parsed);
  const type = str(line['type']);
  if (type === null) return { record: null, parseError: true };

  const decoder = DECODERS.get(type);
  if (decoder !== undefined) {
    const record = decoder(line);
    return {
      record: record ?? { kind: 'ignored', recordType: type, ...chainPosition(line) },
      parseError: false,
    };
  }

  if (IGNORED.has(type)) {
    return { record: { kind: 'ignored', recordType: type, ...chainPosition(line) }, parseError: false };
  }

  return {
    record: {
      kind: 'unknown',
      recordType: type,
      raw: text.length > 8192 ? `${text.slice(0, 8192)}…` : text,
      sessionId: str(line['sessionId']) ?? str(line['session_id']),
      ...chainPosition(line),
    },
    parseError: false,
  };
}

export const KNOWN_RECORD_TYPES: readonly string[] = [...DECODERS.keys(), ...IGNORED];
