import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { ClaudeHome } from '../claude-home.js';
import type { PlanRepository } from '../db/repositories/plan-repository.js';
import type { FileSystemPort } from '../ports/file-system.js';

/** Plan files are flat markdown without front matter, starting with `# Title`. */
export class PlansIngestor {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly home: ClaudeHome,
    private readonly plans: PlanRepository,
  ) {}

  async sync(): Promise<number> {
    const entries = await this.fs.readdir(this.home.plansDir);
    const present: string[] = [];
    let written = 0;

    for (const entry of entries) {
      if (!entry.isFile || !entry.name.endsWith('.md')) continue;
      const filePath = join(this.home.plansDir, entry.name);
      const stat = await this.fs.stat(filePath);
      const body = await this.fs.readFile(filePath);
      if (stat === null || body === null) continue;

      present.push(filePath);
      this.plans.upsert({
        filePath,
        slug: entry.name.replace(/\.md$/, ''),
        title: firstHeading(body) ?? entry.name.replace(/\.md$/, ''),
        mtime: stat.mtimeMs,
        size: stat.size,
        hash: createHash('sha256').update(body).digest('hex').slice(0, 32),
        body,
      });
      written += 1;
    }

    // Kept, not deleted: the archive outlives Claude Code's housekeeping.
    this.plans.markMissing(present);
    this.plans.relink();
    return written;
  }
}

function firstHeading(markdown: string): string | null {
  for (const line of markdown.split('\n', 40)) {
    const match = /^#\s+(.+?)\s*$/.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}
