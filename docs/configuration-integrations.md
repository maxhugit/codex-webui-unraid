# Configuration des intégrations

## Authentik

Créer une application et un fournisseur proxy pour l’URL publique de Codex, par
exemple `https://codex.example.com`. Associer le fournisseur à l’outpost utilisé par
Traefik. Le middleware Traefik doit protéger toutes les routes publiques.

Nginx réalise aussi une vérification interne auprès de :

```text
http://authentik:9000/outpost.goauthentik.io/auth/nginx
```

Le conteneur Authentik et `codex-web-ingress` doivent donc partager
`net_standard`. Après configuration, une fenêtre privée doit être redirigée vers
Authentik ; aucune page Codex ne doit apparaître avant authentification.

## OpenAI et Codex

L’authentification Codex est conservée sous `STATE_ROOT/home`. Le chat simple
utilise la clé placée dans `STATE_ROOT/openai-api-key.txt`. Ne jamais inscrire
cette clé dans Git, Compose ou une capture d’écran.

Après un redémarrage, vérifier qu’une ancienne conversation se recharge et que
le chat simple retourne une réponse.

## MCP Home Assistant

Configurer l’URL :

```text
https://ha-mcp.example.com/mcp
```

Effectuer OAuth depuis l’interface. Pour une session durable, le fournisseur
doit délivrer un jeton de renouvellement et accepter la portée
`offline_access`. Les données OAuth sont persistées dans `STATE_ROOT/home`.

Valider avec une requête en lecture seule, par exemple la liste de quelques
entités Home Assistant.

## GitHub

Connecter GitHub depuis les paramètres de l’interface. Le jeton ou l’autorisation
OAuth est conservé dans le volume persistant, jamais dans le dépôt. Accorder le
minimum de dépôts et de permissions nécessaires.

## SSH vers Unraid et le VPS

Placer une clé distincte par destination dans `STATE_ROOT/ssh`. Ajouter les clés
publiques dans les comptes distants concernés et enregistrer les empreintes dans
`known_hosts`. Les clés sont montées en lecture seule dans le conteneur.

Éviter une clé root sans restriction. Idéalement, limiter les commandes dans
`authorized_keys` ou utiliser un compte d’administration dédié.

## OnlyOffice

Renseigner l’adresse publique du Document Server :

```text
https://office.example.com
```

Le secret JWT doit être identique dans OnlyOffice et dans Codex WebUI. Le serveur
OnlyOffice doit pouvoir rappeler les routes de document autorisées sur le
domaine public de Codex. Tester l’ouverture puis l’enregistrement d’un document de
test avant d’utiliser un fichier important.

## PDF et fichiers

Les fichiers sous `/workspaces` et `/appdata` sont visibles dans l’explorateur.
Les PDF s’ouvrent dans la visionneuse intégrée. Les fichiers Office utilisent
OnlyOffice. Les autres formats sont téléchargés ou ouverts selon leur type.
