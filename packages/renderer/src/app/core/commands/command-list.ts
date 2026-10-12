import { computed, signal } from '@angular/core';
import type { Command, CommandSource } from './command';

/**
 * Every user-triggered action lives here, including the ones that currently only
 * have a button.
 *
 * This is the point of the indirection: a ⌘K palette is then a second surface
 * over the same list rather than a retrofit that has to hunt down every click
 * handler in the app. Adding one means rendering `all()` and filtering it.
 *
 * Deliberately free of decorators so it can be unit-tested without the Angular
 * compiler; `CommandRegistry` is the thin injectable wrapper around it.
 */
export class CommandList {
  readonly #static = signal<readonly Command[]>([]);
  readonly #sources = signal<readonly CommandSource[]>([]);

  readonly all = computed<readonly Command[]>(() => [
    ...this.#static(),
    ...this.#sources().flatMap((source) => source.commands()),
  ]);

  register(...commands: readonly Command[]): () => void {
    this.#static.update((current) => [...current, ...commands]);
    const ids = new Set(commands.map((command) => command.id));
    return () => this.#static.update((current) => current.filter((c) => !ids.has(c.id)));
  }

  /** For commands that come from data — one per project, one per open pane. */
  registerSource(source: CommandSource): () => void {
    this.#sources.update((current) => [...current, source]);
    return () => this.#sources.update((current) => current.filter((s) => s !== source));
  }

  find(id: string): Command | undefined {
    return this.all().find((command) => command.id === id);
  }

  async run(id: string): Promise<void> {
    const command = this.find(id);
    if (command === undefined || command.disabled?.() === true) return;
    await command.run();
  }

  /** Simple substring match over title and keywords; enough for a palette. */
  search(query: string): readonly Command[] {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return this.all();
    return this.all().filter((command) =>
      [command.title, ...(command.keywords ?? [])].some((text) => text.toLowerCase().includes(needle)),
    );
  }
}
