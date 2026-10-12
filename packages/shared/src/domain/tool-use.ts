import type { MessageId, Millis, SessionId } from './ids.js';

export interface ToolUseRow {
  readonly sessionId: SessionId;
  readonly messageId: MessageId;
  readonly toolUseId: string;
  readonly name: string;
  /** The one field worth showing: command, file_path, pattern or description. */
  readonly inputSummary: string;
  readonly targetPath: string | null;
  readonly resultBytes: number | null;
  readonly resultIsError: boolean;
  readonly ts: Millis | null;
}

/**
 * Loaded on demand. Result bodies are 126 MB of the corpus and are never kept
 * in the index; large ones were already spilled by Claude Code to
 * `<sessionId>/tool-results/<id>.txt`.
 */
export interface ToolResultBody {
  readonly toolUseId: string;
  readonly text: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly isError: boolean;
  readonly externalPath: string | null;
}

export interface FileTouch {
  readonly sessionId: SessionId;
  readonly absPath: string;
  readonly version: number | null;
  readonly ts: Millis;
}
