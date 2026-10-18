# Configuration des intégrations

## Navigation d’administration et outils d’exploitation

L’entrée **Paramètres** de l’en-tête (menu « … » sur mobile) ouvre une
navigation latérale dédiée. **Administration** regroupe les réglages généraux
du serveur, les personnes, le compte, Codex, le chat simple, les réglages des
fichiers et du terminal, la sécurité et les intégrations.
**Outils d’exploitation** donne accès au navigateur global de fichiers et au
terminal global. Ces deux outils ne figurent plus dans la navigation des projets.
Les explorateurs et terminaux des conversations ne sont pas modifiés.

Pendant la session du navigateur, quitter puis rouvrir **Fichiers** conserve
son dossier, le document affiché et la vue (dont le défilement). L’explorateur
global dispose d’un état séparé de ceux des conversations. La vue conservée est
masquée et inactive quand une autre page est affichée. Les changements de nom
et suppressions de fichiers continuent à être répercutés.
**Terminal** conserve déjà ses onglets, la sélection et ses instances attachées
au niveau de la session authentifiée ; naviguer vers une autre page ne ferme
pas les shells. Cette conservation ne garantit pas la survie d’un shell après
redémarrage du serveur ou fermeture complète du navigateur.

Chaque rubrique de réglage dispose d’un lien `/settings?section=…`.
Sur mobile, le bouton de navigation de l’en-tête ouvre le
même menu et la sélection d’une rubrique le referme.

## Personnes, connexion et rôles

Une fiche exige une référence manuelle unique, un prénom, un nom, une adresse
e-mail unique et un numéro de téléphone. Le nom complet est calculé côté serveur
(`Prénom Nom`) ; il n’est pas saisissable. Le rôle par défaut est **Standard**.
Les anciennes fiches sont conservées ; leurs nouveaux champs doivent être
complétés avant leur prochaine modification.

Le proxy Nginx récupère l’identifiant stable et l’e-mail depuis la réponse de son
propre contrôle Authentik, puis écrase les en-têtes d’identité du navigateur.
À la première connexion, une fiche standard active préalablement créée peut être liée par
égalité de l’e-mail, sans tenir compte de la casse. Ensuite seul l’identifiant
stable sert à reconnaître la personne. Les connexions administrateurs exigent
toujours une liaison explicite par identifiant stable via l’outil serveur décrit
ci-dessous : une simple égalité d’e-mail ne suffit pas. Aucune fiche et aucun rôle administrateur
ne sont créés automatiquement. Une fiche déjà liée ne peut pas être récupérée
par un autre identifiant présentant le même e-mail. Une fiche standard déjà liée
peut être promue administrateur par un administrateur existant, après vérification
de la personne : son identifiant stable est alors déjà connu.

En déploiement Unraid, `WEBUI_REQUIRE_IDENTITY=true` refuse toute session humaine
sans identité du proxy. Le backend ne doit pas publier son port sur le réseau
externe. Le jeton technique de déploiement reste un secret administrateur, réservé
aux services internes ; il n’est ni transmis au navigateur ni aux utilisateurs.
Un déploiement local sans cette option conserve le mode historique à clé API,
qui est un accès technique administrateur, pas un compte utilisateur standard.

Les rôles sont relus en base pour chaque requête. Les réglages, intégrations,
informations de compte serveur, journaux techniques et modifications des personnes
sont réservés aux administrateurs côté API, en plus de la protection des pages.
Les listes de personnes servies aux standards ne contiennent pas les coordonnées
ni les identifiants de connexion. Les requêtes de fichiers standards restent
limitées aux workspaces des projets, avec vérification des liens symboliques.
`WEBUI_PROTECTED_PATHS` exclut en plus les répertoires privés du serveur, même
si un projet référence un parent trop large. Adapter en particulier l’alias
`/appdata/codex-web` si le dossier d’installation change ; les secrets et la base
ne doivent jamais devenir des fichiers de projet accessibles aux standards.

Sans isolation système par utilisateur, un répertoire de travail n’est pas une
barrière de sécurité pour un shell ou un agent. Les exécutions d’agents,
automatisations serveur et terminaux (globaux et de conversation) sont donc
réservées aux administrateurs dans ce premier lot. Les standards peuvent utiliser
le chat simple et gérer les tâches manuelles. Leurs appels directs d’exécution
sont refusés côté REST et WebSocket, pas seulement masqués par l’interface.
Ce contrôle de rôles ne remplace pas une future isolation système des agents,
ni une gestion d’autorisations par projet.

Une désactivation ou un changement de rôle déconnecte les sockets de la personne.
Le navigateur revérifie aussi périodiquement son identité. Le dernier
administrateur actif disposant d’une connexion liée ne peut pas être désactivé ou
rétrogradé depuis le formulaire s’il n’existe aucun autre administrateur actif
déjà lié. Une fiche administrateur encore non liée ne constitue pas une relève.

### Initialisation et récupération administrateur

Après démarrage de l’image (et migration de la base), un administrateur Unraid
peut provisionner la première fiche depuis un fichier JSON **privé, hors Git** :

```json
{
  "reference": "ADM-001",
  "firstName": "Prénom",
  "lastName": "Nom",
  "email": "admin@example.com",
  "phone": "+33600000000",
  "role": "administrator",
  "active": true
}
```

```sh
docker exec -i codex-webui node /app/scripts/provision-person.cjs < personne-privee.json
```

Ce programme requiert un accès privilégié au conteneur et réutilise la validation
du serveur. Il ne journalise pas les coordonnées. Sauvegarder d’abord la base et
protéger puis retirer le fichier privé après utilisation. En cas de différence
entre l’e-mail de la fiche et celui d’Authentik, ne pas forcer une correspondance
depuis le navigateur : un administrateur peut fournir au même programme le champ
`identitySubject`, lu sur la page `/api/auth/me` après authentification. Cette
liaison explicite doit être vérifiée humainement. Un identifiant déjà lié à une
autre personne est refusé.

### Prévisualisation des documents

Les prévisualisations interactives utilisent `/api/files/preview` et restent
authentifiées par Authentik. OnlyOffice télécharge via `/api/files/serve` avec un
jeton signé valable une heure, limité au chemin du document. Le jeton général de
l’application n’apparaît plus dans la configuration de l’éditeur. Le retour de
sauvegarde OnlyOffice conserve sa validation JWT et son état signé.

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
