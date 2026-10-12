import { join } from 'node:path';

/** Every path under ~/.claude the indexer is allowed to know about. */
export class ClaudeHome {
  constructor(readonly home: string) {}

  get root(): string {
    return join(this.home, '.claude');
  }
  get configJson(): string {
    return join(this.home, '.claude.json');
  }
  get projectsDir(): string {
    return join(this.root, 'projects');
  }
  get sessionsDir(): string {
    return join(this.root, 'sessions');
  }
  get jobsDir(): string {
    return join(this.root, 'jobs');
  }
  get plansDir(): string {
    return join(this.root, 'plans');
  }
  get historyJsonl(): string {
    return join(this.root, 'history.jsonl');
  }

  projectDir(encodedDir: string): string {
    return join(this.projectsDir, encodedDir);
  }
  transcript(encodedDir: string, sessionId: string): string {
    return join(this.projectsDir, encodedDir, `${sessionId}.jsonl`);
  }
  subagentsDir(encodedDir: string, sessionId: string): string {
    return join(this.projectsDir, encodedDir, sessionId, 'subagents');
  }
  toolResultsDir(encodedDir: string, sessionId: string): string {
    return join(this.projectsDir, encodedDir, sessionId, 'tool-results');
  }
}

/**
 * Mirrors Claude Code's directory naming: '/', '_', '.' and spaces all become
 * '-'. Encoding is safe; decoding is not, because the mapping is not injective
 * ('acme.de' and 'acme-de' produce the same name). Nothing in this codebase
 * decodes.
 */
export const encodeProjectDir = (absolutePath: string): string =>
  absolutePath.replace(/[/_. ]/g, '-');
