# Workspaces des projets

Chaque projet possède un workspace principal permanent dans `/workspaces/<id-du-projet>/`. L'identifiant est immuable : renommer le projet modifie uniquement son nom affiché. La création du projet ne propose plus de chemin personnalisé ; les autres dossiers peuvent être rattachés ensuite comme workspaces secondaires.

| Notion     | Rôle                                                                     |
| ---------- | ------------------------------------------------------------------------ |
| Principal  | Dossier permanent appartenant au projet ; exactement un par projet       |
| Secondaire | Autre dossier rattaché au projet, détachable sans supprimer ses fichiers |
| Actif      | Dossier de travail choisi pour une conversation, principal ou secondaire |

Le choix du workspace actif d'une conversation ne change pas le principal du projet. Parcourir un dossier dans l'explorateur ne change pas non plus le contexte d'exécution de la conversation. Les nouvelles conversations utilisent initialement le principal.

## Organisation du principal

| Chemin relatif                         | Usage                                                  |
| -------------------------------------- | ------------------------------------------------------ |
| `.webui/project.json`                  | Marqueur de propriété et version de structure          |
| `.webui/knowledge/AGENTS.md`           | Emplacement réservé aux futures instructions partagées |
| `.webui/knowledge/CONNAISSANCES.md`    | Emplacement réservé aux connaissances                  |
| `.webui/knowledge/DECISIONS.md`        | Emplacement réservé aux décisions                      |
| `.webui/history/`                      | Emplacement réservé à l'historique applicatif          |
| `AGENTS.md`                            | Explication de l'organisation du dossier               |
| `documents/`, `sources/`, `livrables/` | Contenu de travail utilisateur                         |

Cette étape prépare les fichiers de connaissance. Elle n'implémente pas encore leur éditeur, leur injection dans les conversations secondaires ou la validation de propositions de mémoire. Le contenu de `.webui` est consultable, mais réservé à l'application pour les écritures via l'API de fichiers générique.

## Migration de l'existant

Au premier démarrage de cette version, les migrations SQL ajoutent `workspace_layout_version` et imposent au plus un workspace marqué principal par projet. Avant de démarrer les automatisations, le service projets migre les projets de version 0 :

1. Il crée `/workspaces/<id>/` et sa structure réservée.
2. Il conserve l'ancien dossier comme secondaire, en ajoutant son rattachement s'il manquait.
3. Une transaction remplace le chemin principal du projet, normalise les rôles et inscrit la version 1.

Aucun fichier existant n'est déplacé ou supprimé. Les chemins des conversations d'agents, des conversations simples et des tâches restent inchangés. Les conversations simples utilisant Codex exécutent désormais dans leur chemin conservé, plutôt que dans le nouveau principal.

La migration peut être relancée : les projets déjà en version 1 sont ignorés et les fichiers ne sont jamais écrasés. Un dossier préexistant sans marqueur de propriété correspondant bloque la migration, avec son chemin dans l'erreur, plutôt que d'être adopté. Une interruption après la préparation des fichiers mais avant la transaction peut être reprise grâce au marqueur. Une erreur arrête le démarrage ; corriger la collision ou les permissions puis relancer.

Un principal déjà migré qui disparaît du disque n'est pas recréé automatiquement : la réconciliation le signale comme non résolu et ne promeut aucun secondaire. Restaurer le dossier depuis la sauvegarde avant de reprendre les opérations concernées.

## Suppression et exploitation

Le principal ne peut pas être détaché, remplacé, renommé, déplacé ou supprimé seul via les API WebUI. Les opérations génériques sur un dossier parent qui supprimeraient le principal sont également refusées. Cette protection ne remplace pas les permissions système face à un accès direct au serveur.

La suppression confirmée du projet conserve le choix existant : préserver ses dossiers ou sélectionner ceux à supprimer physiquement, principal compris. Les secondaires détachés restent sur disque ; leurs conversations encore rattachées au projet basculent vers le principal.

Avant de déployer, sauvegarder la base et le volume `/workspaces` ensemble. Le stockage contenant `/workspaces` doit être persistant et accessible en écriture au serveur. Un retour vers une ancienne version nécessite la restauration cohérente de cette sauvegarde ; ne pas retirer seulement la colonne SQL.
