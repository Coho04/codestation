import { Pipe, type PipeTransform } from '@angular/core';

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600_000],
  ['month', 30 * 24 * 3600_000],
  ['day', 24 * 3600_000],
  ['hour', 3600_000],
  ['minute', 60_000],
  ['second', 1000],
];

@Pipe({ name: 'csRelativeTime' })
export class RelativeTimePipe implements PipeTransform {
  readonly #formatter = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });

  transform(value: number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    const delta = value - Date.now();
    for (const [unit, ms] of UNITS) {
      if (Math.abs(delta) >= ms || unit === 'second') {
        return this.#formatter.format(Math.round(delta / ms), unit);
      }
    }
    return '—';
  }
}
