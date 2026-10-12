import { dialog, type BrowserWindow } from 'electron';
import { rm, stat } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { ProjectPaths, SessionPaths } from '@cs/shared';

export interface DeletionResult {
  readonly confirmed: boolean;
  readonly deletedFiles: number;
  readonly deletedBytes: number;
  readonly error: string | null;
}

const NOT_CONFIRMED: DeletionResult = {
  confirmed: false,
  deletedFiles: 0,
  deletedBytes: 0,
  error: null,
};

/**
 * The safety property everything else rests on.
 *
 * The paths arrive over IPC. Even though they came from the indexer, main
 * verifies for itself that a deletion stays inside ~/.claude/projects — a check
 * that must not depend on another process being correct. Exported so it can be
 * tested without Electron, because this is the one function whose failure mode
 * is destroying the wrong files.
 */
export function isInsideClaudeProjects(root: string, path: string): boolean {
  const base = resolve(root);
  const target = resolve(path);
  return target === base || target.startsWith(base + sep);
}

/**
 * The only code in the app that writes to the user's Claude Code data.
 *
 * It lives in the main process on purpose: the indexer stays strictly
 * read-only, which is a property worth keeping, and main is already the part
 * that is allowed to act on the system — and that asks first.
 *
 * `claude project purge` is deliberately not used. It would also rewrite
 * ~/.claude.json, and the project registry belongs to Claude Code, not to this
 * app. Only the transcript directory is removed.
 */
export class DestructiveOps {
  readonly #root: string;

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    home: string = homedir(),
  ) {
    this.#root = resolve(join(home, '.claude', 'projects'));
  }

  async deleteSessionData(paths: SessionPaths): Promise<DeletionResult> {
    const targets = [paths.transcriptPath, paths.sidecarDir].filter(
      (path): path is string => path !== null,
    );
    return this.#confirmAndDelete({
      targets,
      title: 'Session endgültig löschen?',
      message: `„${paths.label}“ wird aus ~/.claude gelöscht.`,
    });
  }

  async deleteProjectData(paths: ProjectPaths): Promise<DeletionResult> {
    if (paths.transcriptDir === null) return { ...NOT_CONFIRMED, error: 'Kein Transcript-Ordner bekannt.' };
    return this.#confirmAndDelete({
      targets: [paths.transcriptDir],
      title: 'Alle Transcripts dieses Projekts löschen?',
      message: `„${paths.label}“ — ${String(paths.sessionCount)} Session(s) werden aus ~/.claude gelöscht.`,
      detailExtra:
        'Der Projekteintrag in ~/.claude.json gehört Claude Code und bleibt bestehen; ' +
        'das Projekt kann danach als leerer Eintrag erneut auftauchen.',
    });
  }

  async #confirmAndDelete(request: {
    targets: readonly string[];
    title: string;
    message: string;
    detailExtra?: string;
  }): Promise<DeletionResult> {
    const inside = request.targets.filter((path) => isInsideClaudeProjects(this.#root, path));
    if (inside.length === 0) {
      return { ...NOT_CONFIRMED, error: 'Pfad liegt außerhalb von ~/.claude/projects.' };
    }

    const { files, bytes } = await measure(inside);
    if (files === 0) return { ...NOT_CONFIRMED, error: 'Nichts zu löschen — die Dateien sind bereits weg.' };

    const options = {
      type: 'warning' as const,
      buttons: ['Endgültig löschen', 'Abbrechen'],
      // Cancel is the default: a stray Return key must not delete anything.
      defaultId: 1,
      cancelId: 1,
      title: request.title,
      message: request.message,
      detail: [
        `${String(files)} Datei(en), ${formatBytes(bytes)}.`,
        'Das lässt sich nicht rückgängig machen.',
        request.detailExtra,
      ]
        .filter((line): line is string => line !== undefined)
        .join('\n\n'),
    };

    const window = this.getWindow();
    const choice =
      window === null
        ? dialog.showMessageBoxSync(options)
        : dialog.showMessageBoxSync(window, options);

    if (choice !== 0) return NOT_CONFIRMED;

    try {
      for (const path of inside) await rm(path, { recursive: true, force: true });
    } catch (error) {
      return {
        confirmed: true,
        deletedFiles: 0,
        deletedBytes: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    return { confirmed: true, deletedFiles: files, deletedBytes: bytes, error: null };
  }
}

/** Counts what would go, so the dialog can state it rather than imply it. */
async function measure(paths: readonly string[]): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;

  const walk = async (path: string): Promise<void> => {
    const info = await stat(path).catch(() => null);
    if (info === null) return;
    if (info.isFile()) {
      files += 1;
      bytes += info.size;
      return;
    }
    if (!info.isDirectory()) return;
    for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      await walk(join(path, entry.name));
    }
  };

  for (const path of paths) await walk(path);
  return { files, bytes };
}

function formatBytes(value: number): string {
  const units = ['B', 'kB', 'MB', 'GB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]!}`;
}
