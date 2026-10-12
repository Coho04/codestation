import { app, type BrowserWindow } from 'electron';

/**
 * Not cosmetic here: two instances would write the SQLite index twice, raise
 * duplicate notifications and race each other on workspace.json.
 *
 * Returns false when another instance already holds the lock — the caller must
 * quit immediately without doing any work.
 */
export function acquireSingleInstance(getWindow: () => BrowserWindow | null): boolean {
  if (!app.requestSingleInstanceLock()) {
    // Quitting without a word makes a second launch look like a crash — and it
    // silently swallows anything the second instance was asked to do.
    console.error(
      '[codestation] Eine andere Instanz läuft bereits und wurde in den Vordergrund geholt.',
    );
    return false;
  }

  app.on('second-instance', () => {
    const window = getWindow();
    if (window === null) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  return true;
}
