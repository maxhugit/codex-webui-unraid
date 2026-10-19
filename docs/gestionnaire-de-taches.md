# Gestionnaire de tâches

Ce guide décrit le fonctionnement implémenté dans le dépôt : organisation des
tâches, planning, assistance IA et exécution des sous-tâches par Codex.

## Organisation dans un projet

Un projet regroupe des espaces de travail et des ressources. Le gestionnaire
est une ressource de type `task_board` ; un projet peut en posséder plusieurs.
Chaque tableau possède ses propres tâches, statuts, dépendances, paramètres
et journal. Le gestionnaire d’automatisations est une autre ressource
(`automation_board`), distincte du tableau de tâches.

Pour commencer :

1. Ajouter un gestionnaire de tâches au projet.
2. Définir les tâches principales et leur dossier de travail.
3. Ajouter des sous-tâches manuelles ou exécutables par un agent.
4. Renseigner les dates, estimations, responsables et critères de validation.
5. Suivre le tableau ou le planning, puis contrôler les résultats des agents.

## Tâches et sous-tâches

Une tâche contient un titre, une description, une priorité, un responsable
facultatif, des labels, un avancement de 0 à 100 %, une estimation et des
dates facultatives. Elle peut aussi préciser des conditions de validation.

| Élément | Tâche principale | Sous-tâche |
| --- | --- | --- |
| Organisation | Colonne du tableau | Rattachée à une tâche principale |
| Exécution | Manuelle | Manuelle ou agent Codex |
| Priorité et dossier | Choisis sur la tâche | Hérités du parent |
| Dépendances | Autres tâches principales du même tableau | Non prises en charge |
| Fichier lié | Possible | Pas de fichier lié propre |
| Niveau inférieur | Sous-tâches | Aucun niveau supplémentaire |

Un responsable doit être une personne active ajoutée aux participants du projet.
Retirer un participant ne supprime pas ses affectations historiques.

Le dossier d’une tâche doit appartenir à un espace de travail du projet ou se
trouver dans un de ses sous-dossiers. Sans dossier explicite, le lancement
de l’agent utilise celui du projet.

### Statuts

Les colonnes créées initialement sont :

- Actions non assignées ;
- À faire ;
- En cours ;
- Bloqué ;
- À valider ;
- Terminé.

La colonne système « Actions non assignées » ne peut pas être supprimée.
Les autres colonnes peuvent être personnalisées. Supprimer une colonne
replace ses tâches dans la colonne système.

Les sous-tâches ont des états fixes : À faire (`todo`), Commencée
(`started`), À valider (`review`), Terminée (`done`) et Annulée
(`cancelled`). Leurs couleurs sont personnalisables, mais leurs états finaux
restent Terminée et Annulée.

Les statuts finaux des tâches principales sont configurables ; par défaut,
il s’agit des colonnes dont le type interne est `done`. Le serveur refuse de
placer un parent dans un statut final tant qu’une sous-tâche n’est ni terminée
ni annulée. La fin des sous-tâches ne déplace pas automatiquement le parent
dans une colonne finale.

### Estimation et avancement

Les estimations sont stockées en minutes et saisies ou affichées en heures.

Pour un parent ayant des sous-tâches :

- sa charge est la somme des estimations des sous-tâches ;
- son avancement est la moyenne arithmétique de leurs pourcentages, arrondie ;
- cette moyenne n’est pas pondérée par les estimations ;
- son avancement ne se modifie pas directement.

Exemple : deux sous-tâches estimées à 1 h et 9 h, avancées à 100 % et 0 %,
donnent un parent de 10 h avancé à 50 %.

Passer une sous-tâche à Terminée ou Annulée fixe son avancement à 100 %.
Ce pourcentage représente donc aussi la clôture, pas uniquement du travail
réalisé. Supprimer la dernière sous-tâche remet les agrégats du parent à zéro.

## Les quatre vues

| Vue | Utilisation |
| --- | --- |
| Conseils | Analyse du tableau et proposition de travail selon le temps disponible |
| Tableau | Cartes par statut, sous-tâches, recherche, filtre de priorité et déplacement des cartes |
| Planning | Gantt des tâches et sous-tâches datées, liens de dépendance et modification du planning |
| Journal | Créations, modifications et suppressions, avec valeurs avant/après pour les changements enregistrés |

La recherche du tableau porte sur le titre, la description et les labels des
tâches principales. Le tableau est relu toutes les cinq secondes.

Le Gantt propose plusieurs échelles de temps et un ajustement à la période.
Ses liens sont de type fin-vers-début. Les changements de dates et de
dépendances sont persistés par l’API.

### Dates et dépendances

Une date de début ne peut pas être postérieure à la date de fin. Les dates
renseignées d’une sous-tâche doivent rester dans les bornes renseignées du
parent. Réduire ces bornes peut donc être refusé si une sous-tâche les dépasse.

Les dépendances restent dans le même tableau, entre tâches principales ;
les cycles sont refusés. L’interface affiche une dépendance bloquante si un
prédécesseur n’est pas dans un statut final. Il s’agit d’un suivi du planning :
les dépendances ne constituent pas un ordonnanceur lançant les agents.

## Assistance IA à la planification

Ces fonctions passent par `SimpleChatService` et l’API OpenAI
(`/v1/responses`), avec le modèle du chat simple. Elles nécessitent sa clé API ;
l’authentification du CLI Codex par un compte ChatGPT ne suffit pas à elle seule.

| Fonction | Résultat |
| --- | --- |
| Générer un plan | Propositions de tâches, sous-tâches, estimations et dépendances à partir d’une demande |
| Découper une tâche | Jusqu’à dix propositions de sous-tâches, avec mode manuel ou agent et conditions de validation |
| Replanifier | Propositions de priorité, charge, dates et dépendances des tâches principales existantes |
| Conseils | Analyse de santé, alertes et recommandations |
| Travail selon disponibilité | Sélection proposée avec temps recommandé, pour une disponibilité supérieure à 0 et au plus 168 h |

Les propositions de création et de replanification sont présentées avant
application. L’utilisateur peut les examiner ; les tâches à replanifier peuvent
être sélectionnées. Les conseils n’exécutent pas les tâches.

Le découpage limite les labels proposés à ceux configurés dans le tableau et
ne crée pas de dépendances entre sous-tâches. Pour un parent déjà découpé, la
replanification conserve la charge calculée depuis ses enfants.

L’application d’un ensemble de propositions effectue plusieurs appels
successifs. Une erreur peut laisser les premières modifications enregistrées :
relire le tableau avant de recommencer.

## Exécution par un agent Codex

Seules les sous-tâches peuvent être confiées à un agent. Le lancement depuis
l’interface suit ces étapes :

1. Enregistrer la sous-tâche.
2. Créer une conversation Codex dans son dossier de travail.
3. Associer cette conversation au projet.
4. Lier son identifiant à la sous-tâche, avec l’état agent `running` et le
   statut de sous-tâche `started`.
5. Envoyer le titre, la description, l’estimation et les conditions de validation.
6. Ouvrir la conversation pour suivre le travail.

Les instructions demandent à l’agent de résumer son travail et ses
vérifications sans se déclarer définitivement validé. La restriction de
dossier écrite dans le message ne remplace pas les protections du moteur.

À la lecture du tableau, le serveur synchronise les agents en cours ou en
attente avec les métadonnées des conversations :

| État observé | État du gestionnaire |
| --- | --- |
| Conversation active | `running` |
| Attente d’approbation ou de réponse utilisateur | `waiting` |
| Conversation devenue inactive | `review`, sous-tâche À valider |
| Échec du lancement dans l’interface | `error` |

Un agent inactif ne prouve pas que le résultat est correct : la revue reste
nécessaire. L’avancement n’est pas calculé à partir des messages de Codex.

### Validation et suppression

L’action de validation envoie `agentState: validated` et
`subtaskStatus: done`. Si une conversation agent est liée, le serveur
vérifie qu’elle peut être supprimée puis la supprime via
`ThreadsDeletionService`. Le lien est retiré de la sous-tâche. Si cette
suppression ne peut pas être effectuée, la validation est refusée.

Il faut donc consulter et conserver les éléments utiles du résultat avant de
valider : la conversation de travail n’est pas un historique permanent.

Supprimer une tâche supprime aussi ses sous-tâches et traite les conversations
agents liées par le même mécanisme de suppression contrôlée. Le journal du
tableau conserve les entrées de suppression.

## Paramètres et droits d’accès

Les paramètres du tableau sont enregistrés dans
`project_resources.config.taskBoardSettings` : priorités, labels, couleurs,
statut et priorité par défaut, colonnes vides masquées, statuts finaux et
confirmation de suppression.

Le statut choisi par défaut dans l’interface est appliqué après création :
l’API crée d’abord une tâche principale dans « Actions non assignées ».

Les routes sont soumises à `PlatformAccessGuard`. Dans cette version, les
écritures sur les personnes, les automatisations et les routes d’exécution
`/threads` exigent un administrateur. Le lancement d’un agent depuis le
gestionnaire utilise ces routes : le tableau ne contourne donc pas cette
restriction pour un utilisateur standard. Les chemins sont également contrôlés
par la politique d’accès aux espaces de travail.

## Stockage et maintenance

Les données du gestionnaire sont persistées dans SQLite, via Drizzle :

- `projects`, `project_resources`, `project_workspaces` ;
- `project_tasks`, `project_task_statuses` ;
- `project_task_dependencies`, `project_task_activity` ;
- `people`, `project_participants`, `project_agent_threads`.

Le chemin de base est donné par `WEBUI_DB_PATH`, sinon par
`CODEX_HOME/codex-webui.sqlite`, sinon par
`~/.codex/codex-webui.sqlite`. Les migrations du dossier `drizzle/` sont
appliquées au démarrage. Pour sauvegarder les tâches, préserver cette base
selon la [procédure de sauvegarde](sauvegarde-restauration.md), ainsi que les
fichiers des espaces de travail et les données Codex utiles.

Le journal retrace les opérations enregistrées par le service ; toutes les
synchronisations internes ne créent pas une entrée. Il ne constitue pas un
journal d’audit exhaustif des actions de chaque utilisateur.

## Repères dans le code

| Fichier | Responsabilité |
| --- | --- |
| [Interface du gestionnaire](../web/src/components/projects/project-task-manager.tsx) | Vues, formulaires, Gantt, propositions IA et lancement des agents |
| [Gantt](../web/src/components/projects/stable-project-gantt.tsx) | Intégration du composant de planning |
| [Types et client HTTP](../web/src/lib/projects-api.ts) | Contrats côté navigateur |
| [Contrôleur](../src/projects/projects.controller.ts) | Routes sous `/api/projects` |
| [Service projets](../src/projects/projects.service.ts) | Validation, persistance, agrégats, dépendances et synchronisation des agents |
| [Service chat simple](../src/simple-chat/simple-chat.service.ts) | Appels IA de planification et de conseil |
| [Schéma SQLite](../src/database/schema.ts) | Tables et relations |
| [Contrôle d’accès](../src/auth/platform-access.guard.ts) | Autorisations des routes |

Les routes du tableau partagent le préfixe
`/api/projects/:id/resources/:resourceId` :

| Méthode et suffixe | Fonction |
| --- | --- |
| `GET /` | Lire le tableau, synchroniser les agents et recalculer les parents |
| `POST /tasks` | Créer une tâche ou sous-tâche |
| `PATCH /tasks/:taskId` | Modifier, lier une conversation ou valider |
| `DELETE /tasks/:taskId` | Supprimer une tâche et ses sous-tâches |
| `POST /statuses`, `PATCH/DELETE /statuses/:statusId` | Gérer les colonnes |
| `POST /ai-plan` | Proposer un plan |
| `POST /ai-replan` | Proposer une replanification |
| `POST /ai-advice` | Obtenir analyse ou sélection de travail |
| `POST /tasks/:taskId/ai-subtasks` | Proposer un découpage |
| `PATCH /` | Modifier la ressource et ses paramètres |
