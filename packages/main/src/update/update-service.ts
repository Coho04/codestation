import type { ReleaseInfo, UpdateMode, UpdatePhase, UpdateStatus } from '@cs/shared';
import { selectUpdate } from './release-feed.js';
import type { AutoUpdaterPort, ReleaseSource } from './ports.js';

export interface UpdateServiceDeps {
  readonly currentVersion: string;
  /** `process.arch` — decides which .dmg asset is offered. */
  readonly arch: string;
  readonly mode: UpdateMode;
  readonly source: ReleaseSource;
  readonly now: () => number;
  readonly emit: (status: UpdateStatus) => void;
}

/** Six hours. Releases are rare; checking more often only costs rate limit. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/**
 * Startup is the worst moment for a network call: the index import is running
 * and the window is still painting. The first check waits for both.
 */
export const INITIAL_DELAY_MS = 30_000;

/**
 * Owns the update state and is the only thing that mutates it.
 *
 * Checking and installing are separate on purpose. The check works in every
 * build and never touches the bundle; installing requires Squirrel.Mac and a
 * Developer-ID signature. Keeping them apart means a build that cannot install
 * still tells the user that something newer exists, instead of staying silent.
 */
export class UpdateService {
  #phase: UpdatePhase = { kind: 'idle' };
  #lastCheckedAt: number | null = null;
  #checksEnabled = true;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #inFlight: Promise<UpdateStatus> | null = null;
  #autoUpdater: AutoUpdaterPort | null = null;

  constructor(private readonly deps: UpdateServiceDeps) {}

  get status(): UpdateStatus {
    return {
      currentVersion: this.deps.currentVersion,
      // A missing auto-updater outranks the configured mode: the mode is a
      // build-time intent, the port is the fact.
      mode: this.#autoUpdater === null && this.deps.mode === 'auto' ? 'manual' : this.deps.mode,
      phase: this.#phase,
      lastCheckedAt: this.#lastCheckedAt,
      checksEnabled: this.#checksEnabled,
    };
  }

  configure(options: { readonly checksEnabled: boolean }): void {
    this.#checksEnabled = options.checksEnabled;
  }

  /**
   * Supplied once Squirrel.Mac has been loaded, which is asynchronous and
   * happens after the service exists. Until then — and forever, in a build
   * that cannot install itself — the service reports `manual`.
   */
  attachAutoUpdater(port: AutoUpdaterPort | null): void {
    this.#autoUpdater = port;
    this.#publish();
  }

  setChecksEnabled(enabled: boolean): UpdateStatus {
    if (this.#checksEnabled === enabled) return this.status;
    this.#checksEnabled = enabled;
    if (!enabled) {
      this.stop();
      // Drop a pending offer too — leaving a banner up after the user switched
      // checks off would be the app arguing with them.
      this.#phase = { kind: 'idle' };
    } else {
      this.start();
    }
    return this.#publish();
  }

  /** Background schedule. Safe to call repeatedly. */
  start(): void {
    if (this.deps.mode === 'disabled' || !this.#checksEnabled || this.#timer !== null) return;
    const tick = (delay: number): void => {
      this.#timer = setTimeout(() => {
        this.#timer = null;
        void this.check().finally(() => tick(CHECK_INTERVAL_MS));
      }, delay);
      // A pending check must never be the reason the app stays alive.
      this.#timer.unref?.();
    };
    tick(INITIAL_DELAY_MS);
  }

  stop(): void {
    if (this.#timer === null) return;
    clearTimeout(this.#timer);
    this.#timer = null;
  }

  /**
   * One check at a time: the user can press the button while the background
   * timer is already fetching, and two checks would race over the phase.
   */
  check(): Promise<UpdateStatus> {
    if (this.#inFlight !== null) return this.#inFlight;
    this.#inFlight = this.#check().finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  async #check(): Promise<UpdateStatus> {
    if (this.deps.mode === 'disabled') return this.status;

    // A downloaded update is a terminal state; re-checking must not discard it.
    if (this.#phase.kind === 'ready' || this.#phase.kind === 'downloading') return this.status;

    this.#phase = { kind: 'checking' };
    this.#publish();
    try {
      const releases = await this.deps.source.list();
      const release = selectUpdate(releases, {
        currentVersion: this.deps.currentVersion,
        arch: this.deps.arch,
      });
      this.#lastCheckedAt = this.deps.now();
      this.#phase = release === null ? { kind: 'current' } : { kind: 'available', release };
    } catch (error) {
      // No network, rate limit, offline — all the same to the user, and none of
      // them is worth a dialog. The status bar carries it.
      this.#phase = { kind: 'error', message: messageOf(error) };
    }
    return this.#publish();
  }

  async download(): Promise<UpdateStatus> {
    const updater = this.#autoUpdater;
    const release = releaseOf(this.#phase);
    if (updater === null || release === null) return this.status;
    if (this.#phase.kind === 'downloading' || this.#phase.kind === 'ready') return this.status;

    this.#phase = { kind: 'downloading', release, percent: 0 };
    this.#publish();
    try {
      await updater.downloadAndStage((percent) => {
        // Guard against a late callback after the phase moved on.
        if (this.#phase.kind !== 'downloading') return;
        this.#phase = { kind: 'downloading', release, percent: clampPercent(percent) };
        this.#publish();
      });
      this.#phase = { kind: 'ready', release };
    } catch (error) {
      this.#phase = { kind: 'error', message: messageOf(error) };
    }
    return this.#publish();
  }

  install(): void {
    if (this.#phase.kind !== 'ready') return;
    this.#autoUpdater?.quitAndInstall();
  }

  dispose(): void {
    this.stop();
  }

  #publish(): UpdateStatus {
    const status = this.status;
    this.deps.emit(status);
    return status;
  }
}

function releaseOf(phase: UpdatePhase): ReleaseInfo | null {
  switch (phase.kind) {
    case 'available':
    case 'downloading':
    case 'ready':
      return phase.release;
    case 'idle':
    case 'checking':
    case 'current':
    case 'error':
      return null;
  }
}

const clampPercent = (value: number): number =>
  Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 0;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
