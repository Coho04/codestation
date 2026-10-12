import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProcessProbePort } from '../ports/process-probe.js';

const run = promisify(execFile);

/**
 * PID reuse is the only thing that can make a stale session file look alive, and
 * the only defence is comparing the process start time.
 *
 * `LC_ALL=C` and `TZ=UTC` are mandatory, not tidiness: without them macOS prints
 * "Do.  3 Sep. 09:35:35 2026" where Claude Code wrote "Thu Sep  3 07:35:35 2026"
 * — a different language *and* a different timezone. The comparison would then
 * fail for every process, and the app would silently report everything as dead.
 */
export class PsProcessProbe implements ProcessProbePort {
  async probe(pids: readonly number[]): Promise<ReadonlyMap<number, string>> {
    const result = new Map<number, string>();
    if (pids.length === 0) return result;

    try {
      const { stdout } = await run('ps', ['-o', 'pid=,lstart=', '-p', pids.join(',')], {
        env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
        timeout: 5000,
      });
      for (const line of stdout.split('\n')) {
        const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
        if (match?.[1] === undefined || match[2] === undefined) continue;
        result.set(Number.parseInt(match[1], 10), match[2]);
      }
    } catch {
      // A process that has exited makes `ps` exit non-zero; an empty map then
      // correctly means "none of these are alive".
    }
    return result;
  }
}
