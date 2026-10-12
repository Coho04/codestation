import type { AppEvent, IndexProgress, LiveSession, SessionSummary } from '@cs/shared';

const PROGRESS_MIN_INTERVAL_MS = 250;

/**
 * Rate-limits what crosses the process boundary.
 *
 * Progress can change thousands of times a second during an import; four
 * updates a second is more than a human can read and keeps the renderer's event
 * loop free for the work the user can actually see.
 */
export class EventPublisher {
  #lastProgressAt = 0;
  #lastPhase: string | null = null;

  constructor(private readonly send: (event: AppEvent) => void) {}

  progress(progress: IndexProgress): void {
    const now = Date.now();
    const phaseChanged = progress.phase !== this.#lastPhase;
    if (!phaseChanged && now - this.#lastProgressAt < PROGRESS_MIN_INTERVAL_MS) return;
    this.#lastProgressAt = now;
    this.#lastPhase = progress.phase;
    this.send({ type: 'index.progress', progress });
  }

  live(sessions: readonly LiveSession[]): void {
    this.send({ type: 'live.changed', sessions });
  }

  sessionAppeared(session: SessionSummary): void {
    this.send({ type: 'session.appeared', session });
  }

  sessionUpdated(sessionId: SessionSummary['id'], messageCount: number, lastTs: number | null): void {
    this.send({ type: 'session.updated', sessionId, messageCount, lastTs });
  }

  projectsChanged(): void {
    this.send({ type: 'index.projectsChanged' });
  }
}
