import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileRefresh, isAtScrollStart } from './mobile-refresh';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/stores/document-store', () => ({
  useDocumentStore: { getState: () => ({ documents: {} }) },
}));
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function pull(target: Element) {
  fireEvent.touchStart(target, { touches: [{ clientX: 20, clientY: 20 }] });
  fireEvent.touchMove(target, { touches: [{ clientX: 20, clientY: 210 }] });
}
it('requires all nested scroll containers to be at the top', () => {
  const parent = document.createElement('div');
  const child = parent.appendChild(document.createElement('div'));
  expect(isAtScrollStart(child)).toBe(true);
  parent.scrollTop = 20;
  expect(isAtScrollStart(child)).toBe(false);
});
it('shows release feedback and cancels without reloading', () => {
  render(
    <>
      <MobileRefresh />
      <main data-testid="page" />
    </>,
  );
  pull(screen.getByTestId('page'));
  expect(screen.getByRole('status').textContent).toContain('Release');
  fireEvent.touchCancel(document);
  expect(screen.queryByRole('status')).toBeNull();
});
it('retains the safety lock after an edited form has disappeared', () => {
  const view = render(
    <>
      <MobileRefresh />
      <textarea aria-label="draft" />
      <main data-testid="page" />
    </>,
  );
  fireEvent.input(screen.getByLabelText('draft'), {
    target: { value: 'draft' },
  });
  view.rerender(
    <>
      <MobileRefresh />
      <main data-testid="page" />
    </>,
  );
  pull(screen.getByTestId('page'));
  expect(screen.getByRole('status').textContent).toContain('blocked');
  fireEvent.touchEnd(document);
});
it('ignores upward or horizontal gestures and touches in editable fields', () => {
  render(
    <>
      <MobileRefresh />
      <textarea aria-label="draft" />
      <main data-testid="page" />
    </>,
  );
  pull(screen.getByLabelText('draft'));
  expect(screen.queryByRole('status')).toBeNull();
  const page = screen.getByTestId('page');
  fireEvent.touchStart(page, { touches: [{ clientX: 20, clientY: 200 }] });
  fireEvent.touchMove(page, { touches: [{ clientX: 20, clientY: 10 }] });
  expect(screen.queryByRole('status')).toBeNull();
});
