import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../db/connection.js';
import { migrate } from '../db/migrator.js';
import { FakeClock } from '../ports/clock.js';
import { LiveStatusService } from './live-status-service.js';
import type { CliAgent, CliProbePort, ProcessProbePort } from '../ports/process-probe.js';
import type { LiveSessionSource, SessionFileEntry } from './live-session-source.js';
import type { FileSystemPort } from '../ports/file-system.js';

const NOW = 1_800_000_000_000;

const fileEntry = (pid: number, sessionId: string): SessionFileEntry => ({
  pid,
  sessionId,
  cwd: '/p',
  name: `s-${sessionId}`,
  status: 'idle',
  waitingFor: null,
  startedAt: NOW - 10_000,
  statusUpdatedAt: NOW - 1000,
  procStart: 'Thu Oct  8 09:12:00 2026',
  version: '2.1.277',
});

const failedAgent = (sessionId: string): CliAgent => ({
  sessionId,
  cwd: '/p',
  kind: 'background',
  startedAt: NOW - 5000,
  name: `bg-${sessionId}`,
  pid: null,
  id: sessionId.slice(0, 8),
  status: null,
  state: 'failed',
  waitingFor: null,
});

class FakeCli implements CliProbePort {
  calls = 0;
  agents: readonly CliAgent[] | null = [];
  async listAgents(): Promise<readonly CliAgent[] | null> {
    this.calls += 1;
    return this.agents;
  }
}

const processes: ProcessProbePort = {
  probe: async (pids) => new Map(pids.map((pid) => [pid, 'Thu Oct  8 09:12:00 2026'])),
};

const fs = {
  stat: async () => ({ size: 1, mtimeMs: NOW - 1000, inode: '1:1', isDirectory: false }),
} as unknown as FileSystemPort;

let db: Db;
let clock: FakeClock;
let cli: FakeCli;
let service: LiveStatusService;

beforeEach(() => {
  db = openDatabase({ path: ':memory:' });
  migrate(db);
  clock = new FakeClock(NOW);
  cli = new FakeCli();

  const files: SessionFileEntry[] = [fileEntry(1, 'aaa'), fileEntry(2, 'bbb')];
  const sessionFiles = { read: async () => files } as unknown as LiveSessionSource;

  service = new LiveStatusService({ db, fs, clock, sessionFiles, processes, cli });
});

describe('LiveStatusService', () => {
  it('keeps background agents across a pass that skips the CLI', async () => {
    // The bug this guards: the CLI is polled every 15 s and the status files
    // every 5 s. Treating "do not poll" as "forget" made the dock badge
    // oscillate between the file-only count and the full one.
    cli.agents = [failedAgent('ccc'), failedAgent('ddd')];

    const withCli = await service.refresh({ useCli: true });
    expect(withCli).toHaveLength(4);

    const withoutCli = await service.refresh({ useCli: false });
    expect(withoutCli).toHaveLength(4);
    expect(cli.calls).toBe(1);

    const countNeedsYou = (list: readonly { attention: string }[]): number =>
      list.filter((entry) => entry.attention === 'needs-you').length;
    expect(countNeedsYou(withoutCli)).toBe(countNeedsYou(withCli));
  });

  it('keeps the previous answer when the CLI call fails', async () => {
    cli.agents = [failedAgent('ccc')];
    expect(await service.refresh({ useCli: true })).toHaveLength(3);

    // CLI unavailable — degrade, do not forget.
    cli.agents = null;
    expect(await service.refresh({ useCli: true })).toHaveLength(3);
  });

  it('drops a cached answer that has gone stale', async () => {
    cli.agents = [failedAgent('ccc')];
    expect(await service.refresh({ useCli: true })).toHaveLength(3);

    clock.advance(10 * 60_000);
    expect(await service.refresh({ useCli: false })).toHaveLength(2);
  });

  it('reflects an agent that the CLI no longer reports', async () => {
    cli.agents = [failedAgent('ccc')];
    expect(await service.refresh({ useCli: true })).toHaveLength(3);

    cli.agents = [];
    expect(await service.refresh({ useCli: true })).toHaveLength(2);
  });
});
