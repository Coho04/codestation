import { ChangeDetectionStrategy, Component, inject, input, output, DestroyRef } from '@angular/core';

/**
 * A vertical drag handle.
 *
 * Pointer capture rather than document-level listeners: the pointer keeps
 * reporting to this element even when it leaves it, which is exactly what
 * happens when someone drags fast across a terminal that is swallowing events.
 */
@Component({
  selector: 'cs-resizer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="group h-full w-1 cursor-col-resize bg-neutral-800 transition-colors hover:bg-sky-600"
      role="separator"
      aria-orientation="vertical"
      (pointerdown)="onPointerDown($event)"
      (dblclick)="reset.emit()"
    ></div>
  `,
  styles: `:host { display: block; }`,
})
export class Resizer {
  /** Current width, so the drag can be relative rather than absolute. */
  readonly width = input.required<number>();
  /** Which side grows when the pointer moves right. */
  readonly edge = input<'left' | 'right'>('left');

  readonly widthChange = output<number>();
  readonly reset = output<void>();

  #startX = 0;
  #startWidth = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.#detach());
  }

  #target: HTMLElement | null = null;

  protected onPointerDown(event: PointerEvent): void {
    event.preventDefault();
    this.#startX = event.clientX;
    this.#startWidth = this.width();
    this.#target = event.target as HTMLElement;
    this.#target.setPointerCapture(event.pointerId);
    this.#target.addEventListener('pointermove', this.#onMove);
    this.#target.addEventListener('pointerup', this.#onUp);
    this.#target.addEventListener('pointercancel', this.#onUp);
  }

  readonly #onMove = (event: PointerEvent): void => {
    const delta = event.clientX - this.#startX;
    const next = this.edge() === 'left' ? this.#startWidth - delta : this.#startWidth + delta;
    this.widthChange.emit(Math.round(next));
  };

  readonly #onUp = (): void => this.#detach();

  #detach(): void {
    this.#target?.removeEventListener('pointermove', this.#onMove);
    this.#target?.removeEventListener('pointerup', this.#onUp);
    this.#target?.removeEventListener('pointercancel', this.#onUp);
    this.#target = null;
  }
}
