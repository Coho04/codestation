import {
  projectId as toProjectId,
  sessionId as toSessionId,
  type IndexState,
  type Page,
  type ProjectId,
  type SessionDetail,
  type SessionId,
  type SessionKind,
  type SessionQuery,
  type SessionSummary,
  type TitleSource,
} from '@cs/shared';
import type { Db } from '../connection.js';

export interface SessionUpsert {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly transcriptPath: string | null;
  readonly encodedDir: string | null;
  readonly cwd: string;
  readonly kind: SessionKind;
}

interface SessionRow {
  id: string;
  project_id: number;
  project_path: string;
  transcript_path: string | null;
  encoded_dir: string | null;
  cwd: string;
  current_cwd: string | null;
  title: string | null;
  title_source: string;
  agent_name: string | null;
  started_at: number | null;
  ended_at: number | null;
  message_count: number;
  user_prompt_count: number;
  assistant_count: number;
  tool_use_count: number;
  git_branch: string | null;
  cc_version: string | null;
  entrypoint: string | null;
  models_json: string | null;
  leaf_uuid: string | null;
  root_uuid: string | null;
  continued_from_session: string | null;
  continued_from_uuid: string | null;
  kind: string;
  parent_session_id: string | null;
  spawn_tool_use_id: string | null;
  agent_type: string | null;
  worktree_path: string | null;
  pr_url: string | null;
  cost_usd: number | null;
  cost_source: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  lines_added: number;
  lines_removed: number;
  total_duration_ms: number | null;
  api_duration_ms: number | null;
  index_state: string;
  file_present: number;
  archived_at: number | null;
  archived: number;
}

/** Shared so the ingestor can resolve precedence inside a batch, too. */
export const TITLE_RANK: Readonly<Record<TitleSource, number>> = {
  'custom-title': 4,
  'ai-title': 3,
  'agent-name': 2,
  'first-prompt': 1,
  fallback: 0,
};

const SELECT_BASE = `
  SELECT s.*, p.path AS project_path
  FROM session s JOIN project p ON p.id = s.project_id
`;

export class SessionRepository {
  readonly #ensure;
  readonly #get;

  constructor(private readonly db: Db) {
    this.#ensure = db.prepare(`
      INSERT INTO session (id, project_id, transcript_path, encoded_dir, cwd, current_cwd, kind)
      VALUES (@id, @projectId, @transcriptPath, @encodedDir, @cwd, @cwd, @kind)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        transcript_path = coalesce(excluded.transcript_path, session.transcript_path),
        encoded_dir = coalesce(excluded.encoded_dir, session.encoded_dir),
        kind = excluded.kind,
        file_present = 1,
        archived_at = NULL
    `);
    this.#get = db.prepare<[string], SessionRow>(`${SELECT_BASE} WHERE s.id = ?`);
  }

  ensure(session: SessionUpsert): void {
    this.#ensure.run(session);
  }

  /**
   * Title precedence: a title the user set beats the one Claude generated, which
   * beats a subagent's name, which beats the first prompt. Within one rank the
   * later record wins, because 'ai-title' is rewritten on every turn.
   */
  setTitle(id: string, title: string, source: TitleSource): void {
    this.db
      .prepare(
        `UPDATE session SET title = ?, title_source = ?
         WHERE id = ? AND (title IS NULL OR ? >= CASE title_source
            WHEN 'custom-title' THEN 4 WHEN 'ai-title' THEN 3
            WHEN 'agent-name' THEN 2 WHEN 'first-prompt' THEN 1 ELSE 0 END)`,
      )
      .run(title, source, id, TITLE_RANK[source]);
  }

  patch(id: string, columns: Readonly<Record<string, unknown>>): void {
    const keys = Object.keys(columns);
    if (keys.length === 0) return;
    const sets = keys.map((key) => `${key} = ?`).join(', ');
    this.db
      .prepare(`UPDATE session SET ${sets} WHERE id = ?`)
      .run(...(keys.map((key) => columns[key]) as never[]), id);
  }

  setIndexState(id: string, state: IndexState, indexedAt: number): void {
    this.db.prepare('UPDATE session SET index_state = ?, indexed_at = ? WHERE id = ?').run(state, indexedAt, id);
  }

  setArchived(id: string, archived: boolean, at: number): void {
    this.db
      .prepare('UPDATE session SET archived = ?, user_archived_at = ? WHERE id = ?')
      .run(archived ? 1 : 0, archived ? at : null, id);
  }

  /** The caller writes a tombstone first, or the next sweep restores it. */
  forget(id: string): void {
    this.db.prepare('DELETE FROM session WHERE id = ?').run(id);
  }

  idsOfProject(projectId: number): string[] {
    return this.db
      .prepare<[number], { id: string }>('SELECT id FROM session WHERE project_id = ?')
      .all(projectId)
      .map((row) => row.id);
  }

  /** Never deletes on its own: Claude Code prunes its data, the archive outlives it. */
  markVanished(transcriptPath: string, at: number): void {
    this.db
      .prepare('UPDATE session SET file_present = 0, archived_at = coalesce(archived_at, ?) WHERE transcript_path = ?')
      .run(at, transcriptPath);
  }

  /** Recomputes counters from the message rows after an ingest pass. */
  refreshCounters(id: string): void {
    this.db
      .prepare(
        `UPDATE session SET
           message_count     = (SELECT count(*) FROM message WHERE session_id = ?),
           user_prompt_count = (SELECT count(*) FROM message WHERE session_id = ? AND is_user_prompt = 1),
           assistant_count   = (SELECT count(*) FROM message WHERE session_id = ? AND role = 'assistant'),
           tool_use_count    = (SELECT count(*) FROM tool_use WHERE session_id = ?),
           started_at        = coalesce(started_at, (SELECT min(ts) FROM message WHERE session_id = ? AND ts IS NOT NULL)),
           ended_at          = (SELECT max(ts) FROM message WHERE session_id = ? AND ts IS NOT NULL),
           input_tokens      = (SELECT coalesce(sum(input_tokens), 0) FROM message WHERE session_id = ?),
           output_tokens     = (SELECT coalesce(sum(output_tokens), 0) FROM message WHERE session_id = ?),
           cache_read_tokens = (SELECT coalesce(sum(cache_read_tokens), 0) FROM message WHERE session_id = ?),
           cache_creation_tokens = (SELECT coalesce(sum(cache_creation_tokens), 0) FROM message WHERE session_id = ?),
           models_json       = (SELECT json_group_array(DISTINCT model) FROM message WHERE session_id = ? AND model IS NOT NULL)
         WHERE id = ?`,
      )
      .run(id, id, id, id, id, id, id, id, id, id, id, id);
  }

  /** Falls back to the first human prompt when no title record was written. */
  applyFallbackTitle(id: string): void {
    this.db
      .prepare(
        `UPDATE session SET title = (
            SELECT substr(replace(coalesce(text_preview, ''), char(10), ' '), 1, 80)
            FROM message WHERE session_id = ? AND is_user_prompt = 1 ORDER BY seq LIMIT 1
          ), title_source = 'first-prompt'
         WHERE id = ? AND (title IS NULL OR title = '')`,
      )
      .run(id, id);
  }

  list(query: SessionQuery): Page<SessionSummary> {
    const where: string[] = [];
    const values: unknown[] = [];

    if (query.projectId !== undefined) {
      where.push('s.project_id = ?');
      values.push(query.projectId);
    }
    if (query.includeSubagents !== true) where.push("s.kind != 'subagent'");
    if (query.kinds !== undefined && query.kinds.length > 0) {
      where.push(`s.kind IN (${query.kinds.map(() => '?').join(',')})`);
      values.push(...query.kinds);
    }
    // Two independent axes: the user's own archive, and whether Claude Code
    // still has the transcript.
    if (query.onlyArchived === true) where.push('s.archived = 1');
    else if (query.includeArchived !== true) where.push('s.archived = 0');
    if (query.includeVanished !== true && query.onlyArchived !== true) {
      where.push('s.file_present = 1');
    }
    if (query.since !== undefined) {
      where.push('coalesce(s.ended_at, s.started_at) >= ?');
      values.push(query.since);
    }
    if (query.until !== undefined) {
      where.push('coalesce(s.ended_at, s.started_at) <= ?');
      values.push(query.until);
    }
    if (query.search !== undefined && query.search.length > 0) {
      where.push('(coalesce(s.title, "") LIKE ? OR s.cwd LIKE ?)');
      values.push(`%${query.search}%`, `%${query.search}%`);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const order = {
      recent: 'coalesce(s.ended_at, s.started_at) DESC NULLS LAST',
      oldest: 'coalesce(s.started_at, s.ended_at) ASC NULLS LAST',
      cost: 's.cost_usd DESC NULLS LAST',
      messages: 's.message_count DESC',
    }[query.sort ?? 'recent'];

    const total =
      this.db
        .prepare<unknown[], { n: number }>(
          `SELECT count(*) AS n FROM session s JOIN project p ON p.id = s.project_id ${clause}`,
        )
        .get(...values)?.n ?? 0;

    const limit = Math.min(query.limit ?? 100, 500);
    const offset = query.offset ?? 0;
    const rows = this.db
      .prepare<unknown[], SessionRow>(`${SELECT_BASE} ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...values, limit, offset);

    return { items: rows.map(toSummary), total, offset, limit };
  }

  get(id: string): SessionDetail | null {
    const row = this.#get.get(id);
    return row === undefined ? null : toDetail(row);
  }

  transcriptPathOf(id: string): string | null {
    return (
      this.db
        .prepare<[string], { transcript_path: string | null }>(
          'SELECT transcript_path FROM session WHERE id = ?',
        )
        .get(id)?.transcript_path ?? null
    );
  }
}

function toSummary(row: SessionRow): SessionSummary {
  return {
    id: toSessionId(row.id),
    projectId: toProjectId(row.project_id),
    projectPath: row.project_path,
    title: row.title ?? '(ohne Titel)',
    titleSource: row.title_source as TitleSource,
    kind: row.kind as SessionKind,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    userPromptCount: row.user_prompt_count,
    messageCount: row.message_count,
    gitBranch: row.git_branch,
    costUsd: row.cost_usd,
    indexState: row.index_state as IndexState,
    filePresent: row.file_present === 1,
    archived: row.archived === 1,
  };
}

function toDetail(row: SessionRow): SessionDetail {
  let models: string[] = [];
  try {
    const parsed: unknown = row.models_json === null ? [] : JSON.parse(row.models_json);
    if (Array.isArray(parsed)) models = parsed.filter((m): m is string => typeof m === 'string');
  } catch {
    models = [];
  }

  return {
    ...toSummary(row),
    cwd: row.cwd,
    currentCwd: row.current_cwd ?? row.cwd,
    transcriptPath: row.transcript_path,
    ccVersion: row.cc_version,
    entrypoint: row.entrypoint,
    models,
    toolUseCount: row.tool_use_count,
    assistantCount: row.assistant_count,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheCreationTokens: row.cache_creation_tokens,
    costSource: row.cost_source as SessionDetail['costSource'],
    linesAdded: row.lines_added,
    linesRemoved: row.lines_removed,
    totalDurationMs: row.total_duration_ms,
    apiDurationMs: row.api_duration_ms,
    leafUuid: row.leaf_uuid,
    rootUuid: row.root_uuid,
    continuedFrom:
      row.continued_from_session !== null && row.continued_from_uuid !== null
        ? { sessionId: toSessionId(row.continued_from_session), uuid: row.continued_from_uuid }
        : null,
    parentSessionId: row.parent_session_id === null ? null : toSessionId(row.parent_session_id),
    spawnToolUseId: row.spawn_tool_use_id,
    agentType: row.agent_type,
    worktreePath: row.worktree_path,
    prUrl: row.pr_url,
    archivedAt: row.archived_at,
  };
}

export type { SessionId };
