import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../connection.js';
import { migrate } from '../migrator.js';
import { SearchRepository, toMatchExpression } from './search-repository.js';

let db: Db;
let repo: SearchRepository;

const addMessage = (id: number, body: string, isPrompt: boolean, role = 'user'): void => {
  db.prepare(
    `INSERT INTO message (id, session_id, uuid, seq, byte_offset, byte_length, role, record_type, ts, is_user_prompt)
     VALUES (?, 's1', ?, ?, 0, 10, ?, ?, ?, ?)`,
  ).run(id, `u${String(id)}`, id, role, role, 1_700_000_000_000 + id, isPrompt ? 1 : 0);
  db.prepare('INSERT INTO message_text (message_id, body) VALUES (?, ?)').run(id, body);
};

beforeEach(() => {
  db = openDatabase({ path: ':memory:' });
  migrate(db);
  db.exec(`
    INSERT INTO project (id, path, first_seen_at) VALUES (1, '/Users/dev/proj', 0);
    INSERT INTO session (id, project_id, cwd, title) VALUES ('s1', 1, '/Users/dev/proj', 'Testsitzung');
  `);
  repo = new SearchRepository(db);
});

describe('toMatchExpression', () => {
  it('quotes every term so punctuation cannot act as an operator', () => {
    expect(toMatchExpression('foo -bar')).toBe('"foo" AND "-bar"');
    expect(toMatchExpression('NEAR OR AND')).toBe('"near" AND "or" AND "and"');
  });

  it('keeps an explicit phrase together', () => {
    expect(toMatchExpression('"src/app/pane" host')).toBe('"src/app/pane" AND "host"');
  });

  it('folds ß to ss, which the tokeniser does not do', () => {
    expect(toMatchExpression('Straße')).toBe('"strasse"');
  });

  it('rejects an empty query', () => {
    expect(toMatchExpression('   ')).toBeNull();
  });
});

describe('SearchRepository', () => {
  it('finds a German word written with an umlaut when searching without one', () => {
    addMessage(1, 'Die Prüfung der Pipeline schlug fehl', true);
    const hits = repo.search({ text: 'prufung' });
    expect(hits.items).toHaveLength(1);
    expect(hits.items[0]?.sessionTitle).toBe('Testsitzung');
  });

  it('finds a path fragment, which the word tokeniser alone cannot', () => {
    addMessage(2, 'siehe packages/renderer/src/app/shell.ts', false, 'assistant');
    const hits = repo.search({ text: '"src/app"' });
    expect(hits.items).toHaveLength(1);
  });

  it('finds an identifier by substring', () => {
    addMessage(3, 'die Funktion handleFooBar wirft', false, 'assistant');
    expect(repo.search({ text: '"FooBar"' }).items).toHaveLength(1);
  });

  it('ranks the user\'s own question above an equally matching answer', () => {
    addMessage(4, 'Wie konfiguriere ich den Indexer', true);
    addMessage(5, 'Wie konfiguriere ich den Indexer', false, 'assistant');
    const hits = repo.search({ text: 'indexer konfiguriere' });
    expect(hits.items[0]?.scope).toBe('prompts');
  });

  it('marks the match inside the snippet', () => {
    addMessage(6, 'ein Treffer mitten im Satz', true);
    const hit = repo.search({ text: 'treffer' }).items[0];
    expect(hit?.snippet).toContain('\u0002');
    expect(hit?.snippet).toContain('\u0003');
  });

  it('can be limited to one scope', () => {
    addMessage(7, 'gemeinsamer Begriff', true);
    addMessage(8, 'gemeinsamer Begriff', false, 'assistant');
    expect(repo.search({ text: 'gemeinsamer', scopes: ['prompts'] }).items).toHaveLength(1);
  });

  it('returns nothing for an empty query rather than everything', () => {
    addMessage(9, 'irgendwas', true);
    expect(repo.search({ text: '' }).items).toEqual([]);
  });

  it('excludes an archived session entirely', () => {
    // Archiving means "out of my way", including out of search. A half-hearted
    // version that still returns hits would be worse than none.
    addMessage(10, 'einmaliger Suchbegriff', true);
    expect(repo.search({ text: 'einmaliger' }).items).toHaveLength(1);

    db.prepare("UPDATE session SET archived = 1 WHERE id = 's1'").run();
    expect(repo.search({ text: 'einmaliger' }).items).toEqual([]);

    db.prepare("UPDATE session SET archived = 0 WHERE id = 's1'").run();
    expect(repo.search({ text: 'einmaliger' }).items).toHaveLength(1);
  });

  it('excludes every session of an archived project', () => {
    addMessage(11, 'projektweiter Begriff', true);
    db.prepare('UPDATE project SET archived = 1 WHERE id = 1').run();
    expect(repo.search({ text: 'projektweiter' }).items).toEqual([]);
  });

  it('does not match text that was never indexed', () => {
    // Tool results are tier 3 and stay out of message_text by default.
    expect(repo.search({ text: 'niemalsindiziert' }).items).toEqual([]);
  });
});
