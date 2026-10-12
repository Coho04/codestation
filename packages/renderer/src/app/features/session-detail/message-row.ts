import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import type { ContentBlock, MessageRow, SessionId } from '@cs/shared';
import { CS_API } from '../../core/ipc/api.token';
import { ByteSizePipe } from '../../shared/pipes/byte-size.pipe';

/**
 * Renders one transcript message.
 *
 * Everything is text: nothing from a transcript is ever handed to the DOM as
 * markup. Large blocks are capped with an explicit "show more" rather than
 * rendered in full — a single tool result can be several megabytes.
 */
@Component({
  selector: 'cs-message-row',
  imports: [ByteSizePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="rounded border px-3 py-2"
      [class]="message().role === 'user'
        ? 'border-sky-900/50 bg-sky-950/20'
        : 'border-neutral-800 bg-neutral-900/30'"
    >
      <header class="mb-1.5 flex items-center gap-2 text-[11px] text-neutral-600">
        <span class="font-medium" [class.text-sky-400]="message().role === 'user'">
          {{ roleLabel() }}
        </span>
        @if (message().model; as model) { <span>{{ model }}</span> }
        @if (!message().onMainPath) {
          <span class="rounded bg-neutral-800 px-1" title="Nicht Teil des aktuellen Gesprächsverlaufs">Nebenzweig</span>
        }
        @if (message().childCount > 1) {
          <span class="text-amber-500/80">{{ message().childCount }} Fortsetzungen</span>
        }
        @if (message().contextTokensLeft; as left) {
          <span class="ml-auto" [title]="'Verbleibendes Kontextbudget'">{{ left }} Tokens frei</span>
        }
      </header>

      @for (block of message().blocks; track $index) {
        @switch (block.kind) {
          @case ('text') {
            <p class="whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-300">{{ textOf(block) }}</p>
            @if (isTruncated(block)) {
              <span class="text-[11px] text-neutral-600">… gekürzt</span>
            }
          }
          @case ('tool-use') {
            <div class="mt-1 flex items-start gap-2 rounded bg-neutral-950/60 px-2 py-1">
              <span class="shrink-0 text-[11px] font-medium text-violet-400">{{ nameOf(block) }}</span>
              <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-neutral-400">{{ summaryOf(block) }}</span>
            </div>
          }
          @case ('tool-result') {
            <div class="mt-1 rounded bg-neutral-950/60 px-2 py-1">
              <button
                type="button"
                class="flex w-full items-center gap-2 text-left text-[11px]"
                [class.text-red-400]="isError(block)"
                [class.text-neutral-500]="!isError(block)"
                (click)="toggleResult(toolIdOf(block))"
              >
                <span>{{ isError(block) ? 'Fehler' : 'Ergebnis' }}</span>
                <span>{{ bytesOf(block) | csByteSize }}</span>
                <span class="ml-auto">{{ expanded() === toolIdOf(block) ? 'einklappen' : 'anzeigen' }}</span>
              </button>
              @if (expanded() === toolIdOf(block)) {
                <pre class="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-neutral-400">{{ resultBody() }}</pre>
              }
            </div>
          }
          @case ('thinking-elided') {
            <!-- The transcript stores an empty thinking field and a ~3 KB
                 signature; there is nothing to show. -->
            <p class="text-[11px] italic text-neutral-700">Denkprozess (im Transcript nicht enthalten)</p>
          }
          @default {
            <p class="text-[11px] text-neutral-700">{{ attachmentLabel(block) }}</p>
          }
        }
      }
    </article>
  `,
})
export class MessageRowView {
  readonly message = input.required<MessageRow>();
  readonly sessionId = input.required<SessionId>();

  readonly #api = inject(CS_API, { optional: true });
  protected readonly expanded = signal<string | null>(null);
  protected readonly resultBody = signal('');

  protected readonly roleLabel = computed(() =>
    this.message().isUserPrompt ? 'Du' : this.message().role === 'user' ? 'Tool-Rücklauf' : 'Claude',
  );

  protected textOf(block: ContentBlock): string {
    return block.kind === 'text' ? block.text : '';
  }
  protected isTruncated(block: ContentBlock): boolean {
    return block.kind === 'text' && block.truncated;
  }
  protected nameOf(block: ContentBlock): string {
    return block.kind === 'tool-use' ? block.name : '';
  }
  protected summaryOf(block: ContentBlock): string {
    return block.kind === 'tool-use' ? block.summary : '';
  }
  protected toolIdOf(block: ContentBlock): string {
    return block.kind === 'tool-result' ? block.toolUseId : '';
  }
  protected bytesOf(block: ContentBlock): number {
    return block.kind === 'tool-result' ? block.bytes : 0;
  }
  protected isError(block: ContentBlock): boolean {
    return block.kind === 'tool-result' && block.isError;
  }
  protected attachmentLabel(block: ContentBlock): string {
    return block.kind === 'attachment' ? `Anhang: ${block.attachmentType}` : '';
  }

  protected async toggleResult(toolUseId: string): Promise<void> {
    if (this.expanded() === toolUseId) {
      this.expanded.set(null);
      return;
    }
    this.expanded.set(toolUseId);
    this.resultBody.set('wird geladen …');
    // Result bodies are not stored; they are read back from disk on demand.
    const body = await this.#api?.index.getToolResult(this.sessionId(), toolUseId);
    this.resultBody.set(body?.text ?? '(nicht mehr verfügbar)');
  }
}
