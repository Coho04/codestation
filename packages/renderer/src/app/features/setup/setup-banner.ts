import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RuntimeStore } from '../../core/state/runtime.store';

/**
 * Shown when the Claude CLI cannot be resolved.
 *
 * Deliberately a blocking, explicit message with the actual error rather than a
 * dashboard that looks healthy and fails the moment a session is started.
 */
@Component({
  selector: 'cs-setup-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="m-4 rounded border border-amber-500/30 bg-amber-500/10 px-4 py-3">
      <p class="text-sm font-medium text-amber-200">Claude-CLI nicht gefunden</p>
      <p class="mt-1 text-xs text-amber-200/70">
        {{ runtime.info()?.error ?? 'Erwartet im PATH oder unter /opt/homebrew/bin/claude.' }}
      </p>
      <p class="mt-2 text-xs text-amber-200/60">
        Archiv und Suche funktionieren weiterhin — nur das Starten von Sessions ist blockiert.
      </p>
      <button
        type="button"
        class="mt-3 rounded border border-amber-400/40 px-2 py-1 text-xs text-amber-100 hover:bg-amber-400/10"
        (click)="runtime.pickBinary()"
      >
        Binary auswählen …
      </button>
    </div>
  `,
})
export class SetupBanner {
  protected readonly runtime = inject(RuntimeStore);
}
