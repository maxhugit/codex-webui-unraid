import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { useFilesStore } from '@/stores/files-store';

export const FileBrowserContext = createContext(useFilesStore);

export function useFileBrowserStoreApi() {
  return useContext(FileBrowserContext);
}

export function useFileBrowserState<T>(
  selector: (state: ReturnType<typeof useFilesStore.getState>) => T,
) {
  return useStore(useFileBrowserStoreApi(), selector);
}
