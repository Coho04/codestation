import { ChangeDetectionStrategy, Component, HostListener, computed, inject } from '@angular/core';
import { ContextMenuService, type MenuItem } from '../../core/ui/context-menu.service';

const WIDTH = 240;
const ITEM_HEIGHT = 28;

@Component({
  selector: 'cs-context-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (menu.state(); as state) {
      <div class="fixed inset-0 z-50" (click)="menu.close()" (contextmenu)="menu.close()">
        <div
          class="absolute rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-xl"
          [style.left.px]="position().x"
          [style.top.px]="position().y"
          [style.width.px]="width"
          (click)="$event.stopPropagation()"
        >
          <p class="truncate px-3 pb-1 pt-0.5 text-[11px] text-neutral-600">{{ state.title }}</p>
          @for (item of state.items; track item.label) {
            @if (item.separatorBefore) {
              <hr class="my-1 border-neutral-800" />
            }
            <button
              type="button"
              class="block w-full px-3 py-1 text-left text-xs disabled:opacity-40"
              [class]="item.danger
                ? 'text-red-400 hover:bg-red-500/10'
                : 'text-neutral-300 hover:bg-neutral-800'"
              [disabled]="item.disabled === true"
              (click)="select(item)"
            >{{ item.label }}</button>
          }
        </div>
      </div>
    }
  `,
})
export class ContextMenu {
  protected readonly menu = inject(ContextMenuService);
  protected readonly width = WIDTH;

  /** Keeps the menu on screen when opened near the right or bottom edge. */
  protected readonly position = computed(() => {
    const state = this.menu.state();
    if (state === null) return { x: 0, y: 0 };
    const height = state.items.length * ITEM_HEIGHT + 32;
    return {
      x: Math.min(state.x, globalThis.innerWidth - WIDTH - 8),
      y: Math.min(state.y, Math.max(8, globalThis.innerHeight - height - 8)),
    };
  });

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.menu.close();
  }

  protected select(item: MenuItem): void {
    if (item.disabled === true) return;
    this.menu.close();
    void item.run();
  }
}
