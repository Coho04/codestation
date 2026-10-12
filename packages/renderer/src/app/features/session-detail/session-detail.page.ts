import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { CostByModel, MessageRow, SessionDetail, SessionId, SessionTree } from '@cs/shared';
import { CS_API } from '../../core/ipc/api.token';
import { EventBus } from '../../core/ipc/event-bus';
import { LiveStatusStore } from '../../core/state/live-status.store';
import { TerminalStore } from '../../core/state/terminal.store';
import { AttentionBadge } from '../../shared/ui/attention-badge';
import { EmptyState } from '../../shared/ui/empty-state';
import { MessageRowView } from './message-row';
import { RelativeTimePipe } from '../../shared/pipes/relative-time.pipe';
import { CostPipe } from '../../shared/pipes/cost.pipe';
import { CountPipe } from '../../shared/pipes/count.pipe';

const PAGE = 120;

@Component({
  selector: 'cs-session-detail-page',
  imports: [RouterLink, AttentionBadge, EmptyState, MessageRowView, RelativeTimePipe, CostPipe, CountPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (session(); as detail) {
      <div class="flex h-full flex-col">
        <header class="border-b border-neutral-800 px-4 py-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h2 class="truncate text-sm font-semibold text-neutral-100">{{ detail.title }}</h2>
              <p class="mt-0.5 truncate text-[11px] text-neutral-500">
                <a [routerLink]="['/projects', detail.projectId]" class="hover:underline">{{ detail.projectPath }}</a>
                @if (detail.gitBranch; as branch) { · {{ branch }} }
                @if (detail.ccVersion; as version) { · Claude {{ version }} }
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              @if (liveStatus(); as status) {
                <cs-attention-badge [level]="status.attention" />
              }
              <button
                type="button"
                class="rounded bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
                [disabled]="!detail.filePresent"
                (click)="resume(detail)"
              >
                Fortsetzen
              </button>
            </div>
          </div>

          <dl class="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-neutral-500">
            <span><dt class="inline text-neutral-600">Prompts:</dt> <dd class="inline">{{ detail.userPromptCount | csCount }}</dd></span>
            <span><dt class="inline text-neutral-600">Nachrichten:</dt> <dd class="inline">{{ detail.messageCount | csCount }}</dd></span>
            <span><dt class="inline text-neutral-600">Tools:</dt> <dd class="inline">{{ detail.toolUseCount | csCount }}</dd></span>
            <span><dt class="inline text-neutral-600">Kosten:</dt> <dd class="inline">{{ detail.costUsd | csCost }}</dd></span>
            <span><dt class="inline text-neutral-600">Start:</dt> <dd class="inline">{{ detail.startedAt | csRelativeTime }}</dd></span>
            @if (detail.continuedFrom; as previous) {
              <span>
                <dt class="inline text-neutral-600">Fortsetzung von:</dt>
                <dd class="inline">
                  <a [routerLink]="['/sessions', previous.sessionId]" class="hover:underline">vorheriger Session</a>
                </dd>
              </span>
            }
            @if (tree(); as sessionTree) {
              @if (sessionTree.forkPoints.length > 0) {
                <span class="text-amber-500/80">{{ sessionTree.forkPoints.length }} Verzweigung(en)</span>
              }
              @if (sessionTree.subagents.length > 0) {
                <span>{{ sessionTree.subagents.length }} Subagenten</span>
              }
            }
          </dl>

          @if (costs().length > 1) {
            <ul class="mt-2 flex flex-wrap gap-3 text-[11px] text-neutral-600">
              @for (cost of costs(); track cost.model) {
                <li>{{ cost.model }}: {{ cost.costUsd | csCost }}</li>
              }
            </ul>
          }

          <div class="mt-3 flex items-center gap-3 text-[11px]">
            <label class="flex items-center gap-1.5 text-neutral-500">
              <input type="checkbox" [checked]="mainPathOnly()" (change)="toggleMainPath()" />
              Nur aktueller Gesprächsverlauf
            </label>
            <span class="text-neutral-700">{{ loaded() }} von {{ total() | csCount }} geladen</span>
          </div>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3" (scroll)="onScroll($event)">
          @if (messages().length === 0) {
            <cs-empty-state title="Noch keine Nachrichten indiziert" hint="Diese Session steht in der Warteschlange." />
          } @else {
            <ol class="flex flex-col gap-3">
              @for (message of messages(); track message.id) {
                <li>
                  <cs-message-row [message]="message" [sessionId]="detail.id" />
                </li>
              }
            </ol>
            @if (loaded() < total()) {
              <button
                type="button"
                class="mx-auto my-6 block rounded bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700"
                (click)="loadMore()"
              >
                Weitere {{ pageSize }} laden
              </button>
            }
          }
        </div>
      </div>
    } @else {
      <cs-empty-state title="Session nicht gefunden" hint="Sie wurde eventuell nie indiziert." />
    }
  `,
})
export class SessionDetailPage {
  readonly sessionId = input.required<string>();

  readonly #api = inject(CS_API, { optional: true });
  readonly #live = inject(LiveStatusStore);
  readonly #terminal = inject(TerminalStore);

  protected readonly pageSize = PAGE;
  protected readonly session = signal<SessionDetail | null>(null);
  protected readonly tree = signal<SessionTree | null>(null);
  protected readonly costs = signal<readonly CostByModel[]>([]);
  protected readonly messages = signal<readonly MessageRow[]>([]);
  protected readonly total = signal(0);
  protected readonly mainPathOnly = signal(true);

  protected readonly loaded = computed(() => this.messages().length);
  protected readonly liveStatus = computed(() => {
    const detail = this.session();
    return detail === null ? undefined : this.#live.statusOf(detail.id);
  });

  constructor() {
    effect(() => {
      const id = this.sessionId() as SessionId;
      void this.#load(id);
    });

    // A session being written to right now should grow in place rather than
    // require a manual reload.
    inject(EventBus).on('session.updated', (event) => {
      const detail = this.session();
      if (detail === null || event.sessionId !== detail.id) return;
      this.total.set(event.messageCount);
    });
  }

  async #load(id: SessionId): Promise<void> {
    if (this.#api === null) return;
    const [detail, tree, costs] = await Promise.all([
      this.#api.index.getSession(id),
      this.#api.index.getSessionTree(id),
      this.#api.index.getSessionCosts(id),
    ]);
    this.session.set(detail);
    this.tree.set(tree);
    this.costs.set(costs);
    this.messages.set([]);
    await this.loadMore();
  }

  protected async loadMore(): Promise<void> {
    const detail = this.session();
    if (this.#api === null || detail === null) return;
    // Windowed over RPC: the largest transcript here is 83 MB, so "load it all
    // and scroll" fails at the payload long before it fails at rendering.
    const page = await this.#api.index.getTranscript(
      detail.id,
      { offset: this.messages().length, limit: PAGE },
      this.mainPathOnly(),
    );
    this.total.set(page.total);
    this.messages.update((current) => [...current, ...page.items]);
  }

  protected toggleMainPath(): void {
    this.mainPathOnly.update((value) => !value);
    this.messages.set([]);
    void this.loadMore();
  }

  protected onScroll(event: Event): void {
    const element = event.target as HTMLElement;
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 400) {
      if (this.loaded() < this.total()) void this.loadMore();
    }
  }

  protected resume(detail: SessionDetail): void {
    void this.#terminal.openClaude(detail.projectPath, {
      mode: { type: 'resume', sessionId: detail.id },
      name: detail.title.slice(0, 40),
    });
  }
}
