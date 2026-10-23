/** Stable names shared by workspace creation, file guards and project modules. */
export const WORKSPACE_LAYOUT_VERSION = 2;
export const PROJECT_SYSTEM_DIRECTORY = '.mergeron';
export const LEGACY_PROJECT_SYSTEM_DIRECTORY = '.webui';
export const PROJECT_CONTENT_DIRECTORIES = [
  'documents',
  'sources',
  'livrables',
] as const;

export const PROJECT_WORKSPACE_INSTRUCTIONS =
  '# Organisation du projet\n\nLes fichiers réservés à Mergeron sont dans `.mergeron/`. Les documents de travail peuvent être rangés dans `documents/`, `sources/` et `livrables/`.\n\nLes instructions, connaissances et décisions partagées sont gérées depuis l’onglet Connaissances du projet et stockées dans `.mergeron/knowledge/`. Mergeron les fournit aux conversations à chaque nouvel échange.\n';

/** Only this exact generated text may be replaced during migration. */
export const LEGACY_PROJECT_WORKSPACE_INSTRUCTIONS =
  '# Organisation du projet\n\nLes fichiers réservés à WebUI sont dans `.webui/`. Les documents de travail peuvent être rangés dans `documents/`, `sources/` et `livrables/`.\n\nLes instructions, connaissances et décisions partagées sont gérées depuis l’onglet Connaissances du projet et stockées dans `.webui/knowledge/`. WebUI les fournit aux conversations à chaque nouvel échange.\n';
