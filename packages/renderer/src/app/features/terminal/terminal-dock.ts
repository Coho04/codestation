import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { PaneId, TabId } from '@cs/shared';
import { TerminalStore } from '../../core/state/terminal.store';
import { LiveStatusStore } from '../../core/state/live-status.store';
import { PaneHost } from './pane-host';

@Component({
  selector: 'cs-terminal-dock',
  imports: [PaneHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full flex-col bg-neutral-950">
      <div class="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-neutral-800 px-1">
        <!-- Collapsing the dock is meaningless in session mode, where the dock
             *is* the main area; offer the way out of session mode instead. -->
        @if (store.focusMode()) {
          <button
            type="button"
            class="rounded px-2 py-0.5 text-[11px] text-neutral-500 hover:text-neutral-300"
            title="Session-Modus verlassen (Esc)"
            (click)="store.exitFocusMode()"
          >‹ Übersicht</button>
        } @else {
          <button
            type="button"
            class="rounded px-2 py-0.5 text-[11px] text-neutral-500 hover:text-neutral-300"
            (click)="store.toggleDock()"
            [title]="store.dockOpen() ? 'Terminal einklappen' : 'Terminal ausklappen'"
          >
            {{ store.dockOpen() ? '▾' : '▸' }} Terminal
          </button>
        }

        @for (tab of store.tabs(); track tab.id) {
          <button
            type="button"
            class="group flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px]"
            [class]="tab.id === store.activeTabId()
              ? 'bg-neutral-800 text-neutral-100'
              : 'text-neutral-500 hover:bg-neutral-900'"
            (click)="store.selectTab(tab.id)"
          >
            @if (attentionFor(tab.activePaneId)) {
              <span class="size-1.5 animate-pulse rounded-full bg-amber-400"></span>
            }
            <span class="max-w-40 truncate">{{ tab.title }}</span>
            <span
              class="opacity-0 transition group-hover:opacity-100"
              (click)="close($event, tab.id, tab.activePaneId)"
            >×</span>
          </button>
        } @empty {
          <span class="px-2 text-[11px] text-neutral-700">keine Session geöffnet</span>
        }
      </div>

      <div class="min-h-0 flex-1">
        @for (tab of store.tabs(); track tab.id) {
          <!-- Hidden, never removed: destroying the component would discard the
               xterm buffer and the PTY binding. -->
          <div class="h-full" [hidden]="tab.id !== store.activeTabId()">
            @if (paneState(tab.activePaneId); as state) {
              @if (state.type === 'exited') {
                <div class="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <p class="text-xs text-neutral-400">
                    Session beendet (Code {{ state.exitCode }}{{ state.signal !== null ? ', Signal ' + state.signal : '' }})
                  </p>
                  <p class="max-w-md text-[11px] text-neutral-600">
                    Das Transcript ist erhalten. Fortsetzen startet dieselbe Session erneut.
                  </p>
                  <div class="flex gap-2">
                    <button type="button" class="rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-200 hover:bg-neutral-700"
                            (click)="resume(tab.activePaneId)">Fortsetzen</button>
                    <button type="button" class="rounded px-2 py-1 text-[11px] text-neutral-500 hover:text-neutral-300"
                            (click)="store.closePane(tab.activePaneId, true)">Schließen</button>
                  </div>
                </div>
              } @else if (state.type === 'failed') {
                <div class="flex h-full items-center justify-center px-6 text-center text-xs text-red-300">
                  {{ state.reason }}
                </div>
              } @else {
                <cs-pane-host [node]="tab.root" />
              }
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: `:host { display: block; }`,
})
export class TerminalDock {
  protected readonly store = inject(TerminalStore);
  readonly #live = inject(LiveStatusStore);

  protected readonly waitingPanes = computed(() => {
    const ids = new Set<PaneId>();
    for (const session of this.#live.needsAttention()) {
      if (session.paneId !== null) ids.add(session.paneId);
    }
    return ids;
  });

  protected attentionFor(paneId: PaneId): boolean {
    return this.waitingPanes().has(paneId);
  }

  protected paneState(paneId: PaneId) {
    return this.store.panes().get(paneId)?.state ?? null;
  }

  protected close(event: Event, _tabId: TabId, paneId: PaneId): void {
    event.stopPropagation();
    void this.store.closePane(paneId);
  }

  protected resume(paneId: PaneId): void {
    const pane = this.store.panes().get(paneId);
    if (pane === undefined) return;
    const spec = pane.spec;
    if (spec.kind !== 'claude') return;
    // The session id was pinned with --session-id at launch, so resuming after
    // the PTY is gone restores the same conversation rather than starting over.
    const sessionId = pane.state.type === 'running' ? pane.state.sessionId : null;
    void this.store.closePane(paneId, true).then(() =>
      this.store.openClaude(spec.projectPath, {
        ...spec.launch,
        mode: sessionId !== null ? { type: 'resume', sessionId } : { type: 'new' },
      }),
    );
  }
}
