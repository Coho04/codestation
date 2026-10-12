import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { IndexProgressStore } from '../../core/state/index-progress.store';
import { LiveStatusStore } from '../../core/state/live-status.store';
import { RuntimeStore } from '../../core/state/runtime.store';
import { UpdateIndicator } from '../update-indicator/update-indicator';

@Component({
  selector: 'cs-statusbar',
  imports: [UpdateIndicator],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full items-center gap-4 px-3 text-[11px] text-neutral-500">
      @if (indexFailed()) {
        <span class="text-red-400">Index nicht verfügbar — Details im Log</span>
      } @else if (progress.busy()) {
        <span class="flex items-center gap-2">
          <span class="inline-block h-1 w-24 overflow-hidden rounded bg-neutral-800">
            <span class="block h-full bg-sky-500 transition-[width]" [style.width.%]="progress.percent()"></span>
          </span>
          {{ phaseLabel() }} {{ progress.percent() }}%
        </span>
      } @else {
        <span>Index aktuell</span>
      }

      <span>{{ running() }} laufend</span>
      @if (attention() > 0) {
        <span class="text-amber-400">{{ attention() }} wartet auf dich</span>
      }

      <span class="ml-auto flex items-center gap-3">
        @if (drift().length > 0) {
          <span
            class="text-amber-500"
            [title]="'Unbekannte Record-Typen: ' + drift().join(', ')"
          >
            {{ drift().length }} unbekannte Record-Typen
          </span>
        }
        @if (runtime.info(); as info) {
          <span [title]="info.path ?? ''">
            {{ info.version ? 'Claude ' + info.version : 'Claude nicht gefunden' }}
          </span>
        }
        <cs-update-indicator />
      </span>
    </div>
  `,
})
export class Statusbar {
  protected readonly progress = inject(IndexProgressStore);
  protected readonly runtime = inject(RuntimeStore);
  readonly #live = inject(LiveStatusStore);

  protected readonly running = computed(() => this.#live.running().length);
  protected readonly attention = computed(() => this.#live.needsAttention().length);
  protected readonly drift = this.progress.drift;
  /** The indexer process gave up restarting; the index will not fill. */
  protected readonly indexFailed = computed(() => this.progress.progress().decodeErrors < 0);

  protected readonly phaseLabel = computed(() => {
    switch (this.progress.progress().phase) {
      case 'registry':
        return 'Projekte lesen';
      case 'skeleton':
        return 'Sessions erfassen';
      case 'full':
        return 'Transcripts indizieren';
      case 'idle':
        return '';
    }
  });
}
