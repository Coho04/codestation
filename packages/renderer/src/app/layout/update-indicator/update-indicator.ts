import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { UpdateStore } from '../../core/state/update.store';

/**
 * The entire update surface: one status-bar entry that opens a panel.
 *
 * Deliberately not a modal and not a notification. An update is never urgent
 * enough to interrupt a running session, and a dialog that steals focus while
 * Claude is waiting for an answer would be worse than no update check at all.
 */
@Component({
  selector: 'cs-update-indicator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative' },
  template: `
    @if (store.status(); as status) {
      <button
        type="button"
        class="flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-neutral-800"
        [class.text-emerald-400]="store.hasUpdate()"
        [title]="buttonTitle()"
        (click)="toggle()"
      >
        @if (store.hasUpdate()) {
          <span class="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
          <span>Version {{ store.release()?.version }} verfügbar</span>
        } @else {
          <span>v{{ status.currentVersion }}</span>
        }
      </button>

      @if (open()) {
        <!-- Click-away layer. A real overlay would need the CDK for one panel. -->
        <div class="fixed inset-0 z-40" (click)="open.set(false)"></div>

        <div
          class="absolute bottom-full right-0 z-50 mb-2 w-96 rounded-md border border-neutral-700
                 bg-neutral-900 p-3 text-xs text-neutral-300 shadow-xl"
        >
          <div class="mb-2 flex items-baseline justify-between gap-2">
            <span class="text-sm font-medium text-neutral-100">{{ headline() }}</span>
            <span class="text-[11px] text-neutral-500">installiert: {{ status.currentVersion }}</span>
          </div>

          @switch (status.phase.kind) {
            @case ('checking') {
              <p class="text-neutral-400">Suche nach Updates …</p>
            }
            @case ('error') {
              <p class="text-amber-400">Prüfung fehlgeschlagen: {{ store.errorMessage() }}</p>
            }
            @case ('downloading') {
              <div class="mb-1 h-1 w-full overflow-hidden rounded bg-neutral-800">
                <div class="h-full bg-sky-500 transition-[width]" [style.width.%]="store.percent()"></div>
              </div>
              <p class="text-neutral-400">Wird geladen … {{ store.percent() }} %</p>
            }
            @case ('ready') {
              <p class="text-neutral-400">
                Geladen und geprüft. Die neue Version wird beim Neustart aktiv — laufende
                Terminal-Sessions werden dabei beendet.
              </p>
            }
            @case ('current') {
              <p class="text-neutral-400">
                Du nutzt die neueste Version.
                @if (lastChecked(); as when) {
                  <span class="text-neutral-500">Zuletzt geprüft: {{ when }}</span>
                }
              </p>
            }
          }

          @if (store.release(); as release) {
            @if (release.notes) {
              <pre
                class="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-neutral-950 p-2
                       text-[11px] leading-relaxed text-neutral-400"
                >{{ release.notes }}</pre
              >
            }
          }

          <div class="mt-3 flex flex-wrap items-center gap-2">
            @if (store.hasUpdate()) {
              @switch (status.phase.kind) {
                @case ('ready') {
                  <button type="button" class="rounded bg-emerald-600 px-2 py-1 text-white hover:bg-emerald-500"
                          (click)="store.install()">
                    Neu starten und installieren
                  </button>
                }
                @case ('downloading') {}
                @default {
                  @if (store.canInstall()) {
                    <button type="button" class="rounded bg-sky-600 px-2 py-1 text-white hover:bg-sky-500"
                            (click)="store.download()">
                      Herunterladen
                    </button>
                  } @else {
                    <button type="button" class="rounded bg-sky-600 px-2 py-1 text-white hover:bg-sky-500"
                            (click)="store.openRelease()">
                      Download öffnen
                    </button>
                  }
                }
              }
            } @else {
              <button type="button" class="rounded border border-neutral-700 px-2 py-1 hover:bg-neutral-800"
                      [disabled]="store.checking()" (click)="store.check()">
                Jetzt prüfen
              </button>
            }

            <label class="ml-auto flex items-center gap-1.5 text-[11px] text-neutral-500">
              <input
                type="checkbox"
                class="accent-sky-500"
                [checked]="status.checksEnabled"
                (change)="onToggleChecks($event)"
              />
              automatisch prüfen
            </label>
          </div>

          @if (!store.canInstall() && store.hasUpdate()) {
            <!-- Honesty beats a button that would fail: a build signed with a
                 development certificate cannot replace itself. -->
            <p class="mt-2 text-[11px] text-neutral-500">
              Diese Ausgabe aktualisiert sich nicht selbst. Lade das Disk-Image und ersetze
              CodeStation im Programme-Ordner.
            </p>
          }
        </div>
      }
    }
  `,
})
export class UpdateIndicator {
  protected readonly store = inject(UpdateStore);
  protected readonly open = signal(false);

  protected readonly headline = computed(() =>
    this.store.hasUpdate() ? `CodeStation ${this.store.release()?.version}` : 'CodeStation',
  );

  protected readonly buttonTitle = computed(() =>
    this.store.hasUpdate() ? 'Update verfügbar' : 'Version und Update-Prüfung',
  );

  protected readonly lastChecked = computed(() => {
    const at = this.store.status()?.lastCheckedAt;
    return at == null ? null : new Date(at).toLocaleString('de-DE');
  });

  protected toggle(): void {
    this.open.update((value) => !value);
    // Opening the panel is the clearest signal that the user wants to know, so
    // it doubles as a check — but never while one is already running.
    if (this.open() && !this.store.hasUpdate() && !this.store.checking()) void this.store.check();
  }

  protected onToggleChecks(event: Event): void {
    void this.store.setChecksEnabled((event.target as HTMLInputElement).checked);
  }
}
