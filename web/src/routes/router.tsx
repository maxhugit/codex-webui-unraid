/**
 * TanStack Router configuration with code-based route tree.
 * Auth guard on the root layout redirects unauthenticated users to /login.
 */
import {
  createRouter,
  createRoute,
  createRootRoute,
  redirect,
  Outlet,
} from '@tanstack/react-router';
import { getApiToken } from '@/auth-token';
import { LoginRoute } from './login-route';
import { AuthenticatedLayout } from './authenticated-layout';
import { HomeRoute } from './home-route';
import { HelpRoute } from './help-route';
import { ThreadView } from './thread-view';
import { FilesRoute } from './files-route';
import { TerminalRoute } from './terminal-route';
import { DiagnosticsRoute } from './diagnostics-route';
import { LogsRoute } from './logs-route';
import { SimpleChatRoute } from './simple-chat-route';
import { ProjectResourceRoute } from './project-resource-route';
import { ProjectRoute } from './project-route';
import { SettingsPage } from '@/components/settings/settings-page';
import {
  SETTINGS_SECTIONS,
  type SettingsSection,
} from '@/components/settings/settings-sections';
import { IntegrationsPage } from '@/components/integrations/integrations-page';
import { BASE_PATH } from '@/base-path';

export type LoginSearch = { redirect: string };
export type IntegrationsSearch = { tab: 'plugins' | 'apps' | 'mcps' };
export type SimpleChatSearch = { thread?: string };

const INTEGRATION_TABS = ['plugins', 'apps', 'mcps'] as const;

function sanitizeIntegrationsSearch(
  search: Record<string, unknown>,
): IntegrationsSearch {
  const tab = search.tab;
  return {
    tab: INTEGRATION_TABS.includes(tab as IntegrationsSearch['tab'])
      ? (tab as IntegrationsSearch['tab'])
      : 'plugins',
  };
}

/** Sanitizes redirect target to prevent open-redirect attacks. */
function sanitizeRedirect(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.startsWith('/api/')) return '/';
  return value;
}

/** Bare root — just renders child routes. */
const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

/** Login route — redirects to / if already authenticated. */
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: sanitizeRedirect(search.redirect),
  }),
  beforeLoad: ({ search }) => {
    if (getApiToken()) {
      throw redirect({ to: search.redirect });
    }
  },
  component: LoginRoute,
});

/** Authenticated layout — sidebar + header + outlet. */
const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authenticated',
  beforeLoad: ({ location }) => {
    if (!getApiToken()) {
      throw redirect({
        to: '/login',
        search: { redirect: location.href },
      });
    }
  },
  component: AuthenticatedLayout,
});

/** Index route — cross-project overview. */
const indexRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/',
  component: HomeRoute,
});

const helpRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/help',
  component: HelpRoute,
});

/** Thread route — specific thread by id. */
export const threadRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/t/$threadId',
  component: ThreadView,
});

/** Global files view. */
const filesRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/files',
  component: FilesRoute,
});

/** Global terminal view. */
const terminalRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/terminal',
  component: TerminalRoute,
});

/** Diagnostics panel. */
const diagnosticsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/diagnostics',
  component: DiagnosticsRoute,
});

/** Live structured application logs. */
const logsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/logs',
  component: LogsRoute,
});

/** General-purpose low-cost chat backed directly by the OpenAI API. */
export const simpleChatRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/simple-chat',
  validateSearch: (search: Record<string, unknown>): SimpleChatSearch => ({
    thread:
      typeof search.thread === 'string' && search.thread
        ? search.thread
        : undefined,
  }),
  component: SimpleChatRoute,
});

const projectResourceRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/projects/$projectId/resources/$resourceId',
  validateSearch: (search: Record<string, unknown>) => ({
    task:
      typeof search.task === 'string' && search.task ? search.task : undefined,
  }),
  component: ProjectResourceRoute,
});

const projectRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/projects/$projectId',
  component: ProjectRoute,
});

/** Settings page. */
const settingsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/settings',
  validateSearch: (
    search: Record<string, unknown>,
  ): { section?: SettingsSection } => ({
    section: SETTINGS_SECTIONS.includes(search.section as SettingsSection)
      ? (search.section as SettingsSection)
      : undefined,
  }),
  component: SettingsPage,
});

/** Integrations page (plugins, apps, MCPs). */
const integrationsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/integrations',
  validateSearch: sanitizeIntegrationsSearch,
  component: IntegrationsPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  authenticatedRoute.addChildren([
    indexRoute,
    helpRoute,
    threadRoute,
    filesRoute,
    terminalRoute,
    diagnosticsRoute,
    logsRoute,
    simpleChatRoute,
    projectRoute,
    projectResourceRoute,
    settingsRoute,
    integrationsRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  basepath: BASE_PATH || '/',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
