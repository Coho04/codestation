import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PersistedWorkspace } from '@cs/shared';

const EMPTY: PersistedWorkspace = { version: 1, tabs: [], activeTabId: null, panes: [] };

/**
 * Persists the tab and layout tree, never the terminal buffer.
 *
 * Claude Code runs in the alternate screen buffer (the user has
 * `tui: "fullscreen"`), so it writes no scrollback at all — serialising a pane
 * would capture one screen and nothing more. The real history of those panes is
 * the transcript, which the indexer already owns.
 *
 * The format is already the target shape, with splits and profiles included, so
 * adding them later needs no migration.
 */
export class WorkspaceStore {
  constructor(private readonly userDataDir: string) {}

  get #path(): string {
    return join(this.userDataDir, 'workspace.json');
  }

  async load(): Promise<PersistedWorkspace> {
    try {
      const raw = await readFile(this.#path, 'utf8');
      const parsed = JSON.parse(raw) as PersistedWorkspace;
      if (parsed.version !== 1) return EMPTY;
      return {
        version: 1,
        tabs: Array.isArray(parsed.tabs) ? parsed.tabs : [],
        activeTabId: parsed.activeTabId ?? null,
        panes: Array.isArray(parsed.panes) ? parsed.panes : [],
      };
    } catch {
      return EMPTY;
    }
  }

  /** Written to a temporary file and renamed, so a crash cannot truncate it. */
  async save(workspace: PersistedWorkspace): Promise<void> {
    const temporary = `${this.#path}.tmp`;
    await writeFile(temporary, JSON.stringify(workspace, null, 2), 'utf8');
    await rename(temporary, this.#path);
  }
}
