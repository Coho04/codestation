import { sql as init } from './0001_init.js';
import { sql as fts } from './0002_fts.js';
import { sql as pricing } from './0003_pricing.js';
import { sql as currentPrices } from './0004_current_prices.js';
import { sql as archive } from './0005_archive.js';

/**
 * Forward-only, numbered migrations applied in one transaction at startup.
 *
 * Each is classified. `derived` means the migration can be satisfied by wiping
 * and reindexing — which is the common case, because a full rebuild takes about
 * a minute and everything in those tables comes from files on disk. `preserving`
 * means it touches data the user created (pins, display names, groups) and must
 * actually migrate it.
 */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly kind: 'derived' | 'preserving';
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'init', kind: 'derived', sql: init },
  { version: 2, name: 'fts', kind: 'derived', sql: fts },
  { version: 3, name: 'pricing', kind: 'derived', sql: pricing },
  { version: 4, name: 'current-prices', kind: 'derived', sql: currentPrices },
  // 'preserving': the archive flags and tombstones are the user's own decisions
  // and cannot be re-derived from ~/.claude.
  { version: 5, name: 'archive', kind: 'preserving', sql: archive },
];

export const LATEST_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
