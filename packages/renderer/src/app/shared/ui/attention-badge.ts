import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { AttentionLevel } from '@cs/shared';

const LABEL: Record<AttentionLevel, string> = {
  'needs-you': 'wartet auf dich',
  working: 'arbeitet',
  idle: 'bereit',
  stale: 'verwaist',
  dead: 'beendet',
};

const CLASS: Record<AttentionLevel, string> = {
  'needs-you': 'bg-amber-400/15 text-amber-300 ring-amber-400/30',
  working: 'bg-sky-400/15 text-sky-300 ring-sky-400/30',
  idle: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/25',
  stale: 'bg-neutral-500/10 text-neutral-400 ring-neutral-500/25',
  dead: 'bg-neutral-500/10 text-neutral-500 ring-neutral-600/25',
};

@Component({
  selector: 'cs-attention-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset"
      [class]="classes()"
    >
      @if (level() === 'needs-you') {
        <span class="size-1.5 animate-pulse rounded-full bg-current"></span>
      } @else if (level() === 'working') {
        <span class="size-1.5 rounded-full bg-current"></span>
      }
      {{ label() }}
    </span>
  `,
})
export class AttentionBadge {
  readonly level = input.required<AttentionLevel>();
  protected readonly label = () => LABEL[this.level()];
  protected readonly classes = () => CLASS[this.level()];
}
