import { asObject, str, timestamp, type Json } from './field-readers.js';
import type { AttachmentRecord } from './types.js';

const TOKENS_LEFT = /<total_tokens>\s*(\d+)\s*tokens left\s*<\/total_tokens>/i;

/**
 * 50 MB of attachment bodies across the corpus — skill listings, prompt
 * snapshots, token reminders. Exactly one number out of all of it is worth
 * keeping: how much context budget the turn had left.
 */
export function decodeAttachment(line: Json): AttachmentRecord {
  const attachment = asObject(line['attachment']);
  const type = str(attachment['type']) ?? 'unknown';

  let contextTokensLeft: number | null = null;
  if (type === 'total_tokens_reminder') {
    const text = str(attachment['text']) ?? '';
    const match = TOKENS_LEFT.exec(text);
    if (match?.[1] !== undefined) contextTokensLeft = Number.parseInt(match[1], 10);
  }

  return {
    kind: 'attachment',
    attachmentType: type,
    sessionId: str(line['sessionId']) ?? str(line['session_id']),
    uuid: str(line['uuid']) ?? '',
    parentUuid: str(line['parentUuid']),
    ts: timestamp(line['timestamp']),
    contextTokensLeft,
  };
}
