# Installation avec les formulaires Docker standard d'Unraid

Cette méthode est recommandée pour l'exploitation quotidienne. Les trois
conteneurs apparaissent séparément dans l'onglet **Docker** d'Unraid et peuvent
être mis à jour avec l'action standard **Check for Updates / Update**.

Les trois formulaires conservent l'architecture de sécurité existante :

1. `codex-web-squid` filtre les accès sortants avec Squid ;
2. `codex-webui` exécute l'application sans publier son port ;
3. `codex-web-ingress` relie Traefik/Authentik au backend isolé.

## 1. Installer les fichiers

Dans le terminal Unraid :

```bash
git clone https://github.com/maxhugit/codex-webui-unraid.git /tmp/codex-webui-install
mkdir -p /mnt/pool/appdata/codex-web/config
cp -a /tmp/codex-webui-install/deployment/config/. \
  /mnt/pool/appdata/codex-web/config/
cp /tmp/codex-webui-install/deployment/docker-man/my-*.xml \
  /boot/config/plugins/dockerMan/templates-user/
cp /tmp/codex-webui-install/deployment/docker-man/prepare-networks.sh \
  /mnt/pool/appdata/codex-web/prepare-networks.sh
cp /tmp/codex-webui-install/deployment/docker-man/reconcile-networks.sh \
  /mnt/pool/appdata/codex-web/reconcile-networks.sh
chmod 700 /mnt/pool/appdata/codex-web/prepare-networks.sh \
  /mnt/pool/appdata/codex-web/reconcile-networks.sh
```

Les valeurs proposées par les formulaires utilisent `/mnt/pool`. Si le pool
Appdata porte un autre nom, modifier les chemins dans chaque formulaire avant
de cliquer sur **Apply**, ainsi que le chemin du profil `seccomp=` dans
**Extra Parameters** du formulaire `codex-webui`.

## 2. Préparer les données et les secrets

Si l'installation Compose existe déjà, conserver le dossier `state` actuel et
passer directement à la section suivante.

Pour une nouvelle installation :

```bash
STATE=/mnt/pool/appdata/codex-web/state
mkdir -p "$STATE"/{home,workspace,logs,ssh}
openssl rand -hex 48 > "$STATE/backend-token.txt"
cp "$STATE/backend-token.txt" "$STATE/backend-token-nginx.txt"
install -m 440 /dev/null "$STATE/openai-api-key.txt"
editor "$STATE/openai-api-key.txt"
chown -R 11002:11002 "$STATE/home" "$STATE/workspace" "$STATE/logs" "$STATE/ssh"
chmod 700 "$STATE/ssh"
chmod 400 "$STATE/backend-token.txt" "$STATE/backend-token-nginx.txt"
chmod 440 "$STATE/openai-api-key.txt"
```

Les deux fichiers `backend-token*.txt` doivent contenir exactement la même
valeur. Aucun secret ni contenu de `state` ne doit être ajouté à Git.

## 3. Préparer les réseaux

Traefik et Authentik doivent déjà appartenir au réseau `net_standard`. Exécuter
ensuite le script idempotent :

```bash
/mnt/pool/appdata/codex-web/prepare-networks.sh
```

Il crée ou vérifie :

- `codex_isolated`, réseau interne sans accès Internet direct ;
- `codex_external`, réseau de sortie de Squid ;
- `codex_admin`, réseau administratif `172.30.44.0/28` ;
- `net_standard`, réseau partagé existant de Traefik et Authentik.

Le script s'arrête sans modifier un réseau existant si sa configuration ne
correspond pas à celle attendue.

Lancer ensuite le réconciliateur depuis l'Appdata :

```bash
nohup /mnt/pool/appdata/codex-web/reconcile-networks.sh watch \
  >> /var/log/codex-webui-network-reconciler.log 2>&1 &
```

Il contrôle périodiquement la topologie Docker. Après chaque création ou mise à
jour DockerMan, il rattache automatiquement les réseaux secondaires suivants :

- `codex-webui` à `codex_admin` ;
- `codex-web-ingress` à `net_standard` ;
- `codex-web-squid` à `codex_external`.

Les trois conteneurs démarrent volontairement sur `codex_isolated`. Cette
méthode est nécessaire car Docker n'accepte qu'un réseau de démarrage dans la
commande créée par DockerMan. Une connexion ajoutée manuellement avec
`docker network connect` disparaîtrait à la prochaine recréation du conteneur.

Cette procédure ne modifie jamais la clé USB `/boot`. Le processus reste actif
jusqu'au prochain redémarrage complet d'Unraid ; après un redémarrage, relancer
la commande ci-dessus avant la prochaine mise à jour DockerMan. Pour une gestion
des réseaux entièrement automatique au redémarrage sans script hôte, utiliser
la variante Compose Manager décrite dans `UNRAID.md`.

## 4. Migrer depuis Compose Manager

Ne pas exécuter simultanément les versions Compose et DockerMan : elles portent
les mêmes noms de conteneurs et utilisent les mêmes données.

1. sauvegarder `/mnt/pool/appdata/codex-web/state/home` ;
2. désactiver l'autostart de l'ancienne stack dans Compose Manager ;
3. arrêter la stack ;
4. supprimer uniquement les trois anciens conteneurs, sans supprimer `state` ;
5. exécuter `prepare-networks.sh` ;
6. créer les trois conteneurs avec les formulaires ci-dessous.

Les volumes persistants ne sont pas supprimés quand un conteneur est retiré.
Éviter néanmoins toute action visant le dossier Appdata.

## 5. Ajouter les trois conteneurs

Dans **Docker**, cliquer sur **Add Container**, puis sélectionner successivement
les modèles dans **Template** :

1. `codex-web-squid` ;
2. `codex-webui` ;
3. `codex-web-ingress`.

Activer **Advanced View**, vérifier les chemins proposés, puis cliquer sur
**Apply** pour chacun. Aucun port et aucune option `--network` ne doivent être
ajoutés manuellement dans **Extra Parameters**. Le réconciliateur ajoute les
réseaux secondaires dès que DockerMan recrée un conteneur Codex.

Dans les options d'autostart d'Unraid, conserver le même ordre. Un délai court
entre les conteneurs est acceptable, mais les contrôles de santé restent la
référence pour vérifier qu'ils sont prêts.

Adapter enfin l'adresse **WebUI** du formulaire `codex-webui` à l'URL publique
réelle, par exemple `https://codex.example.com`.

## 6. Vérifier le déploiement

```bash
docker inspect codex-web-squid --format '{{.State.Health.Status}}'
docker inspect codex-webui --format '{{.State.Health.Status}}'
docker inspect codex-web-ingress --format '{{.State.Health.Status}}'
docker network inspect codex_isolated
/mnt/pool/appdata/codex-web/reconcile-networks.sh once
curl -I https://codex.example.com
```

Le backend `codex-webui` ne doit avoir aucun port publié. Traefik doit joindre
uniquement `codex-web-ingress:8080` sur `net_standard`.

## 7. Mettre à jour et revenir en arrière

Le formulaire principal utilise
`ghcr.io/maxhugit/codex-webui-unraid:latest`. Dans l'onglet **Docker** :

1. lancer **Check for Updates** ;
2. choisir **Update** sur `codex-webui` ;
3. attendre que son état redevienne `healthy` ;
4. tester la connexion, une conversation et les intégrations.

Cette opération télécharge l'image et recrée seulement le conteneur ; les
données restent dans `/mnt/pool/appdata/codex-web/state`.

Pour un retour arrière, remplacer temporairement `latest` dans le champ
**Repository** par le tag immuable `sha-<commit>` précédemment validé, puis
cliquer sur **Apply**.

Les formulaires Ingress et Squid utilisent respectivement `nginx:stable` et
`ubuntu/squid:latest`. Unraid peut ainsi signaler leurs nouvelles versions avec
**Check for Updates**. Une mise à jour reste manuelle : vérifier les mises à
jour proposées, lancer **Update**, puis contrôler que les trois conteneurs sont
de nouveau `healthy` et que l'interface publique répond correctement.

Le réconciliateur est installé dans
`/mnt/pool/appdata/codex-web/reconcile-networks.sh`. Son journal est disponible
dans `/var/log/codex-webui-network-reconciler.log`. Aucun fichier de la clé USB
Unraid n'est créé ou modifié par cette procédure.
