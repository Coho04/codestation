import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { LayoutNode } from '@cs/shared';
import { TerminalPane } from './terminal-pane';

/**
 * Renders a layout tree recursively.
 *
 * v1 only ever builds single leaves, but the split branch exists and is correct
 * from the start. Adding splits later is then a matter of producing split nodes
 * and adding a divider — not of rewriting the renderer, the IPC addressing and
 * the main-process registry at the same time.
 */
@Component({
  selector: 'cs-pane-host',
  imports: [TerminalPane],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (node().type) {
      @case ('leaf') {
        <cs-terminal-pane [paneId]="leafPaneId()" />
      }
      @case ('split') {
        <div
          class="flex h-full w-full gap-px bg-neutral-800"
          [class.flex-row]="direction() === 'row'"
          [class.flex-col]="direction() === 'column'"
        >
          @for (child of children(); track $index) {
            <cs-pane-host class="min-h-0 min-w-0" [node]="child" [style.flex]="sizes()[$index] ?? 1" />
          }
        </div>
      }
    }
  `,
  styles: `:host { display: block; height: 100%; }`,
})
export class PaneHost {
  readonly node = input.required<LayoutNode>();

  protected leafPaneId() {
    const node = this.node();
    return node.type === 'leaf' ? node.paneId : ('' as never);
  }
  protected direction() {
    const node = this.node();
    return node.type === 'split' ? node.direction : 'row';
  }
  protected children(): readonly LayoutNode[] {
    const node = this.node();
    return node.type === 'split' ? node.children : [];
  }
  protected sizes(): readonly number[] {
    const node = this.node();
    return node.type === 'split' ? node.sizes : [];
  }
}
