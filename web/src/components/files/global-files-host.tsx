import { lazy, Suspense, useState } from 'react';
import { useGlobalFilesStore } from '@/stores/files-store';
import { FileBrowserContext } from './file-browser-context';

const FilesPanel = lazy(() =>
  import('./files-panel').then((module) => ({ default: module.FilesPanel })),
);

/** Retains browser/editor DOM and scroll offsets until logout, not just paths. */
export function GlobalFilesHost({ active }: { active: boolean }) {
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  if (!visited && !active) return null;
  return (
    <div
      data-global-files-host
      hidden={!active}
      inert={!active}
      aria-hidden={!active}
      className={active ? 'flex min-h-0 flex-1' : 'hidden'}
    >
      <FileBrowserContext.Provider value={useGlobalFilesStore}>
        <Suspense fallback={null}>
          <FilesPanel active={active} />
        </Suspense>
      </FileBrowserContext.Provider>
    </div>
  );
}
