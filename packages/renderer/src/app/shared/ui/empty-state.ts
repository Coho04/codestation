import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'cs-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p class="text-sm font-medium text-neutral-300">{{ title() }}</p>
      @if (hint(); as text) {
        <p class="max-w-md text-xs text-neutral-500">{{ text }}</p>
      }
      <ng-content />
    </div>
  `,
})
export class EmptyState {
  readonly title = input.required<string>();
  readonly hint = input<string | null>(null);
}
