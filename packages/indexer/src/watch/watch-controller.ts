import type { AppEvent } from '@cs/shared';
import { encodeProjectDir } from '../claude-home.js';
import type { Indexer } from '../composition-root.js';
import type { EventPublisher } from '../api/event-publisher.js';
import { CoalescingQueue } from './coalescing-queue.js';
import { watchRoots } from './watch-roots.js';
import type { WatchEvent } from '../ports/watcher.js';

const RECONCILE_INTERVAL_MS = 60_000;
/** The CLI spawn costs hundreds of milliseconds, so it is never polled fast. */
const CLI_INTERVAL_MS = 15_000;
const PS_INTERVAL_MS = 5_000;

/**
 * Turns filesystem events into ingest work, and keeps the live status fresh.
 *
 * The watcher is treated as a hint, never as truth: a reconcile sweep every
 * minute re-stats every transcript, so a dropped FSEvent costs at most a minute
 * of latency instead of leaving the index permanently wrong.
 */
export class WatchController {
  readonly #disposers: (() => void)[] = [];
  readonly #queues = new Map<string, CoalescingQueue<WatchEvent>>();
  #timers: ReturnType<typeof setInterval>[] = [];
  #busy = false;

  constructor(
    private readonly indexer: Indexer,
    private readonly publisher: EventPublisher | null,
    private readonly emit: (event: AppEvent) => void,
  ) {}

  start(): void {
    this.indexer.reconcile.run = () => this.#reconcile();

    for (const root of watchRoots(this.indexer.home)) {
      const queue = new CoalescingQueue<WatchEvent>(
        root.debounceMs,
        root.maxWaitMs,
        this.indexer.clock,
        (events) => void this.#handle(root.id, events),
      );
      this.#queues.set(root.id, queue);
      this.#disposers.push(
        this.indexer.watcher.watch(root, (event) => queue.push(event.path, event)),
      );
    }

    this.#timers.push(
      setInterval(() => void this.#refreshLive(false), PS_INTERVAL_MS),
      setInterval(() => void this.#refreshLive(true), CLI_INTERVAL_MS),
      setInterval(() => void this.#reconcile(), RECONCILE_INTERVAL_MS),
    );
    for (const timer of this.#timers) timer.unref?.();

    void this.#refreshLive(true);
  }

  async #handle(rootId: string, events: readonly WatchEvent[]): Promise<void> {
    switch (rootId) {
      case 'sessions':
      case 'jobs':
        await this.#refreshLive(false);
        break;
      case 'config':
        // Rewritten about once a minute; the ingestor hashes the .projects
        // subtree so only a real change costs anything.
        if ((await this.indexer.registry.sync()).changed) this.publisher?.projectsChanged();
        break;
      case 'plans':
        await this.indexer.plansIngestor.sync();
        break;
      case 'projects':
        await this.#ingestChanged(events.map((event) => event.path));
        break;
      default:
        break;
    }
  }

  async #ingestChanged(paths: readonly string[]): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      const known = this.#knownProjects();
      const discovered = await this.indexer.scanner.scan(known, this.indexer.tombstones.paths());
      const touched = new Set(paths);
      const candidates = discovered.filter(
        (item) => touched.has(item.path) || [...touched].some((path) => path.startsWith(`${item.path.slice(0, item.path.lastIndexOf('/'))}/`)),
      );

      for (const item of candidates.length > 0 ? candidates : discovered) {
        await this.indexer.scheduler.ingestOne(item);
        const session = this.indexer.sessions.get(item.sessionId);
        if (session !== null) {
          this.publisher?.sessionUpdated(session.id, session.messageCount, session.endedAt);
        }
      }
    } finally {
      this.#busy = false;
    }
  }

  async #reconcile(): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      const changed = await this.indexer.sweep.findChanged(
        this.#knownProjects(),
        this.indexer.tombstones.paths(),
      );
      for (const item of changed) await this.indexer.scheduler.ingestOne(item);

      for (const path of await this.indexer.sweep.findVanished()) {
        this.indexer.sessions.markVanished(path, this.indexer.clock.now());
        this.indexer.cursors.markVanished(path);
      }

      if (changed.length > 0) {
        this.indexer.linker.link();
        this.indexer.costs.recomputeAll();
        this.indexer.costs.rebuildDaily();
        this.publisher?.projectsChanged();
      }
    } finally {
      this.#busy = false;
    }
  }

  async #refreshLive(useCli: boolean): Promise<void> {
    const sessions = await this.indexer.live.refresh({ useCli });
    this.publisher?.live(sessions);
  }

  #knownProjects(): Map<string, string> {
    const known = new Map<string, string>();
    for (const project of this.indexer.projects.list({ includeArchived: true })) {
      known.set(encodeProjectDir(project.path), project.path);
    }
    return known;
  }

  dispose(): void {
    for (const dispose of this.#disposers) dispose();
    for (const queue of this.#queues.values()) queue.dispose();
    for (const timer of this.#timers) clearInterval(timer);
    this.#timers = [];
    void this.emit;
  }
}
