'use strict';
/**
 * Accès à la base SQLite (fichier local, via better-sqlite3).
 * Toutes les requêtes sont paramétrées : aucune valeur utilisateur
 * n'est jamais concaténée dans le SQL.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const IN_MEMORY = process.env.DB_PATH === ':memory:';
const dbPath = IN_MEMORY
  ? ':memory:'
  : path.resolve(process.env.DB_PATH || path.join(__dirname, 'data', 'noctambouffe.db'));

if (!IN_MEMORY) fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS spots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nom        TEXT NOT NULL,
    type       TEXT NOT NULL,
    adresse    TEXT NOT NULL,
    ouverture  TEXT NOT NULL,   -- "HH:MM"
    fermeture  TEXT NOT NULL,   -- "HH:MM" (peut être le lendemain)
    badge      TEXT NOT NULL,
    roast      TEXT NOT NULL,
    lat        REAL,            -- GPS (null pour un spot ajouté à la main)
    lon        REAL,
    source     TEXT NOT NULL DEFAULT 'manuel',  -- 'manuel' ou 'osm' (OpenStreetMap)
    osm_id     TEXT,            -- ex : "node/123456" (évite les doublons à l'import)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (nom COLLATE NOCASE, adresse COLLATE NOCASE)
  );
`);

// Migration : une base créée avec l'ancienne version reçoit les nouvelles colonnes (données conservées).
const existing = new Set(db.prepare('PRAGMA table_info(spots)').all().map((c) => c.name));
const ADDED_COLUMNS = { lat: 'REAL', lon: 'REAL', source: "TEXT NOT NULL DEFAULT 'manuel'", osm_id: 'TEXT' };
for (const [name, definition] of Object.entries(ADDED_COLUMNS)) {
  if (!existing.has(name)) db.exec(`ALTER TABLE spots ADD COLUMN ${name} ${definition}`);
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_spots_osm_id ON spots (osm_id) WHERE osm_id IS NOT NULL');

const COLUMNS = 'id, nom, type, adresse, ouverture, fermeture, badge, roast, lat, lon, source, created_at';

/**
 * Liste paginée des spots, avec recherche texte (q) et filtre de type optionnels.
 * Renvoie { spots, total, page, pages } ; la page demandée est ramenée dans les bornes.
 */
function listSpots({ q, type, page = 1, limit = 24 } = {}) {
  const where = ['1 = 1'];
  const params = [];
  if (q) {
    // On échappe % et _ pour que la recherche soit littérale.
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    where.push("(nom LIKE ? ESCAPE '\\' OR adresse LIKE ? ESCAPE '\\' OR badge LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  if (type) {
    where.push('type = ?');
    params.push(type);
  }
  const clause = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM spots WHERE ${clause}`).get(...params).n;
  const pages = Math.max(1, Math.ceil(total / limit));
  const current = Math.min(Math.max(1, page), pages);
  // Les spots ajoutés à la main d'abord, puis les plus récents.
  const spots = db
    .prepare(
      `SELECT ${COLUMNS} FROM spots WHERE ${clause}
       ORDER BY (source = 'manuel') DESC, created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, (current - 1) * limit);
  return { spots, total, page: current, pages };
}

/** Tous les spots, colonnes réduites : sert au Veilleur pour choisir parmi tout l'annuaire. */
function listForChat() {
  return db.prepare('SELECT id, nom, type, adresse, ouverture, fermeture, roast, lat, lon FROM spots').all();
}

function getSpot(id) {
  return db.prepare(`SELECT ${COLUMNS} FROM spots WHERE id = ?`).get(id) || null;
}

function createSpot(v) {
  const info = db
    .prepare(
      `INSERT INTO spots (nom, type, adresse, ouverture, fermeture, badge, roast)
       VALUES (@nom, @type, @adresse, @ouverture, @fermeture, @badge, @roast)`,
    )
    .run(v);
  return getSpot(info.lastInsertRowid);
}

/** Met à jour un spot ; renvoie le spot modifié, ou null s'il n'existe pas. */
function updateSpot(id, v) {
  const info = db
    .prepare(
      `UPDATE spots SET nom = @nom, type = @type, adresse = @adresse, ouverture = @ouverture,
              fermeture = @fermeture, badge = @badge, roast = @roast WHERE id = @id`,
    )
    .run({ ...v, id });
  return info.changes ? getSpot(id) : null;
}

function deleteSpot(id) {
  return db.prepare('DELETE FROM spots WHERE id = ?').run(id).changes > 0;
}

/** Violation de la contrainte UNIQUE (nom + adresse) ? */
function isUniqueError(err) {
  return Boolean(err && typeof err.code === 'string' && err.code === 'SQLITE_CONSTRAINT_UNIQUE');
}

/** Spots de démonstration — entièrement fictifs (noms et adresses inventés). */
const DEMO_SPOTS = [
  { nom: 'Le Kebab du Dernier Métro', type: 'Kebab', adresse: '11 rue de la Fringale, 75011 Paris', ouverture: '18:00', fermeture: '05:00', badge: 'Roi de la sauce blanche', roast: 'Le gars derrière le comptoir t\'a jugé trois fois avant que tu finisses ta commande.' },
  { nom: 'Smash & Regrets', type: 'Burger', adresse: '4 passage des Remords, 75018 Paris', ouverture: '19:00', fermeture: '03:00', badge: 'Cheeseburger de la honte', roast: 'Le burger est gras, le service est sec, et tu reviendras quand même.' },
  { nom: 'Pizza Insomnie', type: 'Pizza', adresse: '27 avenue du Crépuscule, 93100 Montreuil', ouverture: '20:00', fermeture: '02:00', badge: 'Four à bois, âme en peine', roast: 'La pâte lève mieux que toi, et elle est moins en retard.' },
  { nom: 'Nouilles de Minuit', type: 'Asiatique', adresse: '8 rue des Veilleurs, 75013 Paris', ouverture: '22:00', fermeture: '04:00', badge: 'Ramen des désespérés', roast: 'Le bouillon fume, comme ton cerveau à cette heure-là.' },
  { nom: 'Le Bouillon des Nuits Blanches', type: 'Bistrot', adresse: '2 place du Zinc, 75010 Paris', ouverture: '17:00', fermeture: '06:00', badge: 'Soupe à l\'oignon obligatoire', roast: 'Un bistrot qui ne ferme jamais : le seul dans ta vie à te tenir compagnie.' },
  { nom: 'Falafel Fantôme', type: 'Libanais', adresse: '15 rue du Dernier Rideau, 75019 Paris', ouverture: '00:00', fermeture: '00:00', badge: 'Non-stop et sans pitié', roast: 'Ouvert 24h/24, comme ton absence totale de projet pour demain.' },
  { nom: 'Tacos Sans Pitié', type: 'Tacos', adresse: '33 boulevard de l\'Aube, 94200 Ivry-sur-Seine', ouverture: '21:00', fermeture: '05:30', badge: 'Sauce fromagère à vie', roast: 'Le tacos pèse plus lourd que tes excuses, et il a plus de caractère.' },
  { nom: 'La Fournée Zéro', type: 'Snack', adresse: '6 rue du Levain, 75012 Paris', ouverture: '02:00', fermeture: '11:00', badge: 'Premier croissant, dernière dignité', roast: 'Le boulanger se lève pour travailler. Toi, tu ne t\'es juste pas couché.' },
];

/** Insère les spots de démo absents ; renvoie le nombre de spots ajoutés. */
function insertDemoSpots() {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO spots (nom, type, adresse, ouverture, fermeture, badge, roast)
     VALUES (@nom, @type, @adresse, @ouverture, @fermeture, @badge, @roast)`,
  );
  const run = db.transaction((spots) => spots.reduce((n, s) => n + insert.run(s).changes, 0));
  return run(DEMO_SPOTS);
}

/**
 * Import en masse (OpenStreetMap). Les spots déjà connus (même osm_id, ou même nom + adresse)
 * sont ignorés : relancer l'import ne crée jamais de doublon et n'écrase aucune modification.
 * Renvoie le nombre de spots réellement ajoutés.
 */
function importSpots(spots) {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO spots (nom, type, adresse, ouverture, fermeture, badge, roast, lat, lon, source, osm_id)
     VALUES (@nom, @type, @adresse, @ouverture, @fermeture, @badge, @roast, @lat, @lon, 'osm', @osm_id)`,
  );
  const run = db.transaction((list) => list.reduce((n, s) => n + insert.run(s).changes, 0));
  return run(spots);
}

function countSpots() {
  return db.prepare('SELECT COUNT(*) AS n FROM spots').get().n;
}

function close() {
  db.close();
}

module.exports = { listSpots, listForChat, importSpots, countSpots, getSpot, createSpot, updateSpot, deleteSpot, isUniqueError, insertDemoSpots, close };
