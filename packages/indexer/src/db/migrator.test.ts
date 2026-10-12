import { describe, expect, it } from 'vitest';
import { assertFts5, openDatabase } from './connection.js';
import { SchemaTooNewError, migrate } from './migrator.js';
import { LATEST_VERSION } from './migrations/index.js';

const fresh = () => openDatabase({ path: ':memory:' });

describe('migrator', () => {
  it('brings a fresh database to the latest version', () => {
    const db = fresh();
    const result = migrate(db);
    expect(result.from).toBe(0);
    expect(result.to).toBe(LATEST_VERSION);
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it('is idempotent', () => {
    const db = fresh();
    migrate(db);
    const second = migrate(db);
    expect(second.applied).toEqual([]);
    db.close();
  });

  it('refuses a database written by a newer build instead of corrupting it', () => {
    const db = fresh();
    migrate(db);
    db.pragma(`user_version = ${LATEST_VERSION + 5}`);
    expect(() => migrate(db)).toThrow(SchemaTooNewError);
    db.close();
  });

  it('creates the tables the ingest path writes to', () => {
    const db = fresh();
    migrate(db);
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    for (const table of [
      'project', 'session', 'message', 'message_text', 'tool_use',
      'cost_rollup', 'cost_daily', 'model_price', 'file_touch',
      'plan', 'plan_link', 'prompt_history', 'ingest_cursor',
      'unknown_record', 'diagnostics', 'meta',
    ]) {
      expect(names).toContain(table);
    }
    db.close();
  });

  it('has FTS5 available', () => {
    const db = fresh();
    expect(() => assertFts5(db)).not.toThrow();
    db.close();
  });

  it('does not make encoded_dir unique — the directory encoding collides', () => {
    // 'acme.de' and 'acme-de' both encode to '...-acme-de'. A unique index
    // here would reject the second project outright.
    const db = fresh();
    migrate(db);
    const insert = db.prepare(
      'INSERT INTO project (path, encoded_dir, first_seen_at) VALUES (?, ?, 0)',
    );
    insert.run('/Users/x/acme.de', '-Users-x-acme-de');
    expect(() => insert.run('/Users/x/acme-de', '-Users-x-acme-de')).not.toThrow();
    db.close();
  });

  it('keeps full-text rows in step with message_text through the triggers', () => {
    const db = fresh();
    migrate(db);
    db.exec(`
      INSERT INTO project (id, path, first_seen_at) VALUES (1, '/p', 0);
      INSERT INTO session (id, project_id, cwd) VALUES ('s1', 1, '/p');
      INSERT INTO message (id, session_id, uuid, seq, byte_offset, byte_length, role, record_type)
        VALUES (1, 's1', 'u1', 0, 0, 10, 'user', 'user');
      INSERT INTO message_text (message_id, body) VALUES (1, 'Prüfung der Pipeline');
    `);
    const hit = db
      .prepare("SELECT rowid FROM fts_message WHERE fts_message MATCH 'prufung'")
      .get() as { rowid: number } | undefined;
    // remove_diacritics folds ü→u, so the ASCII spelling finds the umlaut one.
    expect(hit?.rowid).toBe(1);

    db.prepare('DELETE FROM message_text WHERE message_id = 1').run();
    const after = db
      .prepare("SELECT count(*) AS n FROM fts_message WHERE fts_message MATCH 'prufung'")
      .get() as { n: number };
    expect(after.n).toBe(0);
    db.close();
  });

  it('finds code identifiers by substring through the trigram index', () => {
    const db = fresh();
    migrate(db);
    db.exec(`
      INSERT INTO project (id, path, first_seen_at) VALUES (1, '/p', 0);
      INSERT INTO session (id, project_id, cwd) VALUES ('s1', 1, '/p');
      INSERT INTO message (id, session_id, uuid, seq, byte_offset, byte_length, role, record_type)
        VALUES (1, 's1', 'u1', 0, 0, 10, 'assistant', 'assistant');
      INSERT INTO message_text (message_id, body) VALUES (1, 'siehe src/app/pane-host.ts und handleFooBar()');
    `);
    const byPath = db
      .prepare("SELECT count(*) AS n FROM fts_message_tri WHERE fts_message_tri MATCH '\"src/app\"'")
      .get() as { n: number };
    expect(byPath.n).toBe(1);
    const byIdent = db
      .prepare("SELECT count(*) AS n FROM fts_message_tri WHERE fts_message_tri MATCH '\"Foo\"'")
      .get() as { n: number };
    expect(byIdent.n).toBe(1);
    db.close();
  });
});
