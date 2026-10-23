import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectKnowledgePanel } from './project-knowledge-panel';

const api = vi.hoisted(() => vi.fn());
vi.mock('@/lib/projects-api', () => ({ projectsApi: api }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: globalThis.__testTranslate }),
}));
const original = {
  files: {
    'AGENTS.md': 'Rules',
    'CONNAISSANCES.md': 'Facts',
    'DECISIONS.md': 'Decisions',
  },
  revision: 'revision-1',
  path: '/workspaces/id/.mergeron/knowledge',
};
beforeEach(() => {
  api.mockReset();
  api.mockResolvedValue(original);
});
afterEach(cleanup);
function setup(
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ProjectKnowledgePanel projectId="p" />
      </QueryClientProvider>,
    ),
  };
}

it('saves multiple edited documents with one button and their original revision', async () => {
  setup();
  const instructions = await screen.findByLabelText(/Shared instructions/);
  fireEvent.change(instructions, { target: { value: 'Updated rules' } });
  fireEvent.change(screen.getByLabelText(/Project decisions/), {
    target: { value: 'Updated decisions' },
  });
  api.mockResolvedValueOnce({
    ...original,
    revision: 'revision-2',
    files: {
      ...original.files,
      'AGENTS.md': 'Updated rules',
      'DECISIONS.md': 'Updated decisions',
    },
  });
  expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/p/knowledge',
      expect.objectContaining({ method: 'PUT' }),
    ),
  );
  const request = api.mock.calls.find(
    (call) => call[1]?.method === 'PUT',
  )?.[1] as RequestInit;
  expect(JSON.parse(request.body as string)).toMatchObject({
    revision: 'revision-1',
    files: {
      'AGENTS.md': 'Updated rules',
      'DECISIONS.md': 'Updated decisions',
    },
  });
  await screen.findByText('No pending changes');
});

it('shows shared knowledge to a participant without editing or proposal controls', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ProjectKnowledgePanel projectId="p" readOnly />
    </QueryClientProvider>,
  );
  const instructions = await screen.findByLabelText(/Shared instructions/);
  expect(instructions).toHaveValue('Rules');
  expect(instructions).toHaveAttribute('readonly');
  expect(
    screen.queryByRole('button', { name: 'Save' }),
  ).not.toBeInTheDocument();
  expect(api.mock.calls.every(([path]) => path === '/p/knowledge')).toBe(true);
});

it('keeps the draft and original revision when revisiting the project tab', async () => {
  const first = setup();
  fireEvent.change(await screen.findByLabelText(/Shared instructions/), {
    target: { value: 'Unsaved draft' },
  });
  first.unmount();
  setup(first.client);
  expect(await screen.findByLabelText(/Shared instructions/)).toHaveValue(
    'Unsaved draft',
  );
});

it('preserves edits on a conflict and only discards them on explicit reload', async () => {
  setup();
  fireEvent.change(await screen.findByLabelText(/Shared instructions/), {
    target: { value: 'My draft' },
  });
  api.mockRejectedValueOnce(
    new Error('Knowledge changed since it was loaded.'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText(/Shared instructions/)).toHaveValue('My draft');
  api.mockResolvedValueOnce({
    ...original,
    revision: 'revision-2',
    files: { ...original.files, 'AGENTS.md': 'Other editor' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Reload and discard changes' }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText(/Shared instructions/)).toHaveValue(
      'Other editor',
    ),
  );
});

it('enforces the UTF-8 byte limit before submitting a save', async () => {
  setup();
  fireEvent.change(await screen.findByLabelText(/Shared instructions/), {
    target: { value: 'é'.repeat(20000) },
  });
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('32 KiB');
});
