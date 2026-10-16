# Installation et reconstruction sur Unraid

Ce guide permet de reconstruire les trois conteneurs sans placer de secret dans
Git. Il suppose que Docker, Traefik et Authentik fonctionnent déjà sur Unraid.

## 1. Récupérer le dépôt

Choisir un emplacement persistant, par exemple :

```bash
mkdir -p /mnt/pool/appdata/codex-web
git clone https://github.com/maxhugit/codex-webui-unraid.git \
  /mnt/pool/appdata/codex-web/source
mkdir -p /mnt/pool/appdata/codex-web/deployment
cp -a /mnt/pool/appdata/codex-web/source/deployment/. \
  /mnt/pool/appdata/codex-web/deployment/
cd /mnt/pool/appdata/codex-web/deployment
cp .env.example .env
```

Adapter les chemins et, si possible, remplacer `latest` par un tag `sha-...`.

## 2. Préparer l’état persistant

```bash
STATE=/mnt/pool/appdata/codex-webui-limlll/state
mkdir -p "$STATE"/{home,workspace,logs,ssh}
```

L’utilisateur du conteneur porte l’UID/GID `11002:11002`. Le groupe `11001`
permet la lecture de la clé OpenAI montée.

Générer un jeton interne aléatoire et écrire exactement la même valeur dans les
deux fichiers :

```bash
openssl rand -hex 48 > "$STATE/backend-token.txt"
cp "$STATE/backend-token.txt" "$STATE/backend-token-nginx.txt"
chmod 400 "$STATE/backend-token.txt" "$STATE/backend-token-nginx.txt"
```

Créer la clé OpenAI sans l’afficher dans un terminal partagé :

```bash
install -m 440 /dev/null "$STATE/openai-api-key.txt"
editor "$STATE/openai-api-key.txt"
```

Restaurer les clés SSH dans `$STATE/ssh` et conserver des permissions strictes :

```bash
chmod 700 "$STATE/ssh"
chmod 600 "$STATE/ssh"/id_* 2>/dev/null || true
chmod 644 "$STATE/ssh"/*.pub "$STATE/ssh"/known_hosts 2>/dev/null || true
```

Ne jamais copier ces fichiers dans le dépôt Git.

## 3. Vérifier le réseau partagé

Traefik et Authentik doivent être présents sur `net_standard` :

```bash
docker network inspect net_standard
```

Si ce réseau n’existe pas, le créer et y rattacher Traefik et Authentik avant de
démarrer Codex. Les trois réseaux propres à Codex seront créés par Compose.

## 4. Démarrer les conteneurs

Depuis le dossier `deployment` :

```bash
docker compose --env-file .env -f compose.unraid.yml pull
docker compose --env-file .env -f compose.unraid.yml up -d
docker compose --env-file .env -f compose.unraid.yml ps
```

Le conteneur principal peut prendre plus d’une minute avant d’être déclaré sain.

## 5. Configurer Traefik

Copier `deployment/traefik/codex.yml` dans le dossier dynamique de Traefik. Le
middleware nommé `authentik` doit déjà exister.

Vérifier que Traefik est attaché à `net_standard` et peut résoudre
`codex-web-ingress`.

## 6. Configurer Authentik

Créer une application Proxy Provider pour `https://codex.hugotlab.fr`, puis
associer son outpost au middleware Traefik `authentik`.

Nginx réalise une seconde vérification sur :

```text
http://authentik:9000/outpost.goauthentik.io/auth/nginx
```

Le nom Docker `authentik` doit donc être résolvable depuis `net_standard`.

## 7. Restaurer les données

Les éléments importants à sauvegarder sont :

- `$STATE/home` : conversations, configuration, OAuth, MCP et SQLite ;
- `$STATE/workspace` : fichiers des espaces de travail ;
- `$STATE/ssh` : clés SSH, à protéger séparément ;
- `$STATE/logs` : facultatif ;
- `/mnt/user/appdata` : géré par la sauvegarde Appdata d’Unraid.

Les images Docker et les conteneurs eux-mêmes n’ont pas besoin d’être sauvegardés.

## 8. Reconfigurer les intégrations

### OpenAI

Renseigner `$STATE/openai-api-key.txt` ou utiliser la page de paramètres du chat
simple. Ne jamais mettre la clé dans `.env` versionné.

### OnlyOffice

Dans les paramètres Codex, renseigner l’URL publique
`https://office.hugotlab.fr` et le même secret JWT que le Document Server.

### MCP Home Assistant

Ajouter `https://ha-mcp.hugotlab.fr/mcp`, lancer OAuth puis vérifier que le
fichier d’identifiants persistant contient un jeton de renouvellement. Le serveur
HA-MCP doit annoncer les portées `openid` et `offline_access`.

### SSH

Placer les clés limitées dans `$STATE/ssh`, renseigner `known_hosts` et tester
depuis le conteneur sans donner de clé privée en écriture à Codex.

## 9. Tests après reconstruction

```bash
docker inspect codex-webui-limlll --format '{{.State.Health.Status}}'
curl -I https://codex.hugotlab.fr
docker logs --tail 100 codex-web-ingress
docker logs --tail 100 codex-web-egress-proxy
```

Tester ensuite : connexion Authentik, création d’une conversation, terminal,
lecture/écriture d’un fichier de test, chat simple, MCP Home Assistant,
OnlyOffice et SSH.

## 10. Mise à jour et retour arrière

Avant une mise à jour, noter le tag `sha-...` actif et sauvegarder `$STATE/home`.
Tester la nouvelle image, puis revenir au précédent tag dans `.env` en cas de
problème. Ne pas supprimer l’ancien tag avant validation fonctionnelle.
