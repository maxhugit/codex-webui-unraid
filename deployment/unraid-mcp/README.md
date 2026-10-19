# Images Unraid MCP

Ce dossier contient les sources reproductibles des deux images utilisées sur Unraid :

- `ghcr.io/maxhugit/unraid-mcp:latest` : serveur MCP fondé sur `lemanjo/unraid-mcp`, limité aux lectures ainsi qu'au démarrage, à l'arrêt et à la mise à jour des conteneurs ;
- `ghcr.io/maxhugit/unraid-mcp-oauth:latest` : passerelle OAuth FastMCP placée devant le serveur MCP.

Les images ne contiennent aucun secret. Les identifiants Unraid et OAuth sont fournis exclusivement au démarrage par les fichiers protégés présents dans `appdata`.

La passerelle attend aussi dans `gateway.json` les paramètres non sensibles propres au déploiement : `backend_url`, `listen_host`, `listen_port` et `allowed_client_redirect_uris`. Aucune adresse de l'infrastructure n'est inscrite dans l'image.

Le workflow `unraid-mcp-images.yml` construit les deux images lors d'une modification de ce dossier et publie deux tags : `latest` et `sha-<commit>`.
