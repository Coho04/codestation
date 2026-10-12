#!/usr/bin/env node
/**
 * Stand-in for the Claude CLI.
 *
 * The PTY layer is not faked in tests — the binary is. node-pty is rebuilt
 * against the Electron ABI and cannot be loaded from a plain Node test runner,
 * and a mocked PTY would prove nothing about the real spawn, resize and exit
 * paths. Since the binary path is configurable anyway (it has to be, for the
 * setup screen), pointing it here costs nothing and exercises the real code.
 *
 * Behaviour is driven by argv and CS_FAKE_* environment variables:
 *   --version            prints a version and exits
 *   agents --json --all  prints a session list and exits
 *   --session-id <uuid>  writes $HOME/.claude/sessions/<pid>.json, like the real CLI
 *   CS_FAKE_STATUS       status to publish (idle | busy | waiting)
 *   FLOOD <n> on stdin   write n lines of output as fast as possible
 *   CS_FAKE_EXIT=<code>  exit with that code instead of staying alive
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const argv = process.argv.slice(2);
const flag = (name) => {
  const at = argv.indexOf(name);
  return at === -1 ? null : (argv[at + 1] ?? null);
};

if (argv.includes('--version')) {
  process.stdout.write('2.1.277 (Claude Code)\n');
  process.exit(0);
}

if (argv[0] === 'agents') {
  process.stdout.write(
    JSON.stringify([
      {
        pid: process.pid,
        cwd: process.cwd(),
        kind: 'interactive',
        startedAt: Date.now(),
        sessionId: flag('--session-id') ?? randomUUID(),
        name: 'fake',
        status: 'idle',
      },
    ]) + '\n',
  );
  process.exit(0);
}

const sessionId = flag('--session-id') ?? randomUUID();
const name = flag('-n') ?? 'fake-session';
const status = process.env.CS_FAKE_STATUS ?? 'idle';

const sessionsDir = join(homedir(), '.claude', 'sessions');
mkdirSync(sessionsDir, { recursive: true });
writeFileSync(
  join(sessionsDir, `${process.pid}.json`),
  JSON.stringify({
    pid: process.pid,
    sessionId,
    cwd: process.cwd(),
    startedAt: Date.now(),
    procStart: 'Thu Oct  8 09:12:00 2026',
    version: '2.1.277',
    kind: 'interactive',
    entrypoint: 'cli',
    pidDomain: 'darwin',
    name,
    nameSource: 'derived',
    status,
    updatedAt: Date.now(),
    statusUpdatedAt: Date.now(),
    ...(status === 'waiting' ? { waitingFor: 'input needed' } : {}),
  }),
);

process.stdout.write(`fake-claude ready session=${sessionId} argv=${JSON.stringify(argv)}\r\n`);

const exitCode = process.env.CS_FAKE_EXIT;
if (exitCode !== undefined) process.exit(Number.parseInt(exitCode, 10));

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  const line = chunk.toString().replace(/[\r\n]+$/, '');
  const flood = /^FLOOD (\d+)$/.exec(line);
  if (flood !== null) {
    const count = Number.parseInt(flood[1], 10);
    for (let i = 0; i < count; i += 1) {
      process.stdout.write(`line ${i} ${'x'.repeat(120)}\r\n`);
    }
    process.stdout.write('FLOOD-DONE\r\n');
    return;
  }
  process.stdout.write(`echo:${line}\r\n`);
});
// Stay alive until killed, like an interactive session.
setInterval(() => {}, 1 << 30);
