import { Injectable, computed, inject, signal } from '@angular/core';
import type { Page, SearchHit, SearchQuery, SearchScope } from '@cs/shared';
import { SNIPPET_CLOSE, SNIPPET_OPEN } from '@cs/shared';
import { CS_API } from '../ipc/api.token';

export interface SnippetPart {
  readonly text: string;
  readonly match: boolean;
}

@Injectable({ providedIn: 'root' })
export class SearchStore {
  readonly #api = inject(CS_API, { optional: true });
  readonly #results = signal<Page<SearchHit>>({ items: [], total: 0, offset: 0, limit: 50 });
  readonly #text = signal('');
  readonly #scopes = signal<readonly SearchScope[]>(['prompts', 'assistant', 'tools', 'plans']);
  readonly #searching = signal(false);

  readonly results = computed(() => this.#results().items);
  readonly total = computed(() => this.#results().total);
  readonly searching = this.#searching.asReadonly();
  readonly text = this.#text.asReadonly();
  readonly scopes = this.#scopes.asReadonly();

  async search(text: string, patch: Partial<SearchQuery> = {}): Promise<void> {
    this.#text.set(text);
    if (this.#api === null || text.trim().length === 0) {
      this.#results.set({ items: [], total: 0, offset: 0, limit: 50 });
      return;
    }
    this.#searching.set(true);
    try {
      this.#results.set(
        await this.#api.index.search({ text, scopes: this.#scopes(), limit: 50, ...patch }),
      );
    } finally {
      this.#searching.set(false);
    }
  }

  toggleScope(scope: SearchScope): void {
    this.#scopes.update((scopes) =>
      scopes.includes(scope) ? scopes.filter((value) => value !== scope) : [...scopes, scope],
    );
    void this.search(this.#text());
  }

  /**
   * Splits a snippet on the markers the indexer inserted.
   *
   * Control characters rather than HTML: the snippet text comes from transcript
   * content, and nothing from there is ever handed to the DOM as markup.
   */
  static parseSnippet(snippet: string): SnippetPart[] {
    const parts: SnippetPart[] = [];
    let rest = snippet;
    while (rest.length > 0) {
      const open = rest.indexOf(SNIPPET_OPEN);
      if (open === -1) {
        parts.push({ text: rest, match: false });
        break;
      }
      if (open > 0) parts.push({ text: rest.slice(0, open), match: false });
      const close = rest.indexOf(SNIPPET_CLOSE, open);
      if (close === -1) {
        parts.push({ text: rest.slice(open + 1), match: true });
        break;
      }
      parts.push({ text: rest.slice(open + 1, close), match: true });
      rest = rest.slice(close + 1);
    }
    return parts;
  }
}
