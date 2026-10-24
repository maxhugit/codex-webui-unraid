import { screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { catalogFixture } from './catalog/catalog.testing';
import { SettingsSaveBar } from './settings-save-bar';

let fixture: ReturnType<typeof catalogFixture>;
afterEach(() => fixture?.dispose());

it('does not show a save action for a clean general settings page', () => {
  fixture = catalogFixture();
  const onSave = vi.fn();
  const view = fixture.render(
    <SettingsSaveBar
      dirty={false}
      saving={false}
      onSave={onSave}
      hideWhenClean
      label="saveRuntimeSettings"
    />,
  );
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
  view.rerender(
    <SettingsSaveBar
      dirty
      saving={false}
      onSave={onSave}
      hideWhenClean
      label="saveRuntimeSettings"
    />,
  );
  expect(
    screen.getByRole('button', { name: 'Save runtime settings' }),
  ).toBeEnabled();
  expect(onSave).not.toHaveBeenCalled();
});

it('keeps the existing save bar behavior for other settings pages', () => {
  fixture = catalogFixture();
  fixture.render(
    <SettingsSaveBar dirty={false} saving={false} onSave={vi.fn()} />,
  );
  expect(screen.getByRole('region')).toBeVisible();
});
