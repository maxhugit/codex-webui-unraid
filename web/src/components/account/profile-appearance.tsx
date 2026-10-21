import { Check, Globe, Palette } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  platformSessionKey,
  updateAuthResource,
  usePlatformSession,
  type PlatformSession,
} from '@/lib/platform-session';
import { THEME_IDS, useThemeStore, type ThemeId } from '@/stores/theme-store';

const THEME_SWATCHES: Record<ThemeId, [string, string, string]> = {
  light: ['#f8fafc', '#ffffff', '#172033'],
  dark: ['#111827', '#1f2937', '#93c5fd'],
  sepia: ['#f4ecd8', '#fffaf0', '#9a5b2e'],
  nord: ['#2e3440', '#3b4252', '#88c0d0'],
  solarized: ['#fdf6e3', '#eee8d5', '#268bd2'],
  dracula: ['#282a36', '#44475a', '#bd93f9'],
  'high-contrast': ['#000000', '#111111', '#ffff00'],
};

const THEME_LABELS: Record<ThemeId, string> = {
  light: 'Light',
  dark: 'Dark',
  sepia: 'Sepia',
  nord: 'Nord',
  solarized: 'Solarized',
  dracula: 'Dracula',
  'high-contrast': 'High contrast',
};

export function ProfileAppearance() {
  const { t, i18n } = useTranslation();
  const session = usePlatformSession();
  const queryClient = useQueryClient();
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const language = (i18n.resolvedLanguage ?? i18n.language).startsWith('fr')
    ? 'fr'
    : 'en';
  const save = useMutation({
    mutationFn: (preferences: { theme?: ThemeId; language?: 'en' | 'fr' }) =>
      updateAuthResource<{ theme: ThemeId; language: 'en' | 'fr' }>(
        'preferences',
        preferences,
      ),
    onSuccess: (preferences) => {
      queryClient.setQueryData<PlatformSession>(
        platformSessionKey,
        (current) => (current ? { ...current, ...preferences } : current),
      );
    },
  });

  const persist = (preferences: {
    theme?: ThemeId;
    language?: 'en' | 'fr';
  }) => {
    if (session.data?.kind === 'person') save.mutate(preferences);
  };

  const selectTheme = (next: ThemeId) => {
    setTheme(next);
    persist({ theme: next });
  };
  const selectLanguage = (next: 'en' | 'fr') => {
    void i18n.changeLanguage(next);
    persist({ language: next });
  };

  return (
    <section className="space-y-4 border-t border-border pt-4">
      <div className="flex items-center gap-2">
        <Palette className="h-4 w-4" />
        <h3 className="text-sm font-medium">{t('Appearance')}</h3>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {THEME_IDS.map((item) => {
          const colors = THEME_SWATCHES[item];
          const selected = theme === item;
          return (
            <button
              key={item}
              type="button"
              onClick={() => selectTheme(item)}
              className={cn(
                'relative cursor-pointer rounded-lg border p-2 text-left transition-colors hover:bg-accent',
                selected
                  ? 'border-primary ring-2 ring-primary/20'
                  : 'border-border',
              )}
              aria-pressed={selected}
            >
              <span className="mb-2 flex h-8 overflow-hidden rounded-md border border-black/10">
                {colors.map((color) => (
                  <span
                    key={color}
                    className="flex-1"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </span>
              <span className="text-xs font-medium">
                {t(THEME_LABELS[item])}
              </span>
              {selected && (
                <Check className="absolute right-2 top-2 h-3.5 w-3.5 text-primary" />
              )}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
        <div className="flex items-center gap-2 text-sm">
          <Globe className="h-4 w-4" />
          {t('Language')}
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={language === 'en' ? 'default' : 'outline'}
            onClick={() => selectLanguage('en')}
          >
            English
          </Button>
          <Button
            size="sm"
            variant={language === 'fr' ? 'default' : 'outline'}
            onClick={() => selectLanguage('fr')}
          >
            Français
          </Button>
        </div>
      </div>
      {save.isError && (
        <p className="text-xs text-destructive" role="alert">
          {t('Unable to save profile preferences')}
        </p>
      )}
    </section>
  );
}
