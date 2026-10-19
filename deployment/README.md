# Déploiement Unraid

Ce dossier contient la définition reproductible des trois conteneurs de la
plateforme Codex : application, passerelle Nginx et proxy de sortie Squid.

La documentation complète commence dans
[`docs/README.md`](../docs/README.md). La procédure pas à pas se trouve dans
[`docs/installation-unraid.md`](../docs/installation-unraid.md).

Les secrets et les données persistantes ne sont volontairement pas versionnés.
Ils doivent être recréés ou restaurés dans `STATE_ROOT` avant le démarrage.
