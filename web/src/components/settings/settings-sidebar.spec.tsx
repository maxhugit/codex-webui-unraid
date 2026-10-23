import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsSidebar } from './settings-sidebar';
import { useLayoutStore } from '@/stores/layout-store';

const routing = vi.hoisted(() => ({
  navigate: vi.fn(),
  location: { pathname: '/settings', search: { section: 'general' } },
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => routing.navigate,
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: routing.location }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: globalThis.__testTranslate }),
}));

afterEach(cleanup);
beforeEach(() => {
  routing.navigate.mockClear();
  routing.location = { pathname: '/settings', search: { section: 'general' } };
  useLayoutStore.setState({ sidebarOpen: true });
});

it('separates server settings from operations and closes the mobile drawer on section selection', () => {
  render(<SettingsSidebar />);
  expect(screen.getByRole('heading', { name: 'Administration' })).toBeTruthy();
  expect(
    screen.getByRole('heading', { name: 'Operations tools' }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole('button', { name: 'Server general settings' })
      .getAttribute('aria-current'),
  ).toBe('page');
  fireEvent.click(screen.getByRole('button', { name: 'OnlyOffice' }));
  expect(routing.navigate).toHaveBeenCalledWith({
    to: '/settings',
    search: { section: 'onlyOffice' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'File settings' }));
  expect(routing.navigate).toHaveBeenCalledWith({
    to: '/settings',
    search: { section: 'files' },
  });
  expect(useLayoutStore.getState().sidebarOpen).toBe(false);
});

it('keeps global tools distinct from their configuration and supports returning to projects', () => {
  render(<SettingsSidebar />);
  fireEvent.click(screen.getByRole('button', { name: 'Files' }));
  expect(routing.navigate).toHaveBeenLastCalledWith({ to: '/files' });
  fireEvent.click(screen.getByRole('button', { name: 'Terminal' }));
  expect(routing.navigate).toHaveBeenLastCalledWith({ to: '/terminal' });
  fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
  expect(routing.navigate).toHaveBeenLastCalledWith({ to: '/diagnostics' });
  fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }));
  expect(routing.navigate).toHaveBeenLastCalledWith({ to: '/' });
});

it('marks the current operations tool rather than a settings category', () => {
  routing.location.pathname = '/files';
  render(<SettingsSidebar />);
  expect(
    screen.getByRole('button', { name: 'Files' }).getAttribute('aria-current'),
  ).toBe('page');
  expect(
    screen
      .getByRole('button', { name: 'File settings' })
      .getAttribute('aria-current'),
  ).toBeNull();
});
