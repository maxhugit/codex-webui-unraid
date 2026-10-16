# Fonctionnement du dépôt

## Rôle du projet

Ce dépôt transforme Codex CLI en application Web persistante. Le backend NestJS
pilote `codex app-server`, conserve les conversations dans SQLite, expose des
API REST et Socket.IO, et sert l’interface React compilée. Le navigateur ne
dispose jamais directement des secrets OpenAI, SSH ou MCP.

## Arborescence

| Chemin | Contenu |
|---|---|
| `src/` | backend NestJS, API, base SQLite, terminaux, fichiers et intégrations |
| `web/` | interface React, PWA et affichage mobile |
| `drizzle/` | migrations de la base de données |
| `skills/` | compétences disponibles dans le conteneur, notamment Office |
| `deployment/` | définition reproductible des trois conteneurs Unraid |
| `docs/` | documentation d’architecture, installation et exploitation |
| `codex_probe/` | outils de vérification du protocole Codex |
| `.github/workflows/` | construction et publication de l’image GHCR |
| `Dockerfile` | construction multiétape de l’application complète |

## Construction de l’image

Le `Dockerfile` effectue les opérations suivantes :

1. compilation de l’interface React ;
2. compilation du backend NestJS ;
3. installation de Codex CLI et des outils MCP ;
4. installation des dépendances système, Python et Office ;
5. copie des migrations et des fichiers compilés dans l’image finale.

Un envoi sur `main` déclenche GitHub Actions. L’image est publiée dans GHCR avec
les tags `latest` et `sha-<commit>`. Le tag SHA est recommandé en production.

## Données persistantes

Le code et les dépendances vivent dans l’image. Les données vivent hors de
l’image dans `STATE_ROOT` :

| Dossier ou fichier | Rôle |
|---|---|
| `home/` | configuration Codex, base SQLite, OAuth, MCP et préférences |
| `workspace/` | fichiers des espaces de travail |
| `logs/` | journaux applicatifs |
| `ssh/` | clés et `known_hosts`, montés en lecture seule |
| `backend-token*.txt` | secret partagé entre Nginx et le backend |
| `openai-api-key.txt` | clé du chat simple |

Le montage `/appdata` donne à l’application un accès en lecture/écriture aux
configurations Unraid. Cette capacité est puissante : elle doit rester réservée
à un utilisateur Authentik de confiance.

## Cycle d’une requête

1. Le navigateur ouvre `https://codex.hugotlab.fr`.
2. Traefik termine HTTPS et interroge Authentik.
3. Nginx vérifie à nouveau la session et injecte le jeton interne.
4. Le backend répond, démarre Codex CLI ou accède aux données persistantes.
5. Les connexions Internet autorisées passent par Squid.

## Mise à jour du code

Le projet d’origine n’est pas fusionné automatiquement. Toute correction externe
est étudiée et reprise manuellement. Une mise à jour normale de ce dépôt produit
une nouvelle image ; les données persistantes ne sont pas remplacées.

