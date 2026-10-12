import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  viewChild,
  type ElementRef,
} from '@angular/core';
import type { PaneId } from '@cs/shared';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { CanvasAddon } from '@xterm/addon-canvas';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { CS_API } from '../../core/ipc/api.token';

/**
 * Exactly one xterm instance. Never recreated while its pane exists — the
 * buffer and the PTY binding live here.
 */
@Component({
  selector: 'cs-terminal-pane',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host class="h-full w-full"></div>`,
  styles: `
    :host { display: block; height: 100%; }
    ::ng-deep .xterm { padding: 6px 8px; height: 100%; }
  `,
})
export class TerminalPane {
  readonly paneId = input.required<PaneId>();

  protected readonly hostRef = viewChild.required<ElementRef<HTMLDivElement>>('host');
  readonly #api = inject(CS_API, { optional: true });
  readonly #search = new SearchAddon();

  #terminal: Terminal | null = null;
  #fit: FitAddon | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);

    effect((onCleanup) => {
      const paneId = this.paneId();
      const host = this.hostRef().nativeElement;
      const api = this.#api;
      if (api === null) return;

      const terminal = new Terminal({
        allowProposedApi: true,
        scrollback: 10_000,
        fontFamily: 'SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        // Without this, Alt-based shortcuts in the Claude TUI do nothing.
        macOptionIsMeta: true,
        cursorBlink: true,
        theme: { background: '#0a0a0a', foreground: '#d4d4d4' },
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.loadAddon(new Unicode11Addon());
      terminal.unicode.activeVersion = '11';
      terminal.loadAddon(new WebLinksAddon((event, uri) => {
        event.preventDefault();
        void api.terminal.openExternal(uri);
      }));
      terminal.loadAddon(this.#search);
      terminal.open(host);

      // Browsers cap WebGL contexts at roughly 16; with splits the oldest one
      // gets dropped. Handling the loss now avoids an unreproducible bug later.
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          webgl.dispose();
          terminal.loadAddon(new CanvasAddon());
        });
        terminal.loadAddon(webgl);
      } catch {
        terminal.loadAddon(new CanvasAddon());
      }

      this.#terminal = terminal;
      this.#fit = fit;

      const detachData = api.pty.attach(paneId, (chunk) => {
        // The acknowledgement comes from xterm's own write callback, which fires
        // once the chunk has actually been parsed — the only honest signal that
        // the terminal has kept up with the process.
        terminal.write(chunk, () => api.pty.ack(paneId, chunk.length));
      });

      const input = terminal.onData((data) => api.pty.write(paneId, data));

      const resize = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          // fit() on a hidden element computes zero columns and wrecks the
          // child process's idea of the screen.
          if (!host.isConnected || host.clientWidth === 0 || host.clientHeight === 0) return;
          fit.fit();
          void api.terminal.resizePane(paneId, terminal.cols, terminal.rows);
        });
      });
      resize.observe(host);

      void api.terminal.replayBuffer(paneId).then((buffer) => {
        if (buffer.length > 0) terminal.write(buffer);
        if (host.clientWidth > 0) {
          fit.fit();
          void api.terminal.resizePane(paneId, terminal.cols, terminal.rows);
        }
      });

      onCleanup(() => {
        resize.disconnect();
        detachData();
        input.dispose();
        terminal.dispose();
        this.#terminal = null;
        this.#fit = null;
      });
    });

    destroyRef.onDestroy(() => {
      this.#terminal?.dispose();
    });
  }

  focus(): void {
    this.#terminal?.focus();
  }

  refit(): void {
    const host = this.hostRef().nativeElement;
    if (host.clientWidth === 0) return;
    this.#fit?.fit();
    const terminal = this.#terminal;
    if (terminal !== null) void this.#api?.terminal.resizePane(this.paneId(), terminal.cols, terminal.rows);
  }

  findNext(term: string): void {
    this.#search.findNext(term);
  }

  findPrevious(term: string): void {
    this.#search.findPrevious(term);
  }
}
