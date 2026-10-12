import { Injectable, computed, inject, signal } from '@angular/core';
import { RELEASES_URL, type ReleaseInfo, type UpdateStatus } from '@cs/shared';
import { CS_API } from '../ipc/api.token';
import { EventBus } from '../ipc/event-bus';

/**
 * Projection of the main process's update state.
 *
 * Holds no logic of its own beyond deriving what the view needs: the main
 * process owns the state machine, and every transition arrives as an event, so
 * a check started from anywhere is reflected everywhere.
 */
@Injectable({ providedIn: 'root' })
export class UpdateStore {
  readonly #api = inject(CS_API, { optional: true });
  readonly #status = signal<UpdateStatus | null>(null);

  readonly status = this.#status.asReadonly();
  readonly releasesUrl = RELEASES_URL;

  readonly phase = computed(() => this.#status()?.phase.kind ?? 'idle');
  readonly checking = computed(() => this.phase() === 'checking');

  readonly release = computed<ReleaseInfo | null>(() => {
    const phase = this.#status()?.phase;
    if (phase === undefined) return null;
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
  });

  readonly percent = computed(() => {
    const phase = this.#status()?.phase;
    return phase?.kind === 'downloading' ? phase.percent : 0;
  });

  readonly errorMessage = computed(() => {
    const phase = this.#status()?.phase;
    return phase?.kind === 'error' ? phase.message : null;
  });

  /** Something newer exists, whatever this build can do about it. */
  readonly hasUpdate = computed(() => this.release() !== null);
  /** This build can replace itself; otherwise the UI offers the download page. */
  readonly canInstall = computed(() => this.#status()?.mode === 'auto');

  constructor() {
    inject(EventBus).on('update.changed', (event) => this.#status.set(event.status));
    void this.reload();
  }

  async reload(): Promise<void> {
    if (this.#api === null) return;
    this.#status.set(await this.#api.terminal.getUpdateStatus());
  }

  async check(): Promise<void> {
    if (this.#api === null) return;
    this.#status.set(await this.#api.terminal.checkForUpdates());
  }

  async download(): Promise<void> {
    if (this.#api === null) return;
    this.#status.set(await this.#api.terminal.downloadUpdate());
  }

  async install(): Promise<void> {
    await this.#api?.terminal.installUpdate();
  }

  /** Manual mode: hand the user off to the release page. */
  async openRelease(): Promise<void> {
    await this.#api?.terminal.openExternal(this.release()?.url ?? this.releasesUrl);
  }

  async setChecksEnabled(enabled: boolean): Promise<void> {
    if (this.#api === null) return;
    this.#status.set(await this.#api.terminal.setUpdateChecksEnabled(enabled));
  }
}
