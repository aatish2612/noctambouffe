'use strict';
/**
 * Conversion des éléments OpenStreetMap (réponse de l'API Overpass) en spots Noctambouffe.
 * Module pur (aucun réseau, aucune base) : il est testé avec `npm test`.
 *
 * Données © contributeurs OpenStreetMap, licence ODbL — https://www.openstreetmap.org/copyright
 */
const { isOpenAt, detectCuisines, normalize } = require('./veilleur');

const NIGHT_START = 23 * 60;
const NIGHT_LENGTH = 7 * 60; // 23h -> 6h

const pad = (n) => String(n).padStart(2, '0');

/** Texte propre : caractères de contrôle retirés, espaces normalisés. */
const clean = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '');

/** Nombre de minutes du créneau 23h -> 6h pendant lesquelles [ouverture, fermeture] est ouvert. */
function nightMinutes(ouverture, fermeture) {
  let n = 0;
  for (let i = 0; i < NIGHT_LENGTH; i += 1) {
    if (isOpenAt(ouverture, fermeture, (NIGHT_START + i) % 1440)) n += 1;
  }
  return n;
}

/**
 * Extrait les plages « HH:MM-HH:MM » d'un champ opening_hours d'OpenStreetMap.
 * Les jours sont ignorés : on ne garde que les heures. "24/7" donne 24h/24.
 */
function extractRanges(openingHours) {
  const text = String(openingHours || '');
  if (/24\s*\/\s*7/.test(text)) return [['00:00', '00:00']];
  const ranges = [];
  const re = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g;
  let m = re.exec(text);
  while (m) {
    const [h1, m1, h2, m2] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    // OSM autorise "24:00" ou "26:00" pour une fermeture après minuit.
    if (h1 <= 23 && m1 <= 59 && h2 <= 29 && m2 <= 59) ranges.push([`${pad(h1)}:${pad(m1)}`, `${pad(h2 % 24)}:${pad(m2)}`]);
    m = re.exec(text);
  }
  return ranges;
}

/**
 * La plage qui couvre le mieux la nuit (23h -> 6h), ou null si le lieu n'est jamais ouvert la nuit.
 * Approximation assumée : un seul créneau « typique » par spot, sans distinguer les jours de la semaine.
 */
function bestNightRange(openingHours) {
  let best = null;
  let bestMinutes = 0;
  for (const [ouverture, fermeture] of extractRanges(openingHours)) {
    const minutes = nightMinutes(ouverture, fermeture);
    if (minutes > bestMinutes) {
      best = { ouverture, fermeture };
      bestMinutes = minutes;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Type de cuisine                                                     */
/* ------------------------------------------------------------------ */

const CUISINE_TAGS = {
  Kebab: ['kebab', 'turkish', 'doner', 'shawarma', 'gyros'],
  Burger: ['burger'],
  Pizza: ['pizza', 'italian'],
  Asiatique: ['asian', 'chinese', 'japanese', 'sushi', 'ramen', 'thai', 'vietnamese', 'korean', 'noodle', 'noodles', 'wok', 'dim_sum'],
  Bistrot: ['french', 'bistro', 'brasserie', 'steak_house', 'steak', 'regional'],
  Libanais: ['lebanese', 'falafel', 'middle_eastern', 'arab', 'syrian', 'oriental'],
  Tacos: ['mexican', 'tacos', 'burrito'],
  Indien: ['indian', 'pakistani', 'bangladeshi', 'curry', 'nepalese', 'sri_lankan'],
  Snack: ['sandwich', 'bakery', 'crepe', 'ice_cream', 'waffle', 'snack', 'hot_dog', 'chicken', 'fish_and_chips'],
};

function typeFromTags(tags) {
  const parts = String(tags.cuisine || '').toLowerCase().split(/[;,]/).map((p) => p.trim()).filter(Boolean);
  for (const [type, keys] of Object.entries(CUISINE_TAGS)) {
    if (parts.some((p) => keys.includes(p))) return type;
  }
  // Pas de tag « cuisine » exploitable : on devine à partir du nom ("O'Tacos", "Pizza Nova"…).
  const guess = detectCuisines(normalize(`${tags.name || ''} ${parts.join(' ')}`));
  return guess[0] || 'Autre';
}

/* ------------------------------------------------------------------ */
/* Badge et roast (les données OSM n'en ont pas : le Veilleur les invente) */
/* ------------------------------------------------------------------ */

const BADGES = {
  Kebab: ['Roi de la sauce blanche', 'Dealer de dürüm'],
  Burger: ['Cheeseburger de la honte', 'Maître du gras'],
  Pizza: ['Pâte et âme en peine', 'Quatre fromages, zéro dignité'],
  Asiatique: ['Nouilles des désespérés', 'Bouillon de minuit'],
  Bistrot: ['Frites et regrets', 'Dernier zinc debout'],
  Libanais: ['Falafel fantôme', 'Houmous de la dernière chance'],
  Tacos: ['Sauce fromagère à vie', 'Tacos sans pitié'],
  Indien: ['Curry des insomniaques', 'Naan de minuit'],
  Snack: ['Sandwich de survie', 'Grignotage officiel'],
  Autre: ['Survivant de la nuit', 'Mystère du noctambule'],
};

const ROASTS = {
  Kebab: ['Le gars derrière le comptoir t\'a jugé trois fois avant que tu finisses ta commande.', 'La sauce blanche est la seule chose stable dans ta vie. Commande-la.'],
  Burger: ['Le burger est gras, le service est sec, et tu reviendras quand même.', 'Ici, on ne juge pas ton burger. On juge l\'heure à laquelle tu le commandes.'],
  Pizza: ['La pâte lève mieux que toi, et elle est moins en retard.', 'Une pizza à cette heure-là : le seul plan de ta soirée qui ne t\'a pas posé de lapin.'],
  Asiatique: ['Le bouillon fume, comme ton cerveau à cette heure-là.', 'Des nouilles à pareille heure : au moins elles, elles ont un plan.'],
  Bistrot: ['Un bistrot qui veille tard : le seul à te tenir compagnie sans te demander pourquoi t\'es seul.', 'Le zinc a vu pire que toi. À peine, mais il a vu pire.'],
  Libanais: ['Du falafel à cette heure-là : tu fais des choix de vie contestables, mais celui-là se défend.', 'Le houmous ne te jugera pas. Le serveur, si.'],
  Tacos: ['Le tacos pèse plus lourd que tes excuses, et il a plus de caractère.', 'Sauce fromagère à gogo : ta dignité n\'a pas survécu à la porte d\'entrée.'],
  Indien: ['Le curry te réveillera mieux que n\'importe quel réveil, et lui, il sera à l\'heure.', 'Un naan à cette heure-là : pas glorieux, mais chaud.'],
  Snack: ['Un sandwich de survie pour une vie qui ne l\'est pas moins.', 'Ce n\'est pas un repas, c\'est un pansement. Mais il est ouvert.'],
  Autre: ['Je ne sais pas ce qu\'ils servent, mais c\'est ouvert, et toi, t\'es en pleine nuit. Ça colle.', 'Un lieu mystérieux pour un client mystérieux. Vous méritez de vous rencontrer.'],
};

/** Petit hash stable : un même spot reçoit toujours le même badge et le même roast. */
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h;
}

/* ------------------------------------------------------------------ */
/* Adresse et conversion                                               */
/* ------------------------------------------------------------------ */

function buildAddress(tags, lat, lon) {
  const city = [tags['addr:postcode'], tags['addr:city']].map(clean).filter(Boolean).join(' ');
  const street = [tags['addr:housenumber'], tags['addr:street']].map(clean).filter(Boolean).join(' ');
  if (tags['addr:street']) return [street, city || 'Île-de-France'].join(', ').slice(0, 160);
  // Beaucoup de lieux OSM n'ont pas d'adresse : on garde le GPS, utilisable sur n'importe quelle carte.
  return `${city ? `${city} — ` : ''}GPS ${lat.toFixed(5)}, ${lon.toFixed(5)}`.slice(0, 160);
}

// Départements d'Île-de-France : un code postal qui n'en fait pas partie (ex : 89100 Sens) est écarté.
const IDF_POSTCODES = ['75', '77', '78', '91', '92', '93', '94', '95'];
const inIdf = (postcode) => !/^\d{5}$/.test(postcode) || IDF_POSTCODES.some((d) => postcode.startsWith(d));

/**
 * Un élément Overpass -> un spot, ou null s'il doit être écarté
 * (pas de nom, pas de position, hors Île-de-France, jamais ouvert entre 23h et 6h : Décret de 23h).
 */
function toSpot(el) {
  const tags = el.tags || {};
  const nom = clean(tags.name).slice(0, 80);
  const lat = el.lat !== undefined ? el.lat : el.center && el.center.lat;
  const lon = el.lon !== undefined ? el.lon : el.center && el.center.lon;
  if (nom.length < 2 || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  // Le rectangle de secours de l'import déborde sur l'Yonne, l'Oise, le Loiret… : on les écarte par le code postal.
  if (!inIdf(clean(tags['addr:postcode']))) return null;

  const hours = bestNightRange(tags.opening_hours);
  if (!hours) return null;

  const type = typeFromTags(tags);
  const osmId = `${el.type}/${el.id}`;
  const h = hash(osmId);
  return {
    nom,
    type,
    adresse: buildAddress(tags, lat, lon),
    ouverture: hours.ouverture,
    fermeture: hours.fermeture,
    badge: BADGES[type][h % BADGES[type].length],
    roast: ROASTS[type][(h >>> 3) % ROASTS[type].length],
    lat,
    lon,
    osm_id: osmId,
  };
}

/** Convertit tous les éléments ; renvoie les spots retenus et le nombre d'éléments écartés. */
function convert(elements) {
  const spots = [];
  let ecartes = 0;
  for (const el of Array.isArray(elements) ? elements : []) {
    const spot = toSpot(el);
    if (spot) spots.push(spot);
    else ecartes += 1;
  }
  return { spots, ecartes };
}

module.exports = { extractRanges, bestNightRange, nightMinutes, typeFromTags, buildAddress, toSpot, convert };
