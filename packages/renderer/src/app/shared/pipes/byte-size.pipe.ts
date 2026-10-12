import { Pipe, type PipeTransform } from '@angular/core';

@Pipe({ name: 'csByteSize' })
export class ByteSizePipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    const units = ['B', 'kB', 'MB', 'GB'];
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]!}`;
  }
}
