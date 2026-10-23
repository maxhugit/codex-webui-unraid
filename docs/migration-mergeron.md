# Migration vers Mergeron

Le dépôt est `maxhugit/mergeron` et l’image officielle est
`ghcr.io/maxhugit/mergeron:latest` (ou un tag immuable `sha-…`). Le renommage
du dépôt GitHub seul ne modifie ni un package GHCR ni un formulaire DockerMan
déjà enregistré sur Unraid.

## Données et configuration conservées

Conserver exactement les montages existants, notamment `/home/codex`, les
workspaces et les journaux. Ne pas déplacer les répertoires d’appdata. Le chemin
de la base `codex-webui.sqlite`, les variables `CODEX_*` et `WEBUI_*`, les réseaux
`codex_isolated`, `codex_admin` et `codex_external`, les secrets et les marqueurs
d’initialisation restent compatibles. Ces noms désignent des données ou des
interfaces techniques, pas une autre application.

## Formulaires Unraid

Attendre la réussite du workflow de publication et vérifier que le tag de
l’image correspond au commit souhaité. Utiliser ensuite **Edit** sur les
conteneurs existants ; ne pas lancer une seconde instance sur les mêmes données.

| Ancien conteneur    | Nouveau nom        | Repository                         | Alias DNS à conserver |
| ------------------- | ------------------ | ---------------------------------- | --------------------- |
| `codex-webui`       | `mergeron`         | `ghcr.io/maxhugit/mergeron:latest` | `codex-webui`         |
| `codex-web-ingress` | `mergeron-ingress` | `nginx:stable` (inchangé)          | `codex-web-ingress`   |
| `codex-web-squid`   | `mergeron-squid`   | `ubuntu/squid:latest` (inchangé)   | `codex-web-squid`     |

Les trois modèles canoniques sont dans
[`deployment/docker-man`](../deployment/docker-man). Ils contiennent les
nouveaux liens **Project**, **Support**, **Registry**, **TemplateURL** et **Icon**.
Reporter ces métadonnées dans les formulaires existants sans remplacer leurs
volumes, secrets, limites, paramètres de sécurité ou URL WebUI personnalisée.
Les anciens fichiers `my-codex-*.xml` ne doivent pas rester proposés comme une
seconde installation après la migration des formulaires.

Installer d’abord le réconciliateur mis à jour : il accepte les anciens et les
nouveaux noms. Les paramètres supplémentaires des modèles ajoutent l’alias
historique sur le réseau principal ; le réconciliateur le conserve aussi sur
les réseaux secondaires qu’il raccorde. Cela permet aux configurations Nginx,
Traefik et proxy déjà montées de continuer à utiliser leurs anciennes adresses.
Il répare aussi les alias manquants sur un réseau encore attaché et reconnaît
`mergeron-ui`, nom intermédiaire rencontré lorsque seul le formulaire de
l’application a été renommé.

Recréer dans l’ordre Squid, application puis ingress. Après chaque recréation,
vérifier les réseaux et la santé du conteneur. À la fin, contrôler que l’interface,
les projets et les conversations existants sont accessibles, puis vérifier
qu’Unraid affiche `ghcr.io/maxhugit/mergeron:latest` pour l’application.

## Docker Compose

Conserver les mêmes valeurs de `DEPLOY_ROOT`, `STATE_ROOT` et les mêmes fichiers
de secrets. Remplacer `CODEX_APP_IMAGE` par l’image Mergeron et utiliser le
fichier Compose mis à jour : les noms des conteneurs et les alias y sont définis.
Les identifiants de services Compose sont conservés pour que Compose recrée les
services existants. Exécuter `docker compose … config` puis `pull` et `up -d`
avec le même nom de projet Compose et le même fichier d’environnement.

Ne pas supprimer les volumes et ne pas utiliser `down -v`. Les anciennes images
restent disponibles pour un retour arrière ; l’ancien package GHCR n’est pas
supprimé par le renommage. Les futures publications et le nettoyage automatique
des tags SHA utilisent uniquement le package `mergeron`.
