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
- refuse toutes les requêtes autres que `GET`.

Cette étape ne crée, ne redémarre, ne renomme et ne supprime aucun conteneur,
réseau, volume ou fichier. Une installation existante reconnue apparaît comme
« adoptable », mais reste entièrement sous le contrôle de son mode
d'installation actuel.

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

## Étapes suivantes

L'installation complète sera ajoutée par incréments contrôlés :

1. publication de l'image `ghcr.io/maxhugit/mergeron-manager` et formulaires
   Compose/DockerMan ;
2. adoption explicite d'une installation existante, sans recréation ;
3. première installation idempotente des trois conteneurs et de leurs réseaux ;
4. mise à jour transactionnelle avec sauvegarde, contrôle de santé et retour
   automatique à l'image précédente ;
5. réparation limitée aux conteneurs et réseaux déclarés dans le manifeste.

Les volumes ou dossiers persistants ne feront pas partie d'une suppression ou
d'un retour arrière automatique.
