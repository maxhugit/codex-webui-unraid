# Mergeron Manager

Mergeron Manager est le futur gestionnaire local de la pile Docker Mergeron. Il
doit à terme installer, mettre à jour, surveiller et réparer les trois
conteneurs de la plateforme. Son déploiement est séparé de l'application afin
qu'une panne ou une mise à jour de `mergeron-ui` ne supprime jamais le composant
chargé de l'observer.

## Première étape : observation sans modification

La première version du Manager est volontairement en mode `observe`. Elle :

- inventorie `mergeron-ui`, `mergeron-ingress` et `mergeron-squid` avec l'API
  Docker locale ;
- reconnaît aussi les anciens noms `mergeron`, `codex-webui`,
  `codex-web-ingress` et `codex-web-squid` ;
- contrôle l'état, la santé, l'image et les réseaux de chaque conteneur ;
- vérifie que `/home/codex` et `/workspaces` restent montés depuis un stockage
  persistant ;
- expose son résultat à l'application par un socket Unix local ;
- accepte une seule écriture locale : l'enregistrement explicite de l'empreinte
  d'une installation existante.

Cette étape ne crée, ne redémarre, ne renomme et ne supprime aucun conteneur,
réseau, volume ou fichier. Une installation existante reconnue apparaît comme
« adoptable », mais reste entièrement sous le contrôle de son mode
d'installation actuel.

L'image est publiée séparément sous
`ghcr.io/maxhugit/mergeron-manager`. Elle suit les mêmes tags `edge`,
`sha-<commit>`, `0.x.y`, `0.x` et `latest` que l'application, mais son cycle de
vie reste indépendant de `mergeron-ui`. Avant la première publication stable,
les formulaires utilisent `edge` ; `latest` n'est jamais inventé à partir d'une
construction non publiée.

## Barrières contre la perte de données

Le manifeste `manager/stack-manifest.json` décrit les composants acceptés, les
anciens noms, les réseaux attendus et les montages protégés. Le Manager bloque
toute future prise en charge si :

- plusieurs conteneurs correspondent au même composant ;
- le montage persistant de `/home/codex` est absent ou en lecture seule ;
- le montage persistant de `/workspaces` est absent ou en lecture seule.

Le chemin source réel de chaque montage est affiché dans les réglages généraux
du serveur. Les données ne seront jamais copiées vers un nouveau volume de
manière implicite. Une future adoption devra conserver exactement ces sources
et demander une sauvegarde vérifiée avant la première opération destructive.

## Isolation

Le Manager n'ouvre aucun port TCP. Il publie uniquement
`/run/mergeron-manager/manager.sock`, lisible par le groupe de l'application.
Le backend Mergeron relaie l'inventaire aux seuls administrateurs via
`GET /api/settings/manager/status`.

L'accès à `/var/run/docker.sock` donne techniquement des droits élevés sur
l'hôte. L'image du Manager doit donc rester minimale, ne recevoir aucun accès
Internet entrant et ne contenir aucun outil client arbitraire. Dans cette
première étape, son client Docker n'implémente que deux appels `GET` : liste et
inspection des conteneurs.

Les installations Compose et DockerMan montent le socket dans
`STATE_ROOT/manager-run`. Ce dossier ne contient aucune donnée métier. Le
Manager fonctionne sans réseau Docker (`network_mode: none`) et reçoit le socket
Docker en lecture seule. Son client Docker ne sait émettre que les deux requêtes
`GET` d'inventaire. L'enregistrement d'adoption est conservé séparément dans
`STATE_ROOT/manager-state/adoption.json`.

## Adoption d'une installation existante

L'adoption ne modifie pas Docker. Après confirmation d'un administrateur, le
Manager enregistre exactement les identifiants des trois conteneurs, leurs
images, leurs réseaux et les sources des montages persistants. L'opération est
refusée si un composant est absent ou ambigu, si une image n'est pas autorisée,
si un réseau requis manque ou si `/home/codex` et `/workspaces` ne sont pas des
montages persistants accessibles en écriture.

L'interface transmet l'empreinte SHA-256 de l'aperçu affiché. Le Manager relit
Docker au moment de la confirmation et refuse l'adoption si cette empreinte a
changé. Le fichier est créé une seule fois avec des permissions `0600`. Une
différence ultérieure entre Docker et l'enregistrement passe l'installation en
état « dérive » et bloque toute future gestion automatique.

## Production et recette isolées

`MERGERON_STACK_ENVIRONMENT` déclare explicitement `production` ou
`development`. `MERGERON_STACK_PREFIX` sélectionne exclusivement les
conteneurs et réseaux à observer. Une recette utilise un préfixe dédié, par
exemple `mergeron-dev`, avec son propre `STATE_ROOT`, son propre sous-réseau
administratif et ses conteneurs préfixés. Le Manager refuse une pile
`development` qui réutilise le préfixe de production. Les anciens noms ne sont
reconnus que pour la pile `production` portant le préfixe canonique, afin qu'un
Manager de recette ne puisse jamais adopter un conteneur historique de
production.

Le domaine public ne participe jamais à la sélection des conteneurs. Il est
fourni séparément par `MERGERON_WEBUI_URL` dans le fichier d'environnement et
transmis à l'application sous `MERGERON_PUBLIC_URL`. Le dépôt ne contient donc
aucun domaine propre à une installation.

## Étapes suivantes

L'installation complète sera ajoutée par incréments contrôlés :

1. première installation idempotente des trois conteneurs et de leurs réseaux ;
2. mise à jour transactionnelle avec sauvegarde, contrôle de santé et retour
   automatique à l'image précédente ;
3. réparation limitée aux conteneurs et réseaux déclarés dans le manifeste.

Les volumes ou dossiers persistants ne feront pas partie d'une suppression ou
d'un retour arrière automatique.
