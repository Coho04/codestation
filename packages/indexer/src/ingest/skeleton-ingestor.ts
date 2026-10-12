import type { ProjectId, SessionKind, TitleSource } from '@cs/shared';
import type { Db } from '../db/connection.js';
import type { SessionRepository } from '../db/repositories/session-repository.js';
import type { FileSystemPort } from '../ports/file-system.js';
import { decodeLine } from '../parsing/record-decoder.js';

const HEAD_BYTES = 32 * 1024;
const TAIL_BYTES = 256 * 1024;

export interface SkeletonRequest {
  readonly path: string;
  readonly projectId: ProjectId;
  readonly sessionId: string;
  readonly kind: SessionKind;
  readonly encodedDir: string | null;
  readonly fallbackCwd: string;
}

/**
 * Reads only the head and tail of a transcript.
 *
 * This is the biggest usability lever in the whole indexer and costs almost
 * nothing: the head carries cwd, branch, version and the first timestamp, the
 * tail carries the final title, the resume pointer, the cost record and the last
 * timestamp. A complete, correctly sorted and titled session list therefore
 * exists in a few seconds — before a single message row has been written.
 */
export class SkeletonIngestor {
  constructor(
    private readonly db: Db,
    private readonly fs: FileSystemPort,
    private readonly sessions: SessionRepository,
  ) {}

  async ingest(request: SkeletonRequest): Promise<boolean> {
    const stat = await this.fs.stat(request.path);
    if (stat === null || stat.isDirectory) return false;

    const head = await this.fs.readRange(request.path, 0, Math.min(HEAD_BYTES, stat.size));
    const tailStart = Math.max(0, stat.size - TAIL_BYTES);
    const tail =
      tailStart <= HEAD_BYTES ? null : await this.fs.readRange(request.path, tailStart, stat.size);

    const decoder = new TextDecoder();
    const headLines = splitWhole(decoder.decode(head ?? new Uint8Array(0)));
    // The first line of a mid-file slice is almost certainly cut; drop it.
    const tailLines = tail === null ? [] : splitWhole(decoder.decode(tail)).slice(1);

    const patch: Record<string, unknown> = {};
    let cwd = request.fallbackCwd;
    let title: { value: string; source: TitleSource } | null = null;
    let startedAt: number | null = null;
    let endedAt: number | null = null;

    for (const [index, text] of [...headLines, ...tailLines].entries()) {
      const { record } = decodeLine(text);
      if (record === null) continue;

      if (record.kind === 'message') {
        if (record.cwd !== null) cwd = record.cwd;
        if (record.gitBranch !== null) patch['git_branch'] = record.gitBranch;
        if (record.ccVersion !== null) patch['cc_version'] = record.ccVersion;
        if (record.entrypoint !== null) patch['entrypoint'] = record.entrypoint;
        if (record.ts !== null) {
          if (index < headLines.length && startedAt === null) startedAt = record.ts;
          endedAt = record.ts;
        }
      } else if (record.kind === 'session-meta') {
        if (record.title !== undefined && record.titleSource !== undefined) {
          title = { value: record.title, source: record.titleSource };
        }
        if (record.leafUuid !== undefined) patch['leaf_uuid'] = record.leafUuid;
        if (record.relocatedCwd !== undefined) patch['current_cwd'] = record.relocatedCwd;
      } else if (record.kind === 'cost-state') {
        if (record.totalCostUsd > 0) {
          patch['cost_usd'] = record.totalCostUsd;
          patch['cost_source'] = 'cost-state';
        }
        if (record.startTime !== null) startedAt = record.startTime;
        patch['lines_added'] = record.linesAdded;
        patch['lines_removed'] = record.linesRemoved;
      }
    }

    if (startedAt !== null) patch['started_at'] = startedAt;
    if (endedAt !== null) patch['ended_at'] = endedAt;

    this.db.transaction(() => {
      this.sessions.ensure({
        id: request.sessionId,
        projectId: request.projectId,
        transcriptPath: request.path,
        encodedDir: request.encodedDir,
        cwd,
        kind: request.kind,
      });
      if (Object.keys(patch).length > 0) this.sessions.patch(request.sessionId, patch);
      if (title !== null) this.sessions.setTitle(request.sessionId, title.value, title.source);
    })();

    return true;
  }
}

/** Only lines that are certainly complete; a truncated slice has broken ends. */
function splitWhole(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 1) lines.pop();
  return lines.filter((line) => line.trim().length > 0);
}
