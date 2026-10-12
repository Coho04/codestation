import { Pipe, type PipeTransform } from '@angular/core';

const FORMAT = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'USD' });

/**
 * A missing cost renders as "unbekannt", never as 0.00.
 *
 * Most sessions have no recorded cost and are priced from token usage; where the
 * model's price is unknown there is no honest number to show, and a confident
 * zero would be believed.
 */
@Pipe({ name: 'csCost' })
export class CostPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    if (value === null || value === undefined) return 'unbekannt';
    return FORMAT.format(value);
  }
}
