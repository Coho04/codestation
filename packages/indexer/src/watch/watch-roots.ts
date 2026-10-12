import type { ClaudeHome } from '../claude-home.js';
import type { WatchRoot } from '../ports/watcher.js';

/**
 * The watch set, kept deliberately narrow.
 *
 * Watching ~/.claude recursively would pull in skills/ (1.1 GB), plugins/
 * (294 MB), security/ (243 MB) and backups/, which gains a file every minute.
 * Narrow roots mean those events are never generated, which is strictly better
 * than filtering them afterwards.
 */
export function watchRoots(home: ClaudeHome): WatchRoot[] {
  return [
    { id: 'projects', path: home.projectsDir, recursive: true, debounceMs: 250, maxWaitMs: 1000 },
    { id: 'sessions', path: home.sessionsDir, recursive: false, debounceMs: 150, maxWaitMs: 500 },
    { id: 'jobs', path: home.jobsDir, recursive: true, debounceMs: 500, maxWaitMs: 2000 },
    { id: 'plans', path: home.plansDir, recursive: false, debounceMs: 500, maxWaitMs: 2000 },
    {
      id: 'config',
      path: home.home,
      recursive: false,
      debounceMs: 2000,
      maxWaitMs: 5000,
      filter: (name) => name === '.claude.json',
    },
  ];
}
