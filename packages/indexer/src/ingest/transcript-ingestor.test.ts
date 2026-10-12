import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../db/connection.js';
import { migrate } from '../db/migrator.js';
import { CursorRepository } from '../db/repositories/cursor-repository.js';
import { DiagnosticsRepository } from '../db/repositories/diagnostics-repository.js';
import { MessageRepository } from '../db/repositories/message-repository.js';
import { ProjectRepository } from '../db/repositories/project-repository.js';
import { SessionRepository } from '../db/repositories/session-repository.js';
import { FakeClock } from '../ports/clock.js';
import { TranscriptIngestor, type IngestRequest } from './transcript-ingestor.js';
import { FakeFileSystem } from '../../../../test/support/fake-file-system.js';
import { TranscriptFactory } from '../../../../test/support/transcript-factory.js';

const SESSION = '00000000-0000-4000-8000-000000000001';
const PATH = '/Users/dev/.claude/projects/-Users-dev-proj/00000000-0000-4000-8000-000000000001.jsonl';

let db: Db;
let fs: FakeFileSystem;
let clock: FakeClock;
let ingestor: TranscriptIngestor;
let sessions: SessionRepository;
let messages: MessageRepository;
let request: IngestRequest;

beforeEach(() => {
  db = openDatabase({ path: ':memory:' });
  migrate(db);
  fs = new FakeFileSystem();
  clock = new FakeClock(1_000_000);

  const projects = new ProjectRepository(db);
  sessions = new SessionRepository(db);
  messages = new MessageRepository(db);

  const projectId = projects.ensure('/Users/dev/proj', '-Users-dev-proj', clock.now());

  ingestor = new TranscriptIngestor({
    db,
    fs,
    clock,
    cursors: new CursorRepository(db),
    sessions,
    messages,
    diagnostics: new DiagnosticsRepository(db),
    appVersion: '0.1.0-test',
  });

  request = {
    path: PATH,
    projectId,
    sessionId: SESSION,
    kind: 'interactive',
    cwd: '/Users/dev/proj',
    encodedDir: '-Users-dev-proj',
  };
});

const count = (sql: string, ...params: unknown[]): number =>
  (db.prepare<unknown[], { n: number }>(sql).get(...params)?.n ?? 0);

describe('TranscriptIngestor', () => {
  it('indexes a straightforward session', async () => {
    fs.write(
      PATH,
      new TranscriptFactory(SESSION)
        .prompt('Baue die Settings um')
        .assistant('Mache ich.')
        .title('Settings umbauen')
        .lastPrompt()
        .build(),
    );

    const outcome = await ingestor.ingest(request);
    expect(outcome.decodeErrors).toBe(0);
    expect(outcome.messagesInserted).toBe(2);

    const session = sessions.get(SESSION);
    expect(session?.title).toBe('Settings umbauen');
    expect(session?.indexState).toBe('complete');
    expect(session?.userPromptCount).toBe(1);
    expect(session?.assistantCount).toBe(1);
    expect(session?.models).toEqual(['claude-opus-5']);
  });

  it('counts only typed input as a user prompt', async () => {
    // Tool results use the user role too; without that distinction every session
    // would look like a conversation of hundreds of human turns.
    fs.write(
      PATH,
      new TranscriptFactory(SESSION)
        .prompt('Lauf die Tests')
        .toolUse('Bash', { command: 'npm test' }, 'ok')
        .assistant('Grün.')
        .build(),
    );
    await ingestor.ingest(request);

    expect(sessions.get(SESSION)?.userPromptCount).toBe(1);
    expect(count('SELECT count(*) AS n FROM message WHERE session_id = ? AND role = ?', SESSION, 'user')).toBe(2);
  });

  it('records a tool use with its summary and links the result back', async () => {
    fs.write(
      PATH,
      new TranscriptFactory(SESSION).prompt('x').toolUse('Bash', { command: 'git status' }, 'clean').build(),
    );
    await ingestor.ingest(request);

    const row = db
      .prepare<[], { name: string; input_summary: string; result_bytes: number | null }>(
        'SELECT name, input_summary, result_bytes FROM tool_use',
      )
      .get();
    expect(row?.name).toBe('Bash');
    expect(row?.input_summary).toBe('git status');
    expect(row?.result_bytes).toBe('clean'.length);
  });

  it('keeps prose searchable but leaves tool results out of the index', async () => {
    fs.write(
      PATH,
      new TranscriptFactory(SESSION)
        .prompt('Suche nach Pipelinefehlern')
        .toolUse('Bash', { command: 'grep -r geheim' }, 'GEHEIMER_TOOL_OUTPUT')
        .assistant('Nichts gefunden.')
        .build(),
    );
    await ingestor.ingest(request);

    const bodies = db.prepare<[], { body: string }>('SELECT body FROM message_text').all().map((r) => r.body);
    expect(bodies).toContain('Suche nach Pipelinefehlern');
    expect(bodies).toContain('Nichts gefunden.');
    // 126 MB of the corpus; tier 3 is opt-in per project.
    expect(bodies.join('\n')).not.toContain('GEHEIMER_TOOL_OUTPUT');
  });

  it('resumes from the stored offset instead of re-reading the file', async () => {
    const factory = new TranscriptFactory(SESSION).prompt('erste Frage').assistant('erste Antwort');
    fs.write(PATH, factory.build());
    const first = await ingestor.ingest(request);
    expect(first.messagesInserted).toBe(2);

    fs.append(PATH, new TranscriptFactory(SESSION).prompt('zweite Frage').build());
    const second = await ingestor.ingest(request);

    expect(second.messagesInserted).toBe(1);
    // The decisive property: the second pass must not read the first pass's bytes.
    expect(second.bytesRead).toBeLessThan(first.bytesRead);
    expect(sessions.get(SESSION)?.messageCount).toBe(3);
  });

  it('does nothing at all when nothing changed', async () => {
    fs.write(PATH, new TranscriptFactory(SESSION).prompt('a').build());
    await ingestor.ingest(request);
    const second = await ingestor.ingest(request);
    expect(second.skipped).toBe(true);
    expect(second.bytesRead).toBe(0);
  });

  it('leaves a half-written last line for the next pass', async () => {
    const factory = new TranscriptFactory(SESSION).prompt('fertig').assistant('auch fertig');
    fs.write(PATH, `${factory.build()}{"type":"user","uuid":"x","mess`);
    const first = await ingestor.ingest(request);
    expect(first.decodeErrors).toBe(0);
    expect(first.messagesInserted).toBe(2);

    // Completing the line makes it readable without any special handling.
    fs.write(
      PATH,
      `${factory.build()}${new TranscriptFactory('00000000-0000-4000-8000-000000000001').prompt('danach').build()}`,
    );
    const second = await ingestor.ingest(request);
    expect(second.decodeErrors).toBe(0);
    expect(sessions.get(SESSION)?.messageCount).toBe(3);
  });

  it('reindexes a transcript that was rewritten shorter', async () => {
    fs.write(PATH, new TranscriptFactory(SESSION).prompt('alt').assistant('alte Antwort').build());
    await ingestor.ingest(request);

    fs.write(PATH, new TranscriptFactory(SESSION).prompt('neu').build(), { newInode: true });
    await ingestor.ingest(request);

    expect(sessions.get(SESSION)?.messageCount).toBe(1);
    expect(count('SELECT count(*) AS n FROM message_text')).toBe(1);
  });

  it('archives a vanished transcript instead of deleting its rows', async () => {
    fs.write(PATH, new TranscriptFactory(SESSION).prompt('wichtig').assistant('Antwort').build());
    await ingestor.ingest(request);

    fs.remove(PATH);
    const outcome = await ingestor.ingest(request);

    expect(outcome.vanished).toBe(true);
    const session = sessions.get(SESSION);
    expect(session).not.toBeNull();
    expect(session?.filePresent).toBe(false);
    expect(session?.archivedAt).not.toBeNull();
    // The archive is the point: Claude Code prunes, CodeStation keeps.
    expect(count('SELECT count(*) AS n FROM message WHERE session_id = ?', SESSION)).toBe(2);
  });

  it('files an unknown record type and keeps indexing', async () => {
    fs.write(
      PATH,
      new TranscriptFactory(SESSION)
        .prompt('vorher')
        .unknownRecord('invented-next-year')
        .assistant('nachher')
        .build(),
    );
    const outcome = await ingestor.ingest(request);

    expect(outcome.unknownTypes).toEqual(['invented-next-year']);
    expect(outcome.messagesInserted).toBe(2);
    expect(count('SELECT count(*) AS n FROM unknown_record WHERE record_type = ?', 'invented-next-year')).toBe(1);
  });

  it('skips a corrupt line without abandoning the file', async () => {
    fs.write(
      PATH,
      new TranscriptFactory(SESSION)
        .prompt('eins')
        .raw('{ this is not json')
        .assistant('zwei')
        .build(),
    );
    const outcome = await ingestor.ingest(request);
    expect(outcome.decodeErrors).toBe(1);
    expect(outcome.messagesInserted).toBe(2);
  });

  it('prefers a user-set title over the generated one regardless of order', async () => {
    fs.write(
      PATH,
      new TranscriptFactory(SESSION)
        .prompt('x')
        .customTitle('Mein Name')
        .title('Automatisch erzeugter Titel')
        .build(),
    );
    await ingestor.ingest(request);
    expect(sessions.get(SESSION)?.title).toBe('Mein Name');
    expect(sessions.get(SESSION)?.titleSource).toBe('custom-title');
  });

  it('falls back to the first prompt when no title record exists', async () => {
    fs.write(PATH, new TranscriptFactory(SESSION).prompt('Richte die Pipeline ein').build());
    await ingestor.ingest(request);
    expect(sessions.get(SESSION)?.title).toBe('Richte die Pipeline ein');
    expect(sessions.get(SESSION)?.titleSource).toBe('first-prompt');
  });

  it('takes a cost-state figure only when it carries one', async () => {
    fs.write(PATH, new TranscriptFactory(SESSION).prompt('x').costState(0).build());
    await ingestor.ingest(request);
    // 91% of sessions have no usable figure; a zero must not masquerade as one.
    expect(sessions.get(SESSION)?.costSource).toBeNull();

    const other = '00000000-0000-4000-8000-000000000002';
    const otherPath = PATH.replace(SESSION, other);
    fs.write(otherPath, new TranscriptFactory(other).prompt('y').costState(21.36).build());
    await ingestor.ingest({ ...request, path: otherPath, sessionId: other });
    expect(sessions.get(other)?.costUsd).toBeCloseTo(21.36);
    expect(sessions.get(other)?.costSource).toBe('cost-state');
  });

  it('records which files a session touched, including plan files', async () => {
    fs.write(
      PATH,
      new TranscriptFactory(SESSION)
        .prompt('plane das')
        .fileHistoryDelta('/Users/dev/.claude/plans/mein-plan-lucky-pike.md')
        .build(),
    );
    await ingestor.ingest(request);
    const touch = db.prepare<[], { abs_path: string }>('SELECT abs_path FROM file_touch').get();
    expect(touch?.abs_path).toBe('/Users/dev/.claude/plans/mein-plan-lucky-pike.md');
  });

  it('stores byte offsets that point at the real line', async () => {
    const content = new TranscriptFactory(SESSION).prompt('Prüfung mit Ümlaut 🚀').assistant('ok').build();
    fs.write(PATH, content);
    await ingestor.ingest(request);

    const bytes = new TextEncoder().encode(content);
    const rows = db
      .prepare<[], { byte_offset: number; byte_length: number; uuid: string }>(
        'SELECT byte_offset, byte_length, uuid FROM message ORDER BY seq',
      )
      .all();
    for (const row of rows) {
      const slice = bytes.subarray(row.byte_offset, row.byte_offset + row.byte_length);
      const parsed = JSON.parse(new TextDecoder().decode(slice)) as { uuid: string };
      expect(parsed.uuid).toBe(row.uuid);
    }
  });

  it('marks the current conversation path and counts forks', async () => {
    const factory = new TranscriptFactory(SESSION).prompt('Ausgangsfrage');
    const branchPoint = factory.lastUuid();
    factory.assistant('Antwort A');
    factory.forkFrom(branchPoint).assistant('Antwort B');
    const leaf = factory.lastUuid();
    factory.lastPrompt(leaf);
    fs.write(PATH, factory.build());

    await ingestor.ingest(request);
    const tree = messages.tree(SESSION);

    expect(tree.forkPoints).toHaveLength(1);
    expect(tree.forkPoints[0]?.childUuids).toHaveLength(2);
    // The main path follows the resume pointer, so the abandoned branch is out.
    expect(tree.mainPath).toHaveLength(2);
  });

  it('keeps the chain intact across a record type it otherwise ignores', async () => {
    // 'system' records carry a uuid and sit between turns. The tree is defined
    // by uuid/parentUuid, not by record type, so anything with a uuid has to be
    // stored — otherwise every chain running through one is severed.
    const factory = new TranscriptFactory(SESSION);
    factory.prompt('Frage');
    const afterPrompt = factory.lastUuid();
    factory.raw(
      JSON.stringify({
        type: 'system',
        subtype: 'turn_duration',
        sessionId: SESSION,
        uuid: 'system-1',
        parentUuid: afterPrompt,
        durationMs: 1234,
      }),
    );
    factory.forkFrom('system-1').assistant('Antwort');
    factory.lastPrompt(factory.lastUuid());
    fs.write(PATH, factory.build());

    await ingestor.ingest(request);

    const tree = messages.tree(SESSION);
    expect(tree.danglingRoots).toEqual([]);
    expect(tree.mainPath).toHaveLength(3);
    expect(messages.page(SESSION, 0, 50, true).total).toBe(2);
  });

  it('keeps the chain intact across a record type it has never seen', async () => {
    const factory = new TranscriptFactory(SESSION);
    factory.prompt('Frage');
    const afterPrompt = factory.lastUuid();
    factory.raw(
      JSON.stringify({
        type: 'invented-next-year',
        sessionId: SESSION,
        uuid: 'future-1',
        parentUuid: afterPrompt,
      }),
    );
    factory.forkFrom('future-1').assistant('Antwort');
    factory.lastPrompt(factory.lastUuid());
    fs.write(PATH, factory.build());

    const outcome = await ingestor.ingest(request);
    expect(outcome.unknownTypes).toEqual(['invented-next-year']);
    // Unknown is not the same as unimportant: its position still matters.
    expect(messages.tree(SESSION).mainPath).toHaveLength(3);
  });

  it('keeps the conversation chain intact across attachment records', async () => {
    // Attachments carry their own uuid and parentUuid and sit between user and
    // assistant records. Dropping them used to sever the chain, which left the
    // current-conversation path empty and reported thousands of false
    // cross-file edges inside a single transcript.
    const factory = new TranscriptFactory(SESSION);
    factory.prompt('Frage');
    const afterPrompt = factory.lastUuid();
    factory.raw(
      JSON.stringify({
        type: 'attachment',
        sessionId: SESSION,
        uuid: 'attach-1',
        parentUuid: afterPrompt,
        timestamp: '2026-10-01T08:00:05.000Z',
        attachment: { type: 'total_tokens_reminder', text: '<total_tokens>12345 tokens left</total_tokens>' },
      }),
    );
    factory.forkFrom('attach-1').assistant('Antwort');
    factory.lastPrompt(factory.lastUuid());
    fs.write(PATH, factory.build());

    await ingestor.ingest(request);

    const tree = messages.tree(SESSION);
    expect(tree.danglingRoots).toEqual([]);
    // Prompt, attachment and answer are all on the current path.
    expect(tree.mainPath).toHaveLength(3);

    // But the reader only sees the two real messages.
    const page = messages.page(SESSION, 0, 50, true);
    expect(page.total).toBe(2);
    expect(page.items.every((item) => !item.isMeta)).toBe(true);
  });

  it('attaches the remaining context budget to the turn it was measured in', async () => {
    const factory = new TranscriptFactory(SESSION);
    factory.prompt('Frage');
    factory.raw(
      JSON.stringify({
        type: 'attachment',
        sessionId: SESSION,
        uuid: 'attach-2',
        parentUuid: factory.lastUuid(),
        attachment: { type: 'total_tokens_reminder', text: '<total_tokens>999 tokens left</total_tokens>' },
      }),
    );
    fs.write(PATH, factory.build());
    await ingestor.ingest(request);

    const page = messages.page(SESSION, 0, 50, false);
    expect(page.items[0]?.contextTokensLeft).toBe(999);
  });

  it('reports a conversation that began in another file', async () => {
    const factory = new TranscriptFactory(SESSION);
    factory.danglingRoot('uuid-from-a-previous-session').prompt('weiter gehts');
    fs.write(PATH, factory.build());

    await ingestor.ingest(request);
    const tree = messages.tree(SESSION);
    expect(tree.danglingRoots).toEqual(['uuid-from-a-previous-session']);
  });

  it('handles a transcript larger than one batch', async () => {
    const factory = new TranscriptFactory(SESSION);
    for (let i = 0; i < 1500; i += 1) factory.prompt(`Frage ${String(i)}`).assistant(`Antwort ${String(i)}`);
    fs.write(PATH, factory.build());

    const outcome = await ingestor.ingest(request);
    expect(outcome.messagesInserted).toBe(3000);
    expect(sessions.get(SESSION)?.messageCount).toBe(3000);
  });
});
