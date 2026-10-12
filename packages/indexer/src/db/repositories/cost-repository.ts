import { projectId as toProjectId, type CostByModel, type DailyCost, type ProjectId } from '@cs/shared';
import type { Db } from '../connection.js';
import type { DiagnosticsRepository } from './diagnostics-repository.js';

interface PriceRow {
  model: string;
  input_per_mtok: number;
  output_per_mtok: number;
  cache_read_per_mtok: number;
  cache_write_5m_per_mtok: number;
}

const PER_MTOK = 1_000_000;

/**
 * Computes costs from token usage.
 *
 * Reading them off `cost-state` is not an option: 31 of 359 sessions have such a
 * record at all, and many of those report zero. Where a usable figure does
 * exist it wins, and the session is marked as sourced from it.
 *
 * A model with no price produces no number rather than a wrong one.
 */
export class CostRepository {
  constructor(
    private readonly db: Db,
    private readonly diagnostics: DiagnosticsRepository,
  ) {}

  #prices(): Map<string, PriceRow> {
    // The newest price per model that is already in effect. `GROUP BY ... HAVING
    // max(...)` would be accepted by SQLite and silently return the wrong row.
    const rows = this.db
      .prepare<[number, number], PriceRow>(
        `SELECT model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_5m_per_mtok
         FROM model_price mp
         WHERE effective_from <= ?
           AND effective_from = (
             SELECT max(effective_from) FROM model_price m2
             WHERE m2.model = mp.model AND m2.effective_from <= ?
           )`,
      )
      .all(Date.now(), Date.now());
    return new Map(rows.map((row) => [row.model, row]));
  }

  /** Rebuilds `cost_rollup` and the session-level totals from message usage. */
  recomputeAll(): { sessionsPriced: number; modelsWithoutPrice: string[] } {
    const prices = this.#prices();
    const missing = new Set<string>();

    const perModel = this.db
      .prepare<[], {
        session_id: string;
        model: string;
        input_tokens: number;
        output_tokens: number;
        cache_read_tokens: number;
        cache_creation_tokens: number;
      }>(
        `SELECT session_id, model,
                coalesce(sum(input_tokens), 0)  AS input_tokens,
                coalesce(sum(output_tokens), 0) AS output_tokens,
                coalesce(sum(cache_read_tokens), 0) AS cache_read_tokens,
                coalesce(sum(cache_creation_tokens), 0) AS cache_creation_tokens
         FROM message WHERE model IS NOT NULL GROUP BY session_id, model`,
      )
      .all();

    const upsert = this.db.prepare(`
      INSERT INTO cost_rollup (session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, source)
      VALUES (@sessionId, @model, @inputTokens, @outputTokens, @cacheReadTokens, @cacheCreationTokens, @costUsd, 'computed')
      ON CONFLICT(session_id, model) DO UPDATE SET
        input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
        cache_read_tokens = excluded.cache_read_tokens, cache_creation_tokens = excluded.cache_creation_tokens,
        cost_usd = excluded.cost_usd, source = excluded.source
    `);

    const sessionsPriced = new Set<string>();

    // Per-message cost, so a session spanning several days can be attributed to
    // the days it actually ran on rather than to the day it happened to end.
    const priceMessages = this.db.prepare(`
      UPDATE message SET cost_usd = (
        input_tokens * @input + output_tokens * @output
        + coalesce(cache_read_tokens, 0) * @cacheRead
        + coalesce(cache_creation_tokens, 0) * @cacheWrite
      ) / 1000000.0
      WHERE model = @model
    `);

    this.db.transaction(() => {
      for (const price of prices.values()) {
        priceMessages.run({
          model: price.model,
          input: price.input_per_mtok,
          output: price.output_per_mtok,
          cacheRead: price.cache_read_per_mtok,
          cacheWrite: price.cache_write_5m_per_mtok,
        });
      }

      for (const row of perModel) {
        const price = prices.get(row.model);
        if (price === undefined) {
          missing.add(row.model);
          continue;
        }
        const costUsd =
          (row.input_tokens * price.input_per_mtok +
            row.output_tokens * price.output_per_mtok +
            row.cache_read_tokens * price.cache_read_per_mtok +
            row.cache_creation_tokens * price.cache_write_5m_per_mtok) /
          PER_MTOK;

        upsert.run({
          sessionId: row.session_id,
          model: row.model,
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          cacheReadTokens: row.cache_read_tokens,
          cacheCreationTokens: row.cache_creation_tokens,
          costUsd,
        });
        sessionsPriced.add(row.session_id);
      }

      // A figure Claude Code recorded itself wins where it exists and is non-zero.
      this.db
        .prepare(
          `UPDATE session SET
             cost_usd = (SELECT sum(cost_usd) FROM cost_rollup WHERE session_id = session.id),
             cost_source = 'computed'
           WHERE cost_source IS NULL
             AND EXISTS (SELECT 1 FROM cost_rollup WHERE session_id = session.id)`,
        )
        .run();
    })();

    for (const model of missing) this.diagnostics.bump(`price-missing:${model}`);
    return { sessionsPriced: sessionsPriced.size, modelsWithoutPrice: [...missing] };
  }

  /**
   * Materialises the per-day table the dashboard reads.
   *
   * Aggregated from message timestamps, not from the session's end date: a
   * session that ran across three days would otherwise put all of its cost on
   * the last one, which is exactly the kind of number people act on.
   */
  rebuildDaily(): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM cost_daily').run();
      this.db
        .prepare(
          `INSERT INTO cost_daily (day, project_id, model, cost_usd, input_tokens, output_tokens, session_count)
           SELECT date(m.ts / 1000, 'unixepoch', 'localtime') AS day,
                  s.project_id, m.model,
                  sum(m.cost_usd), sum(m.input_tokens), sum(m.output_tokens), count(DISTINCT s.id)
           FROM message m JOIN session s ON s.id = m.session_id
           WHERE m.ts IS NOT NULL AND m.model IS NOT NULL AND m.cost_usd IS NOT NULL
           GROUP BY day, s.project_id, m.model`,
        )
        .run();
    })();
  }

  bySession(sessionId: string): CostByModel[] {
    return this.db
      .prepare<[string], {
        model: string;
        input_tokens: number;
        output_tokens: number;
        cache_read_tokens: number;
        cache_creation_tokens: number;
        cost_usd: number;
        source: string;
      }>('SELECT * FROM cost_rollup WHERE session_id = ? ORDER BY cost_usd DESC')
      .all(sessionId)
      .map((row) => ({
        model: row.model,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        cacheReadTokens: row.cache_read_tokens,
        cacheCreationTokens: row.cache_creation_tokens,
        costUsd: row.cost_usd,
        source: row.source as CostByModel['source'],
      }));
  }

  daily(days: number, projectId?: ProjectId): DailyCost[] {
    const where = projectId === undefined ? '' : 'AND project_id = ?';
    const values: unknown[] = projectId === undefined ? [] : [projectId];
    return this.db
      .prepare<unknown[], {
        day: string;
        project_id: number;
        model: string;
        cost_usd: number;
        input_tokens: number;
        output_tokens: number;
        session_count: number;
      }>(
        `SELECT * FROM cost_daily
         WHERE day >= date('now', 'localtime', ?) ${where}
         ORDER BY day DESC`,
      )
      .all(`-${String(days)} days`, ...values)
      .map((row) => ({
        day: row.day,
        projectId: toProjectId(row.project_id),
        model: row.model,
        costUsd: row.cost_usd,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        sessionCount: row.session_count,
      }));
  }
}
