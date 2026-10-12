import { Notification, app } from 'electron';
import type { LiveSession, SessionId } from '@cs/shared';
import { computeTransitions, emptyTransitionState } from './attention-transitions.js';

export interface NotificationSettings {
  readonly enabled: boolean;
}

/**
 * Announces sessions that need the user.
 *
 * Only transitions are announced, never states: a session sitting at `waiting`
 * must not notify once a second. Nothing is sent while the window is focused and
 * the relevant pane is already on screen — the badge is enough then.
 */
export class NotificationService {
  readonly #state = emptyTransitionState();
  #settings: NotificationSettings = { enabled: true };

  constructor(private readonly focusSession: (sessionId: SessionId) => void) {}

  configure(settings: NotificationSettings): void {
    this.#settings = settings;
  }

  update(sessions: readonly LiveSession[], now = Date.now()): number {
    const { announce, needsAttentionCount } = computeTransitions(this.#state, sessions, now);

    if (this.#settings.enabled) {
      for (const sessionId of announce) {
        const session = sessions.find((candidate) => candidate.sessionId === sessionId);
        if (session !== undefined) this.#notify(session);
      }
    }

    this.#applyBadge(needsAttentionCount);
    return needsAttentionCount;
  }

  #notify(session: LiveSession): void {
    if (!Notification.isSupported()) return;
    const notification = new Notification({
      title: session.name ?? session.cwd.split('/').pop() ?? 'Claude',
      body: session.waitingFor ?? 'Wartet auf deine Eingabe',
      silent: false,
    });
    notification.on('click', () => this.focusSession(session.sessionId));
    notification.show();
    app.dock?.bounce('informational');
  }

  #applyBadge(count: number): void {
    app.setBadgeCount(count);
  }
}
