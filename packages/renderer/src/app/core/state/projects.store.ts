import { Injectable, computed, inject, signal } from '@angular/core';
import type { ProjectDetail, ProjectId, ProjectPatch, ProjectSummary } from '@cs/shared';
import { CS_API } from '../ipc/api.token';
import { EventBus } from '../ipc/event-bus';

/**
 * A projection of the indexer's state, not a second copy of it.
 *
 * Every mutation goes to the indexer and the result is read back, so there is no
 * second truth to keep in sync — which is also why this is signals and a service
 * rather than a store framework.
 */
@Injectable({ providedIn: 'root' })
export class ProjectsStore {
  readonly #api = inject(CS_API, { optional: true });
  readonly #bus = inject(EventBus);

  readonly #projects = signal<readonly ProjectSummary[]>([]);
  readonly #loading = signal(false);
  readonly #showArchived = signal(false);

  readonly projects = this.#projects.asReadonly();
  readonly loading = this.#loading.asReadonly();
  readonly showArchived = this.#showArchived.asReadonly();

  readonly pinned = computed(() => this.#projects().filter((project) => project.pinned));
  readonly grouped = computed(() => {
    const groups = new Map<string, ProjectSummary[]>();
    for (const project of this.#projects()) {
      const key = project.group ?? '';
      groups.set(key, [...(groups.get(key) ?? []), project]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  });
  readonly needsAttentionTotal = computed(() =>
    this.#projects().reduce((sum, project) => sum + project.needsAttentionCount, 0),
  );

  constructor() {
    this.#bus.on('index.projectsChanged', () => void this.reload());
    this.#bus.on('live.changed', () => void this.reload());
  }

  async reload(): Promise<void> {
    if (this.#api === null) return;
    this.#loading.set(true);
    try {
      this.#projects.set(await this.#api.index.listProjects({ includeArchived: this.#showArchived() }));
    } finally {
      this.#loading.set(false);
    }
  }

  toggleArchived(): void {
    this.#showArchived.update((value) => !value);
    void this.reload();
  }

  /** The archive view asks for exactly the archived ones. */
  async archivedProjects(): Promise<readonly ProjectSummary[]> {
    return (await this.#api?.index.listProjects({ onlyArchived: true })) ?? [];
  }

  async patch(id: ProjectId, patch: ProjectPatch): Promise<ProjectDetail | null> {
    if (this.#api === null) return null;
    const updated = await this.#api.index.patchProject(id, patch);
    await this.reload();
    return updated;
  }

  async add(path: string): Promise<ProjectDetail | null> {
    if (this.#api === null) return null;
    const added = await this.#api.index.addProject(path);
    await this.reload();
    return added;
  }

  byId(id: ProjectId): ProjectSummary | undefined {
    return this.#projects().find((project) => project.id === id);
  }
}
