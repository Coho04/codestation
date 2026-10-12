import type { ProjectDetail, ProjectId, ProjectPatch, ProjectQuery, ProjectSummary } from '@cs/shared';
import { projectId as toProjectId } from '@cs/shared';
import type { Db } from '../connection.js';
import { basename } from 'node:path';

interface ProjectRow {
  id: number;
  path: string;
  encoded_dir: string | null;
  display_name: string | null;
  group_name: string | null;
  pinned: number;
  archived: number;
  archived_at: number | null;
  in_registry: number;
  path_exists: number;
  first_seen_at: number;
  last_activity_at: number | null;
  session_count: number;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_lines_added: number;
  total_lines_removed: number;
  last_session_id: string | null;
  deep_indexed: number;
}

export class ProjectRepository {
  readonly #byPath;
  readonly #byId;
  readonly #insert;
  readonly #touchRegistry;

  constructor(private readonly db: Db) {
    this.#byPath = db.prepare<[string], ProjectRow>('SELECT * FROM project WHERE path = ?');
    this.#byId = db.prepare<[number], ProjectRow>('SELECT * FROM project WHERE id = ?');
    this.#insert = db.prepare(
      'INSERT INTO project (path, encoded_dir, first_seen_at, in_registry) VALUES (?, ?, ?, ?)',
    );
    this.#touchRegistry = db.prepare(
      'UPDATE project SET encoded_dir = coalesce(?, encoded_dir), in_registry = max(in_registry, ?), registry_json = coalesce(?, registry_json) WHERE id = ?',
    );
  }

  /**
   * The absolute cwd is the identity. `encodedDir` is stored only as a hint:
   * the directory encoding under ~/.claude/projects is not injective, so it can
   * never be used to look a project up.
   */
  ensure(path: string, encodedDir: string | null, now: number, inRegistry = false): ProjectId {
    const existing = this.#byPath.get(path);
    if (existing !== undefined) {
      if (encodedDir !== null || inRegistry) {
        this.#touchRegistry.run(encodedDir, inRegistry ? 1 : 0, null, existing.id);
      }
      return toProjectId(existing.id);
    }
    const info = this.#insert.run(path, encodedDir, now, inRegistry ? 1 : 0);
    return toProjectId(Number(info.lastInsertRowid));
  }

  setRegistryData(id: ProjectId, json: string, lastSessionId: string | null): void {
    this.db
      .prepare('UPDATE project SET registry_json = ?, in_registry = 1, last_session_id = ? WHERE id = ?')
      .run(json, lastSessionId, id);
  }

  setPathExists(id: ProjectId, exists: boolean): void {
    this.db.prepare('UPDATE project SET path_exists = ? WHERE id = ?').run(exists ? 1 : 0, id);
  }

  patch(id: ProjectId, patch: ProjectPatch): void {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.displayName !== undefined) {
      sets.push('display_name = ?');
      values.push(patch.displayName);
    }
    if (patch.group !== undefined) {
      sets.push('group_name = ?');
      values.push(patch.group);
    }
    if (patch.pinned !== undefined) {
      sets.push('pinned = ?');
      values.push(patch.pinned ? 1 : 0);
    }
    if (patch.archived !== undefined) {
      sets.push('archived = ?', 'archived_at = ?');
      values.push(patch.archived ? 1 : 0, patch.archived ? Date.now() : null);
    }
    if (patch.deepIndexed !== undefined) {
      sets.push('deep_indexed = ?');
      values.push(patch.deepIndexed ? 1 : 0);
    }
    if (sets.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE project SET ${sets.join(', ')} WHERE id = ?`).run(...(values as never[]));
  }

  /** Recomputes the denormalised columns that let the project list render join-free. */
  refreshAggregates(id: ProjectId): void {
    this.db
      .prepare(
        `UPDATE project SET
           session_count = (SELECT count(*) FROM session WHERE project_id = ? AND kind != 'subagent'),
           last_activity_at = (SELECT max(coalesce(ended_at, started_at)) FROM session WHERE project_id = ?),
           total_cost_usd = (SELECT coalesce(sum(cost_usd), 0) FROM session WHERE project_id = ?),
           total_input_tokens = (SELECT coalesce(sum(input_tokens), 0) FROM session WHERE project_id = ?),
           total_output_tokens = (SELECT coalesce(sum(output_tokens), 0) FROM session WHERE project_id = ?),
           total_lines_added = (SELECT coalesce(sum(lines_added), 0) FROM session WHERE project_id = ?),
           total_lines_removed = (SELECT coalesce(sum(lines_removed), 0) FROM session WHERE project_id = ?)
         WHERE id = ?`,
      )
      .run(id, id, id, id, id, id, id, id);
  }

  refreshAllAggregates(): void {
    for (const row of this.db.prepare<[], { id: number }>('SELECT id FROM project').all()) {
      this.refreshAggregates(toProjectId(row.id));
    }
  }

  list(query: ProjectQuery = {}): ProjectSummary[] {
    const where: string[] = [];
    const values: unknown[] = [];
    if (query.onlyArchived === true) where.push('archived = 1');
    else if (query.includeArchived !== true) where.push('archived = 0');
    if (query.search !== undefined && query.search.length > 0) {
      where.push('(path LIKE ? OR coalesce(display_name, "") LIKE ?)');
      values.push(`%${query.search}%`, `%${query.search}%`);
    }
    const sql = `SELECT * FROM project ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY pinned DESC, last_activity_at DESC NULLS LAST, path`;
    return this.db
      .prepare<unknown[], ProjectRow>(sql)
      .all(...values)
      .map((row) => toSummary(row));
  }

  get(id: ProjectId): ProjectDetail | null {
    const row = this.#byId.get(id);
    return row === undefined ? null : toDetail(row);
  }

  getByPath(path: string): ProjectDetail | null {
    const row = this.#byPath.get(path);
    return row === undefined ? null : toDetail(row);
  }

  pathOf(id: ProjectId): string | null {
    return this.#byId.get(id)?.path ?? null;
  }

  /**
   * Removes a project and everything derived from it.
   *
   * The caller writes a tombstone first; without one the next reconcile sweep
   * would bring all of it straight back.
   */
  forget(id: ProjectId): void {
    this.db.prepare('DELETE FROM project WHERE id = ?').run(id);
  }
}

function toSummary(row: ProjectRow): ProjectSummary {
  return {
    id: toProjectId(row.id),
    path: row.path,
    displayName: row.display_name ?? basename(row.path),
    group: row.group_name,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    pathExists: row.path_exists === 1,
    inRegistry: row.in_registry === 1,
    sessionCount: row.session_count,
    lastActivityAt: row.last_activity_at,
    totalCostUsd: row.total_cost_usd,
    // Filled in by the live-status service, which owns that knowledge.
    liveSessionCount: 0,
    needsAttentionCount: 0,
  };
}

function toDetail(row: ProjectRow): ProjectDetail {
  return {
    ...toSummary(row),
    encodedDir: row.encoded_dir,
    firstSeenAt: row.first_seen_at,
    lastSessionId: row.last_session_id === null ? null : (row.last_session_id as ProjectDetail['lastSessionId']),
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    totalLinesAdded: row.total_lines_added,
    totalLinesRemoved: row.total_lines_removed,
    deepIndexed: row.deep_indexed === 1,
  };
}
