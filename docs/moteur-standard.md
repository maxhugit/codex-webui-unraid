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
