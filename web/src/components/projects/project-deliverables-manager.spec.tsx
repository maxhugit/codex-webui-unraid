import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectDeliverablesManager } from './project-deliverables-manager';
import type { Deliverable } from '@/lib/deliverables-api';
const api = vi.hoisted(() => vi.fn());
vi.mock('@/lib/projects-api', () => ({ projectsApi: api }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/lib/platform-session', () => ({
  usePlatformSession: () => ({ isAdministrator: true }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: globalThis.__testTranslate }),
}));
const item: Deliverable = {
  id: 'd',
  title: 'Report',
  description: '',
  criteria: '',
  assigneeId: null,
  dueAt: null,
  status: 'planned',
  taskIds: [],
  conversations: [],
  version: 3,
  validatedVersionId: null,
  directory: '/workspaces/p/livrables/d',
  createdAt: 1,
  updatedAt: 2,
  versions: [],
  documents: [],
};
const board = {
  resource: { name: 'Deliverables' },
  deliverables: [item],
  assignees: [],
  tasks: [],
  conversations: [],
};
beforeEach(() => {
  api.mockReset();
  api.mockImplementation((_path, input) => Promise.resolve(input ? {} : board));
});
afterEach(cleanup);
async function setup(data = board) {
  api.mockImplementation((_path, input) =>
    Promise.resolve(input ? {} : data),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <ProjectDeliverablesManager projectId="p" resourceId="r" />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /Report/ }));
}
it('saves the brief with its revision and cannot manually select validated', async () => {
  await setup();
  expect(
    screen.getByRole('combobox', { name: 'Status' }),
  ).not.toHaveTextContent('Validated');
  fireEvent.change(screen.getByLabelText('Validation criteria'), {
    target: { value: 'Checked by owner' },
  });
  fireEvent.click(screen.getByRole('tab', { name: 'History' }));
  expect(screen.getByRole('button', { name: 'Submit version' })).toBeDisabled();
  fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/p/resources/r/deliverables/d',
      expect.objectContaining({ method: 'PATCH' }),
    ),
  );
  const request = api.mock.calls.find(
    (call) => call[1]?.method === 'PATCH',
  )?.[1] as RequestInit;
  expect(JSON.parse(request.body as string)).toMatchObject({
    criteria: 'Checked by owner',
    version: 3,
  });
});
it('submits file paths as a proposed version without validating automatically', async () => {
  await setup();
  fireEvent.click(screen.getByRole('tab', { name: 'History' }));
  fireEvent.change(screen.getByLabelText('Project file paths, one per line'), {
    target: { value: '/workspaces/p/report.pdf\n/workspaces/p/data.csv' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Submit version' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/p/resources/r/deliverables/d/versions',
      expect.objectContaining({ method: 'POST' }),
    ),
  );
  const request = api.mock.calls.find(
    (call) => call[1]?.method === 'POST',
  )?.[1] as RequestInit;
  expect(JSON.parse(request.body as string)).toEqual({
    paths: ['/workspaces/p/report.pdf', '/workspaces/p/data.csv'],
    note: '',
    version: 3,
  });
  expect(
    api.mock.calls.some((call) => String(call[0]).endsWith('/review')),
  ).toBe(false);
});
it('creates a linked agent only through an explicit action', async () => {
  await setup();
  expect(
    api.mock.calls.some((call) => String(call[0]).endsWith('/agent')),
  ).toBe(false);
  api.mockImplementation((path, input) =>
    Promise.resolve(
      String(path).endsWith('/agent')
        ? { threadId: 'new-agent' }
        : input
          ? {}
          : board,
    ),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Work on this deliverable' }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/p/resources/r/deliverables/d/agent', {
      method: 'POST',
      body: JSON.stringify({ version: 3 }),
    }),
  );
});
it('creates an independent version from the current document file', async () => {
  const document = {
    id: 'doc',
    deliverableId: 'd',
    name: 'report.docx',
    format: 'docx',
    sourcePath: '/workspaces/p/livrables/d/report.docx',
    currentVersionNumber: 2,
    deletedAt: null,
    createdAt: 1,
    updatedAt: 2,
    versions: [
      {
        id: 'dv2',
        documentId: 'doc',
        number: 2,
        fileName: 'report.docx',
        sourcePath: '/workspaces/p/livrables/d/report.docx',
        snapshotPath: '/history/report.docx',
        size: 42,
        sha256: 'hash',
        authorPersonId: null,
        authorName: 'Maxime',
        comment: '',
        restoredFromVersionId: null,
        createdAt: 2,
      },
    ],
  };
  await setup({
    ...board,
    deliverables: [{ ...item, documents: [document] }],
  });
  fireEvent.click(screen.getByRole('tab', { name: /Documents/ }));
  fireEvent.change(screen.getByLabelText('Version comment'), {
    target: { value: 'After review' },
  });
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Create a version from the current file',
    }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/p/resources/r/deliverables/d/documents/doc/versions',
      expect.objectContaining({ method: 'POST' }),
    ),
  );
  const request = api.mock.calls.find((call) =>
    String(call[0]).endsWith('/documents/doc/versions'),
  )?.[1] as RequestInit;
  expect(JSON.parse(request.body as string)).toEqual({
    path: '/workspaces/p/livrables/d/report.docx',
    comment: 'After review',
    expectedVersion: 2,
  });
});
