import { summariseToolInput } from './tool-input-summary.js';

export interface NormalisedBlock {
  readonly kind: 'text' | 'tool-use' | 'tool-result' | 'thinking' | 'image' | 'other';
  readonly text: string;
  readonly toolUseId: string | null;
  readonly toolName: string | null;
  readonly toolSummary: string | null;
  readonly targetPath: string | null;
  readonly bytes: number;
  readonly isError: boolean;
  readonly signatureBytes: number;
  readonly rawType: string;
}

export interface NormalisedContent {
  /**
   * True when `message.content` was a plain string rather than an array.
   *
   * This is the single most useful bit in the whole format: only about 8% of
   * `user` records are actual human input, the rest are tool results wearing the
   * same role. Search, previews and prompt counts all hang off it.
   */
  readonly isPlainString: boolean;
  readonly blocks: readonly NormalisedBlock[];
  /** Concatenated prose, i.e. what is worth putting in the search index. */
  readonly text: string;
}

const EMPTY: NormalisedContent = { isPlainString: false, blocks: [], text: '' };

export function normaliseContent(content: unknown): NormalisedContent {
  if (typeof content === 'string') {
    return {
      isPlainString: true,
      blocks: [block({ kind: 'text', text: content, rawType: 'text' })],
      text: content,
    };
  }
  if (!Array.isArray(content)) return EMPTY;

  const blocks: NormalisedBlock[] = [];
  const prose: string[] = [];

  for (const entry of content) {
    if (typeof entry !== 'object' || entry === null) continue;
    const item = entry as Record<string, unknown>;
    const type = typeof item['type'] === 'string' ? item['type'] : 'other';

    switch (type) {
      case 'text': {
        const text = typeof item['text'] === 'string' ? item['text'] : '';
        blocks.push(block({ kind: 'text', text, rawType: type }));
        if (text.length > 0) prose.push(text);
        break;
      }
      case 'thinking':
      case 'redacted_thinking': {
        // The payload is empty in every record on disk; what remains is a ~3 KB
        // base64 signature. 38.7 MB of the corpus, 0.01 MB of readable text.
        const signature = typeof item['signature'] === 'string' ? item['signature'] : '';
        blocks.push(
          block({ kind: 'thinking', text: '', rawType: type, signatureBytes: signature.length }),
        );
        break;
      }
      case 'tool_use':
      case 'server_tool_use': {
        const name = typeof item['name'] === 'string' ? item['name'] : 'unknown';
        const { summary, targetPath } = summariseToolInput(name, item['input']);
        blocks.push(
          block({
            kind: 'tool-use',
            text: '',
            rawType: type,
            toolUseId: typeof item['id'] === 'string' ? item['id'] : null,
            toolName: name,
            toolSummary: summary,
            targetPath,
            bytes: byteLength(item['input']),
          }),
        );
        break;
      }
      case 'tool_result': {
        const text = flattenResult(item['content']);
        blocks.push(
          block({
            kind: 'tool-result',
            text,
            rawType: type,
            toolUseId: typeof item['tool_use_id'] === 'string' ? item['tool_use_id'] : null,
            bytes: text.length,
            isError: item['is_error'] === true,
          }),
        );
        break;
      }
      case 'image':
        blocks.push(block({ kind: 'image', text: '', rawType: type }));
        break;
      default:
        blocks.push(block({ kind: 'other', text: '', rawType: type }));
    }
  }

  return { isPlainString: false, blocks, text: prose.join('\n\n') };
}

/** Tool results nest text blocks; flatten to plain text without the structure. */
function flattenResult(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content === undefined || content === null ? '' : safeJson(content);
  const parts: string[] = [];
  for (const entry of content) {
    if (typeof entry === 'string') parts.push(entry);
    else if (typeof entry === 'object' && entry !== null) {
      const item = entry as Record<string, unknown>;
      if (typeof item['text'] === 'string') parts.push(item['text']);
    }
  }
  return parts.join('\n');
}

function byteLength(value: unknown): number {
  if (value === undefined || value === null) return 0;
  return safeJson(value).length;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function block(partial: Partial<NormalisedBlock> & { kind: NormalisedBlock['kind']; text: string; rawType: string }): NormalisedBlock {
  return {
    toolUseId: null,
    toolName: null,
    toolSummary: null,
    targetPath: null,
    bytes: 0,
    isError: false,
    signatureBytes: 0,
    ...partial,
  };
}
