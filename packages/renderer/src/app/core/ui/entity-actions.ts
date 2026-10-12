import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import type { ProjectSummary, SessionSummary } from '@cs/shared';
import { CS_API } from '../ipc/api.token';
import { ProjectsStore } from '../state/projects.store';
import { SessionsStore } from '../state/sessions.store';
import { TerminalStore } from '../state/terminal.store';
import { ContextMenuService, type MenuItem } from './context-menu.service';
import { ToastService } from './toast.service';

/**
 * The four levels of putting something away, in one place.
 *
 * They are genuinely different operations and must not be presented as
 * variations of one: archiving is reversible and keeps everything, forgetting
 * drops the index but leaves ~/.claude alone, and deleting removes files for
 * good. Having a single definition of each keeps the sidebar, the lists and the
 * command palette from drifting apart.
 */
@Injectable({ providedIn: 'root' })
export class EntityActions {
  readonly #api = inject(CS_API, { optional: true });
  readonly #projects = inject(ProjectsStore);
  readonly #sessions = inject(SessionsStore);
  readonly #terminal = inject(TerminalStore);
  readonly #menu = inject(ContextMenuService);
  readonly #toasts = inject(ToastService);
  readonly #router = inject(Router);

  // ---- projects ----------------------------------------------------------

  projectMenu(project: ProjectSummary): readonly MenuItem[] {
    return [
      { label: 'Öffnen', run: () => void this.#router.navigate(['/projects', project.id]) },
      {
        label: project.pinned ? 'Anheften aufheben' : 'Anheften',
        run: () => void this.#projects.patch(project.id, { pinned: !project.pinned }),
      },
      { label: 'Umbenennen …', run: () => this.renameProject(project) },
      { label: 'Gruppe zuweisen …', run: () => this.groupProject(project) },
      {
        separatorBefore: true,
        label: project.archived ? 'Aus dem Archiv holen' : 'Archivieren',
        run: () => void this.setProjectArchived(project, !project.archived),
      },
      {
        label: 'Aus dem Index entfernen',
        run: () => void this.forgetProject(project),
      },
      {
        separatorBefore: true,
        danger: true,
        label: 'Transcripts auf der Platte löschen …',
        run: () => void this.deleteProjectData(project),
      },
    ];
  }

  openProjectMenu(event: MouseEvent, project: ProjectSummary): void {
    this.#menu.open(event, project.displayName, this.projectMenu(project));
  }

  renameProject(project: ProjectSummary): void {
    const name = globalThis.prompt('Neuer Name für das Projekt', project.displayName);
    if (name === null) return;
    const trimmed = name.trim();
    // An empty name falls back to the folder name rather than showing a blank row.
    void this.#projects.patch(project.id, { displayName: trimmed.length === 0 ? null : trimmed });
  }

  groupProject(project: ProjectSummary): void {
    const group = globalThis.prompt('Gruppe (leer lassen zum Entfernen)', project.group ?? '');
    if (group === null) return;
    const trimmed = group.trim();
    void this.#projects.patch(project.id, { group: trimmed.length === 0 ? null : trimmed });
  }

  async setProjectArchived(project: ProjectSummary, archived: boolean): Promise<void> {
    await this.#api?.index.setProjectArchived(project.id, archived);
    await this.#projects.reload();
    this.#toasts.show(
      archived
        ? `„${project.displayName}“ archiviert — auch aus der Suche ausgeschlossen.`
        : `„${project.displayName}“ ist wieder sichtbar.`,
    );
  }

  async forgetProject(project: ProjectSummary): Promise<void> {
    if (!globalThis.confirm(`„${project.displayName}“ aus dem Index entfernen?\n\n~/.claude bleibt unberührt. Du kannst das im Archiv rückgängig machen.`)) return;
    await this.#api?.index.forgetProject(project.id);
    await this.#projects.reload();
    await this.#sessions.reload();
    this.#toasts.show(`„${project.displayName}“ aus dem Index entfernt. Die Dateien liegen weiterhin in ~/.claude.`);
  }

  async deleteProjectData(project: ProjectSummary): Promise<void> {
    if (this.#api === null) return;
    const paths = await this.#api.index.resolveProjectPaths(project.id);
    if (paths === null) return;

    // The native dialog does the asking; it states the file count and size.
    const result = await this.#api.terminal.deleteProjectData(paths);
    if (!result.confirmed) {
      if (result.error !== null) this.#toasts.show(result.error, 'error');
      return;
    }
    if (result.error !== null) {
      this.#toasts.show(`Löschen fehlgeschlagen: ${result.error}`, 'error');
      return;
    }
    await this.#api.index.forgetProject(project.id);
    await this.#projects.reload();
    await this.#sessions.reload();
    this.#toasts.show(`${String(result.deletedFiles)} Datei(en) gelöscht.`);
  }

  // ---- sessions ----------------------------------------------------------

  sessionMenu(session: SessionSummary): readonly MenuItem[] {
    return [
      { label: 'Öffnen', run: () => void this.#router.navigate(['/sessions', session.id]) },
      {
        label: 'Fortsetzen',
        disabled: !session.filePresent,
        run: () =>
          void this.#terminal.openClaude(session.projectPath, {
            mode: { type: 'resume', sessionId: session.id },
            name: session.title.slice(0, 40),
          }),
      },
      {
        separatorBefore: true,
        label: session.archived ? 'Aus dem Archiv holen' : 'Archivieren',
        run: () => void this.setSessionArchived(session, !session.archived),
      },
      { label: 'Aus dem Index entfernen', run: () => void this.forgetSession(session) },
      {
        separatorBefore: true,
        danger: true,
        label: 'Transcript auf der Platte löschen …',
        disabled: !session.filePresent,
        run: () => void this.deleteSessionData(session),
      },
    ];
  }

  openSessionMenu(event: MouseEvent, session: SessionSummary): void {
    this.#menu.open(event, session.title, this.sessionMenu(session));
  }

  async setSessionArchived(session: SessionSummary, archived: boolean): Promise<void> {
    await this.#api?.index.setSessionArchived(session.id, archived);
    await this.#sessions.reload();
    this.#toasts.show(archived ? `„${session.title}“ archiviert.` : `„${session.title}“ ist wieder sichtbar.`);
  }

  async forgetSession(session: SessionSummary): Promise<void> {
    if (!globalThis.confirm(`„${session.title}“ aus dem Index entfernen?\n\nDas Transcript in ~/.claude bleibt erhalten.`)) return;
    await this.#api?.index.forgetSession(session.id);
    await this.#sessions.reload();
    this.#toasts.show('Aus dem Index entfernt. Das Transcript liegt weiterhin in ~/.claude.');
  }

  async deleteSessionData(session: SessionSummary): Promise<void> {
    if (this.#api === null) return;
    const paths = await this.#api.index.resolveSessionPaths(session.id);
    if (paths === null) return;

    const result = await this.#api.terminal.deleteSessionData(paths);
    if (!result.confirmed) {
      if (result.error !== null) this.#toasts.show(result.error, 'error');
      return;
    }
    if (result.error !== null) {
      this.#toasts.show(`Löschen fehlgeschlagen: ${result.error}`, 'error');
      return;
    }
    await this.#api.index.forgetSession(session.id);
    await this.#sessions.reload();
    this.#toasts.show(`${String(result.deletedFiles)} Datei(en) gelöscht.`);
  }

  // ---- tombstones --------------------------------------------------------

  async restore(path: string): Promise<void> {
    await this.#api?.index.restoreTombstone(path);
    await this.#api?.index.refresh();
    this.#toasts.show('Zurückgeholt — beim nächsten Durchlauf wird wieder indiziert.');
  }
}
