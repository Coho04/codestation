import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { SearchScope } from '@cs/shared';
import { SearchStore } from '../../core/state/search.store';
import { EmptyState } from '../../shared/ui/empty-state';
import { RelativeTimePipe } from '../../shared/pipes/relative-time.pipe';

const SCOPE_LABEL: Record<SearchScope, string> = {
  prompts: 'Meine Prompts',
  assistant: 'Antworten',
  tools: 'Tool-Aufrufe',
  plans: 'Pläne',
};

@Component({
  selector: 'cs-search-page',
  imports: [FormsModule, RouterLink, EmptyState, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full flex-col">
      <header class="flex flex-col gap-2 border-b border-neutral-800 px-4 py-3">
        <input
          class="w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
          placeholder="Volltextsuche über alle Sessions — Pfade und Bezeichner in &quot;Anführungszeichen&quot;"
          [ngModel]="term()"
          (ngModelChange)="onInput($event)"
          autofocus
        />
        <div class="flex flex-wrap items-center gap-2">
          @for (scope of scopes; track scope) {
            <button
              type="button"
              class="rounded-full px-2.5 py-0.5 text-[11px] ring-1 ring-inset"
              [class]="store.scopes().includes(scope)
                ? 'bg-sky-500/15 text-sky-300 ring-sky-500/30'
                : 'text-neutral-500 ring-neutral-700 hover:text-neutral-300'"
              (click)="store.toggleScope(scope)"
            >
              {{ label(scope) }}
            </button>
          }
          <span class="ml-auto text-[11px] text-neutral-600">
            @if (store.searching()) { sucht … } @else { {{ store.total() }} Treffer }
          </span>
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto">
        @if (store.results().length === 0) {
          <cs-empty-state
            title="Keine Treffer"
            hint="Umlaute werden gefaltet (prufung findet Prüfung). Für Pfade und Bezeichner Anführungszeichen benutzen, etwa &quot;src/app&quot;."
          />
        } @else {
          <ul class="divide-y divide-neutral-900">
            @for (hit of store.results(); track $index) {
              <li class="px-4 py-3 hover:bg-neutral-900/50">
                <div class="flex items-baseline justify-between gap-3">
                  @if (hit.sessionId; as sessionId) {
                    <a [routerLink]="['/sessions', sessionId]" class="truncate text-sm text-neutral-200 hover:underline">
                      {{ hit.sessionTitle }}
                    </a>
                  } @else {
                    <span class="truncate text-sm text-neutral-200">{{ hit.sessionTitle }}</span>
                  }
                  <span class="shrink-0 text-[11px] text-neutral-600">
                    {{ label(hit.scope) }} · {{ hit.ts | csRelativeTime }}
                  </span>
                </div>
                <p class="mt-1 text-xs leading-relaxed text-neutral-400">
                  @for (part of parts(hit.snippet); track $index) {
                    @if (part.match) {
                      <mark class="rounded bg-amber-400/25 px-0.5 text-amber-200">{{ part.text }}</mark>
                    } @else {
                      <span>{{ part.text }}</span>
                    }
                  }
                </p>
                <p class="mt-1 truncate text-[11px] text-neutral-600">{{ hit.projectPath }}</p>
              </li>
            }
          </ul>
        }
      </div>
    </div>
  `,
})
export class SearchPage {
  protected readonly store = inject(SearchStore);
  protected readonly scopes: readonly SearchScope[] = ['prompts', 'assistant', 'tools', 'plans'];
  protected readonly term = signal('');

  #debounce: ReturnType<typeof setTimeout> | null = null;

  protected label(scope: SearchScope): string {
    return SCOPE_LABEL[scope];
  }

  protected parts(snippet: string) {
    return SearchStore.parseSnippet(snippet);
  }

  protected onInput(value: string): void {
    this.term.set(value);
    if (this.#debounce !== null) clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => void this.store.search(value), 180);
  }
}
