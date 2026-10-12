import {
  messageId as toMessageId,
  sessionId as toSessionId,
  type ContentBlock,
  type MessageId,
  type MessageRole,
  type MessageRow,
  type SessionTree,
  type TranscriptPage,
  type TreeNode,
} from '@cs/shared';
import type { Db } from '../connection.js';
import type { NormalisedBlock } from '../../parsing/content-blocks.js';

export interface MessageInsert {
  readonly sessionId: string;
  readonly uuid: string;
  readonly parentUuid: string | null;
  readonly seq: number;
  readonly byteOffset: number;
  readonly byteLength: number;
  readonly role: MessageRole;
  readonly recordType: string;
  readonly ts: number | null;
  readonly isMeta: boolean;
  readonly isSidechain: boolean;
  readonly isUserPrompt: boolean;
  readonly promptSource: string | null;
  readonly model: string | null;
  readonly stopReason: string | null;
  readonly requestId: string | null;
  readonly effort: string | null;
  readonly gitBranch: string | null;
  readonly text: string;
  readonly blocks: readonly NormalisedBlock[];
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheCreationTokens: number | null;
  readonly contextTokensLeft: number | null;
  readonly toolResultFor: string | null;
  /** Whether this message's prose should be searchable (tier 1). */
  readonly indexText: boolean;
}

const PREVIEW_CHARS = 280;

interface DbMessageRow {
  id: number;
  session_id: string;
  uuid: string;
  parent_uuid: string | null;
  seq: number;
  role: string;
  record_type: string;
  ts: number | null;
  is_meta: number;
  is_user_prompt: number;
  on_main_path: number;
  child_count: number;
  model: string | null;
  stop_reason: string | null;
  git_branch: string | null;
  text_preview: string | null;
  blocks_json: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  context_tokens_left: number | null;
  byte_offset: number;
  byte_length: number;
}

export class MessageRepository {
  readonly #insert;
  readonly #insertText;
  readonly #insertToolUse;
  readonly #linkToolResult;
  readonly #insertFileTouch;

  constructor(private readonly db: Db) {
    this.#insert = db.prepare(`
      INSERT INTO message (
        session_id, uuid, parent_uuid, seq, byte_offset, byte_length, role, record_type, ts,
        is_meta, is_sidechain, is_user_prompt, prompt_source, model, stop_reason, request_id,
        effort, git_branch, text_preview, text_len, blocks_json,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        context_tokens_left, tool_result_for
      ) VALUES (
        @sessionId, @uuid, @parentUuid, @seq, @byteOffset, @byteLength, @role, @recordType, @ts,
        @isMeta, @isSidechain, @isUserPrompt, @promptSource, @model, @stopReason, @requestId,
        @effort, @gitBranch, @textPreview, @textLen, @blocksJson,
        @inputTokens, @outputTokens, @cacheReadTokens, @cacheCreationTokens,
        @contextTokensLeft, @toolResultFor
      )
      -- The safety net for the whole byte-offset scheme: re-reading a range is
      -- a no-op rather than a duplicate row.
      ON CONFLICT(session_id, uuid) DO NOTHING
    `);
    this.#insertText = db.prepare(
      'INSERT INTO message_text (message_id, body) VALUES (?, ?) ON CONFLICT(message_id) DO UPDATE SET body = excluded.body',
    );
    this.#insertToolUse = db.prepare(`
      INSERT INTO tool_use (session_id, message_id, tool_use_id, name, input_summary, target_path, input_bytes, ts)
      VALUES (@sessionId, @messageId, @toolUseId, @name, @inputSummary, @targetPath, @inputBytes, @ts)
      ON CONFLICT(session_id, tool_use_id) DO UPDATE SET
        message_id = excluded.message_id, input_summary = excluded.input_summary,
        target_path = excluded.target_path
    `);
    this.#linkToolResult = db.prepare(
      `UPDATE tool_use SET result_message_id = ?, result_bytes = ?, result_is_error = ?
       WHERE session_id = ? AND tool_use_id = ?`,
    );
    this.#insertFileTouch = db.prepare(
      `INSERT INTO file_touch (session_id, message_id, abs_path, tracking_path, version, backup_file_name, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
  }

  insert(message: MessageInsert): number | null {
    const preview = message.text.slice(0, PREVIEW_CHARS);
    const info = this.#insert.run({
      sessionId: message.sessionId,
      uuid: message.uuid,
      parentUuid: message.parentUuid,
      seq: message.seq,
      byteOffset: message.byteOffset,
      byteLength: message.byteLength,
      role: message.role,
      recordType: message.recordType,
      ts: message.ts,
      isMeta: message.isMeta ? 1 : 0,
      isSidechain: message.isSidechain ? 1 : 0,
      isUserPrompt: message.isUserPrompt ? 1 : 0,
      promptSource: message.promptSource,
      model: message.model,
      stopReason: message.stopReason,
      requestId: message.requestId,
      effort: message.effort,
      gitBranch: message.gitBranch,
      textPreview: preview,
      textLen: message.text.length,
      blocksJson: JSON.stringify(message.blocks.map(toPublicBlock)),
      inputTokens: message.inputTokens,
      outputTokens: message.outputTokens,
      cacheReadTokens: message.cacheReadTokens,
      cacheCreationTokens: message.cacheCreationTokens,
      contextTokensLeft: message.contextTokensLeft,
      toolResultFor: message.toolResultFor,
    });

    if (info.changes === 0) return null;
    const id = Number(info.lastInsertRowid);

    if (message.indexText && message.text.trim().length > 0) {
      this.#insertText.run(id, message.text);
    }

    for (const block of message.blocks) {
      if (block.kind === 'tool-use' && block.toolUseId !== null) {
        this.#insertToolUse.run({
          sessionId: message.sessionId,
          messageId: id,
          toolUseId: block.toolUseId,
          name: block.toolName ?? 'unknown',
          inputSummary: block.toolSummary,
          targetPath: block.targetPath,
          inputBytes: block.bytes,
          ts: message.ts,
        });
      } else if (block.kind === 'tool-result' && block.toolUseId !== null) {
        this.#linkToolResult.run(
          id,
          block.bytes,
          block.isError ? 1 : 0,
          message.sessionId,
          block.toolUseId,
        );
      }
    }

    return id;
  }

  insertFileTouch(
    sessionId: string,
    messageId: number | null,
    trackingPath: string,
    version: number | null,
    backupFileName: string | null,
    ts: number,
  ): void {
    this.#insertFileTouch.run(sessionId, messageId, trackingPath, trackingPath, version, backupFileName, ts);
  }

  deleteSessionMessages(sessionId: string): void {
    // message_text cascades, and its delete trigger keeps the FTS tables in step.
    this.db.prepare('DELETE FROM message WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM tool_use WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM file_touch WHERE session_id = ?').run(sessionId);
  }

  /**
   * Materialises the current conversation path.
   *
   * Walking parent links at query time would mean a recursive CTE on every
   * scroll; doing it once per leaf change turns "show me the conversation" into
   * an indexed lookup.
   */
  recomputeMainPath(sessionId: string, leafUuid: string | null): void {
    this.db.prepare('UPDATE message SET on_main_path = 0 WHERE session_id = ?').run(sessionId);

    const leaf =
      leafUuid ??
      this.db
        .prepare<[string], { uuid: string }>(
          'SELECT uuid FROM message WHERE session_id = ? ORDER BY seq DESC LIMIT 1',
        )
        .get(sessionId)?.uuid ??
      null;
    if (leaf === null) return;

    const parentOf = this.db.prepare<[string, string], { parent_uuid: string | null }>(
      'SELECT parent_uuid FROM message WHERE session_id = ? AND uuid = ?',
    );
    const mark = this.db.prepare('UPDATE message SET on_main_path = 1 WHERE session_id = ? AND uuid = ?');

    const seen = new Set<string>();
    let current: string | null = leaf;
    while (current !== null && !seen.has(current)) {
      seen.add(current);
      mark.run(sessionId, current);
      current = parentOf.get(sessionId, current)?.parent_uuid ?? null;
    }

    this.db
      .prepare(
        `UPDATE message SET child_count = (
           SELECT count(*) FROM message c WHERE c.session_id = message.session_id AND c.parent_uuid = message.uuid
         ) WHERE session_id = ?`,
      )
      .run(sessionId);
  }

  page(sessionId: string, offset: number, limit: number, mainPathOnly: boolean): TranscriptPage {
    // Metadata nodes (attachments) are stored so the parent chain stays intact,
    // but they are not part of the conversation a person reads.
    const filter = `AND is_meta = 0 ${mainPathOnly ? 'AND on_main_path = 1' : ''}`;
    const total =
      this.db
        .prepare<[string], { n: number }>(
          `SELECT count(*) AS n FROM message WHERE session_id = ? ${filter}`,
        )
        .get(sessionId)?.n ?? 0;

    const rows = this.db
      .prepare<[string, number, number], DbMessageRow>(
        `SELECT * FROM message WHERE session_id = ? ${filter} ORDER BY seq LIMIT ? OFFSET ?`,
      )
      .all(sessionId, limit, offset);

    return { sessionId: toSessionId(sessionId), items: rows.map(toMessageRow), total, offset, limit };
  }

  locate(sessionId: string, messageId: number): { offset: number; length: number } | null {
    const row = this.db
      .prepare<[string, number], { byte_offset: number; byte_length: number }>(
        'SELECT byte_offset, byte_length FROM message WHERE session_id = ? AND id = ?',
      )
      .get(sessionId, messageId);
    return row === undefined ? null : { offset: row.byte_offset, length: row.byte_length };
  }

  tree(sessionId: string): SessionTree {
    const rows = this.db
      .prepare<[string], DbMessageRow>(
        'SELECT * FROM message WHERE session_id = ? ORDER BY seq',
      )
      .all(sessionId);

    const nodes: TreeNode[] = rows.map((row) => ({
      id: toMessageId(row.id),
      uuid: row.uuid,
      parentUuid: row.parent_uuid,
      seq: row.seq,
      role: row.role as MessageRole,
      ts: row.ts,
      preview: row.text_preview ?? '',
      childCount: row.child_count,
    }));

    const byUuid = new Map(rows.map((row) => [row.uuid, row]));
    const present = new Set(byUuid.keys());

    const childrenOf = new Map<string, string[]>();
    const dangling = new Set<string>();
    for (const row of rows) {
      if (row.parent_uuid === null) continue;
      if (!present.has(row.parent_uuid)) {
        // The conversation began in another file — a resume or a compaction.
        dangling.add(row.parent_uuid);
        continue;
      }
      const siblings = childrenOf.get(row.parent_uuid) ?? [];
      siblings.push(row.uuid);
      childrenOf.set(row.parent_uuid, siblings);
    }

    const mainPath = rows.filter((row) => row.on_main_path === 1).map((row) => toMessageId(row.id));
    const forkPoints = [...childrenOf.entries()]
      .filter(([, children]) => children.length > 1)
      .map(([uuid, childUuids]) => ({ uuid, childUuids }));

    const subagents = this.db
      .prepare<[string], { id: string; spawn_tool_use_id: string | null; agent_type: string | null; spawn_depth: number | null }>(
        'SELECT id, spawn_tool_use_id, agent_type, spawn_depth FROM session WHERE parent_session_id = ?',
      )
      .all(sessionId)
      .map((row) => ({
        sessionId: toSessionId(row.id),
        toolUseId: row.spawn_tool_use_id ?? '',
        agentType: row.agent_type ?? 'unknown',
        spawnDepth: row.spawn_depth ?? 1,
      }));

    return {
      nodes,
      mainPath: mainPath.length > 0 ? mainPath : fallbackPath(rows),
      forkPoints,
      danglingRoots: [...dangling],
      subagents,
    };
  }
}

/**
 * Before `recomputeMainPath` has run (a session still in skeleton state), the
 * flag is unset on every row. Falling back to file order is better than showing
 * an empty conversation, and it is what the order would be anyway in the common
 * case of a transcript without forks.
 */
function fallbackPath(rows: readonly DbMessageRow[]): MessageId[] {
  return rows.map((row) => toMessageId(row.id));
}

function toMessageRow(row: DbMessageRow): MessageRow {
  let blocks: ContentBlock[] = [];
  try {
    const parsed: unknown = row.blocks_json === null ? [] : JSON.parse(row.blocks_json);
    if (Array.isArray(parsed)) blocks = parsed as ContentBlock[];
  } catch {
    blocks = [];
  }

  return {
    id: toMessageId(row.id),
    sessionId: toSessionId(row.session_id),
    uuid: row.uuid,
    parentUuid: row.parent_uuid,
    seq: row.seq,
    role: row.role as MessageRole,
    recordType: row.record_type,
    ts: row.ts,
    isUserPrompt: row.is_user_prompt === 1,
    isMeta: row.is_meta === 1,
    onMainPath: row.on_main_path === 1,
    childCount: row.child_count,
    model: row.model,
    stopReason: row.stop_reason,
    gitBranch: row.git_branch,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: row.cost_usd,
    contextTokensLeft: row.context_tokens_left,
    blocks,
  };
}

const TEXT_BLOCK_CAP = 8192;

/** What the renderer gets: prose capped, thinking reduced to a marker. */
function toPublicBlock(block: NormalisedBlock): ContentBlock {
  switch (block.kind) {
    case 'text':
      return {
        kind: 'text',
        text: block.text.slice(0, TEXT_BLOCK_CAP),
        truncated: block.text.length > TEXT_BLOCK_CAP,
      };
    case 'tool-use':
      return {
        kind: 'tool-use',
        toolUseId: block.toolUseId ?? '',
        name: block.toolName ?? 'unknown',
        summary: block.toolSummary ?? '',
        targetPath: block.targetPath,
      };
    case 'tool-result':
      return {
        kind: 'tool-result',
        toolUseId: block.toolUseId ?? '',
        bytes: block.bytes,
        isError: block.isError,
        preview: block.text.slice(0, TEXT_BLOCK_CAP),
        truncated: block.text.length > TEXT_BLOCK_CAP,
      };
    case 'thinking':
      return { kind: 'thinking-elided', signatureBytes: block.signatureBytes };
    case 'image':
    case 'other':
      return { kind: 'attachment', attachmentType: block.rawType };
  }
}
