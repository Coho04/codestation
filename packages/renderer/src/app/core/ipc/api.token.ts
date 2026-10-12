import { InjectionToken } from '@angular/core';
import {
  CodeStationError,
  INDEX_API_METHODS,
  TERMINAL_API_METHODS,
  type CodeStationApi,
  type CodeStationBridge,
  type Result,
} from '@cs/shared';

declare global {
  interface Window {
    readonly cs?: CodeStationBridge;
  }
}

/**
 * The single seam between the app and the outside world.
 *
 * Components and stores inject this token, never `window.cs`, so a test can
 * supply a fake with a controllable event stream without touching globals.
 */
export const CS_API = new InjectionToken<CodeStationApi>('CodeStationApi');

/**
 * Turns the bridge's Results back into rejections.
 *
 * The bridge has to return Results because Electron's contextBridge drops
 * everything but `message` and `stack` from a thrown error — including the error
 * code. Unwrapping happens here, once, so call sites keep ordinary async
 * ergonomics and still get a CodeStationError carrying the code.
 */
function unwrap<T extends object>(source: Record<string, unknown>, methods: readonly string[]): T {
  const target: Record<string, unknown> = {};
  for (const method of methods) {
    target[method] = async (...args: unknown[]): Promise<unknown> => {
      const call = source[method] as (...a: unknown[]) => Promise<Result<unknown>>;
      const result = await call(...args);
      if (result.ok) return result.value;
      throw new CodeStationError(result.error);
    };
  }
  return target as T;
}

/** Null when the page runs in a plain browser tab rather than inside Electron. */
export function resolveBridge(): CodeStationApi | null {
  const bridge = typeof window === 'undefined' ? undefined : window.cs;
  if (bridge === undefined) return null;

  return {
    appName: bridge.appName,
    index: unwrap(bridge.index as unknown as Record<string, unknown>, INDEX_API_METHODS),
    terminal: unwrap(bridge.terminal as unknown as Record<string, unknown>, TERMINAL_API_METHODS),
    onEvent: (listener) => bridge.onEvent(listener),
    pty: bridge.pty,
  };
}
