/**
 * Update model.
 *
 * Two modes exist because macOS makes them genuinely different problems:
 *
 *  - `auto`   — Squirrel.Mac replaces the bundle in place. It verifies that the
 *               downloaded app carries a valid Developer-ID signature, so this
 *               only works for a notarized Developer-ID build.
 *  - `manual` — the app only *looks* at the GitHub releases and points at the
 *               download. Works with any build, including a locally signed one.
 *
 * The mode is decided at build time, not at runtime, and the renderer treats it
 * as data: the same view serves both, it just offers "install" instead of
 * "download" when the running build can install by itself.
 */
export type UpdateMode = 'auto' | 'manual' | 'disabled';

export interface ReleaseInfo {
  /** Without the leading `v`. */
  readonly version: string;
  readonly name: string | null;
  readonly notes: string | null;
  readonly publishedAt: number | null;
  /** The release page a human can open. */
  readonly url: string;
  /** Direct link to the .dmg for this architecture, if the release has one. */
  readonly downloadUrl: string | null;
}

export type UpdatePhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  /** Checked, nothing newer than what is running. */
  | { readonly kind: 'current' }
  | { readonly kind: 'available'; readonly release: ReleaseInfo }
  | { readonly kind: 'downloading'; readonly release: ReleaseInfo; readonly percent: number }
  /** Downloaded and verified; applied on the next restart. `auto` only. */
  | { readonly kind: 'ready'; readonly release: ReleaseInfo }
  | { readonly kind: 'error'; readonly message: string };

export interface UpdateStatus {
  readonly currentVersion: string;
  readonly mode: UpdateMode;
  readonly phase: UpdatePhase;
  readonly lastCheckedAt: number | null;
  /** User setting. When off, nothing is fetched — not even in the background. */
  readonly checksEnabled: boolean;
}
