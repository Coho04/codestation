import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { APP_NAME, type Effort, type PermissionMode, type ProjectSummary } from '@cs/shared';
import { ProjectsStore } from '../../core/state/projects.store';
import { TerminalStore } from '../../core/state/terminal.store';
import { RuntimeStore } from '../../core/state/runtime.store';

@Component({
  selector: 'cs-launch-dialog',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" (click)="closed.emit()">
      <div
        class="w-full max-w-lg rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-xl"
        (click)="$event.stopPropagation()"
      >
        <h2 class="text-sm font-semibold text-neutral-100">Neue Claude-Session</h2>

        <label class="mt-4 block text-xs text-neutral-400">
          Projekt
          <select
            class="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200"
            [(ngModel)]="projectPath"
          >
            @for (project of selectable(); track project.id) {
              <option [value]="project.path">{{ project.displayName }}</option>
            }
          </select>
        </label>

        <label class="mt-3 block text-xs text-neutral-400">
          Name (optional)
          <input
            class="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200"
            [(ngModel)]="name"
            placeholder="z. B. Pipeline reparieren"
          />
        </label>

        <div class="mt-3 grid grid-cols-2 gap-3">
          <label class="block text-xs text-neutral-400">
            Effort
            <select
              class="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200"
              [(ngModel)]="effort"
            >
              <option value="">Standard</option>
              @for (option of efforts; track option) {
                <option [value]="option">{{ option }}</option>
              }
            </select>
          </label>
          <label class="block text-xs text-neutral-400">
            Berechtigungen
            <select
              class="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200"
              [(ngModel)]="permissionMode"
            >
              <option value="">Standard</option>
              @for (option of permissionModes; track option) {
                <option [value]="option">{{ option }}</option>
              }
            </select>
          </label>
        </div>

        <label class="mt-4 flex items-start gap-2 text-xs text-neutral-400">
          <input type="checkbox" class="mt-0.5" [(ngModel)]="background" />
          <span>
            Weiterlaufen lassen, wenn {{ appName }} schließt
            <span class="mt-0.5 block text-neutral-600">
              Startet die Session als Hintergrund-Job. Ohne diese Option endet sie mit der App —
              das Transcript bleibt erhalten und lässt sich jederzeit fortsetzen.
            </span>
          </span>
        </label>

        @if (terminal.error(); as error) {
          <p class="mt-3 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-300">
            {{ error }}
          </p>
        }

        <div class="mt-5 flex justify-end gap-2">
          <button type="button" class="rounded px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200"
                  (click)="closed.emit()">Abbrechen</button>
          <button
            type="button"
            class="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-40"
            [disabled]="!canStart()"
            (click)="start()"
          >
            Starten
          </button>
        </div>

        @if (!runtime.ready()) {
          <p class="mt-3 text-[11px] text-amber-400">Claude-CLI nicht verfügbar — Starten ist deaktiviert.</p>
        }
      </div>
    </div>
  `,
})
export class LaunchDialog {
  readonly closed = output<void>();

  protected readonly terminal = inject(TerminalStore);
  protected readonly runtime = inject(RuntimeStore);
  readonly #projects = inject(ProjectsStore);

  protected readonly appName = APP_NAME;
  protected readonly efforts: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
  protected readonly permissionModes: readonly PermissionMode[] = [
    'manual', 'acceptEdits', 'auto', 'plan', 'dontAsk', 'bypassPermissions',
  ];

  protected readonly selectable = computed(() =>
    this.#projects.projects().filter((project: ProjectSummary) => project.pathExists),
  );

  protected projectPath = signal(this.selectable()[0]?.path ?? '');
  protected name = signal('');
  protected effort = signal<'' | Effort>('');
  protected permissionMode = signal<'' | PermissionMode>('');
  protected background = signal(false);

  protected readonly canStart = computed(
    () => this.runtime.ready() && this.projectPath().length > 0,
  );

  protected async start(): Promise<void> {
    const path = this.projectPath();
    if (path.length === 0) return;
    const effort = this.effort();
    const permissionMode = this.permissionMode();
    const name = this.name().trim();

    const paneId = await this.terminal.openClaude(path, {
      mode: { type: 'new' },
      ...(name.length > 0 ? { name } : {}),
      ...(effort !== '' ? { effort } : {}),
      ...(permissionMode !== '' ? { permissionMode } : {}),
      background: this.background(),
    });
    if (paneId !== null) this.closed.emit();
  }
}
