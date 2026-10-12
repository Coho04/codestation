import { normaliseContent } from '../content-blocks.js';
import { asObject, bool, int, str, timestamp, type Json } from './field-readers.js';
import type { MessageRecord, UsageRecord } from './types.js';

export function decodeMessage(line: Json, recordType: 'user' | 'assistant'): MessageRecord {
  const message = asObject(line['message']);
  const content = normaliseContent(message['content']);
  const usage = decodeUsage(message['usage']);

  const toolResult = content.blocks.find((b) => b.kind === 'tool-result');

  return {
    kind: 'message',
    uuid: str(line['uuid']) ?? '',
    parentUuid: str(line['parentUuid']),
    sessionId: str(line['sessionId']) ?? str(line['session_id']),
    role: recordType,
    recordType,
    ts: timestamp(line['timestamp']),
    cwd: str(line['cwd']),
    gitBranch: str(line['gitBranch']),
    ccVersion: str(line['version']),
    entrypoint: str(line['entrypoint']),
    isMeta: bool(line['isMeta']),
    isSidechain: bool(line['isSidechain']),
    // A plain-string content is the mark of real human input. Only ~8% of
    // 'user' records qualify; the rest carry tool results under the same role.
    isUserPrompt: recordType === 'user' && content.isPlainString && !bool(line['isMeta']),
    promptSource: str(line['promptSource']),
    model: str(message['model']),
    stopReason: str(message['stop_reason']),
    requestId: str(line['requestId']),
    effort: str(line['effort']),
    text: content.text,
    blocks: content.blocks,
    usage,
    toolResultFor: toolResult?.toolUseId ?? null,
  };
}

export function decodeUsage(value: unknown): UsageRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const usage = value as Json;
  const serverToolUse = asObject(usage['server_tool_use']);
  return {
    inputTokens: int(usage['input_tokens']),
    outputTokens: int(usage['output_tokens']),
    cacheReadTokens: int(usage['cache_read_input_tokens']),
    cacheCreationTokens: int(usage['cache_creation_input_tokens']),
    webSearchRequests: int(serverToolUse['web_search_requests']),
  };
}
