# 🌙 Noctambouffe

Annuaire sarcastique pour trouver où manger **après 23h** à Paris et en Île-de-France.
L'expérience principale est une conversation avec **Le Veilleur de Nuit** : cynique, blasé, sans pitié pour tes horaires ni ta dalle.

> Projet fil rouge « Coder à l'ère de l'IA ». Node.js + Express, SQLite, HTML/CSS/JavaScript vanilla, sans authentification.

## Lancer le projet

**Prérequis** : [Node.js](https://nodejs.org) **version 22 ou plus** (vérifie avec `node -v`). Rien d'autre : pas de clé d'API, pas de compte, pas de base à installer.

```bash
git clone <url-du-depot> noctambouffe
cd noctambouffe
npm install && npm start
```

Puis ouvre **http://localhost:3000**.

À la première ouverture, l'annuaire est vide (c'est voulu). Deux façons de le remplir :

1. **Vrais restaurants (recommandé)** : voir la section « Importer des centaines de vrais spots » ci-dessous.
2. **Test rapide hors connexion** : sur la page « Les spots », clique sur **Charger des spots de démo**. Ces 8 spots sont **entièrement fictifs**.

## Importer des centaines de vrais spots (gratuit)

Les lieux viennent d'**OpenStreetMap** via l'API **Overpass** : gratuite, sans compte, sans clé, sans carte bancaire.

Dans un **second terminal** (le serveur peut rester allumé) :

```bash
npm run import          # Paris et petite couronne (rapide)
npm run import:idf      # toute l'Île-de-France : Val-d'Oise, Yvelines, Essonne, Seine-et-Marne… (plus long, plus de spots)
```

`import:idf` contient tout ce que fait `import` : tu peux lancer directement le second, ou l'ajouter après le premier (les spots déjà présents sont ignorés).

L'import prend de 1 à 4 minutes : ne ferme pas le terminal. Il affiche à la fin le nombre de spots ajoutés. Ensuite, recharge la page.

- Seuls les restaurants et fast-foods **nommés** dont les horaires les rendent **ouverts entre 23h et 6h** sont gardés (Décret de 23h).
- Relancer l'import est sans danger : les spots déjà présents sont ignorés, et tes modifications ne sont jamais écrasées.
- Si un serveur Overpass est saturé, le script essaie un second miroir. Si les deux échouent, réessaie dans quelques minutes (ou change de réseau : certains réseaux d'école bloquent l'accès).
- **Zone Île-de-France** : `npm run import:idf` interroge la zone administrative de la région, donc aucun lieu des départements voisins (Yonne, Oise, Eure-et-Loir…). Si cette zone ne répond pas, le script se replie sur un rectangle et écarte alors par **code postal** tout lieu hors Île-de-France (75, 77, 78, 91, 92, 93, 94, 95). **Si tu as importé avant cette correction**, repars d'une base propre : arrête le serveur, supprime le dossier `data/`, puis relance l'import.
- **Limites des données** : les horaires sont ceux saisis par les contributeurs OpenStreetMap, donc parfois faux ou périmés. Un même spot n'a qu'un créneau « typique » (les jours de la semaine ne sont pas distingués). Beaucoup de lieux n'ont pas d'adresse postale : ils reçoivent alors leurs coordonnées GPS à la place. Le badge et le roast des spots importés sont inventés par le Veilleur.
- **Licence** : données © contributeurs OpenStreetMap (ODbL), mention affichée en bas de l'application.

### Configuration (facultative)

Copie `.env.example` en `.env` pour changer :

| Variable  | Défaut                    | Rôle                                         |
| --------- | ------------------------- | -------------------------------------------- |
| `PORT`    | `3000`                    | Port d'écoute                                |
| `HOST`    | `127.0.0.1`               | Adresse d'écoute (`0.0.0.0` = tout le réseau) |
| `DB_PATH` | `./data/noctambouffe.db`  | Fichier SQLite (créé automatiquement)        |

Aucun secret n'est utilisé ni stocké. Le fichier `.env` est ignoré par git.

### Dépannage

- **`Le port 3000 est déjà utilisé`** : mets `PORT=3001` dans `.env`, ou ferme l'autre programme.
- **Erreur à `npm install` sur `better-sqlite3`** : vérifie ta version de Node (`node -v`, 22 minimum). Le module est livré précompilé (Windows, macOS, Linux ; x64 et arm64). Le fichier `.npmrc` du projet empêche npm de lancer une compilation C++ inutile : ne le supprime pas.
- **Repartir de zéro** : arrête le serveur et supprime le dossier `data/`.

## Utilisation

| Écran                | Ce qu'on y fait                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| **Le Veilleur**      | Tu donnes l'heure, ta faim, ton envie. Il répond par un roast et **jusqu'à 3 adresses** (ou un rejet méprisant). Une **carte** avec des épingles numérotées montre où sont les adresses. Le bouton « Autour de moi » trie par distance. |
| **Les spots**        | Liste paginée (24 par page), recherche, filtre par type, « ouvert en ce moment », lien carte, modifier, supprimer. |
| **Ajouter un spot**  | Formulaire complet. Le serveur valide tout. La même page sert à modifier un spot.                   |

Exemples de messages : `Il est 2h30, grosse dalle, un kebab`, `3h du mat, petite faim`, `Minuit pile, un burger vers le 11e`, `20h, une pizza` (rejeté par le Décret).

## Règles métier

- **Décret de 23h** : un spot n'est accepté que s'il est **ouvert à un moment du créneau 23h → 6h**. Un restaurant qui ferme avant 23h (ex : 11:00 → 22:00) est refusé avec une **erreur 422** et un message du Veilleur. Les horaires qui passent minuit sont gérés (18:00 → 02:00 = fermeture le lendemain) ; ouverture = fermeture (00:00 → 00:00) veut dire 24h/24.
  *Choix d'interprétation* : « couvrir le créneau » est lu comme « être ouvert à un moment de ce créneau », sinon presque aucun établissement ne serait admissible. Pour exiger l'ouverture sur tout le créneau, il suffit de remplacer la fonction `coversNight` dans `veilleur.js`.
- **Chat** : l'heure est lue dans le message (`2h30`, `23:15`, `minuit`, `11h du soir`). Sans heure, le Veilleur prend l'heure de Paris. Entre 6h et 23h, il rejette tout (**REJETÉ**, Décret de 23h). La nuit, il choisit parmi les spots **ouverts à cette heure**, en privilégiant le type de cuisine et le quartier demandés, et propose **jusqu'à 3 adresses** (**VALIDÉ**). Si rien n'est ouvert, il donne quand même l'adresse du meilleur candidat, en **REJETÉ**.
- **Chercher dans une commune ou un quartier** : cite-le dans ton message, avec ou sans préposition (`un kebab à Sevran`, `vers Méry sur Oise`, `kebab Châtelet`). Le serveur le localise avec **Nominatim**, le service de géocodage gratuit d'OpenStreetMap, en cherchant d'abord dans **Paris et la petite couronne** (« Châtelet » désigne donc le quartier parisien, pas une commune lointaine), puis dans toute l'Île-de-France. Le Veilleur annonce le lieu compris avec sa ville (« Direction Châtelet, Paris ») : si ce n'est pas le bon, précise (« Châtelet-en-Brie »). Les adresses proposées sont **les plus proches** de ce lieu : on prend le plus petit rayon qui contient assez de spots, élargi si la cuisine demandée n'existe que légèrement plus loin ; un spot lointain de la bonne cuisine ne passe jamais devant des spots à côté. Seul le **nom du lieu** est envoyé à Nominatim (jamais ta position GPS ni le reste du message), avec un cache et au plus une requête par seconde, comme l'exige sa politique d'usage. Un lieu écrit sans préposition n'est retenu que si c'est un quartier, une commune ou une station ; si le lieu est introuvable, le Veilleur le dit et cherche partout ; si Nominatim est indisponible, il continue sans trier. Un lieu cité prime sur le bouton « Autour de moi ».
- **Autour de moi** : si tu actives le bouton, le navigateur te demande l'autorisation de te localiser. Ta position est envoyée avec le message pour trier les résultats par distance, **sans jamais être enregistrée**. Les spots ajoutés à la main n'ont pas de GPS : ils passent après les autres dans ce tri.
- **Doublon** : même nom + même adresse (sans tenir compte de la casse) → erreur 409.
- **Le Veilleur** est un moteur à règles qui pioche dans des banques de répliques : il n'appelle aucune IA externe. Il est donc gratuit, instantané et testable. Ses insultes visent tes horaires, ta dalle et tes choix de vie, pas ton physique.

Format de réponse du Veilleur quand il recommande (champ `recommandation` de `POST /api/chat`, la première proposition ; le champ `recommandations` contient jusqu'à 3 propositions au même format, avec en plus le type, les horaires, le GPS et la distance) :

```json
{
  "nom": "Le Kebab du Dernier Métro",
  "adresse": "11 rue de la Fringale, 75011 Paris",
  "statut": "VALIDÉ",
  "punchline_roast": "3h du mat'. Tes horaires, c'est un cri d'alarme…",
  "badge_attribue": "Gouffre de 3h du mat'"
}
```

## API

| Méthode  | Route               | Rôle                                              | Codes                      |
| -------- | ------------------- | ------------------------------------------------- | -------------------------- |
| `GET`    | `/api/spots`        | Liste paginée (`?q=texte&type=Kebab&page=2&limit=24`) → `{spots, total, page, pages}` | 200, 422 |
| `GET`    | `/api/spots/:id`    | Détail d'un spot                                  | 200, 400, 404              |
| `POST`   | `/api/spots`        | Créer un spot                                     | 201, 409, 422              |
| `PUT`    | `/api/spots/:id`    | Modifier un spot                                  | 200, 400, 404, 409, 422    |
| `DELETE` | `/api/spots/:id`    | Supprimer un spot                                 | 200, 400, 404              |
| `POST`   | `/api/spots/demo`   | Charger les 8 spots de démo (idempotent)          | 201                        |
| `POST`   | `/api/chat`         | Parler au Veilleur (`{"message": "...", "position": {"lat": 48.85, "lon": 2.35}}`, position facultative) | 200, 422 |
| `GET`    | `/api/meta`         | Types de spots autorisés                          | 200                        |

Les erreurs ont toutes la forme `{ "erreur": "…", "champs": { "champ": "message" } }`.

## La carte

Quand le Veilleur propose des adresses, une carte s'affiche sous sa réponse : une **épingle numérotée** par adresse (le numéro est celui de la carte d'adresse), un point bleu pour ta position ou la commune citée, et un bouton **📍 Sur la carte** sur chaque adresse pour centrer l'épingle et ouvrir sa bulle. Les épingles sont ambre quand le spot est ouvert, rouges quand il est fermé à cette heure-là.

- Elle utilise **Leaflet** (bibliothèque libre, licence BSD-2) et les fonds de carte d'**OpenStreetMap** : gratuit, sans clé, sans compte. Leaflet est installé par `npm install` et servi par ton propre serveur ; il n'y a aucun script externe.
- Le **fond de carte demande Internet** (images de `tile.openstreetmap.org`). Sans connexion, un message l'indique et les adresses restent listées sous la carte.
- Seuls les spots **avec coordonnées GPS** ont une épingle : ceux importés d'OpenStreetMap. Un spot ajouté à la main n'a pas de GPS, donc pas d'épingle.
- Respect de la politique d'usage des fonds OpenStreetMap : usage modéré, attribution « © OpenStreetMap » affichée sur la carte. Elle n'est pas faite pour télécharger des fonds de carte en masse.

## Sécurité

- Validation **côté serveur** de tous les champs (types, longueurs, format `HH:MM`, type dans une liste fermée, règle des horaires).
- Requêtes SQL **paramétrées** partout ; la recherche échappe `%` et `_`.
- Contenus affichés via `textContent` uniquement : rien n'est interprété comme du HTML (pas de XSS).
- Politique CSP stricte (aucun script ni style inline, scripts uniquement depuis le serveur), `nosniff`, corps de requête limité à 10 Ko. Seule ouverture vers l'extérieur : les images du fond de carte (`tile.openstreetmap.org`).
- Les bulles de la carte sont construites avec des éléments DOM et `textContent` : un nom de restaurant contenant du HTML s'affiche comme du texte.
- Aucun secret dans le dépôt.

**Risques résiduels connus** : pas d'authentification (tout visiteur peut ajouter, modifier ou supprimer), pas de limitation de débit. C'est conforme au cahier des charges, mais ne pas exposer l'application telle quelle sur Internet.

## Tests

```bash
npm test
```

Trente-trois cas de vérification couvrent : la règle de 23h et le passage de minuit, la lecture des heures et de la faim, les statuts du Veilleur, la base vide, la lecture des horaires et des types OpenStreetMap, les propositions multiples, le tri par distance, le centre de recherche pour la carte, la détection de lieu (avec ou sans préposition), le classement par proximité, le géocodage Paris d'abord (avec un faux serveur local, sans Internet), le filtre hors Île-de-France et la performance (réponse en moins de 300 ms avec 20 000 spots).

## Structure

```
noctambouffe/
├── package.json        scripts npm (start, test) et dépendances
├── .env.example        configuration facultative
├── .npmrc              évite une compilation C++ inutile de better-sqlite3
├── .gitignore
├── database.js         SQLite : schéma, requêtes paramétrées, spots de démo
├── veilleur.js         règles horaires + moteur de réponse du Veilleur
├── osm.js              conversion OpenStreetMap -> spots (horaires, type, adresse)
├── import-osm.js       script d'import (npm run import)
├── geocode.js          nom de commune -> GPS via Nominatim (cache, 1 requête/s)
├── node_modules/leaflet  servi sous /vendor/leaflet (carte), installé par npm install
├── server.js           Express : API, validation, gestion d'erreurs
├── README.md
├── test/
│   ├── veilleur.test.js
│   ├── osm.test.js
│   └── geocode.test.js
└── public/
    ├── index.html      page unique, 3 vues (chat, spots, formulaire)
    ├── style.css       thème nuit ambre/orange
    └── app.js          JavaScript vanilla (routeur, chat, CRUD)
```

Dépendances (toutes installées depuis npm) : `express`, `better-sqlite3`, `dotenv`, `leaflet` (carte). L'import et le géocodage utilisent le `fetch` intégré à Node : aucune dépendance de plus.

## Hors périmètre

Pas d'authentification, pas de déploiement, pas d'appel à une IA externe, pas d'historique de chat conservé (la conversation vit dans la page), pas de carte dans la liste des spots (la carte n'apparaît que dans les réponses du Veilleur), pas de mise à jour automatique des horaires importés.
