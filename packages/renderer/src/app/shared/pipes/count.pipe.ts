import { Pipe, type PipeTransform } from '@angular/core';

const FORMAT = new Intl.NumberFormat('de-DE');

@Pipe({ name: 'csCount' })
export class CountPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : FORMAT.format(value);
  }
}
