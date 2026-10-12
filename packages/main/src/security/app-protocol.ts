import { protocol, net } from 'electron';
import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_SCHEME } from '@cs/shared';

/**
 * Serves the built renderer from a custom `app://` scheme instead of `file://`.
 *
 * Two reasons this is worth 40 lines: `file://` pages have an opaque origin, so
 * a `default-src 'self'` CSP means nothing there, and relative asset paths plus
 * `fetch` behave differently than they do in the dev server. With a real origin
 * dev and production take the same code path.
 *
 * Must run before `app.whenReady()`.
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
}

/** Must run after `app.whenReady()`. `rendererRoot` is the directory holding index.html. */
export function serveRenderer(rendererRoot: string): void {
  const rootWithSep = rendererRoot.endsWith(sep) ? rendererRoot : rendererRoot + sep;

  protocol.handle(APP_SCHEME, async (request) => {
    const { pathname } = new URL(request.url);
    const decoded = decodeURIComponent(pathname);
    const candidate = normalize(join(rendererRoot, decoded === '/' ? 'index.html' : decoded));

    // Path traversal guard: anything that escapes the renderer root falls back
    // to index.html rather than leaking a file from elsewhere on disk.
    const target = candidate.startsWith(rootWithSep) ? candidate : join(rendererRoot, 'index.html');

    const response = await net.fetch(pathToFileURL(target).toString());
    if (response.status === 404) {
      // Client-side routes have no file on disk; hand them the SPA shell.
      return net.fetch(pathToFileURL(join(rendererRoot, 'index.html')).toString());
    }
    return response;
  });
}
