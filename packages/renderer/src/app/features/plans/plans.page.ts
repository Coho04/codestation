import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { PlanDoc, PlanId } from '@cs/shared';
import { CS_API } from '../../core/ipc/api.token';
import { EmptyState } from '../../shared/ui/empty-state';
import { RelativeTimePipe } from '../../shared/pipes/relative-time.pipe';

@Component({
  selector: 'cs-plans-page',
  imports: [RouterLink, EmptyState, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-6">
      <h2 class="text-sm font-semibold text-neutral-200">Pläne</h2>

      @if (plans().length === 0) {
        <cs-empty-state title="Keine Pläne gefunden" hint="Erwartet unter ~/.claude/plans." />
      } @else {
        <ul class="divide-y divide-neutral-900 rounded border border-neutral-800">
          @for (plan of plans(); track plan.id) {
            <li class="px-3 py-2">
              <button type="button" class="w-full text-left" (click)="open(plan)">
                <span class="flex items-baseline justify-between gap-3">
                  <span class="truncate text-sm text-neutral-200">{{ plan.title }}</span>
                  <span class="shrink-0 text-[11px] text-neutral-600">{{ plan.mtime | csRelativeTime }}</span>
                </span>
                <span class="mt-0.5 block truncate text-[11px] text-neutral-600">{{ plan.slug }}</span>
              </button>

              @if (plan.links.length > 0) {
                <p class="mt-1 flex flex-wrap gap-2 text-[11px] text-neutral-600">
                  @for (link of plan.links; track link.sessionId) {
                    <a [routerLink]="['/sessions', link.sessionId]" class="hover:underline">
                      {{ link.sessionTitle }}
                      <!-- A tracking-path record is hard evidence; an mtime match is a guess. -->
                      @if (link.confidence < 1) { <span class="text-neutral-700">(vermutet)</span> }
                    </a>
                  }
                </p>
              }

              @if (openId() === plan.id) {
                <pre class="mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded bg-neutral-950 p-3 text-[11px] leading-relaxed text-neutral-400">{{ body() }}</pre>
              }
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class PlansPage {
  readonly #api = inject(CS_API, { optional: true });
  protected readonly plans = signal<readonly PlanDoc[]>([]);
  protected readonly openId = signal<PlanId | null>(null);
  protected readonly body = signal('');

  constructor() {
    void this.#load();
  }

  async #load(): Promise<void> {
    if (this.#api === null) return;
    this.plans.set(await this.#api.index.listPlans());
  }

  protected async open(plan: PlanDoc): Promise<void> {
    if (this.openId() === plan.id) {
      this.openId.set(null);
      return;
    }
    this.openId.set(plan.id);
    const full = await this.#api?.index.getPlan(plan.id);
    this.body.set(full?.body ?? '');
  }
}
