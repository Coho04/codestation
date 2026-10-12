/**
 * Single source of truth for the application's identity.
 *
 * `BUNDLE_ID` is frozen once the first signed build exists: macOS binds TCC
 * grants (Documents / Desktop / Downloads access) to the pair
 * (bundle id, code signing identity). Changing it silently revokes every
 * folder permission the user has granted, and — because the PTY children
 * inherit those grants — breaks Claude sessions in roughly a third of the
 * user's projects.
 */
export const APP_NAME = 'CodeStation';
export const BUNDLE_ID = 'de.mediacologne.codestation';

/** Scheme used to serve the renderer in production. Gives the page a real origin. */
export const APP_SCHEME = 'app';

/** Prefix for every IPC channel, so a stray `send` cannot collide with Electron internals. */
export const IPC_PREFIX = 'cs';

/**
 * Where releases live. Used by the update check and by every "download" link in
 * the UI, so the repository is named in exactly one place.
 */
export const REPO_OWNER = 'Coho04';
export const REPO_NAME = 'codestation';
export const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
export const RELEASES_URL = `${REPO_URL}/releases`;
