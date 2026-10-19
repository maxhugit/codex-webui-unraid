# Prototype d’isolation Bubblewrap — hors ligne

## État et périmètre

Ce prototype expérimental teste une isolation de processus **dans le conteneur
existant**, sans créer de conteneur Docker supplémentaire. Il n’est connecté à
aucune route de l’application, aucun agent réel et aucun ordonnanceur.

**Il n’autorise pas les utilisateurs standards à exécuter des agents.** Les
protections HTTP et WebSocket existantes restent inchangées. Un résultat de test
positif n’est pas une homologation de sécurité multiutilisateur.

Les fichiers concernés sont :

- `scripts/sandbox/bubblewrap.cjs` : validation des chemins, préparation de
  Bubblewrap, filtre seccomp et supervision ;
- `scripts/sandbox/bubblewrap.test.cjs` : tests des règles et du filtre ;
- `scripts/sandbox/self-test.cjs` : essais réels avec des fichiers et services
  factices créés dans un dossier temporaire, puis supprimés.

Le lanceur exige explicitement `mcp: 'disabled'` et `network: 'disabled'`. Une
demande différente est refusée. Il n’existe aucune option de secours qui exécute
la commande sans isolation.

## Protections exercées

- Espaces de noms Linux séparés : utilisateur, montage, processus, réseau, IPC,
  UTS et cgroup. Pas de privilège administrateur ; `no_new_privs` conservé.
- Système minimal : `/usr` en lecture seule et bibliothèques système ; pas de
  montage des données applicatives, des secrets, du dossier utilisateur réel,
  de SSH ni de la configuration globale Codex.
- Workspaces explicitement choisis, montés sous `/workspace/0`, `/workspace/1`,
  etc. Le répertoire par défaut est obligatoirement dans l’un de ces dossiers.
  Les racines trop larges, protégées ou imbriquées sont refusées.
- Sources de montage épinglées par descripteurs de répertoires, puis fermées
  avant l’exécution de la charge utile. Cela réduit les échanges de chemins
  entre la validation et le montage, sans résoudre tous les changements
  concurrents à l’intérieur des dossiers.
- Environnement reconstruit sans variables héritées ; `HOME` et `CODEX_HOME`
  temporaires vides. Entrée standard fermée et aucun descripteur applicatif
  transmis à la charge utile.
- **MCP désactivé** : aucun client MCP réel n’est démarré. Aucun jeton ni
  configuration MCP globale n’est transmis. Le filtre bloque les sockets réseau,
  Unix par chemin, Unix abstraites et `socketpair`, y compris vers une socket
  présente dans un workspace. Aucun serveur MCP d’administration n’est modifié.
- Filtre seccomp sur Linux x86_64 : réseau, changements de montage/espace de
  noms, `ptrace`, accès mémoire interprocessus, récupération de descripteurs,
  `io_uring` et autres interfaces sensibles refusés. L’ABI x32 et les autres
  architectures sont refusées. `clone3` renvoie `ENOSYS` pour que glibc puisse
  créer des sous-processus ordinaires avec les protections héritées.
- Limites expérimentales : 512 Mio d’espace virtuel par processus, 5 secondes
  CPU, fichiers de 16 Mio maximum, 128 descripteurs, limite `NPROC` à 256,
  aucun fichier de vidage mémoire, sorties plafonnées et délai mural limité.
- Arrêt du groupe et destruction de l’espace de processus à l’expiration du
  délai, y compris pour les descendants utilisant `setsid` et un double fork.

Les logiciels autorisés peuvent écrire dans les workspaces ainsi que dans leurs
répertoires temporaires isolés. Le prototype n’essaye pas de rendre l’exécution
de tout programme impossible : il en limite les ressources accessibles.

## Lancer les tests

Les tests unitaires ne nécessitent pas Linux :

```sh
node --test scripts/sandbox/bubblewrap.test.cjs
```

Les essais réels exigent Linux x86_64, Node.js, Python système,
`/usr/bin/bwrap` compatible avec `--bind-fd` et `--disable-userns`, ainsi que
`/usr/bin/prlimit`. Dans une image contenant ces scripts :

```sh
docker exec codex-webui node /app/scripts/sandbox/self-test.cjs
```

Cette commande ne crée aucun conteneur. Elle démarre des processus dans
`codex-webui`, avec l’utilisateur non privilégié du conteneur. Elle ne lance pas
de véritable requête IA et ne consomme pas de quota de modèle. Les seuls
serveurs joints sont des écouteurs factices temporaires créés par le test.

Le script commence par prouver que les écouteurs de contrôle sont joignables
hors sandbox et que la sandbox peut écrire dans le dossier autorisé. Si elle
ne démarre pas, il échoue immédiatement : le refus de toutes les opérations
n’est jamais présenté comme une isolation fonctionnelle réussie.

Le résultat JSON sépare `passed` (contrôles du prototype conformes aux attentes)
de `productionReady` et `isolationValidatedForStandardUsers`, toujours à
`false`. Un contrôle est volontairement documentaire : il montre la limite des
liens physiques préexistants, au lieu de prétendre les bloquer.

Si un prérequis manque, ne pas ajouter `privileged`, `SYS_ADMIN`, une politique
seccomp globale permissive ou une exécution non isolée pour faire passer les
tests. Analyser le refus et conserver l’accès standard fermé.

## Limites bloquantes avant intégration

1. **Liens physiques et écritures concurrentes.** Un fichier sensible déjà
   relié par un lien physique dans un dossier autorisé devient lisible par ce
   chemin. Il faut une stratégie de stockage, de propriétaires/UID et de
   provisionnement empêchant ces liens et les modifications concurrentes hors
   sandbox. Un simple contrôle `realpath` ou un scan ponctuel ne suffit pas.
2. **Quotas réellement individuels.** Les limites `AS` et CPU sont par
   processus, `NPROC` compte les processus du même utilisateur et le namespace
   cgroup ne crée pas un quota. Il manque des plafonds agrégés par exécution ou
   projet pour éviter l’épuisement des ressources partagées de l’application.
3. **Moteur IA et MCP.** L’app-server actuel conserve un environnement et des
   clients MCP globaux. Il ne doit pas servir de moteur aux standards. Il faut
   un processus et un état séparés, sans authentification administrateur
   réutilisable, puis un canal contrôlé pour les seuls appels IA autorisés.
   La configuration locale des projets, les plugins, les skills et les serveurs
   MCP embarqués devront être explicitement maîtrisés ; un `CODEX_HOME` neuf ne
   prouve pas à lui seul qu’un client réel n’en découvrira aucun.
4. **Autorisation personne/projet.** Les accès actuels aux chemins ne suffisent
   pas à isoler les participants par projet. Chaque accès aux fichiers,
   threads, abonnements WebSocket et opérations différées devra vérifier le
   contexte personne/projet fourni par le serveur.
5. **Tous les chemins d’exécution.** Création, reprise, déplacement, branches,
   sous-agents, tâches planifiées, approbations et terminaux devront rester
   dans ce même périmètre, sans possibilité de revenir au moteur global.
6. **Compatibilité applicative.** Le prototype exécute Python et des commandes
   système, pas encore Codex, les outils Office, Node.js de développement ou
   une véritable tâche IA. Les limites mémoire et le système minimal devront
   être adaptés et retestés, sans ajouter les secrets au périmètre.

## Références

- [Modèle de sécurité Bubblewrap](https://github.com/containers/bubblewrap#sandbox-security)
- [Landlock, protection complémentaire éventuelle](https://docs.kernel.org/userspace-api/landlock.html)

Landlock n’est pas activé par ce prototype. La présence et les options du noyau
doivent être vérifiées avant d’en faire une exigence de sécurité.

## Résultat de l’essai de référence

Le prototype a été exécuté dans le conteneur applicatif existant, sans
redémarrage ni changement de droits Docker, avec l’utilisateur non privilégié,
Bubblewrap 0.12.0 et le noyau Linux 6.18.38-Unraid, en x86_64.

- 8 tests unitaires réussis localement et sur Linux ;
- 19 contrôles réels conformes au résultat attendu, dont un **constat de limite**
  sur les liens physiques préexistants (ce contrôle ne prouve pas leur blocage) ;
- 25 tests existants des protections HTTP/WebSocket et de l’identité réussis ;
- aucune connexion reçue par les services MCP factices depuis la sandbox ;
- aucun nouveau conteneur ni modification d’un projet ou d’identifiants réels.

Les premiers essais ont identifié deux incompatibilités corrigées sans ouvrir
les droits du conteneur : retrait d’un changement de nom de machine inutile et
renvoi de `ENOSYS` pour `clone3`, afin de conserver les créations de
sous-processus ordinaires sous le même filtre.

**Conclusion : prototype hors ligne fonctionnel, isolation des agents réels et
ouverture aux utilisateurs standards non validées.** Les limites de stockage,
quotas et intégration citées plus haut restent des étapes obligatoires.
