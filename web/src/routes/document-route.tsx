import { useEffect } from 'react';
import { useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { OnlyOfficeViewer } from '@/components/files/viewers/onlyoffice-viewer';
import { FileViewer } from '@/components/files/file-viewer';
import { getFileCategory } from '@/lib/file-category';

/** Authenticated document tab: Office formats open directly in the editor. */
export function DocumentRoute() {
  const { path } = useSearch({ strict: false }) as { path?: string };
  const { t } = useTranslation();
  useEffect(() => {
    if (!path) return;
    const previousTitle = document.title;
    document.title = path.split('/').pop() || previousTitle;
    return () => {
      document.title = previousTitle;
    };
  }, [path]);
  if (!path)
    return (
      <main className="p-6 text-sm text-muted-foreground">
        {t('selectAFileToView')}
      </main>
    );
  const category = getFileCategory(path);
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {category === 'docx' || category === 'xlsx' || category === 'pptx' ? (
        <OnlyOfficeViewer key={path} filePath={path} />
      ) : (
        <FileViewer
          key={path}
          filePath={path}
          viewId={`document-tab:${path}`}
        />
      )}
    </main>
  );
}
