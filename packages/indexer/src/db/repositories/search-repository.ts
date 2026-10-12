import {
  messageId as toMessageId,
  projectId as toProjectId,
  sessionId as toSessionId,
  SNIPPET_CLOSE,
  SNIPPET_OPEN,
  type Page,
  type SearchHit,
  type SearchQuery,
  type SearchScope,
} from '@cs/shared';
import type { Db } from '../connection.js';

interface HitRow {
  message_id: number | null;
  session_id: string | null;
  session_title: string | null;
  project_id: number | null;
  project_path: string | null;
  ts: number | null;
  snippet: string;
  score: number;
  is_user_prompt: number;
  role: string | null;
}

const DEFAULT_SCOPES: readonly SearchScope[] = ['prompts', 'assistant', 'tools', 'plans'];

/**
 * Normalises a user query into a safe FTS5 expression.
 *
 * Every term is quoted, so a stray '-', '*' or 'NEAR' in a search box is text
 * rather than an operator. 'ß' is folded to 'ss' because the unicode61
 * tokeniser folds umlauts but not the sharp s — doing it here keeps the
 * tokeniser configuration honest instead of papering over it.
 */
export function toMatchExpression(input: string): string | null {
  const normalised = input.toLowerCase().replaceAll('ß', 'ss').trim();
  if (normalised.length === 0) return null;

  const phrases = [...normalised.matchAll(/"([^"]+)"|(\S+)/g)]
    .map((match) => match[1] ?? match[2] ?? '')
    .map((term) => term.replace(/"/g, ''))
    .filter((term) => term.length > 0);

  if (phrases.length === 0) return null;
  return phrases.map((term) => `"${term}"`).join(' AND ');
}

export class SearchRepository {
  constructor(private readonly db: Db) {}

  search(query: SearchQuery): Page<SearchHit> {
    const expression = toMatchExpression(query.text);
    const limit = Math.min(query.limit ?? 50, 200);
    const offset = query.offset ?? 0;
    if (expression === null) return { items: [], total: 0, offset, limit };

    const scopes = new Set(query.scopes ?? DEFAULT_SCOPES);
    const hits = new Map<string, SearchHit>();

    if (scopes.has('prompts') || scopes.has('assistant')) {
      for (const row of this.#messageHits(expression, query, scopes)) {
        hits.set(`m:${String(row.messageId ?? 0)}`, row);
      }
      // The trigram index answers what unicode61 structurally cannot: paths and
      // identifiers like 'src/app' or 'handleFooBar'.
      for (const row of this.#messageHits(expression, query, scopes, true)) {
        const key = `m:${String(row.messageId ?? 0)}`;
        if (!hits.has(key)) hits.set(key, row);
      }
    }

    if (scopes.has('plans')) {
      for (const row of this.#planHits(expression, limit)) hits.set(`p:${row.snippet}`, row);
    }

    const all = [...hits.values()].sort((a, b) => b.score - a.score || (b.ts ?? 0) - (a.ts ?? 0));
    return { items: all.slice(offset, offset + limit), total: all.length, offset, limit };
  }

  #messageHits(
    expression: string,
    query: SearchQuery,
    scopes: ReadonlySet<SearchScope>,
    trigram = false,
  ): SearchHit[] {
    const table = trigram ? 'fts_message_tri' : 'fts_message';
    // Archiving means "out of my way", including here. Leaving archived
    // sessions searchable would make the action half-hearted and confusing.
    const where: string[] = ['s.archived = 0', 'p.archived = 0'];
    const values: unknown[] = [expression];

    if (query.projectId !== undefined) {
      where.push('s.project_id = ?');
      values.push(query.projectId);
    }
    if (query.sessionId !== undefined) {
      where.push('m.session_id = ?');
      values.push(query.sessionId);
    }
    if (query.since !== undefined) {
      where.push('m.ts >= ?');
      values.push(query.since);
    }
    if (query.until !== undefined) {
      where.push('m.ts <= ?');
      values.push(query.until);
    }
    const roles: string[] = [];
    if (scopes.has('prompts')) roles.push('m.is_user_prompt = 1');
    if (scopes.has('assistant')) roles.push("m.role = 'assistant'");
    if (roles.length > 0) where.push(`(${roles.join(' OR ')})`);

    const clause = where.length > 0 ? `AND ${where.join(' AND ')}` : '';

    const sql = `
      SELECT m.id AS message_id, m.session_id, s.title AS session_title,
             s.project_id, p.path AS project_path, m.ts,
             snippet(${table}, 0, '${SNIPPET_OPEN}', '${SNIPPET_CLOSE}', '…', 24) AS snippet,
             -bm25(${table}) AS score, m.is_user_prompt, m.role
      FROM ${table}
      JOIN message m ON m.id = ${table}.rowid
      JOIN session s ON s.id = m.session_id
      JOIN project p ON p.id = s.project_id
      WHERE ${table} MATCH ? ${clause}
      ORDER BY score DESC
      LIMIT 200`;

    return this.db
      .prepare<unknown[], HitRow>(sql)
      .all(...values)
      .map((row) => ({
        messageId: row.message_id === null ? null : toMessageId(row.message_id),
        sessionId: row.session_id === null ? null : toSessionId(row.session_id),
        sessionTitle: row.session_title ?? '(ohne Titel)',
        projectId: row.project_id === null ? null : toProjectId(row.project_id),
        projectPath: row.project_path ?? '',
        scope: row.is_user_prompt === 1 ? ('prompts' as const) : ('assistant' as const),
        ts: row.ts,
        snippet: row.snippet,
        // What a person is usually looking for is their own question, so a
        // typed prompt outranks an equally-scoring assistant paragraph.
        score: row.score + (row.is_user_prompt === 1 ? 1 : 0),
      }));
  }

  #planHits(expression: string, limit: number): SearchHit[] {
    const sql = `
      SELECT NULL AS message_id, NULL AS session_id, pl.title AS session_title,
             NULL AS project_id, pl.file_path AS project_path, pl.mtime AS ts,
             snippet(fts_plan, 1, '${SNIPPET_OPEN}', '${SNIPPET_CLOSE}', '…', 24) AS snippet,
             -bm25(fts_plan) AS score, 0 AS is_user_prompt, NULL AS role
      FROM fts_plan
      JOIN plan pl ON pl.rowid = fts_plan.rowid
      WHERE fts_plan MATCH ?
      ORDER BY score DESC LIMIT ?`;

    return this.db
      .prepare<unknown[], HitRow>(sql)
      .all(expression, limit)
      .map((row) => ({
        messageId: null,
        sessionId: null,
        sessionTitle: row.session_title ?? 'Plan',
        projectId: null,
        projectPath: row.project_path ?? '',
        scope: 'plans' as const,
        ts: row.ts,
        snippet: row.snippet,
        score: row.score,
      }));
  }
}
