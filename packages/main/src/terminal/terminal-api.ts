import { app, dialog, shell, type BrowserWindow } from 'electron';
import { realpath, stat } from 'node:fs/promises';
import { profileId as toProfileId, type ClaudeBinaryInfo, type ProjectPaths, type SessionPaths, type PaneHandle, type PaneId, type PaneSpec, type PersistedWorkspace, type SessionId, type TerminalApi, type TerminalProfile, type UpdateStatus } from '@cs/shared';
import { throwAppError } from '@cs/shared';
import type { PtyManager } from './pty-manager.js';
import type { WorkspaceStore } from '../persistence/workspace-store.js';
import type { ClaudeBinaryResolver } from '../runtime/claude-binary-resolver.js';
import { openExternal } from '../security/navigation-guard.js';
import type { DestructiveOps } from '../data/destructive-ops.js';
import type { UpdateService } from '../update/update-service.js';

export interface TerminalApiDeps {
  readonly destructive: DestructiveOps;
  readonly panes: PtyManager;
  readonly workspace: WorkspaceStore;
  readonly claude: ClaudeBinaryResolver;
  readonly getClaudeOverride: () => string | null;
  readonly setClaudeOverride: (path: string | null) => void;
  /** Paths the index knows about, plus directories the user picked explicitly. */
  readonly isKnownProjectPath: (path: string) => Promise<boolean>;
  readonly allowPath: (path: string) => void;
  readonly getWindow: () => BrowserWindow | null;
  readonly focusSession: (sessionId: SessionId) => boolean;
  readonly updates: UpdateService;
  readonly persistUpdateChecks: (enabled: boolean) => void;
}

const BUILT_IN_PROFILES: TerminalProfile[] = [
  {
    id: toProfileId('claude'),
    name: 'Claude Code',
    command: [],
    env: {},
    cwdStrategy: 'project',
  },
  {
    id: toProfileId('login-shell'),
    name: 'Login-Shell',
    command: [],
    env: {},
    cwdStrategy: 'project',
  },
];

/**
 * The main-process half of the bridge.
 *
 * Note what is absent: there is no generic "run this command" method, and
 * `claude project purge` has no handler, no constant and no code path. The user
 * can type it in a shell pane — that is their decision — but the app will never
 * issue it on their behalf.
 */
export function createTerminalApi(deps: TerminalApiDeps): TerminalApi {
  const assertProjectPath = async (path: string): Promise<string> => {
    // Resolved and checked against the known set: a project path comes from the
    // index or from a directory picker, never from a free-text field.
    const resolved = await realpath(path).catch(() => path);
    const info = await stat(resolved).catch(() => null);
    if (info === null || !info.isDirectory()) {
      throwAppError('CWD_MISSING', `Ordner existiert nicht: ${path}`);
    }
    if (!(await deps.isKnownProjectPath(resolved))) {
      throwAppError('CWD_MISSING', `Ordner ist kein bekanntes Projekt: ${resolved}`);
    }
    return resolved;
  };

  return {
    openPane: async (spec: PaneSpec): Promise<PaneHandle> => {
      const projectPath = await assertProjectPath(spec.projectPath);
      return deps.panes.open({ ...spec, projectPath });
    },

    closePane: (paneId: PaneId, force: boolean) => deps.panes.close(paneId, force),
    resizePane: (paneId: PaneId, cols: number, rows: number) => {
      deps.panes.resize(paneId, cols, rows);
      return Promise.resolve();
    },
    listPanes: () => Promise.resolve(deps.panes.list()),
    replayBuffer: (paneId: PaneId) => Promise.resolve(deps.panes.replayBuffer(paneId)),
    listProfiles: () => Promise.resolve(BUILT_IN_PROFILES),

    getClaudeInfo: (): Promise<ClaudeBinaryInfo> => deps.claude.resolve(deps.getClaudeOverride()),
    setClaudeBinaryPath: async (path: string | null) => {
      deps.setClaudeOverride(path);
      return deps.claude.resolve(path, true);
    },

    loadWorkspace: () => deps.workspace.load(),
    saveWorkspace: (workspace: PersistedWorkspace) => deps.workspace.save(workspace),

    pickDirectory: async (title: string) => {
      const window = deps.getWindow();
      const result =
        window === null
          ? await dialog.showOpenDialog({ title, properties: ['openDirectory'] })
          : await dialog.showOpenDialog(window, { title, properties: ['openDirectory'] });
      const picked = result.filePaths[0];
      if (result.canceled || picked === undefined) return null;
      // An explicitly picked directory becomes a known path; that is the only
      // way a new one enters the allow-list.
      deps.allowPath(picked);
      return picked;
    },

    openExternal: (url: string) => openExternal(url),
    revealInFinder: (path: string) => {
      shell.showItemInFolder(path);
      return Promise.resolve();
    },
    focusSession: (sessionId: SessionId) => Promise.resolve(deps.focusSession(sessionId)),
    setBadgeCount: (count: number) => {
      app.setBadgeCount(Math.max(0, count));
      return Promise.resolve();
    },

    deleteSessionData: (paths: SessionPaths) => deps.destructive.deleteSessionData(paths),
    deleteProjectData: (paths: ProjectPaths) => deps.destructive.deleteProjectData(paths),

    getUpdateStatus: (): Promise<UpdateStatus> => Promise.resolve(deps.updates.status),
    checkForUpdates: () => deps.updates.check(),
    downloadUpdate: () => deps.updates.download(),
    installUpdate: () => {
      deps.updates.install();
      return Promise.resolve();
    },
    setUpdateChecksEnabled: (enabled: boolean) => {
      const status = deps.updates.setChecksEnabled(enabled);
      deps.persistUpdateChecks(enabled);
      return Promise.resolve(status);
    },
  };
}
