# Exploitation sur Unraid

La définition active comprend trois conteneurs et se trouve dans
[`deployment/compose.unraid.yml`](deployment/compose.unraid.yml).

## Emplacements recommandés

```text
/mnt/pool/appdata/codex-web/deployment
  compose.unraid.yml
  .env
  config/

/mnt/pool/appdata/codex-webui-limlll/state
  home/
  workspace/
  logs/
  ssh/
  backend-token.txt
  backend-token-nginx.txt
  openai-api-key.txt
```

Les fichiers sous `state` ne doivent jamais être ajoutés au dépôt.

## Commandes d’exploitation

```bash
cd /mnt/pool/appdata/codex-web/deployment
docker compose --env-file .env -f compose.unraid.yml ps
docker compose --env-file .env -f compose.unraid.yml pull
docker compose --env-file .env -f compose.unraid.yml up -d
```

## Gestion depuis l’interface Unraid

La stack est prévue pour le plugin **Compose Manager**. Les labels
`net.unraid.docker.*` donnent aux conteneurs une icône, un terminal et, pour
l’application principale, un lien vers l’interface Web.

Dans **Docker > Compose**, la stack permet de :

- modifier le fichier Compose ;
- modifier le fichier d’environnement et le tag `CODEX_APP_IMAGE` ;
- démarrer ou arrêter les trois conteneurs ensemble ;
- utiliser **Update Stack** pour télécharger les images et recréer les trois
  conteneurs dans le bon ordre.

Il ne faut pas recréer uniquement `codex-webui-limlll` avec le formulaire Docker
classique : ce formulaire ne représente pas fidèlement ses deux réseaux, son
profil seccomp et ses dépendances. Utiliser Compose Manager conserve toutes les
protections.

La procédure d’installation et de restauration complète est disponible dans
[`docs/installation-unraid.md`](docs/installation-unraid.md).

L’architecture et les responsabilités des trois conteneurs sont décrites dans
[`docs/architecture-unraid.md`](docs/architecture-unraid.md).
