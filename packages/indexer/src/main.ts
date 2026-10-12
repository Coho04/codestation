import { homedir } from 'node:os';
import { serveRpc, type AppEvent, type IndexApi, type RpcTransport } from '@cs/shared';
import { buildIndexer, type Indexer } from './composition-root.js';
import { createRequestHandlers } from './api/request-handlers.js';
import { EventPublisher } from './api/event-publisher.js';
import { WatchController } from './watch/watch-controller.js';

/**
 * Electron's utilityProcess plumbing, declared structurally rather than imported.
 *
 * The indexer deliberately has no dependency on `electron`: it is a plain Node
 * process that owns a SQLite connection, and keeping it that way is what makes
 * it testable and independently restartable.
 */
interface MessagePortLike {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  start(): void;
}
interface ParentPortLike {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown; ports: MessagePortLike[] }) => void): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort;

interface InitMessage {
  readonly kind: 'init';
  readonly dbPath: string;
  readonly home: string;
  readonly appVersion: string;
  readonly claudeBinaryPath: string | null;
}

let indexer: Indexer | null = null;
let publisher: EventPublisher | null = null;
let watchController: WatchController | null = null;

const emit = (event: AppEvent): void => {
  parentPort?.postMessage(event);
};

function start(init: InitMessage): void {
  if (indexer !== null) return;

  publisher = new EventPublisher(emit);

  try {
    indexer = buildIndexer({
      dbPath: init.dbPath,
      home: init.home,
      appVersion: init.appVersion,
      claudeBinaryPath: init.claudeBinaryPath,
      onProgress: (progress) => publisher?.progress(progress),
    });
  } catch (error) {
    // A corrupt or newer-schema database must say so, not leave a blank window.
    console.error('[indexer] failed to open the index', error);
    process.exit(2);
  }

  const built = indexer;

  void (async () => {
    await built.scheduler.runFullImport();
    built.linker.link();
    await built.plansIngestor.sync();
    built.costs.recomputeAll();
    built.costs.rebuildDaily();
    publisher?.projectsChanged();
  })();

  watchController = new WatchController(built, publisher, emit);
  watchController.start();
}

function attachRpcPort(port: MessagePortLike): void {
  port.start();

  const transport: RpcTransport = {
    post: (message) => port.postMessage(message),
    subscribe: (listener) => {
      const handler = (event: { data: unknown }): void => listener(event.data);
      port.on('message', handler);
      return () => {
        /* the port is closed with the renderer; nothing to detach */
      };
    },
  };

  const handlers = (): IndexApi => {
    if (indexer === null) throw new Error('index not ready');
    return createRequestHandlers(indexer);
  };

  serveRpc<IndexApi & Record<string, (...args: never[]) => Promise<unknown>>>(
    transport,
    new Proxy({} as never, {
      get: (_target, property: string) =>
        (...args: unknown[]) =>
          (handlers() as unknown as Record<string, (...a: unknown[]) => unknown>)[property]!(...args),
    }),
  );
}

parentPort?.on('message', (event) => {
  const data = event.data as { kind?: string } | null;
  if (data?.kind === 'init') start(data as unknown as InitMessage);
  if (data?.kind === 'rpc-port') {
    const port = event.ports[0];
    if (port !== undefined) attachRpcPort(port);
  }
});

process.on('uncaughtException', (error) => {
  console.error('[indexer] uncaught', error);
});

// Standalone use (tests, a future CLI): fall back to sensible defaults.
if (parentPort === undefined) {
  start({
    kind: 'init',
    dbPath: process.env['CS_DB_PATH'] ?? ':memory:',
    home: homedir(),
    appVersion: process.env['CS_APP_VERSION'] ?? '0.0.0',
    claudeBinaryPath: process.env['CS_CLAUDE_BIN'] ?? null,
  });
}
