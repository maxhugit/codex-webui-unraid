# Exploitation sur Unraid

La plateforme comprend trois conteneurs. Pour une installation native dans
l'onglet **Docker** d'Unraid, utiliser les trois formulaires de
[`deployment/docker-man`](deployment/docker-man) et suivre la
[procédure DockerMan](docs/installation-unraid-dockerman.md).

La définition [`deployment/compose.unraid.yml`](deployment/compose.unraid.yml)
reste disponible comme variante pour Compose Manager.

## Emplacements recommandés

```text
/mnt/pool/appdata/codex-web
  docker-compose.yml
  images.env
  config/
  state/
    home/
    workspace/
    logs/
    ssh/
    backend-token.txt
    backend-token-nginx.txt
    openai-api-key.txt
```

Les fichiers sous `state` ne doivent jamais être ajoutés au dépôt.

## Mise à jour recommandée

Avec les formulaires standard, utiliser **Docker > Check for Updates**, puis
**Update** sur `codex-webui`. Unraid recrée le conteneur à partir de `latest`
sans toucher aux données persistantes de `state`.

Les trois conteneurs restent nécessaires : Nginx porte l'authentification et le
routage entrant, tandis que Squid contrôle les accès Internet sortants.

## Variante Compose Manager

### Commandes d'exploitation

```bash
cd /mnt/pool/appdata/codex-web
docker compose --env-file images.env -f docker-compose.yml ps
docker compose --env-file images.env -f docker-compose.yml pull
docker compose --env-file images.env -f docker-compose.yml up -d
```

### Gestion depuis l'interface Unraid

La stack est prévue pour le plugin **Compose Manager**. Les labels
`net.unraid.docker.*` donnent aux conteneurs une icône, un terminal et, pour
l’application principale, un lien vers l’interface Web.

Dans **Docker > Compose**, la stack permet de :

- modifier le fichier Compose ;
- modifier le fichier d’environnement et le tag `CODEX_APP_IMAGE` ;
- démarrer ou arrêter les trois conteneurs ensemble ;
- utiliser **Update Stack** pour télécharger les images et recréer les trois
  conteneurs dans le bon ordre.

Ne pas mélanger les conteneurs de cette stack avec ceux créés depuis les
formulaires DockerMan : ils ont volontairement les mêmes noms.

La procédure d’installation et de restauration complète est disponible dans
[`docs/installation-unraid.md`](docs/installation-unraid.md).

L’architecture et les responsabilités des trois conteneurs sont décrites dans
[`docs/architecture-unraid.md`](docs/architecture-unraid.md).
