import {
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
  type ApplicationConfig,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';
import { CS_API, resolveBridge } from './core/ipc/api.token';

/**
 * Zoneless is load-bearing, not stylistic: with Zone.js every coalesced PTY
 * chunk (~125 IPC messages a second under `npm install`) would trigger an
 * app-wide change detection pass over sidebar, session list and transcript.
 * Signals make the terminal's output invisible to Angular entirely.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })),
    { provide: CS_API, useFactory: resolveBridge },
  ],
};
