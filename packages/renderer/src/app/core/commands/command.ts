import type { Signal } from '@angular/core';

export type CommandGroup = 'navigation' | 'session' | 'project' | 'index' | 'view';

export interface Command {
  readonly id: string;
  readonly title: string;
  readonly group: CommandGroup;
  /** Extra words to match against, e.g. a project path. */
  readonly keywords?: readonly string[];
  readonly shortcut?: string;
  readonly disabled?: Signal<boolean>;
  /** The return value is never used; handlers may return whatever they like. */
  run(): unknown;
}

/** A command that is derived from data, e.g. one per project. */
export interface CommandSource {
  commands(): readonly Command[];
}
