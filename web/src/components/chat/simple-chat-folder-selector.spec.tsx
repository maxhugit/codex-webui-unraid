import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { SimpleChatFolderSelector } from './simple-chat-folder-selector';
const api = vi.hoisted(() => vi.fn());
vi.mock('@/lib/projects-api', () => ({
  projectsApi: api,
  projectsQueryKey: ['projects'],
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: globalThis.__testTranslate }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('lets a simple conversation recover a missing folder by choosing a project resource', async () => {
  const onSelected = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ activeFolder: null }),
      }),
  );
  api.mockImplementation((_path, input) =>
    Promise.resolve(
      input
        ? {}
        : {
            projects: [
              {
                id: 'p',
                workspaces: [{ id: 'w', name: 'Workspace principal' }],
              },
            ],
          },
    ),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SimpleChatFolderSelector
        projectId="p"
        threadId="c"
        disabled={false}
        onSelected={onSelected}
      />
    </QueryClientProvider>,
  );
  await screen.findByRole('option', { name: 'Workspace principal' });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'w' } });
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/p/active-folders/simple_chat/c', {
      method: 'PUT',
      body: JSON.stringify({ resourceId: 'w', relativePath: '' }),
    }),
  );
  await waitFor(() => expect(onSelected).toHaveBeenCalled());
});
