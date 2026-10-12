import type { PaneId, SessionId } from '../domain/ids.js';
import type { DeletionResult, ProjectPaths, SessionPaths } from '../domain/archive.js';
import type { UpdateStatus } from '../domain/update.js';
import type {
  ClaudeBinaryInfo,
  PaneHandle,
  PaneSpec,
  PersistedWorkspace,
  TerminalProfile,
} from '../domain/terminal.js';

/**
 * Main-process surface. Separate from `IndexApi` because it crosses a different
 * boundary (classic ipcRenderer, not the MessagePort) and because the indexer
 * must never be able to start a process.
 */
export interface TerminalApi {
  openPane(spec: PaneSpec): Promise<PaneHandle>;
  closePane(paneId: PaneId, force: boolean): Promise<void>;
  resizePane(paneId: PaneId, cols: number, rows: number): Promise<void>;
  listPanes(): Promise<PaneHandle[]>;
  /** Ring-buffered raw output, for attaching a tab that was not being rendered. */
  replayBuffer(paneId: PaneId): Promise<string>;
  listProfiles(): Promise<TerminalProfile[]>;

  getClaudeInfo(): Promise<ClaudeBinaryInfo>;
  setClaudeBinaryPath(path: string | null): Promise<ClaudeBinaryInfo>;

  loadWorkspace(): Promise<PersistedWorkspace>;
  saveWorkspace(workspace: PersistedWorkspace): Promise<void>;

  pickDirectory(title: string): Promise<string | null>;
  openExternal(url: string): Promise<boolean>;
  revealInFinder(path: string): Promise<void>;
  /** Focuses the window and raises the pane that owns `sessionId`. */
  focusSession(sessionId: SessionId): Promise<boolean>;
  setBadgeCount(count: number): Promise<void>;

  /**
   * Irreversible deletion under ~/.claude, behind a native confirmation dialog.
   *
   * Lives here rather than on IndexApi because the indexer is strictly
   * read-only, and because main re-checks for itself that the path stays inside
   * ~/.claude/projects — a safety check that must not depend on another process.
   */
  deleteSessionData(paths: SessionPaths): Promise<DeletionResult>;
  deleteProjectData(paths: ProjectPaths): Promise<DeletionResult>;

  getUpdateStatus(): Promise<UpdateStatus>;
  /** Explicit user-triggered check; ignores the background interval. */
  checkForUpdates(): Promise<UpdateStatus>;
  /** `auto` mode only. In `manual` mode the renderer opens the release page. */
  downloadUpdate(): Promise<UpdateStatus>;
  /** Quits and relaunches into the downloaded version. `auto` mode only. */
  installUpdate(): Promise<void>;
  setUpdateChecksEnabled(enabled: boolean): Promise<UpdateStatus>;
}

export type TerminalApiMethod = keyof TerminalApi;
