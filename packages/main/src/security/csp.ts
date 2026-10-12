import type { Session } from 'electron';

/**
 * Applied via `onHeadersReceived` rather than a `<meta>` tag so the dev server
 * and the packaged `app://` build go through the same code.
 *
 * `style-src 'unsafe-inline'` is unavoidable: Angular injects component styles
 * as inline <style> elements.
 */
export function applyContentSecurityPolicy(session: Session, devServerOrigin: string | null): void {
  const connect = ["'self'"];
  const script = ["'self'"];

  if (devServerOrigin !== null) {
    const ws = devServerOrigin.replace(/^http/, 'ws');
    connect.push(devServerOrigin, ws);
  }

  const policy = [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "object-src 'none'",
    // 'none' would block Angular's own <base href="./">; 'self' still prevents
    // relative URLs from being redirected to another origin.
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join('; ');

  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}
