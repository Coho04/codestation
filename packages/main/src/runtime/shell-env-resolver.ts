import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { APP_NAME } from '@cs/shared';

const run = promisify(execFile);

export interface ResolvedEnv {
  readonly env: Readonly<Record<string, string>>;
  readonly shell: string;
  readonly warnings: readonly string[];
}

/** Variables that would make every `node` child start in Electron mode. */
const ELECTRON_POISON = [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'ELECTRON_FORCE_WINDOW_MENU_BAR',
  'NODE_OPTIONS',
];

/**
 * Reconstructs the environment a login shell would have.
 *
 * This is not optional on macOS: `/opt/homebrew/bin` comes from
 * `/etc/paths.d/homebrew`, which launchd does not apply to GUI-launched
 * applications. Without probing, a terminal inside the app would have a PATH
 * that has nothing the user installed.
 */
export class ShellEnvResolver {
  #cached: ResolvedEnv | null = null;

  async resolve(): Promise<ResolvedEnv> {
    if (this.#cached !== null) return this.#cached;

    const shell = process.env['SHELL'] ?? '/bin/zsh';
    const warnings: string[] = [];
    let env: Record<string, string> = {};

    try {
      // zsh behaves differently without a TTY, so an interactive login shell is
      // used; the marker separates rc-file chatter from the payload.
      const { stdout } = await run(shell, ['-l', '-i', '-c', 'echo __CS_ENV__; /usr/bin/env -0'], {
        timeout: 5000,
        maxBuffer: 2 * 1024 * 1024,
      });
      const payload = stdout.slice(stdout.indexOf('__CS_ENV__') + '__CS_ENV__'.length);
      for (const pair of payload.split('\0')) {
        const eq = pair.indexOf('=');
        if (eq <= 0) continue;
        env[pair.slice(0, eq).replace(/^\n/, '')] = pair.slice(eq + 1);
      }
    } catch {
      warnings.push(
        'Login-Shell konnte nicht gelesen werden — PATH ist möglicherweise unvollständig.',
      );
      env = { ...process.env } as Record<string, string>;
      env['PATH'] = `/opt/homebrew/bin:/usr/local/bin:${env['PATH'] ?? ''}`;
    }

    for (const key of ELECTRON_POISON) delete env[key];

    env['PATH'] = await stabilisePath(env['PATH'] ?? '', warnings);
    env['TERM'] = 'xterm-256color';
    env['COLORTERM'] = 'truecolor';
    env['TERM_PROGRAM'] = APP_NAME;
    env['HOME'] ??= homedir();

    this.#cached = { env, shell, warnings };
    return this.#cached;
  }

  invalidate(): void {
    this.#cached = null;
  }
}

/**
 * Removes fnm's per-shell directories from PATH.
 *
 * `~/.local/state/fnm_multishells/<pid>_<timestamp>/bin` belongs to the shell
 * that was probed and is cleaned up when it exits. Caching it produces a PATH
 * that works for a few hours and then reports "node: command not found" — a
 * failure that looks like anything but a stale cache. The default version is
 * resolved once instead, which is stable for the lifetime of the app.
 */
async function stabilisePath(path: string, warnings: string[]): Promise<string> {
  const parts = path.split(':').filter((part) => part.length > 0);
  const volatile = parts.filter((part) => part.includes('fnm_multishells'));
  if (volatile.length === 0) return parts.join(':');

  const stable = parts.filter((part) => !part.includes('fnm_multishells'));

  try {
    const { stdout } = await run(
      'fnm',
      ['exec', '--using=default', '--', 'node', '-e', 'process.stdout.write(process.execPath)'],
      { timeout: 5000, env: { ...process.env, PATH: stable.join(':') } },
    );
    const binDir = dirname(stdout.trim());
    if (binDir.length > 1) return [binDir, ...stable].join(':');
  } catch {
    warnings.push('fnm-Standardversion konnte nicht aufgelöst werden; node fehlt eventuell im PATH.');
  }

  return stable.join(':');
}
