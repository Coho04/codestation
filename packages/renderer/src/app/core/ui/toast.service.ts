import { Injectable, signal } from '@angular/core';

export interface Toast {
  readonly id: number;
  readonly text: string;
  readonly tone: 'info' | 'error';
}

const LIFETIME_MS = 6000;

/**
 * Short confirmations for actions whose result is otherwise invisible.
 *
 * A deletion that silently succeeds and one that silently fails look identical
 * in a list that has already removed the row.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly #toasts = signal<readonly Toast[]>([]);
  readonly toasts = this.#toasts.asReadonly();
  #next = 1;

  show(text: string, tone: Toast['tone'] = 'info'): void {
    const id = this.#next++;
    this.#toasts.update((current) => [...current, { id, text, tone }]);
    setTimeout(() => this.dismiss(id), LIFETIME_MS);
  }

  dismiss(id: number): void {
    this.#toasts.update((current) => current.filter((toast) => toast.id !== id));
  }
}
