/** Shared client-side change stream for local mutations and app-server watch events. */

export type FilePathChange =
  | {
      source: 'local' | 'external';
      kind: 'rename';
      oldPath: string;
      newPath: string;
    }
  | { source: 'local' | 'external'; kind: 'delete'; path: string }
  | { source: 'local' | 'external'; kind: 'invalidate'; paths: string[] };

export type FileChange =
  | FilePathChange
  | { source: 'local' | 'external'; kind: 'batch'; changes: FilePathChange[] };

/** Exposes atomic facts to selection/expansion owners while cache repair batches them. */
export function filePathChanges(change: FileChange): FilePathChange[] {
  return change.kind === 'batch' ? change.changes : [change];
}

type Listener = (change: FileChange) => void;
const listeners = new Set<Listener>();
const LOCAL_DELETE_GRACE_MS = 10_000;
const recentLocalDeletes = new Map<string, number>();

/** Subscribes to confirmed or externally observed file changes. */
export function subscribeFileChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Publishes one normalized change without retaining history in the browser. */
export function emitFileChange(change: FileChange): void {
  if (change.source === 'local') {
    for (const fact of filePathChanges(change))
      if (fact.kind === 'delete')
        recentLocalDeletes.set(fact.path, Date.now() + LOCAL_DELETE_GRACE_MS);
  }
  for (const listener of listeners) listener(change);
}

/** Ignores delayed watcher echoes for deletions already confirmed by this client. */
export function isRecentLocalDelete(filePath: string): boolean {
  const now = Date.now();
  for (const [deletedPath, expiresAt] of recentLocalDeletes) {
    if (expiresAt <= now) {
      recentLocalDeletes.delete(deletedPath);
      continue;
    }
    if (pathIsWithin(filePath, deletedPath)) return true;
  }
  return false;
}

/** Returns the parent path using the same absolute-path convention as the API. */
export function parentFilePath(filePath: string): string {
  return filePath.substring(0, filePath.lastIndexOf('/')) || '/';
}

/** Matches a path component rather than an arbitrary string prefix. */
export function pathIsWithin(path: string, parent: string): boolean {
  return (
    path === parent ||
    path.startsWith(parent === '/' ? '/' : `${parent.replace(/\/$/, '')}/`)
  );
}

/** Remaps an exact path or a complete descendant subtree. */
export function remapFilePath(
  path: string,
  oldPath: string,
  newPath: string,
): string | null {
  if (!pathIsWithin(path, oldPath)) return null;
  return `${newPath}${path.slice(oldPath.length)}`;
}

let pendingMutations = 0;
let mutationEpoch = 0;
const mutationWaiters = new Set<() => void>();

/** Orders native observations after locally pending mutation acknowledgements. */
export function beginFileMutation(): void {
  pendingMutations += 1;
  mutationEpoch += 1;
}

/** Releases observers only after the mutation's normalized result has been published. */
export function finishFileMutation(): void {
  pendingMutations -= 1;
  mutationEpoch += 1;
  if (pendingMutations) return;
  for (const resolve of mutationWaiters) resolve();
  mutationWaiters.clear();
}

/** Reads an observation epoch to reject metadata sampled across a local mutation. */
export function fileMutationEpoch(): number {
  return mutationEpoch;
}

/** Native file watches may report disappearance before REST confirms a rename. */
export function waitForFileMutations(): Promise<void> {
  if (!pendingMutations) return Promise.resolve();
  return new Promise((resolve) => mutationWaiters.add(resolve));
}
