/**
 * One short, human-meaningful line per tool call.
 *
 * The raw `tool_use.input` is 23 MB of JSON across the corpus and is mostly
 * noise for a reader; what a person scanning a session wants is the command, the
 * file, the pattern or the subagent's brief.
 */
export interface ToolSummary {
  readonly summary: string;
  readonly targetPath: string | null;
}

const MAX = 512;

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

export function summariseToolInput(name: string, input: unknown): ToolSummary {
  const object = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;

  const path =
    str(object['file_path']) ?? str(object['path']) ?? str(object['notebook_path']) ?? null;

  const pick = (): string | null => {
    switch (name) {
      case 'Bash':
      case 'BashOutput':
        return str(object['command']) ?? str(object['description']);
      case 'Read':
      case 'Write':
      case 'Edit':
      case 'NotebookEdit':
        return path;
      case 'Glob':
        return join(str(object['pattern']), str(object['path']));
      case 'Grep':
        return join(str(object['pattern']), str(object['path']) ?? str(object['glob']));
      case 'Task':
      case 'Agent':
        return join(str(object['subagent_type']), str(object['description']));
      case 'WebFetch':
        return join(str(object['url']), str(object['prompt']));
      case 'WebSearch':
        return str(object['query']);
      case 'Skill':
        return join(str(object['skill']), str(object['args']));
      case 'SlashCommand':
        return str(object['command']) ?? str(object['commandName']);
      case 'TodoWrite':
        return summariseTodos(object['todos']);
      case 'ToolSearch':
        return str(object['query']);
      case 'AskUserQuestion':
        return summariseQuestions(object['questions']);
      default:
        // MCP tools and anything added later: fall back to the first short
        // string field rather than printing the whole JSON blob.
        return (
          str(object['description']) ??
          str(object['query']) ??
          str(object['prompt']) ??
          path ??
          firstShortString(object)
        );
    }
  };

  const raw = pick() ?? '';
  return { summary: clamp(collapse(raw)), targetPath: path };
}

function join(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return `${a} — ${b}`;
}

function summariseTodos(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const active = value.find(
    (todo): todo is { content?: unknown } =>
      typeof todo === 'object' && todo !== null && (todo as { status?: unknown }).status === 'in_progress',
  );
  const content = str((active as { content?: unknown } | undefined)?.content);
  return content !== null ? `${content} (${String(value.length)} todos)` : `${String(value.length)} todos`;
}

function summariseQuestions(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const first = value[0] as { question?: unknown } | undefined;
  return str(first?.question);
}

function firstShortString(object: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(object)) {
    if (typeof value === 'string' && value.length > 0 && value.length <= MAX) {
      return `${key}: ${value}`;
    }
  }
  return null;
}

const collapse = (value: string): string => value.replace(/\s+/g, ' ').trim();

const clamp = (value: string): string => (value.length <= MAX ? value : `${value.slice(0, MAX - 1)}…`);
