import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { WatchEvent, WatchRoot, WatcherPort } from '../ports/watcher.js';

/**
 * Uses node:fs recursive watching, which maps to FSEvents on macOS — one handle
 * for a whole subtree rather than 600 individual watches.
 *
 * FSEvents coalesces and can drop filenames, so nothing here is treated as
 * authoritative; the reconcile sweep is what makes a missed event a latency
 * problem instead of a correctness one.
 */
export class FsRecursiveWatcher implements WatcherPort {
  watch(root: WatchRoot, onEvent: (event: WatchEvent) => void): () => void {
    let watcher: FSWatcher | null = null;
    let closed = false;

    const start = (): void => {
      if (closed) return;
      try {
        watcher = watch(root.path, { recursive: root.recursive, persistent: false }, (_type, name) => {
          const fileName = typeof name === 'string' ? name : null;
          if (root.filter !== undefined && (fileName === null || !root.filter(fileName))) return;
          onEvent({ rootId: root.id, path: fileName === null ? root.path : join(root.path, fileName) });
        });
        watcher.on('error', () => {
          watcher?.close();
          watcher = null;
          // A directory can be removed and recreated (project purge); retry
          // rather than losing the watch for the rest of the session.
          setTimeout(start, 2000).unref?.();
        });
      } catch {
        setTimeout(start, 2000).unref?.();
      }
    };

    start();

    return () => {
      closed = true;
      watcher?.close();
      watcher = null;
    };
  }
}
