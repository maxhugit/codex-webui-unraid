/**
 * Store-independent mutations publish confirmed changes to the application reconciler.
 * All file management UI surfaces delegate to this hook.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getApiErrorMessage } from '@/lib/api-error';
import { withBasePath } from '@/base-path';
import {
  filesCreateFileMutation,
  filesCreateDirectoryMutation,
  filesRenamePathMutation,
  filesCopyPathMutation,
  filesMovePathMutation,
  filesDeletePathMutation,
  filesReadTreeQueryKey,
  filesReadFileQueryKey,
  filesGetMetadataQueryKey,
} from '@/generated/api/@tanstack/react-query.gen';
import { showSnackbar } from '@/stores/snackbar-store';
import { clearApiToken, getAuthorizationHeader } from '@/auth-token';
import {
  beginFileMutation,
  emitFileChange,
  finishFileMutation,
} from '@/lib/file-change-events';

interface UploadFilesResponse {
  files: Array<{ path: string; size: number }>;
}

interface UploadFilesVariables {
  destinationPath: string;
  formData: FormData;
}

/** Invalidates the tree query for a specific directory. */
function treeKey(dir: string) {
  return filesReadTreeQueryKey({ query: { root: dir } });
}

/** Returns auth headers for direct fetch calls that bypass the generated client. */
function authHeaders(): HeadersInit {
  const authorization = getAuthorizationHeader();
  return authorization ? { Authorization: authorization } : {};
}

/** Mirrors the generated API client's auth-expiry behavior for direct fetch calls. */
function handleUnauthorized(status: number): void {
  if (status !== 401) return;
  clearApiToken();
  window.dispatchEvent(new Event('codex-webui:auth-expired'));
}

/** Extracts and translates the API error from direct fetch responses. */
function readApiError(errorBody: unknown, fallback: string): string {
  return getApiErrorMessage(errorBody, fallback);
}

export function useFileOperations() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  /** Invalidates tree queries for one or more parent directories. */
  const invalidateDirs = (...dirs: string[]) => {
    const unique = [...new Set(dirs)];
    for (const dir of unique) {
      void queryClient.invalidateQueries({ queryKey: treeKey(dir) });
    }
  };

  // Appearance is as confusing to a watcher as disappearance: an unbracketed
  // create lets a concurrent two-path batch resolve one path present and one
  // missing, which the reconciler reads as a rename that never happened.
  const createFile = useMutation({
    ...filesCreateFileMutation(),
    onMutate: beginFileMutation,
    onSettled: finishFileMutation,
    onSuccess: (_res, variables) => {
      emitFileChange({
        source: 'local',
        kind: 'invalidate',
        paths: [variables.body!.path],
      });
      showSnackbar(t('fileCreated'), 'success');
    },
  });

  const createDirectory = useMutation({
    ...filesCreateDirectoryMutation(),
    onMutate: beginFileMutation,
    onSettled: finishFileMutation,
    onSuccess: (_res, variables) => {
      emitFileChange({
        source: 'local',
        kind: 'invalidate',
        paths: [variables.body!.path],
      });
      showSnackbar(t('directoryCreated'), 'success');
    },
  });

  const renamePath = useMutation({
    ...filesRenamePathMutation(),
    onMutate: beginFileMutation,
    onSettled: finishFileMutation,
    onSuccess: (res) => {
      if (res.oldPath && res.newPath)
        emitFileChange({
          source: 'local',
          kind: 'rename',
          oldPath: res.oldPath,
          newPath: res.newPath,
        });
      showSnackbar(t('renamedSuccessfully'), 'success');
    },
  });

  const copyPath = useMutation({
    ...filesCopyPathMutation(),
    onMutate: beginFileMutation,
    onSettled: finishFileMutation,
    onError: (error) => showSnackbar(getApiErrorMessage(error), 'error'),
    onSuccess: (_res, variables) => {
      emitFileChange({
        source: 'local',
        kind: 'invalidate',
        paths: [variables.body!.destinationPath],
      });
      showSnackbar(t('copiedSuccessfully'), 'success');
    },
  });

  const movePath = useMutation({
    ...filesMovePathMutation(),
    onMutate: beginFileMutation,
    onSettled: finishFileMutation,
    onError: (error) => showSnackbar(getApiErrorMessage(error), 'error'),
    onSuccess: (res) => {
      if (res.oldPath && res.newPath)
        emitFileChange({
          source: 'local',
          kind: 'rename',
          oldPath: res.oldPath,
          newPath: res.newPath,
        });
      showSnackbar(t('movedSuccessfully'), 'success');
    },
  });

  const deletePath = useMutation({
    ...filesDeletePathMutation(),
    onMutate: beginFileMutation,
    onSettled: finishFileMutation,
    onError: (error) => showSnackbar(getApiErrorMessage(error), 'error'),
    onSuccess: (_res, variables) => {
      const deleted = variables.query!.path;
      emitFileChange({ source: 'local', kind: 'delete', path: deleted });
      showSnackbar(t('deletedSuccessfully'), 'success');
    },
  });

  /** Upload via direct fetch — SDK serializes body as JSON, multipart needs raw FormData. */
  const uploadFiles = useMutation<
    UploadFilesResponse,
    Error,
    UploadFilesVariables
  >({
    onMutate: () => {
      beginFileMutation();
      setUploadProgress(0);
    },
    onSettled: () => {
      finishFileMutation();
      window.setTimeout(() => setUploadProgress(null), 600);
    },
    mutationFn: ({ destinationPath, formData }) =>
      new Promise<UploadFilesResponse>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(
          'POST',
          `${withBasePath('/api/files/upload')}?destinationPath=${encodeURIComponent(destinationPath)}`,
        );
        const authorization = getAuthorizationHeader();
        if (authorization) xhr.setRequestHeader('Authorization', authorization);
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable || event.total <= 0) return;
          setUploadProgress(
            Math.min(99, Math.round((event.loaded / event.total) * 100)),
          );
        };
        xhr.onerror = () => reject(new Error(t('uploadFailed')));
        xhr.onload = () => {
          handleUnauthorized(xhr.status);
          let body: unknown;
          try {
            body = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
          } catch {
            body = undefined;
          }
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(
              new Error(
                readApiError(body, `${t('uploadFailed')}: ${xhr.status}`),
              ),
            );
            return;
          }
          setUploadProgress(100);
          resolve(body as UploadFilesResponse);
        };
        xhr.send(formData);
      }),
    onSuccess: (res, variables) => {
      emitFileChange({
        source: 'local',
        kind: 'invalidate',
        paths: [
          variables.destinationPath,
          ...res.files.map((file) => file.path),
        ],
      });
      showSnackbar(t('uploadComplete'), 'success');
    },
    onError: (err: Error) => {
      showSnackbar(getApiErrorMessage(err, t('uploadFailed')), 'error');
    },
  });

  /** Triggers a browser file download via authenticated fetch. */
  const downloadFile = async (filePath: string) => {
    try {
      const resp = await fetch(
        `${withBasePath('/api/files/download')}?path=${encodeURIComponent(filePath)}`,
        { headers: authHeaders() },
      );
      if (!resp.ok) {
        handleUnauthorized(resp.status);
        throw new Error(`Download failed: ${resp.status}`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filePath.split('/').pop() ?? 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      showSnackbar(t('downloadFailed'), 'error');
    }
  };

  /** Refreshes tree for a directory or file queries for a file. */
  const refresh = (entryPath: string, type: 'file' | 'directory') => {
    if (type === 'directory') {
      invalidateDirs(entryPath);
    } else {
      void queryClient.invalidateQueries({
        queryKey: filesReadFileQueryKey({ query: { path: entryPath } }),
      });
      void queryClient.invalidateQueries({
        queryKey: filesGetMetadataQueryKey({ query: { path: entryPath } }),
      });
    }
  };

  return {
    createFile,
    createDirectory,
    renamePath,
    copyPath,
    movePath,
    deletePath,
    uploadFiles,
    uploadProgress,
    downloadFile,
    refresh,
  };
}
