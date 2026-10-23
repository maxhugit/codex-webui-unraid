import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectRoute } from './project-route';

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ projectId: 'p' }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: globalThis.__testTranslate,
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/lib/platform-session', () => ({
  usePlatformSession: () => ({ isAdministrator: false }),
}));
vi.mock('@/lib/people-api', () => ({
  useParticipants: () => ({ data: { participants: [] } }),
}));
vi.mock('@/components/projects/project-settings-dialog', () => ({
  ProjectSettingsPanel: () => null,
}));
vi.mock('@/lib/projects-api', () => ({
  projectsQueryKey: ['projects'],
  projectsApi: (path?: string) =>
    Promise.resolve(
      path
        ? {
            activity: Array.from({ length: 60 }, (_, i) => ({
              id: String(i),
              action: 'project_created',
              actorPersonId: i % 2 ? 'bob' : 'alice',
              actorName: i % 2 ? 'Bob' : 'Alice',
              label: `Event ${i}`,
              createdAt: 1_790_000_000_000,
              details: {},
            })),
          }
        : {
            projects: [
              {
                id: 'p',
                name: 'Project',
                resources: [],
                workspaces: [],
                createdAt: 1_790_000_000_000,
                updatedAt: 1_790_000_000_000,
              },
            ],
          },
    ),
}));
afterEach(cleanup);

it('keeps the journal heading and person filter outside the keyboard-accessible scroll region', async () => {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ProjectRoute />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('tab', { name: 'Journal' }));
  const entries = await screen.findByRole('region', {
    name: 'Project journal',
  });
  expect(entries).toHaveAttribute('tabindex', '0');
  expect(entries).toHaveClass(
    'min-h-0',
    'flex-1',
    'overflow-y-auto',
    'overscroll-contain',
  );
  expect(within(entries).queryByRole('heading')).not.toBeInTheDocument();
  expect(within(entries).queryByRole('combobox')).not.toBeInTheDocument();
  const section = entries.parentElement!;
  expect(section).toHaveClass('flex', 'min-h-0', 'overflow-hidden');
  expect(section.firstElementChild).toHaveClass('shrink-0');
  expect(within(entries).getByText('Event 59')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Filter by person' }), {
    target: { value: 'person:alice' },
  });
  expect(within(entries).getByText('Event 58')).toBeInTheDocument();
  expect(within(entries).queryByText('Event 59')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'General information' }));
  expect(
    screen.queryByRole('region', { name: 'Project journal' }),
  ).not.toBeInTheDocument();
});
