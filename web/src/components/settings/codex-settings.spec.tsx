/** The raw repair editor must survive structured config failure and restart invalidation. */
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CodexSettings } from './codex-settings';
import { catalogFixture, deferred, json } from './catalog/catalog.testing';
import { codexConfigReadConfigQueryKey } from '@/generated/api/@tanstack/react-query.gen';

vi.mock('@monaco-editor/react', async () => ({
  default: (await import('./catalog/catalog.testing')).TextEditor,
}));
vi.mock('@/stores/theme-store', () => ({
  useThemeStore: (select: (state: { dark: boolean }) => unknown) =>
    select({ dark: false }),
}));

let fixture: ReturnType<typeof catalogFixture>;
beforeEach(() => {
  fixture = catalogFixture();
});
afterEach(() => {
  fixture.dispose();
});

it('preserves unsaved TOML through loading, failure and success, then exposes the required restart', async () => {
  const user = userEvent.setup();
  const config = deferred<Response>();
  const baseline = 'model = "example"\n';
  fixture.server.overrides.set('GET /api/codex/config', () => config.promise);
  fixture.server.overrides.set('GET /api/models', () =>
    json({ data: [], nextCursor: null }),
  );
  fixture.server.overrides.set('GET /api/codex/config/raw', () =>
    json({ content: baseline, filePath: 'config.toml' }),
  );
  fixture.server.overrides.set('PUT /api/codex/config/raw', () => {
    fixture.server.state = {
      ...fixture.server.state,
      configuredPointer: 'catalog-a.json',
      pointerApplied: false,
    };
    return json({ restartRequired: true, reloaded: false, warnings: [] });
  });
  fixture.render(<CodexSettings />);
  await user.click(screen.getByRole('tab', { name: 'Raw configuration' }));
  await user.click(screen.getByRole('button', { name: 'Edit config.toml' }));
  const raw = await screen.findByRole('textbox', { name: 'Raw TOML' });
  await waitFor(() => expect(raw).toHaveValue(baseline));
  const edited = 'model = "edited"\n';
  fireEvent.change(raw, { target: { value: edited } });
  await act(async () => config.resolve(json({ message: 'Broken TOML' }, 503)));
  expect(raw).toHaveValue(edited);
  fixture.server.overrides.set('GET /api/codex/config', () =>
    json({ config: {}, origins: {} }),
  );
  await act(() =>
    fixture.queryClient.invalidateQueries({
      queryKey: codexConfigReadConfigQueryKey(),
    }),
  );
  expect(
    screen.queryByText(
      'Manage Codex app-server settings. Changes are saved to user config.toml and hot-reloaded.',
    ),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Raw TOML' })).toHaveValue(edited);
  await user.click(screen.getByRole('button', { name: 'Save & Reload' }));
  await waitFor(() =>
    expect(fixture.server.writes).toContainEqual({
      method: 'PUT',
      path: '/api/codex/config/raw',
      body: { content: edited, expectedContent: baseline },
    }),
  );
  expect(screen.getByRole('textbox', { name: 'Raw TOML' })).toHaveValue(edited);
  await user.click(screen.getByRole('tab', { name: 'Catalog' }));
  expect(
    await screen.findByRole('button', { name: 'Restart Codex' }),
  ).toBeEnabled();
});

it('shows Codex setting groups as tabs instead of one long page', async () => {
  const user = userEvent.setup();
  fixture.server.overrides.set('GET /api/codex/config', () =>
    json({
      config: {
        model: 'gpt-test',
        instructions: 'Be concise',
      },
      origins: {},
    }),
  );
  fixture.server.overrides.set('GET /api/models', () =>
    json({ data: [], nextCursor: null }),
  );
  fixture.server.overrides.set('GET /api/codex/config/raw', () =>
    json({ content: '', filePath: 'config.toml' }),
  );

  fixture.render(<CodexSettings />);

  expect(
    await screen.findByRole('tab', { name: 'Model', selected: true }),
  ).toBeVisible();
  expect(await screen.findByText('Default model name')).toBeVisible();
  expect(
    screen.queryByText(
      'Reserved for future use by Codex. Leave empty; use AGENTS.md for project guidance.',
    ),
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole('tab', { name: 'Instructions' }));

  expect(
    screen.getByRole('tab', { name: 'Instructions', selected: true }),
  ).toBeVisible();
  expect(
    screen.getByText(
      'Reserved for future use by Codex. Leave empty; use AGENTS.md for project guidance.',
    ),
  ).toBeVisible();
  expect(screen.queryByText('Default model name')).not.toBeInTheDocument();
});

function editableConfig() {
  let config: Record<string, unknown> = {
    model: 'first',
    review_model: 'first',
    instructions: 'Original',
  };
  fixture.server.overrides.set('GET /api/codex/config', () =>
    json({ config, origins: {} }),
  );
  fixture.server.overrides.set('PATCH /api/codex/config', async (request) => {
    const { edits } = (await request.json()) as {
      edits: { keyPath: string; value: unknown }[];
    };
    config = {
      ...config,
      ...Object.fromEntries(edits.map((edit) => [edit.keyPath, edit.value])),
    };
    return json({ config, origins: {} });
  });
  fixture.server.overrides.set('GET /api/models', (request) => {
    const cursor = new URL(request.url).searchParams.get('cursor');
    return json({
      data: [
        {
          model: cursor ? 'new-model' : 'first',
          hidden: false,
          serviceTiers: [{ id: 'new-tier' }],
          supportedReasoningEfforts: [
            { reasoningEffort: 'high' },
            { reasoningEffort: 'ultra' },
          ],
          isDefault: !cursor,
        },
      ],
      nextCursor: cursor ? null : 'second-page',
    });
  });
}

it('loads live model pages and saves only the active tab in one request', async () => {
  editableConfig();
  const user = userEvent.setup();
  fixture.render(<CodexSettings />);
  const model = await screen.findByRole('combobox', { name: 'Model' });
  await waitFor(() =>
    expect(
      within(model).getByRole('option', { name: 'new-model' }),
    ).toBeInTheDocument(),
  );
  expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1);
  await user.selectOptions(model, 'new-model');
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Review Model' }),
    'new-model',
  );
  expect(fixture.server.writes).toHaveLength(0);
  await user.click(screen.getByRole('tab', { name: 'Instructions' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Instructions' }), {
    target: { value: 'Pending instructions' },
  });
  await user.click(screen.getByRole('tab', { name: 'Model' }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(fixture.server.writes).toHaveLength(1));
  expect(fixture.server.writes[0].body).toEqual({
    edits: [
      { keyPath: 'model', value: 'new-model' },
      { keyPath: 'review_model', value: 'new-model' },
    ],
  });
  await user.click(screen.getByRole('tab', { name: 'Instructions' }));
  expect(screen.getByRole('textbox', { name: 'Instructions' })).toHaveValue(
    'Pending instructions',
  );
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('textbox', { name: 'Instructions' })).toHaveValue(
    'Original',
  );
});

it('keeps drafts on save failure and uses advertised reasoning choices', async () => {
  editableConfig();
  fixture.server.overrides.set('PATCH /api/codex/config', () =>
    json({ message: 'Cannot write' }, 500),
  );
  const user = userEvent.setup();
  fixture.render(<CodexSettings />);
  const model = await screen.findByRole('combobox', { name: 'Model' });
  await waitFor(() =>
    expect(
      within(model).getByRole('option', { name: 'new-model' }),
    ).toBeInTheDocument(),
  );
  await user.selectOptions(model, 'new-model');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
  );
  expect(model).toHaveValue('new-model');
  await user.click(screen.getByRole('tab', { name: 'Reasoning' }));
  const effort = screen.getByRole('combobox', { name: 'Reasoning Effort' });
  expect(
    within(effort).getByRole('option', { name: 'ultra' }),
  ).toBeInTheDocument();
  expect(
    within(effort).queryByRole('option', { name: 'minimal' }),
  ).not.toBeInTheDocument();
});

it('stages security choices and discards them without a backend mutation', async () => {
  editableConfig();
  const user = userEvent.setup();
  fixture.render(<CodexSettings />);
  await screen.findByRole('combobox', { name: 'Model' });
  await user.click(screen.getByRole('tab', { name: 'Security' }));
  const policy = screen.getAllByRole('combobox')[0];
  await user.selectOptions(policy, 'never');
  expect(policy).toHaveValue('never');
  expect(fixture.server.writes).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(policy).toHaveValue('on-request');
  expect(fixture.server.writes).toHaveLength(0);
});
