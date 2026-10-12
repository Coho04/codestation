import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { FileTouch, MessageRow, SessionDetail, SessionId, ToolUseRow } from '@cs/shared';
import { CS_API } from '../../core/ipc/api.token';
import { EventBus } from '../../core/ipc/event-bus';
import { LiveStatusStore } from '../../core/state/live-status.store';
import { TerminalStore } from '../../core/state/terminal.store';
import { AttentionBadge } from '../../shared/ui/attention-badge';
import { MessageRowView } from '../session-detail/message-row';
import { CostPipe } from '../../shared/pipes/cost.pipe';
import { CountPipe } from '../../shared/pipes/count.pipe';
import { RelativeTimePipe } from '../../shared/pipes/relative-time.pipe';
import { ByteSizePipe } from '../../shared/pipes/byte-size.pipe';

type Tab = 'messages' | 'tools' | 'files';

const TAIL = 40;

/**
 * The session's own data, beside the terminal it is running in.
 *
 * Shows the tail of the conversation rather than the whole thing: during a live
 * session what matters is what just happened, and a running transcript can be
 * tens of thousands of messages.
 */
@Component({
  selector: 'cs-session-panel',
  imports: [RouterLink, AttentionBadge, MessageRowView, CostPipe, CountPipe, RelativeTimePipe, ByteSizePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="flex h-full flex-col overflow-hidden border-l border-neutral-800 bg-neutral-950">
      <header class="shrink-0 border-b border-neutral-800 px-3 py-2">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-neutral-100">{{ title() }}</p>
            <p class="truncate text-[11px] text-neutral-600">{{ subtitle() }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            @if (live(); as status) {
              <cs-attention-badge [level]="status.attention" />
            }
            <button
              type="button"
              class="rounded px-1.5 py-0.5 text-[11px] text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
              title="Session-Daten einklappen"
              (click)="terminal.togglePanel()"
            >›</button>
            <button
              type="button"
              class="rounded px-1.5 py-0.5 text-[11px] text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
              title="Session-Modus verlassen (Esc)"
              (click)="terminal.exitFocusMode()"
            >✕</button>
          </div>
        </div>

        @if (detail(); as session) {
          <dl class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            <div class="flex justify-between"><dt class="text-neutral-600">Prompts</dt><dd class="text-neutral-300">{{ session.userPromptCount | csCount }}</dd></div>
            <div class="flex justify-between"><dt class="text-neutral-600">Nachrichten</dt><dd class="text-neutral-300">{{ session.messageCount | csCount }}</dd></div>
            <div class="flex justify-between"><dt class="text-neutral-600">Tools</dt><dd class="text-neutral-300">{{ session.toolUseCount | csCount }}</dd></div>
            <div class="flex justify-between"><dt class="text-neutral-600">Kosten</dt><dd class="text-neutral-300">{{ session.costUsd | csCost }}</dd></div>
            @if (contextLeft(); as left) {
              <div class="col-span-2 flex justify-between">
                <dt class="text-neutral-600">Kontext frei</dt>
                <dd class="text-neutral-300">{{ left | csCount }} Tokens</dd>
              </div>
            }
          </dl>
          <a
            [routerLink]="['/sessions', session.id]"
            class="mt-2 inline-block text-[11px] text-sky-500 hover:underline"
          >Vollständiges Transcript öffnen →</a>
        }
      </header>

      @if (detail() === null) {
        <div class="flex flex-1 items-center justify-center px-6 text-center text-xs text-neutral-600">
          {{ pending() }}
        </div>
      } @else {
        <nav class="flex shrink-0 gap-1 border-b border-neutral-800 px-2 py-1">
          @for (entry of tabs; track entry.id) {
            <button
              type="button"
              class="rounded px-2 py-0.5 text-[11px]"
              [class]="tab() === entry.id ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'"
              (click)="tab.set(entry.id)"
            >{{ entry.label }}</button>
          }
          <span class="ml-auto self-center text-[11px] text-neutral-700">
            {{ lastActivity() | csRelativeTime }}
          </span>
        </nav>

        <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          @switch (tab()) {
            @case ('messages') {
              @if (messages().length === 0) {
                <p class="px-2 py-6 text-center text-xs text-neutral-700">Noch nichts indiziert.</p>
              } @else {
                <ol class="flex flex-col gap-2">
                  @for (message of messages(); track message.id) {
                    <li><cs-message-row [message]="message" [sessionId]="detail()!.id" /></li>
                  }
                </ol>
              }
            }
            @case ('tools') {
              <ul class="flex flex-col gap-1">
                @for (tool of tools(); track tool.toolUseId) {
                  <li class="rounded bg-neutral-900/50 px-2 py-1">
                    <span class="flex items-baseline justify-between gap-2">
                      <span class="text-[11px] font-medium text-violet-400">{{ tool.name }}</span>
                      <span class="shrink-0 text-[10px]" [class]="tool.resultIsError ? 'text-red-400' : 'text-neutral-600'">
                        {{ tool.resultBytes | csByteSize }}
                      </span>
                    </span>
                    <span class="mt-0.5 block truncate font-mono text-[11px] text-neutral-400">{{ tool.inputSummary }}</span>
                  </li>
                } @empty {
                  <li class="px-2 py-6 text-center text-xs text-neutral-700">Keine Tool-Aufrufe.</li>
                }
              </ul>
            }
            @case ('files') {
              <ul class="flex flex-col gap-0.5">
                @for (file of files(); track $index) {
                  <li class="truncate px-2 py-0.5 font-mono text-[11px] text-neutral-400" [title]="file.absPath">
                    {{ file.absPath }}
                  </li>
                } @empty {
                  <li class="px-2 py-6 text-center text-xs text-neutral-700">Keine Dateien angefasst.</li>
                }
              </ul>
            }
          }
        </div>
      }
    </aside>
  `,
  styles: `:host { display: block; height: 100%; }`,
})
export class SessionPanel {
  protected readonly terminal = inject(TerminalStore);
  readonly #api = inject(CS_API, { optional: true });
  readonly #liveStore = inject(LiveStatusStore);

  protected readonly tabs = [
    { id: 'messages' as const, label: 'Verlauf' },
    { id: 'tools' as const, label: 'Tools' },
    { id: 'files' as const, label: 'Dateien' },
  ];

  protected readonly tab = signal<Tab>('messages');
  protected readonly detail = signal<SessionDetail | null>(null);
  protected readonly messages = signal<readonly MessageRow[]>([]);
  protected readonly tools = signal<readonly ToolUseRow[]>([]);
  protected readonly files = signal<readonly FileTouch[]>([]);

  protected readonly live = computed(() => {
    const id = this.terminal.activeSessionId();
    return id === null ? undefined : this.#liveStore.statusOf(id);
  });

  protected readonly title = computed(
    () => this.detail()?.title ?? this.terminal.activePane()?.title ?? 'Session',
  );
  protected readonly subtitle = computed(() => {
    const pane = this.terminal.activePane();
    return this.detail()?.projectPath ?? (pane?.spec.projectPath ?? '');
  });
  protected readonly contextLeft = computed(() => {
    for (const message of [...this.messages()].reverse()) {
      if (message.contextTokensLeft !== null) return message.contextTokensLeft;
    }
    return null;
  });
  protected readonly lastActivity = computed(() => this.detail()?.endedAt ?? null);

  /** Shown instead of an empty panel while a new session publishes its id. */
  protected readonly pending = computed(() => {
    const state = this.terminal.activePane()?.state;
    if (state === undefined) return 'Keine Session aktiv.';
    if (state.type === 'binding' || state.type === 'starting') return 'verbindet …';
    if (state.type === 'failed') return state.reason;
    if (state.type === 'exited') return 'Session beendet.';
    return 'Noch nicht indiziert — die ersten Zeilen werden gerade geschrieben.';
  });

  constructor() {
    effect(() => {
      const id = this.terminal.activeSessionId();
      if (id === null) {
        this.detail.set(null);
        this.messages.set([]);
        return;
      }
      void this.#load(id);
    });

    // The indexer tails the transcript anyway; this just follows it.
    inject(EventBus).on('session.updated', (event) => {
      if (event.sessionId === this.terminal.activeSessionId()) void this.#load(event.sessionId);
    });
  }

  async #load(id: SessionId): Promise<void> {
    if (this.#api === null) return;
    const detail = await this.#api.index.getSession(id);
    this.detail.set(detail);
    if (detail === null) return;

    // Only the tail: during a live session what matters is what just happened.
    const offset = Math.max(0, detail.messageCount - TAIL);
    const [page, tools, files] = await Promise.all([
      this.#api.index.getTranscript(id, { offset, limit: TAIL }, true),
      this.#api.index.getToolUses(id, { offset: 0, limit: 200 }),
      this.#api.index.getFileTouches(id),
    ]);
    this.messages.set(page.items);
    this.tools.set([...tools.items].reverse());
    this.files.set(files);
  }
}
