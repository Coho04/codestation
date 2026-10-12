import type { PaneId, SessionId } from '../domain/ids.js';
import type { IndexProgress, LiveSession } from '../domain/live-session.js';
import type { SessionSummary } from '../domain/session.js';
import type { PaneState } from '../domain/terminal.js';
import type { ClaudeBinaryInfo } from '../domain/terminal.js';
import type { UpdateStatus } from '../domain/update.js';

export type AppEvent =
  | { readonly type: 'index.progress'; readonly progress: IndexProgress }
  | { readonly type: 'index.projectsChanged' }
  | { readonly type: 'session.appeared'; readonly session: SessionSummary }
  | {
      readonly type: 'session.updated';
      readonly sessionId: SessionId;
      readonly messageCount: number;
      readonly lastTs: number | null;
    }
  | { readonly type: 'live.changed'; readonly sessions: readonly LiveSession[] }
  | { readonly type: 'pane.state'; readonly paneId: PaneId; readonly state: PaneState }
  | {
      readonly type: 'pane.bound';
      readonly paneId: PaneId;
      readonly pid: number;
      readonly sessionId: SessionId;
    }
  | {
      readonly type: 'pane.exit';
      readonly paneId: PaneId;
      readonly exitCode: number;
      readonly signal: number | null;
    }
  | { readonly type: 'pane.title'; readonly paneId: PaneId; readonly title: string }
  | { readonly type: 'runtime.changed'; readonly info: ClaudeBinaryInfo }
  | { readonly type: 'update.changed'; readonly status: UpdateStatus };

export type AppEventType = AppEvent['type'];
export type AppEventOf<T extends AppEventType> = Extract<AppEvent, { type: T }>;
