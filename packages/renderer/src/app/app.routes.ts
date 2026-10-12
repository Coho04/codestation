import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
  },
  {
    path: 'projects/:projectId',
    loadComponent: () => import('./features/archive/archive.page').then((m) => m.ArchivePage),
  },
  {
    path: 'archive',
    loadComponent: () => import('./features/archive/archive.page').then((m) => m.ArchivePage),
  },
  {
    path: 'sessions/:sessionId',
    loadComponent: () =>
      import('./features/session-detail/session-detail.page').then((m) => m.SessionDetailPage),
  },
  {
    path: 'search',
    loadComponent: () => import('./features/search/search.page').then((m) => m.SearchPage),
  },
  {
    path: 'trash',
    loadComponent: () => import('./features/trash/trash.page').then((m) => m.TrashPage),
  },
  {
    path: 'plans',
    loadComponent: () => import('./features/plans/plans.page').then((m) => m.PlansPage),
  },
  { path: '**', redirectTo: '' },
];
