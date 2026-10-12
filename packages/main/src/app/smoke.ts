import { app, type BrowserWindow } from 'electron';
import { APP_NAME } from '@cs/shared';

/**
 * Headful startup check for CI and for verifying a fresh checkout.
 *
 * CS_SMOKE=1 loads the page and calls through the context bridge. CS_SMOKE=index
 * additionally waits for the indexer to produce data and exercises the real
 * query path end to end — main, utility process, MessagePort, preload, renderer.
 * A build that compiles but cannot reach its own bridge, or an index that never
 * fills, is not a working build.
 */
export function installSmokeCheck(window: BrowserWindow): void {
  const mode = process.env['CS_SMOKE'];
  if (mode !== '1' && mode !== 'index' && mode !== 'pty' && mode !== 'notify') return;

  // Diagnoses the "no notification ever arrives" case: whether macOS accepts one
  // at all is a property of the signed bundle and its permission state, not of
  // any logic that could be unit-tested.
  if (mode === 'notify') {
    void import('electron').then(({ Notification, app: electronApp }) => {
      const supported = Notification.isSupported();
      if (!supported) {
        console.error('[smoke] FAIL notifications are not supported in this build');
        electronApp.exit(1);
        return;
      }
      console.log(`[smoke] userData=${electronApp.getPath('userData')}`);
      const notification = new Notification({
        title: APP_NAME,
        body: 'Testbenachrichtigung — wenn du das siehst, funktioniert der Weg zu macOS.',
      });
      notification.on('show', () => {
        console.log('[smoke] OK notification shown');
        setTimeout(() => electronApp.exit(0), 1500);
      });
      notification.on('failed', (_event, error) => {
        console.error(`[smoke] FAIL notification rejected: ${error}`);
        electronApp.exit(1);
      });
      notification.show();
      setTimeout(() => {
        console.error('[smoke] FAIL notification never reported being shown');
        electronApp.exit(1);
      }, 10_000);
    });
    return;
  }

  const deep = mode === 'index';
  const timeoutMs = deep ? 15 * 60_000 : 60_000;

  let settled = false;
  const settle = (code: number, line: string): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (code === 0) console.log(line);
    else console.error(line);
    app.exit(code);
  };

  const timer = setTimeout(
    () => settle(1, '[smoke] FAIL timed out'),
    timeoutMs,
  );

  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    settle(1, `[smoke] FAIL did-fail-load ${code} ${description} (${url})`);
  });

  window.webContents.once('did-finish-load', () => {
    if (settled || window.isDestroyed()) return;

    const script =
      mode === 'index'
        ? INDEX_PROBE
        : mode === 'pty'
          ? PTY_PROBE
          : 'window.cs ? window.cs.ping ?? "bridge" : Promise.reject("no bridge")';

    window.webContents
      .executeJavaScript(script, true)
      .then((value: unknown) => settle(0, `[smoke] OK ${JSON.stringify(value)}`))
      .catch((error: unknown) => settle(1, `[smoke] FAIL ${String(error)}`));
  });
}

/**
 * Proves node-pty works in this build — specifically in a packaged one, where
 * the native binding lives outside the asar and a wrong `asarUnpack` or an
 * over-eager file exclusion would only show up at runtime.
 *
 * Needs CS_SMOKE_CWD (a known project path) and CS_CLAUDE_BIN (the stand-in
 * binary), so it never starts a real session or spends anything.
 */
const PTY_PROBE = `(async () => {
  const api = window.cs;
  if (!api) throw new Error('no bridge');
  const projectPath = ${JSON.stringify(process.env['CS_SMOKE_CWD'] ?? '')};
  if (projectPath.length === 0) throw new Error('CS_SMOKE_CWD not set');

  const opened = await api.terminal.openPane({
    kind: 'claude', projectPath,
    launch: { mode: { type: 'new' }, name: 'packaging-check' },
    persistBuffer: false,
  });
  if (!opened.ok) throw new Error('openPane failed: ' + opened.error.code + ' ' + opened.error.message);

  const chunks = [];
  const detach = api.pty.attach(opened.value.paneId, (c) => chunks.push(c));
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !chunks.join('').includes('fake-claude ready')) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const sawOutput = chunks.join('').includes('fake-claude ready');
  const pid = opened.value.state.type === 'running' || opened.value.state.type === 'binding'
    ? opened.value.state.pid : null;

  await api.terminal.closePane(opened.value.paneId, true);
  detach();
  return { sawOutput, pid, bytes: chunks.join('').length };
})()`;

/**
 * Runs inside the page. Polls until the full import has finished, then exercises
 * one query of every kind against the real index.
 */
const INDEX_PROBE = `(async () => {
  const api = window.cs;
  if (!api) throw new Error('no bridge');
  // The bridge returns Results, not values — contextBridge would strip the error
  // code off a rejection.
  const take = (r) => { if (!r.ok) throw new Error(r.error.code + ': ' + r.error.message); return r.value; };

  // The registry phase briefly returns to 'idle' before the skeleton phase
  // starts, so 'idle' alone is not a finish condition. Wait for sessions to
  // exist and for the phase to have settled for a few consecutive samples.
  const deadline = Date.now() + 14 * 60 * 1000;
  let progress = take(await api.index.getProgress());
  let lastPhase = '';
  let idleStreak = 0;
  let sawWork = false;
  while (Date.now() < deadline) {
    progress = take(await api.index.getProgress());
    if (progress.phase !== lastPhase) {
      lastPhase = progress.phase;
      console.log('[smoke] phase=' + progress.phase + ' files=' + progress.filesDone + '/' + progress.filesTotal);
    }
    if (progress.phase !== 'idle') { sawWork = true; idleStreak = 0; } else { idleStreak += 1; }
    const total = take(await api.index.listSessions({ limit: 1 })).total;
    if (sawWork && progress.phase === 'idle' && idleStreak >= 5 && total > 0) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  const projects = take(await api.index.listProjects({ includeHidden: true }));
  const sessions = take(await api.index.listSessions({ sort: 'recent', limit: 5 }));
  const biggest = take(await api.index.listSessions({ sort: 'messages', limit: 1 }));
  const first = biggest.items[0];
  const transcript = first ? take(await api.index.getTranscript(first.id, { offset: 0, limit: 10 }, true)) : null;
  const tree = first ? take(await api.index.getSessionTree(first.id)) : null;
  const raw = first && transcript && transcript.items[0]
    ? take(await api.index.getRawLine(first.id, transcript.items[0].id))
    : null;
  const umlaut = take(await api.index.search({ text: 'prufung', limit: 5 }));
  const path = take(await api.index.search({ text: '"src/app"', limit: 5 }));
  const live = take(await api.index.getLiveSessions());
  const plans = take(await api.index.listPlans());
  const claude = take(await api.terminal.getClaudeInfo());

  return {
    phase: progress.phase,
    unknownRecordTypes: progress.unknownRecordTypes,
    decodeErrors: progress.decodeErrors,
    projects: projects.length,
    sessionsTotal: sessions.total,
    biggestSession: first ? { title: first.title, messages: first.messageCount, cost: first.costUsd } : null,
    transcriptPage: transcript ? transcript.items.length : 0,
    transcriptTotal: transcript ? transcript.total : 0,
    treeNodes: tree ? tree.nodes.length : 0,
    forks: tree ? tree.forkPoints.length : 0,
    dangling: tree ? tree.danglingRoots.length : 0,
    rawLineOk: typeof raw === 'string' && raw.startsWith('{'),
    searchUmlaut: umlaut.total,
    searchPath: path.total,
    liveSessions: live.length,
    needsYou: live.filter((s) => s.attention === 'needs-you').length,
    plans: plans.length,
    claude: claude.version,
  };
})()`;
