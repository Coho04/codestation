import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core';
import { Shell } from './layout/shell/shell';
import { AppCommands } from './core/commands/app-commands';
import { CommandRegistry } from './core/commands/command-registry';
import { TerminalStore } from './core/state/terminal.store';

@Component({
  selector: 'cs-root',
  imports: [Shell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<cs-shell />',
})
export class App {
  readonly #registry = inject(CommandRegistry);
  readonly #terminal = inject(TerminalStore);

  constructor() {
    inject(AppCommands).install();
  }

  /**
   * Shortcuts go through the registry rather than calling stores directly, so a
   * key binding and a palette entry can never drift apart.
   */
  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    // Esc reaches here even while the terminal has focus, because xterm does not
    // consume it at the document level — which is what makes it usable as the
    // way out of session mode.
    if (event.key === 'Escape' && this.#terminal.focusMode()) {
      event.preventDefault();
      void this.#registry.run('view.exitFocus');
      return;
    }
    if (!event.metaKey || event.altKey || event.ctrlKey) return;
    const id = { j: 'view.toggleDock', f: 'nav.search' }[event.key.toLowerCase()];
    if (id === undefined) return;
    event.preventDefault();
    void this.#registry.run(id);
  }
}
