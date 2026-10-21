import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryProposalMessage } from './memory-proposal-message';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: globalThis.__testTranslate }),
}));
afterEach(cleanup);
it('renders a human-readable suggestion instead of the transport JSON', () => {
  render(
    <MemoryProposalMessage
      completed
      text={JSON.stringify({
        title: 'A decision',
        file: 'DECISIONS.md',
        text: 'Use immutable IDs',
        baseRevision: 'internal-revision',
      })}
    />,
  );
  expect(screen.getByText('Use immutable IDs')).toBeInTheDocument();
  expect(screen.getByText(/only updated after acceptance/)).toBeInTheDocument();
  expect(screen.queryByText(/internal-revision/)).not.toBeInTheDocument();
});
it('handles partial streaming JSON without claiming that a proposal is saved', () => {
  render(<MemoryProposalMessage completed={false} text="{" />);
  expect(screen.getByText('Preparing memory suggestion…')).toBeInTheDocument();
});
