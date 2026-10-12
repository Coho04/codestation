import { Injectable, computed, inject, signal } from '@angular/core';
import type { LiveSession, SessionId } from '@cs/shared';
import { CS_API } from '../ipc/api.token';
import { EventBus } from '../ipc/event-bus';

@Injectable({ providedIn: 'root' })
export class LiveStatusStore {
  readonly #api = inject(CS_API, { optional: true });
  readonly #sessions = signal<readonly LiveSession[]>([]);

  readonly sessions = this.#sessions.asReadonly();
  readonly needsAttention = computed(() =>
    this.#sessions().filter((session) => session.attention === 'needs-you'),
  );
  readonly running = computed(() =>
    this.#sessions().filter(
      (session) => session.attention !== 'dead' && session.attention !== 'stale',
    ),
  );
  readonly byId = computed(() => new Map(this.#sessions().map((session) => [session.sessionId, session])));

  constructor() {
    const bus = inject(EventBus);
    bus.on('live.changed', (event) => this.#sessions.set(event.sessions));
    void this.reload();
  }

  async reload(): Promise<void> {
    if (this.#api === null) return;
    this.#sessions.set(await this.#api.index.getLiveSessions());
  }

  statusOf(sessionId: SessionId): LiveSession | undefined {
    return this.byId().get(sessionId);
  }
}
