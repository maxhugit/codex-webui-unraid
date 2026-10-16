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

La procédure d’installation et de restauration complète est disponible dans
[`docs/installation-unraid.md`](docs/installation-unraid.md).

L’architecture et les responsabilités des trois conteneurs sont décrites dans
[`docs/architecture-unraid.md`](docs/architecture-unraid.md).
