# Contribuer au projet

## Principes

- préserver la compatibilité avec `codex app-server` ;
- ne jamais intégrer de secret ou de donnée du homelab dans Git ;
- documenter en français les changements propres au déploiement Unraid ;
- conserver les restrictions Docker et réseau ;
- tester le code avant de publier une nouvelle image.

## Environnement de développement

Prérequis : Node.js 20 ou supérieur et pnpm 10.

```bash
pnpm install
cd web && pnpm install && cd ..
cp .env.example .env
pnpm start:dev
```

Dans un second terminal :

```bash
cd web
pnpm dev
```

## Vérifications

```bash
python3 scripts/check-no-chinese.py
pnpm lint
pnpm test
cd web && pnpm test
```

## Déploiement

Une fusion dans `main` construit l’image GHCR. Tester de préférence le tag
immuable `sha-<commit>` avant de modifier l’image utilisée sur Unraid.

Toute modification de `deployment/` doit être répercutée dans
`docs/installation-unraid.md`.
