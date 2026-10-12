import type { Millis, PaneId, ProfileId, SessionId, TabId } from './ids.js';

export type PermissionMode = 'acceptEdits' | 'auto' | 'bypassPermissions' | 'manual' | 'dontAsk' | 'plan';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type LaunchMode =
  | { readonly type: 'new' }
  | { readonly type: 'resume'; readonly sessionId: SessionId }
  /** Resume with a fresh id — the new id is unknown until the CLI writes it. */
  | { readonly type: 'fork'; readonly sessionId: SessionId }
  | { readonly type: 'attach'; readonly backgroundId: string };

export interface ClaudeLaunchSpec {
  readonly mode: LaunchMode;
  readonly name?: string;
  readonly model?: string;
  readonly effort?: Effort;
  readonly permissionMode?: PermissionMode;
  readonly addDirs?: readonly string[];
  /** Survives app shutdown via `--bg`; off by default. */
  readonly background?: boolean;
}

export type PaneSpec =
  | {
      readonly kind: 'claude';
      readonly projectPath: string;
      readonly launch: ClaudeLaunchSpec;
      /** Claude runs in the alternate screen buffer, so there is no scrollback to keep. */
      readonly persistBuffer: false;
    }
  | {
      readonly kind: 'shell';
      readonly projectPath: string;
      readonly profileId: ProfileId;
      readonly persistBuffer: boolean;
    };

/**
 * A tab holds a tree of panes. v1 only ever builds single leaves, but the type
 * and the recursive renderer exist from the start — retrofitting splits onto a
 * tab-keyed model would mean rewriting main, IPC and renderer at once.
 */
export type LayoutNode =
  | { readonly type: 'leaf'; readonly paneId: PaneId }
  | {
      readonly type: 'split';
      readonly direction: 'row' | 'column';
      readonly children: readonly LayoutNode[];
      readonly sizes: readonly number[];
    };

export interface TerminalTab {
  readonly id: TabId;
  readonly title: string;
  readonly root: LayoutNode;
  readonly activePaneId: PaneId;
}

export interface PersistedWorkspace {
  readonly version: 1;
  readonly tabs: readonly TerminalTab[];
  readonly activeTabId: TabId | null;
  readonly panes: readonly PersistedPane[];
  /**
   * Session-mode panel geometry. Optional so an older workspace.json still
   * loads unchanged — there is nothing here worth a migration for.
   */
  readonly panelWidth?: number;
  readonly panelCollapsed?: boolean;
}

/** Enough to offer "resume" after a restart; PTYs themselves never survive. */
export interface PersistedPane {
  readonly paneId: PaneId;
  readonly spec: PaneSpec;
  readonly title: string;
  readonly sessionId: SessionId | null;
}

export type PaneState =
  | { readonly type: 'starting' }
  /** Spawned, waiting for the CLI to publish its session id. */
  | { readonly type: 'binding'; readonly pid: number }
  | { readonly type: 'running'; readonly pid: number; readonly sessionId: SessionId | null }
  | { readonly type: 'exited'; readonly exitCode: number; readonly signal: number | null; readonly at: Millis }
  | { readonly type: 'failed'; readonly reason: string };

export interface PaneHandle {
  readonly paneId: PaneId;
  readonly spec: PaneSpec;
  readonly title: string;
  readonly state: PaneState;
}

export interface TerminalProfile {
  readonly id: ProfileId;
  readonly name: string;
  readonly command: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwdStrategy: 'project' | 'home' | 'fixed';
  readonly fixedCwd?: string;
}

export interface ClaudeBinaryInfo {
  readonly path: string | null;
  readonly version: string | null;
  readonly source: 'setting' | 'which' | 'candidate' | 'missing';
  readonly capabilities: CliCapabilities;
  readonly error: string | null;
}

/** Derived once from the version so feature checks never re-parse it. */
export interface CliCapabilities {
  readonly supportsSessionId: boolean;
  readonly supportsBackground: boolean;
  readonly supportsEffort: boolean;
  readonly supportsForkSession: boolean;
  readonly supportsAgentsJson: boolean;
}
