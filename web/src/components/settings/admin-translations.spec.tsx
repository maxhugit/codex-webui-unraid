/** Guard dynamic administration labels as well as the French screenshot regression. */
import { render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import fr from '@/locales/fr/common.json';
import { translationKey } from '@/locales/translation-key';
import { loadLocaleResources } from '@/locales';
import { FIELD_DEFS, GROUP_ORDER } from './codex-settings-defs';
import { ConfigFieldEditor } from './codex-settings-fields';
import { settingLabel } from './setting-helpers';

const DYNAMIC_CODEX_LABELS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
  'auto',
  'concise',
  'detailed',
  'disabled',
  'cached',
  'live',
  'workspace-write',
  'danger-full-access',
  'on-request',
  'never',
  'Sandbox Workspace Write',
  'user',
  'profile',
  'built-in',
  'system',
  'environment',
  'command line',
  'cli',
] as const;

describe('administration translations', () => {
  it('covers every structured Codex label, description and group in French', () => {
    for (const text of [
      ...GROUP_ORDER,
      ...FIELD_DEFS.flatMap((field) =>
        field.description ? [field.label, field.description] : [field.label],
      ),
      ...DYNAMIC_CODEX_LABELS,
    ]) {
      const key = translationKey(text);
      expect(fr, `Missing French translation: ${text}`).toHaveProperty(key);
    }
  });

  it('covers server setting labels without translating protocol keys', () => {
    for (const key of [
      'general.maxIdleSubscriptions',
      'general.onlyofficeUrl',
      'general.onlyofficeJwtSecret',
      'general.onlyofficeSaveMaxBytes',
      'general.publicBaseUrl',
      'terminal.maxSessions',
      'terminal.graceMs',
      'terminal.scrollback',
      'terminal.defaultCwd',
      'files.uploadMaxBytes',
      'files.excludedDirs',
      'security.workspaceRoots',
    ]) {
      const label = settingLabel(key);
      const translation = translationKey(label);
      expect(Object.hasOwn(fr, translation), key).toBe(true);
    }
  });

  it.each(['fr', 'en'])(
    'renders the instructions panel in %s and preserves its technical key',
    async (language) => {
      const i18n = createInstance();
      const resources = {
        en: await loadLocaleResources('en'),
        fr: await loadLocaleResources('fr'),
      };
      await i18n.init({
        lng: language,
        fallbackLng: 'en',
        ns: ['common'],
        defaultNS: 'common',
        resources,
      });
      const def = FIELD_DEFS.find(
        (field) => field.key === 'developer_instructions',
      )!;
      render(
        <I18nextProvider i18n={i18n}>
          <ConfigFieldEditor
            def={def}
            draft=""
            dirty={false}
            origin={null}
            overridden={false}
            saving={false}
            onDraftChange={vi.fn()}
            onSave={vi.fn()}
            onClear={vi.fn()}
          />
        </I18nextProvider>,
      );
      expect(
        screen.getByText(
          language === 'fr'
            ? 'Instructions développeur'
            : 'Developer Instructions',
        ),
      ).toBeVisible();
      expect(
        screen.getByText(
          language === 'fr'
            ? 'Consignes supplémentaires pour la session : langue, comportement et méthode de travail. Elles guident le modèle, mais ne constituent pas un contrôle des droits d’accès.'
            : 'Additional session-level instructions (language, behavior, working conventions). These guide the model but do not enforce access permissions.',
        ),
      ).toBeVisible();
      expect(
        screen.getByRole('button', {
          name: language === 'fr' ? 'Enregistrer' : 'Save',
        }),
      ).toBeVisible();
      if (language === 'fr')
        expect(screen.getByText('developer_instructions')).toBeVisible();
    },
  );
});
