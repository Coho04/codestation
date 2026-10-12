import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';
import { createFixtureHome, type FixtureHome } from './fixture-home';
import type { CodeStationBridge } from '../../packages/shared/src/index';

// The renderer declares this globally, but that declaration is not in this
// project's compilation; the evaluated code runs in the page either way.
declare global {
  interface Window {
    readonly cs?: CodeStationBridge;
  }
}

const ROOT = resolve(import.meta.dirname, '../..');
const FAKE_CLAUDE = resolve(ROOT, 'test/fixtures/bin/fake-claude');

let app: ElectronApplication;
let page: Page;
let fixture: FixtureHome;

test.beforeAll(async () => {
  fixture = createFixtureHome();
  app = await electron.launch({
    // Electron derives userData from NSSearchPath on macOS, not from $HOME —
    // without this flag the suite opens (and writes) the real index.
    args: [ROOT, `--user-data-dir=${fixture.home}/userData`],
    cwd: ROOT,
    env: {
      ...process.env,
      // A throwaway HOME: the suite must never read the real ~/.claude, and
      // Electron's userData follows HOME, so the index lands in the fixture too.
      HOME: fixture.home,
      CS_CLAUDE_BIN: FAKE_CLAUDE,
      NODE_ENV: 'test',
    },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
  if (fixture !== undefined) rmSync(fixture.home, { recursive: true, force: true });
});

test('the window opens and the preload bridge is reachable', async () => {
  await expect(page.locator('cs-shell')).toBeVisible();
  const hasBridge = await page.evaluate(() => typeof window.cs === 'object');
  expect(hasBridge).toBe(true);
});

test('the stylesheet actually applies', async () => {
  // Angular's critical-CSS inlining loads the real stylesheet through an inline
  // script, which a strict script-src blocks — leaving the app rendered but
  // unstyled. Nothing about text content catches that, so assert on the
  // computed result instead.
  const styling = await page.evaluate(() => {
    const shell = document.querySelector('cs-shell > div');
    const sidebar = document.querySelector('cs-sidebar nav');
    return {
      sheets: document.styleSheets.length,
      // Counted recursively: Tailwind v4 nests nearly everything inside
      // @layer blocks, which are a single rule at the top level.
      rules: (function count(sheets: readonly CSSStyleSheet[]): number {
        const walk = (rules: CSSRuleList): number =>
          [...rules].reduce(
            (n, rule) => n + 1 + ('cssRules' in rule ? walk((rule as CSSGroupingRule).cssRules) : 0),
            0,
          );
        return sheets.reduce((n, sheet) => {
          try {
            return n + walk(sheet.cssRules);
          } catch {
            return n;
          }
        }, 0);
      })([...document.styleSheets]),
      shellDisplay: shell === null ? null : getComputedStyle(shell).display,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      sidebarBorder: sidebar === null ? null : getComputedStyle(sidebar).borderRightWidth,
      // xterm ships its own sheet; without it the terminal has no layout.
      hasXtermRules: [...document.styleSheets].some((sheet) => {
        try {
          return [...sheet.cssRules].some((rule) => rule.cssText.includes('.xterm'));
        } catch {
          return false;
        }
      }),
    };
  });

  expect(styling.sheets).toBeGreaterThan(0);
  expect(styling.rules).toBeGreaterThan(200);
  expect(styling.shellDisplay).toBe('grid');
  expect(styling.bodyBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(styling.sidebarBorder).toBe('1px');
  expect(styling.hasXtermRules).toBe(true);
});

test('no content security policy violations occur', async () => {
  // A blocked inline script is reported here and nowhere else; it is what made
  // the app load without its stylesheet.
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  await page.reload();
  await page.waitForSelector('cs-shell');
  // Report what was blocked, not merely that something was.
  expect(violations.join('\n---\n')).toBe('');

  // A reload throws away the MessagePort to the indexer. If it is not handed
  // over again the app looks fine and every query hangs forever.
  const afterReload = await page.evaluate(async () => {
    const result = await Promise.race([
      window.cs!.index.listProjects(),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 10_000)),
    ]);
    return result === 'timeout' ? 'timeout' : 'reconnected';
  });
  expect(afterReload).toBe('reconnected');
});

test('the update indicator shows the running version and checks nothing in a dev run', async () => {
  // The whole point of the `disabled` mode: a run from source has no bundle to
  // replace and no released version to compare against, so it must not reach
  // out to GitHub at all. Asserting on the status rather than on network
  // traffic keeps the test honest without a proxy.
  const status = await page.evaluate(async () => {
    const result = await window.cs!.terminal.getUpdateStatus();
    return result.ok ? result.value : null;
  });
  expect(status?.mode).toBe('disabled');
  expect(status?.phase.kind).toBe('idle');

  await expect(page.locator('cs-update-indicator')).toContainText(`v${status!.currentVersion}`);

  // A check in this mode is a no-op that still answers, rather than throwing.
  const afterCheck = await page.evaluate(async () => {
    const result = await window.cs!.terminal.checkForUpdates();
    return result.ok ? result.value.phase.kind : 'rejected';
  });
  expect(afterCheck).toBe('idle');
});

test('the indexed project appears in the sidebar', async () => {
  await expect(page.locator('cs-sidebar')).toContainText('projekt', { timeout: 60_000 });
});

test('the session is listed with the title from its transcript', async () => {
  await page.getByRole('link', { name: 'Sessions', exact: true }).click();
  await expect(page.locator('cs-archive-page')).toContainText('Pipeline prüfen');
});

test('search folds umlauts and finds the prompt written with one', async () => {
  await page.getByRole('link', { name: 'Suche' }).click();
  await page.locator('cs-search-page input').first().fill('prufung');
  // remove_diacritics folds ü→u, so the ASCII spelling must hit.
  await expect(page.locator('cs-search-page')).toContainText('Pipeline', { timeout: 20_000 });
});

test('the transcript view renders the conversation', async () => {
  await page.getByRole('link', { name: 'Sessions', exact: true }).click();
  await page.getByRole('link', { name: 'Pipeline prüfen' }).click();
  const detail = page.locator('cs-session-detail-page');
  await expect(detail).toContainText('Wie läuft die Prüfung der Pipeline?');
  await expect(detail).toContainText('src/app/pipeline.ts');
  // The tool call is summarised rather than dumped as raw JSON.
  await expect(detail).toContainText('npm test');
});

test('a terminal pane starts a session, echoes input and reports its exit', async () => {
  const result = await page.evaluate(async (projectPath: string) => {
    const api = window.cs!;
    const opened = await api.terminal.openPane({
      kind: 'claude',
      projectPath,
      launch: { mode: { type: 'new' }, name: 'e2e' },
      persistBuffer: false,
    });
    if (!opened.ok) return { started: false, echoed: false, paneCount: 0, bufferHasOutput: false };
    const handle = opened.value;

    const chunks: string[] = [];
    const detach = api.pty.attach(handle.paneId, (chunk) => chunks.push(chunk));

    const waitFor = async (needle: string, ms = 15_000): Promise<boolean> => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (chunks.join('').includes(needle)) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    };

    const started = await waitFor('fake-claude ready');
    api.pty.write(handle.paneId, 'hallo\r');
    const echoed = await waitFor('echo:hallo');

    const panes = await api.terminal.listPanes();
    const buffer = await api.terminal.replayBuffer(handle.paneId);

    await api.terminal.closePane(handle.paneId, true);
    detach();

    return {
      started,
      echoed,
      paneCount: panes.ok ? panes.value.length : 0,
      bufferHasOutput: buffer.ok && buffer.value.includes('fake-claude ready'),
    };
  }, fixture.projectPath);

  expect(result.started).toBe(true);
  expect(result.echoed).toBe(true);
  expect(result.paneCount).toBeGreaterThan(0);
  // A tab that was never rendered must still be able to show what happened.
  expect(result.bufferHasOutput).toBe(true);
});

test('a flooding process does not outrun the renderer', async () => {
  const result = await page.evaluate(async (projectPath: string) => {
    const api = window.cs!;
    const opened = await api.terminal.openPane({
      kind: 'claude',
      projectPath,
      launch: { mode: { type: 'new' }, name: 'flood' },
      persistBuffer: false,
    });
    if (!opened.ok) return { bytes: 0, messages: 0, done: false };
    const handle = opened.value;

    let bytes = 0;
    let messages = 0;
    let done = false;
    const detach = api.pty.attach(handle.paneId, (chunk) => {
      bytes += chunk.length;
      messages += 1;
      if (chunk.includes('FLOOD-DONE')) done = true;
      // Acknowledge, as the real pane does from xterm's write callback.
      api.pty.ack(handle.paneId, chunk.length);
    });

    // Triggered over stdin rather than an env var, so no test-only variable has
    // to be threaded through the production environment resolver.
    await new Promise((r) => setTimeout(r, 1000));
    api.pty.write(handle.paneId, 'FLOOD 40000\r');

    const deadline = Date.now() + 60_000;
    while (!done && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));

    await api.terminal.closePane(handle.paneId, true);
    detach();
    return { bytes, messages, done };
  }, fixture.projectPath);

  expect(result.done).toBe(true);
  expect(result.bytes).toBeGreaterThan(100_000);
  // Coalescing is the point: tens of thousands of lines must not become tens of
  // thousands of IPC messages.
  expect(result.messages).toBeLessThan(result.bytes / 2000);
});

/**
 * Starts a session the way a person does — through the launch dialog — because
 * session mode is a decision the UI makes, not something the bridge knows about.
 */
async function startSessionViaUi(name: string): Promise<void> {
  await page.getByRole('link', { name: 'Übersicht' }).click();
  await page.getByRole('button', { name: 'Neue Session' }).click();
  await page.locator('cs-launch-dialog select').first().selectOption(fixture.projectPath);
  await page.locator('cs-launch-dialog input[type="text"], cs-launch-dialog input:not([type])').first().fill(name);
  await page.getByRole('button', { name: 'Starten' }).click();
  await expect(page.locator('cs-session-panel')).toBeVisible({ timeout: 20_000 });
}

async function closeAllPanes(): Promise<void> {
  await page.evaluate(async () => {
    const api = window.cs!;
    const panes = await api.terminal.listPanes();
    if (!panes.ok) return;
    for (const pane of panes.value) await api.terminal.closePane(pane.paneId, true);
  });
}

const gridAreas = (): Promise<string> =>
  page.evaluate(
    () => getComputedStyle(document.querySelector('cs-shell > div') as HTMLElement).gridTemplateAreas,
  );

test('starting a session fills the screen and keeps the same terminal', async () => {
  expect(await gridAreas()).toContain('side main');

  await startSessionViaUi('layout');

  const during = await gridAreas();
  // The terminal moves into the main cell and the data panel appears beside it.
  expect(during).toContain('side dock');
  expect(during).not.toContain('side main');
  await expect(page.locator('cs-session-panel')).toBeVisible();
  await expect(page.locator('cs-shell main')).toBeHidden();
  await expect(page.locator('cs-terminal-pane')).toHaveCount(1);

  // Esc returns to the normal layout, and the xterm element must survive the
  // round trip — otherwise the scrollback and the PTY binding are gone.
  const sameElement = await page.evaluate(async () => {
    const before = document.querySelector('cs-terminal-pane');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    return document.querySelector('cs-terminal-pane') === before;
  });

  expect(await gridAreas()).toContain('side main');
  expect(sameElement).toBe(true);

  await closeAllPanes();
});

test('navigating away leaves session mode', async () => {
  await startSessionViaUi('nav');
  expect(await gridAreas()).not.toContain('side main');

  await page.getByRole('link', { name: 'Sessions', exact: true }).click();
  await expect(page.locator('cs-archive-page')).toBeVisible();

  expect(await gridAreas()).toContain('side main');
  await closeAllPanes();
});

test('a session that ends leaves session mode on its own', async () => {
  await startSessionViaUi('ends');
  expect(await gridAreas()).not.toContain('side main');

  // Killing the process is what a finished session looks like.
  await closeAllPanes();
  await expect
    .poll(() => gridAreas(), { timeout: 10_000 })
    .toContain('side main');
});

test('the data panel can be resized and collapsed', async () => {
  await startSessionViaUi('panel');

  const widthOf = () =>
    page.evaluate(() => document.querySelector('cs-session-panel')?.getBoundingClientRect().width ?? 0);
  const initial = await widthOf();
  expect(initial).toBeGreaterThan(300);

  await page.evaluate(() => {
    const handle = document.querySelector('cs-resizer div') as HTMLElement;
    const box = handle.getBoundingClientRect();
    const opts = { bubbles: true, pointerId: 1, clientY: box.top + 10 };
    handle.setPointerCapture = () => undefined;
    handle.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: box.left }));
    handle.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: box.left - 120 }));
    handle.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: box.left - 120 }));
  });
  await expect.poll(() => widthOf(), { timeout: 5_000 }).toBeGreaterThan(initial + 80);

  // Collapsing has to be reachable from the panel itself; a double-click on the
  // drag handle is not something anyone discovers.
  await page.getByTitle('Session-Daten einklappen').click();
  await expect(page.locator('cs-session-panel')).toHaveCount(0);

  await page.getByTitle('Session-Daten einblenden').click();
  await expect(page.locator('cs-session-panel')).toBeVisible();
  // The width survives collapsing and expanding.
  await expect.poll(() => widthOf(), { timeout: 5_000 }).toBeGreaterThan(initial + 80);

  await closeAllPanes();
});

test('starting a pane in an unknown directory is refused', async () => {
  const error = await page.evaluate(async () => {
    const result = await window.cs!.terminal.openPane({
      kind: 'claude',
      projectPath: '/etc',
      launch: { mode: { type: 'new' } },
      persistBuffer: false,
    });
    return result.ok ? null : result.error.code;
  });
  // The allow-list is what stops a compromised renderer from spawning anywhere.
  expect(error).toBe('CWD_MISSING');
});

// ---------------------------------------------------------------------------
// Archiving, forgetting and deleting. Last in the file on purpose: the final
// tests remove the fixture's data from disk.
// ---------------------------------------------------------------------------

/** Replaces the native confirmation so a test can answer it. */
async function answerNextDialog(choice: 'confirm' | 'cancel'): Promise<void> {
  await app.evaluate(({ dialog }, index: number) => {
    const electronDialog = dialog as unknown as { showMessageBoxSync: unknown };
    electronDialog.showMessageBoxSync = () => index;
  }, choice === 'confirm' ? 0 : 1);
}

test('archiving a project hides it and takes it out of search', async () => {
  const before = await page.evaluate(async () => {
    const api = window.cs!;
    const projects = await api.index.listProjects();
    const hits = await api.index.search({ text: 'Prüfung' });
    return {
      count: projects.ok ? projects.value.length : -1,
      hits: hits.ok ? hits.value.total : -1,
      id: projects.ok ? projects.value[0]?.id : undefined,
    };
  });
  expect(before.count).toBeGreaterThan(0);
  expect(before.hits).toBeGreaterThan(0);

  const after = await page.evaluate(async (projectId: number) => {
    const api = window.cs!;
    await api.index.setProjectArchived(projectId as never, true);
    const visible = await api.index.listProjects();
    const archived = await api.index.listProjects({ onlyArchived: true });
    const hits = await api.index.search({ text: 'Prüfung' });
    return {
      visible: visible.ok ? visible.value.length : -1,
      archived: archived.ok ? archived.value.length : -1,
      hits: hits.ok ? hits.value.total : -1,
    };
  }, before.id as unknown as number);

  expect(after.visible).toBe(before.count - 1);
  expect(after.archived).toBe(1);
  // Archiving means out of the way, search included.
  expect(after.hits).toBe(0);

  // And all of it comes back.
  const restored = await page.evaluate(async (projectId: number) => {
    const api = window.cs!;
    await api.index.setProjectArchived(projectId as never, false);
    const hits = await api.index.search({ text: 'Prüfung' });
    return hits.ok ? hits.value.total : -1;
  }, before.id as unknown as number);
  expect(restored).toBeGreaterThan(0);
});

test('forgetting a session drops it from the index but leaves the file alone', async () => {
  const result = await page.evaluate(async () => {
    const api = window.cs!;
    const list = await api.index.listSessions({ limit: 1 });
    if (!list.ok || list.value.items[0] === undefined) return null;
    const session = list.value.items[0];

    const paths = await api.index.resolveSessionPaths(session.id);
    await api.index.forgetSession(session.id);

    const after = await api.index.listSessions({ limit: 10 });
    const stones = await api.index.listTombstones();
    return {
      transcriptPath: paths.ok ? paths.value?.transcriptPath : null,
      remaining: after.ok ? after.value.total : -1,
      tombstones: stones.ok ? stones.value.length : -1,
      tombstonePath: stones.ok ? stones.value[0]?.path : undefined,
    };
  });

  expect(result).not.toBeNull();
  expect(result?.remaining).toBe(0);
  expect(result?.tombstones).toBe(1);
  expect(result?.tombstonePath).toBe(result?.transcriptPath);

  // The point of this level: the transcript is still on disk.
  const { existsSync } = await import('node:fs');
  expect(existsSync(result!.transcriptPath!)).toBe(true);
});

test('a tombstone keeps the sweep from bringing it back, until lifted', async () => {
  const stillGone = await page.evaluate(async () => {
    const api = window.cs!;
    await api.index.refresh();
    await new Promise((r) => setTimeout(r, 1500));
    const list = await api.index.listSessions({ limit: 10 });
    return list.ok ? list.value.total : -1;
  });
  // Without a tombstone the reconcile sweep would have restored it by now.
  expect(stillGone).toBe(0);

  const back = await page.evaluate(async () => {
    const api = window.cs!;
    const stones = await api.index.listTombstones();
    if (!stones.ok || stones.value[0] === undefined) return -1;
    await api.index.restoreTombstone(stones.value[0].path);
    await api.index.refresh();
    for (let i = 0; i < 40; i += 1) {
      const list = await api.index.listSessions({ limit: 10 });
      if (list.ok && list.value.total > 0) return list.value.total;
      await new Promise((r) => setTimeout(r, 500));
    }
    return 0;
  });
  expect(back).toBeGreaterThan(0);
});

test('cancelling the dialog deletes nothing', async () => {
  await answerNextDialog('cancel');

  const result = await page.evaluate(async () => {
    const api = window.cs!;
    const list = await api.index.listSessions({ limit: 1 });
    if (!list.ok || list.value.items[0] === undefined) return null;
    const paths = await api.index.resolveSessionPaths(list.value.items[0].id);
    if (!paths.ok || paths.value === null) return null;
    const deletion = await api.terminal.deleteSessionData(paths.value);
    return {
      path: paths.value.transcriptPath,
      confirmed: deletion.ok ? deletion.value.confirmed : null,
      files: deletion.ok ? deletion.value.deletedFiles : -1,
    };
  });

  expect(result?.confirmed).toBe(false);
  expect(result?.files).toBe(0);
  const { existsSync } = await import('node:fs');
  expect(existsSync(result!.path!)).toBe(true);
});

test('a path outside ~/.claude/projects is refused even with a confirming dialog', async () => {
  await answerNextDialog('confirm');

  const result = await page.evaluate(async () => {
    const api = window.cs!;
    const deletion = await api.terminal.deleteSessionData({
      sessionId: 'x' as never,
      label: 'bösartig',
      transcriptPath: '/etc/hosts',
      sidecarDir: null,
    });
    return deletion.ok ? deletion.value : null;
  });

  // The guard in main must hold regardless of what the renderer sends.
  expect(result?.confirmed).toBe(false);
  expect(result?.deletedFiles).toBe(0);
  expect(result?.error).toContain('außerhalb');
  const { existsSync } = await import('node:fs');
  expect(existsSync('/etc/hosts')).toBe(true);
});

test('confirming the dialog deletes the transcript for good', async () => {
  await answerNextDialog('confirm');

  const result = await page.evaluate(async () => {
    const api = window.cs!;
    const list = await api.index.listSessions({ limit: 1 });
    if (!list.ok || list.value.items[0] === undefined) return null;
    const paths = await api.index.resolveSessionPaths(list.value.items[0].id);
    if (!paths.ok || paths.value === null) return null;
    const deletion = await api.terminal.deleteSessionData(paths.value);
    return {
      path: paths.value.transcriptPath,
      confirmed: deletion.ok ? deletion.value.confirmed : null,
      files: deletion.ok ? deletion.value.deletedFiles : -1,
      error: deletion.ok ? deletion.value.error : 'rpc failed',
    };
  });

  expect(result?.error).toBeNull();
  expect(result?.confirmed).toBe(true);
  expect(result?.files).toBeGreaterThan(0);
  const { existsSync } = await import('node:fs');
  expect(existsSync(result!.path!)).toBe(false);
});
