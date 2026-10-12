/**
 * Builds valid JSONL transcripts for tests.
 *
 * Nothing large is checked in: volume tests synthesise their input at runtime
 * with this, and the committed fixtures stay at one small example per scenario.
 */
/** Distinguishes factory instances so two of them cannot mint the same uuid. */
let instanceSeq = 0;

export class TranscriptFactory {
  readonly #lines: string[] = [];
  #lastUuid: string | null = null;
  #counter = 0;
  readonly #instance = ++instanceSeq;
  #ts = Date.parse('2026-10-01T08:00:00.000Z');

  constructor(
    readonly sessionId = '00000000-0000-4000-8000-000000000001',
    readonly cwd = '/Users/dev/proj',
  ) {}

  #uuid(): string {
    this.#counter += 1;
    return `${this.sessionId.slice(0, 20)}${String(this.#instance).padStart(4, '0')}${String(this.#counter).padStart(12, '0')}`;
  }

  #base(type: string): Record<string, unknown> {
    this.#ts += 1000;
    return {
      type,
      sessionId: this.sessionId,
      cwd: this.cwd,
      gitBranch: 'main',
      version: '2.1.277',
      entrypoint: 'cli',
      userType: 'external',
      isSidechain: false,
      timestamp: new Date(this.#ts).toISOString(),
    };
  }

  prompt(text: string): this {
    const uuid = this.#uuid();
    this.#lines.push(
      JSON.stringify({
        ...this.#base('user'),
        uuid,
        parentUuid: this.#lastUuid,
        promptSource: 'typed',
        message: { role: 'user', content: text },
      }),
    );
    this.#lastUuid = uuid;
    return this;
  }

  assistant(text: string, options: { model?: string; outputTokens?: number } = {}): this {
    const uuid = this.#uuid();
    this.#lines.push(
      JSON.stringify({
        ...this.#base('assistant'),
        uuid,
        parentUuid: this.#lastUuid,
        requestId: `req_${uuid}`,
        message: {
          id: `msg_${uuid}`,
          role: 'assistant',
          model: options.model ?? 'claude-opus-5',
          stop_reason: 'end_turn',
          content: [
            { type: 'thinking', thinking: '', signature: 'z'.repeat(3000) },
            { type: 'text', text },
          ],
          usage: {
            input_tokens: 10,
            output_tokens: options.outputTokens ?? 100,
            cache_read_input_tokens: 500,
            cache_creation_input_tokens: 20,
          },
        },
      }),
    );
    this.#lastUuid = uuid;
    return this;
  }

  toolUse(name: string, input: Record<string, unknown>, result = 'ok'): this {
    const uuid = this.#uuid();
    const toolUseId = `toolu_${uuid}`;
    this.#lines.push(
      JSON.stringify({
        ...this.#base('assistant'),
        uuid,
        parentUuid: this.#lastUuid,
        message: {
          id: `msg_${uuid}`,
          role: 'assistant',
          model: 'claude-opus-5',
          content: [{ type: 'tool_use', id: toolUseId, name, input }],
          usage: { input_tokens: 5, output_tokens: 20 },
        },
      }),
    );
    this.#lastUuid = uuid;

    const resultUuid = this.#uuid();
    this.#lines.push(
      JSON.stringify({
        ...this.#base('user'),
        uuid: resultUuid,
        parentUuid: this.#lastUuid,
        toolUseResult: { stdout: result, stderr: '', interrupted: false },
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: toolUseId, content: result }],
        },
      }),
    );
    this.#lastUuid = resultUuid;
    return this;
  }

  /** Branches from an earlier point, producing a fork. */
  forkFrom(uuid: string): this {
    this.#lastUuid = uuid;
    return this;
  }

  lastUuid(): string {
    return this.#lastUuid ?? '';
  }

  title(value: string): this {
    this.#lines.push(JSON.stringify({ type: 'ai-title', aiTitle: value, sessionId: this.sessionId }));
    return this;
  }

  customTitle(value: string): this {
    this.#lines.push(JSON.stringify({ type: 'custom-title', customTitle: value, sessionId: this.sessionId }));
    return this;
  }

  lastPrompt(uuid?: string): this {
    this.#lines.push(
      JSON.stringify({ type: 'last-prompt', leafUuid: uuid ?? this.#lastUuid, sessionId: this.sessionId }),
    );
    return this;
  }

  costState(totalCostUsd: number): this {
    this.#lines.push(
      JSON.stringify({
        type: 'cost-state',
        sessionId: this.sessionId,
        totalCostUSD: totalCostUsd,
        totalLinesAdded: 12,
        totalLinesRemoved: 3,
        totalDuration: 60000,
        startTime: this.#ts - 60000,
        modelUsage: {},
      }),
    );
    return this;
  }

  fileHistoryDelta(trackingPath: string, version = 1): this {
    this.#lines.push(
      JSON.stringify({
        type: 'file-history-delta',
        sessionId: this.sessionId,
        trackingPath,
        backup: { backupFileName: 'abc@v1', version, backupTime: new Date(this.#ts).toISOString() },
        timestamp: new Date(this.#ts).toISOString(),
      }),
    );
    return this;
  }

  /** A record type this build has never seen — the drift case. */
  unknownRecord(type = 'invented-next-year'): this {
    this.#lines.push(JSON.stringify({ type, sessionId: this.sessionId, payload: { a: 1 } }));
    return this;
  }

  raw(line: string): this {
    this.#lines.push(line);
    return this;
  }

  /** Begins with a parent that is not in this file — a resume or compaction. */
  danglingRoot(parentUuid: string): this {
    this.#lastUuid = parentUuid;
    return this;
  }

  build(): string {
    return `${this.#lines.join('\n')}\n`;
  }

  /** Without the final newline, as a file being written right now would look. */
  buildPartial(): string {
    return this.#lines.join('\n');
  }
}
