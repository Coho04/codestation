import { describe, expect, it } from 'vitest';
import { normaliseContent } from './content-blocks.js';

describe('normaliseContent', () => {
  it('marks a plain-string content as real human input', () => {
    const result = normaliseContent('Baue bitte die Provider-Settings um');
    expect(result.isPlainString).toBe(true);
    expect(result.text).toBe('Baue bitte die Provider-Settings um');
  });

  it('does not mark an array content as human input, even under the user role', () => {
    // 92% of 'user' records look like this: tool results wearing the same role.
    const result = normaliseContent([
      { type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' },
    ]);
    expect(result.isPlainString).toBe(false);
    expect(result.blocks[0]).toMatchObject({ kind: 'tool-result', toolUseId: 'tu_1' });
  });

  it('drops thinking text but records the signature size', () => {
    // On disk the thinking field is empty and the signature is ~3 KB of base64:
    // 38.7 MB of the corpus with 0.01 MB of readable content.
    const result = normaliseContent([
      { type: 'thinking', thinking: '', signature: 'x'.repeat(3000) },
      { type: 'text', text: 'sichtbare Antwort' },
    ]);
    expect(result.text).toBe('sichtbare Antwort');
    expect(result.blocks[0]).toMatchObject({ kind: 'thinking', text: '', signatureBytes: 3000 });
  });

  it('summarises a tool use instead of keeping its raw input', () => {
    const result = normaliseContent([
      { type: 'tool_use', id: 'tu_2', name: 'Bash', input: { command: 'npm test', timeout: 120000 } },
    ]);
    expect(result.blocks[0]).toMatchObject({
      kind: 'tool-use',
      toolName: 'Bash',
      toolSummary: 'npm test',
    });
  });

  it('flattens a structured tool result to plain text', () => {
    const result = normaliseContent([
      { type: 'tool_result', tool_use_id: 'tu_3', content: [{ type: 'text', text: 'Zeile A' }, { type: 'text', text: 'Zeile B' }] },
    ]);
    expect(result.blocks[0]?.text).toBe('Zeile A\nZeile B');
  });

  it('flags an error result', () => {
    const result = normaliseContent([
      { type: 'tool_result', tool_use_id: 'tu_4', content: 'boom', is_error: true },
    ]);
    expect(result.blocks[0]).toMatchObject({ isError: true });
  });

  it('only puts prose into the searchable text', () => {
    const result = normaliseContent([
      { type: 'text', text: 'Erklärung' },
      { type: 'tool_use', id: 't', name: 'Read', input: { file_path: '/a/b.ts' } },
      { type: 'tool_result', tool_use_id: 't', content: 'ein sehr langer Dateiinhalt' },
    ]);
    expect(result.text).toBe('Erklärung');
  });

  it('survives shapes it has never seen', () => {
    expect(() => normaliseContent([{ type: 'something_new', payload: { deep: [1, 2] } }])).not.toThrow();
    expect(normaliseContent(null).blocks).toEqual([]);
    expect(normaliseContent(undefined).isPlainString).toBe(false);
  });
});
