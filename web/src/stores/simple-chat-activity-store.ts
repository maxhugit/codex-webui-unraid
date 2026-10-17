import { create } from 'zustand';

interface SimpleChatActivityState {
  activeThreadIds: ReadonlySet<string>;
  setThreadActive: (threadId: string, active: boolean) => void;
}

/**
 * Shares simple-chat request activity with navigation components.
 *
 * Unlike Codex threads, simple chats do not receive socket lifecycle events,
 * so their request state has to be published explicitly while the HTTP request
 * is in flight.
 */
export const useSimpleChatActivityStore = create<SimpleChatActivityState>(
  (set) => ({
    activeThreadIds: new Set(),
    setThreadActive: (threadId, active) =>
      set((state) => {
        const next = new Set(state.activeThreadIds);
        if (active) next.add(threadId);
        else next.delete(threadId);
        return { activeThreadIds: next };
      }),
  }),
);
