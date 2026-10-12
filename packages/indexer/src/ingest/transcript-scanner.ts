import { join } from 'node:path';
import type { SessionKind } from '@cs/shared';
import type { ClaudeHome } from '../claude-home.js';
import type { FileSystemPort } from '../ports/file-system.js';
import { decodeLine } from '../parsing/record-decoder.js';

export interface DiscoveredTranscript {
  readonly path: string;
  readonly encodedDir: string;
  readonly sessionId: string;
  readonly kind: SessionKind;
  /** Real cwd, read from the file's own records — never decoded from the directory name. */
  readonly cwd: string;
  readonly size: number;
  readonly mtimeMs: number;
  /** Subagent transcripts carry the id of the Task call that spawned them. */
  readonly parentSessionId: string | null;
  readonly spawnToolUseId: string | null;
  readonly agentType: string | null;
  readonly spawnDepth: number | null;
}

const UUID_FILE = /^([0-9a-f-]{8,})\.jsonl$/i;
const AGENT_FILE = /^agent-(.+)\.jsonl$/i;
const FIRST_LINE_BYTES = 16 * 1024;

/**
 * Walks ~/.claude/projects.
 *
 * The real project path comes from a record's `cwd`, with the registry as a
 * fallback. The encoded directory name is never decoded: the encoding collapses
 * '/', '_', '.' and spaces to '-', so 'acme.de' and 'acme-de' are
 * indistinguishable once encoded.
 */
export class TranscriptScanner {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly home: ClaudeHome,
  ) {}

  /**
   * @param forgotten Paths the user removed from the index. Skipped here rather
   * than filtered later, so the sweep does not keep re-reading files whose only
   * destiny is to be discarded.
   */
  async scan(
    knownPaths: ReadonlyMap<string, string>,
    forgotten: ReadonlySet<string> = new Set(),
  ): Promise<DiscoveredTranscript[]> {
    const found: DiscoveredTranscript[] = [];

    for (const dir of await this.fs.readdir(this.home.projectsDir)) {
      if (!dir.isDirectory) continue;
      const dirPath = join(this.home.projectsDir, dir.name);

      for (const entry of await this.fs.readdir(dirPath)) {
        if (entry.isFile && UUID_FILE.test(entry.name)) {
          const sessionId = entry.name.replace(/\.jsonl$/, '');
          const path = join(dirPath, entry.name);
          const stat = await this.fs.stat(path);
          if (stat === null || forgotten.has(path)) continue;
          const cwd = (await this.#readCwd(path)) ?? knownPaths.get(dir.name) ?? dirPath;
          if (forgotten.has(cwd)) continue;
          found.push({
            path,
            encodedDir: dir.name,
            sessionId,
            kind: 'interactive',
            cwd,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            parentSessionId: null,
            spawnToolUseId: null,
            agentType: null,
            spawnDepth: null,
          });
        } else if (entry.isDirectory) {
          found.push(...(await this.#scanSubagents(dirPath, dir.name, entry.name, knownPaths, forgotten)));
        }
      }
    }

    return found;
  }

  /**
   * Subagents are separate transcripts, not inline sidechains — `isSidechain` is
   * false in every main transcript on disk. They are modelled as child sessions
   * linked through the tool_use id in their meta file.
   */
  async #scanSubagents(
    dirPath: string,
    encodedDir: string,
    parentSessionId: string,
    knownPaths: ReadonlyMap<string, string>,
    forgotten: ReadonlySet<string>,
  ): Promise<DiscoveredTranscript[]> {
    const subagentsDir = join(dirPath, parentSessionId, 'subagents');
    const entries = await this.fs.readdir(subagentsDir);
    const result: DiscoveredTranscript[] = [];

    for (const entry of entries) {
      const match = AGENT_FILE.exec(entry.name);
      if (!entry.isFile || match?.[1] === undefined) continue;

      const path = join(subagentsDir, entry.name);
      const stat = await this.fs.stat(path);
      if (stat === null || forgotten.has(path)) continue;

      const meta = await this.#readAgentMeta(join(subagentsDir, `agent-${match[1]}.meta.json`));

      result.push({
        path,
        encodedDir,
        sessionId: `${parentSessionId}:agent-${match[1]}`,
        kind: 'subagent',
        cwd: (await this.#readCwd(path)) ?? knownPaths.get(encodedDir) ?? dirPath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        parentSessionId,
        spawnToolUseId: meta.toolUseId,
        agentType: meta.agentType,
        spawnDepth: meta.spawnDepth,
      });
    }

    return result;
  }

  async #readCwd(path: string): Promise<string | null> {
    const head = await this.fs.readRange(path, 0, FIRST_LINE_BYTES);
    if (head === null) return null;
    for (const text of new TextDecoder().decode(head).split('\n')) {
      if (text.trim().length === 0) continue;
      const { record } = decodeLine(text);
      if (record?.kind === 'message' && record.cwd !== null) return record.cwd;
    }
    return null;
  }

  async #readAgentMeta(
    path: string,
  ): Promise<{ toolUseId: string | null; agentType: string | null; spawnDepth: number | null }> {
    const raw = await this.fs.readFile(path);
    if (raw === null) return { toolUseId: null, agentType: null, spawnDepth: null };
    try {
      const meta = JSON.parse(raw) as Record<string, unknown>;
      return {
        toolUseId: typeof meta['toolUseId'] === 'string' ? meta['toolUseId'] : null,
        agentType: typeof meta['agentType'] === 'string' ? meta['agentType'] : null,
        spawnDepth: typeof meta['spawnDepth'] === 'number' ? meta['spawnDepth'] : null,
      };
    } catch {
      return { toolUseId: null, agentType: null, spawnDepth: null };
    }
  }
}
