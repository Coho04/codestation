import { Injectable, signal } from '@angular/core';

export interface MenuItem {
  readonly label: string;
  readonly run: () => unknown;
  /** Irreversible actions are set apart and coloured. */
  readonly danger?: boolean;
  readonly separatorBefore?: boolean;
  readonly disabled?: boolean;
}

export interface MenuState {
  readonly x: number;
  readonly y: number;
  readonly title: string;
  readonly items: readonly MenuItem[];
}

@Injectable({ providedIn: 'root' })
export class ContextMenuService {
  readonly #state = signal<MenuState | null>(null);
  readonly state = this.#state.asReadonly();

  open(event: MouseEvent, title: string, items: readonly MenuItem[]): void {
    event.preventDefault();
    event.stopPropagation();
    this.#state.set({ x: event.clientX, y: event.clientY, title, items });
  }

  close(): void {
    this.#state.set(null);
  }
}
