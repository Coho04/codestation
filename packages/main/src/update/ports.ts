import type { GithubRelease } from './release-feed.js';

/** Where the list of published releases comes from. */
export interface ReleaseSource {
  list(): Promise<readonly GithubRelease[]>;
}

/**
 * The Squirrel.Mac side, present only in a build that can actually install by
 * itself. Kept behind a port so the service — and its tests — never load
 * electron-updater, which insists on a packaged app and a real app-update.yml.
 */
export interface AutoUpdaterPort {
  /** Downloads and stages the update; resolves once it is ready to install. */
  downloadAndStage(onProgress: (percent: number) => void): Promise<void>;
  /** Quits the app and relaunches into the staged version. */
  quitAndInstall(): void;
}
