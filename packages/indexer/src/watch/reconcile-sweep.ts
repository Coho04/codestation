import type { CursorRepository } from '../db/repositories/cursor-repository.js';
import type { FileSystemPort } from '../ports/file-system.js';
import type { DiscoveredTranscript, TranscriptScanner } from '../ingest/transcript-scanner.js';

/**
 * Periodic stat-based reconciliation.
 *
 * The watcher is never trusted: FSEvents coalesces, drops names and has a long
 * history of missing renames. A full readdir + stat over ~600 transcripts costs
 * about ten milliseconds, which turns a lost event into at most a minute of
 * latency rather than a permanently stale index.
 */
export class ReconcileSweep {
  constructor(
    private readonly scanner: TranscriptScanner,
    private readonly cursors: CursorRepository,
    private readonly fs: FileSystemPort,
  ) {}

  async findChanged(
    knownProjects: ReadonlyMap<string, string>,
    forgotten: ReadonlySet<string>,
  ): Promise<DiscoveredTranscript[]> {
    const discovered = await this.scanner.scan(knownProjects, forgotten);
    const changed: DiscoveredTranscript[] = [];

    for (const item of discovered) {
      const cursor = this.cursors.get(item.path);
      if (cursor === null) {
        changed.push(item);
        continue;
      }
      if (cursor.size !== item.size || cursor.mtimeMs !== item.mtimeMs || cursor.state !== 'complete') {
        changed.push(item);
      }
    }

    return changed;
  }

  /** Transcripts the index knows about that are no longer on disk. */
  async findVanished(): Promise<string[]> {
    const gone: string[] = [];
    for (const cursor of this.cursors.listByKind('transcript')) {
      if (cursor.state === 'vanished') continue;
      if (!(await this.fs.exists(cursor.path))) gone.push(cursor.path);
    }
    return gone;
  }
}
