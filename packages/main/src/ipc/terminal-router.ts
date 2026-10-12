import { ipcMain } from 'electron';
import {
  IPC_CHANNELS,
  TERMINAL_API_METHODS,
  toAppError,
  type Result,
  type TerminalApi,
} from '@cs/shared';

type AnyHandler = (...args: never[]) => unknown;

/**
 * Single invoke channel with a method name, rather than one channel per call.
 *
 * The method is matched against the exhaustive list from @cs/shared, so a
 * renderer — or anything that got code execution in it — cannot reach a handler
 * that is not part of the published contract.
 */
export function installTerminalRouter(api: TerminalApi): () => void {
  const allowed = new Set<string>(TERMINAL_API_METHODS);

  ipcMain.handle(
    IPC_CHANNELS.terminalCall,
    async (_event, method: unknown, args: unknown): Promise<Result<unknown>> => {
      if (typeof method !== 'string' || !allowed.has(method)) {
        return { ok: false, error: toAppError(new Error(`unknown terminal method: ${String(method)}`)) };
      }
      if (!Array.isArray(args)) {
        return { ok: false, error: toAppError(new Error(`malformed arguments for ${method}`)) };
      }
      try {
        const handler = (api as unknown as Record<string, AnyHandler>)[method];
        if (typeof handler !== 'function') {
          return { ok: false, error: toAppError(new Error(`unimplemented: ${method}`)) };
        }
        const value: unknown = await (handler as (...a: unknown[]) => unknown).apply(api, args);
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: toAppError(error) };
      }
    },
  );

  return () => ipcMain.removeHandler(IPC_CHANNELS.terminalCall);
}
