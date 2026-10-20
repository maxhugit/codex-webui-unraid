# Administration Codex : listes, enregistrement et version du CLI

## Listes alimentées par le serveur

Les modèles et modèles de revue sont chargés depuis `model/list` du Codex installé,
en parcourant toutes les pages. Les efforts de raisonnement proviennent du modèle
sélectionné ; les niveaux de service proviennent du catalogue. Les fournisseurs
personnalisés proviennent de `model_providers` dans la configuration effective.

Les listes sont rechargées toutes les minutes lorsque le panneau est ouvert,
après une modification de configuration et après une opération sur le catalogue
ou le CLI. Une valeur déjà configurée n'est pas supprimée simplement parce
qu'elle n'est plus annoncée. Un modèle ou fournisseur non annoncé reste saisissable.

Les paramètres que Codex n'énumère pas à l'exécution, notamment certaines valeurs
de protocole de sécurité, restent définis par la version de schéma intégrée au
WebUI. Une mise à jour du CLI seule ne garantit donc pas toutes les nouveautés de
son interface : une mise à jour du WebUI peut également être nécessaire.

## Enregistrement par onglet

Les formulaires Codex et les paramètres serveur généraux, terminal, fichiers,
sécurité et chat simple utilisent une barre d'enregistrement fixe en bas de page.
Dans Codex, seul l'onglet actif est enregistré. Ses autres brouillons sont gardés
pendant la navigation entre les sous-onglets. Annuler rétablit les valeurs de cet
onglet. Les champs Codex sont validés avant un envoi groupé.

Les paramètres serveur utilisent la route groupée existante : toutes les valeurs
sont validées avant leur écriture atomique. En cas d'échec, les changements
non enregistrés sont conservés. Les actions immédiates (connexion, déconnexion,
installation d'une intégration, réinitialisation) restent distinctes d'un
enregistrement de formulaire. Le catalogue distingue toujours l'enregistrement
du brouillon et son application avec redémarrage.

## Version et mise à jour du CLI

Dans **Paramètres > Codex > Version du CLI**, un administrateur peut :

- lire la version de l'exécutable utilisé par le serveur géré et celle de l'image ;
- vérifier la dernière version stable de `@openai/codex` sur le registre npm officiel ;
- installer cette version après confirmation ;
- revenir à la sélection précédente, y compris à l'exécutable de l'image.

La dernière version publiée est mise en cache pendant 15 minutes. Le bouton de
vérification relance la consultation. Un échec réseau affiche un état inconnu,
jamais une fausse indication « à jour ». Le proxy HTTP/HTTPS configuré est transmis
aux commandes npm ; `.npmjs.org` doit rester autorisé dans Squid.

### Installation et protections

L'installation ne modifie ni l'image en lecture seule, ni le préfixe npm global.
Les téléchargements sont effectués sous `CODEX_HOME/webui/cli/releases`, avec
scripts npm désactivés, durée et sortie bornées. L'exécutable doit annoncer la
version attendue avant toute activation. Seules les versions stables exactes
`majeure.mineure.correctif` sont acceptées, sans commande libre ni URL de paquet
fournie par le navigateur.

La sélection persistante est enregistrée atomiquement dans
`CODEX_HOME/webui/cli/selection.json`. Les outils auxiliaires de sandbox sont ceux
de la même version. Le gestionnaire relance ensuite son app-server. Les commandes
`codex` lancées manuellement dans un terminal global ne sont pas remplacées : la
sélection concerne le serveur géré par le WebUI et les commandes qu'il lance.

Une exclusion mutuelle empêche les mutations concurrentes pendant l'opération.
Les vérifications d'activité du catalogue sont réutilisées avant le téléchargement
et avant la bascule. L'opération est refusée si l'inactivité du serveur géré n'est
pas établie. Cette vérification ne constitue pas une barrière globale pour des
clients Codex externes ou des activités autonomes non observables.

Si l'activation échoue, la sélection précédente est restaurée et un redémarrage
est tenté. Si cette récupération échoue aussi, l'erreur l'indique explicitement.
Un retour manuel est possible lorsque le serveur est complètement arrêté.

**Sauvegarder le répertoire Codex avant une mise à jour.** Une nouvelle version
peut migrer ses données : le retour à l'ancien exécutable ne restaure pas ces
données et ne garantit pas leur rétrocompatibilité. L'initialisation réussie du
nouveau CLI ne garantit pas la compatibilité de tous ses protocoles avec le WebUI.

La gestion intégrée est réservée à Linux x64/arm64. Si `CODEX_BIN` est défini,
l'installation est considérée comme externe : seule la consultation est proposée.
La version du CLI choisie persiste aux redémarrages du conteneur ; mettre à jour
l'image ne supprime pas cette sélection.

Les versions téléchargées sont conservées pour faciliter les retours arrière ;
aucune purge automatique de ce répertoire persistant n'est effectuée.
