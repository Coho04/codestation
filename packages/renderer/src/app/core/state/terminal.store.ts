import { Injectable, computed, inject, signal } from '@angular/core';
import {
  type ClaudeLaunchSpec,
  type LayoutNode,
  type PaneHandle,
  type PaneId,
  type PaneSpec,
  type PaneState,
  type PersistedWorkspace,
  type ProfileId,
  type SessionId,
  type TabId,
  type TerminalTab,
} from '@cs/shared';
import { CS_API } from '../ipc/api.token';
import { EventBus } from '../ipc/event-bus';
import { ProjectsStore } from './projects.store';

/** Matches the built-in profile registered in the main process. */
const LOGIN_SHELL_PROFILE = 'login-shell' as ProfileId;

export interface PaneView {
  readonly paneId: PaneId;
  readonly spec: PaneSpec;
  readonly title: string;
  readonly state: PaneState;
}

const uid = (): string => globalThis.crypto.randomUUID();

const DEFAULT_PANEL_WIDTH = 360;
const MIN_PANEL_WIDTH = 240;
const MAX_PANEL_WIDTH = 720;

/**
 * Owns tabs, the layout tree and the panes inside them.
 *
 * Panes are addressed by pane id throughout, never by tab: a tab holds a tree of
 * panes, and v1 only ever builds single leaves — but every id, event and lookup
 * already works for the split case, which is what keeps that change from
 * touching main, IPC and renderer at once later.
 */
@Injectable({ providedIn: 'root' })
export class TerminalStore {
  readonly #api = inject(CS_API, { optional: true });
  readonly #projects = inject(ProjectsStore);

  readonly #tabs = signal<readonly TerminalTab[]>([]);
  readonly #panes = signal<ReadonlyMap<PaneId, PaneView>>(new Map());
  readonly #activeTabId = signal<TabId | null>(null);
  readonly #dockOpen = signal(false);
  readonly #error = signal<string | null>(null);

  /**
   * Session mode: the terminal takes the main area and the session's data moves
   * to a panel on the right. Entered by starting or resuming a session, because
   * that is when the terminal is what you are actually looking at.
   */
  readonly #focusMode = signal(false);
  readonly #panelWidth = signal(DEFAULT_PANEL_WIDTH);
  readonly #panelCollapsed = signal(false);

  readonly tabs = this.#tabs.asReadonly();
  readonly panes = this.#panes.asReadonly();
  readonly activeTabId = this.#activeTabId.asReadonly();
  readonly dockOpen = this.#dockOpen.asReadonly();
  readonly error = this.#error.asReadonly();
  readonly focusMode = this.#focusMode.asReadonly();
  readonly panelWidth = this.#panelWidth.asReadonly();
  readonly panelCollapsed = this.#panelCollapsed.asReadonly();

  readonly activeTab = computed(() => this.#tabs().find((tab) => tab.id === this.#activeTabId()) ?? null);
  readonly paneCount = computed(() => this.#panes().size);

  readonly activePane = computed<PaneView | null>(() => {
    const tab = this.activeTab();
    return tab === null ? null : (this.#panes().get(tab.activePaneId) ?? null);
  });

  /** Null while a freshly started session has not published its id yet. */
  readonly activeSessionId = computed<SessionId | null>(() => {
    const state = this.activePane()?.state;
    return state?.type === 'running' ? state.sessionId : null;
  });

  constructor() {
    const bus = inject(EventBus);
    bus.on('pane.state', (event) => this.#updatePane(event.paneId, (pane) => ({ ...pane, state: event.state })));
    bus.on('pane.exit', (event) => {
      this.#updatePane(event.paneId, (pane) => ({
        ...pane,
        state: { type: 'exited', exitCode: event.exitCode, signal: event.signal, at: Date.now() },
      }));
      // The terminal stops being the thing you are looking at the moment its
      // process is gone.
      if (this.activeTab()?.activePaneId === event.paneId) this.exitFocusMode();
    });
    bus.on('pane.title', (event) => this.#updatePane(event.paneId, (pane) => ({ ...pane, title: event.title })));
    void this.restore();
  }

  async restore(): Promise<void> {
    if (this.#api === null) return;
    const workspace = await this.#api.terminal.loadWorkspace();
    // PTYs never survive the app, so restored panes come back as descriptors
    // offering a resume rather than as live terminals pretending to be alive.
    const panes = new Map<PaneId, PaneView>();
    for (const pane of workspace.panes) {
      panes.set(pane.paneId, {
        paneId: pane.paneId,
        spec: pane.spec,
        title: pane.title,
        state: { type: 'exited', exitCode: 0, signal: null, at: 0 },
      });
    }
    this.#panes.set(panes);
    this.#tabs.set(workspace.tabs);
    this.#activeTabId.set(workspace.activeTabId);
    this.#dockOpen.set(workspace.tabs.length > 0);
    this.#panelWidth.set(workspace.panelWidth ?? DEFAULT_PANEL_WIDTH);
    this.#panelCollapsed.set(workspace.panelCollapsed ?? false);
  }

  async openClaude(projectPath: string, launch: ClaudeLaunchSpec): Promise<PaneId | null> {
    return this.#open({ kind: 'claude', projectPath, launch, persistBuffer: false });
  }

  async openShell(projectPath: string): Promise<PaneId | null> {
    return this.#open({
      kind: 'shell',
      projectPath,
      profileId: LOGIN_SHELL_PROFILE,
      persistBuffer: true,
    });
  }

  async #open(spec: PaneSpec): Promise<PaneId | null> {
    if (this.#api === null) return null;
    this.#error.set(null);
    try {
      const handle = await this.#api.terminal.openPane(spec);
      this.#addPane(handle);
      this.#addTab(handle);
      this.#dockOpen.set(true);
      this.enterFocusMode();
      await this.persist();
      return handle.paneId;
    } catch (error) {
      this.#error.set(messageOf(error));
      return null;
    }
  }

  async closePane(paneId: PaneId, force = false): Promise<void> {
    await this.#api?.terminal.closePane(paneId, force);
    this.#panes.update((panes) => {
      const next = new Map(panes);
      next.delete(paneId);
      return next;
    });
    this.#tabs.update((tabs) => tabs.filter((tab) => !containsPane(tab.root, paneId)));
    if (this.activeTab() === null) this.#activeTabId.set(this.#tabs()[0]?.id ?? null);
    if (this.#tabs().length === 0) {
      this.#dockOpen.set(false);
      this.exitFocusMode();
    }
    await this.persist();
  }

  enterFocusMode(): void {
    this.#focusMode.set(true);
    this.#dockOpen.set(true);
  }

  /** Called on session end, on Esc, on the panel button and on navigation. */
  exitFocusMode(): void {
    if (!this.#focusMode()) return;
    this.#focusMode.set(false);
  }

  setPanelWidth(width: number): void {
    this.#panelWidth.set(Math.min(Math.max(width, MIN_PANEL_WIDTH), MAX_PANEL_WIDTH));
    void this.persist();
  }

  togglePanel(): void {
    this.#panelCollapsed.update((collapsed) => !collapsed);
    void this.persist();
  }

  selectTab(tabId: TabId): void {
    this.#activeTabId.set(tabId);
    this.#dockOpen.set(true);
    void this.persist();
  }

  toggleDock(): void {
    this.#dockOpen.update((open) => !open);
  }

  /** Raises the tab whose pane runs the given session, and focuses it. */
  focusSession(sessionId: SessionId): boolean {
    for (const pane of this.#panes().values()) {
      const state = pane.state;
      if (state.type === 'running' && state.sessionId === sessionId) {
        const tab = this.#tabs().find((candidate) => containsPane(candidate.root, pane.paneId));
        if (tab !== undefined) {
          this.selectTab(tab.id);
          this.enterFocusMode();
          return true;
        }
      }
    }
    return false;
  }

  async pickAndRegisterProject(): Promise<void> {
    if (this.#api === null) return;
    const path = await this.#api.terminal.pickDirectory('Projektordner hinzufügen');
    if (path === null) return;
    await this.#projects.add(path);
  }

  async persist(): Promise<void> {
    if (this.#api === null) return;
    const workspace: PersistedWorkspace = {
      version: 1,
      tabs: this.#tabs(),
      activeTabId: this.#activeTabId(),
      panes: [...this.#panes().values()].map((pane) => ({
        paneId: pane.paneId,
        spec: pane.spec,
        title: pane.title,
        sessionId: pane.state.type === 'running' ? pane.state.sessionId : null,
      })),
      panelWidth: this.#panelWidth(),
      panelCollapsed: this.#panelCollapsed(),
    };
    await this.#api.terminal.saveWorkspace(workspace);
  }

  #addPane(handle: PaneHandle): void {
    this.#panes.update((panes) => new Map(panes).set(handle.paneId, { ...handle }));
  }

  #updatePane(paneId: PaneId, update: (pane: PaneView) => PaneView): void {
    this.#panes.update((panes) => {
      const existing = panes.get(paneId);
      if (existing === undefined) return panes;
      return new Map(panes).set(paneId, update(existing));
    });
  }

  #addTab(handle: PaneHandle): void {
    const tab: TerminalTab = {
      id: uid() as TabId,
      title: handle.title,
      root: { type: 'leaf', paneId: handle.paneId },
      activePaneId: handle.paneId,
    };
    this.#tabs.update((tabs) => [...tabs, tab]);
    this.#activeTabId.set(tab.id);
  }
}

function containsPane(node: LayoutNode, paneId: PaneId): boolean {
  if (node.type === 'leaf') return node.paneId === paneId;
  return node.children.some((child) => containsPane(child, paneId));
}

/**
 * Errors arrive as CodeStationError, which carries a structured code alongside
 * the message. The code is what distinguishes "project folder is gone" from
 * "Claude CLI missing", so it is worth showing.
 */
function messageOf(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'error' in error) {
    const inner = (error as { error: { code?: unknown; message?: unknown } }).error;
    const code = typeof inner.code === 'string' ? inner.code : null;
    const message = typeof inner.message === 'string' ? inner.message : 'Unbekannter Fehler';
    return code === null ? message : `${message} (${code})`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
