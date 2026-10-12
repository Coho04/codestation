import { app, BrowserWindow, ipcMain, nativeImage, session } from 'electron';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  APP_NAME,
  APP_SCHEME,
  IPC_CHANNELS,
  type AppEvent,
  type PaneId,
  type SessionId,
} from '@cs/shared';
import { resolveRuntimeEnv } from './app/env.js';
import { acquireSingleInstance } from './app/single-instance.js';
import { installSmokeCheck } from './app/smoke.js';
import { registerAppScheme, serveRenderer } from './security/app-protocol.js';
import { applyContentSecurityPolicy } from './security/csp.js';
import { installNavigationGuard } from './security/navigation-guard.js';
import { ProjectAllowList } from './security/project-allow-list.js';
import { createMainWindow, rendererRootPath } from './window/main-window.js';
import { EventBus } from './ipc/event-bus.js';
import { installTerminalRouter } from './ipc/terminal-router.js';
import { IndexerHost } from './indexer-host.js';
import { PtyManager } from './terminal/pty-manager.js';
import { NodePtyAdapter } from './terminal/node-pty-adapter.js';
import { createTerminalApi } from './terminal/terminal-api.js';
import { DestructiveOps } from './data/destructive-ops.js';
import { ShellEnvResolver } from './runtime/shell-env-resolver.js';
import { ClaudeBinaryResolver } from './runtime/claude-binary-resolver.js';
import { WorkspaceStore } from './persistence/workspace-store.js';
import { SettingsStore } from './persistence/settings-store.js';
import { NotificationService } from './notify/notification-service.js';
import { correlate } from './live/session-correlator.js';
import { installQuitGuard } from './app/quit-guard.js';
import { indexerEntryPath } from './app/paths.js';
import { UpdateService } from './update/update-service.js';
import { GithubReleaseSource } from './update/github-release-source.js';
import { resolveUpdateMode } from './update/mode.js';
import { createElectronAutoUpdater } from './update/electron-auto-updater.js';

const env = resolveRuntimeEnv();

let mainWindow: BrowserWindow | null = null;

// First statement of all, and the order is load-bearing: Electron resolves
// `userData` from the app name the first time any path is requested, and
// `requestSingleInstanceLock()` below does exactly that. Setting the name later
// means a dev run lands in a directory named after package.json ("codestation")
// while the packaged app uses CFBundleName ("CodeStation") — two indexes, two
// sets of settings, and no hint as to why.
app.setName(APP_NAME);

// Must happen before the app is ready, and before the single-instance check so
// the scheme is registered identically in every instance that reaches `ready`.
registerAppScheme();

if (!acquireSingleInstance(() => mainWindow)) {
  app.quit();
} else {
  const allowedOrigins = env.devServerOrigin !== null ? [env.devServerOrigin] : [`${APP_SCHEME}://-`];
  installNavigationGuard(allowedOrigins);

  const bus = new EventBus();
  const settings = new SettingsStore(app.getPath('userData'));
  const allowList = new ProjectAllowList(homedir());
  const shellEnv = new ShellEnvResolver();
  const claude = new ClaudeBinaryResolver(async () => (await shellEnv.resolve()).env);
  const workspace = new WorkspaceStore(app.getPath('userData'));

  const sendToRenderer = (channel: string, ...args: unknown[]): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
      window.webContents.send(channel, ...args);
    }
  };

  const panes = new PtyManager({
    pty: new NodePtyAdapter(),
    env: shellEnv,
    claude,
    // CS_CLAUDE_BIN lets the end-to-end suite point at a stand-in binary; the
    // production path is the user setting, then auto-detection.
    claudeBinaryOverride: () => process.env['CS_CLAUDE_BIN'] ?? settings.current.claudeBinaryPath,
    sendData: (paneId, chunk) => sendToRenderer(`${IPC_CHANNELS.ptyData}:${paneId}`, chunk),
    emit: (event: AppEvent) => bus.emit(event),
  });

  const focusSession = (sessionId: SessionId): boolean => {
    const pane = panes.registry.bySessionId(sessionId);
    const window = mainWindow;
    if (window === null) return false;
    if (window.isMinimized()) window.restore();
    window.focus();
    if (pane === null) return false;
    sendToRenderer(IPC_CHANNELS.event, {
      type: 'pane.title',
      paneId: pane.paneId,
      title: pane.title,
    } satisfies AppEvent);
    return true;
  };

  const notifications = new NotificationService((sessionId) => void focusSession(sessionId));

  // Checking is independent of installing: this works in every build, while
  // the Squirrel.Mac half is attached below only if the bundle can use it.
  const updates = new UpdateService({
    currentVersion: app.getVersion(),
    arch: process.arch,
    mode: resolveUpdateMode(app.isPackaged),
    source: new GithubReleaseSource(app.getVersion()),
    now: () => Date.now(),
    emit: (status) => bus.emit({ type: 'update.changed', status }),
  });

  // The live status arrives as an event; the same stream drives pane binding,
  // the dock badge and notifications, so there is only one source of truth.
  bus.subscribe((event) => {
    if (event.type !== 'live.changed') return;
    const { bound } = correlate(panes, event.sessions, Date.now());
    for (const binding of bound) panes.bind(binding.paneId, binding.pid, binding.sessionId);
    notifications.update(event.sessions);
  });

  const indexerEntry = indexerEntryPath(app.getAppPath());
  const indexer = new IndexerHost(indexerEntry, bus);

  const terminalApi = createTerminalApi({
    panes,
    destructive: new DestructiveOps(() => mainWindow),
    workspace,
    claude,
    getClaudeOverride: () => process.env['CS_CLAUDE_BIN'] ?? settings.current.claudeBinaryPath,
    setClaudeOverride: (path) => void settings.patch({ claudeBinaryPath: path }),
    isKnownProjectPath: (path) => allowList.has(path),
    allowPath: (path) => {
      allowList.allow(path);
      void settings.patch({ extraProjectPaths: allowList.pickedPaths });
    },
    getWindow: () => mainWindow,
    focusSession,
    updates,
    persistUpdateChecks: (enabled) => void settings.patch({ updateChecksEnabled: enabled }),
  });

  installTerminalRouter(terminalApi);

  ipcMain.on(IPC_CHANNELS.ptyWrite, (_event, paneId: PaneId, data: string) => {
    if (typeof paneId === 'string' && typeof data === 'string') panes.write(paneId, data);
  });
  ipcMain.on(IPC_CHANNELS.ptyAck, (_event, paneId: PaneId, bytes: number) => {
    if (typeof paneId === 'string' && Number.isFinite(bytes)) panes.acknowledge(paneId, bytes);
  });

  app
    .whenReady()
    .then(async () => {
      applyContentSecurityPolicy(session.defaultSession, env.devServerOrigin);
      if (!env.useDevServer) serveRenderer(rendererRootPath(app.getAppPath()));

      // A packaged app takes its icon from the bundle; a dev run has no bundle,
      // so without this `npm run dev` shows the Electron default in the dock.
      if (!app.isPackaged) {
        const icon = nativeImage.createFromPath(
          join(app.getAppPath(), 'assets/logo/icon-512.png'),
        );
        if (!icon.isEmpty()) app.dock?.setIcon(icon);
      }

      const loaded = await settings.load();
      allowList.setExtraPaths(loaded.extraProjectPaths);
      notifications.configure({ enabled: loaded.notificationsEnabled });
      updates.configure({ checksEnabled: loaded.updateChecksEnabled });

      indexer.configure({
        kind: 'init',
        dbPath: join(app.getPath('userData'), 'index.db'),
        home: homedir(),
        appVersion: app.getVersion(),
        claudeBinaryPath:
          process.env['CS_CLAUDE_BIN'] ?? loaded.claudeBinaryPath ?? (await claude.resolve(null)).path,
      });
      indexer.start();

      const preloadPath = join(app.getAppPath(), 'packages/preload/dist/preload.cjs');
      mainWindow = createMainWindow(env, preloadPath);
      installSmokeCheck(mainWindow);
      indexer.connectRenderer(mainWindow.webContents);
      mainWindow.on('closed', () => {
        mainWindow = null;
      });

      installQuitGuard(() => panes, () => mainWindow);

      // Resolving Squirrel.Mac is allowed to fail — a build without
      // app-update.yml, or without the dependency, simply stays in manual
      // mode and keeps telling the user when something newer is published.
      updates.attachAutoUpdater(await createElectronAutoUpdater(process.resourcesPath).catch(() => null));
      updates.start();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          mainWindow = createMainWindow(env, preloadPath);
          indexer.connectRenderer(mainWindow.webContents);
        }
      });
    })
    .catch((error: unknown) => {
      console.error('[codestation] startup failed', error);
      app.exit(1);
    });

  app.on('will-quit', () => {
    updates.dispose();
    indexer.dispose();
    bus.dispose();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
