import type { PaneId } from '../domain/ids.js';
import type { Result } from '../result.js';
import type { AppEvent } from './events.js';
import type { IndexApi } from './index-api.js';
import type { TerminalApi } from './terminal-api.js';

export type Unsubscribe = () => void;

/**
 * The same interface, but every method resolves to a Result instead of
 * rejecting.
 *
 * This is forced by Electron: when a function exposed through `contextBridge`
 * throws, only `message` and `stack` survive into the page — any custom field,
 * including the error code, is dropped. Returning the error as data keeps the
 * code intact, which is what tells "project folder is gone" apart from "Claude
 * CLI missing". The renderer converts it back into a rejection at its own edge.
 */
export type ResultApi<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R>
    ? (...args: A) => Promise<Result<R>>
    : never;
};

/**
 * `window.cs` — the entire surface the renderer has.
 *
 * Deliberately not a pass-through of `ipcRenderer`: no free-form channel name
 * reaches this object, so the main process stays the only place that decides
 * what is callable from a page that renders untrusted transcript text.
 */
/** What `window.cs` actually is. */
export interface CodeStationBridge {
  readonly appName: string;
  readonly index: ResultApi<IndexApi>;
  readonly terminal: ResultApi<TerminalApi>;
  onEvent(listener: (event: AppEvent) => void): Unsubscribe;
  readonly pty: PtyBridge;
}

/** What the renderer injects: the same calls, rejecting on failure. */
export interface CodeStationApi {
  readonly appName: string;
  readonly index: IndexApi;
  readonly terminal: TerminalApi;
  onEvent(listener: (event: AppEvent) => void): Unsubscribe;
  readonly pty: PtyBridge;
}

export interface PtyBridge {
  /**
   * Output arrives as strings: node-pty already decodes UTF-8 correctly across
   * chunk boundaries, and redoing that over bytes risks splitting codepoints.
   * The cost that matters is message count, which the main-side coalescer
   * handles.
   */
  attach(paneId: PaneId, onData: (chunk: string) => void): Unsubscribe;
  write(paneId: PaneId, data: string): void;
  /**
   * Credit-based backpressure. The renderer calls this from xterm's write
   * callback, which fires only once the chunk has actually been parsed — the
   * only honest signal that the terminal has kept up.
   */
  ack(paneId: PaneId, bytes: number): void;
}

export const IPC_CHANNELS = {
  terminalCall: 'cs:terminal',
  event: 'cs:event',
  indexPort: 'cs:index-port',
  ptyData: 'cs:pty:data',
  ptyWrite: 'cs:pty:write',
  ptyAck: 'cs:pty:ack',
} as const;
