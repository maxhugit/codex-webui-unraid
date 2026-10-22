# Codex WebUI pour le homelab Unraid

Ce dépôt contient le code et le déploiement d’une interface Codex auto-hébergée.
Le moteur Codex s’exécute sur Unraid ; le navigateur sert uniquement d’interface.

Il s’agit d’une adaptation du projet
[`LimLLL/codex-webui`](https://github.com/LimLLL/codex-webui), publiée sous
licence AGPL-3.0-or-later.

## Fonctions principales

- conversations Codex regroupées par espace de travail ;
- chat simple utilisant directement l’API OpenAI ;
- terminaux persistants ;
- navigation et modification des fichiers de `/workspaces` et `/appdata` ;
- consultation des PDF et édition des documents Office avec OnlyOffice ;
- intégrations MCP, notamment Home Assistant ;
- accès SSH à Unraid et au VPS avec des clés montées en lecture seule ;
- interface adaptée aux ordinateurs et aux mobiles/PWA.

## Architecture de production

La plateforme utilise trois conteneurs :

1. `codex-webui` exécute l’interface et le moteur Codex ;
2. `codex-web-ingress` protège et transmet les requêtes entrantes ;
3. `codex-web-squid` filtre les accès HTTP/HTTPS sortants.

```mermaid
flowchart LR
    U[Utilisateur] -->|HTTPS| T[Traefik]
    T -->|SSO| A[Authentik]
    T --> N[codex-web-ingress]
    N --> C[codex-webui]
    C --> S[codex-web-squid]
    S --> I[Internet autorisé]
    C --> H[HA-MCP / Home Assistant]
    C --> X[Unraid et VPS par SSH]
```

Les formulaires Docker standard d'Unraid se trouvent dans
[`deployment/docker-man`](deployment/docker-man). La définition Compose reste
disponible dans [`deployment/compose.unraid.yml`](deployment/compose.unraid.yml).
Les détails des réseaux et des protections sont documentés dans
[`docs/architecture-unraid.md`](docs/architecture-unraid.md).

## Reconstruire la plateforme

Le [sommaire de la documentation](docs/README.md) permet de comprendre le dépôt
et de reconstruire toute la plateforme. La
[procédure DockerMan](docs/installation-unraid-dockerman.md) est recommandée
pour une gestion native dans l'onglet Docker. La
[procédure Compose](docs/installation-unraid.md) reste disponible. Elles couvrent
la préparation des secrets, les réseaux, Traefik, Authentik, OnlyOffice, SSH et
MCP.

## Construction de l’image

Chaque modification de la branche `main` construit et publie :

```text
ghcr.io/maxhugit/codex-webui-unraid:latest
ghcr.io/maxhugit/codex-webui-unraid:sha-<commit>
```

Pour la production, un tag immuable `sha-...` est préférable à `latest`.

Le registre conserve automatiquement les 10 images les plus récentes portant
uniquement un tag `sha-*`. Les tags `latest`, `buildcache` et les éventuels tags
de version sont protégés. Le nettoyage est exécuté chaque semaine et peut être
lancé manuellement en mode simulation depuis GitHub Actions.

## Évolutions du projet d’origine

La synchronisation automatique avec le projet d’origine est désactivée. Ce fork
contient désormais des adaptations importantes pour Unraid, le mobile, les
fichiers, OnlyOffice, Authentik et la sécurité réseau. Une fusion globale de
l’amont présenterait trop de risques de régression.

Une évolution utile doit être reprise manuellement dans une branche dédiée,
avec lecture du diff, tests et validation avant intégration.

## Données exclues du dépôt

Ne jamais ajouter à Git les clés OpenAI, clés privées SSH, jetons internes,
identifiants OAuth/MCP, bases SQLite, conversations, espaces de travail ou
contenus d’`appdata`.

Consulter [`SECURITY.md`](SECURITY.md) avant toute modification du déploiement.
