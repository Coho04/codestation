import { existsSync } from 'node:fs';
import type { AppUpdater } from 'electron-updater';
import { join } from 'node:path';
import type { AutoUpdaterPort } from './ports.js';

/**
 * electron-updater, loaded only if this build can actually use it.
 *
 * The import is dynamic for two reasons: the module pulls in a sizeable
 * dependency tree that a `manual` build never needs, and it reaches for
 * `app-update.yml` eagerly — in a build without one it throws on first use
 * rather than returning an error.
 *
 * Returns `null` when the update cannot be applied in place, which the service
 * treats as "manual mode" regardless of what the build intended.
 */
export async function createElectronAutoUpdater(
  resourcesPath: string,
): Promise<AutoUpdaterPort | null> {
  // Written by electron-builder from the `publish` block. Missing it means the
  // bundle was built without a release target and has nowhere to look.
  if (!existsSync(join(resourcesPath, 'app-update.yml'))) return null;

  let autoUpdater: AppUpdater;
  try {
    ({ autoUpdater } = await import('electron-updater'));
  } catch {
    return null;
  }

  // The app decides when to download and when to restart, not the library:
  // a download that starts by itself would compete with the index import, and
  // an install on quit would silently swap the bundle under a running session.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  return {
    async downloadAndStage(onProgress: (percent: number) => void): Promise<void> {
      // electron-updater will only download what its own check found, so this
      // runs again here even though the service already knows what is out
      // there. That is the point: this check reads the signed latest-mac.yml,
      // which is what Squirrel verifies against.
      const result = await autoUpdater.checkForUpdates();
      if (result === null) throw new Error('Kein Update verfügbar');

      const onDownloadProgress = (progress: { percent: number }): void => {
        onProgress(progress.percent);
      };
      autoUpdater.on('download-progress', onDownloadProgress);
      try {
        await autoUpdater.downloadUpdate(result.cancellationToken);
      } finally {
        autoUpdater.off('download-progress', onDownloadProgress);
      }
    },

    quitAndInstall(): void {
      // isSilent=false so macOS shows the usual progress; isForceRunAfter=true
      // so the app comes back up instead of just disappearing.
      autoUpdater.quitAndInstall(false, true);
    },
  };
}
