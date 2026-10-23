import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DocumentRoute } from './document-route';
const search = vi.hoisted(() => ({ path: undefined as string | undefined }));
vi.mock('@tanstack/react-router', () => ({ useSearch: () => search }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: globalThis.__testTranslate }),
}));
vi.mock('@/components/files/viewers/onlyoffice-viewer', () => ({
  OnlyOfficeViewer: ({ filePath }: { filePath: string }) => (
    <div data-testid="office">{filePath}</div>
  ),
}));
vi.mock('@/components/files/file-viewer', () => ({
  FileViewer: ({ filePath }: { filePath: string }) => (
    <div data-testid="preview">{filePath}</div>
  ),
}));
afterEach(() => {
  cleanup();
  search.path = undefined;
});
it.each(['docx', 'xlsx', 'pptx'])(
  'opens %s directly in OnlyOffice and labels the browser tab',
  (extension) => {
    const previousTitle = document.title;
    search.path = `/workspaces/Projet été/Contrat & budget.${extension}`;
    const view = render(<DocumentRoute />);
    expect(screen.getByTestId('office')).toHaveTextContent(search.path);
    expect(screen.queryByTestId('preview')).not.toBeInTheDocument();
    expect(document.title).toBe(`Contrat & budget.${extension}`);
    view.unmount();
    expect(document.title).toBe(previousTitle);
  },
);
it('keeps non-Office documents readable in the new tab', () => {
  search.path = '/workspaces/report.pdf';
  render(<DocumentRoute />);
  expect(screen.getByTestId('preview')).toHaveTextContent(search.path);
  expect(screen.queryByTestId('office')).not.toBeInTheDocument();
});
it('does not start an editor without a document path', () => {
  render(<DocumentRoute />);
  expect(screen.queryByTestId('office')).not.toBeInTheDocument();
  expect(screen.queryByTestId('preview')).not.toBeInTheDocument();
});
