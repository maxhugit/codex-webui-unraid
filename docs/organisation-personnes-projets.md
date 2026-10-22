# Organisation des personnes dans les projets

La section **Participants** des paramètres d’un projet regroupe trois notions
distinctes : les participants, le chef de projet et les groupes de personnes.
Ces informations servent à organiser le travail sans créer de nouveau rôle de
sécurité.

## Participants et droits d’accès

Un utilisateur standard actif accède à un projet uniquement s’il figure parmi
ses participants. Les tâches, livrables, conversations, documents, connaissances
et workspaces héritent de ce périmètre. Les administrateurs conservent un accès
global.

Seul un administrateur peut ajouter ou retirer un participant, choisir le chef de
projet ou modifier les groupes. Un participant peut consulter cette organisation.
La politique complète, y compris la révocation des sessions ouvertes, est décrite
dans [Droits d’accès aux projets](droits-acces-projets.md).

## Chef de projet

Un projet peut désigner un seul chef de projet parmi ses participants actifs.
Cette désignation est informative : elle n’accorde aucun droit supplémentaire et
ne remplace pas le rôle administrateur. Choisir un autre chef remplace
l’affectation précédente.

Retirer le chef de projet des participants efface automatiquement cette
désignation. La modification apparaît dans l’activité du projet.

## Groupes de personnes

Les groupes sont propres à un projet. Ils préparent notamment de futurs usages
autour des livrables et permettent de conserver une organisation métier comme
« Direction », « Validation » ou « Équipe technique ».

Un groupe possède un nom unique dans le projet et peut contenir jusqu’à
500 participants actifs de ce projet. Une même personne peut appartenir à
plusieurs groupes. Retirer un participant du projet le retire aussi de tous les
groupes concernés, sans supprimer ces groupes.

Dans la version actuelle, un groupe ne filtre pas les livrables, fichiers,
conversations ou tâches et ne donne aucun accès supplémentaire. Les droits
reposent toujours sur le rôle administrateur et la participation au projet. Un
lien ou une affectation ne constitue pas une autorisation.

## Affectations historiques

Retirer ou désactiver une personne empêche de créer de nouvelles affectations à
son nom. Les affectations existantes sur les tâches et livrables sont conservées
comme information historique et peuvent ensuite être retirées manuellement.

## Stockage et sauvegarde

La migration SQLite `0038_serious_black_widow` ajoute les tables du chef de
projet, des groupes et de leurs membres. Ces données sont dans la base WebUI et
sont sauvegardées avec `STATE_ROOT/home` selon la
[procédure de sauvegarde](sauvegarde-restauration.md).
