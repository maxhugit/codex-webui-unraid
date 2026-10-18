import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { GlobalFilesHost } from './global-files-host';
import { useFileBrowserState } from './file-browser-context';
import { useFilesStore, useGlobalFilesStore } from '@/stores/files-store';

vi.mock('./files-panel', () => ({
  FilesPanel: ({ active }: { active: boolean }) => {
    const root = useFileBrowserState((s) => s.rootDir);
    const selected = useFileBrowserState((s) => s.selectedFile);
    const [draft, setDraft] = useState('');
    return (
      <div data-testid="retained-panel" data-active={active}>
        <span>
          {root}:{selected}
        </span>
        <textarea
          aria-label="draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
    );
  },
}));
afterEach(() => {
  cleanup();
  useFilesStore.setState({ rootDir: null, selectedFile: null });
  useGlobalFilesStore.setState({ rootDir: null, selectedFile: null });
});

it('mounts lazily and preserves the same editor, draft and scroll position across navigation', () => {
  const view = render(<GlobalFilesHost active={false} />);
  expect(screen.queryByTestId('retained-panel')).toBeNull();
  view.rerender(<GlobalFilesHost active />);
  const panel = screen.getByTestId('retained-panel');
  panel.scrollTop = 123;
  fireEvent.change(screen.getByLabelText('draft'), {
    target: { value: 'unsaved text' },
  });
  view.rerender(<GlobalFilesHost active={false} />);
  expect(
    panel.closest('[data-global-files-host]')?.hasAttribute('hidden'),
  ).toBe(true);
  expect(panel.getAttribute('data-active')).toBe('false');
  view.rerender(<GlobalFilesHost active />);
  expect(screen.getByTestId('retained-panel')).toBe(panel);
  expect(panel.scrollTop).toBe(123);
  expect((screen.getByLabelText('draft') as HTMLTextAreaElement).value).toBe(
    'unsaved text',
  );
});

it('keeps global folder and file independent from conversation explorers', () => {
  useGlobalFilesStore.setState({
    rootDir: '/global/documents',
    selectedFile: '/global/documents/a.txt',
  });
  const view = render(<GlobalFilesHost active />);
  view.rerender(<GlobalFilesHost active={false} />);
  useFilesStore.getState().setRootDir('/conversation');
  useFilesStore.getState().selectFile('/conversation/b.txt');
  view.rerender(<GlobalFilesHost active />);
  expect(screen.getByTestId('retained-panel').textContent).toContain(
    '/global/documents:/global/documents/a.txt',
  );
  useGlobalFilesStore
    .getState()
    .remapPaths('/global/documents', '/global/renamed');
  expect(useGlobalFilesStore.getState().selectedFile).toBe(
    '/global/renamed/a.txt',
  );
  expect(useFilesStore.getState().rootDir).toBe('/conversation');
});
