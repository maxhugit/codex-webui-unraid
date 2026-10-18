import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  TaskManagerToolbar,
  type TaskManagerView,
} from './task-manager-toolbar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
afterEach(cleanup);
function setup() {
  const onPlan = vi.fn();
  const onNewTask = vi.fn();
  const onSettings = vi.fn();
  function Harness() {
    const [view, setView] = useState<TaskManagerView>('board');
    return (
      <TaskManagerToolbar
        view={view}
        onViewChange={setView}
        panelId="tasks"
        onPlan={onPlan}
        onNewTask={onNewTask}
        onSettings={onSettings}
      />
    );
  }
  render(<Harness />);
  return { onPlan, onNewTask, onSettings };
}
it('separates the four views from the three actions', () => {
  setup();
  const tabs = screen.getByRole('tablist', { name: 'Task manager views' });
  expect(within(tabs).getAllByRole('tab')).toHaveLength(4);
  expect(within(tabs).queryByRole('button')).toBeNull();
  expect(screen.getByRole('tab', { name: 'Board' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByRole('tab', { name: 'Board' })).toHaveAttribute(
    'aria-controls',
    'tasks',
  );
});
it('changes views with mouse and keyboard without invoking an action', () => {
  const { onPlan } = setup();
  fireEvent.click(screen.getByRole('tab', { name: 'Planning' }));
  expect(screen.getByRole('tab', { name: 'Planning' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  screen.getByRole('tab', { name: 'Planning' }).focus();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Journal' })).toHaveFocus();
  expect(screen.getByRole('tab', { name: 'Journal' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  expect(screen.getByRole('tab', { name: 'Advice' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(onPlan).not.toHaveBeenCalled();
});
it('keeps every tool accessible even when mobile labels are hidden', () => {
  const { onPlan, onNewTask, onSettings } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Plan with AI' }));
  fireEvent.click(screen.getByRole('button', { name: 'New task' }));
  fireEvent.click(screen.getByRole('button', { name: 'Task board settings' }));
  expect(onPlan).toHaveBeenCalledOnce();
  expect(onNewTask).toHaveBeenCalledOnce();
  expect(onSettings).toHaveBeenCalledOnce();
});
