# Déploiement Unraid

Ce dossier contient les définitions reproductibles des trois conteneurs de la
plateforme Codex : application, passerelle Nginx et proxy de sortie Squid.

`docker-man/` contient les trois formulaires standard recommandés pour l'onglet
Docker d'Unraid, le script de préparation des réseaux et le réconciliateur qui
restaure leurs réseaux secondaires après chaque recréation DockerMan. Le
fichier `compose.unraid.yml` reste disponible pour Compose Manager.

La documentation complète commence dans
[`docs/README.md`](../docs/README.md). La procédure pas à pas se trouve dans
[`docs/installation-unraid-dockerman.md`](../docs/installation-unraid-dockerman.md).

Les secrets et les données persistantes ne sont volontairement pas versionnés.
Ils doivent être recréés ou restaurés dans `STATE_ROOT` avant le démarrage.
