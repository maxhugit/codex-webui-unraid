# Politique de sécurité

## Signaler une vulnérabilité

Ne pas publier de clé, jeton, adresse privée ou chemin personnel dans une issue.
Utiliser de préférence les avis de sécurité privés GitHub du dépôt.

## Modèle de confiance

Un utilisateur authentifié peut demander à Codex de lire ou modifier les
répertoires montés et d’exécuter des commandes dans le conteneur. Les protections
doivent donc être appliquées par Docker, les volumes, les réseaux, Authentik et
les permissions de l’hôte, et non par une simple consigne textuelle au modèle.

## Protections attendues

- aucun socket Docker dans le conteneur ;
- aucun mode privilégié ;
- système de fichiers du conteneur en lecture seule ;
- capacités Linux supprimées autant que possible ;
- secrets montés en lecture seule et exclus de Git ;
- accès public exclusivement par HTTPS, Traefik, Authentik et Nginx ;
- filtrage des sorties Web par Squid ;
- clés SSH limitées et montées en lecture seule ;
- sauvegarde des données persistantes ;
- journaux avec rotation et sans secret.

## Risques résiduels connus

Le réseau `codex_admin` permet au conteneur principal d’atteindre Unraid, le VPS
et les services administratifs. Les programmes respectant les variables de
proxy utilisent Squid, mais ce réseau constitue aussi une route directe. Les
autorisations SSH et les services accessibles doivent rester strictement limités.

Les chemins `/workspaces` et `/appdata` sont accessibles en écriture car cela
correspond au besoin fonctionnel. Une compromission de Codex pourrait modifier
les fichiers contenus dans ces montages.

## Secrets à renouveler après exposition

- clé API OpenAI ;
- clés privées SSH ;
- jeton interne entre Nginx et Codex ;
- secret OnlyOffice ;
- jetons OAuth et MCP.
