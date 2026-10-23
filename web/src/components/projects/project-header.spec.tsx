import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectHeader } from './project-header';

const api = vi.hoisted(() => vi.fn());
vi.mock('@/lib/projects-api', () => ({
  projectsApi: api,
  projectsQueryKey: ['projects'],
}));
vi.mock('@/lib/platform-session', () => ({
  usePlatformSession: () => ({ isAdministrator: true }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: globalThis.__testTranslate }),
}));

const projects = {
  projects: [
    {
      id: 'project',
      name: 'Tests',
      workspaces: [],
      resources: [],
    },
  ],
};

beforeEach(() => {
  api.mockReset();
  api.mockImplementation((path?: string) =>
    Promise.resolve(path === '/project' ? {} : projects),
  );
});
afterEach(cleanup);

it('renames the project from the pencil displayed beside its header title', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ProjectHeader projectId="project" />
    </QueryClientProvider>,
  );

  await screen.findByRole('heading', { name: 'Tests' });
  fireEvent.click(screen.getByRole('button', { name: 'Rename project' }));
  fireEvent.change(screen.getByLabelText('Project name'), {
    target: { value: 'New project name' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/project',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'New project name' }),
      }),
    ),
  );
});
