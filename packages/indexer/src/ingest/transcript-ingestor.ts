import { basename } from 'node:path';
import type { ProjectId, SessionKind, TitleSource } from '@cs/shared';
import type { Db } from '../db/connection.js';
import type { CursorRepository } from '../db/repositories/cursor-repository.js';
import type { DiagnosticsRepository } from '../db/repositories/diagnostics-repository.js';
import type { MessageInsert, MessageRepository } from '../db/repositories/message-repository.js';
import { TITLE_RANK, type SessionRepository } from '../db/repositories/session-repository.js';
import type { ClockPort } from '../ports/clock.js';
import type { FileSystemPort } from '../ports/file-system.js';
import { decodeLine } from '../parsing/record-decoder.js';
import type { DecodedRecord } from '../parsing/records/types.js';
import { readJsonlLines, type ReadResult } from '../parsing/jsonl-line-reader.js';
import { decideCursor, HEAD_HASH_BYTES, initialCursor, type IngestCursor } from './file-cursor.js';

export interface IngestDeps {
  readonly db: Db;
  readonly fs: FileSystemPort;
  readonly clock: ClockPort;
  readonly cursors: CursorRepository;
  readonly sessions: SessionRepository;
  readonly messages: MessageRepository;
  readonly diagnostics: DiagnosticsRepository;
  readonly appVersion: string;
}

export interface IngestRequest {
  readonly path: string;
  readonly projectId: ProjectId;
  readonly sessionId: string;
  readonly kind: SessionKind;
  readonly cwd: string;
  readonly encodedDir: string | null;
}

export interface IngestOutcome {
  readonly linesRead: number;
  readonly messagesInserted: number;
  readonly bytesRead: number;
  readonly decodeErrors: number;
  readonly unknownTypes: readonly string[];
  readonly skipped: boolean;
  readonly vanished: boolean;
}

/** Flush thresholds — whichever comes first. */
const BATCH_LINES = 2000;
const BATCH_BYTES = 8 * 1024 * 1024;

interface Batch {
  messages: MessageInsert[];
  sessionPatch: Record<string, unknown>;
  title: { value: string; source: TitleSource } | null;
  fileTouches: { trackingPath: string; version: number | null; backup: string | null; ts: number }[];
  costState: DecodedRecord & { kind: 'cost-state' } | null;
  unknown: { type: string; raw: string; seq: number; ts: number | null }[];
  bytes: number;
}

const emptyBatch = (): Batch => ({
  messages: [],
  sessionPatch: {},
  title: null,
  fileTouches: [],
  costState: null,
  unknown: [],
  bytes: 0,
});

export class TranscriptIngestor {
  constructor(private readonly deps: IngestDeps) {}

  async ingest(request: IngestRequest, signal?: { cancelled: boolean }): Promise<IngestOutcome> {
    const { fs, cursors, sessions, messages, diagnostics, clock, db } = this.deps;

    const stat = await fs.stat(request.path);
    const existing = cursors.get(request.path);
    const decision = await decideCursor(existing, stat, () =>
      fs.sha256(request.path, HEAD_HASH_BYTES),
    );

    if (decision.kind === 'vanished') {
      // Never delete: Claude Code prunes its own transcripts and the archive is
      // meant to outlive them.
      db.transaction(() => {
        sessions.markVanished(request.path, clock.now());
        cursors.markVanished(request.path);
      })();
      return outcome({ vanished: true });
    }
    if (decision.kind === 'skip' || stat === null) return outcome({ skipped: true });

    let cursor: IngestCursor =
      existing ?? initialCursor(request.path, request.kind === 'subagent' ? 'subagent' : 'transcript');

    if (decision.kind === 'reindex') {
      db.transaction(() => {
        messages.deleteSessionMessages(request.sessionId);
      })();
      cursor = { ...initialCursor(request.path, cursor.kind), headSha256: cursor.headSha256 };
    }

    const startOffset = decision.kind === 'append' ? decision.from : 0;
    const startLine = decision.kind === 'append' ? decision.fromLine : 0;

    const headSha = await fs.sha256(request.path, HEAD_HASH_BYTES);

    sessions.ensure({
      id: request.sessionId,
      projectId: request.projectId,
      transcriptPath: request.path,
      encodedDir: request.encodedDir,
      cwd: request.cwd,
      kind: request.kind,
    });

    let batch = emptyBatch();
    let linesRead = 0;
    let inserted = 0;
    let decodeErrors = 0;
    const unknownTypes = new Set<string>();
    let readResult: ReadResult = { nextOffset: startOffset, nextLineNo: startLine, sawOversizedLine: false };

    const flush = (state: IngestCursor): void => {
      const toWrite = batch;
      batch = emptyBatch();
      db.transaction(() => {
        for (const message of toWrite.messages) {
          if (messages.insert(message) !== null) inserted += 1;
        }
        for (const touch of toWrite.fileTouches) {
          messages.insertFileTouch(
            request.sessionId,
            null,
            touch.trackingPath,
            touch.version,
            touch.backup,
            touch.ts,
          );
        }
        if (Object.keys(toWrite.sessionPatch).length > 0) {
          sessions.patch(request.sessionId, toWrite.sessionPatch);
        }
        if (toWrite.title !== null) {
          sessions.setTitle(request.sessionId, toWrite.title.value, toWrite.title.source);
        }
        if (toWrite.costState !== null) applyCostState(sessions, request.sessionId, toWrite.costState);
        for (const record of toWrite.unknown) {
          diagnostics.recordUnknown(
            record.type,
            record.raw,
            request.sessionId,
            record.seq,
            record.ts,
            this.deps.appVersion,
          );
        }
        // Written in the same transaction as the rows it describes: that is what
        // makes a kill -9 resumable rather than merely restartable.
        cursors.save(state, null, clock.now());
      })();
    };

    for await (const line of readJsonlLines(
      fs.readStream(request.path, startOffset),
      startOffset,
      startLine,
      (result) => (readResult = result),
    )) {
      linesRead += 1;
      batch.bytes += line.byteLength;

      const { record, parseError } = decodeLine(line.text);
      if (parseError) {
        decodeErrors += 1;
        diagnostics.bump('decode-error');
      } else if (record !== null) {
        this.#absorb(batch, record, request, line.byteOffset, line.byteLength, line.lineNo);
        if (record.kind === 'unknown') unknownTypes.add(record.recordType);
      }

      if (batch.messages.length >= BATCH_LINES || batch.bytes >= BATCH_BYTES) {
        flush({
          ...cursor,
          byteOffset: line.byteOffset + line.byteLength,
          lineNo: line.lineNo + 1,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          inode: stat.inode,
          headSha256: headSha,
          state: 'partial',
        });
        // Let queued RPC calls run; an import must not freeze the UI.
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (signal?.cancelled === true) {
          return outcome({ linesRead, inserted, decodeErrors, unknownTypes, bytes: batch.bytes });
        }
      }
    }

    flush({
      ...cursor,
      byteOffset: readResult.nextOffset,
      lineNo: readResult.nextLineNo,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      inode: stat.inode,
      headSha256: headSha,
      state: 'complete',
    });

    db.transaction(() => {
      sessions.refreshCounters(request.sessionId);
      sessions.applyFallbackTitle(request.sessionId);
      const leaf = (
        db
          .prepare<[string], { leaf_uuid: string | null }>('SELECT leaf_uuid FROM session WHERE id = ?')
          .get(request.sessionId)
      )?.leaf_uuid ?? null;
      messages.recomputeMainPath(request.sessionId, leaf);
      sessions.setIndexState(request.sessionId, 'complete', clock.now());
    })();

    return outcome({
      linesRead,
      inserted,
      decodeErrors,
      unknownTypes,
      bytes: readResult.nextOffset - startOffset,
    });
  }

  #absorb(
    batch: Batch,
    record: DecodedRecord,
    request: IngestRequest,
    byteOffset: number,
    byteLength: number,
    lineNo: number,
  ): void {
    switch (record.kind) {
      case 'message': {
        batch.messages.push({
          sessionId: request.sessionId,
          uuid: record.uuid.length > 0 ? record.uuid : `synthetic-${String(lineNo)}`,
          parentUuid: record.parentUuid,
          seq: lineNo,
          byteOffset,
          byteLength,
          role: record.role === 'system' ? 'system' : record.role,
          recordType: record.recordType,
          ts: record.ts,
          isMeta: record.isMeta,
          isSidechain: record.isSidechain,
          isUserPrompt: record.isUserPrompt,
          promptSource: record.promptSource,
          model: record.model,
          stopReason: record.stopReason,
          requestId: record.requestId,
          effort: record.effort,
          gitBranch: record.gitBranch,
          text: record.text,
          blocks: record.blocks,
          inputTokens: record.usage?.inputTokens ?? null,
          outputTokens: record.usage?.outputTokens ?? null,
          cacheReadTokens: record.usage?.cacheReadTokens ?? null,
          cacheCreationTokens: record.usage?.cacheCreationTokens ?? null,
          contextTokensLeft: null,
          toolResultFor: record.toolResultFor,
          // Tier 1: real prompts and assistant prose. Tool results (126 MB) stay
          // out unless the project opts into deep indexing.
          indexText: record.isUserPrompt || record.role === 'assistant',
        });
        if (record.gitBranch !== null) batch.sessionPatch['git_branch'] = record.gitBranch;
        if (record.ccVersion !== null) batch.sessionPatch['cc_version'] = record.ccVersion;
        if (record.entrypoint !== null) batch.sessionPatch['entrypoint'] = record.entrypoint;
        if (record.parentUuid === null && record.uuid.length > 0) {
          batch.sessionPatch['root_uuid'] = record.uuid;
        }
        break;
      }
      case 'session-meta': {
        // ai-title is rewritten every turn, so later wins; custom-title outranks
        // it regardless of order, which setTitle enforces.
        if (record.title !== undefined && record.titleSource !== undefined) {
          // A batch can contain several title records. Keeping only the last one
          // would let a per-turn 'ai-title' overwrite a title the user chose.
          const incoming = TITLE_RANK[record.titleSource];
          if (batch.title === null || incoming >= TITLE_RANK[batch.title.source]) {
            batch.title = { value: record.title, source: record.titleSource };
          }
          if (record.titleSource === 'agent-name') batch.sessionPatch['agent_name'] = record.title;
        }
        if (record.leafUuid !== undefined) batch.sessionPatch['leaf_uuid'] = record.leafUuid;
        if (record.relocatedCwd !== undefined) batch.sessionPatch['current_cwd'] = record.relocatedCwd;
        if (record.worktreePath !== undefined) batch.sessionPatch['worktree_path'] = record.worktreePath;
        if (record.bridgeSessionId !== undefined) {
          batch.sessionPatch['bridge_session_id'] = record.bridgeSessionId;
        }
        if (record.prUrl !== undefined) batch.sessionPatch['pr_url'] = record.prUrl;
        if (record.prNumber !== undefined) batch.sessionPatch['pr_number'] = record.prNumber;
        break;
      }
      case 'cost-state':
        batch.costState = record;
        break;
      case 'file-history':
        batch.fileTouches.push({
          trackingPath: record.trackingPath,
          version: record.version,
          backup: record.backupFileName,
          ts: record.ts ?? 0,
        });
        break;
      case 'attachment': {
        // Stored as a metadata node, never with its body. Skipping these would
        // break the parent chain wherever one sits between two messages, which
        // is most turns — the "current conversation" path would then be empty.
        if (record.uuid.length > 0) {
          batch.messages.push({
            sessionId: request.sessionId,
            uuid: record.uuid,
            parentUuid: record.parentUuid,
            seq: lineNo,
            byteOffset,
            byteLength,
            role: 'meta',
            recordType: `attachment:${record.attachmentType}`,
            ts: record.ts,
            isMeta: true,
            isSidechain: false,
            isUserPrompt: false,
            promptSource: null,
            model: null,
            stopReason: null,
            requestId: null,
            effort: null,
            gitBranch: null,
            text: '',
            blocks: [],
            inputTokens: null,
            outputTokens: null,
            cacheReadTokens: null,
            cacheCreationTokens: null,
            contextTokensLeft: record.contextTokensLeft,
            toolResultFor: null,
            indexText: false,
          });
        }
        // The remaining context budget belongs to the turn it was measured in.
        if (record.contextTokensLeft !== null) {
          for (let i = batch.messages.length - 2; i >= 0; i -= 1) {
            const candidate = batch.messages[i];
            if (candidate === undefined || candidate.isMeta) continue;
            batch.messages[i] = { ...candidate, contextTokensLeft: record.contextTokensLeft };
            break;
          }
        }
        break;
      }
      case 'unknown':
        batch.unknown.push({ type: record.recordType, raw: record.raw, seq: lineNo, ts: record.ts });
        pushChainNode(batch, request, record.uuid, record.parentUuid, record.ts, `unknown:${record.recordType}`, lineNo, byteOffset, byteLength);
        break;
      case 'ignored':
        // Carries nothing worth indexing, but if it has a uuid it is a node in
        // the conversation tree and must not be skipped.
        pushChainNode(batch, request, record.uuid, record.parentUuid, record.ts, record.recordType, lineNo, byteOffset, byteLength);
        break;
    }
  }
}

/** Stores a record that only matters for its place in the parent chain. */
function pushChainNode(
  batch: Batch,
  request: IngestRequest,
  uuid: string | null,
  parentUuid: string | null,
  ts: number | null,
  recordType: string,
  lineNo: number,
  byteOffset: number,
  byteLength: number,
): void {
  if (uuid === null || uuid.length === 0) return;
  batch.messages.push({
    sessionId: request.sessionId,
    uuid,
    parentUuid,
    seq: lineNo,
    byteOffset,
    byteLength,
    role: 'meta',
    recordType,
    ts,
    isMeta: true,
    isSidechain: false,
    isUserPrompt: false,
    promptSource: null,
    model: null,
    stopReason: null,
    requestId: null,
    effort: null,
    gitBranch: null,
    text: '',
    blocks: [],
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheCreationTokens: null,
    contextTokensLeft: null,
    toolResultFor: null,
    indexText: false,
  });
}

function applyCostState(
  sessions: SessionRepository,
  sessionId: string,
  record: DecodedRecord & { kind: 'cost-state' },
): void {
  const patch: Record<string, unknown> = {
    lines_added: record.linesAdded,
    lines_removed: record.linesRemoved,
    total_duration_ms: record.totalDurationMs,
    api_duration_ms: record.apiDurationMs,
    tool_duration_ms: record.toolDurationMs,
  };
  // Only trusted when it carries a figure: 31 of 359 sessions have one at all,
  // and many of those are zeroed. Computed costs fill the rest.
  if (record.totalCostUsd > 0) {
    patch['cost_usd'] = record.totalCostUsd;
    patch['cost_source'] = 'cost-state';
  }
  if (record.startTime !== null) patch['started_at'] = record.startTime;
  sessions.patch(sessionId, patch);
}

function outcome(partial: {
  linesRead?: number;
  inserted?: number;
  decodeErrors?: number;
  unknownTypes?: Set<string>;
  bytes?: number;
  skipped?: boolean;
  vanished?: boolean;
}): IngestOutcome {
  return {
    linesRead: partial.linesRead ?? 0,
    messagesInserted: partial.inserted ?? 0,
    bytesRead: partial.bytes ?? 0,
    decodeErrors: partial.decodeErrors ?? 0,
    unknownTypes: [...(partial.unknownTypes ?? [])],
    skipped: partial.skipped ?? false,
    vanished: partial.vanished ?? false,
  };
}

export const transcriptSessionId = (path: string): string => basename(path).replace(/\.jsonl$/, '');
