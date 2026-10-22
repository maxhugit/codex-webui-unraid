import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, Eye, History, RotateCcw, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FileViewer } from '@/components/files/file-viewer';
import { projectsApi } from '@/lib/projects-api';
import type {
  Deliverable,
  DeliverableDocument,
  DeliverableDocumentVersion,
} from '@/lib/deliverables-api';
import { getAuthorizationHeader } from '@/auth-token';
import { withBasePath } from '@/base-path';

type Props = {
  item: Deliverable;
  base: string;
  disabled: boolean;
  refresh: () => Promise<unknown>;
  onError: () => void;
};

export function DeliverableDocuments({
  item,
  base,
  disabled,
  refresh,
  onError,
}: Props) {
  const { t } = useTranslation();
  const [comment, setComment] = useState('');
  const [viewed, setViewed] = useState<DeliverableDocument | null>(null);
  const [history, setHistory] = useState<DeliverableDocument | null>(null);
  const active = useMemo(
    () => item.documents.filter((document) => document.deletedAt === null),
    [item.documents],
  );
  const archived = useMemo(
    () => item.documents.filter((document) => document.deletedAt !== null),
    [item.documents],
  );

  const request = useMutation({
    mutationFn: ({
      suffix,
      method = 'POST',
      body,
    }: {
      suffix: string;
      method?: string;
      body: unknown;
    }) =>
      projectsApi(`${base}/${item.id}${suffix}`, {
        method,
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      setComment('');
      await refresh();
    },
    onError,
  });

  const addDocument = useMutation({
    mutationFn: async (files: FileList) => {
      for (const file of Array.from(files)) {
        const path = await uploadFile(file, item.directory, false);
        await projectsApi(`${base}/${item.id}/documents`, {
          method: 'POST',
          body: JSON.stringify({ path, comment }),
        });
      }
    },
    onSuccess: async () => {
      setComment('');
      await refresh();
    },
    onError,
  });

  const addVersion = useMutation({
    mutationFn: async ({ document, file }: { document: DeliverableDocument; file: File }) => {
      if (file.name !== document.name) throw new Error('filename');
      const separator = document.sourcePath.lastIndexOf('/');
      const directory = separator > 0 ? document.sourcePath.slice(0, separator) : item.directory;
      const path = await uploadFile(file, directory, true);
      await projectsApi(`${base}/${item.id}/documents/${document.id}/versions`, {
        method: 'POST',
        body: JSON.stringify({
          path,
          comment,
          expectedVersion: document.currentVersionNumber,
        }),
      });
    },
    onSuccess: async () => {
      setComment('');
      await refresh();
    },
    onError,
  });

  const busy = disabled || request.isPending || addDocument.isPending || addVersion.isPending;
  const mutationError = request.error || addDocument.error || addVersion.error;

  return (
    <section className="space-y-3 border-t pt-4">
      <div>
        <h2 className="font-semibold">{t('deliverableDocuments')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('eachDocumentKeepsItsOwnVersionHistory')}
        </p>
      </div>
      <label className="block text-sm" htmlFor={`document-comment-${item.id}`}>
        {t('versionComment')}
      </label>
      <Input
        id={`document-comment-${item.id}`}
        value={comment}
        disabled={busy}
        maxLength={4000}
        onChange={(event) => setComment(event.target.value)}
        placeholder={t('optionalComment')}
      />
      <label className="block text-sm">
        {t('addDocuments')}
        <Input
          type="file"
          multiple
          disabled={busy}
          onChange={(event) => {
            if (event.target.files?.length) addDocument.mutate(event.target.files);
            event.target.value = '';
          }}
        />
      </label>
      {!active.length && (
        <p className="text-sm text-muted-foreground">{t('noDocumentYet')}</p>
      )}
      <div className="space-y-2">
        {active.map((document) => (
          <DocumentRow
            key={document.id}
            document={document}
            busy={busy}
            onView={() => setViewed(document)}
            onHistory={() => setHistory(document)}
            onDownload={() => void downloadVersion(base, item.id, document, document.versions.at(-1)!, onError)}
            onFile={(file) => addVersion.mutate({ document, file })}
            onSnapshot={() =>
              request.mutate({
                suffix: `/documents/${document.id}/versions`,
                body: {
                  path: document.sourcePath,
                  comment,
                  expectedVersion: document.currentVersionNumber,
                },
              })
            }
            onDelete={() => {
              if (window.confirm(t('deleteDocumentConfirmation', { name: document.name })))
                request.mutate({
                  suffix: `/documents/${document.id}`,
                  method: 'DELETE',
                  body: { expectedVersion: document.currentVersionNumber },
                });
            }}
          />
        ))}
      </div>
      {!!archived.length && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            {t('deletedDocuments')} ({archived.length})
          </summary>
          <div className="mt-2 space-y-2">
            {archived.map((document) => (
              <div key={document.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <span className="min-w-0 truncate">{document.name}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => request.mutate({
                    suffix: `/documents/${document.id}/restore`,
                    body: { expectedVersion: document.currentVersionNumber },
                  })}
                >
                  <RotateCcw className="h-4 w-4" /> {t('restore')}
                </Button>
              </div>
            ))}
          </div>
        </details>
      )}
      {mutationError && (
        <p role="alert" className="text-sm text-destructive">
          {mutationError instanceof Error && mutationError.message === 'filename'
            ? t('newVersionMustKeepTheSameFileName')
            : t('unableToUpdateDocument')}
        </p>
      )}

      <Dialog open={!!viewed} onOpenChange={(open) => !open && setViewed(null)}>
        <DialogContent className="flex h-[90dvh] max-w-[calc(100%-1rem)] flex-col p-0 sm:max-w-6xl">
          <DialogHeader className="px-4 pt-4">
            <DialogTitle>{viewed?.name}</DialogTitle>
            <DialogDescription>{t('documentViewerDescription')}</DialogDescription>
          </DialogHeader>
          {viewed && (
            <div className="min-h-0 flex-1 overflow-hidden border-t">
              <FileViewer filePath={viewed.sourcePath} viewId={`deliverable:${viewed.id}`} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!history} onOpenChange={(open) => !open && setHistory(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('documentVersionHistory', { name: history?.name })}</DialogTitle>
            <DialogDescription>{t('restoringCreatesANewVersion')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {history?.versions.slice().reverse().map((version) => (
              <div key={version.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>V{version.number}</strong>
                  <span className="text-xs text-muted-foreground">
                    {new Date(version.createdAt).toLocaleString()} · {version.authorName}
                  </span>
                </div>
                {version.comment && <p className="whitespace-pre-wrap text-sm">{version.comment}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => void downloadVersion(base, item.id, history, version, onError)}>
                    <Download className="h-4 w-4" /> {t('download')}
                  </Button>
                  {version.number !== history.currentVersionNumber && history.deletedAt === null && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => request.mutate({
                      suffix: `/documents/${history.id}/versions/${version.id}/restore`,
                      body: { expectedVersion: history.currentVersionNumber, comment },
                    })}>
                      <RotateCcw className="h-4 w-4" /> {t('restoreAsNewVersion')}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function DocumentRow({ document, busy, onView, onHistory, onDownload, onFile, onSnapshot, onDelete }: {
  document: DeliverableDocument;
  busy: boolean;
  onView: () => void;
  onHistory: () => void;
  onDownload: () => void;
  onFile: (file: File) => void;
  onSnapshot: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <article className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <strong className="block truncate">{document.name}</strong>
          <span className="text-xs text-muted-foreground">
            {t('versionNumber', { number: document.currentVersionNumber })} · {document.format.toUpperCase() || t('file')}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" onClick={onView}><Eye className="h-4 w-4" /> {t('open')}</Button>
          <Button size="sm" variant="outline" onClick={onDownload}><Download className="h-4 w-4" /> {t('download')}</Button>
          <Button size="sm" variant="outline" onClick={onHistory}><History className="h-4 w-4" /> {t('history')}</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onDelete}><Trash2 className="h-4 w-4" /><span className="sr-only">{t('delete')}</span></Button>
        </div>
      </div>
      <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-primary">
        <Upload className="h-4 w-4" /> {t('uploadNewVersion')}
        <input className="sr-only" type="file" disabled={busy} onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = '';
        }} />
      </label>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onSnapshot}>
        <History className="h-4 w-4" /> {t('createVersionFromCurrentFile')}
      </Button>
    </article>
  );
}

async function uploadFile(file: File, destinationPath: string, overwrite: boolean): Promise<string> {
  const form = new FormData();
  form.append('files', file, file.name);
  const authorization = getAuthorizationHeader();
  const response = await fetch(withBasePath(`/api/files/upload?destinationPath=${encodeURIComponent(destinationPath)}&overwrite=${overwrite}`), {
    method: 'POST',
    headers: authorization ? { Authorization: authorization } : {},
    body: form,
  });
  if (!response.ok) throw new Error('upload');
  const result = (await response.json()) as { files: Array<{ path: string }> };
  if (!result.files[0]?.path) throw new Error('upload');
  return result.files[0].path;
}

async function downloadVersion(base: string, deliverableId: string, document: DeliverableDocument, version: DeliverableDocumentVersion, onError: () => void) {
  try {
    const authorization = getAuthorizationHeader();
    const response = await fetch(withBasePath(`/api/projects${base}/${deliverableId}/documents/${document.id}/versions/${version.id}/file`), {
      headers: authorization ? { Authorization: authorization } : {},
    });
    if (!response.ok) throw new Error('download');
    const url = URL.createObjectURL(await response.blob());
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = version.fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    onError();
  }
}
