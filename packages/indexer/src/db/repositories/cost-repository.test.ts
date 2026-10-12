import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../connection.js';
import { migrate } from '../migrator.js';
import { CostRepository } from './cost-repository.js';
import { DiagnosticsRepository } from './diagnostics-repository.js';

let db: Db;
let costs: CostRepository;
let diagnostics: DiagnosticsRepository;

const addUsage = (sessionId: string, model: string, input: number, output: number, cacheRead = 0): void => {
  db.prepare(
    `INSERT INTO message (session_id, uuid, seq, byte_offset, byte_length, role, record_type, ts, model,
                          input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens)
     VALUES (?, ?, ?, 0, 10, 'assistant', 'assistant', 1700000000000, ?, ?, ?, ?, 0)`,
  ).run(sessionId, `u-${model}-${String(Math.random())}`, 1, model, input, output, cacheRead);
};

beforeEach(() => {
  db = openDatabase({ path: ':memory:' });
  migrate(db);
  db.exec(`
    INSERT INTO project (id, path, first_seen_at) VALUES (1, '/p', 0);
    INSERT INTO session (id, project_id, cwd, started_at, ended_at) VALUES ('s1', 1, '/p', 1700000000000, 1700000000000);
    INSERT INTO session (id, project_id, cwd, started_at, ended_at) VALUES ('s2', 1, '/p', 1700000000000, 1700000000000);
  `);
  diagnostics = new DiagnosticsRepository(db);
  costs = new CostRepository(db, diagnostics);
});

describe('CostRepository', () => {
  it('computes a cost from usage and the price table', () => {
    addUsage('s1', 'claude-opus-5', 1_000_000, 100_000);
    const result = costs.recomputeAll();
    expect(result.sessionsPriced).toBe(1);
    // 1M input at $5 + 100k output at $25/M = 5.00 + 2.50
    expect(costs.bySession('s1')[0]?.costUsd).toBeCloseTo(7.5, 6);
  });

  it('prices cache reads far below fresh input', () => {
    addUsage('s1', 'claude-sonnet-5', 0, 0, 1_000_000);
    costs.recomputeAll();
    expect(costs.bySession('s1')[0]?.costUsd).toBeCloseTo(0.2, 6);
  });

  it('produces no number at all for a model it has no price for', () => {
    // A confident 0.00 would be believed. Absent is the honest answer.
    addUsage('s2', 'claude-from-the-future', 1_000_000, 1_000_000);
    const result = costs.recomputeAll();
    expect(result.modelsWithoutPrice).toEqual(['claude-from-the-future']);
    expect(costs.bySession('s2')).toEqual([]);
    const session = db.prepare<[], { cost_usd: number | null }>("SELECT cost_usd FROM session WHERE id='s2'").get();
    expect(session?.cost_usd).toBeNull();
    expect(diagnostics.all().some((entry) => entry.key === 'price-missing:claude-from-the-future')).toBe(true);
  });

  it('does not overwrite a cost Claude Code recorded itself', () => {
    db.prepare("UPDATE session SET cost_usd = 42, cost_source = 'cost-state' WHERE id = 's1'").run();
    addUsage('s1', 'claude-opus-5', 1_000_000, 0);
    costs.recomputeAll();
    const session = db.prepare<[], { cost_usd: number; cost_source: string }>(
      "SELECT cost_usd, cost_source FROM session WHERE id='s1'",
    ).get();
    expect(session?.cost_usd).toBe(42);
    expect(session?.cost_source).toBe('cost-state');
  });

  it('splits a session across the models it actually used', () => {
    addUsage('s1', 'claude-opus-5', 1_000_000, 0);
    addUsage('s1', 'claude-haiku-4-5', 1_000_000, 0);
    costs.recomputeAll();
    const byModel = costs.bySession('s1');
    expect(byModel).toHaveLength(2);
    expect(byModel.find((c) => c.model === 'claude-opus-5')?.costUsd).toBeCloseTo(5, 6);
    expect(byModel.find((c) => c.model === 'claude-haiku-4-5')?.costUsd).toBeCloseTo(1, 6);
  });

  it('rolls costs up per day for the dashboard', () => {
    addUsage('s1', 'claude-opus-5', 1_000_000, 0);
    costs.recomputeAll();
    costs.rebuildDaily();
    const rows = db.prepare<[], { day: string; cost_usd: number }>('SELECT day, cost_usd FROM cost_daily').all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cost_usd).toBeCloseTo(5, 6);
  });

  it('attributes a session that ran over several days to each of them', () => {
    // Billing the whole session to the day it ended would misreport exactly the
    // number someone would act on.
    const day1 = Date.parse('2026-03-01T10:00:00Z');
    const day2 = Date.parse('2026-03-03T10:00:00Z');
    db.prepare(
      `INSERT INTO message (session_id, uuid, seq, byte_offset, byte_length, role, record_type, ts, model, input_tokens, output_tokens)
       VALUES ('s1','a',1,0,10,'assistant','assistant',?, 'claude-opus-5', 1000000, 0)`,
    ).run(day1);
    db.prepare(
      `INSERT INTO message (session_id, uuid, seq, byte_offset, byte_length, role, record_type, ts, model, input_tokens, output_tokens)
       VALUES ('s1','b',2,0,10,'assistant','assistant',?, 'claude-opus-5', 2000000, 0)`,
    ).run(day2);

    costs.recomputeAll();
    costs.rebuildDaily();

    const rows = db
      .prepare<[], { day: string; cost_usd: number }>('SELECT day, sum(cost_usd) AS cost_usd FROM cost_daily GROUP BY day ORDER BY day')
      .all();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.cost_usd).toBeCloseTo(5, 6);
    expect(rows[1]?.cost_usd).toBeCloseTo(10, 6);
  });
});
