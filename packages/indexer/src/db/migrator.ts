import { APP_NAME } from '@cs/shared';
import { LATEST_VERSION, MIGRATIONS } from './migrations/index.js';
import type { Db } from './connection.js';

export interface MigrationResult {
  readonly from: number;
  readonly to: number;
  readonly applied: readonly string[];
}

export class SchemaTooNewError extends Error {
  constructor(
    readonly found: number,
    readonly supported: number,
  ) {
    super(
      `index.db was written by a newer version of ${APP_NAME} (schema ${found}, this build supports ${supported})`,
    );
    this.name = 'SchemaTooNewError';
  }
}

/**
 * Applies pending migrations in a single transaction.
 *
 * Opening a database written by a *newer* build is refused rather than
 * attempted: a forward-only migrator cannot undo what it does not know about,
 * and corrupting the archive is worse than refusing to start.
 */
export function migrate(db: Db): MigrationResult {
  const current = Number((db.pragma('user_version', { simple: true }) as number | bigint) ?? 0);

  if (current > LATEST_VERSION) throw new SchemaTooNewError(current, LATEST_VERSION);
  if (current === LATEST_VERSION) return { from: current, to: current, applied: [] };

  const pending = MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  const applied: string[] = [];

  db.transaction(() => {
    for (const migration of pending) {
      db.exec(migration.sql);
      applied.push(`${String(migration.version).padStart(4, '0')}_${migration.name}`);
    }
    // Not parameterisable, and the value comes from our own constant list.
    db.pragma(`user_version = ${LATEST_VERSION}`);
  })();

  return { from: current, to: LATEST_VERSION, applied };
}
