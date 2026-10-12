import {
  emptyPage,

  type IndexApi,
  type MessageId,
  type PageSpec,
  type PlanId,
  type ProjectId,
  type ProjectPatch,
  type ProjectQuery,
  type SessionId,
  type SessionQuery,
  type SearchQuery,
} from '@cs/shared';
import type { Indexer } from '../composition-root.js';

/**
 * Thin: every method maps to one repository call. Anything that needed logic
 * here would be logic that belongs in a repository or a service, where it can
 * be tested without the RPC layer.
 */
export function createRequestHandlers(indexer: Indexer): IndexApi {
  const liveByProject = (): Map<number, { live: number; attention: number }> => {
    const counts = new Map<number, { live: number; attention: number }>();
    for (const session of indexer.live.current) {
      if (session.projectId === null) continue;
      if (session.attention === 'dead' || session.attention === 'stale') continue;
      const entry = counts.get(session.projectId) ?? { live: 0, attention: 0 };
      entry.live += 1;
      if (session.attention === 'needs-you') entry.attention += 1;
      counts.set(session.projectId, entry);
    }
    return counts;
  };

  return {
    listProjects: (query?: ProjectQuery) => {
      const counts = liveByProject();
      return Promise.resolve(
        indexer.projects.list(query).map((project) => ({
          ...project,
          liveSessionCount: counts.get(project.id)?.live ?? 0,
          needsAttentionCount: counts.get(project.id)?.attention ?? 0,
        })),
      );
    },

    getProject: (id: ProjectId) => Promise.resolve(indexer.projects.get(id)),

    patchProject: (id: ProjectId, patch: ProjectPatch) => {
      indexer.projects.patch(id, patch);
      return Promise.resolve(indexer.projects.get(id));
    },

    addProject: async (path: string) => {
      const exists = await indexer.fs.exists(path);
      if (!exists) return null;
      const id = indexer.projects.ensure(path, null, indexer.clock.now());
      indexer.projects.setPathExists(id, true);
      return indexer.projects.get(id);
    },

    listSessions: (query: SessionQuery) => Promise.resolve(indexer.sessions.list(query)),
    getSession: (id: SessionId) => Promise.resolve(indexer.sessions.get(id)),
    getSessionCosts: (id: SessionId) => Promise.resolve(indexer.costs.bySession(id)),

    getTranscript: (id: SessionId, page: PageSpec, mainPathOnly: boolean) =>
      Promise.resolve(
        indexer.messages.page(id, page.offset, Math.min(page.limit, 500), mainPathOnly),
      ),

    getSessionTree: (id: SessionId) => Promise.resolve(indexer.messages.tree(id)),

    getRawLine: async (id: SessionId, messageId: MessageId) => {
      const path = indexer.sessions.transcriptPathOf(id);
      const location = indexer.messages.locate(id, messageId);
      if (path === null || location === null) return null;
      // Seeks rather than reads: the largest transcript here is 83 MB.
      const bytes = await indexer.fs.readRange(path, location.offset, location.offset + location.length);
      return bytes === null ? null : new TextDecoder().decode(bytes);
    },

    getToolUses: (id: SessionId, page: PageSpec) => {
      const rows = indexer.db
        .prepare<[string, number, number], {
          session_id: string;
          message_id: number;
          tool_use_id: string;
          name: string;
          input_summary: string | null;
          target_path: string | null;
          result_bytes: number | null;
          result_is_error: number;
          ts: number | null;
        }>('SELECT * FROM tool_use WHERE session_id = ? ORDER BY ts, id LIMIT ? OFFSET ?')
        .all(id, page.limit, page.offset);
      const total =
        indexer.db
          .prepare<[string], { n: number }>('SELECT count(*) AS n FROM tool_use WHERE session_id = ?')
          .get(id)?.n ?? 0;
      return Promise.resolve({
        items: rows.map((row) => ({
          sessionId: id,
          messageId: row.message_id as unknown as MessageId,
          toolUseId: row.tool_use_id,
          name: row.name,
          inputSummary: row.input_summary ?? '',
          targetPath: row.target_path,
          resultBytes: row.result_bytes,
          resultIsError: row.result_is_error === 1,
          ts: row.ts,
        })),
        total,
        offset: page.offset,
        limit: page.limit,
      });
    },

    getToolResult: (id: SessionId, toolUseId: string) => indexer.toolResults.read(id, toolUseId),

    getFileTouches: (id: SessionId) =>
      Promise.resolve(
        indexer.db
          .prepare<[string], { abs_path: string; version: number | null; ts: number }>(
            'SELECT abs_path, version, ts FROM file_touch WHERE session_id = ? ORDER BY ts DESC',
          )
          .all(id)
          .map((row) => ({ sessionId: id, absPath: row.abs_path, version: row.version, ts: row.ts })),
      ),

    search: (query: SearchQuery) =>
      Promise.resolve(
        query.text.trim().length === 0
          ? emptyPage({ offset: query.offset ?? 0, limit: query.limit ?? 50 })
          : indexer.search.search(query),
      ),

    listPlans: () => Promise.resolve(indexer.plans.list()),
    getPlan: (id: PlanId) => Promise.resolve(indexer.plans.get(id)),

    getLiveSessions: () => Promise.resolve([...indexer.live.current]),
    getProgress: () => Promise.resolve(indexer.scheduler.progress),
    getDailyCosts: (days: number, projectId?: ProjectId) =>
      Promise.resolve(indexer.costs.daily(days, projectId)),

    setProjectArchived: (id: ProjectId, archived: boolean) => {
      indexer.projects.patch(id, { archived });
      return Promise.resolve(indexer.projects.get(id));
    },

    setSessionArchived: (id: SessionId, archived: boolean) => {
      indexer.sessions.setArchived(id, archived, indexer.clock.now());
      return Promise.resolve(indexer.sessions.get(id));
    },

    forgetProject: (id: ProjectId) => {
      const project = indexer.projects.get(id);
      if (project === null) return Promise.resolve();
      // Tombstone first, rows second: a crash in between leaves the path
      // forgotten but the data present, which the next sweep cleans up. The
      // other order would silently resurrect it.
      indexer.db.transaction(() => {
        indexer.tombstones.add({
          path: project.path,
          kind: 'project',
          label: project.displayName,
          sessionId: null,
          createdAt: indexer.clock.now(),
        });
        for (const sessionId of indexer.sessions.idsOfProject(id)) {
          const path = indexer.sessions.transcriptPathOf(sessionId);
          if (path !== null) indexer.cursors.remove(path);
          indexer.messages.deleteSessionMessages(sessionId);
        }
        if (project.encodedDir !== null) {
          indexer.cursors.removeUnder(indexer.home.projectDir(project.encodedDir));
        }
        indexer.projects.forget(id);
      })();
      return Promise.resolve();
    },

    forgetSession: (id: SessionId) => {
      const session = indexer.sessions.get(id);
      if (session === null) return Promise.resolve();
      indexer.db.transaction(() => {
        if (session.transcriptPath !== null) {
          indexer.tombstones.add({
            path: session.transcriptPath,
            kind: 'session',
            label: session.title,
            sessionId: id,
            createdAt: indexer.clock.now(),
          });
        }
        if (session.transcriptPath !== null) indexer.cursors.remove(session.transcriptPath);
        indexer.messages.deleteSessionMessages(id);
        indexer.sessions.forget(id);
      })();
      return Promise.resolve();
    },

    listTombstones: () =>
      Promise.resolve(
        indexer.tombstones.list().map((entry) => ({
          ...entry,
          sessionId: entry.sessionId === null ? null : (entry.sessionId as SessionId),
        })),
      ),

    restoreTombstone: async (path: string) => {
      indexer.tombstones.remove(path);
      // Re-index immediately; waiting out the sweep timer would make the button
      // look broken for up to a minute.
      await indexer.reconcile.run?.();
    },

    resolveProjectPaths: (id: ProjectId) => {
      const project = indexer.projects.get(id);
      if (project === null) return Promise.resolve(null);
      return Promise.resolve({
        projectId: id,
        label: project.displayName,
        projectPath: project.path,
        transcriptDir:
          project.encodedDir === null ? null : indexer.home.projectDir(project.encodedDir),
        sessionCount: project.sessionCount,
      });
    },

    resolveSessionPaths: (id: SessionId) => {
      const session = indexer.sessions.get(id);
      if (session === null) return Promise.resolve(null);
      const sidecar =
        session.transcriptPath === null
          ? null
          : session.transcriptPath.replace(/\.jsonl$/, '');
      return Promise.resolve({
        sessionId: id,
        label: session.title,
        transcriptPath: session.transcriptPath,
        sidecarDir: sidecar,
      });
    },

    rebuildIndex: async () => {
      // Everything derived is dropped; pins, names and groups live in `project`
      // and are deliberately untouched. A full rebuild is about a minute.
      indexer.scheduler.cancel();
      indexer.db.transaction(() => {
        indexer.db.exec('DELETE FROM message; DELETE FROM tool_use; DELETE FROM file_touch; DELETE FROM cost_rollup; DELETE FROM cost_daily;');
        indexer.cursors.resetAll();
        indexer.db.prepare("UPDATE session SET index_state = 'skeleton'").run();
      })();
      await indexer.scheduler.runFullImport();
    },

    refresh: async () => {
      await indexer.scheduler.runRegistryPhase(true);
    },
  } satisfies IndexApi & Record<string, (...args: never[]) => Promise<unknown>>;
}

