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

L'onglet **Connaissances** des paramètres du projet permet aux administrateurs de consulter et modifier les trois fichiers Markdown avec un seul bouton d'enregistrement. Le contenu de `.webui` reste consultable, mais réservé à l'application pour les écritures via l'API de fichiers générique. Les agents ne proposent pas encore d'ajouts soumis à validation : ce sera l'étape 3.

## Connaissance partagée entre conversations

Les fichiers sont relus dans le principal à chaque nouveau tour Codex et à chaque réponse OpenAI des conversations simples du projet. Le workspace actif reste inchangé, y compris pour une conversation dans un secondaire. Les agents sont rattachés par leur association explicite au projet ; les exécutions éphémères utilisent le rattachement du workspace. Les conversations simples OpenAI utilisent directement leur identifiant de projet.

Les changements enregistrés s'appliquent au prochain échange d'une conversation existante. Une réponse déjà en cours continue avec son instantané de départ. Un instantané vide précise au modèle que les anciennes connaissances ont été retirées. La connaissance reste du contexte de projet et ne remplace pas les règles de sécurité ni les instructions de priorité supérieure.

Les conversations Codex reçoivent un bloc de contexte utilisateur distinct, préfixé par `<project_shared_knowledge>`, avant le message envoyé. Ce bloc peut être conservé dans l'historique brut Codex ; WebUI le retire du texte affiché et éditable du message utilisateur. Les titres et aperçus de branches continuent à utiliser la demande originale. Les conversations simples OpenAI transmettent le contexte à l'API sans l'enregistrer comme un message de conversation.

Chaque fichier est limité à **32 Kio de texte UTF-8**. Les noms sont fixes : l'API n'accepte pas de chemin libre. Les liens symboliques vers les fichiers ou les dossiers système sont refusés. Un document supprimé peut être recréé par l'éditeur ; un dossier principal manquant doit être restauré.

L'enregistrement utilise l'empreinte SHA-256 des trois contenus chargés. Deux onglets ne peuvent pas écraser silencieusement leurs modifications : une version périmée reçoit une erreur de conflit. Le brouillon reste présent et **Recharger et abandonner les modifications** recharge les contenus du serveur. Les brouillons restent en mémoire pendant la session lorsque l'on change d'onglet, mais ne sont pas une sauvegarde persistante.

Le serveur sérialise les enregistrements d'un projet, prépare des fichiers temporaires et remplace chaque document par renommage. Les lectures des conversations attendent la fin de l'enregistrement ; une erreur de remplacement déclenche une restauration des contenus précédents. Cette coordination concerne une seule instance WebUI et ne remplace pas une sauvegarde face à une coupure système ou une modification simultanée directe sur le disque.

API dédiée, réservée aux administrateurs : `GET /api/projects/:id/knowledge` retourne `{ files, revision, path }` ; `PUT` sur la même URL accepte `{ files, revision }` et retourne l'instantané enregistré. Aucun dossier secondaire n'est copié ou modifié.

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
