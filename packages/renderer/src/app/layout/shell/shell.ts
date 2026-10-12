import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { Sidebar } from '../sidebar/sidebar';
import { Statusbar } from '../statusbar/statusbar';
import { TerminalDock } from '../../features/terminal/terminal-dock';
import { SessionPanel } from '../../features/terminal/session-panel';
import { Resizer } from '../../shared/ui/resizer';
import { APP_NAME } from '@cs/shared';
import { TerminalStore } from '../../core/state/terminal.store';
import { RuntimeStore } from '../../core/state/runtime.store';
import { SetupBanner } from '../../features/setup/setup-banner';
import { ContextMenu } from '../../shared/ui/context-menu';
import { Toasts } from '../../shared/ui/toasts';

const DOCK_HEIGHT = 360;
const COLLAPSED_STRIP = 24;

/**
 * The application frame, in two layouts.
 *
 * Normal: navigation left, content centre, terminal docked along the bottom.
 * Session: the terminal takes the main area and the session's own data sits to
 * its right, because during a session the terminal is what you are looking at.
 *
 * Both layouts are the *same element tree* — only the grid template changes.
 * Moving `<cs-terminal-dock>` with a structural block would destroy its xterm
 * instance and with it the scrollback and the PTY binding, so the router outlet
 * is hidden rather than removed and the dock simply lands in a different cell.
 */
@Component({
  selector: 'cs-shell',
  imports: [RouterOutlet, Sidebar, Statusbar, TerminalDock, SessionPanel, Resizer, SetupBanner, ContextMenu, Toasts],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="h-screen bg-neutral-950" [style]="gridStyle()">
      <header
        class="flex items-center justify-center border-b border-neutral-800 text-xs font-medium tracking-wide text-neutral-500"
        style="grid-area: head; -webkit-app-region: drag"
      >
        <span class="flex items-center gap-2 text-neutral-400">
          <!-- Drawn for this size rather than scaled down from the app icon:
               at 15 px the squircle and the cursor block cost more than they
               give, so the mark keeps the bubble and the prompt. -->
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" class="shrink-0">
            <path
              d="M3.4 4h17.2a1.9 1.9 0 0 1 1.9 1.9v8.2a1.9 1.9 0 0 1-1.9 1.9h-8.1L8.2 20v-4H3.4a1.9 1.9 0 0 1-1.9-1.9V5.9A1.9 1.9 0 0 1 3.4 4z"
              fill="currentColor"
              opacity="0.32"
            />
            <path
              d="M7.9 7.6 L11 10 L7.9 12.4"
              fill="none"
              stroke="#38bdf8"
              stroke-width="2.3"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <rect x="13.4" y="8.9" width="5" height="2.3" rx="1.15" fill="#f1f5f9" />
          </svg>
          {{ headerText() }}
        </span>
      </header>

      <cs-sidebar class="overflow-hidden" style="grid-area: side" />

      <!-- Hidden, never removed: it owns the router outlet, and re-creating the
           routed component on every mode switch would reload its data. -->
      <main class="overflow-y-auto" style="grid-area: main" [hidden]="terminal.focusMode()">
        @if (!runtime.ready() && !runtime.inBrowser) {
          <cs-setup-banner />
        }
        <router-outlet />
      </main>

      <cs-terminal-dock
        class="overflow-hidden"
        [class.border-t]="!terminal.focusMode()"
        [class.border-neutral-800]="!terminal.focusMode()"
        style="grid-area: dock"
      />

      @if (terminal.focusMode()) {
        @if (terminal.panelCollapsed()) {
          <div
            class="flex items-start justify-center border-l border-neutral-800 pt-2"
            style="grid-area: panel"
          >
            <button
              type="button"
              class="rounded px-1 py-2 text-[11px] text-neutral-600 hover:text-neutral-300"
              title="Session-Daten einblenden"
              (click)="terminal.togglePanel()"
            >‹</button>
          </div>
        } @else {
          <cs-resizer
            style="grid-area: grip"
            [width]="terminal.panelWidth()"
            edge="left"
            (widthChange)="terminal.setPanelWidth($event)"
            (reset)="terminal.togglePanel()"
          />
          <cs-session-panel style="grid-area: panel" />
        }
      }

      <cs-statusbar class="border-t border-neutral-800" style="grid-area: foot" />
    </div>

    <cs-context-menu />
    <cs-toasts />
  `,
})
export class Shell {
  protected readonly terminal = inject(TerminalStore);
  protected readonly runtime = inject(RuntimeStore);

  protected readonly headerText = computed(() =>
    this.terminal.focusMode() ? (this.terminal.activePane()?.title ?? APP_NAME) : APP_NAME,
  );

  /**
   * The whole layout switch lives in this one string, so there is exactly one
   * place that decides where each region sits.
   */
  /**
   * The entire layout switch, in one place.
   *
   * Three shapes rather than one with conditionals inside: the grid areas
   * differ by column count, and a template string assembled from fragments was
   * harder to read than the layouts it describes.
   */
  protected readonly gridStyle = computed<Record<string, string>>(() => {
    const rows = '36px 1fr 24px';

    if (!this.terminal.focusMode()) {
      return {
        display: 'grid',
        'grid-template-areas': '"head head" "side main" "side dock" "foot foot"',
        'grid-template-columns': '232px 1fr',
        'grid-template-rows': `36px 1fr ${this.terminal.dockOpen() ? `${String(DOCK_HEIGHT)}px` : '32px'} 24px`,
      };
    }

    if (this.terminal.panelCollapsed()) {
      return {
        display: 'grid',
        'grid-template-areas': '"head head head" "side dock panel" "foot foot foot"',
        'grid-template-columns': `232px 1fr ${String(COLLAPSED_STRIP)}px`,
        'grid-template-rows': rows,
      };
    }

    return {
      display: 'grid',
      'grid-template-areas': '"head head head head" "side dock grip panel" "foot foot foot foot"',
      'grid-template-columns': `232px 1fr 4px ${String(this.terminal.panelWidth())}px`,
      'grid-template-rows': rows,
    };
  });

  constructor() {
    // Any navigation means the user is looking at something other than the
    // terminal, so session mode ends.
    inject(Router)
      .events.pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.terminal.exitFocusMode());
  }
}
