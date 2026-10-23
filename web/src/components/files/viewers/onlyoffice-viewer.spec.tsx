import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onlyOfficeGetConfig } from '@/generated/api/sdk.gen';
import { OnlyOfficeViewer } from './onlyoffice-viewer';

vi.mock('@/generated/api/sdk.gen', () => ({
  onlyOfficeGetConfig: vi.fn(),
}));

describe('OnlyOfficeViewer', () => {
  let editorConfig: Record<string, unknown>;

  beforeEach(() => {
    editorConfig = {};
    vi.mocked(onlyOfficeGetConfig).mockResolvedValue({
      data: {
        scriptUrl:
          'https://office.example.test/web-apps/apps/api/documents/api.js',
        config: {
          editorConfig: { mode: 'edit' },
        },
      },
    } as never);
    window.DocsAPI = {
      DocEditor: class {
        constructor(_elementId: string, config: Record<string, unknown>) {
          editorConfig = config;
        }
      },
    };
  });

  it('removes the loading overlay when OnlyOffice reports the document ready', async () => {
    render(<OnlyOfficeViewer filePath="/workspace/report.docx" />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    await vi.waitFor(() => expect(editorConfig.events).toBeDefined());

    const events = editorConfig.events as {
      onDocumentReady: () => void;
    };
    expect(events.onDocumentReady).toBeTypeOf('function');
    expect('onReady' in events).toBe(false);

    act(() => events.onDocumentReady());

    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(screen.getByText('OnlyOffice editor ready')).toBeInTheDocument();
  });

  it('requests a server-signed view configuration for read-only previews', async () => {
    render(<OnlyOfficeViewer filePath="/workspace/report.docx" readOnly />);
    await vi.waitFor(() =>
      expect(onlyOfficeGetConfig).toHaveBeenCalledWith({
        query: { path: '/workspace/report.docx', mode: 'view' },
        throwOnError: true,
      }),
    );
  });
});
