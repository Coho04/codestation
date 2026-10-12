import { join } from 'node:path';
import type { ToolResultBody } from '@cs/shared';
import type { Db } from '../connection.js';
import type { FileSystemPort } from '../../ports/file-system.js';

const MAX_RETURN_BYTES = 512 * 1024;

/**
 * Reads a tool result back from disk.
 *
 * Result bodies are 126 MB of the corpus and are not stored. Large ones were
 * already spilled by Claude Code to `<sessionId>/tool-results/<id>.txt`; the
 * rest are recovered by seeking to the recorded byte offset of the message that
 * carried them, so an 83 MB transcript is never loaded to show one result.
 */
export class ToolResultReader {
  constructor(
    private readonly db: Db,
    private readonly fs: FileSystemPort,
  ) {}

  async read(sessionId: string, toolUseId: string): Promise<ToolResultBody | null> {
    const row = this.db
      .prepare<[string, string], {
        result_message_id: number | null;
        result_bytes: number | null;
        result_is_error: number;
        result_external_path: string | null;
        transcript_path: string | null;
      }>(
        `SELECT t.result_message_id, t.result_bytes, t.result_is_error, t.result_external_path,
                s.transcript_path
         FROM tool_use t JOIN session s ON s.id = t.session_id
         WHERE t.session_id = ? AND t.tool_use_id = ?`,
      )
      .get(sessionId, toolUseId);

    if (row === undefined) return null;

    if (row.result_external_path !== null) {
      const text = await this.fs.readFile(row.result_external_path);
      if (text !== null) return this.#body(toolUseId, text, row.result_is_error === 1, row.result_external_path);
    }

    if (row.result_message_id === null || row.transcript_path === null) return null;

    const location = this.db
      .prepare<[number], { byte_offset: number; byte_length: number }>(
        'SELECT byte_offset, byte_length FROM message WHERE id = ?',
      )
      .get(row.result_message_id);
    if (location === undefined) return null;

    const bytes = await this.fs.readRange(
      row.transcript_path,
      location.byte_offset,
      location.byte_offset + location.byte_length,
    );
    if (bytes === null) return null;

    try {
      const line = JSON.parse(new TextDecoder().decode(bytes)) as {
        message?: { content?: unknown };
      };
      const text = extractResult(line.message?.content, toolUseId);
      return text === null ? null : this.#body(toolUseId, text, row.result_is_error === 1, null);
    } catch {
      return null;
    }
  }

  /** For the spilled-result directory, which the scanner records per session. */
  externalPath(home: string, encodedDir: string, sessionId: string, id: string): string {
    return join(home, 'projects', encodedDir, sessionId, 'tool-results', `${id}.txt`);
  }

  #body(toolUseId: string, text: string, isError: boolean, externalPath: string | null): ToolResultBody {
    const truncated = text.length > MAX_RETURN_BYTES;
    return {
      toolUseId,
      text: truncated ? text.slice(0, MAX_RETURN_BYTES) : text,
      bytes: text.length,
      truncated,
      isError,
      externalPath,
    };
  }
}

function extractResult(content: unknown, toolUseId: string): string | null {
  if (!Array.isArray(content)) return null;
  for (const entry of content) {
    if (typeof entry !== 'object' || entry === null) continue;
    const block = entry as Record<string, unknown>;
    if (block['type'] !== 'tool_result' || block['tool_use_id'] !== toolUseId) continue;
    const inner = block['content'];
    if (typeof inner === 'string') return inner;
    if (Array.isArray(inner)) {
      return inner
        .map((part) =>
          typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string'
            ? (part as { text: string }).text
            : '',
        )
        .join('\n');
    }
  }
  return null;
}
