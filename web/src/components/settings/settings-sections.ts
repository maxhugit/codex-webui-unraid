export const SETTINGS_SECTIONS = [
  'general',
  'people',
  'account',
  'codex',
  'codexCli',
  'simpleChat',
  'terminal',
  'files',
  'database',
  'security',
  'integrations',
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
