import { appError, CodeStationError, type AppError, type Result } from '../result.js';

/**
 * A minimal typed RPC over any message-passing channel.
 *
 * Exists so there is exactly one place that knows about channel wiring. Call
 * sites see the plain interface (`IndexApi`, `TerminalApi`), and a method added
 * to that interface without a matching handler is a compile error, not a
 * runtime "unknown channel".
 */

/**
 * `setTimeout` exists in every environment this package runs in — renderer,
 * Node utility process, Electron main — but pulling in the DOM or @types/node
 * libs just to name it would let environment-specific APIs leak into shared
 * code, which the lint boundary exists to prevent. A narrow view of
 * `globalThis` gets the two functions without the libraries.
 */
interface TimerApi {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
const timers = globalThis as unknown as TimerApi;

/** Any async-method interface can be served. */
export type AsyncApi = Record<string, (...args: never[]) => Promise<unknown>>;

export type RpcRequest<A> = {
  readonly k: 'req';
  readonly id: number;
  readonly method: keyof A & string;
  readonly args: readonly unknown[];
};

export type RpcResponse =
  | { readonly k: 'res'; readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly k: 'res'; readonly id: number; readonly ok: false; readonly error: AppError };

export type RpcMessage<A> = RpcRequest<A> | RpcResponse;

/** Structural, so the same code serves a MessagePort, a MessagePortMain or a mock. */
export interface RpcTransport {
  post(message: unknown): void;
  subscribe(listener: (message: unknown) => void): () => void;
}

export interface RpcClientOptions {
  /** Rejects a pending call rather than leaking it when the peer dies. */
  readonly timeoutMs?: number;
}

type Awaitable<T> = T extends Promise<infer U> ? U : T;

export function createRpcClient<A extends AsyncApi>(
  transport: RpcTransport,
  options: RpcClientOptions = {},
): A & { dispose(): void } {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: unknown }
  >();
  let nextId = 1;

  const unsubscribe = transport.subscribe((raw) => {
    const message = raw as RpcMessage<A>;
    if (message === null || typeof message !== 'object' || message.k !== 'res') return;
    const entry = pending.get(message.id);
    if (entry === undefined) return;
    pending.delete(message.id);
    timers.clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.value);
    else entry.reject(new CodeStationError(message.error));
  });

  const call = (method: string, args: readonly unknown[]): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = timers.setTimeout(() => {
        pending.delete(id);
        reject(new CodeStationError(appError('INTERNAL', `RPC timeout after ${timeoutMs} ms`, method)));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      transport.post({ k: 'req', id, method, args } satisfies RpcRequest<A>);
    });

  const dispose = (): void => {
    unsubscribe();
    for (const [, entry] of pending) {
      timers.clearTimeout(entry.timer);
      entry.reject(new CodeStationError(appError('INTERNAL', 'RPC transport disposed')));
    }
    pending.clear();
  };

  return new Proxy({} as A & { dispose(): void }, {
    get(_target, property: string | symbol) {
      if (property === 'dispose') return dispose;
      if (typeof property !== 'string') return undefined;
      return (...args: unknown[]) => call(property, args);
    },
  });
}

export type RpcHandlers<A extends AsyncApi> = {
  [K in keyof A]: (...args: Parameters<A[K]>) => Promise<Awaitable<ReturnType<A[K]>>> | Awaitable<ReturnType<A[K]>>;
};

export function serveRpc<A extends AsyncApi>(
  transport: RpcTransport,
  handlers: RpcHandlers<A>,
  onError?: (error: unknown, method: string) => AppError,
): () => void {
  return transport.subscribe((raw) => {
    const message = raw as RpcMessage<A>;
    if (message === null || typeof message !== 'object' || message.k !== 'req') return;

    const handler = handlers[message.method as keyof A] as
      | ((...args: unknown[]) => unknown)
      | undefined;

    if (typeof handler !== 'function') {
      transport.post({
        k: 'res',
        id: message.id,
        ok: false,
        error: appError('INTERNAL', `unknown RPC method: ${message.method}`),
      } satisfies RpcResponse);
      return;
    }

    void (async () => {
      try {
        const value = await handler(...message.args);
        transport.post({ k: 'res', id: message.id, ok: true, value } satisfies RpcResponse);
      } catch (error) {
        const mapped = onError?.(error, message.method) ?? toAppError(error);
        transport.post({ k: 'res', id: message.id, ok: false, error: mapped } satisfies RpcResponse);
      }
    })();
  });
}

export function toAppError(error: unknown): AppError {
  if (error instanceof CodeStationError) return error.error;
  if (error !== null && typeof error === 'object' && 'code' in error && 'message' in error) {
    return error as AppError;
  }
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  return appError('INTERNAL', message, stack);
}

/** For callers that want the error as a value rather than a rejection. */
export async function toResult<T>(promise: Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error: toAppError(error) };
  }
}
