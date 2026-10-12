import { Injectable, computed, inject, signal } from '@angular/core';
import type { IndexProgress } from '@cs/shared';
import { CS_API } from '../ipc/api.token';
import { EventBus } from '../ipc/event-bus';

const IDLE: IndexProgress = {
  phase: 'idle',
  filesTotal: 0,
  filesDone: 0,
  bytesTotal: 0,
  bytesDone: 0,
  currentPath: null,
  etaMs: null,
  cancellable: false,
  unknownRecordTypes: [],
  decodeErrors: 0,
};

@Injectable({ providedIn: 'root' })
export class IndexProgressStore {
  readonly #api = inject(CS_API, { optional: true });
  readonly #progress = signal<IndexProgress>(IDLE);

  readonly progress = this.#progress.asReadonly();
  readonly busy = computed(() => this.#progress().phase !== 'idle');
  readonly percent = computed(() => {
    const progress = this.#progress();
    if (progress.phase === 'skeleton') {
      return progress.filesTotal === 0 ? 0 : Math.round((progress.filesDone / progress.filesTotal) * 100);
    }
    if (progress.bytesTotal === 0) return 0;
    return Math.round((progress.bytesDone / progress.bytesTotal) * 100);
  });
  /** The schema-drift alarm, surfaced rather than buried in a log. */
  readonly drift = computed(() => this.#progress().unknownRecordTypes);

  constructor() {
    inject(EventBus).on('index.progress', (event) => this.#progress.set(event.progress));
    void this.reload();
  }

  async reload(): Promise<void> {
    if (this.#api === null) return;
    this.#progress.set(await this.#api.index.getProgress());
  }

  async rebuild(): Promise<void> {
    await this.#api?.index.rebuildIndex();
  }
}
