# AGENTS.md — Noctambouffe
Projet : annuaire sarcastique des restaurants ouverts entre 23h et 6h (Paris, Île-de-France), avec un chat « Le Veilleur de Nuit » et une carte.
Stack : Node 22+, Express 5, SQLite (better-sqlite3), front HTML/CSS/JS vanilla, Leaflet pour la carte. Pas de framework, pas de Tailwind.
Lancer : npm install puis npm start (PORT dans .env). Tests : npm test. Import de lieux : npm run import ou npm run import:idf.
Fichiers : server.js (API et validation), database.js (SQL), veilleur.js (règles horaires et chat), osm.js, import-osm.js, geocode.js (OpenStreetMap), public/ (interface).
Règles :
- Toute entrée utilisateur est validée côté serveur (validateSpot dans server.js) ; l'interface n'est jamais la seule barrière.
- SQL uniquement paramétré : jamais de valeur concaténée dans une requête.
- Affichage des données uniquement via textContent, jamais innerHTML. Les bulles de la carte sont construites en éléments DOM.
- Aucun secret dans le dépôt : configuration par .env, documentée dans .env.example.
- Décret de 23h : un spot doit être ouvert à un moment entre 23h et 6h ; passage de minuit géré ; sinon erreur 422.
- Le Veilleur est cynique et sarcastique : il insulte les horaires, l'appétit et les choix de vie, jamais le physique ni un groupe de personnes.
- Aucune dépendance ajoutée sans vérifier qu'elle existe sur npm. Pas de TODO, pas de code commenté.
- Une fonctionnalité à la fois, un commit par fonctionnalité, npm test avant chaque commit.
Hors périmètre : authentification, déploiement, IA générative externe, historique de chat.
