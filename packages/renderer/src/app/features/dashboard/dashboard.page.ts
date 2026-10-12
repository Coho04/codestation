import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LiveStatusStore } from '../../core/state/live-status.store';
import { ProjectsStore } from '../../core/state/projects.store';
import { SessionsStore } from '../../core/state/sessions.store';
import { TerminalStore } from '../../core/state/terminal.store';
import { AttentionBadge } from '../../shared/ui/attention-badge';
import { EmptyState } from '../../shared/ui/empty-state';
import { RelativeTimePipe } from '../../shared/pipes/relative-time.pipe';
import { CostPipe } from '../../shared/pipes/cost.pipe';
import { CountPipe } from '../../shared/pipes/count.pipe';
import { LaunchDialog } from '../terminal/launch-dialog';

@Component({
  selector: 'cs-dashboard-page',
  imports: [RouterLink, AttentionBadge, EmptyState, RelativeTimePipe, CostPipe, CountPipe, LaunchDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-6">
      <section>
        <header class="mb-3 flex items-baseline justify-between">
          <h2 class="text-sm font-semibold text-neutral-200">Laufende Sessions</h2>
          <button
            type="button"
            class="rounded bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
            (click)="launcherOpen.set(true)"
          >
            Neue Session
          </button>
        </header>

        @if (live.running().length === 0) {
          <cs-empty-state
            title="Keine laufende Session"
            hint="Sessions, die du anderswo startest, erscheinen hier ebenfalls."
          />
        } @else {
          <ul class="grid gap-2 sm:grid-cols-2">
            @for (session of live.running(); track session.sessionId) {
              <li class="rounded border border-neutral-800 bg-neutral-900/40 p-3">
                <div class="flex items-start justify-between gap-2">
                  <a
                    [routerLink]="['/sessions', session.sessionId]"
                    class="truncate text-sm text-neutral-200 hover:underline"
                  >
                    {{ session.name ?? session.sessionId.slice(0, 8) }}
                  </a>
                  <cs-attention-badge [level]="session.attention" />
                </div>
                <p class="mt-1 truncate text-[11px] text-neutral-500">{{ session.cwd }}</p>
                <p class="mt-1 flex items-center gap-2 text-[11px] text-neutral-600">
                  <span>{{ session.kind === 'background' ? 'Hintergrund' : 'interaktiv' }}</span>
                  @if (session.paneId === null) {
                    <span class="rounded bg-neutral-800 px-1">extern</span>
                  }
                  <span>· seit {{ session.startedAt | csRelativeTime }}</span>
                </p>
                @if (session.waitingFor; as reason) {
                  <p class="mt-1 text-[11px] text-amber-300">{{ reason }}</p>
                }
              </li>
            }
          </ul>
        }
      </section>

      <section>
        <h2 class="mb-3 text-sm font-semibold text-neutral-200">Zuletzt bearbeitet</h2>
        @if (recent().length === 0) {
          <cs-empty-state title="Noch nichts indiziert" hint="Der Index läuft gerade durch." />
        } @else {
          <ul class="divide-y divide-neutral-800 rounded border border-neutral-800">
            @for (session of recent(); track session.id) {
              <li>
                <a
                  [routerLink]="['/sessions', session.id]"
                  class="flex items-center gap-3 px-3 py-2 hover:bg-neutral-900"
                >
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm text-neutral-200">{{ session.title }}</span>
                    <span class="block truncate text-[11px] text-neutral-600">{{ session.projectPath }}</span>
                  </span>
                  <span class="shrink-0 text-right text-[11px] text-neutral-500">
                    <span class="block">{{ session.endedAt | csRelativeTime }}</span>
                    <span class="block">{{ session.userPromptCount | csCount }} Prompts</span>
                  </span>
                </a>
              </li>
            }
          </ul>
        }
      </section>

      <section class="grid gap-3 sm:grid-cols-3">
        <div class="rounded border border-neutral-800 p-3">
          <p class="text-[11px] uppercase tracking-wide text-neutral-600">Projekte</p>
          <p class="mt-1 text-xl text-neutral-100">{{ projects.projects().length }}</p>
        </div>
        <div class="rounded border border-neutral-800 p-3">
          <p class="text-[11px] uppercase tracking-wide text-neutral-600">Sessions</p>
          <p class="mt-1 text-xl text-neutral-100">{{ totalSessions() | csCount }}</p>
        </div>
        <div class="rounded border border-neutral-800 p-3">
          <p class="text-[11px] uppercase tracking-wide text-neutral-600">Kosten gesamt</p>
          <p class="mt-1 text-xl text-neutral-100">{{ totalCost() | csCost }}</p>
        </div>
      </section>
    </div>

    @if (launcherOpen()) {
      <cs-launch-dialog (closed)="launcherOpen.set(false)" />
    }
  `,
})
export class DashboardPage {
  protected readonly live = inject(LiveStatusStore);
  protected readonly projects = inject(ProjectsStore);
  readonly #sessions = inject(SessionsStore);
  readonly #terminal = inject(TerminalStore);

  protected readonly launcherOpen = signal(false);
  protected readonly recent = computed(() => this.#sessions.sessions().slice(0, 12));
  protected readonly totalSessions = computed(() =>
    this.projects.projects().reduce((sum, project) => sum + project.sessionCount, 0),
  );
  protected readonly totalCost = computed(() =>
    this.projects.projects().reduce((sum, project) => sum + project.totalCostUsd, 0),
  );

  constructor() {
    void this.projects.reload();
    void this.#sessions.load({ sort: 'recent', limit: 20 });
    void this.#terminal.restore();
  }
}
