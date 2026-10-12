/**
 * Errors as values.
 *
 * Electron flattens thrown `Error` objects across process boundaries to their
 * `message`, which would lose the discriminating code. Every call that can fail
 * across a boundary returns a `Result` instead of throwing.
 */
export type Result<T, E = AppError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export type AppErrorCode =
  | 'CLAUDE_NOT_FOUND'
  | 'CLAUDE_VERSION_UNREADABLE'
  | 'CWD_MISSING'
  | 'TCC_DENIED'
  | 'PANE_NOT_FOUND'
  | 'SESSION_NOT_FOUND'
  | 'INDEX_UNAVAILABLE'
  | 'DB_CORRUPT'
  | 'SPAWN_FAILED'
  | 'INTERNAL';

export interface AppError {
  readonly code: AppErrorCode;
  readonly message: string;
  /** Operator-facing detail: stderr tail, offending path, underlying errno. */
  readonly detail?: string;
}

export const appError = (
  code: AppErrorCode,
  message: string,
  detail?: string,
): AppError => (detail === undefined ? { code, message } : { code, message, detail });

/**
 * A real Error carrying a structured code.
 *
 * Throwing the plain data object would lose the stack trace, which is the one
 * thing that makes a failure debuggable locally. The code survives the process
 * boundary because the RPC layer serialises `.error`, not the Error itself —
 * Electron would flatten that to its message.
 */
export class CodeStationError extends Error {
  constructor(readonly error: AppError) {
    super(error.message);
    this.name = 'CodeStationError';
  }
}

export const throwAppError = (
  code: AppErrorCode,
  message: string,
  detail?: string,
): never => {
  throw new CodeStationError(appError(code, message, detail));
};
