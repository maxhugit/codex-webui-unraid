# Déploiement Unraid

Ce dossier contient les définitions reproductibles des trois conteneurs
applicatifs de Mergeron et du Manager local chargé de leur installation sûre.

`docker-man/` contient les quatre formulaires standard recommandés pour l'onglet
Docker d'Unraid, le script de préparation des réseaux et le réconciliateur qui
restaure leurs réseaux secondaires après chaque recréation DockerMan. Le
fichier `compose.unraid.yml` reste disponible pour Compose Manager.

Les deux modes déploient la même architecture et utilisent les mêmes données,
mais ne doivent pas être lancés simultanément. Leur comparaison, leurs sources
de configuration et la procédure de migration sont détaillées dans
[`docs/choisir-mode-installation.md`](../docs/choisir-mode-installation.md).

La documentation complète commence dans
[`docs/README.md`](../docs/README.md). La procédure pas à pas se trouve dans
[`docs/installation-unraid-dockerman.md`](../docs/installation-unraid-dockerman.md).

Les secrets et les données persistantes ne sont volontairement pas versionnés.
Le Manager crée les éléments manquants lorsque `MERGERON_INSTALL_ENABLED=true`,
mais ne remplace jamais un fichier ou un dossier existant. Le réseau externe
`net_standard` doit être créé au préalable.
