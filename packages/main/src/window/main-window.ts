import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { APP_NAME, APP_SCHEME } from '@cs/shared';
import type { RuntimeEnv } from '../app/env.js';

/**
 * Security baseline. `sandbox: true` holds because the preload touches nothing
 * but `ipcRenderer` and a MessagePort — node-pty and SQLite live in the main and
 * indexer processes respectively. If that ever stops being true, the architecture
 * has been lost, not just a flag.
 */
export function createMainWindow(env: RuntimeEnv, preloadPath: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d1117',
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  window.once('ready-to-show', () => window.show());

  if (env.devServerOrigin !== null) {
    void window.loadURL(env.devServerOrigin);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    void window.loadURL(`${APP_SCHEME}://-/index.html`);
  }

  return window;
}

export function rendererRootPath(appPath: string): string {
  return join(appPath, 'packages/renderer/dist/renderer/browser');
}
