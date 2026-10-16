import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatHeader } from './chat-header';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useTimelineStore } from '@/stores/timeline-store';

let pathname = '/simple-chat';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname } }),
}));

vi.mock('@/hooks/use-breakpoint', () => ({
  useBreakpoint: () => 'desktop',
  useIsMobile: () => false,
}));

vi.mock('@/hooks/use-message-branches', () => ({
  useMessageVersions: () => ({ isTracked: false }),
}));

vi.mock('./account-rate-limit-badge', () => ({
  AccountRateLimitBadge: () => null,
}));

vi.mock('./mcp-status-badge', () => ({
  McpStatusBadge: () => null,
}));

function renderHeader() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <ChatHeader
          dark={false}
          onToggleDark={vi.fn()}
          onToggleDiagnostics={vi.fn()}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe('ChatHeader', () => {
  beforeEach(() => {
    pathname = '/simple-chat';
    useTimelineStore.getState().setActiveThread('thread-123', '/workspaces/demo', 'Titre conservé');
  });

  it('does not leak the cached Codex thread title into Simple Chat', () => {
    renderHeader();

    expect(screen.getByRole('heading', { name: 'Codex WebUI' })).toBeInTheDocument();
    expect(screen.queryByText('Titre conservé')).not.toBeInTheDocument();
  });

  it('shows the active title on an actual Codex thread route', () => {
    pathname = '/t/thread-123';
    renderHeader();

    expect(screen.getByText('Titre conservé')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Codex WebUI' })).not.toBeInTheDocument();
  });
});
