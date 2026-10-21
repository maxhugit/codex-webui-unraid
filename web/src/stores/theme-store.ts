/** Shared appearance state, cached locally and synchronized with the profile. */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const STORAGE_KEY = 'codex.webui.theme';

export const THEME_IDS = [
  'light',
  'dark',
  'sepia',
  'nord',
  'solarized',
  'dracula',
  'high-contrast',
] as const;
export type ThemeId = (typeof THEME_IDS)[number];

const DARK_THEMES = new Set<ThemeId>([
  'dark',
  'nord',
  'dracula',
  'high-contrast',
]);

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEME_IDS.includes(value as ThemeId);
}

function getInitialTheme(): ThemeId {
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', DARK_THEMES.has(theme));
  document.documentElement.style.colorScheme = DARK_THEMES.has(theme)
    ? 'dark'
    : 'light';
}

/** Migrate the two historical storage shapes before Zustand rehydrates. */
function migrateLegacyStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'dark' || raw === 'light') {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ state: { theme: raw }, version: 1 }),
      );
      return;
    }
    if (!raw) return;
    const parsed = JSON.parse(raw) as { state?: { dark?: boolean } };
    if (typeof parsed.state?.dark === 'boolean')
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          state: { theme: parsed.state.dark ? 'dark' : 'light' },
          version: 1,
        }),
      );
  } catch {
    // Storage can be unavailable in hardened browsers.
  }
}

migrateLegacyStorage();

interface ThemeState {
  theme: ThemeId;
  dark: boolean;
  setTheme: (theme: ThemeId) => void;
  setDark: (dark: boolean) => void;
  toggleDark: () => void;
}

const initialTheme = getInitialTheme();

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: initialTheme,
      dark: DARK_THEMES.has(initialTheme),
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme, dark: DARK_THEMES.has(theme) });
      },
      setDark: (dark) => get().setTheme(dark ? 'dark' : 'light'),
      toggleDark: () => get().setTheme(get().dark ? 'light' : 'dark'),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      partialize: (state) => ({ theme: state.theme }),
      merge: (persisted, current) => {
        const theme = isThemeId((persisted as { theme?: unknown })?.theme)
          ? (persisted as { theme: ThemeId }).theme
          : current.theme;
        return { ...current, theme, dark: DARK_THEMES.has(theme) };
      },
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
    },
  ),
);

applyTheme(useThemeStore.getState().theme);
