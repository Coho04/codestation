import type { PaneHandle, PaneId, PaneSpec, PaneState, SessionId } from '@cs/shared';
import type { PtyHandle } from './pty-port.js';
import type { FlowControl } from './flow-control.js';
import type { OutputCoalescer } from './output-coalescer.js';
import type { RingBuffer } from './ring-buffer.js';

export interface PaneRecord {
  readonly paneId: PaneId;
  readonly spec: PaneSpec;
  title: string;
  state: PaneState;
  pty: PtyHandle | null;
  readonly coalescer: OutputCoalescer;
  readonly flow: FlowControl;
  readonly buffer: RingBuffer;
  readonly spawnedAt: number;
  /** Known up front for a new session, resolved later for a fork. */
  sessionId: SessionId | null;
  readonly cliVersion: string | null;
  cols: number;
  rows: number;
}

/**
 * Keyed by pane, never by tab.
 *
 * This is the single most consequential line in the terminal layer: a tab holds
 * a tree of panes, and keying anything by tab would have to be undone across
 * main, IPC and renderer at the same time the day splits are added.
 */
export class PaneRegistry {
  readonly #panes = new Map<PaneId, PaneRecord>();

  add(record: PaneRecord): void {
    this.#panes.set(record.paneId, record);
  }

  get(paneId: PaneId): PaneRecord | null {
    return this.#panes.get(paneId) ?? null;
  }

  remove(paneId: PaneId): PaneRecord | null {
    const record = this.#panes.get(paneId);
    this.#panes.delete(paneId);
    return record ?? null;
  }

  all(): PaneRecord[] {
    return [...this.#panes.values()];
  }

  /** Panes still waiting for the CLI to publish their session id. */
  unbound(): PaneRecord[] {
    return this.all().filter((pane) => pane.sessionId === null && pane.state.type === 'binding');
  }

  bySessionId(sessionId: string): PaneRecord | null {
    return this.all().find((pane) => pane.sessionId === sessionId) ?? null;
  }

  byPid(pid: number): PaneRecord | null {
    return this.all().find((pane) => pane.pty?.pid === pid) ?? null;
  }

  sessionBindings(): Map<string, PaneId> {
    const map = new Map<string, PaneId>();
    for (const pane of this.all()) {
      if (pane.sessionId !== null) map.set(pane.sessionId, pane.paneId);
    }
    return map;
  }

  toHandle(record: PaneRecord): PaneHandle {
    return { paneId: record.paneId, spec: record.spec, title: record.title, state: record.state };
  }
}
