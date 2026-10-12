import { BrowserWindow } from 'electron';
import { IPC_CHANNELS, type AppEvent, type AppEventType } from '@cs/shared';

type Listener = (event: AppEvent) => void;

/**
 * One event path for the whole app.
 *
 * RPC goes renderer↔indexer directly over a MessagePort because paginated
 * queries are high volume. Events deliberately route through main instead: they
 * are low frequency (progress is throttled, live status is coalesced) and main
 * needs to see them anyway, for the dock badge and notifications. Splitting them
 * would mean two subscriptions to the same facts.
 */
export class EventBus {
  readonly #listeners = new Set<Listener>();
  readonly #pending = new Map<string, AppEvent>();
  #flushHandle: ReturnType<typeof setTimeout> | null = null;

  /** Events of these types collapse to the latest within a flush window. */
  static readonly #COALESCED: ReadonlySet<AppEventType> = new Set([
    'live.changed',
    'index.progress',
    'index.projectsChanged',
  ]);

  constructor(private readonly flushMs = 120) {}

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(event: AppEvent): void {
    if (!EventBus.#COALESCED.has(event.type)) {
      this.#deliver(event);
      return;
    }
    // The status files flutter while a session is being typed into; without
    // coalescing the renderer would re-render on every keystroke upstream.
    this.#pending.set(this.#coalesceKey(event), event);
    this.#scheduleFlush();
  }

  #coalesceKey(event: AppEvent): string {
    return event.type;
  }

  #scheduleFlush(): void {
    if (this.#flushHandle !== null) return;
    this.#flushHandle = setTimeout(() => {
      this.#flushHandle = null;
      const batch = [...this.#pending.values()];
      this.#pending.clear();
      for (const event of batch) this.#deliver(event);
    }, this.flushMs);
  }

  #deliver(event: AppEvent): void {
    for (const listener of this.#listeners) listener(event);
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
      window.webContents.send(IPC_CHANNELS.event, event);
    }
  }

  dispose(): void {
    if (this.#flushHandle !== null) clearTimeout(this.#flushHandle);
    this.#flushHandle = null;
    this.#pending.clear();
    this.#listeners.clear();
  }
}
