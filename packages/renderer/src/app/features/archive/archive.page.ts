import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import type { ProjectId, SessionSort } from '@cs/shared';
import { SessionsStore } from '../../core/state/sessions.store';
import { ProjectsStore } from '../../core/state/projects.store';
import { EntityActions } from '../../core/ui/entity-actions';
import { EmptyState } from '../../shared/ui/empty-state';
import { RelativeTimePipe } from '../../shared/pipes/relative-time.pipe';
import { CostPipe } from '../../shared/pipes/cost.pipe';
import { CountPipe } from '../../shared/pipes/count.pipe';

@Component({
  selector: 'cs-archive-page',
  imports: [RouterLink, FormsModule, EmptyState, RelativeTimePipe, CostPipe, CountPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full flex-col">
      <header class="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-4 py-2.5">
        <h2 class="text-sm font-semibold text-neutral-200">{{ heading() }}</h2>
        <span class="text-[11px] text-neutral-700">Rechtsklick für Aktionen</span>

        <input
          class="w-56 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
          placeholder="Titel oder Pfad filtern"
          [ngModel]="filter()"
          (ngModelChange)="onFilter($event)"
        />

        <select
          class="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-300"
          [ngModel]="sort()"
          (ngModelChange)="onSort($event)"
        >
          <option value="recent">Zuletzt aktiv</option>
          <option value="oldest">Älteste zuerst</option>
          <option value="cost">Teuerste zuerst</option>
          <option value="messages">Meiste Nachrichten</option>
        </select>

        <label class="flex items-center gap-1.5 text-xs text-neutral-500" title="Sessions, die du selbst archiviert hast">
          <input type="checkbox" [ngModel]="includeArchived()" (ngModelChange)="onArchived($event)" />
          Archivierte
        </label>

        <label class="flex items-center gap-1.5 text-xs text-neutral-500" title="Sessions, deren Transcript Claude Code weggeräumt hat">
          <input type="checkbox" [ngModel]="includeVanished()" (ngModelChange)="onVanished($event)" />
          Quelle weg
        </label>

        <span class="ml-auto text-[11px] text-neutral-600">{{ store.total() | csCount }} Sessions</span>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto">
        @if (store.sessions().length === 0) {
          <cs-empty-state
            title="Keine Sessions"
            hint="Entweder läuft der Index noch, oder der Filter passt auf nichts."
          />
        } @else {
          <table class="w-full text-sm">
            <thead class="sticky top-0 bg-neutral-950 text-[11px] uppercase tracking-wide text-neutral-600">
              <tr class="border-b border-neutral-800">
                <th class="px-4 py-1.5 text-left font-medium">Titel</th>
                <th class="px-3 py-1.5 text-left font-medium">Projekt</th>
                <th class="px-3 py-1.5 text-right font-medium">Prompts</th>
                <th class="px-3 py-1.5 text-right font-medium">Kosten</th>
                <th class="px-4 py-1.5 text-right font-medium">Zuletzt</th>
              </tr>
            </thead>
            <tbody>
              @for (session of store.sessions(); track session.id) {
                <tr
                  class="border-b border-neutral-900 hover:bg-neutral-900/60"
                  [class.opacity-50]="!session.filePresent || session.archived"
                  (contextmenu)="actions.openSessionMenu($event, session)"
                >
                  <td class="max-w-0 px-4 py-1.5">
                    <a [routerLink]="['/sessions', session.id]" class="block truncate text-neutral-200 hover:underline">
                      {{ session.title }}
                    </a>
                    <span class="flex gap-2">
                      @if (!session.filePresent) {
                        <span class="text-[10px] text-neutral-600" title="Claude Code hat das Transcript weggeräumt">Quelle weg</span>
                      }
                      @if (session.archived) {
                        <span class="text-[10px] text-amber-600/80">archiviert</span>
                      }
                    </span>
                  </td>
                  <td class="max-w-0 px-3 py-1.5">
                    <span class="block truncate text-[11px] text-neutral-500">{{ session.projectPath }}</span>
                  </td>
                  <td class="px-3 py-1.5 text-right text-[11px] text-neutral-500">
                    {{ session.userPromptCount | csCount }}
                  </td>
                  <td class="px-3 py-1.5 text-right text-[11px] text-neutral-500">
                    {{ session.costUsd | csCost }}
                  </td>
                  <td class="px-4 py-1.5 text-right text-[11px] text-neutral-500">
                    {{ session.endedAt | csRelativeTime }}
                  </td>
                </tr>
              }
            </tbody>
          </table>

          @if (store.sessions().length < store.total()) {
            <button
              type="button"
              class="mx-auto my-4 block rounded bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700"
              (click)="store.loadMore()"
            >
              Weitere laden
            </button>
          }
        }
      </div>
    </div>
  `,
})
export class ArchivePage {
  readonly projectId = input<string | undefined>();

  protected readonly store = inject(SessionsStore);
  readonly #projects = inject(ProjectsStore);
  protected readonly actions = inject(EntityActions);

  protected readonly filter = signal('');
  protected readonly sort = signal<SessionSort>('recent');
  protected readonly includeArchived = signal(false);
  protected readonly includeVanished = signal(false);

  protected readonly heading = computed(() => {
    const id = this.projectId();
    if (id === undefined) return 'Alle Sessions';
    const project = this.#projects.projects().find((candidate) => String(candidate.id) === id);
    return project?.displayName ?? 'Projekt';
  });

  constructor() {
    effect(() => {
      const id = this.projectId();
      void this.store.load({
        ...(id === undefined ? {} : { projectId: Number(id) as ProjectId }),
        sort: this.sort(),
        includeArchived: this.includeArchived(),
        includeVanished: this.includeVanished(),
        search: this.filter(),
      });
    });
  }

  protected onFilter(value: string): void {
    this.filter.set(value);
  }
  protected onSort(value: SessionSort): void {
    this.sort.set(value);
  }
  protected onArchived(value: boolean): void {
    this.includeArchived.set(value);
  }
  protected onVanished(value: boolean): void {
    this.includeVanished.set(value);
  }
}
