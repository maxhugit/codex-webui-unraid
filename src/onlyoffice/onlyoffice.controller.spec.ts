import { describe, expect, it, vi } from 'vitest';
import { verify } from 'jsonwebtoken';
import { OnlyOfficeController } from './onlyoffice.controller';
import { GENERAL_SETTING_KEYS } from '../settings/settings.definitions';

function setup(editable = true) {
  const session = vi.fn().mockReturnValue('document-session');
  type Dependencies = ConstructorParameters<typeof OnlyOfficeController>;
  const settings = new Map<string, string>([
    [GENERAL_SETTING_KEYS.onlyofficeUrl, 'https://office.example.test'],
    [GENERAL_SETTING_KEYS.onlyofficeJwtSecret, 'test-only-secret'],
    [GENERAL_SETTING_KEYS.publicBaseUrl, 'https://app.example.test'],
  ]);
  const controller = new OnlyOfficeController(
    {
      getMetadata: vi.fn().mockResolvedValue({
        type: 'file',
        path: '/workspace/report.docx',
        name: 'report.docx',
        mtime: 1,
        size: 20,
      }),
    } as unknown as Dependencies[0],
    {
      getStringSetting: (key: string) => settings.get(key),
    } as unknown as Dependencies[1],
    {
      createDocumentSession: session,
      signFileAccess: () => 'file-access-token',
    } as unknown as Dependencies[2],
    {} as Dependencies[3],
    { onlyOfficeAccess: () => ({ editable }) } as unknown as Dependencies[4],
  );
  return { controller, session };
}
describe('OnlyOffice editor and preview configuration', () => {
  it('signs a minimal, non-editable embedded preview and issues a read-only session', async () => {
    const { controller, session } = setup();
    const result = await controller.getConfig('/workspace/report.docx', 'view');
    expect(result.config).toMatchObject({
      type: 'embedded',
      document: {
        permissions: {
          edit: false,
          comment: false,
          review: false,
          fillForms: false,
          download: false,
          print: false,
        },
      },
      editorConfig: {
        mode: 'view',
        embedded: { autostart: 'document', toolbarDocked: 'top' },
        customization: {
          comments: false,
          chat: false,
          plugins: false,
          help: false,
        },
      },
    });
    expect(session).toHaveBeenCalledWith('/workspace/report.docx', false);
    expect(
      verify(result.config.token as string, 'test-only-secret'),
    ).toMatchObject({
      type: 'embedded',
      document: { permissions: { edit: false } },
    });
  });
  it('preserves the full editor in the separate document tab', async () => {
    const { controller, session } = setup();
    const result = await controller.getConfig('/workspace/report.docx', 'edit');
    expect(result.config).toMatchObject({
      type: 'desktop',
      document: { permissions: { edit: true, download: true, print: true } },
      editorConfig: { mode: 'edit' },
    });
    expect(session).toHaveBeenCalledWith('/workspace/report.docx', true);
  });
  it('never overrides a deliverable read-only restriction', async () => {
    const { controller, session } = setup(false);
    const result = await controller.getConfig('/workspace/report.docx', 'edit');
    expect(result.config).toMatchObject({
      document: { permissions: { edit: false, fillForms: false } },
      editorConfig: { mode: 'view' },
    });
    expect(session).toHaveBeenCalledWith('/workspace/report.docx', false);
  });
});
