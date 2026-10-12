import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  APP_NAME,
  INDEX_API_METHODS,
  IPC_CHANNELS,
  TERMINAL_API_METHODS,
  createRpcClient,
  CodeStationError,
  toAppError,
  type AppEvent,
  type CodeStationBridge,
  type IndexApi,
  type PaneId,
  type Result,
  type ResultApi,
  type RpcTransport,
  type TerminalApi,
  type Unsubscribe,
} from '@cs/shared';

/**
 * The index lives in a utility process and is reached over a MessagePort, so
 * main is not in the hot path for paginated queries and progress events. The
 * port arrives asynchronously after `did-finish-load`, so early calls are
 * queued against this promise rather than failing.
 */
let resolvePort: (port: MessagePort) => void;
const portReady = new Promise<MessagePort>((resolve) => {
  resolvePort = resolve;
});

ipcRenderer.on(IPC_CHANNELS.indexPort, (event: IpcRendererEvent) => {
  const port = event.ports[0];
  if (port === undefined) return;
  port.start();
  resolvePort(port);
});

const indexTransport: RpcTransport = {
  post: (message) => void portReady.then((port) => port.postMessage(message)),
  subscribe: (listener) => {
    const handler = (event: MessageEvent): void => listener(event.data);
    let attached: MessagePort | null = null;
    void portReady.then((port) => {
      attached = port;
      port.addEventListener('message', handler);
    });
    return () => attached?.removeEventListener('message', handler);
  },
};

const indexClient = createRpcClient<IndexApi & Record<string, (...a: never[]) => Promise<unknown>>>(
  indexTransport,
);

/**
 * contextBridge copies own enumerable properties, so the Proxy-based RPC client
 * cannot cross as-is — it has no own keys and would arrive empty. Both APIs are
 * therefore materialised from the exhaustive method lists in @cs/shared, which
 * fail to compile if they drift from the interface.
 */
function materialise<T extends object>(
  methods: readonly string[],
  call: (method: string, args: unknown[]) => Promise<unknown>,
): T {
  const target: Record<string, unknown> = {};
  for (const method of methods) {
    // Results, not rejections: contextBridge keeps only `message` and `stack`
    // of a thrown error, which would silently drop the error code.
    target[method] = async (...args: unknown[]): Promise<Result<unknown>> => {
      try {
        return { ok: true, value: await call(method, args) };
      } catch (error) {
        return { ok: false, error: toAppError(error) };
      }
    };
  }
  return target as T;
}

const index = materialise<ResultApi<IndexApi>>(INDEX_API_METHODS, (method, args) =>
  (indexClient as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]!(
    ...args,
  ),
);

/**
 * Terminal calls go to main over the classic invoke channel — it already is
 * request/response, so wrapping it in the RPC envelope would buy nothing. Main
 * answers with a Result so the error code survives; it is turned back into a
 * rejection here, which is what call sites expect.
 */
const terminal = materialise<ResultApi<TerminalApi>>(TERMINAL_API_METHODS, async (method, args) => {
  const result = (await ipcRenderer.invoke(
    IPC_CHANNELS.terminalCall,
    method,
    args,
  )) as Result<unknown>;
  if (result.ok) return result.value;
  throw new CodeStationError(result.error);
});

const onEvent = (listener: (event: AppEvent) => void): Unsubscribe => {
  const handler = (_event: IpcRendererEvent, payload: AppEvent): void => listener(payload);
  ipcRenderer.on(IPC_CHANNELS.event, handler);
  return () => {
    ipcRenderer.removeListener(IPC_CHANNELS.event, handler);
  };
};

const pty: CodeStationBridge['pty'] = {
  attach: (paneId: PaneId, onData: (chunk: string) => void): Unsubscribe => {
    const channel = `${IPC_CHANNELS.ptyData}:${paneId}`;
    const handler = (_event: IpcRendererEvent, chunk: string): void => onData(chunk);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
  write: (paneId: PaneId, data: string): void => {
    ipcRenderer.send(IPC_CHANNELS.ptyWrite, paneId, data);
  },
  ack: (paneId: PaneId, bytes: number): void => {
    ipcRenderer.send(IPC_CHANNELS.ptyAck, paneId, bytes);
  },
};

const bridge: CodeStationBridge = { appName: APP_NAME, index, terminal, onEvent, pty };

contextBridge.exposeInMainWorld('cs', bridge);
