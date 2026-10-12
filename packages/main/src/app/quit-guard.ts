import { app, dialog, type BrowserWindow } from 'electron';
import type { PtyManager } from '../terminal/pty-manager.js';

/**
 * Asks before killing running sessions.
 *
 * PTYs cannot survive the app: the master file descriptor belongs to this
 * process. That is not something to paper over, so the user is told exactly what
 * is about to end — and the transcripts survive regardless, so every one of them
 * can be resumed afterwards.
 */
export function installQuitGuard(
  getPanes: () => PtyManager,
  getWindow: () => BrowserWindow | null,
): void {
  let confirmed = false;

  app.on('before-quit', (event) => {
    if (confirmed) return;
    const panes = getPanes();
    const live = panes.registry.all().filter((pane) => pane.pty !== null);
    if (live.length === 0) return;

    event.preventDefault();

    const window = getWindow();
    const names = live.map((pane) => `• ${pane.title}`).join('\n');
    const options = {
      type: 'warning' as const,
      buttons: ['Beenden', 'Abbrechen'],
      defaultId: 1,
      cancelId: 1,
      title: 'Laufende Sessions beenden?',
      message: `${String(live.length)} laufende Session(s) werden beendet.`,
      detail: `${names}\n\nDie Transcripts bleiben erhalten — jede Session lässt sich danach fortsetzen.`,
    };

    const choice =
      window === null
        ? dialog.showMessageBoxSync(options)
        : dialog.showMessageBoxSync(window, options);

    if (choice === 0) {
      confirmed = true;
      void panes.disposeAll().finally(() => app.quit());
    }
  });
}
