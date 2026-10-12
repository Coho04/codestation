export interface WatchEvent {
  readonly rootId: string;
  /** Absolute path when the platform reported one; the root otherwise. */
  readonly path: string;
}

export interface WatchRoot {
  readonly id: string;
  readonly path: string;
  readonly recursive: boolean;
  readonly debounceMs: number;
  /** Upper bound on how long an event may be held back. */
  readonly maxWaitMs: number;
  readonly filter?: (name: string) => boolean;
}

export interface WatcherPort {
  watch(root: WatchRoot, onEvent: (event: WatchEvent) => void): () => void;
}
