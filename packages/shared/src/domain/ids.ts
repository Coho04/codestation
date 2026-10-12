/**
 * Branded ids.
 *
 * These are plain strings at runtime (structured-cloneable across process
 * boundaries) but not interchangeable at compile time. `SessionId` and
 * `PaneId` in particular get passed through the same call sites constantly.
 */
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Claude Code session UUID; also the transcript filename. */
export type SessionId = Brand<string, 'SessionId'>;
/** Our own row id for a project (the absolute cwd is the natural key). */
export type ProjectId = Brand<number, 'ProjectId'>;
/** Our own row id for a message. */
export type MessageId = Brand<number, 'MessageId'>;
/** Terminal pane — one PTY. Never a tab: tabs can hold several panes. */
export type PaneId = Brand<string, 'PaneId'>;
export type TabId = Brand<string, 'TabId'>;
export type ProfileId = Brand<string, 'ProfileId'>;
export type PlanId = Brand<number, 'PlanId'>;

export const sessionId = (value: string): SessionId => value as SessionId;
export const projectId = (value: number): ProjectId => value as ProjectId;
export const messageId = (value: number): MessageId => value as MessageId;
export const paneId = (value: string): PaneId => value as PaneId;
export const tabId = (value: string): TabId => value as TabId;
export const profileId = (value: string): ProfileId => value as ProfileId;
export const planId = (value: number): PlanId => value as PlanId;

/**
 * Epoch milliseconds. Never a `Date`: structured clone would survive it, but
 * SQLite stores integers and every boundary crossing would need a conversion
 * nobody remembers to write.
 */
export type Millis = number;
