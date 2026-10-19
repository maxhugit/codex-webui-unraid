# Moteur standard : migration progressive et retour arrière

## État actuel — qualification uniquement

Le moteur standard dispose d'une image et d'un service Docker distincts. Les
trois services existants ne sont pas remplacés. **Les agents standards restent
interdits par les contrôles HTTP/WebSocket actuels.** Ce document ne décrit pas
une isolation multiutilisateur déjà homologuée.

Le service supplémentaire exécute uniquement des commandes de qualification
avec Bubblewrap, dans des dossiers de test déclarés par l'opérateur. Il ne
contient ni connexion Codex, ni MCP, ni copie des identifiants administrateur,
ni base de données. Son endpoint `/execute` reste systématiquement fermé.

## Déploiement séparé

L'image est compilée et publiée par GitHub Actions avec un tag contenant le SHA
complet du commit, sans tag `latest`. Le workflow exécute les tests du service
avant publication. Les essais Linux réels doivent également être exécutés sur
Unraid : les tests unitaires seuls ne valident pas le noyau ou les montages.

Fichiers :

- `Dockerfile.standard-worker` : environnement minimal, utilisateur 11003 ;
- `deployment/compose.standard-worker.yml` : déploiement additionnel ;
- `deployment/config/standard-projects.example.json` : registre vide et fermé ;
- `scripts/sandbox/standard-worker.cjs` : service de qualification authentifié ;
- `scripts/sandbox/self-test.cjs` : contrôles Linux avec données jetables.

Préparer un dossier `STANDARD_ROOT` séparé des données administrateur, avec :

- `workspaces/`, accessible à l'UID 11003, initialement vide ;
- `worker-token.txt`, 32 octets aléatoires encodés en hexadécimal, lisible
  uniquement par cet UID ; ne jamais réutiliser le jeton du serveur principal ;
- `projects.json`, copié depuis l'exemple, modifiable uniquement par
  l'opérateur et lisible dans le conteneur.

Fournir `CODEX_STANDARD_IMAGE` (référence immuable), `STANDARD_ROOT` et
`DEPLOY_ROOT` (répertoire contenant `config/seccomp-bwrap.json`) dans un fichier
d'environnement privé. Les sources de montage doivent exister : Compose ne les
crée pas silencieusement.

```sh
docker compose --env-file standard-worker.env \
  -p codex_standard_worker -f compose.standard-worker.yml \
  --profile standard-qualification up -d

docker exec codex-standard-worker node /app/scripts/sandbox/self-test.cjs
```

Ce Compose utilise un réseau interne distinct, aucun port publié, aucun proxy
sortant et aucune connexion au réseau administrateur. Le service principal n'y
est pas encore raccordé. La mémoire, les processus et le CPU sont plafonnés au
niveau du conteneur ; une seule commande de qualification est admise à la fois.

Le registre de qualification peut déclarer, pour les essais opérateur seulement :

```json
{
  "version": 1,
  "qualificationEnabled": true,
  "projects": {
    "qualification": {
      "qualificationOnly": true,
      "workspaceRoots": ["/workspaces/qualification"],
      "cwd": "/workspaces/qualification"
    }
  }
}
```

Les chemins ne sont jamais acceptés dans la requête HTTP. Le client fournit
uniquement un identifiant et un tableau d'arguments ; le registre opérateur
détermine les montages. Les sorties sont plafonnées et les commandes interrompues
après 10 secondes ou à la déconnexion. Le registre n'est **pas** un remplacement
des futures vérifications d'appartenance d'une personne à un projet.

Après un remplacement atomique d'un fichier monté individuellement, recréer le
conteneur pour reprendre le nouveau fichier. L'arrêt d'urgence repose sur
l'arrêt du service, pas seulement sur l'édition du registre.

## Étapes restant obligatoires avant ouverture

1. Qualifier Codex avec la version réellement déployée, pas seulement celle des
   types générés. L'ancien essai `codex-no-environment-probe.cjs` utilise un
   fournisseur synthétique : il ne prouve ni l'authentification par abonnement,
   ni la sécurité de tous les outils d'un agent réel.
2. Relier un moteur IA séparé aux seules commandes autorisées. Préserver la
   recherche Web sans transmettre les jetons Codex à ces commandes, et sans
   autoriser les connexions au réseau local. Ne pas copier aveuglément
   `auth.json` : qualifier le renouvellement et l'absence de concurrence.
3. Vérifier côté serveur les personnes, rôles et participants pour chaque
   exécution, lecture, abonnement WebSocket et opération différée. Aucun
   paramètre client ne doit choisir le moteur administrateur.
4. Résoudre le stockage : liens physiques préexistants, propriétaires,
   workspaces externes et changements concurrents. Le test du prototype
   **démontre encore une limite sur les liens physiques** ; il ne la résout pas.
5. Retester création, reprise, changement de projet, automatisations,
   sous-tâches, révocation de rôle et outils de fichiers. Les chemins non pris
   en charge doivent être refusés, jamais dirigés vers le moteur global.

Conserver les standards bloqués si un contrôle échoue. Aucun drapeau
d'environnement de ce lot ne permet de lever cette interdiction.

## Sauvegarde et retour arrière

Avant migration, conserver dans un répertoire privé : Compose, fichier
d'environnement des images, configuration réseau, références exactes des
images, configuration/authentification et copie cohérente SQLite obtenue avec
l'API de sauvegarde SQLite. Vérifier `PRAGMA integrity_check` sur cette copie.
Une copie brute du fichier SQLite ouvert sans son journal WAL ne suffit pas.

Ce lot ne modifie ni le schéma SQL, ni les projets, ni le routage des agents.
Le retour arrière ne nécessite donc **aucune restauration de base** :

```sh
docker compose --env-file standard-worker.env \
  -p codex_standard_worker -f compose.standard-worker.yml \
  --profile standard-qualification stop standard-worker
```

Puis, si nécessaire, supprimer uniquement ce déploiement additionnel avec
`down` **sans `--volumes`**. Ne pas lancer cette commande sur le Compose
principal. Conserver les données dédiées et les sauvegardes. Les trois
conteneurs historiques restent inchangés et les standards restent bloqués.

Les versions ultérieures devront conserver ce principe : désactivation du
moteur standard sans repli privilégié ; restauration SQL seulement après examen
des données récentes qu'elle pourrait écraser.

## Qualification effectuée le 19 octobre 2026

Image déployée : `sha-2e034b598af69aed99f45125a6ea1b6a3cc35440` du paquet
`codex-webui-unraid-standard-worker`, compilée par GitHub Actions avec succès.
Les trois conteneurs historiques n'ont pas été redémarrés ni mis à jour.

- 17 tests unitaires du lanceur et du service réussis ; les 9 tests du service
  ont aussi été exécutés dans le conteneur Unraid.
- 25 tests existants des protections HTTP/WebSocket réussis.
- 19 contrôles Linux du prototype conformes aux attentes, **dont un constat de
  limite sur les liens physiques**, pas 19 preuves de sécurité suffisante.
- Parcours HTTP authentifié vers Bubblewrap exercé avec une écriture réelle
  dans un dossier jetable ; autre projet, secret du worker et réseau inaccessibles.
- Service réellement déployé : santé correcte, accès sans jeton refusé,
  `/execute` refusé et registre de qualification conservé vide/désactivé.
- Arrêt puis redémarrage du seul worker exercés ; les trois services existants
  sont restés sains. Copie SQLite sauvegardée relue et intégrité vérifiée.

Le test d'intégration peut être lancé depuis une copie du dépôt sans installer
de fichier supplémentaire dans le conteneur :

```sh
docker exec -i -w /app/scripts/sandbox codex-standard-worker node \
  < scripts/sandbox/worker-integration-probe.cjs
```

Une qualification **synthétique** de Codex 0.162.1, version observée en service,
a produit un tour réussi avec `project_execute` et `web_search`, sans MCP ni
shell natif exposé. Cela ne valide pas encore un vrai abonnement, son
renouvellement ou un parcours utilisateur complet. Aucun quota IA n'a été
consommé par ce test.

Docker a signalé que le noyau ne permet pas d'appliquer une limite de swap.
La limite mémoire du worker existe, mais ne constitue donc pas une borne
mémoire + swap validée. Ce point et les quotas individuels restent à examiner.

**État de sortie : infrastructure de qualification opérationnelle, pas de
moteur IA utilisateur raccordé, pas d'ouverture aux standards.** La décision
de migration éventuelle des workspaces vers un stockage isolé doit précéder
tout déplacement de fichiers existants.

## Préparation du stockage isolé — étape suivante

Après accord de l'administrateur, trois copies de workspaces ont été préparées
sur Unraid, chacune dans le sous-volume Btrfs de son projet. Les originaux,
la base et les chemins utilisés par l'application sont inchangés.

Un simple dossier dédié ne suffit pas à bloquer les liens physiques : la
frontière retenue est **un sous-volume Btrfs par projet**, sans Docker par
projet. Le test réel a confirmé `EXDEV` pour les liens entre projets et avec
le stockage extérieur, avec un contrôle positif à l'intérieur du même projet.
Voir la [documentation Btrfs](https://btrfs.readthedocs.io/en/latest/Subvolumes.html).

`scripts/sandbox/prepare-project-storage.py` fonctionne sur l'hôte Unraid :

- sans `--prepare`, produit seulement un manifeste privé et les empreintes ;
- avec `--prepare`, crée les sous-volumes et copie les fichiers, sans modifier
  SQLite, supprimer les sources ou activer les agents ;
- exige une liste explicite d'UUID de projets et un stockage dédié ;
- refuse les destinations existantes, liens symboliques/physiques, fichiers
  spéciaux, sources imbriquées et sources hors du montage `/workspaces` ;
- vérifie les empreintes avant/après copie et conserve les copies partielles
  en cas d'erreur pour inspection. Il ne fusionne ni n'écrase une préparation ;
- ne réimporte pas d'identifiants Codex et n'active pas les MCP.

Les sous-volumes restent administrés par l'hôte. Les workspaces copiés
appartiennent à l'UID 11003 et au groupe 11002. Le moteur standard ne peut pas
remplacer les frontières de projets. La base ne doit jamais être modifiée par
un appel utilisateur à ce script : c'est un outil opérateur, pas une API.

Un manifeste doit être conservé hors des workspaces, avec des droits privés.
Il contient les anciens/futurs chemins et des empreintes de fichiers : ne pas
le publier dans Git. Les essais sont reproductibles avec :

```sh
python3 -m unittest discover -s scripts/sandbox -p 'test_*.py' -v
python3 scripts/sandbox/storage-boundary-probe.py --manifest CHEMIN_PRIVE_DU_MANIFESTE
```

### Avant la bascule effective

La préparation est une copie ponctuelle, **pas une synchronisation**. Geler les
écritures et revérifier les sources lors de la bascule ; si elles ont changé,
ne pas utiliser la copie périmée. Prévoir ensuite le montage applicatif, les
associations des workspaces, les chemins des tâches/fichiers et les overrides
des conversations/terminaux. Les historiques Codex ne doivent pas être
réécrits aveuglément.

Il reste également à adapter les opérations de gestion des dossiers aux
nouveaux chemins et à qualifier le moteur IA et les contrôles personne/projet.
Aucun de ces points n'est considéré comme achevé par la seule copie.
Les sous-volumes ne constituent ni des quotas disque ni des sauvegardes
indépendantes : les limites de capacité restent à définir avant ouverture.
