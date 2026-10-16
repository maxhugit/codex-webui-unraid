# Installation et reconstruction sur Unraid

Ce guide permet de reconstruire les trois conteneurs sans placer de secret dans
Git. Il part d’un Unraid sur lequel Docker fonctionne. Traefik, Authentik,
OnlyOffice et HA-MCP sont des services externes : les étapes ci-dessous indiquent
comment raccorder Codex à chacun d’eux.

## 0. Prérequis et informations à réunir

Préparer avant de commencer :

- un accès administrateur à Unraid ;
- un domaine public dirigé vers l’entrée HTTPS du homelab ;
- Traefik avec un résolveur de certificats valide ;
- Authentik et son outpost Traefik ;
- une clé API OpenAI si le chat simple est utilisé ;
- les clés SSH dédiées à Unraid et au VPS ;
- les URL et identifiants de HA-MCP et OnlyOffice, si utilisés.

Vérifier également que les chemins choisis se trouvent sur le pool protégé et
qu’ils sont inclus dans la sauvegarde Appdata quotidienne.

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

Éditer `.env`, adapter les trois chemins et remplacer si possible `latest` par
un tag `sha-...`. Le fichier `.env` de production ne doit jamais être envoyé
sur GitHub.

Vérifier que les fichiers de configuration sont présents :

```bash
test -f compose.unraid.yml
test -f config/nginx.conf.template
test -f config/squid.conf
test -f config/seccomp-bwrap.json
```

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

Donner les droits à l’identité utilisée par le conteneur, puis resserrer ceux
des secrets :

```bash
chown -R 11002:11002 "$STATE/home" "$STATE/workspace" "$STATE/logs"
chown -R 11002:11002 "$STATE/ssh"
chmod 700 "$STATE/ssh"
chmod 400 "$STATE/backend-token.txt" "$STATE/backend-token-nginx.txt"
chmod 440 "$STATE/openai-api-key.txt"
```

## 3. Vérifier le réseau partagé

Traefik et Authentik doivent être présents sur `net_standard` :

```bash
docker network inspect net_standard
```

Si ce réseau n’existe pas, le créer et y rattacher Traefik et Authentik avant de
démarrer Codex. Les trois réseaux propres à Codex seront créés par Compose.

```bash
docker network create net_standard
docker network connect net_standard <nom-du-conteneur-traefik>
docker network connect net_standard <nom-du-conteneur-authentik>
```

Ne pas répéter les commandes `connect` si les conteneurs appartiennent déjà au
réseau.

## 4. Démarrer les conteneurs

Depuis le dossier `deployment` :

```bash
docker compose --env-file .env -f compose.unraid.yml config >/dev/null
docker compose --env-file .env -f compose.unraid.yml pull
docker compose --env-file .env -f compose.unraid.yml up -d
docker compose --env-file .env -f compose.unraid.yml ps
```

Le conteneur principal peut prendre plus d’une minute avant d’être déclaré sain.

### Enregistrer la stack dans Compose Manager

Sur Unraid, installer le plugin **Compose Manager** s’il n’est pas déjà présent.
Dans sa page, choisir **Add New Stack**, donner un nom à la stack et sélectionner
le dossier contenant le fichier Compose. Configurer ensuite le chemin du fichier
d’environnement dans **Stack Settings**.

Le fichier utilisé par l’interface doit s’appeler `docker-compose.yml`. On peut
copier `deployment/compose.unraid.yml` sous ce nom lors de l’installation :

```bash
cp compose.unraid.yml docker-compose.yml
```

Compose Manager affiche alors les trois services et fournit les actions **Up**,
**Down**, **Logs** et **Update Stack**.

### Déploiement manuel d’une nouvelle version

1. ouvrir **Docker > Compose** dans Unraid ;
2. ouvrir l’éditeur du fichier d’environnement ;
3. définir `CODEX_APP_IMAGE` avec `latest` ou, de préférence, un tag
   `sha-<commit>` ;
4. enregistrer ;
5. cliquer sur **Update Stack** ;
6. attendre que l’application principale soit saine, puis tester l’interface.

L’action met à jour automatiquement l’application, Nginx et Squid. Compose
respecte les contrôles de santé et ne démarre l’entrée Nginx qu’après
l’application principale.

## 5. Configurer Traefik

Copier `deployment/traefik/codex.yml` dans le dossier dynamique de Traefik. Le
middleware nommé `authentik` doit déjà exister.

Vérifier que Traefik est attaché à `net_standard` et peut résoudre
`codex-web-ingress`.

Recharger Traefik et vérifier dans son tableau de bord que le routeur Codex est
actif, utilise TLS et pointe vers le port `8080` de `codex-web-ingress`.

## 6. Configurer Authentik

Créer une application Proxy Provider pour le domaine public choisi, puis
associer son outpost au middleware Traefik `authentik`.

Nginx réalise une seconde vérification sur :

```text
http://authentik:9000/outpost.goauthentik.io/auth/nginx
```

Le nom Docker `authentik` doit donc être résolvable depuis `net_standard`.

Ne pas activer un second mot de passe applicatif : Authentik constitue la porte
d’entrée. Conserver néanmoins un accès local de récupération documenté pour ne
pas dépendre d’un Authentik en panne.

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

Dans les paramètres Codex, renseigner l’URL publique du Document Server, par
exemple `https://office.example.com`, et le même secret JWT des deux côtés.

### MCP Home Assistant

Ajouter l’URL du serveur MCP, par exemple `https://ha-mcp.example.com/mcp`, lancer OAuth puis vérifier que le
fichier d’identifiants persistant contient un jeton de renouvellement. Le serveur
HA-MCP doit annoncer les portées `openid` et `offline_access`.

### SSH

Placer les clés limitées dans `$STATE/ssh`, renseigner `known_hosts` et tester
depuis le conteneur sans donner de clé privée en écriture à Codex.

## 9. Tests après reconstruction

```bash
docker inspect codex-webui-limlll --format '{{.State.Health.Status}}'
curl -I https://codex.example.com
docker logs --tail 100 codex-web-ingress
docker logs --tail 100 codex-web-egress-proxy
```

Tester ensuite : connexion Authentik, création d’une conversation, terminal,
lecture/écriture d’un fichier de test, chat simple, MCP Home Assistant,
OnlyOffice et SSH.

Liste de validation finale :

- [ ] un utilisateur non authentifié est redirigé vers Authentik ;
- [ ] aucun port du backend Codex n’est publié directement sur Unraid ;
- [ ] les trois conteneurs sont sains ;
- [ ] une conversation et son espace de travail persistent après redémarrage ;
- [ ] `/appdata` est visible et modifiable uniquement après authentification ;
- [ ] le chat simple fonctionne sans révéler la clé OpenAI ;
- [ ] MCP Home Assistant se reconnecte après redémarrage ;
- [ ] les deux accès SSH utilisent les clés attendues ;
- [ ] un document Office peut être ouvert puis enregistré ;
- [ ] un PDF s’ouvre dans la visionneuse ;
- [ ] la sauvegarde quotidienne inclut les répertoires persistants.

## 10. Mise à jour et retour arrière

Avant une mise à jour, noter le tag `sha-...` actif et sauvegarder `$STATE/home`.
Tester la nouvelle image, puis revenir au précédent tag dans `.env` en cas de
problème. Ne pas supprimer l’ancien tag avant validation fonctionnelle.
