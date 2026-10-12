#!/usr/bin/env node
/**
 * Dev orchestrator: Angular dev server + esbuild watchers + Electron.
 *
 * Replaces concurrently + wait-on + cross-env with ~90 lines, so the dev loop
 * has no dependencies of its own and the restart semantics are explicit:
 * a main/preload rebuild restarts Electron, a renderer change is hot-reloaded
 * by the Angular dev server and never touches Electron.
 */
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { context } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.CS_DEV_PORT ?? 4200);

const children = new Set();
let electron = null;
let shuttingDown = false;

function run(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

/**
 * The Angular dev server binds `localhost`, which on macOS resolves to `::1`
 * only — probing `127.0.0.1` would wait forever against a server that is up.
 * Both families are tried, and whichever answers first wins.
 */
function waitForPort(port, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  const hosts = ['::1', '127.0.0.1'];

  const tryOnce = () =>
    Promise.any(
      hosts.map(
        (host) =>
          new Promise((resolveHost, rejectHost) => {
            const socket = connect({ port, host });
            socket.once('connect', () => {
              socket.destroy();
              resolveHost(host);
            });
            socket.once('error', (error) => {
              socket.destroy();
              rejectHost(error);
            });
          }),
      ),
    );

  return new Promise((resolvePort, rejectPort) => {
    const attempt = () => {
      tryOnce().then(resolvePort, () => {
        if (Date.now() > deadline) rejectPort(new Error(`dev server on :${port} never came up`));
        else setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

function restartElectron() {
  if (shuttingDown) return;
  if (electron !== null) {
    electron.removeAllListeners('exit');
    electron.kill('SIGTERM');
  }
  electron = run(resolve(root, 'node_modules/.bin/electron'), ['.'], {
    env: { ...process.env, NODE_ENV: 'development', CS_DEV: '1', CS_DEV_PORT: String(PORT) },
  });
  electron.on('exit', (code) => {
    if (!shuttingDown) shutdown(code ?? 0);
  });
}

/** Rebuilds of main/preload must restart Electron; the first build only signals readiness. */
function restartOnRebuild(label) {
  let first = true;
  return {
    name: 'cs-restart',
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length > 0) {
          console.error(`[dev] ${label} build failed`);
          return;
        }
        if (first) {
          first = false;
          return;
        }
        console.log(`[dev] ${label} rebuilt — restarting Electron`);
        restartElectron();
      });
    },
  };
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 150);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const { options: mainOptions } = await import('../packages/main/esbuild.config.mjs');
const { options: preloadOptions } = await import('../packages/preload/esbuild.config.mjs');

const watchers = await Promise.all([
  context({ ...mainOptions, plugins: [restartOnRebuild('main')] }),
  context({ ...preloadOptions, plugins: [restartOnRebuild('preload')] }),
]);
await Promise.all(watchers.map((w) => w.watch()));

// Spawned directly rather than through `npm run --workspace`: npm turns our own
// SIGTERM on shutdown into a multi-line error dump on every Ctrl+C.
run(resolve(root, 'node_modules/.bin/ng'), ['serve', '--port', String(PORT)], {
  cwd: resolve(root, 'packages/renderer'),
});

console.log(`[dev] waiting for Angular dev server on :${PORT} …`);
await waitForPort(PORT);
console.log('[dev] dev server up — launching Electron');
restartElectron();
