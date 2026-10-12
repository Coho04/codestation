import { Injectable, computed, inject, signal } from '@angular/core';
import type { Page, ProjectId, SessionQuery, SessionSort, SessionSummary } from '@cs/shared';
import { CS_API } from '../ipc/api.token';
import { EventBus } from '../ipc/event-bus';

const PAGE_SIZE = 100;

@Injectable({ providedIn: 'root' })
export class SessionsStore {
  readonly #api = inject(CS_API, { optional: true });

  readonly #page = signal<Page<SessionSummary>>({ items: [], total: 0, offset: 0, limit: PAGE_SIZE });
  readonly #query = signal<SessionQuery>({ sort: 'recent', limit: PAGE_SIZE, offset: 0 });
  readonly #loading = signal(false);

  readonly sessions = computed(() => this.#page().items);
  readonly total = computed(() => this.#page().total);
  readonly loading = this.#loading.asReadonly();
  readonly query = this.#query.asReadonly();
  readonly hasMore = computed(() => this.#page().items.length < this.#page().total);

  constructor() {
    const bus = inject(EventBus);
    // A session that just appeared or grew should show up without a manual
    // refresh, but reloading on every appended line would thrash the list.
    bus.on('session.appeared', () => void this.reload());
    bus.on('index.projectsChanged', () => void this.reload());
  }

  async load(patch: Partial<SessionQuery>): Promise<void> {
    this.#query.update((query) => ({ ...query, ...patch, offset: 0 }));
    await this.reload();
  }

  setSort(sort: SessionSort): Promise<void> {
    return this.load({ sort });
  }

  setProject(projectId: ProjectId | undefined): Promise<void> {
    // exactOptionalPropertyTypes: an absent filter means omitting the key, not
    // setting it to undefined.
    const rest = { ...this.#query() };
    delete rest.projectId;
    this.#query.set(projectId === undefined ? rest : { ...rest, projectId });
    return this.reload();
  }

  async reload(): Promise<void> {
    if (this.#api === null) return;
    this.#loading.set(true);
    try {
      this.#page.set(await this.#api.index.listSessions(this.#query()));
    } finally {
      this.#loading.set(false);
    }
  }

  async loadMore(): Promise<void> {
    if (this.#api === null || !this.hasMore()) return;
    const next = { ...this.#query(), offset: this.#page().items.length };
    const page = await this.#api.index.listSessions(next);
    this.#page.update((current) => ({ ...page, items: [...current.items, ...page.items] }));
  }
}
