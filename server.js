'use strict';
require('dotenv').config({ quiet: true }); // doit passer avant database.js (DB_PATH)

const path = require('path');
const express = require('express');
const db = require('./database');
const veilleur = require('./veilleur');
const geocode = require('./geocode');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const app = express();
app.disable('x-powered-by');

// En-têtes de sécurité de base (pas de script ni de style inline : tout vient de /public).
// Seule ouverture vers l'extérieur : les images du fond de carte d'OpenStreetMap (img-src).
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data: https://tile.openstreetmap.org; script-src 'self'; style-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  next();
});

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));
// Leaflet (bibliothèque de carte) est servi depuis node_modules : aucun script externe, la politique CSP reste « 'self' ».
app.use('/vendor/leaflet', express.static(path.join(__dirname, 'node_modules', 'leaflet', 'dist'), { index: false }));

/* ------------------------------------------------------------------ */
/* Validation (côté serveur : c'est elle qui fait foi)                  */
/* ------------------------------------------------------------------ */

/** Texte propre : caractères de contrôle retirés, espaces normalisés. */
const clean = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '');

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validateSpot(body) {
  const src = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const value = {
    nom: clean(src.nom),
    type: clean(src.type),
    adresse: clean(src.adresse),
    ouverture: clean(src.ouverture),
    fermeture: clean(src.fermeture),
    badge: clean(src.badge),
    roast: clean(src.roast),
  };
  const errors = {};

  const range = (field, label, min, max) => {
    if (!value[field]) errors[field] = `${label} : obligatoire.`;
    else if (value[field].length < min) errors[field] = `${label} : ${min} caractères minimum.`;
    else if (value[field].length > max) errors[field] = `${label} : ${max} caractères maximum.`;
  };
  range('nom', 'Nom', 2, 80);
  range('adresse', 'Adresse', 5, 160);
  range('badge', 'Badge', 2, 40);
  range('roast', 'Roast', 5, 280);

  if (!veilleur.TYPES.includes(value.type)) errors.type = `Type : choisis parmi ${veilleur.TYPES.join(', ')}.`;
  if (!TIME_RE.test(value.ouverture)) errors.ouverture = 'Ouverture : heure invalide (format HH:MM).';
  if (!TIME_RE.test(value.fermeture)) errors.fermeture = 'Fermeture : heure invalide (format HH:MM).';

  // Décret de 23h : le spot doit être ouvert à un moment du créneau 23h -> 6h (passage de minuit géré).
  let veilleurMessage;
  if (!errors.ouverture && !errors.fermeture && !veilleur.coversNight(value.ouverture, value.fermeture)) {
    veilleurMessage = veilleur.validationRoast(value.ouverture, value.fermeture);
    errors.fermeture = 'Le spot doit être ouvert à un moment entre 23h et 6h (Décret de 23h).';
  }

  return { value, errors, veilleurMessage };
}

const validationPayload = ({ errors, veilleurMessage }) => ({
  erreur: veilleurMessage || 'Certains champs sont invalides.',
  veilleur: veilleurMessage || undefined,
  champs: errors,
});

/** id d'URL strictement numérique, sinon null. */
const parseId = (raw) => (/^\d{1,12}$/.test(raw) ? Number(raw) : null);

/** Ajoute l'état « ouvert maintenant » (heure de Paris) à un spot. */
const present = (spot, minute = veilleur.parisMinutes()) => ({
  ...spot,
  ouvert_maintenant: veilleur.isOpenAt(spot.ouverture, spot.fermeture, minute),
});

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

app.get('/api/meta', (req, res) => {
  res.json({ types: veilleur.TYPES });
});

/** Entier d'URL borné (page, limit) ; valeur par défaut si absent ou invalide. */
const intParam = (raw, fallback, min, max) => {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// Liste paginée : GET /api/spots?q=texte&type=Kebab&page=2&limit=24
app.get('/api/spots', (req, res) => {
  const q = clean(typeof req.query.q === 'string' ? req.query.q : '').slice(0, 80);
  const type = clean(typeof req.query.type === 'string' ? req.query.type : '');
  if (type && !veilleur.TYPES.includes(type)) {
    return res.status(422).json({ erreur: 'Type de filtre inconnu.' });
  }
  const limit = intParam(req.query.limit, 24, 1, 60);
  const page = intParam(req.query.page, 1, 1, 1000000);
  const result = db.listSpots({ q, type, page, limit });
  const minute = veilleur.parisMinutes();
  return res.json({ ...result, limit, spots: result.spots.map((s) => present(s, minute)) });
});

// Chargement des spots fictifs de démonstration (idempotent).
app.post('/api/spots/demo', (req, res) => {
  const ajoutes = db.insertDemoSpots();
  res.status(201).json({ ajoutes });
});

app.get('/api/spots/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ erreur: 'Identifiant invalide.' });
  const spot = db.getSpot(id);
  if (!spot) return res.status(404).json({ erreur: 'Ce spot n\'existe pas (ou plus).' });
  return res.json(present(spot));
});

app.post('/api/spots', (req, res) => {
  const result = validateSpot(req.body);
  if (Object.keys(result.errors).length) return res.status(422).json(validationPayload(result));
  try {
    return res.status(201).json(present(db.createSpot(result.value)));
  } catch (err) {
    if (db.isUniqueError(err)) {
      return res.status(409).json({
        erreur: 'Ce spot existe déjà (même nom, même adresse). Même moi je ne me répète pas autant.',
        champs: { nom: 'Doublon : ce spot est déjà dans l\'annuaire.' },
      });
    }
    throw err;
  }
});

app.put('/api/spots/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ erreur: 'Identifiant invalide.' });
  const result = validateSpot(req.body);
  if (Object.keys(result.errors).length) return res.status(422).json(validationPayload(result));
  try {
    const spot = db.updateSpot(id, result.value);
    if (!spot) return res.status(404).json({ erreur: 'Ce spot n\'existe pas (ou plus).' });
    return res.json(present(spot));
  } catch (err) {
    if (db.isUniqueError(err)) {
      return res.status(409).json({
        erreur: 'Un autre spot porte déjà ce nom à cette adresse.',
        champs: { nom: 'Doublon : un autre spot est déjà enregistré ainsi.' },
      });
    }
    throw err;
  }
});

app.delete('/api/spots/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ erreur: 'Identifiant invalide.' });
  if (!db.deleteSpot(id)) return res.status(404).json({ erreur: 'Ce spot n\'existe pas (ou plus).' });
  return res.json({ supprime: id });
});

// Catégories OpenStreetMap acceptées pour un lieu écrit sans préposition (« Châtelet », « Pigalle »).
const PLACE_CATEGORIES = new Set(['place', 'boundary', 'railway', 'public_transport']);

// Position GPS facultative de l'utilisateur : { lat, lon } valides, sinon ignorée.
function parsePosition(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { lat, lon } = raw;
  const valid = typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon);
  return valid && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

// Conversation avec le Veilleur de Nuit : { message, position? } -> jusqu'à 3 propositions.
// Un lieu cité dans le message ("un kebab à Sevran") est géolocalisé et prime sur la position GPS.
app.post('/api/chat', async (req, res) => {
  const message = clean(req.body && req.body.message);
  if (!message) return res.status(422).json({ erreur: 'Écris quelque chose. Le silence, c\'est pas un menu.' });
  if (message.length > 300) return res.status(422).json({ erreur: 'Message trop long (300 caractères max). Je suis blasé, pas patient.' });

  let position = parsePosition(req.body.position);
  let lieu = null;
  // Lieu cité avec une préposition (« à Sevran ») ou « nu » (« kebab Châtelet »).
  const explicit = veilleur.extractPlace(message);
  const place = explicit || veilleur.extractPlaceLoose(message);
  if (place) {
    const found = await geocode.lookup(place); // null = lieu inconnu ; undefined = service indisponible
    // Un lieu « nu » n'est retenu que si c'est un vrai lieu (quartier, commune, station) : pas une rue ni un commerce au hasard.
    const realPlace = found && (explicit || PLACE_CATEGORIES.has(found.categorie));
    if (realPlace) {
      position = { lat: found.lat, lon: found.lon };
      lieu = { nom: found.libelle, trouve: true };
    } else if (explicit && found === null) {
      lieu = { nom: place, trouve: false };
    }
  }
  return res.json(veilleur.decide(message, db.listForChat(), { position, lieu }));
});

app.use('/api', (req, res) => {
  res.status(404).json({ erreur: 'Route inconnue.' });
});

/* ------------------------------------------------------------------ */
/* Erreurs                                                             */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erreur: 'JSON invalide.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ erreur: 'Requête trop volumineuse.' });
  console.error(err);
  return res.status(500).json({ erreur: 'Erreur interne du serveur. Même le Veilleur a ses nuits blanches.' });
});

/* ------------------------------------------------------------------ */
/* Démarrage                                                           */
/* ------------------------------------------------------------------ */

const server = app.listen(PORT, HOST, (err) => {
  if (err) return; // Express 5 rappelle ce callback en cas d'erreur : le gestionnaire 'error' ci-dessous s'en charge.
  console.log(`🌙 Noctambouffe écoute sur http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Le port ${PORT} est déjà utilisé. Change PORT dans .env (ex : PORT=3001) ou ferme l'autre programme.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
