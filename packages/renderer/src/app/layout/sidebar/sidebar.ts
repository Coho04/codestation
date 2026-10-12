import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ProjectsStore } from '../../core/state/projects.store';
import { LiveStatusStore } from '../../core/state/live-status.store';
import { RelativeTimePipe } from '../../shared/pipes/relative-time.pipe';
import { CommandRegistry } from '../../core/commands/command-registry';
import { EntityActions } from '../../core/ui/entity-actions';

@Component({
  selector: 'cs-sidebar',
  imports: [RouterLink, RouterLinkActive, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="flex h-full flex-col overflow-hidden border-r border-neutral-800 bg-neutral-950">
      <div class="flex flex-col gap-0.5 px-2 py-2">
        <a
          routerLink="/"
          routerLinkActive="bg-neutral-800/70 text-neutral-100"
          [routerLinkActiveOptions]="{ exact: true }"
          class="flex items-center justify-between rounded px-2 py-1.5 text-sm text-neutral-400 hover:bg-neutral-900"
        >
          <span>Übersicht</span>
          @if (attention() > 0) {
            <span class="rounded-full bg-amber-400/20 px-1.5 text-[11px] text-amber-300">{{ attention() }}</span>
          }
        </a>
        <a routerLink="/search" routerLinkActive="bg-neutral-800/70 text-neutral-100"
           class="rounded px-2 py-1.5 text-sm text-neutral-400 hover:bg-neutral-900">Suche</a>
        <a routerLink="/archive" routerLinkActive="bg-neutral-800/70 text-neutral-100"
           class="rounded px-2 py-1.5 text-sm text-neutral-400 hover:bg-neutral-900">Sessions</a>
        <a routerLink="/trash" routerLinkActive="bg-neutral-800/70 text-neutral-100"
           class="rounded px-2 py-1.5 text-sm text-neutral-400 hover:bg-neutral-900">Archiv</a>
        <a routerLink="/plans" routerLinkActive="bg-neutral-800/70 text-neutral-100"
           class="rounded px-2 py-1.5 text-sm text-neutral-400 hover:bg-neutral-900">Pläne</a>
      </div>

      <div class="flex items-center justify-between px-3 pb-1 pt-3">
        <span class="text-[11px] font-semibold uppercase tracking-wider text-neutral-600">Projekte</span>
        <button type="button" class="text-[11px] text-neutral-500 hover:text-neutral-300" (click)="addProject()">
          + Ordner
        </button>
      </div>

      <ul class="flex-1 overflow-y-auto px-2 pb-3">
        @for (project of projects(); track project.id) {
          <li>
            <a
              [routerLink]="['/projects', project.id]"
              routerLinkActive="bg-neutral-800/70 text-neutral-100"
              class="group flex flex-col gap-0.5 rounded px-2 py-1.5 hover:bg-neutral-900"
              [class.opacity-50]="!project.pathExists"
            >
              <span class="flex items-center justify-between gap-2">
                <span class="truncate text-sm text-neutral-300">{{ project.displayName }}</span>
                <span class="flex shrink-0 items-center gap-1">
                  @if (project.needsAttentionCount > 0) {
                    <span class="size-1.5 animate-pulse rounded-full bg-amber-400"></span>
                  } @else if (project.liveSessionCount > 0) {
                    <span class="size-1.5 rounded-full bg-sky-400"></span>
                  }
                  <span
                    class="cursor-pointer text-[11px] leading-none transition"
                    [class]="project.pinned ? 'text-amber-400' : 'text-neutral-700 opacity-0 group-hover:opacity-100'"
                    [title]="project.pinned ? 'Anheften aufheben' : 'Anheften'"
                    (click)="run($event, 'project.pin:' + project.id)"
                  >★</span>
                  <span
                    class="cursor-pointer text-[11px] leading-none text-neutral-700 opacity-0 transition group-hover:opacity-100"
                    [title]="project.archived ? 'Aus dem Archiv holen' : 'Archivieren'"
                    (click)="run($event, 'project.archive:' + project.id)"
                  >⊘</span>
                </span>
              </span>
              <span class="truncate text-[11px] text-neutral-600">
                {{ project.sessionCount }} Sessions · {{ project.lastActivityAt | csRelativeTime }}
                @if (!project.pathExists) { · Ordner fehlt }
              </span>
            </a>
          </li>
        } @empty {
          <li class="px-2 py-4 text-xs text-neutral-600">Noch keine Projekte indiziert.</li>
        }
      </ul>

      <button
        type="button"
        class="border-t border-neutral-800 px-3 py-2 text-left text-[11px] text-neutral-600 hover:text-neutral-400"
        (click)="store.toggleArchived()"
      >
        {{ store.showArchived() ? 'Archivierte verbergen' : 'Archivierte zeigen' }}
      </button>
    </nav>
  `,
})
export class Sidebar {
  protected readonly store = inject(ProjectsStore);
  readonly #live = inject(LiveStatusStore);
  readonly #commands = inject(CommandRegistry);
  protected readonly actions = inject(EntityActions);

  protected readonly projects = this.store.projects;
  protected readonly attention = computed(() => this.#live.needsAttention().length);

  protected addProject(): void {
    void this.#commands.run('project.add');
  }

  /** Curation goes through the registry, so the palette gets it for free. */
  protected run(event: Event, id: string): void {
    event.preventDefault();
    event.stopPropagation();
    void this.#commands.run(id);
  }
}
