import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import type { AppEvent, AppEventType } from '@cs/shared';
import { CS_API } from './api.token';

type Handler<T extends AppEventType> = (event: Extract<AppEvent, { type: T }>) => void;

/**
 * Fans the single bridge event stream out to typed subscribers.
 *
 * One subscription to the preload, many consumers: stores subscribe to the
 * event types they care about and the discriminated union keeps each handler
 * narrowed to its own payload.
 */
@Injectable({ providedIn: 'root' })
export class EventBus {
  readonly #handlers = new Map<AppEventType, Set<(event: AppEvent) => void>>();
  readonly #connected = signal(false);
  readonly connected = this.#connected.asReadonly();

  constructor() {
    const api = inject(CS_API, { optional: true });
    if (api === null) return;

    const unsubscribe = api.onEvent((event) => {
      for (const handler of this.#handlers.get(event.type) ?? []) handler(event);
    });
    this.#connected.set(true);
    inject(DestroyRef).onDestroy(unsubscribe);
  }

  on<T extends AppEventType>(type: T, handler: Handler<T>): () => void {
    const set = this.#handlers.get(type) ?? new Set();
    set.add(handler as (event: AppEvent) => void);
    this.#handlers.set(type, set);
    return () => set.delete(handler as (event: AppEvent) => void);
  }
}
