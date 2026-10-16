# Interface Web

L’interface utilise React 19 et Vite 8. Elle communique avec le backend par les
routes REST `/api/*` et Socket.IO. En production, le résultat de la compilation
est servi par le backend NestJS ; aucun serveur frontal séparé n’est nécessaire.

## Commandes

```bash
pnpm dev
pnpm build
pnpm test
pnpm test:watch
pnpm lint
pnpm generate:api
```

## Organisation

| Chemin | Contenu |
|---|---|
| `src/routes/` | pages de l’application |
| `src/components/` | composants de l’interface |
| `src/stores/` | états Zustand |
| `src/hooks/` | hooks Socket, conversations, affichage et fichiers |
| `src/generated/api/` | client généré depuis OpenAPI, à ne pas modifier manuellement |
| `src/test/setup.ts` | initialisation des tests Vitest |

Les tests sont placés à côté des fichiers concernés avec l’extension `.spec.ts`
ou `.spec.tsx`.
