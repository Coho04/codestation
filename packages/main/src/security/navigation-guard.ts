import { app, shell } from 'electron';

/**
 * The renderer displays Claude transcript text and live terminal output, and the
 * xterm weblinks addon makes URLs in that output clickable. Neither source is
 * trusted, so the window itself must never navigate anywhere and must never open
 * a child window. External links go through an explicit IPC handler instead.
 */
export function installNavigationGuard(allowedOrigins: readonly string[]): void {
  const allowed = new Set(allowedOrigins);

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));

    contents.on('will-navigate', (event, url) => {
      let origin: string;
      try {
        origin = new URL(url).origin;
      } catch {
        event.preventDefault();
        return;
      }
      if (!allowed.has(origin)) event.preventDefault();
    });

    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}

/** The single sanctioned way out to the system browser. */
export async function openExternal(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  await shell.openExternal(parsed.toString());
  return true;
}
