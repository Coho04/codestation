import { Injectable, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import type { Command } from './command';
import { CommandRegistry } from './command-registry';
import { ProjectsStore } from '../state/projects.store';
import { TerminalStore } from '../state/terminal.store';
import { IndexProgressStore } from '../state/index-progress.store';
import { RuntimeStore } from '../state/runtime.store';
import { EntityActions } from '../ui/entity-actions';

/**
 * Registers the application's actions once, at startup.
 *
 * Buttons in the UI call `registry.run(id)` rather than holding their own logic,
 * so there is exactly one definition of what "pin this project" means.
 */
@Injectable({ providedIn: 'root' })
export class AppCommands {
  readonly #registry = inject(CommandRegistry);
  readonly #router = inject(Router);
  readonly #projects = inject(ProjectsStore);
  readonly #terminal = inject(TerminalStore);
  readonly #index = inject(IndexProgressStore);
  readonly #runtime = inject(RuntimeStore);
  readonly #actions = inject(EntityActions);

  install(): void {
    const notReady = computed(() => !this.#runtime.ready());

    this.#registry.register(
      { id: 'nav.dashboard', title: 'Übersicht öffnen', group: 'navigation', run: () => void this.#router.navigate(['/']) },
      { id: 'nav.search', title: 'Suche öffnen', group: 'navigation', shortcut: '⌘F', run: () => void this.#router.navigate(['/search']) },
      { id: 'nav.archive', title: 'Archiv öffnen', group: 'navigation', run: () => void this.#router.navigate(['/archive']) },
      { id: 'nav.plans', title: 'Pläne öffnen', group: 'navigation', run: () => void this.#router.navigate(['/plans']) },
      { id: 'nav.trash', title: 'Archiv öffnen', group: 'navigation', keywords: ['papierkorb', 'gelöscht'], run: () => void this.#router.navigate(['/trash']) },
      { id: 'view.toggleDock', title: 'Terminal ein-/ausklappen', group: 'view', shortcut: '⌘J', run: () => this.#terminal.toggleDock() },
      { id: 'view.exitFocus', title: 'Session-Modus verlassen', group: 'view', shortcut: 'Esc', run: () => this.#terminal.exitFocusMode() },
      { id: 'view.togglePanel', title: 'Session-Daten ein-/ausblenden', group: 'view', run: () => this.#terminal.togglePanel() },
      { id: 'view.toggleArchived', title: 'Archivierte Projekte zeigen', group: 'view', run: () => this.#projects.toggleArchived() },
      { id: 'project.add', title: 'Projektordner hinzufügen …', group: 'project', run: () => this.#terminal.pickAndRegisterProject() },
      {
        id: 'index.rebuild',
        title: 'Index neu aufbauen',
        group: 'index',
        keywords: ['reparieren', 'rebuild'],
        run: () => this.#index.rebuild(),
      },
      {
        id: 'runtime.pickBinary',
        title: 'Claude-Binary auswählen …',
        group: 'index',
        run: () => this.#runtime.pickBinary(),
      },
    );

    // One command per project, derived from the store so the list stays live.
    this.#registry.registerSource({
      commands: (): readonly Command[] =>
        this.#projects.projects().flatMap((project): Command[] => [
          {
            id: `project.open:${String(project.id)}`,
            title: `Projekt öffnen: ${project.displayName}`,
            group: 'project',
            keywords: [project.path],
            run: () => void this.#router.navigate(['/projects', project.id]),
          },
          {
            id: `project.pin:${String(project.id)}`,
            title: `${project.pinned ? 'Anheften aufheben' : 'Anheften'}: ${project.displayName}`,
            group: 'project',
            keywords: [project.path],
            run: () => this.#projects.patch(project.id, { pinned: !project.pinned }),
          },
          {
            id: `project.archive:${String(project.id)}`,
            title: `${project.archived ? 'Aus dem Archiv holen' : 'Archivieren'}: ${project.displayName}`,
            group: 'project',
            keywords: [project.path, 'archiv'],
            run: () => this.#actions.setProjectArchived(project, !project.archived),
          },
          {
            id: `project.rename:${String(project.id)}`,
            title: `Umbenennen: ${project.displayName}`,
            group: 'project',
            keywords: [project.path],
            run: () => this.#actions.renameProject(project),
          },
          {
            id: `project.forget:${String(project.id)}`,
            title: `Aus dem Index entfernen: ${project.displayName}`,
            group: 'project',
            keywords: [project.path],
            run: () => this.#actions.forgetProject(project),
          },
          {
            id: `session.new:${String(project.id)}`,
            title: `Neue Session in ${project.displayName}`,
            group: 'session',
            keywords: [project.path],
            disabled: notReady,
            run: () =>
              this.#terminal.openClaude(project.path, { mode: { type: 'new' }, name: project.displayName }),
          },
        ]),
    });
  }
}
