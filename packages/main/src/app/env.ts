/** Resolved once at startup so dev/prod branching never leaks into feature code. */
export interface RuntimeEnv {
  /** True when the renderer is served by the Angular dev server. */
  readonly useDevServer: boolean;
  /** Origin of the Angular dev server, or null when serving the built bundle. */
  readonly devServerOrigin: string | null;
}

/**
 * Whether a dev server exists is a property of *how the app was launched*, not
 * of whether it was packaged: `electron .` against a built renderer has
 * `app.isPackaged === false` but no dev server to connect to. `scripts/dev.mjs`
 * is the only thing that sets CS_DEV, so the signal cannot drift.
 */
export function resolveRuntimeEnv(): RuntimeEnv {
  const useDevServer = process.env['CS_DEV'] === '1';
  const port = process.env['CS_DEV_PORT'] ?? '4200';
  return {
    useDevServer,
    devServerOrigin: useDevServer ? `http://localhost:${port}` : null,
  };
}
