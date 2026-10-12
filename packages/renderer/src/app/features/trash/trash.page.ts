import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ProjectSummary, SessionSummary, Tombstone } from '@cs/shared';
import { CS_API } from '../../core/ipc/api.token';
import { EntityActions } from '../../core/ui/entity-actions';
import { ProjectsStore } from '../../core/state/projects.store';
import { EmptyState } from '../../shared/ui/empty-state';
import { RelativeTimePipe } from '../../shared/pipes/relative-time.pipe';

/**
 * Everything that has been put away, and the way back.
 *
 * Three groups because they are genuinely different: archived things are intact
 * and one click from returning, forgotten paths are gone from the index but
 * still on disk, and sessions whose source Claude Code removed are the index
 * doing its job as an archive.
 */
@Component({
  selector: 'cs-trash-page',
  imports: [RouterLink, EmptyState, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-6">
      <header>
        <h2 class="text-sm font-semibold text-neutral-200">Archiv</h2>
        <p class="mt-1 text-xs text-neutral-500">
          Archiviertes ist vollständig erhalten und aus der Suche ausgeschlossen.
          Aus dem Index Entferntes liegt weiterhin in <code class="text-neutral-400">~/.claude</code>.
        </p>
      </header>

      <section>
        <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-600">
          Archivierte Projekte
        </h3>
        @if (projects().length === 0) {
          <cs-empty-state title="Keine archivierten Projekte" />
        } @else {
          <ul class="divide-y divide-neutral-900 rounded border border-neutral-800">
            @for (project of projects(); track project.id) {
              <li class="flex items-center gap-3 px-3 py-2">
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm text-neutral-300">{{ project.displayName }}</span>
                  <span class="block truncate text-[11px] text-neutral-600">{{ project.path }}</span>
                </span>
                <span class="shrink-0 text-[11px] text-neutral-600">{{ project.sessionCount }} Sessions</span>
                <button
                  type="button"
                  class="shrink-0 rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-200 hover:bg-neutral-700"
                  (click)="restoreProject(project)"
                >Zurückholen</button>
              </li>
            }
          </ul>
        }
      </section>

      <section>
        <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-600">
          Archivierte Sessions
        </h3>
        @if (sessions().length === 0) {
          <cs-empty-state title="Keine archivierten Sessions" />
        } @else {
          <ul class="divide-y divide-neutral-900 rounded border border-neutral-800">
            @for (session of sessions(); track session.id) {
              <li class="flex items-center gap-3 px-3 py-2">
                <a [routerLink]="['/sessions', session.id]" class="min-w-0 flex-1 hover:underline">
                  <span class="block truncate text-sm text-neutral-300">{{ session.title }}</span>
                  <span class="block truncate text-[11px] text-neutral-600">{{ session.projectPath }}</span>
                </a>
                <span class="shrink-0 text-[11px] text-neutral-600">{{ session.endedAt | csRelativeTime }}</span>
                <button
                  type="button"
                  class="shrink-0 rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-200 hover:bg-neutral-700"
                  (click)="restoreSession(session)"
                >Zurückholen</button>
              </li>
            }
          </ul>
        }
      </section>

      <section>
        <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-600">
          Aus dem Index entfernt
        </h3>
        @if (tombstones().length === 0) {
          <cs-empty-state
            title="Nichts vergessen"
            hint="Hier stehen Pfade, die der Index ignorieren soll. Die Dateien selbst bleiben davon unberührt."
          />
        } @else {
          <ul class="divide-y divide-neutral-900 rounded border border-neutral-800">
            @for (stone of tombstones(); track stone.path) {
              <li class="flex items-center gap-3 px-3 py-2">
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm text-neutral-300">{{ stone.label ?? stone.path }}</span>
                  <span class="block truncate font-mono text-[11px] text-neutral-600">{{ stone.path }}</span>
                </span>
                <span class="shrink-0 text-[11px] text-neutral-600">
                  {{ stone.kind === 'project' ? 'Projekt' : 'Session' }} · {{ stone.createdAt | csRelativeTime }}
                </span>
                <button
                  type="button"
                  class="shrink-0 rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-200 hover:bg-neutral-700"
                  (click)="restore(stone)"
                >Wieder indizieren</button>
              </li>
            }
          </ul>
        }
      </section>
    </div>
  `,
})
export class TrashPage {
  readonly #api = inject(CS_API, { optional: true });
  readonly #actions = inject(EntityActions);
  readonly #projects = inject(ProjectsStore);

  protected readonly projects = signal<readonly ProjectSummary[]>([]);
  protected readonly sessions = signal<readonly SessionSummary[]>([]);
  protected readonly tombstones = signal<readonly Tombstone[]>([]);

  constructor() {
    void this.reload();
  }

  protected async reload(): Promise<void> {
    if (this.#api === null) return;
    const [projects, sessions, tombstones] = await Promise.all([
      this.#api.index.listProjects({ onlyArchived: true }),
      this.#api.index.listSessions({ onlyArchived: true, limit: 200 }),
      this.#api.index.listTombstones(),
    ]);
    this.projects.set(projects);
    this.sessions.set(sessions.items);
    this.tombstones.set(tombstones);
  }

  protected async restoreProject(project: ProjectSummary): Promise<void> {
    await this.#actions.setProjectArchived(project, false);
    await this.#projects.reload();
    await this.reload();
  }

  protected async restoreSession(session: SessionSummary): Promise<void> {
    await this.#actions.setSessionArchived(session, false);
    await this.reload();
  }

  protected async restore(stone: Tombstone): Promise<void> {
    await this.#actions.restore(stone.path);
    await this.reload();
  }
}
