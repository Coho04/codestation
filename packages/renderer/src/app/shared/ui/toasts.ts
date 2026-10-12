import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../../core/ui/toast.service';

@Component({
  selector: 'cs-toasts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pointer-events-none fixed bottom-8 right-4 z-50 flex flex-col gap-2">
      @for (toast of toasts.toasts(); track toast.id) {
        <button
          type="button"
          class="pointer-events-auto max-w-sm rounded border px-3 py-2 text-left text-xs shadow-lg"
          [class]="toast.tone === 'error'
            ? 'border-red-500/40 bg-red-950/80 text-red-200'
            : 'border-neutral-700 bg-neutral-900 text-neutral-200'"
          (click)="toasts.dismiss(toast.id)"
        >{{ toast.text }}</button>
      }
    </div>
  `,
})
export class Toasts {
  protected readonly toasts = inject(ToastService);
}
