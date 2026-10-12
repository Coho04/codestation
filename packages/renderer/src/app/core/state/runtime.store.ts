import { Injectable, computed, inject, signal } from '@angular/core';
import type { ClaudeBinaryInfo } from '@cs/shared';
import { CS_API } from '../ipc/api.token';
import { EventBus } from '../ipc/event-bus';

@Injectable({ providedIn: 'root' })
export class RuntimeStore {
  readonly #api = inject(CS_API, { optional: true });
  readonly #info = signal<ClaudeBinaryInfo | null>(null);

  readonly info = this.#info.asReadonly();
  /** Everything terminal-related is blocked until the CLI can be found. */
  readonly ready = computed(() => this.#info()?.version != null);
  readonly inBrowser = this.#api === null;

  constructor() {
    inject(EventBus).on('runtime.changed', (event) => this.#info.set(event.info));
    void this.reload();
  }

  async reload(): Promise<void> {
    if (this.#api === null) return;
    this.#info.set(await this.#api.terminal.getClaudeInfo());
  }

  async setBinaryPath(path: string | null): Promise<void> {
    if (this.#api === null) return;
    this.#info.set(await this.#api.terminal.setClaudeBinaryPath(path));
  }

  async pickBinary(): Promise<void> {
    if (this.#api === null) return;
    const picked = await this.#api.terminal.pickDirectory('Claude-Binary wählen');
    if (picked !== null) await this.setBinaryPath(picked);
  }
}
