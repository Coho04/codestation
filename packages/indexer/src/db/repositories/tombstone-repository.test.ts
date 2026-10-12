import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../connection.js';
import { migrate } from '../migrator.js';
import { TombstoneRepository } from './tombstone-repository.js';
import { CursorRepository } from './cursor-repository.js';

let db: Db;
let repo: TombstoneRepository;

beforeEach(() => {
  db = openDatabase({ path: ':memory:' });
  migrate(db);
  repo = new TombstoneRepository(db);
});

describe('TombstoneRepository', () => {
  it('remembers a forgotten path', () => {
    repo.add({ path: '/p/a.jsonl', kind: 'session', label: 'Alt', sessionId: 's1', createdAt: 10 });
    expect(repo.paths().has('/p/a.jsonl')).toBe(true);
    expect(repo.list()[0]?.label).toBe('Alt');
  });

  it('lets a path be taken back', () => {
    repo.add({ path: '/p/a.jsonl', kind: 'session', label: null, sessionId: null, createdAt: 10 });
    repo.remove('/p/a.jsonl');
    expect(repo.paths().size).toBe(0);
  });

  it('keeps one entry per path', () => {
    repo.add({ path: '/p/a.jsonl', kind: 'session', label: 'erst', sessionId: null, createdAt: 10 });
    repo.add({ path: '/p/a.jsonl', kind: 'session', label: 'dann', sessionId: null, createdAt: 20 });
    expect(repo.list()).toHaveLength(1);
    expect(repo.list()[0]?.label).toBe('dann');
  });

  it('lists the newest first', () => {
    repo.add({ path: '/a', kind: 'project', label: 'A', sessionId: null, createdAt: 10 });
    repo.add({ path: '/b', kind: 'project', label: 'B', sessionId: null, createdAt: 20 });
    expect(repo.list().map((t) => t.label)).toEqual(['B', 'A']);
  });
});

describe('forgetting and restoring', () => {
  it('drops the ingest cursor so a restored path is read again', () => {
    // Leaving the cursor behind makes the sweep see an unchanged file and skip
    // it forever — restoring the tombstone would then appear to do nothing.
    const cursors = new CursorRepository(db);
    cursors.save(
      {
        path: '/p/a.jsonl',
        kind: 'transcript',
        byteOffset: 100,
        lineNo: 5,
        size: 100,
        mtimeMs: 1,
        inode: '1:1',
        headSha256: 'x',
        state: 'complete',
        errorCount: 0,
      },
      null,
      0,
    );
    expect(cursors.get('/p/a.jsonl')).not.toBeNull();

    cursors.remove('/p/a.jsonl');
    expect(cursors.get('/p/a.jsonl')).toBeNull();
  });
});
