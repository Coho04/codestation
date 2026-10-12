import { MessageChannelMain, utilityProcess, type UtilityProcess, type WebContents } from 'electron';
import { existsSync } from 'node:fs';
import { IPC_CHANNELS, type AppEvent } from '@cs/shared';
import type { EventBus } from './ipc/event-bus.js';

/**
 * Owns the indexer utility process and the MessagePort handed to the renderer.
 *
 * A utility process rather than a worker thread or main itself: better-sqlite3
 * is synchronous, so an 8 MiB batch insert on the main thread would stall window
 * IPC. Here a crash takes the index down, not the app — and the index is
 * rebuildable in about a minute, so restarting is a real recovery, not a
 * pretence.
 */
export interface IndexerInit {
  readonly kind: 'init';
  readonly dbPath: string;
  readonly home: string;
  readonly appVersion: string;
  readonly claudeBinaryPath: string | null;
}

export class IndexerHost {
  #child: UtilityProcess | null = null;
  #init: IndexerInit | null = null;
  #restartCount = 0;
  #lastRestartAt = 0;
  #disposed = false;
  #pendingRenderers = new Set<WebContents>();

  constructor(
    private readonly entryPath: string,
    private readonly bus: EventBus,
  ) {}

  configure(init: IndexerInit): void {
    this.#init = init;
  }

  start(): void {
    if (this.#disposed || this.#child !== null) return;

    // Fail loudly. A missing entry point used to leave the app running with an
    // index that silently never filled, which is far harder to diagnose than a
    // startup error.
    if (!existsSync(this.entryPath)) {
      console.error(`[indexer] entry point not found: ${this.entryPath}`);
      this.bus.emit({
        type: 'index.progress',
        progress: {
          phase: 'idle',
          filesTotal: 0,
          filesDone: 0,
          bytesTotal: 0,
          bytesDone: 0,
          currentPath: null,
          etaMs: null,
          cancellable: false,
          unknownRecordTypes: [],
          decodeErrors: -1,
        },
      });
      return;
    }

    const child = utilityProcess.fork(this.entryPath, [], {
      serviceName: 'codestation-indexer',
      stdio: 'inherit',
    });
    this.#child = child;

    child.on('message', (message: unknown) => {
      if (isAppEvent(message)) this.bus.emit(message);
    });

    // Sent before any port so the indexer can open its database and begin the
    // registry phase while the renderer is still loading.
    if (this.#init !== null) child.postMessage(this.#init);

    child.on('exit', (code) => {
      this.#child = null;
      if (this.#disposed) return;
      console.error(`[indexer] exited with code ${code}`);
      this.#scheduleRestart();
    });

    // Renderers that asked for a port before the process existed get one now.
    for (const contents of this.#pendingRenderers) this.#handOverPort(child, contents);
  }

  /**
   * Connects a renderer, and reconnects it on every subsequent load.
   *
   * A reload discards the old MessagePort along with the page. Handing one over
   * only at startup would leave the renderer permanently cut off from the index
   * after any reload or crash recovery — with no error, just queries that never
   * resolve.
   */
  connectRenderer(contents: WebContents): void {
    this.#pendingRenderers.add(contents);
    contents.once('destroyed', () => this.#pendingRenderers.delete(contents));
    contents.on('did-finish-load', () => {
      if (this.#child !== null) this.#handOverPort(this.#child, contents);
    });
    if (this.#child !== null) this.#handOverPort(this.#child, contents);
  }

  #handOverPort(child: UtilityProcess, contents: WebContents): void {
    if (contents.isDestroyed()) return;
    const { port1, port2 } = new MessageChannelMain();
    child.postMessage({ kind: 'rpc-port' }, [port1]);
    contents.postMessage(IPC_CHANNELS.indexPort, null, [port2]);
  }

  #scheduleRestart(): void {
    const now = Date.now();
    // A crash loop must not spin: the counter decays once the process has
    // managed to stay alive for a minute.
    if (now - this.#lastRestartAt > 60_000) this.#restartCount = 0;
    this.#lastRestartAt = now;
    this.#restartCount += 1;
    if (this.#restartCount > 5) {
      console.error('[indexer] too many restarts; giving up until the app is restarted');
      // decodeErrors = -1 is the renderer's signal that the index is dead, not
      // merely empty. An index that silently never fills is the worst outcome.
      this.bus.emit({
        type: 'index.progress',
        progress: {
          phase: 'idle',
          filesTotal: 0,
          filesDone: 0,
          bytesTotal: 0,
          bytesDone: 0,
          currentPath: null,
          etaMs: null,
          cancellable: false,
          unknownRecordTypes: [],
          decodeErrors: -1,
        },
      });
      return;
    }
    const delay = Math.min(1000 * 2 ** (this.#restartCount - 1), 30_000);
    setTimeout(() => this.start(), delay);
  }

  dispose(): void {
    this.#disposed = true;
    this.#child?.kill();
    this.#child = null;
    this.#pendingRenderers.clear();
  }
}

function isAppEvent(value: unknown): value is AppEvent {
  return typeof value === 'object' && value !== null && typeof (value as AppEvent).type === 'string';
}
